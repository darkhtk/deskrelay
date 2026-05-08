[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$RepoRoot = "",
  [switch]$RemoveRepo
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

function Remove-GeneratedFiles {
  param([string]$Repo)
  foreach ($name in @(
    "DESKRELAY-SERVER-CODE.txt",
    "REGISTER-OTHER-PC.txt",
    "REMOVE-OTHER-PC.txt",
    "REMOVE-DESKRELAY-SERVER.txt"
  )) {
    $path = Join-Path $Repo $name
    if (Test-Path -LiteralPath $path) {
      Remove-Item -Force -LiteralPath $path
      Write-Host "Removed generated file: $path"
    }
  }
}

function Remove-RepoIfRequested {
  param([string]$Repo)
  if (-not $RemoveRepo) {
    return
  }
  $full = [System.IO.Path]::GetFullPath($Repo)
  $home = [System.IO.Path]::GetFullPath($HOME)
  $leaf = Split-Path -Leaf $full
  if ($leaf -ne "deskrelay" -or -not $full.StartsWith($home, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove repo outside `$HOME\deskrelay: $full"
  }
  Set-Location -LiteralPath $home
  Remove-Item -Recurse -Force -LiteralPath $full
  Write-Host "Removed repo folder: $full"
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $Root -Repo $repo
$envFile = Join-Path $root "dev.env.ps1"

try {
  & (Join-Path $repo "scripts\dev-local-stop.ps1") -NasRoot $root -RepoRoot $repo
} catch {
  throw "Could not stop DeskRelay self server cleanly. $($_.Exception.Message)"
}

if (Test-Path -LiteralPath $envFile) {
  . $envFile
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    Set-Location -LiteralPath $repo
    try {
      bun run packages/pc-connector-daemon/src/bin.ts uninstall
    } catch {
      Write-Warning "Isolated server connector cleanup failed: $($_.Exception.Message)"
    }
  }
}

if (Test-Path -LiteralPath $root) {
  Remove-Item -Recurse -Force -LiteralPath $root
  Write-Host "Removed self server state: $root"
} else {
  Write-Host "Self server state already absent: $root"
}

Remove-GeneratedFiles -Repo $repo
Remove-RepoIfRequested -Repo $repo
Write-Host "DeskRelay self server uninstall finished."
