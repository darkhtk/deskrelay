[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$SiteToken,

  [string]$WorkspaceRoots = "",
  [string]$Label = "",
  [string]$Repo = "",
  [string]$RepoUrl = "https://github.com/darkhtk/deskrelay.git",
  [int]$Port = 18091,
  [switch]$NoOpenBrowser
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $Hint"
  }
}

function Invoke-Native {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-DeskRelayOpenUrl {
  param([string]$ServerUrl, [string]$Token)
  return "$($ServerUrl.TrimEnd('/'))/#site-token=$([System.Uri]::EscapeDataString($Token))"
}

function Open-DeskRelaySite {
  param([string]$ServerUrl, [string]$Token)
  $openUrl = Get-DeskRelayOpenUrl -ServerUrl $ServerUrl -Token $Token
  if ($NoOpenBrowser) {
    Write-Host "Open DeskRelay with Site token already embedded: $openUrl"
    return
  }
  try {
    Start-Process $openUrl
    Write-Host "Opened DeskRelay with Site token already embedded: $ServerUrl"
  } catch {
    Write-Host "Could not open the browser automatically."
    Write-Host "Open DeskRelay with Site token already embedded: $openUrl"
  }
}

function Get-UrlHost {
  param([string]$Url)
  try {
    return ([Uri]$Url).DnsSafeHost.Trim("[", "]")
  } catch {
    throw "Invalid DeskRelay server URL: $Url"
  }
}

function Test-IsTailscaleHost {
  param([string]$HostName)
  return $HostName -match "^100\." -or $HostName -like "*.ts.net"
}

function Test-IsLocalHost {
  param([string]$HostName)
  return $HostName -eq "localhost" -or $HostName -eq "127.0.0.1" -or $HostName -eq "::1"
}

function Get-TailscaleIp {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -like "*Tailscale*" -and $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Sort-Object InterfaceAlias |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) {
    return [string]$ip
  }

  $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($tailscale) {
    $out = & $tailscale.Source ip -4 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($out)) {
      return [string]$out.Trim()
    }
  }

  return ""
}

function Get-RouteLocalIp {
  param([string]$RemoteHost)
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

function Get-LanIp {
  param([string]$ServerHost)
  $routeIp = Get-RouteLocalIp -RemoteHost $ServerHost
  if ($routeIp -and -not (Test-IsTailscaleHost -HostName $routeIp)) {
    return $routeIp
  }

  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      -not $_.Internal -and
      $_.InterfaceAlias -notlike "*Tailscale*" -and
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*"
    } |
    Sort-Object InterfaceAlias |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) {
    return [string]$ip
  }
  return ""
}

function Select-AdvertiseEndpoint {
  param([string]$ServerUrl)
  $serverHost = Get-UrlHost -Url $ServerUrl
  if (Test-IsLocalHost -HostName $serverHost) {
    throw "The DeskRelay server URL is local-only ($serverHost). Open the server command/status file on the server PC and copy the Tailscale or LAN URL, then run registration again."
  }
  $tailscaleIp = Get-TailscaleIp
  if (Test-IsTailscaleHost -HostName $serverHost) {
    if (-not $tailscaleIp) {
      throw "DeskRelay server is being reached through Tailscale ($serverHost), but this PC has no Tailscale IPv4 address. Install Tailscale, log in to the same tailnet, then run this registration command again."
    }
    return [PSCustomObject]@{ Host = $tailscaleIp; Kind = "Tailscale" }
  }

  $lanIp = Get-LanIp -ServerHost $serverHost
  if ($lanIp) {
    return [PSCustomObject]@{ Host = $lanIp; Kind = "LAN" }
  }
  if ($tailscaleIp) {
    return [PSCustomObject]@{ Host = $tailscaleIp; Kind = "Tailscale" }
  }

  throw "Could not detect an externally reachable LAN or Tailscale IPv4 address for this PC."
}

function Test-IsAdministrator {
  if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
    return $false
  }
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Ensure-ConnectorFirewallRule {
  param([int]$Port)
  if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
    return
  }
  $name = "DeskRelay Connector $Port"
  if (-not (Test-IsAdministrator)) {
    Write-Warning "Skipped Windows Firewall setup because PowerShell is not elevated. Registration will still verify server-to-connector access and fail with a firewall hint if the port is blocked."
    return
  }
  try {
    $rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($rule) {
      Set-NetFirewallRule -DisplayName $name -Enabled True -Direction Inbound -Action Allow -Profile Any | Out-Null
    } else {
      New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
    }
    Write-Host "Windows Firewall allows inbound TCP $Port for DeskRelay."
  } catch {
    Write-Warning "Could not update Windows Firewall automatically: $($_.Exception.Message)"
  }
}

function Stop-ProcessTree {
  param([int]$ProcessId)
  if (-not $ProcessId -or $ProcessId -eq $PID) {
    return
  }
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }
  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    Write-Host "Stopped stale DeskRelay process pid=$ProcessId"
  } catch {
    Write-Warning "Could not stop stale DeskRelay process pid=${ProcessId}: $($_.Exception.Message)"
  }
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
      Write-Host "Removed stale login task: $TaskName"
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

function Get-DeskRelaySupervisorPids {
  $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $cmd = [string]$_.CommandLine
      $cmd -and (
        $cmd -like "*cr-connector-login-task.ps1*"
      )
    } |
    Select-Object -ExpandProperty ProcessId)
  return @($matches | Where-Object { $_ -and [int]$_ -ne $PID } | Sort-Object -Unique)
}

function Get-PortOwnerPids {
  param([int]$Port)
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  return @($listeners |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and [int]$_ -ne $PID })
}

function Test-PortFree {
  param([int]$Port)
  return @(Get-PortOwnerPids -Port $Port).Count -eq 0
}

function Stop-StaleConnector {
  param([int]$Port)
  Stop-WindowsLoginTask

  $pids = @()
  $pids += @(Get-DeskRelaySupervisorPids)
  $pids += @(Get-PortOwnerPids -Port $Port)
  $pids = @($pids | Where-Object { $_ } | Sort-Object -Unique)
  foreach ($processId in $pids) {
    Stop-ProcessTree -ProcessId ([int]$processId)
  }

  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortFree -Port $Port) {
      return
    }
    Start-Sleep -Milliseconds 250
  }

  $remaining = @(Get-PortOwnerPids -Port $Port)
  if ($remaining.Count -gt 0) {
    throw "TCP $Port is still held by process id(s): $($remaining -join ', '). Close those processes or rerun PowerShell as Administrator, then run this registration command again."
  }
}

function Normalize-RepoUrl {
  param([string]$Url)
  $value = $Url.Trim().TrimEnd("/")
  if ($value.EndsWith(".git")) {
    $value = $value.Substring(0, $value.Length - 4)
  }
  return $value.ToLowerInvariant()
}

function Backup-ExistingRepo {
  param([string]$Path, [string]$Reason)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = Join-Path (Split-Path -Parent $Path) "deskrelay.backup.$stamp"
  $i = 1
  while (Test-Path -LiteralPath $backup) {
    $backup = Join-Path (Split-Path -Parent $Path) "deskrelay.backup.$stamp.$i"
    $i += 1
  }
  Write-Warning "$Reason Moving existing folder to $backup"
  Set-Location -LiteralPath (Split-Path -Parent $Path)
  Move-Item -LiteralPath $Path -Destination $backup
}

function Clone-Fresh {
  param([string]$Url, [string]$Path)
  Invoke-Native "git" @("clone", $Url, $Path)
  Set-Location -LiteralPath $Path
}

function Ensure-DeskRelayRepo {
  param([string]$Path, [string]$Url)

  if (Test-Path -LiteralPath $Path) {
    if (-not (Test-Path -LiteralPath (Join-Path $Path ".git"))) {
      Backup-ExistingRepo -Path $Path -Reason "DeskRelay path exists but is not a git repository."
    }
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    Clone-Fresh -Url $Url -Path $Path
    return
  }

  Set-Location -LiteralPath $Path
  $origin = (& git config --get remote.origin.url 2>$null)
  if (
    $LASTEXITCODE -ne 0 -or
    [string]::IsNullOrWhiteSpace($origin) -or
    (Normalize-RepoUrl $origin) -ne (Normalize-RepoUrl $Url)
  ) {
    Backup-ExistingRepo -Path $Path -Reason "DeskRelay git remote is not $Url."
    Clone-Fresh -Url $Url -Path $Path
    return
  }

  $dirty = (& git status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $dirty) {
    Backup-ExistingRepo -Path $Path -Reason "DeskRelay folder has local changes or unreadable git status."
    Clone-Fresh -Url $Url -Path $Path
    return
  }

  try {
    Invoke-Native "git" @("fetch", "origin", "main")
    Invoke-Native "git" @("checkout", "main")
    Invoke-Native "git" @("pull", "--ff-only", "origin", "main")
  } catch {
    Backup-ExistingRepo -Path $Path -Reason "DeskRelay could not update cleanly."
    Clone-Fresh -Url $Url -Path $Path
  }
}

if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = Join-Path $HOME "deskrelay"
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoots)) {
  $WorkspaceRoots = Join-Path $HOME "Projects"
}
if ([string]::IsNullOrWhiteSpace($Label)) {
  $Label = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "DeskRelay PC" }
}

Require-Command "git" "Install Git for Windows, then run this command again."
Require-Command "bun" "Install Bun, then run this command again."

$serverUrl = $Server.TrimEnd("/")
$endpoint = Select-AdvertiseEndpoint -ServerUrl $serverUrl
Write-Host "DeskRelay server: $serverUrl"
Write-Host "This PC connector will listen on 0.0.0.0:$Port"
Write-Host "This PC will be registered as $($endpoint.Kind): http://$($endpoint.Host):$Port"
Ensure-ConnectorFirewallRule -Port $Port
Stop-StaleConnector -Port $Port

Ensure-DeskRelayRepo -Path $Repo -Url $RepoUrl

if (-not (Test-Path -LiteralPath $WorkspaceRoots)) {
  New-Item -ItemType Directory -Force -Path $WorkspaceRoots | Out-Null
}

Invoke-Native "bun" @("install")
Invoke-Native "bun" @(
  "run",
  "packages/pc-connector-daemon/src/bin.ts",
  "register-self",
  "--server",
  $serverUrl,
  "--site-token",
  $SiteToken,
  "--listen-host",
  "0.0.0.0",
  "--advertise-host",
  $endpoint.Host,
  "--port",
  [string]$Port,
  "--workspace-roots",
  $WorkspaceRoots,
  "--label",
  $Label
)

Write-Host "External connector URL verified: http://$($endpoint.Host):$Port"
Write-Host "Registered $Label with DeskRelay server: $serverUrl"
Open-DeskRelaySite -ServerUrl $serverUrl -Token $SiteToken
