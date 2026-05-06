[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$RepoRoot = "",
  [string]$SiteToken = "",
  [int]$SitePort = 18192,
  [int]$FrontendPort = 18193,
  [int]$DaemonPort = 18191,
  [string]$WorkspaceRoots = "",
  [switch]$ForceInit,
  [switch]$NoRegisterDevice
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

function New-UrlSafeToken {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Get-PreferredWorkspaceRoots {
  $projects = Join-Path $HOME "Projects"
  if (Test-Path -LiteralPath $projects) {
    return [System.IO.Path]::GetFullPath($projects)
  }
  return [System.IO.Path]::GetFullPath($HOME)
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
$envFile = Join-Path $root "dev.env.ps1"

if (-not (Test-Path $envFile) -or $ForceInit) {
  if ([string]::IsNullOrWhiteSpace($SiteToken)) {
    $SiteToken = if ($env:CR_SITE_TOKEN) { $env:CR_SITE_TOKEN } else { New-UrlSafeToken }
  }
  if ([string]::IsNullOrWhiteSpace($WorkspaceRoots)) {
    $WorkspaceRoots = Get-PreferredWorkspaceRoots
  }
  & (Join-Path $repo "scripts\nas-dev-init.ps1") `
    -NasRoot $root `
    -RepoRoot $repo `
    -SiteToken $SiteToken `
    -SitePort $SitePort `
    -FrontendPort $FrontendPort `
    -DaemonPort $DaemonPort `
    -SiteHost "127.0.0.1" `
    -ConnectorHost "127.0.0.1" `
    -FrontendUrlHost "127.0.0.1" `
    -DaemonUrlHost "127.0.0.1" `
    -WorkspaceRoots $WorkspaceRoots `
    -Force
} else {
  Write-Host "Keeping existing self server root: $root"
}

& (Join-Path $repo "scripts\dev-local-start.ps1") `
  -NasRoot $root `
  -RepoRoot $repo `
  -SitePort $SitePort `
  -FrontendPort $FrontendPort `
  -DaemonPort $DaemonPort `
  -FrontendHost "0.0.0.0" `
  -NoRegisterDevice:$NoRegisterDevice

. $envFile

$commandsScript = Join-Path $repo "scripts\write-self-commands.ps1"
if (Test-Path -LiteralPath $commandsScript) {
  & $commandsScript -Root $root -RepoRoot $repo
}

Write-Host ""
Write-Host "DeskRelay self PC server URLs:"
Get-AccessUrls -Port $FrontendPort | Format-Table -AutoSize
Write-Host "Site token: $env:CR_SITE_TOKEN"
Write-Host "State root: $root"
Write-Host "Workspace roots: $env:CR_CONNECTOR_WORKSPACE_ROOTS"
Write-Host "Command files: $(Join-Path $root 'commands')"
Write-Host ""
Write-Host "Use Tailscale or LAN URLs only. Do not expose connector ports to the public internet."
