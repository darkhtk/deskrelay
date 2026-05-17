<#
.SYNOPSIS
    R39 upstream-weather probe. Runs ~5s before every multi-worker round dispatch.

.DESCRIPTION
    Catches Anthropic API overload (529 / rate_limit) AND DeskRelay-side problems
    (server down, devices offline, worker profile broken) before the manager burns
    N workers x 3-5 minutes each. Reads DESKRELAY_MANAGER_API_BASE and
    DESKRELAY_SITE_TOKEN from env (falls back to local defaults).

    Exit codes:
      0 = healthy; manager may dispatch the round
      1 = DeskRelay-side failure (state != succeeded, missing PROBE_OK_R39, etc.)
      2 = upstream Anthropic overloaded; manager should wait 5+ minutes
#>
param(
    [string]$ApiBase = $env:DESKRELAY_MANAGER_API_BASE,
    [string]$Token   = $env:DESKRELAY_SITE_TOKEN,
    [string]$ReportUri,
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib-common.ps1"

if (-not $ApiBase) { $ApiBase = 'http://127.0.0.1:18193' }
if (-not $Token) {
    $Token = Read-SiteToken -Path 'C:\sourcetree\DeskRelay\deskrelay\.self-server\site-token.txt'
}
if (-not $Token) {
    Write-Error "PROBE: no site token (env DESKRELAY_SITE_TOKEN unset and token file missing)."
    exit 1
}

function Write-Report {
    param([hashtable]$Data)
    if (-not $ReportUri) { return }
    try {
        $json = ([ordered]@{} + $Data) | ConvertTo-Json -Depth 6
        Write-Utf8NoBom -Path $ReportUri -Content $json
    } catch {
        Write-Error ("PROBE: failed to write report to " + $ReportUri + ": " + $_.Exception.Message)
    }
}

$body = @{
    profile     = 'claude-code'
    prompt      = "Echo exactly the literal string PROBE_OK_R39 and nothing else. Do not call any tools. Do not write any files."
    cwd         = 'C:\sourcetree\DeskRelay\deskrelay'
    timeoutMs   = ($TimeoutSec * 1000)
    dryRun      = $false
    requestedBy = 'dispatch-probe'
} | ConvertTo-Json -Depth 4

$headers = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }
$uri     = "$ApiBase/api/manager/workers/run"

$probedAt = (Get-Date).ToString('o')
$startMs  = [Environment]::TickCount

try {
    $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -TimeoutSec ($TimeoutSec + 30)
} catch {
    $elapsed = [Environment]::TickCount - $startMs
    Write-Error ("PROBE: request to " + $uri + " failed after " + $elapsed + "ms: " + $_.Exception.Message)
    Write-Report @{
        probed_at = $probedAt
        api_base  = $ApiBase
        error     = $_.Exception.Message
        exit_code = 1
    }
    exit 1
}

$data = $response.data
if (-not $data) { $data = $response }

$state      = $data.state
$result     = $data.result
$stdout     = ''
if ($result -and $result.stdout) { $stdout = [string]$result.stdout }
$durationMs = 0
if ($result -and $result.durationMs) { $durationMs = [int]$result.durationMs }
$taskId     = $data.id

$apiRetries        = 0
$rate529           = 0
$rateLimitRejected = $false
$maxErrorStatus    = 0

$lines = $stdout -split "`n" | Where-Object { $_.Trim().StartsWith('{') }
foreach ($line in $lines) {
    try {
        $obj = $line | ConvertFrom-Json
    } catch { continue }
    if ($obj.subtype -eq 'api_retry') { $apiRetries++ }
    $errStatus = 0
    if ($obj.error_status) { $errStatus = [int]$obj.error_status }
    if ($obj.api_error_status) { $errStatus = [int]$obj.api_error_status }
    if ($errStatus -gt $maxErrorStatus) { $maxErrorStatus = $errStatus }
    if ($errStatus -eq 529) { $rate529++ }
    if ($obj.type -eq 'rate_limit_event') {
        # Manager bookkeeping fix (4/5 budget): overageStatus=rejected is the
        # NORMAL state when the user opted out of overage; real throttling is
        # signalled by status != 'allowed' (e.g. 'throttled', 'exceeded').
        $info = $obj.rate_limit_info
        if ($info -and $info.status -and $info.status -ne 'allowed') { $rateLimitRejected = $true }
    }
}

$stdoutHasToken = ($stdout -like '*PROBE_OK_R39*')

$report = [ordered]@{
    probed_at              = $probedAt
    api_base               = $ApiBase
    task_id                = $taskId
    state                  = $state
    durationMs             = $durationMs
    apiRetries             = $apiRetries
    rate_529_count         = $rate529
    rate_limit_rejected    = $rateLimitRejected
    max_api_error_status   = $maxErrorStatus
    stdout_has_probe_token = $stdoutHasToken
    exit_code              = 0
}

if ($rate529 -ge 3 -or $rateLimitRejected) {
    $report.exit_code = 2
    Write-Report $report
    Write-Error ("PROBE: upstream API overloaded (rate_limit_rejected=" + $rateLimitRejected + " 529count=" + $rate529 + " apiRetries=" + $apiRetries + "). Wait 5+ minutes before next round.")
    Write-Output ("PROBE: WAIT (529count=" + $rate529 + " rateLimitRejected=" + $rateLimitRejected + ")")
    exit 2
}

if ($apiRetries -ge 3) {
    $report.exit_code = 2
    Write-Report $report
    Write-Error ("PROBE: internal api_retry events >=3 (count=" + $apiRetries + "); treating as upstream overload.")
    Write-Output ("PROBE: WAIT (apiRetries=" + $apiRetries + ")")
    exit 2
}

if ($maxErrorStatus -ge 500) {
    $report.exit_code = 1
    Write-Report $report
    Write-Error ("PROBE: api_error_status >=500 observed (max=" + $maxErrorStatus + "); DeskRelay/upstream failed (c).")
    exit 1
}

if ($state -ne 'succeeded') {
    $report.exit_code = 1
    Write-Report $report
    Write-Error ("PROBE: task did not succeed (a): state=" + $state + " taskId=" + $taskId)
    exit 1
}

if (-not $stdoutHasToken) {
    $report.exit_code = 1
    Write-Report $report
    Write-Error ("PROBE: worker stdout missing PROBE_OK_R39 (b); apiRetries=" + $apiRetries + " durationMs=" + $durationMs)
    exit 1
}

Write-Report $report
Write-Output ("PROBE: OK (durationMs=" + $durationMs + " apiRetries=" + $apiRetries + " 529count=" + $rate529 + ")")
exit 0
