[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$SiteToken,

  [string]$Repo = "",
  [int]$Port = 18091,
  [string]$DaemonUrl = "",
  [string]$DaemonToken = "",
  [string]$WorkspaceRoots = "",
  [string]$Label = "",
  [string]$ReportPath = "",
  [switch]$SkipLoginTask
)

$ErrorActionPreference = "Stop"
$script:Steps = @()

function Add-Step {
  param(
    [string]$Id,
    [string]$Label,
    [ValidateSet("ok", "warn", "failed", "skipped")]
    [string]$Status,
    [string]$Summary,
    [string[]]$Evidence = @(),
    [string]$Action = ""
  )
  $row = [ordered]@{
    id = $Id
    label = $Label
    status = $Status
    summary = $Summary
  }
  if ($Evidence.Count -gt 0) {
    $row.evidence = @($Evidence)
  }
  if (-not [string]::IsNullOrWhiteSpace($Action)) {
    $row.action = $Action
  }
  $script:Steps += [pscustomobject]$row
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

function Join-UrlPath {
  param([string]$Base, [string]$Path)
  return "$($Base.TrimEnd('/'))/$($Path.TrimStart('/'))"
}

function Get-DefaultReportPath {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $base = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "DeskRelay\reports"
  } else {
    Join-Path $HOME ".deskrelay\reports"
  }
  New-Item -ItemType Directory -Force -Path $base | Out-Null
  return Join-Path $base "connector-verify-$stamp.json"
}

function Invoke-NativeCapture {
  param([string]$Command, [string[]]$Arguments)
  $output = & $Command @Arguments 2>&1 | Out-String
  return [pscustomobject]@{
    exitCode = $LASTEXITCODE
    output = $output.Trim()
  }
}

function Invoke-JsonGet {
  param(
    [string]$Url,
    [hashtable]$Headers = @{},
    [int]$TimeoutSec = 10
  )
  try {
    $body = Invoke-RestMethod -Method Get -Uri $Url -Headers $Headers -TimeoutSec $TimeoutSec
    return [pscustomobject]@{ ok = $true; status = 200; body = $body; error = "" }
  } catch {
    $status = 0
    try {
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $status = [int]$_.Exception.Response.StatusCode
      }
    } catch {
      $status = 0
    }
    return [pscustomobject]@{
      ok = $false
      status = $status
      body = $null
      error = $_.Exception.Message
    }
  }
}

function Convert-ToArray {
  param($Value)
  if ($null -eq $Value) {
    return @()
  }
  if ($Value -is [System.Array]) {
    return @($Value)
  }
  $props = @($Value.PSObject.Properties.Name)
  if ($props -contains "value" -and $props -contains "Count") {
    return @($Value.value)
  }
  return @($Value)
}

function Resolve-Repo {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    $Path = Join-Path $HOME "deskrelay"
  }
  return [System.IO.Path]::GetFullPath($Path)
}

function Resolve-DaemonToken {
  param([string]$Path, [string]$ExistingToken)
  if (-not [string]::IsNullOrWhiteSpace($ExistingToken)) {
    Add-Step -Id "daemon-token" -Label "daemon token" -Status "ok" -Summary "provided by caller"
    return $ExistingToken
  }
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Add-Step -Id "daemon-token" -Label "daemon token" -Status "failed" -Summary "bun command not found" -Action "Install Bun, then rerun the registration command."
    return ""
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Path "package.json"))) {
    Add-Step -Id "daemon-token" -Label "daemon token" -Status "failed" -Summary "repo package.json is missing" -Action "Run the registration command again so the repo is installed."
    return ""
  }
  Push-Location -LiteralPath $Path
  try {
    $tokenResult = Invoke-NativeCapture "bun" @("run", "packages/pc-connector-daemon/src/bin.ts", "auth-token")
  } finally {
    Pop-Location
  }
  if ($tokenResult.exitCode -ne 0) {
    Add-Step -Id "daemon-token" -Label "daemon token" -Status "failed" -Summary "could not read daemon token" -Evidence @($tokenResult.output) -Action "Check Bun and the DeskRelay repo, then rerun the registration command."
    return ""
  }
  if ($tokenResult.output -notmatch "token:\s*(\S+)") {
    Add-Step -Id "daemon-token" -Label "daemon token" -Status "failed" -Summary "daemon token output was not parseable" -Evidence @($tokenResult.output)
    return ""
  }
  Add-Step -Id "daemon-token" -Label "daemon token" -Status "ok" -Summary "loaded from local connector auth file"
  return $Matches[1]
}

function Test-LoginTask {
  if ($SkipLoginTask) {
    Add-Step -Id "login-task" -Label "Windows login task" -Status "skipped" -Summary "skipped by caller"
    return
  }
  if ($env:OS -notlike "*Windows*") {
    Add-Step -Id "login-task" -Label "Windows login task" -Status "skipped" -Summary "non-Windows shell"
    return
  }
  try {
    $task = Get-ScheduledTask -TaskName "DeskRelay Connector" -ErrorAction SilentlyContinue
    if ($task) {
      Add-Step -Id "login-task" -Label "Windows login task" -Status "ok" -Summary "DeskRelay Connector task is installed"
      return
    }
    Add-Step -Id "login-task" -Label "Windows login task" -Status "failed" -Summary "DeskRelay Connector task is not installed" -Action "Run the registration command again."
  } catch {
    Add-Step -Id "login-task" -Label "Windows login task" -Status "warn" -Summary "could not query Windows login task" -Evidence @($_.Exception.Message)
  }
}

function Test-WorkspaceRoots {
  param([string]$Roots)
  if ([string]::IsNullOrWhiteSpace($Roots)) {
    Add-Step -Id "workspace-roots" -Label "workspace roots" -Status "warn" -Summary "unrestricted workspace browsing"
    return
  }
  $missing = @()
  $existing = @()
  foreach ($root in ($Roots -split ",")) {
    $trimmed = $root.Trim()
    if (-not $trimmed) {
      continue
    }
    if (Test-Path -LiteralPath $trimmed) {
      $existing += $trimmed
    } else {
      $missing += $trimmed
    }
  }
  if ($missing.Count -gt 0) {
    Add-Step -Id "workspace-roots" -Label "workspace roots" -Status "failed" -Summary "one or more workspace roots do not exist" -Evidence $missing -Action "Create the folders or rerun registration with the intended workspace root."
    return
  }
  Add-Step -Id "workspace-roots" -Label "workspace roots" -Status "ok" -Summary "$($existing.Count) workspace root(s) exist" -Evidence $existing
}

$serverUrl = Get-ServerBaseUrl -Url $Server
$repoPath = Resolve-Repo -Path $Repo
if ([string]::IsNullOrWhiteSpace($DaemonUrl)) {
  $DaemonUrl = "http://127.0.0.1:$Port"
}
$DaemonUrl = $DaemonUrl.TrimEnd("/")
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $ReportPath = Get-DefaultReportPath
}

Add-Step -Id "input" -Label "input" -Status "ok" -Summary "server=$serverUrl daemon=$DaemonUrl repo=$repoPath"

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  Add-Step -Id "git" -Label "Git" -Status "ok" -Summary $git.Source
} else {
  Add-Step -Id "git" -Label "Git" -Status "failed" -Summary "git command not found" -Action "Install Git for Windows, then rerun the registration command."
}

$bun = Get-Command bun -ErrorAction SilentlyContinue
if ($bun) {
  Add-Step -Id "bun" -Label "Bun" -Status "ok" -Summary $bun.Source
} else {
  Add-Step -Id "bun" -Label "Bun" -Status "failed" -Summary "bun command not found" -Action "Install Bun, then rerun the registration command."
}

if ((-not $git) -and (Test-Path -LiteralPath (Join-Path $repoPath ".git"))) {
  Add-Step -Id "repo" -Label "DeskRelay repo" -Status "warn" -Summary "repo exists but git command is unavailable" -Evidence @($repoPath)
} elseif (Test-Path -LiteralPath (Join-Path $repoPath ".git")) {
  Push-Location -LiteralPath $repoPath
  try {
    $origin = Invoke-NativeCapture "git" @("config", "--get", "remote.origin.url")
    $head = Invoke-NativeCapture "git" @("rev-parse", "--short", "HEAD")
    Add-Step -Id "repo" -Label "DeskRelay repo" -Status "ok" -Summary $repoPath -Evidence @("origin=$($origin.output)", "head=$($head.output)")
  } finally {
    Pop-Location
  }
} else {
  Add-Step -Id "repo" -Label "DeskRelay repo" -Status "failed" -Summary "repo is missing or not a git checkout: $repoPath" -Action "Rerun the registration command so it can clone DeskRelay."
}

Test-WorkspaceRoots -Roots $WorkspaceRoots
Test-LoginTask

$token = Resolve-DaemonToken -Path $repoPath -ExistingToken $DaemonToken
$authHeaders = @{}
if ($token) {
  $authHeaders = @{ Authorization = "Bearer $token" }
}

if ($token) {
  $localStatusUrl = "http://127.0.0.1:$Port/status"
  $localStatus = Invoke-JsonGet -Url $localStatusUrl -Headers $authHeaders -TimeoutSec 8
  if ($localStatus.ok) {
    $version = ""
    try {
      $version = [string]$localStatus.body.build.version
    } catch {
      $version = ""
    }
    Add-Step -Id "local-daemon" -Label "local daemon" -Status "ok" -Summary "local /status is reachable at $localStatusUrl" -Evidence @("version=$version")
  } else {
    Add-Step -Id "local-daemon" -Label "local daemon" -Status "failed" -Summary "local /status failed at $localStatusUrl" -Evidence @("status=$($localStatus.status)", $localStatus.error) -Action "Check the login task log or rerun registration."
  }

  $advertisedStatus = Invoke-JsonGet -Url (Join-UrlPath -Base $DaemonUrl -Path "status") -Headers $authHeaders -TimeoutSec 8
  if ($advertisedStatus.ok) {
    Add-Step -Id "advertised-daemon" -Label "advertised daemon" -Status "ok" -Summary "server-facing daemon URL is reachable: $DaemonUrl"
  } else {
    $action = "Check Tailscale/LAN routing and Windows Firewall inbound TCP $Port."
    if ($advertisedStatus.status -eq 401 -or $advertisedStatus.status -eq 403) {
      $action = "Rerun registration so the server stores this PC's current daemon token."
    }
    Add-Step -Id "advertised-daemon" -Label "advertised daemon" -Status "failed" -Summary "advertised daemon probe failed: $DaemonUrl" -Evidence @("status=$($advertisedStatus.status)", $advertisedStatus.error) -Action $action
  }
}

$serverHealth = Invoke-JsonGet -Url (Join-UrlPath -Base $serverUrl -Path "healthz") -TimeoutSec 8
if ($serverHealth.ok) {
  Add-Step -Id "server-health" -Label "server health" -Status "ok" -Summary "$serverUrl/healthz is reachable"
} else {
  Add-Step -Id "server-health" -Label "server health" -Status "failed" -Summary "server health check failed" -Evidence @("status=$($serverHealth.status)", $serverHealth.error) -Action "Check the DeskRelay server URL and whether the server is running."
}

$deviceHeaders = @{ Authorization = "Bearer $SiteToken" }
$devices = Invoke-JsonGet -Url (Join-UrlPath -Base $serverUrl -Path "api/devices") -Headers $deviceHeaders -TimeoutSec 12
$matchedDevice = $null
if ($devices.ok) {
  $rows = Convert-ToArray $devices.body
  $daemonMatches = @($rows | Where-Object { $_.daemonUrl -eq $DaemonUrl })
  $labelMatches = @()
  if (-not [string]::IsNullOrWhiteSpace($Label)) {
    $labelMatches = @($rows | Where-Object { $_.label -eq $Label })
  }
  if ($daemonMatches.Count -eq 1) {
    $matchedDevice = $daemonMatches[0]
    Add-Step -Id "server-registry" -Label "server registry" -Status "ok" -Summary "device is visible in server registry" -Evidence @("id=$($daemonMatches[0].id)", "label=$($daemonMatches[0].label)", "daemonUrl=$($daemonMatches[0].daemonUrl)")
  } elseif ($daemonMatches.Count -gt 1) {
    Add-Step -Id "server-registry" -Label "server registry" -Status "failed" -Summary "duplicate device rows exist for this daemon URL" -Evidence @($daemonMatches | ForEach-Object { "$($_.id) $($_.label) $($_.daemonUrl)" }) -Action "Remove duplicate devices from Settings -> Devices, then rerun registration."
  } elseif ($labelMatches.Count -gt 0) {
    Add-Step -Id "server-registry" -Label "server registry" -Status "warn" -Summary "device label exists but daemon URL differs" -Evidence @($labelMatches | ForEach-Object { "$($_.id) $($_.label) $($_.daemonUrl)" }) -Action "Rerun registration so the server stores the current daemon URL."
  } else {
    Add-Step -Id "server-registry" -Label "server registry" -Status "failed" -Summary "this connector is not visible in the server device list" -Action "Rerun registration and check the Site token."
  }
} else {
  Add-Step -Id "server-registry" -Label "server registry" -Status "failed" -Summary "could not read server device list" -Evidence @("status=$($devices.status)", $devices.error) -Action "Check the Site token and server URL."
}

if ($matchedDevice -and $matchedDevice.id) {
  $doctor = Invoke-JsonGet -Url (Join-UrlPath -Base $serverUrl -Path "api/devices/$($matchedDevice.id)/doctor") -Headers $deviceHeaders -TimeoutSec 20
  if ($doctor.ok) {
    $checks = Convert-ToArray $doctor.body.checks
    $daemonCheck = $checks | Where-Object { $_.id -eq "device.daemon" } | Select-Object -First 1
    if ($daemonCheck -and ($daemonCheck.severity -eq "ok" -or $daemonCheck.status -eq "ok")) {
      Add-Step -Id "server-to-daemon" -Label "server-to-connector" -Status "ok" -Summary "server can reach the connector daemon"
    } else {
      $summary = if ($daemonCheck -and $daemonCheck.summary) { [string]$daemonCheck.summary } else { "server could not verify the connector daemon" }
      $detail = if ($daemonCheck -and $daemonCheck.detail) { [string]$daemonCheck.detail } else { "" }
      Add-Step -Id "server-to-daemon" -Label "server-to-connector" -Status "failed" -Summary $summary -Evidence @($detail) -Action "Allow incoming Tailscale connections and inbound TCP $Port on this PC, then rerun registration."
    }
  } else {
    Add-Step -Id "server-to-daemon" -Label "server-to-connector" -Status "failed" -Summary "could not run server-side connector diagnosis" -Evidence @("status=$($doctor.status)", $doctor.error) -Action "Check the Site token, server URL, and server logs."
  }
} else {
  Add-Step -Id "server-to-daemon" -Label "server-to-connector" -Status "skipped" -Summary "skipped because no single matching device row was found"
}

$failedCount = @($script:Steps | Where-Object { $_.status -eq "failed" }).Count
$warnCount = @($script:Steps | Where-Object { $_.status -eq "warn" }).Count
$status = if ($failedCount -gt 0) { "failed" } else { "succeeded" }
$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  status = $status
  failed = $failedCount
  warnings = $warnCount
  server = $serverUrl
  daemonUrl = $DaemonUrl
  repo = $repoPath
  workspaceRoots = $WorkspaceRoots
  label = $Label
  steps = @($script:Steps)
}

$reportDir = Split-Path -Parent $ReportPath
if ($reportDir) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -Path $ReportPath

foreach ($step in $script:Steps) {
  $marker = switch ($step.status) {
    "ok" { "  OK  " }
    "warn" { " WARN " }
    "failed" { "ERROR " }
    "skipped" { " skip " }
  }
  Write-Host "$marker $($step.label): $($step.summary)"
  if ($step.action) {
    Write-Host "       -> $($step.action)"
  }
}
Write-Host "verification report: $ReportPath"

if ($failedCount -gt 0) {
  exit 1
}
