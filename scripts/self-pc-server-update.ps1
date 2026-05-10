[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$RepoRoot = "",
  [string]$Branch = "main",
  [string]$LogPath = "",
  [switch]$NoOpenBrowser
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
    $Path = Join-Path $Repo ".self-server"
  }
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $Root -Repo $repo

if ($LogPath) {
  $logParent = Split-Path -Parent $LogPath
  if ($logParent) {
    New-Item -ItemType Directory -Force -Path $logParent | Out-Null
  }
  Start-Transcript -Path $LogPath -Append | Out-Null
}

try {
  Set-Location -LiteralPath $repo
  Write-Host "DeskRelay self server update"
  Write-Host "Repo: $repo"
  Write-Host "State root: $root"
  Write-Host "Branch: $Branch"

  & git fetch origin $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "git fetch failed with exit code $LASTEXITCODE"
  }

  $dirty = (& git status --porcelain --untracked-files=no)
  if ($dirty) {
    throw "Cannot update while tracked files have local changes. Commit or stash them, then retry."
  }

  & git pull --ff-only origin $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "git pull --ff-only failed with exit code $LASTEXITCODE"
  }

  & bun install
  if ($LASTEXITCODE -ne 0) {
    throw "bun install failed with exit code $LASTEXITCODE"
  }

  & (Join-Path $repo "scripts\self-pc-server-stop.ps1") -Root $root -RepoRoot $repo
  Start-Sleep -Seconds 1

  $startArgs = @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $repo "scripts\self-pc-server-start.ps1"),
    "-Root",
    $root,
    "-RepoRoot",
    $repo
  )
  if ($NoOpenBrowser) {
    $startArgs += "-NoOpenBrowser"
  }
  & powershell @startArgs
  if ($LASTEXITCODE -ne 0) {
    throw "self-pc-server-start failed with exit code $LASTEXITCODE"
  }

  Write-Host "DeskRelay self server update complete."
} finally {
  if ($LogPath) {
    Stop-Transcript | Out-Null
  }
}
