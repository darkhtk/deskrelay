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

function Invoke-RegisteredDeviceCleanup {
  param([string]$SiteUrl, [string]$Token)
  if ([string]::IsNullOrWhiteSpace($SiteUrl) -or [string]::IsNullOrWhiteSpace($Token)) {
    Write-Warning "Skipping registered connector cleanup because server URL or Site token is missing."
    return
  }
  $site = $SiteUrl.TrimEnd("/")
  $headers = @{ Authorization = "Bearer $Token" }
  try {
    $devices = @(Invoke-RestMethod -Method Get -Uri "$site/api/devices" -Headers $headers -TimeoutSec 10)
    if ($devices.Count -eq 0) {
      Write-Host "No registered devices to clean up."
      return
    }
    Write-Host "Requesting local uninstall on $($devices.Count) registered device(s)..."
    $result = Invoke-RestMethod -Method Delete -Uri "$site/api/devices" -Headers $headers -TimeoutSec 90
    $cleanup = @($result.cleanup)
    $failed = @($cleanup | Where-Object { -not $_.cleanup.ok })
    foreach ($entry in $cleanup) {
      $status = if ($entry.cleanup.ok) { "ok" } else { "failed" }
      Write-Host "  $status - $($entry.label) $($entry.daemonUrl)"
    }
    if ($failed.Count -gt 0) {
      Write-Warning "Some registered devices were removed from the server but did not confirm local uninstall. Offline PCs must be cleaned manually if needed."
    }
  } catch {
    Write-Warning "Could not request registered connector cleanup before server uninstall. $($_.Exception.Message)"
  }
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $Root -Repo $repo
$envFile = Join-Path $root "dev.env.ps1"

$autostartScript = Join-Path $repo "scripts\self-pc-server-autostart.ps1"
if (Test-Path -LiteralPath $autostartScript) {
  try {
    & $autostartScript -Action remove -Root $root -RepoRoot $repo
  } catch {
    Write-Warning "Could not remove self server autostart: $($_.Exception.Message)"
  }
}

if (Test-Path -LiteralPath $envFile) {
  . $envFile
  Invoke-RegisteredDeviceCleanup -SiteUrl $env:CR_DEV_SITE_URL -Token $env:CR_SITE_TOKEN
}

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
