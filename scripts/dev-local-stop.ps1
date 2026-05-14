[CmdletBinding()]
param(
  [string]$NasRoot = $env:CR_NAS_DEV_ROOT,
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  param([string]$Explicit)
  if ($Explicit) {
    return [System.IO.Path]::GetFullPath($Explicit)
  }
  $root = (& git rev-parse --show-toplevel 2>$null)
  if ($root) {
    return [System.IO.Path]::GetFullPath($root.Trim())
  }
  return (Get-Location).Path
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

function Get-EntryPort {
  param([object]$Entry)
  if (-not $Entry) { return 0 }
  $name = if ($Entry.name) { [string]$Entry.name } else { "" }
  $command = if ($Entry.PSObject.Properties["command"]) { [string]$Entry.command } else { "" }
  $match = [regex]::Match($command, '--port[=\s]+(\d+)')
  if ($match.Success) { return [int]$match.Groups[1].Value }
  switch ($name) {
    "daemon" {
      if ($env:CR_CONNECTOR_PORT) { return [int]$env:CR_CONNECTOR_PORT }
      return 18191
    }
    "site-backend" {
      if ($env:CR_SITE_PORT) { return [int]$env:CR_SITE_PORT }
      return 18193
    }
    "site-frontend" {
      if ($env:CR_DEV_FRONTEND_URL) {
        try { return ([Uri]$env:CR_DEV_FRONTEND_URL).Port } catch { }
      }
      return 18094
    }
  }
  return 0
}

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
    throw "Could not stop DeskRelay dev process pid=$ProcessId ($($proc.ProcessName)). Close the process, or rerun from an elevated terminal. $($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 200
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    throw "Could not stop DeskRelay dev process pid=$ProcessId ($($proc.ProcessName)). Close the process, or rerun from an elevated terminal."
  }
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$script:DeskRelayRepoRoot = $repo
$root = Get-FullPathNoResolve -Path $NasRoot -Repo $repo
$envFile = Join-Path $root "dev.env.ps1"
if (Test-Path $envFile) {
  . $envFile
}
$processFile = Join-Path $root "state\dev-processes.json"

if (-not (Test-Path $processFile)) {
  Write-Host "No local dev process file found: $processFile"
} else {
  $decoded = Get-Content -Raw -Path $processFile | ConvertFrom-Json
  if ($decoded -is [System.Array]) {
    $processes = $decoded
  } else {
    $processes = @($decoded)
  }
  $restartLogDir = Join-Path $root "logs"
  $restartLogPath = Join-Path $restartLogDir "self-server-restart.log"
  try { New-Item -ItemType Directory -Force -Path $restartLogDir | Out-Null } catch { }
  foreach ($entry in $processes) {
    if (-not $entry.pid) { continue }
    $processId = [int]$entry.pid
    $entryPort = Get-EntryPort -Entry $entry
    $liveOwnerPid = 0
    if ($entryPort -gt 0) {
      $listeners = @(Get-NetTCPConnection -LocalPort $entryPort -State Listen -ErrorAction SilentlyContinue)
      foreach ($listener in $listeners) {
        $candidate = [int]$listener.OwningProcess
        if ($candidate -gt 0 -and $candidate -ne $PID) { $liveOwnerPid = $candidate; break }
      }
    }
    $killSet = @()
    if ($processId -gt 0) { $killSet += $processId }
    if ($liveOwnerPid -gt 0 -and -not ($killSet -contains $liveOwnerPid)) { $killSet += $liveOwnerPid }
    $attempted = @()
    $killed = @()
    if ($entryPort -gt 0) {
      foreach ($k in $killSet) {
        if (-not (Get-Process -Id $k -ErrorAction SilentlyContinue)) { continue }
        $attempted += $k
        Write-Host "Stopping $($entry.name) pid=$k port=$entryPort"
        Stop-Process -Id $k -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 200
        if (-not (Get-Process -Id $k -ErrorAction SilentlyContinue)) { $killed += $k }
      }
    } else {
      $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($proc -and (Test-ProcessEntryAlive -Entry $entry)) {
        Write-Host "Stopping $($entry.name) pid=$processId"
        Stop-ProcessTree -ProcessId $processId -Trusted
        $attempted += $processId
        if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { $killed += $processId }
      } elseif ($proc) {
        Write-Warning "Skipping stale $($entry.name) pid=$processId because the PID now belongs to another process."
      } else {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction SilentlyContinue)
        foreach ($child in $children) {
          if (-not (Test-DeskRelayProcessId -ProcessId ([int]$child.ProcessId))) { continue }
          Write-Host "Stopping orphaned child of $($entry.name) pid=$($child.ProcessId)"
          Stop-ProcessTree -ProcessId ([int]$child.ProcessId) -Trusted
        }
      }
    }
    try {
      $payload = [ordered]@{
        ts = (Get-Date).ToUniversalTime().ToString("o")
        name = if ($entry.name) { [string]$entry.name } else { "" }
        recorded_pid = $processId
        port = $entryPort
        live_owner_pid = $liveOwnerPid
        attempted = $attempted
        killed = $killed
      }
      Add-Content -Path $restartLogPath -Value (($payload | ConvertTo-Json -Compress)) -ErrorAction SilentlyContinue
    } catch { }
  }
  Remove-Item -Force -Path $processFile -ErrorAction SilentlyContinue
}

$ports = @()
foreach ($candidate in @($env:CR_CONNECTOR_PORT, $env:CR_SITE_PORT)) {
  if ($candidate) {
    $ports += [int]$candidate
  }
}
if ($env:CR_DEV_FRONTEND_URL) {
  try {
    $ports += ([Uri]$env:CR_DEV_FRONTEND_URL).Port
  } catch {
    # Ignore malformed convenience value.
  }
}
$ports = @($ports | Sort-Object -Unique)
foreach ($port in $ports) {
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    if ($listener.OwningProcess -and $listener.OwningProcess -ne $PID) {
      if (-not (Test-DeskRelayProcessId -ProcessId ([int]$listener.OwningProcess))) {
        Write-Warning "Skipping process on dev port $port pid=$($listener.OwningProcess) because it does not look like a DeskRelay dev process."
        continue
      }
      Write-Host "Stopping process on dev port $port pid=$($listener.OwningProcess)"
      Stop-ProcessTree -ProcessId ([int]$listener.OwningProcess) -Trusted
    }
  }
}

Write-Host "Local dev stopped."
