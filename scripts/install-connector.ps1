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
$script:InstallSteps = @()
$script:InstallReportPath = ""

function Get-DefaultInstallReportPath {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $base = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "DeskRelay\reports"
  } else {
    Join-Path $HOME ".deskrelay\reports"
  }
  New-Item -ItemType Directory -Force -Path $base | Out-Null
  return Join-Path $base "connector-install-$stamp.json"
}

function Add-InstallStep {
  param(
    [string]$Id,
    [string]$Label,
    [ValidateSet("ok", "warn", "failed", "skipped", "repaired")]
    [string]$Status,
    [string]$Summary,
    [string[]]$Evidence = @(),
    [string]$Action = "",
    [string]$Severity = "",
    [string]$Source = "installer",
    [bool]$RetrySafe = $false
  )
  if ([string]::IsNullOrWhiteSpace($Severity)) {
    $Severity = switch ($Status) {
      "failed" { "error" }
      "warn" { "warn" }
      "repaired" { "warn" }
      "running" { "unknown" }
      default { "ok" }
    }
  }
  $row = [ordered]@{
    id = $Id
    label = $Label
    status = $Status
    severity = $Severity
    summary = $Summary
    source = $Source
  }
  if ($Evidence.Count -gt 0) {
    $row.evidence = @($Evidence)
  }
  if (-not [string]::IsNullOrWhiteSpace($Action)) {
    $row.action = $Action
  }
  if ($RetrySafe) {
    $row.retrySafe = $true
  }
  $script:InstallSteps += [pscustomobject]$row
}

function Save-InstallReport {
  param([ValidateSet("succeeded", "failed")][string]$Status)
  if ([string]::IsNullOrWhiteSpace($script:InstallReportPath)) {
    $script:InstallReportPath = Get-DefaultInstallReportPath
  }
  $failedCount = @($script:InstallSteps | Where-Object { $_.status -eq "failed" }).Count
  $warnCount = @($script:InstallSteps | Where-Object { $_.status -eq "warn" }).Count
  $report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    status = if ($failedCount -gt 0) { "failed" } else { $Status }
    failed = $failedCount
    warnings = $warnCount
    server = $Server
    repo = $Repo
    repoUrl = $RepoUrl
    port = $Port
    workspaceRoots = $WorkspaceRoots
    label = $Label
    steps = @($script:InstallSteps)
  }
  $dir = Split-Path -Parent $script:InstallReportPath
  if ($dir) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -Path $script:InstallReportPath
}

function Fail-Install {
  param(
    [string]$Id,
    [string]$Label,
    [string]$Summary,
    [string[]]$Evidence = @(),
    [string]$Action = "",
    [bool]$RetrySafe = $true
  )
  Add-InstallStep -Id $Id -Label $Label -Status "failed" -Summary $Summary -Evidence $Evidence -Action $Action -RetrySafe:$RetrySafe
  throw $Summary
}

trap {
  $message = $_.Exception.Message
  if (-not ($script:InstallSteps | Where-Object { $_.status -eq "failed" } | Select-Object -First 1)) {
    Add-InstallStep -Id "installer-error" -Label "installer" -Status "failed" -Summary $message -Action "Fix the reported condition and run the same registration command again." -RetrySafe:$true
  }
  Save-InstallReport -Status "failed"
  Write-Host "installer report: $script:InstallReportPath"
  break
}

function Require-Command {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail-Install -Id "require-$Name" -Label $Name -Summary "$Name is required." -Action $Hint
  }
  Add-InstallStep -Id "require-$Name" -Label $Name -Status "ok" -Summary "$Name command is available"
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
    Fail-Install `
      -Id "server-url-local-only" `
      -Label "server URL" `
      -Summary "The DeskRelay server URL is local-only ($serverHost)." `
      -Evidence @("serverHost=$serverHost", "serverUrl=$ServerUrl") `
      -Action "Open DESKRELAY-SERVER-CODE.txt on the server PC and copy the Tailscale or LAN URL, then run registration again."
  }
  $tailscaleIp = Get-TailscaleIp
  if (Test-IsTailscaleHost -HostName $serverHost) {
    if (-not $tailscaleIp) {
      Fail-Install `
        -Id "tailscale-missing" `
        -Label "Tailscale" `
        -Summary "DeskRelay server is being reached through Tailscale ($serverHost), but this PC has no Tailscale IPv4 address." `
        -Evidence @("serverHost=$serverHost", "tailscaleIp=missing") `
        -Action "Install Tailscale, log in to the same tailnet as the server PC, then run this registration command again."
    }
    Add-InstallStep -Id "advertise-host" -Label "advertised connector address" -Status "ok" -Summary "selected Tailscale address $tailscaleIp" -Evidence @("serverHost=$serverHost")
    return [PSCustomObject]@{ Host = $tailscaleIp; Kind = "Tailscale" }
  }

  $lanIp = Get-LanIp -ServerHost $serverHost
  if ($lanIp) {
    Add-InstallStep -Id "advertise-host" -Label "advertised connector address" -Status "ok" -Summary "selected LAN address $lanIp" -Evidence @("serverHost=$serverHost")
    return [PSCustomObject]@{ Host = $lanIp; Kind = "LAN" }
  }
  if ($tailscaleIp) {
    Add-InstallStep -Id "advertise-host" -Label "advertised connector address" -Status "ok" -Summary "selected fallback Tailscale address $tailscaleIp" -Evidence @("serverHost=$serverHost")
    return [PSCustomObject]@{ Host = $tailscaleIp; Kind = "Tailscale" }
  }

  Fail-Install `
    -Id "advertise-host-missing" `
    -Label "advertised connector address" `
    -Summary "Could not detect an externally reachable LAN or Tailscale IPv4 address for this PC." `
    -Evidence @("serverHost=$serverHost") `
    -Action "Connect this PC to the same LAN or Tailscale tailnet as the DeskRelay server, then run registration again."
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
    Add-InstallStep -Id "firewall" -Label "Windows Firewall" -Status "warn" -Summary "not elevated; firewall rule was not changed" -Evidence @("admin=false", "port=$Port") -Action "If advertised daemon verification fails, rerun PowerShell as Administrator or allow inbound TCP $Port." -RetrySafe:$true
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
    Add-InstallStep -Id "firewall" -Label "Windows Firewall" -Status "ok" -Summary "inbound TCP $Port is allowed" -Evidence @("port=$Port")
  } catch {
    Write-Warning "Could not update Windows Firewall automatically: $($_.Exception.Message)"
    Add-InstallStep -Id "firewall" -Label "Windows Firewall" -Status "warn" -Summary "could not update firewall rule" -Evidence @("port=$Port", $_.Exception.Message) -Action "Allow inbound TCP $Port manually if advertised daemon verification fails." -RetrySafe:$true
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
  if ($pids.Count -eq 0) {
    Add-InstallStep -Id "stale-process-cleanup" -Label "stale connector cleanup" -Status "ok" -Summary "no stale connector process found on TCP $Port"
  }
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
    Fail-Install `
      -Id "stale-port" `
      -Label "stale connector cleanup" `
      -Summary "TCP $Port is still held by process id(s): $($remaining -join ', ')." `
      -Evidence @("port=$Port", "pids=$($remaining -join ',')") `
      -Action "Close those processes or rerun PowerShell as Administrator, then run this registration command again."
  }
  if ($pids.Count -gt 0) {
    Add-InstallStep -Id "stale-process-cleanup" -Label "stale connector cleanup" -Status "repaired" -Summary "stopped stale process id(s): $($pids -join ', ')"
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
  Add-InstallStep -Id "repo-backup" -Label "DeskRelay repo" -Status "repaired" -Summary $Reason -Evidence @("backup=$backup")
  Set-Location -LiteralPath (Split-Path -Parent $Path)
  Move-Item -LiteralPath $Path -Destination $backup
}

function Clone-Fresh {
  param([string]$Url, [string]$Path)
  Invoke-Native "git" @("clone", $Url, $Path)
  Set-Location -LiteralPath $Path
  Add-InstallStep -Id "repo" -Label "DeskRelay repo" -Status "repaired" -Summary "cloned fresh repo" -Evidence @("path=$Path", "origin=$Url")
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
    Add-InstallStep -Id "repo" -Label "DeskRelay repo" -Status "ok" -Summary "repo is clean and up to date" -Evidence @("path=$Path", "origin=$Url")
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
Add-InstallStep -Id "dependencies" -Label "dependencies" -Status "ok" -Summary "bun install completed"
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
Add-InstallStep -Id "register-self" -Label "connector registration" -Status "ok" -Summary "register-self completed"

$verifier = Join-Path $Repo "scripts\self-verify-connector.ps1"
if (Test-Path -LiteralPath $verifier) {
  Invoke-Native "powershell" @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $verifier,
    "-Server",
    $serverUrl,
    "-SiteToken",
    $SiteToken,
    "-Repo",
    $Repo,
    "-Port",
    [string]$Port,
    "-DaemonUrl",
    "http://$($endpoint.Host):$Port",
    "-WorkspaceRoots",
    $WorkspaceRoots,
    "-Label",
    $Label
  )
  Add-InstallStep -Id "verification" -Label "connector verification" -Status "ok" -Summary "self-verify-connector completed"
} else {
  Write-Warning "Connector verifier not found: $verifier"
  Add-InstallStep -Id "verification" -Label "connector verification" -Status "warn" -Summary "self-verify-connector was not found" -Evidence @($verifier)
}

Write-Host "External connector URL verified: http://$($endpoint.Host):$Port"
Write-Host "Registered $Label with DeskRelay server: $serverUrl"
Save-InstallReport -Status "succeeded"
Write-Host "installer report: $script:InstallReportPath"
Open-DeskRelaySite -ServerUrl $serverUrl -Token $SiteToken
