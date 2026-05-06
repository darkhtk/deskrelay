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

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $NasRoot -Repo $repo
$envFile = Join-Path $root "dev.env.ps1"
if (Test-Path $envFile) {
  . $envFile
}

$processFile = Join-Path $root "state\dev-processes.json"
if (-not (Test-Path $processFile)) {
  Write-Host "Local dev is not running."
  Write-Host "Root: $root"
  exit 0
}

$decoded = Get-Content -Raw -Path $processFile | ConvertFrom-Json
if ($decoded -is [System.Array]) {
  $entries = $decoded
} else {
  $entries = @($decoded)
}
$rows = foreach ($entry in $entries) {
  $proc = if ($entry.pid) { Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue } else { $null }
  [pscustomobject]@{
    Name = $entry.name
    Pid = $entry.pid
    Running = [bool]$proc
    Log = $entry.log
  }
}

$rows | Format-Table -AutoSize
if ($env:CR_DEV_FRONTEND_URL) {
  Write-Host "Frontend: $env:CR_DEV_FRONTEND_URL"
}
if ($env:CR_DEV_LOG_DIR) {
  Write-Host "Logs: $env:CR_DEV_LOG_DIR"
}
