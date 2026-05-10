[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$RepoRoot = ""
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

function Get-AccessUrls {
  param([int]$Port)
  $rows = @()
  $rows += [pscustomobject]@{ Kind = "This PC"; Url = "http://127.0.0.1:$Port" }
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.PrefixOrigin -ne "WellKnown" -and
      $_.IPAddress -notlike "169.254.*"
    } |
    Sort-Object @{ Expression = { if ($_.InterfaceAlias -like "*Tailscale*") { 0 } else { 1 } } }, InterfaceAlias)
  foreach ($address in $addresses) {
    $kind = if ($address.InterfaceAlias -like "*Tailscale*") { "Tailscale" } else { "LAN" }
    $rows += [pscustomobject]@{ Kind = $kind; Url = "http://$($address.IPAddress):$Port" }
  }
  return $rows
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $Root -Repo $repo
& (Join-Path $repo "scripts\dev-local-status.ps1") -NasRoot $root -RepoRoot $repo

$envFile = Join-Path $root "dev.env.ps1"
if (Test-Path $envFile) {
  . $envFile
  $commandsScript = Join-Path $repo "scripts\write-self-commands.ps1"
  if (Test-Path -LiteralPath $commandsScript) {
    & $commandsScript -Root $root -RepoRoot $repo
  }
  $frontendPort = if ($env:CR_DEV_FRONTEND_URL) {
    try { ([Uri]$env:CR_DEV_FRONTEND_URL).Port } catch { 18193 }
  } else {
    18193
  }
  Write-Host ""
  Write-Host "DeskRelay self PC server URLs:"
  Get-AccessUrls -Port $frontendPort | Format-Table -AutoSize
  Write-Host "Site token: $env:CR_SITE_TOKEN"
  Write-Host "Command files: $(Join-Path $root 'commands')"
}

$autostartScript = Join-Path $repo "scripts\self-pc-server-autostart.ps1"
if (Test-Path -LiteralPath $autostartScript) {
  & $autostartScript -Action status -Root $root -RepoRoot $repo
}
