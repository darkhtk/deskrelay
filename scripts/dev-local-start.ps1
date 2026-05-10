[CmdletBinding()]
param(
  [string]$NasRoot = $env:CR_NAS_DEV_ROOT,
  [string]$RepoRoot = "",
  [string]$SiteToken = $(if ($env:CR_SITE_TOKEN) { $env:CR_SITE_TOKEN } else { "dev-local-token" }),
  [int]$SitePort = 18192,
  [int]$FrontendPort = 18193,
  [int]$DaemonPort = 18191,
  [string]$FrontendHost = "127.0.0.1",
  [switch]$NoBackend,
  [switch]$NoFrontend,
  [switch]$NoDaemon,
  [switch]$NoRegisterDevice,
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  param([string]$Explicit)
  if ($Explicit) {
    return [System.IO.Path]::GetFullPath($Explicit)
  }
  $root = (& git rev-parse --show-toplevel 2>$null)
  if (-not $root) {
    throw "Could not resolve repo root. Run this script from the repository or pass -RepoRoot."
  }
  return [System.IO.Path]::GetFullPath($root.Trim())
}

function Get-FullPathNoResolve {
  param([string]$Path, [string]$Repo)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    $Path = Join-Path $Repo ".local-dev"
  }
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Quote-PsString {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return $null
  }
  return Get-Content -Raw -Path $Path | ConvertFrom-Json
}

function Test-StringContains {
  param([string]$Haystack, [string]$Needle)
  if ([string]::IsNullOrWhiteSpace($Haystack) -or [string]::IsNullOrWhiteSpace($Needle)) {
    return $false
  }
  return $Haystack.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) {
    return ""
  }
  return [string]$process.CommandLine
}

function Test-DeskRelayCommandLine {
  param([string]$CommandLine)
  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }
  $needles = @(
    $script:DeskRelayRepoRoot,
    $env:CR_DEV_LOG_DIR,
    "packages/pc-connector-daemon/src/bin.ts",
    "packages\pc-connector-daemon\src\bin.ts",
    "packages/site-backend/src/bin.ts",
    "packages\site-backend\src\bin.ts",
    "@deskrelay/site-frontend"
  )
  foreach ($needle in $needles) {
    if (Test-StringContains -Haystack $CommandLine -Needle $needle) {
      return $true
    }
  }
  return $false
}

function Test-ProcessEntryAlive {
  param([object]$Entry)
  if (-not $Entry -or -not $Entry.pid) {
    return $false
  }
  $commandLine = Get-ProcessCommandLine -ProcessId ([int]$Entry.pid)
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }
  foreach ($field in @("runner", "log")) {
    $property = $Entry.PSObject.Properties[$field]
    if ($property -and (Test-StringContains -Haystack $commandLine -Needle ([string]$property.Value))) {
      return $true
    }
  }
  return Test-DeskRelayCommandLine -CommandLine $commandLine
}

function Test-DeskRelayProcessId {
  param([int]$ProcessId)
  return Test-DeskRelayCommandLine -CommandLine (Get-ProcessCommandLine -ProcessId $ProcessId)
}

function Wait-File {
  param([string]$Path, [int]$TimeoutSeconds = 15)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $Path) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for file: $Path"
}

function Wait-Http {
  param(
    [string]$Url,
    [hashtable]$Headers = @{},
    [int]$TimeoutSeconds = 20
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-RestMethod -Method Get -Uri $Url -Headers $Headers -TimeoutSec 2 | Out-Null
      return
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Timed out waiting for $Url. Last error: $lastError"
}

function Start-DevProcess {
  param(
    [string]$Name,
    [string]$Command,
    [string]$LogPath,
    [string]$Repo,
    [string]$EnvFile
  )
  $runnerPath = Join-Path $env:CR_DEV_LOG_DIR "$Name.runner.ps1"
  $ps = @"
`$ErrorActionPreference = 'Stop'
try {
  "[$((Get-Date).ToUniversalTime().ToString("o"))] starting $Name" | Out-File -Encoding utf8 -FilePath $(Quote-PsString $LogPath)
  . $(Quote-PsString $EnvFile)
  Set-Location $(Quote-PsString $Repo)
  `$ErrorActionPreference = 'Continue'
  Invoke-Expression $(Quote-PsString "$Command 2>&1") | ForEach-Object {
    `$_.ToString() | Out-File -Encoding utf8 -Append -FilePath $(Quote-PsString $LogPath)
  }
  `$nativeExit = `$LASTEXITCODE
  `$ErrorActionPreference = 'Stop'
  if (`$nativeExit -ne 0) {
    "[$((Get-Date).ToUniversalTime().ToString("o"))] $Name exited with code `$nativeExit" | Out-File -Encoding utf8 -Append -FilePath $(Quote-PsString $LogPath)
    exit `$nativeExit
  }
} catch {
  "[$((Get-Date).ToUniversalTime().ToString("o"))] failed $Name" | Out-File -Encoding utf8 -Append -FilePath $(Quote-PsString $LogPath)
  `$_ | Out-String | Out-File -Encoding utf8 -Append -FilePath $(Quote-PsString $LogPath)
  exit 1
}
"@
  if ($PrintOnly) {
    Write-Host "[$Name] $Command"
    Write-Host "  log: $LogPath"
    return $null
  }
  $ps | Set-Content -Encoding utf8 -Path $runnerPath
  $proc = Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $runnerPath
  ) -PassThru -WindowStyle Hidden
  $entry = [pscustomobject]@{
    name = $Name
    pid = $proc.Id
    command = $Command
    log = $LogPath
    runner = $runnerPath
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $script:StartedProcesses += $entry
  return $entry
}

$script:StartedProcesses = @()
function Stop-ProcessTree {
  param([int]$ProcessId, [switch]$Trusted)
  if ($ProcessId -eq $PID) {
    Write-Warning "Skipping current PowerShell process pid=$ProcessId."
    return
  }
  if (-not $Trusted -and -not (Test-DeskRelayProcessId -ProcessId $ProcessId)) {
    Write-Warning "Skipping pid=$ProcessId because it does not look like a DeskRelay dev process."
    return
  }
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $proc) {
    return
  }
  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  } catch {
    throw "Could not stop stale DeskRelay dev process pid=$ProcessId ($($proc.ProcessName)). Close the process, or rerun from an elevated terminal. $($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 200
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    throw "Could not stop stale DeskRelay dev process pid=$ProcessId ($($proc.ProcessName)). Close the process, or rerun from an elevated terminal."
  }
}

function Get-DevPorts {
  $ports = @()
  if (-not $NoDaemon -and $env:CR_CONNECTOR_PORT) {
    $ports += [int]$env:CR_CONNECTOR_PORT
  }
  if (-not $NoBackend -and $env:CR_SITE_PORT) {
    $ports += [int]$env:CR_SITE_PORT
  }
  if (-not $NoFrontend -and $env:CR_DEV_FRONTEND_URL) {
    try {
      $ports += ([Uri]$env:CR_DEV_FRONTEND_URL).Port
    } catch {
      # Ignore malformed convenience value.
    }
  }
  return @($ports | Sort-Object -Unique)
}

function Stop-StaleDevPortListeners {
  param([object[]]$KnownProcesses)
  $knownPids = @($KnownProcesses | ForEach-Object { if ($_.pid) { [int]$_.pid } })
  foreach ($port in Get-DevPorts) {
    $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
      $owner = [int]$listener.OwningProcess
      if (-not $owner -or $owner -eq $PID -or $knownPids -contains $owner) {
        continue
      }
      if (-not (Test-DeskRelayProcessId -ProcessId $owner)) {
        throw "Dev port $port is occupied by a non-DeskRelay process pid=$owner. Stop it manually or choose another port."
      }
      Write-Host "Stopping stale DeskRelay dev listener on port $port pid=$owner"
      Stop-ProcessTree -ProcessId $owner -Trusted
    }
  }
}

trap {
  if (-not $PrintOnly -and $script:StartedProcesses.Count -gt 0) {
    foreach ($entry in $script:StartedProcesses) {
      if ($entry.pid -and (Test-ProcessEntryAlive -Entry $entry)) {
        Stop-ProcessTree -ProcessId ([int]$entry.pid) -Trusted
      }
    }
  }
  break
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$script:DeskRelayRepoRoot = $repo
$root = Get-FullPathNoResolve -Path $NasRoot -Repo $repo
$initScript = Join-Path $repo "scripts\nas-dev-init.ps1"
$envFile = Join-Path $root "dev.env.ps1"

if (-not (Test-Path $envFile)) {
  & $initScript -NasRoot $root -RepoRoot $repo -SiteToken $SiteToken -SitePort $SitePort -FrontendPort $FrontendPort -DaemonPort $DaemonPort
}

. $envFile

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  throw "bun is not on PATH. Install Bun or add it to PATH before starting local dev."
}

New-Item -ItemType Directory -Force -Path $env:CR_DEV_LOG_DIR | Out-Null

$existing = @()
if (Test-Path $env:CR_DEV_PROCESS_FILE) {
  $raw = Read-JsonFile -Path $env:CR_DEV_PROCESS_FILE
  if ($raw) {
    $existing = @($raw | Where-Object { Test-ProcessEntryAlive -Entry $_ })
  }
}
if ($existing.Count -gt 0 -and -not $PrintOnly) {
  $names = ($existing | ForEach-Object { "$($_.name):$($_.pid)" }) -join ", "
  throw "Local dev appears to be running already ($names). Run scripts\dev-local-stop.ps1 first."
}

if (-not $PrintOnly) {
  Stop-StaleDevPortListeners -KnownProcesses $existing
}

$started = @()

if (-not $NoDaemon) {
  $daemonLog = Join-Path $env:CR_DEV_LOG_DIR "daemon.log"
  $daemon = Start-DevProcess -Name "daemon" -Command "bun run packages/pc-connector-daemon/src/bin.ts" -LogPath $daemonLog -Repo $repo -EnvFile $envFile
  if ($daemon) {
    $started += $daemon
    Wait-File -Path $env:CR_CONNECTOR_AUTH_FILE -TimeoutSeconds 20
    $auth = Read-JsonFile -Path $env:CR_CONNECTOR_AUTH_FILE
    if (-not $auth -or -not $auth.token) {
      throw "Daemon auth file exists but has no token: $env:CR_CONNECTOR_AUTH_FILE"
    }
    Wait-Http -Url "$env:CR_DEV_DAEMON_URL/status" -Headers @{ Authorization = "Bearer $($auth.token)" } -TimeoutSeconds 20
  }
}

if (-not $NoBackend) {
  $backendLog = Join-Path $env:CR_DEV_LOG_DIR "site-backend.log"
  $backend = Start-DevProcess -Name "site-backend" -Command "bun run packages/site-backend/src/bin.ts" -LogPath $backendLog -Repo $repo -EnvFile $envFile
  if ($backend) {
    $started += $backend
    Wait-Http -Url "$env:CR_DEV_SITE_URL/healthz" -TimeoutSeconds 20
  }
}

if (-not $NoRegisterDevice -and -not $NoDaemon -and -not $NoBackend -and -not $PrintOnly) {
  $headers = @{ Authorization = "Bearer $env:CR_SITE_TOKEN"; "content-type" = "application/json" }
  try {
    Invoke-RestMethod -Method Get -Uri "$env:CR_DEV_SITE_URL/api/devices" -Headers @{ Authorization = "Bearer $env:CR_SITE_TOKEN" } -TimeoutSec 5 | Out-Null
  } catch {
    Write-Warning "Could not list existing devices before local registration; attempting registration anyway."
  }
  $label = "Local dev ($env:COMPUTERNAME)"
  $body = @{ daemonUrl = $env:CR_DEV_DAEMON_URL; label = $label; authToken = $auth.token } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "$env:CR_DEV_SITE_URL/api/devices" -Headers $headers -Body $body -TimeoutSec 10 | Out-Null
}

if (-not $NoFrontend) {
  $frontendLog = Join-Path $env:CR_DEV_LOG_DIR "site-frontend.log"
  $frontend = Start-DevProcess -Name "site-frontend" -Command "bun --filter @deskrelay/site-frontend dev -- --host $FrontendHost --port $FrontendPort" -LogPath $frontendLog -Repo $repo -EnvFile $envFile
  if ($frontend) {
    $started += $frontend
    Wait-Http -Url $env:CR_DEV_FRONTEND_URL -TimeoutSeconds 25
  }
}

if ($PrintOnly) {
  Write-Host "PrintOnly complete. No processes were started."
  exit 0
}

$started | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -Path $env:CR_DEV_PROCESS_FILE

Write-Host "Local dev is running."
Write-Host "Frontend: $env:CR_DEV_FRONTEND_URL"
Write-Host "Site token: $env:CR_SITE_TOKEN"
Write-Host "Logs: $env:CR_DEV_LOG_DIR"
Write-Host "Stop: .\scripts\dev-local-stop.ps1 -NasRoot `"$root`""
