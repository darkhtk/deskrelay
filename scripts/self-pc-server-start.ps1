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
  [switch]$NoRegisterDevice,
  [switch]$NoOpenBrowser,
  [switch]$NoAutostart
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

function Test-IsAdministrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-SiteFirewallRule {
  param([int]$Port)
  $ruleName = "DeskRelay self PC site $Port"
  try {
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
      return
    }
    if (-not (Test-IsAdministrator)) {
      Write-Warning "Windows Firewall rule is missing for DeskRelay site port $Port. Run this from an elevated PowerShell to allow external access: New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any"
      return
    }
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
    Write-Host "Allowed inbound Windows Firewall access for DeskRelay site port $Port."
  } catch {
    Write-Warning "Could not check or create Windows Firewall rule for DeskRelay site port ${Port}: $($_.Exception.Message)"
  }
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
$localFrontendUrl = "http://127.0.0.1:$FrontendPort"

$commandsScript = Join-Path $repo "scripts\write-self-commands.ps1"
if (Test-Path -LiteralPath $commandsScript) {
  & $commandsScript -Root $root -RepoRoot $repo
}

if (-not $NoAutostart) {
  $autostartScript = Join-Path $repo "scripts\self-pc-server-autostart.ps1"
  if (Test-Path -LiteralPath $autostartScript) {
    try {
      & $autostartScript -Action install -Root $root -RepoRoot $repo
    } catch {
      Write-Warning "Could not install self server autostart: $($_.Exception.Message)"
    }
  }
}

Ensure-SiteFirewallRule -Port $FrontendPort

Write-Host ""
Write-Host "DeskRelay self PC server URLs:"
Get-AccessUrls -Port $FrontendPort | Format-Table -AutoSize
Write-Host "Site token: $env:CR_SITE_TOKEN"
Write-Host "State root: $root"
Write-Host "Workspace roots: $env:CR_CONNECTOR_WORKSPACE_ROOTS"
Write-Host "Command files: $(Join-Path $root 'commands')"
Write-Host ""
Write-Host "Use Tailscale or LAN URLs only. Do not expose connector ports to the public internet."

if (-not $NoOpenBrowser) {
  $refreshedExistingBrowser = $false
  try {
    $headers = @{}
    if ($env:CR_SITE_TOKEN) {
      $headers["Authorization"] = "Bearer $env:CR_SITE_TOKEN"
    }
    $refresh = Invoke-RestMethod `
      -Method Post `
      -Uri "$localFrontendUrl/api/self/browser/refresh" `
      -Headers $headers `
      -TimeoutSec 5
    $activeClients = 0
    if ($null -ne $refresh.activeClients) {
      $activeClients = [int]$refresh.activeClients
    }
    if ($activeClients -gt 0) {
      $refreshedExistingBrowser = $true
      Write-Host "Refreshed existing DeskRelay browser tab: $localFrontendUrl"
    }
  } catch {
    $refreshedExistingBrowser = $false
  }

  if (-not $refreshedExistingBrowser) {
    try {
      Start-Process $localFrontendUrl
      Write-Host "Opened DeskRelay in the default browser: $localFrontendUrl"
    } catch {
      Write-Host "Could not open the default browser automatically. Open this URL manually: $localFrontendUrl"
    }
  }
}
