[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$SiteToken,

  [string]$Repo = "",
  [int]$Port = 18091,
  [string]$Label = "",
  [switch]$SkipServerUnregister,
  [switch]$RemoveRepo
)

$ErrorActionPreference = "Stop"

function Invoke-NativeOptional {
  param([string]$Command, [string[]]$Arguments)
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    return $false
  }
  & $Command @Arguments
  return $LASTEXITCODE -eq 0
}

function Get-ServerBaseUrl {
  param([string]$Url)
  try {
    $uri = [Uri]$Url
  } catch {
    throw "Invalid DeskRelay server URL: $Url"
  }
  if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") {
    throw "DeskRelay server URL must be http:// or https://"
  }
  return $Url.TrimEnd("/")
}

function Get-UrlHost {
  param([string]$Url)
  try {
    return ([Uri]$Url).DnsSafeHost.Trim("[", "]")
  } catch {
    return ""
  }
}

function Test-IsLocalHost {
  param([string]$HostName)
  return $HostName -eq "localhost" -or $HostName -eq "127.0.0.1" -or $HostName -eq "::1"
}

function Test-IsTailscaleHost {
  param([string]$HostName)
  return $HostName -match "^100\." -or $HostName -like "*.ts.net"
}

function Get-TailscaleIps {
  $ips = @()
  $ips += @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -like "*Tailscale*" -and $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress)

  $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($tailscale) {
    $out = & $tailscale.Source ip -4 2>$null
    if ($LASTEXITCODE -eq 0) {
      $ips += @($out | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
    }
  }
  return @($ips | Where-Object { $_ } | Sort-Object -Unique)
}

function Get-RouteLocalIp {
  param([string]$RemoteHost)
  if (-not $RemoteHost -or (Test-IsLocalHost -HostName $RemoteHost)) {
    return ""
  }
  try {
    $addresses = [System.Net.Dns]::GetHostAddresses($RemoteHost) |
      Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork }
    foreach ($address in $addresses) {
      $udp = [System.Net.Sockets.UdpClient]::new()
      try {
        $udp.Connect($address, 9)
        $local = $udp.Client.LocalEndPoint
        if ($local -and $local.Address) {
          $value = $local.Address.ToString()
          if ($value -and $value -notlike "127.*" -and $value -notlike "169.254.*") {
            return $value
          }
        }
      } finally {
        $udp.Dispose()
      }
    }
  } catch {
    return ""
  }
  return ""
}

function Get-LanIps {
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InterfaceAlias -notlike "*Tailscale*" -and
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*"
    } |
    Select-Object -ExpandProperty IPAddress)
  return @($ips | Where-Object { $_ } | Sort-Object -Unique)
}

function Format-HostForUrl {
  param([string]$HostName)
  if ($HostName -like "*:*" -and -not $HostName.StartsWith("[")) {
    return "[$HostName]"
  }
  return $HostName
}

function Get-CandidateDaemonUrls {
  param([string]$ServerUrl, [int]$DaemonPort)
  $serverHost = Get-UrlHost -Url $ServerUrl
  $hosts = @()
  if (Test-IsTailscaleHost -HostName $serverHost) {
    $hosts += @(Get-TailscaleIps)
  }
  $routeIp = Get-RouteLocalIp -RemoteHost $serverHost
  if ($routeIp) {
    $hosts += $routeIp
  }
  $hosts += @(Get-TailscaleIps)
  $hosts += @(Get-LanIps)
  $hosts += "127.0.0.1"

  return @($hosts |
    Where-Object { $_ } |
    Sort-Object -Unique |
    ForEach-Object { "http://$(Format-HostForUrl $_):$DaemonPort" })
}

function Remove-ServerDeviceRows {
  param(
    [string]$ServerUrl,
    [string]$Token,
    [int]$DaemonPort,
    [string]$DeviceLabel
  )
  $devicesUrl = "$ServerUrl/api/devices"
  $headers = @{ Authorization = "Bearer $Token" }
  $devices = @(Invoke-RestMethod -Method Get -Uri $devicesUrl -Headers $headers -TimeoutSec 15)
  $candidateUrls = @(Get-CandidateDaemonUrls -ServerUrl $ServerUrl -DaemonPort $DaemonPort)
  $labelCandidates = @()
  if ($DeviceLabel) {
    $labelCandidates += $DeviceLabel
  }
  if ($env:COMPUTERNAME) {
    $labelCandidates += $env:COMPUTERNAME
  }
  $labelCandidates = @($labelCandidates | Where-Object { $_ } | Sort-Object -Unique)

  $matchedDevices = @($devices | Where-Object {
    $candidateUrls -contains $_.daemonUrl -or
    ($labelCandidates.Count -gt 0 -and $labelCandidates -contains $_.label)
  })

  if ($matchedDevices.Count -eq 0) {
    Write-Host "No server device row matched this PC. Already unregistered."
    Write-Host "Checked daemon URLs:"
    foreach ($url in $candidateUrls) {
      Write-Host "  $url"
    }
    return 0
  }

  foreach ($device in $matchedDevices) {
    $id = [string]$device.id
    if (-not $id) {
      continue
    }
    Invoke-RestMethod -Method Delete -Uri "$devicesUrl/$([Uri]::EscapeDataString($id))" -Headers $headers -TimeoutSec 15 | Out-Null
    Write-Host "Unregistered $($device.label) at $($device.daemonUrl)"
  }
  return $matchedDevices.Count
}

function Stop-WindowsLoginTask {
  param([string]$TaskName = "DeskRelay Connector")
  if ($env:OS -notlike "*Windows*") {
    return
  }
  try {
    schtasks.exe /End /TN $TaskName 2>$null | Out-Null
  } catch {
    # Best effort.
  }
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Host "Removed login task: $TaskName"
      return
    }
  } catch {
    # Fall through to schtasks.
  }
  try {
    schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
  } catch {
    # Already absent or unsupported.
  }
}

function Stop-PortOwner {
  param([int]$DaemonPort)
  $listeners = @(Get-NetTCPConnection -LocalPort $DaemonPort -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $owner = [int]$listener.OwningProcess
    if (-not $owner -or $owner -eq $PID) {
      continue
    }
    try {
      Stop-Process -Id $owner -Force -ErrorAction Stop
      Write-Host "Stopped connector listener on port $DaemonPort pid=$owner"
    } catch {
      Write-Warning "Could not stop connector listener pid=${owner}: $($_.Exception.Message)"
    }
  }
}

function Clear-UserConnectorEnv {
  foreach ($name in @(
    "CR_CONNECTOR_HOST",
    "CR_CONNECTOR_PORT",
    "CR_CONNECTOR_WORKSPACE_ROOTS",
    "CR_CONNECTOR_STATE_DIR",
    "CR_CONNECTOR_STATE_FILE",
    "CR_CONNECTOR_AUTH_FILE",
    "CR_IDENTITY_DIR"
  )) {
    [Environment]::SetEnvironmentVariable($name, $null, "User")
  }
}

function Remove-LocalStateDirs {
  $dirs = @()
  if ($env:LOCALAPPDATA) {
    $dirs += (Join-Path $env:LOCALAPPDATA "DeskRelay")
  }
  foreach ($dir in $dirs) {
    if (Test-Path -LiteralPath $dir) {
      Remove-Item -Recurse -Force -LiteralPath $dir
      Write-Host "Removed local connector state: $dir"
    }
  }
}

function Remove-RepoIfRequested {
  param([string]$Path)
  if (-not $RemoveRepo) {
    return
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $full = [System.IO.Path]::GetFullPath($Path)
  $home = [System.IO.Path]::GetFullPath($HOME)
  $leaf = Split-Path -Leaf $full
  if ($leaf -ne "deskrelay" -or -not $full.StartsWith($home, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove repo outside `$HOME\deskrelay: $full"
  }
  Set-Location -LiteralPath $home
  Remove-Item -Recurse -Force -LiteralPath $full
  Write-Host "Removed repo folder: $full"
}

function Invoke-RepoCleanup {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bun) {
    return $false
  }
  Set-Location -LiteralPath $Path
  try {
    bun run packages/pc-connector-daemon/src/bin.ts login-task remove
  } catch {
    Write-Warning "CLI login-task cleanup failed: $($_.Exception.Message)"
  }
  $uninstallOk = $false
  try {
    bun run packages/pc-connector-daemon/src/bin.ts uninstall
    $uninstallOk = $true
  } catch {
    Write-Warning "CLI uninstall cleanup failed: $($_.Exception.Message)"
  }
  return $uninstallOk
}

$serverUrl = Get-ServerBaseUrl -Url $Server
if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = Join-Path $HOME "deskrelay"
}

$serverError = $null
if (-not $SkipServerUnregister) {
  try {
    Remove-ServerDeviceRows -ServerUrl $serverUrl -Token $SiteToken -DaemonPort $Port -DeviceLabel $Label | Out-Null
  } catch {
    $serverError = $_.Exception.Message
    Write-Warning "Server unregister failed; local cleanup will still run. $serverError"
  }
}

$usedRepoCleanup = Invoke-RepoCleanup -Path $Repo
if (-not $usedRepoCleanup) {
  Stop-WindowsLoginTask
  Remove-LocalStateDirs
}
Stop-PortOwner -DaemonPort $Port
Clear-UserConnectorEnv
Remove-RepoIfRequested -Path $Repo

if ($serverError) {
  throw "DeskRelay connector was cleaned locally, but server unregister did not complete: $serverError"
}

Write-Host "DeskRelay connector removal finished."
