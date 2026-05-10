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

function Quote-PsString {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
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

function Get-PreferredUrl {
  param([object[]]$Urls)
  $tailscale = $Urls | Where-Object { $_.Kind -eq "Tailscale" } | Select-Object -First 1
  if ($tailscale) {
    return [string]$tailscale.Url
  }
  $lan = $Urls | Where-Object { $_.Kind -eq "LAN" } | Select-Object -First 1
  if ($lan) {
    return [string]$lan.Url
  }
  return [string]$Urls[0].Url
}

function Get-LoginUrl {
  param([string]$Url, [string]$Token)
  return "$($Url.TrimEnd('/'))/#site-token=$([System.Uri]::EscapeDataString($Token))"
}

function Write-TextFile {
  param([string]$Path, [string]$Content)
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $Content.TrimStart() | Set-Content -Encoding utf8 -Path $Path
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $Root -Repo $repo
$envFile = Join-Path $root "dev.env.ps1"
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Self server env file not found: $envFile"
}

. $envFile

$siteTokenFile = if ($env:CR_SITE_TOKEN_FILE) {
  [System.IO.Path]::GetFullPath($env:CR_SITE_TOKEN_FILE)
} else {
  Join-Path $root "site-token.txt"
}
$env:CR_SITE_TOKEN | Set-Content -Encoding utf8 -Path $siteTokenFile

$frontendPort = if ($env:CR_DEV_FRONTEND_URL) {
  try { ([Uri]$env:CR_DEV_FRONTEND_URL).Port } catch { 18193 }
} else {
  18193
}
$urls = @(Get-AccessUrls -Port $frontendPort)
$preferredUrl = Get-PreferredUrl -Urls $urls
$preferredLoginUrl = Get-LoginUrl -Url $preferredUrl -Token $env:CR_SITE_TOKEN
$commandsDir = Join-Path $root "commands"
New-Item -ItemType Directory -Force -Path $commandsDir | Out-Null

$repoQ = Quote-PsString $repo
$rootQ = Quote-PsString $root
$preferredUrlQ = Quote-PsString $preferredUrl
$siteTokenQ = Quote-PsString $env:CR_SITE_TOKEN
$envFileQ = Quote-PsString $envFile
$frontendUrlQ = Quote-PsString $env:CR_DEV_FRONTEND_URL

$urlsText = ($urls | ForEach-Object { "$($_.Kind): $($_.Url)" }) -join "`r`n"

$registerOtherPc = @"
`$ErrorActionPreference = 'Stop'
`$installer = Join-Path `$env:TEMP 'deskrelay-install-connector.ps1'
Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/install-connector.ps1' -OutFile `$installer

`$workspaceRoots = Join-Path `$HOME 'Projects'
powershell -ExecutionPolicy Bypass -File `$installer -Server $preferredUrlQ -SiteToken $siteTokenQ -WorkspaceRoots `$workspaceRoots -Label `$env:COMPUTERNAME -Port 18091
"@

$removeOtherPc = @"
# DeskRelay - remove this PC from this self-host server
# Paste this whole block into PowerShell on the PC you want to remove.
# It unregisters matching device rows from this server, removes the connector
# login task, clears local connector state, and stops the connector port.
# Server URL: $preferredUrl
# Server port: $frontendPort
# Connector port: 18091
# Site token: $($env:CR_SITE_TOKEN)

`$ErrorActionPreference = 'Stop'
`$remover = Join-Path `$env:TEMP 'deskrelay-remove-connector.ps1'
Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/remove-connector.ps1' -OutFile `$remover

powershell -ExecutionPolicy Bypass -File `$remover -Server $preferredUrlQ -SiteToken $siteTokenQ -Port 18091
"@

$startServer = @"
# DeskRelay - start this PC
Set-Location -LiteralPath $repoQ
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-start.ps1 -Root $rootQ -RepoRoot $repoQ
"@

$statusServer = @"
# DeskRelay - show status, URLs, and Site token
Set-Location -LiteralPath $repoQ
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-status.ps1 -Root $rootQ -RepoRoot $repoQ
"@

$installServerAutostart = @"
# DeskRelay - enable server autostart on Windows login
Set-Location -LiteralPath $repoQ
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-autostart.ps1 -Action install -Root $rootQ -RepoRoot $repoQ
"@

$removeServerAutostart = @"
# DeskRelay - disable server autostart on Windows login
Set-Location -LiteralPath $repoQ
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-autostart.ps1 -Action remove -Root $rootQ -RepoRoot $repoQ
"@

$stopServer = @"
# DeskRelay - stop this PC server and connector
Set-Location -LiteralPath $repoQ
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-stop.ps1 -Root $rootQ -RepoRoot $repoQ
"@

$resetServer = @"
# DeskRelay - reset this PC server state
# This stops DeskRelay and deletes the self-host runtime state under:
# $root
# It does not delete the cloned git repository.

Set-Location -LiteralPath $repoQ
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-stop.ps1 -Root $rootQ -RepoRoot $repoQ
`$root = $rootQ
if (Test-Path -LiteralPath `$root) {
  Remove-Item -Recurse -Force -LiteralPath `$root
  Write-Host "Deleted `$root"
} else {
  Write-Host "Already absent: `$root"
}
"@

$uninstallServer = @"
# DeskRelay - uninstall this PC's self-host server
# While the server is still running, this first asks every registered
# connector to uninstall itself. Then it stops DeskRelay, removes
# .self-server runtime state, and removes generated command files.
# It does not delete the cloned git repository.

Set-Location -LiteralPath $repoQ
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-uninstall.ps1 -Root $rootQ -RepoRoot $repoQ
"@

$openSite = @"
# DeskRelay - URLs and token

Recommended URL:
$preferredUrl

Recommended login URL for another device:
$preferredLoginUrl

All URLs:
$urlsText

Site token:
$($env:CR_SITE_TOKEN)

Site token file:
$siteTokenFile

Browser login helper:
localStorage.setItem("cr.site-token", "$($env:CR_SITE_TOKEN)");
localStorage.removeItem("cr.site-base-url");
location.reload();
"@

$topLevelCode = @"
# DeskRelay server code
# This file is generated when the self-host server starts or when status runs.
# Keep it private. It contains the Site token for this DeskRelay server.

Open DeskRelay on this PC:
http://127.0.0.1:$frontendPort

Recommended URL for another device:
$preferredUrl

Recommended login URL for another device:
$preferredLoginUrl

All URLs:
$urlsText

Site token:
$($env:CR_SITE_TOKEN)

Full command folder:
$commandsDir

This server installs a Windows login task named "DeskRelay Self Server".
It restarts the self-host server on login without opening the browser.
Use commands\remove-server-autostart.txt if you want to disable that.

To register another PC, open this file in the DeskRelay folder root and
copy the whole PowerShell block into the PC you want to control:
REGISTER-OTHER-PC.txt

To remove a registered PC, copy the whole PowerShell block from:
REMOVE-OTHER-PC.txt

To uninstall this self-host server state from this PC:
REMOVE-DESKRELAY-SERVER.txt

The registration command handles Tailscale/LAN address detection, connector
startup, access verification, and server registration. If the server URL is a
Tailscale URL, the target PC must be logged in to the same tailnet before the
command can complete.
"@

$listDevices = @"
# DeskRelay - list registered devices
`$site = $frontendUrlQ
`$token = $siteTokenQ
Invoke-RestMethod -Method Get -Uri "`$site/api/devices" -Headers @{ Authorization = "Bearer `$token" } |
  Format-Table id,label,daemonUrl,connectionState -AutoSize
"@

$unregisterDevice = @"
# DeskRelay - unregister one device by id
# First run list-devices.txt, then paste the id here.

`$site = $frontendUrlQ
`$token = $siteTokenQ
`$deviceId = Read-Host 'Device id to unregister'
if (-not `$deviceId) {
  throw 'Device id is required.'
}
Invoke-RestMethod -Method Delete -Uri "`$site/api/devices/`$deviceId" -Headers @{ Authorization = "Bearer `$token" } | Out-Null
Write-Host "Unregistered `$deviceId"
"@

$removeThisPcConnector = @"
# DeskRelay - remove this PC connector state used by the self server
# This removes the isolated connector state under .self-server, not the git repo.

Set-Location -LiteralPath $repoQ
. $envFileQ
bun run packages/pc-connector-daemon/src/bin.ts login-task remove
bun run packages/pc-connector-daemon/src/bin.ts uninstall
"@

$showThisPcDaemonToken = @"
# DeskRelay - show this PC daemon token
Set-Location -LiteralPath $repoQ
. $envFileQ
bun run packages/pc-connector-daemon/src/bin.ts auth-token
"@

$manualOtherPc = @"
# DeskRelay - manual values for Settings -> Devices
# Use this if automatic registration fails.

DeskRelay URL:
$preferredUrl

In Settings -> Devices, add:
Daemon URL: http://<other-pc-tailscale-or-lan-ip>:18091
Daemon token: run this on the other PC:

  bun run packages/pc-connector-daemon/src/bin.ts auth-token

Start daemon manually on the other PC:

  `$env:CR_CONNECTOR_HOST = '<other-pc-tailscale-or-lan-ip>'
  `$env:CR_CONNECTOR_PORT = '18091'
  `$env:CR_CONNECTOR_WORKSPACE_ROOTS = "`$HOME\Projects"
  bun run packages/pc-connector-daemon/src/bin.ts
"@

$all = @"
# DeskRelay self-host command sheet
# Generated from:
#   Repo: $repo
#   State: $root
#   Site token file: $siteTokenFile
#
# Files in this folder:
#   open-site.txt
#   start-server.txt
#   status-server.txt
#   install-server-autostart.txt
#   remove-server-autostart.txt
#   stop-server.txt
#   reset-server.txt
#   uninstall-server.txt
#   register-other-pc.txt
#   remove-other-pc.txt
#   manual-register-other-pc.txt
#   list-devices.txt
#   unregister-device-by-id.txt
#   remove-this-pc-connector.txt
#   show-this-pc-daemon-token.txt

## Open DeskRelay

$openSite

## Register another PC

$registerOtherPc

## Server autostart

$installServerAutostart

$removeServerAutostart

## Remove this PC from server

$removeOtherPc

## Stop server

$stopServer

## Reset server

$resetServer

## Uninstall server

$uninstallServer

## List devices

$listDevices

## Unregister device by id

$unregisterDevice
"@

Write-TextFile -Path (Join-Path $commandsDir "open-site.txt") -Content $openSite
Write-TextFile -Path (Join-Path $commandsDir "start-server.txt") -Content $startServer
Write-TextFile -Path (Join-Path $commandsDir "status-server.txt") -Content $statusServer
Write-TextFile -Path (Join-Path $commandsDir "install-server-autostart.txt") -Content $installServerAutostart
Write-TextFile -Path (Join-Path $commandsDir "remove-server-autostart.txt") -Content $removeServerAutostart
Write-TextFile -Path (Join-Path $commandsDir "stop-server.txt") -Content $stopServer
Write-TextFile -Path (Join-Path $commandsDir "reset-server.txt") -Content $resetServer
Write-TextFile -Path (Join-Path $commandsDir "uninstall-server.txt") -Content $uninstallServer
Write-TextFile -Path (Join-Path $commandsDir "register-other-pc.txt") -Content $registerOtherPc
Write-TextFile -Path (Join-Path $commandsDir "remove-other-pc.txt") -Content $removeOtherPc
Write-TextFile -Path (Join-Path $commandsDir "manual-register-other-pc.txt") -Content $manualOtherPc
Write-TextFile -Path (Join-Path $commandsDir "list-devices.txt") -Content $listDevices
Write-TextFile -Path (Join-Path $commandsDir "unregister-device-by-id.txt") -Content $unregisterDevice
Write-TextFile -Path (Join-Path $commandsDir "remove-this-pc-connector.txt") -Content $removeThisPcConnector
Write-TextFile -Path (Join-Path $commandsDir "show-this-pc-daemon-token.txt") -Content $showThisPcDaemonToken
Write-TextFile -Path (Join-Path $commandsDir "deskrelay-commands.txt") -Content $all

Write-TextFile -Path (Join-Path $repo "DESKRELAY-SERVER-CODE.txt") -Content $topLevelCode
Write-TextFile -Path (Join-Path $repo "REGISTER-OTHER-PC.txt") -Content $registerOtherPc
Write-TextFile -Path (Join-Path $repo "REMOVE-OTHER-PC.txt") -Content $removeOtherPc
Write-TextFile -Path (Join-Path $repo "REMOVE-DESKRELAY-SERVER.txt") -Content $uninstallServer

Write-Host "Command files: $commandsDir"
Write-Host "Top-level quick files:"
Write-Host "  $(Join-Path $repo 'DESKRELAY-SERVER-CODE.txt')"
Write-Host "  $(Join-Path $repo 'REGISTER-OTHER-PC.txt')"
Write-Host "  $(Join-Path $repo 'REMOVE-OTHER-PC.txt')"
Write-Host "  $(Join-Path $repo 'REMOVE-DESKRELAY-SERVER.txt')"
