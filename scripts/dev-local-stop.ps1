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

function Stop-ProcessTree {
  param([int]$ProcessId)
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$repo = Get-RepoRoot -Explicit $RepoRoot
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
  foreach ($entry in $processes) {
    if (-not $entry.pid) {
      continue
    }
    $processId = [int]$entry.pid
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "Stopping $($entry.name) pid=$processId"
      Stop-ProcessTree -ProcessId $processId
    } else {
      $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction SilentlyContinue)
      foreach ($child in $children) {
        Write-Host "Stopping orphaned child of $($entry.name) pid=$($child.ProcessId)"
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
      }
    }
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
      Write-Host "Stopping process on dev port $port pid=$($listener.OwningProcess)"
      Stop-ProcessTree -ProcessId ([int]$listener.OwningProcess)
    }
  }
}

Write-Host "Local dev stopped."
