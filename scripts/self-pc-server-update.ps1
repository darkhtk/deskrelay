[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$RepoRoot = "",
  [string]$Branch = "",
  [string]$LogPath = "",
  [string]$StatusPath = "",
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

function Get-CurrentGitBranch {
  param([string]$Repo)
  Push-Location -LiteralPath $Repo
  try {
    $branch = (& git branch --show-current 2>$null)
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($branch)) {
      return $branch.Trim()
    }
    $branch = (& git rev-parse --abbrev-ref HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($branch)) {
      $branch = $branch.Trim()
      if ($branch -ne "HEAD") {
        return $branch
      }
    }
  } finally {
    Pop-Location
  }
  return "main"
}

function Write-UpdateStatus {
  param(
    [string]$State,
    [string]$StatusPath,
    [string]$StartedAt,
    [string]$CompletedAt = "",
    [string]$LogPath = "",
    [string]$Before = "",
    [string]$After = "",
    [bool]$Changed = $false,
    [string]$ErrorMessage = ""
  )
  if (-not $StatusPath) {
    return
  }
  $parent = Split-Path -Parent $StatusPath
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $payload = [ordered]@{
    state = $State
  }
  if ($StartedAt) { $payload.startedAt = $StartedAt }
  if ($CompletedAt) { $payload.completedAt = $CompletedAt }
  if ($LogPath) { $payload.logPath = $LogPath }
  if ($State -eq "running") { $payload.pid = $PID }
  if ($Before) { $payload.before = $Before }
  if ($After) { $payload.after = $After }
  if ($State -ne "running") { $payload.changed = $Changed }
  if ($ErrorMessage) { $payload.error = $ErrorMessage }
  $payload | ConvertTo-Json -Depth 4 | Set-Content -Path $StatusPath -Encoding utf8
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $Root -Repo $repo
if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = Get-CurrentGitBranch -Repo $repo
}
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$before = ""
$after = ""

if ($LogPath) {
  $logParent = Split-Path -Parent $LogPath
  if ($logParent) {
    New-Item -ItemType Directory -Force -Path $logParent | Out-Null
  }
  Start-Transcript -Path $LogPath -Append | Out-Null
}

try {
  Write-UpdateStatus -State "running" -StatusPath $StatusPath -StartedAt $startedAt -LogPath $LogPath

  Set-Location -LiteralPath $repo
  Write-Host "DeskRelay self server update"
  Write-Host "Repo: $repo"
  Write-Host "State root: $root"
  Write-Host "Branch: $Branch"

  $before = (& git rev-parse --short HEAD 2>$null)
  if ($before) { $before = $before.Trim() }

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

  $after = (& git rev-parse --short HEAD 2>$null)
  if ($after) { $after = $after.Trim() }

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
  Write-UpdateStatus `
    -State "succeeded" `
    -StatusPath $StatusPath `
    -StartedAt $startedAt `
    -CompletedAt (Get-Date).ToUniversalTime().ToString("o") `
    -LogPath $LogPath `
    -Before $before `
    -After $after `
    -Changed ($before -ne $after)
} catch {
  Write-UpdateStatus `
    -State "failed" `
    -StatusPath $StatusPath `
    -StartedAt $startedAt `
    -CompletedAt (Get-Date).ToUniversalTime().ToString("o") `
    -LogPath $LogPath `
    -Before $before `
    -After $after `
    -Changed ($before -ne $after) `
    -ErrorMessage $_.Exception.Message
  throw
} finally {
  if ($LogPath) {
    Stop-Transcript | Out-Null
  }
}
