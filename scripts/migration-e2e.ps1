param(
  [switch]$AllowLocalMutation,
  [switch]$KeepTemp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$taskName = "Remote for Claude Connector"
$isActions = $env:GITHUB_ACTIONS -eq "true"

if (!$isActions -and !$AllowLocalMutation) {
  [Console]::Error.WriteLine("migration E2E mutates the real Windows Task Scheduler task name '$taskName'. Run on GitHub Actions/VM, or pass -AllowLocalMutation explicitly.")
  exit 2
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}

function Invoke-Native([string]$File, [string[]]$ArgumentList, [hashtable]$Env = @{}) {
  $old = @{}
  foreach ($key in $Env.Keys) {
    $old[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$Env[$key], "Process")
  }
  try {
    $output = & $File @ArgumentList 2>&1 | Out-String
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  } finally {
    foreach ($key in $Env.Keys) {
      [Environment]::SetEnvironmentVariable($key, $old[$key], "Process")
    }
  }
}

function New-SmokeTempDir {
  $path = Join-Path ([IO.Path]::GetTempPath()) ("cr-migration-e2e-{0}" -f [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $path | Out-Null
  return $path
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
  $listener.Start()
  try {
    return $listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Get-TaskRaw {
  $raw = & schtasks.exe /Query /TN $taskName /FO LIST /V 2>$null | Out-String
  if ($LASTEXITCODE -ne 0) { return "" }
  return $raw
}

function Remove-TestTask {
  & schtasks.exe /End /TN $taskName *> $null
  & schtasks.exe /Delete /TN $taskName /F *> $null
}

function Start-ProcessWithEnv(
  [string]$File,
  [string[]]$ArgumentList,
  [string]$WorkingDirectory,
  [string]$StdoutPath,
  [string]$StderrPath,
  [hashtable]$Env
) {
  $old = @{}
  foreach ($key in $Env.Keys) {
    $old[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$Env[$key], "Process")
  }
  try {
    return Start-Process -FilePath $File `
      -ArgumentList $ArgumentList `
      -WorkingDirectory $WorkingDirectory `
      -RedirectStandardOutput $StdoutPath `
      -RedirectStandardError $StderrPath `
      -WindowStyle Hidden `
      -PassThru
  } finally {
    foreach ($key in $Env.Keys) {
      [Environment]::SetEnvironmentVariable($key, $old[$key], "Process")
    }
  }
}

function Stop-TestProcess($Process) {
  if ($Process -and !$Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
  }
}

function Read-JsonFile([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Wait-ForStatePid([string]$StateFile, [int]$ExpectedPid, [int]$TimeoutMs = 15000) {
  $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $TimeoutMs
  while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline) {
    $state = Read-JsonFile $StateFile
    if ($state -and $state.pid -eq $ExpectedPid) { return $state }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Wait-ForProcessExit($Process, [int]$TimeoutMs = 15000) {
  $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $TimeoutMs
  while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Wait-ForDaemonStatus([int]$Port, [string]$AuthFile, [int]$TimeoutMs = 15000) {
  $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $TimeoutMs
  while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline) {
    try {
      if (Test-Path -LiteralPath $AuthFile) {
        $auth = Get-Content -LiteralPath $AuthFile -Raw | ConvertFrom-Json
        $status = Invoke-RestMethod `
          -Uri ("http://127.0.0.1:{0}/status" -f $Port) `
          -Headers @{ Authorization = ("Bearer {0}" -f $auth.token) } `
          -TimeoutSec 2
        if ($status.ok -eq $true) { return $status }
      }
    } catch {
      # Keep polling.
    }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Format-LogTail([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return "(missing $Path)" }
  return (Get-Content -LiteralPath $Path -Tail 80 -ErrorAction SilentlyContinue | Out-String)
}

Write-Host "[migration-e2e] repo: $repoRoot"
Write-Host "[migration-e2e] disposable runner: $isActions"

$temp = New-SmokeTempDir
$legacy = $null
$packaged = $null
$stateFile = Join-Path $temp "daemon.json"
$authFile = Join-Path $temp "auth.json"
$legacyOut = Join-Path $temp "legacy.stdout.log"
$legacyErr = Join-Path $temp "legacy.stderr.log"
$packagedOut = Join-Path $temp "packaged.stdout.log"
$packagedErr = Join-Path $temp "packaged.stderr.log"
$port = Get-FreeTcpPort

$envMap = @{
  CR_CONNECTOR_STATE_DIR = $temp
  CR_IDENTITY_DIR = Join-Path $temp "identity"
  CR_CONNECTOR_AUTH_FILE = $authFile
  CR_CONNECTOR_PORT = [string]$port
  CR_CONNECTOR_DISABLE_AUTOLOAD = "1"
  CR_CONNECTOR_WORKSPACE_ROOTS = $temp
  CR_CONNECTOR_LOGIN_TASK_NAME = $taskName
}

try {
  Remove-TestTask
  Assert-True ([string]::IsNullOrWhiteSpace((Get-TaskRaw))) "test login task should be absent before setup"

  Write-Host "[migration-e2e] building packaged connector binary"
  $build = Invoke-Native "bun" @("--filter", "@claude-remote/pc-connector-daemon", "build:binary")
  Assert-True ($build.ExitCode -eq 0) $build.Output
  $exe = Join-Path $repoRoot "packages\pc-connector-daemon\dist\cr-connector-win32-x64.exe"
  Assert-True (Test-Path -LiteralPath $exe) "packaged binary missing: $exe"

  Write-Host "[migration-e2e] installing legacy source-run login task"
  $install = Invoke-Native "bun" @(
    "run",
    "packages/pc-connector-daemon/src/bin.ts",
    "login-task",
    "install"
  ) $envMap
  Assert-True ($install.ExitCode -eq 0) $install.Output
  $taskRaw = Get-TaskRaw
  Assert-True (!$([string]::IsNullOrWhiteSpace($taskRaw))) "legacy login task was not created"
  $taskScript = Join-Path $temp "cr-connector-login-task.ps1"
  Assert-True (Test-Path -LiteralPath $taskScript) "legacy login task script missing"
  $scriptText = Get-Content -LiteralPath $taskScript -Raw
  Assert-True ($scriptText.Replace("\", "/").ToLowerInvariant().Contains("packages/pc-connector-daemon/src/bin.ts")) "legacy script does not look source-run"

  Write-Host "[migration-e2e] starting legacy daemon on isolated port $port"
  $legacy = Start-ProcessWithEnv `
    "bun" `
    @("run", "packages/pc-connector-daemon/src/bin.ts") `
    $repoRoot `
    $legacyOut `
    $legacyErr `
    $envMap
  $legacyStatus = Wait-ForDaemonStatus $port $authFile
  if (!$legacyStatus) {
    throw "legacy daemon did not become ready`nSTDOUT:`n$(Format-LogTail $legacyOut)`nSTDERR:`n$(Format-LogTail $legacyErr)"
  }
  $legacyState = Wait-ForStatePid $stateFile $legacy.Id
  Assert-True ($null -ne $legacyState) "legacy daemon did not write expected pid state"
  Assert-True ($legacyStatus.pairing.state -eq "unpaired") "legacy daemon should be unpaired"
  Write-Host ("  OK legacy daemon pid={0}" -f $legacy.Id)

  Write-Host "[migration-e2e] starting packaged connector for takeover"
  $packaged = Start-ProcessWithEnv `
    $exe `
    @() `
    $repoRoot `
    $packagedOut `
    $packagedErr `
    $envMap

  Assert-True (Wait-ForProcessExit $legacy 20000) "legacy daemon was not stopped by packaged connector takeover"
  Assert-True ([string]::IsNullOrWhiteSpace((Get-TaskRaw))) "legacy source-run login task was not removed"
  $packagedState = Wait-ForStatePid $stateFile $packaged.Id 20000
  if (!$packagedState) {
    throw "packaged daemon did not take over state file`nSTDOUT:`n$(Format-LogTail $packagedOut)`nSTDERR:`n$(Format-LogTail $packagedErr)"
  }
  $packagedStatus = Wait-ForDaemonStatus $port $authFile
  Assert-True ($null -ne $packagedStatus) "packaged daemon did not answer /status"
  Assert-True ($packagedStatus.listening.port -eq $port) "packaged daemon listening port mismatch"
  Assert-True ($packagedStatus.pairing.state -eq "unpaired") "packaged daemon should remain unpaired in isolated test"

  Stop-TestProcess $packaged
  $packaged = $null
  $packagedErrText = Format-LogTail $packagedErr
  Assert-True ($packagedErrText.Contains("removed legacy source-run login task")) "packaged stderr missing login-task removal diagnostic"
  Assert-True ($packagedErrText.Contains("stopped legacy daemon pid=")) "packaged stderr missing stale daemon stop diagnostic"

  Write-Host "[migration-e2e] all checks passed"
  exit 0
} finally {
  Stop-TestProcess $packaged
  Stop-TestProcess $legacy
  Remove-TestTask
  if (!$KeepTemp) {
    Remove-Item -Recurse -Force -LiteralPath $temp -ErrorAction SilentlyContinue
  } else {
    Write-Host "[migration-e2e] kept temp dir: $temp"
  }
}
