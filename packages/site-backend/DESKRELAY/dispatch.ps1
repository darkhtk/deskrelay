# DESIGN-ANCHOR-R55: master dispatch wrapper. Chains validate + probe +
# create + dispatch + poll + manifest + cleanup into ONE command so that
# humans and AIs both can't skip a step. PS5.1 compatible.
#
# Calls validate-spec.ps1 and dispatch-probe.ps1 (sibling scripts) and
# dot-sources lib-common.ps1 for Read-SiteToken / Write-Utf8NoBom /
# Read-JsonFile helpers. All HTTP I/O uses Invoke-RestMethod.
#
# Phase markers emitted to stdout (one Write-Output per transition):
#   dispatch: phase: validate ...
#   dispatch: phase: probe ...
#   dispatch: phase: create ...
#   dispatch: phase: dispatch ...
#   dispatch: phase: poll ...
#   dispatch: phase: manifest ...
#   dispatch: phase: cleanup ...
#
# Cleanup uses behaviors/remote-claude/request with method sessions.deleteByCwd
# to retire any worker session left over on the first online device.
#
# Exit codes:
#   0  - round completed successfully
#   1  - any phase failed OR round status is failed/blocked/timeout

param(
    [Parameter(Mandatory=$true)][string]$SpecUri,
    [Parameter(Mandatory=$true)][string]$CreatePayloadUri,
    [Parameter(Mandatory=$true)][string]$DispatchPayloadUri,
    [string]$LabRoot          = 'C:\Users\darkh\Projects\orchestration-lab',
    [string]$ApiBase          = $env:DESKRELAY_MANAGER_API_BASE,
    [string]$Token            = $env:DESKRELAY_SITE_TOKEN,
    [int]$PollIntervalSec     = 5,
    [int]$PollMaxSec          = 1800,
    [string]$WorkerCwd        = 'C:\sourcetree\DeskRelay\deskrelay',
    [int]$ProbeRetryWaitSec   = 300,
    [int]$ProbeMaxRetries     = 3,
    [switch]$SkipCleanup
)

$ErrorActionPreference = 'Stop'

# Dot-source shared helpers (lib-common.ps1 provides Read-SiteToken,
# Write-Utf8NoBom, Read-JsonFile, Resolve-LabPath, etc.).
. "$PSScriptRoot\lib-common.ps1"

if (-not $ApiBase) { $ApiBase = 'http://127.0.0.1:18193' }
if (-not $Token) {
    $Token = Read-SiteToken -Path 'C:\sourcetree\DeskRelay\deskrelay\.self-server\site-token.txt'
}
if (-not $Token) {
    Write-Error "dispatch: no site token (set DESKRELAY_SITE_TOKEN or place .self-server\site-token.txt)"
    exit 1
}

function Emit {
    param([string]$Phase, [string]$Msg)
    Write-Output ("dispatch: phase: " + $Phase + " " + $Msg)
}

# ---------------------------------------------------------------------------
# Phase 1: validate
# ---------------------------------------------------------------------------
Emit 'validate' "running validate-spec.ps1 against $SpecUri"
& "$LabRoot\validate-spec.ps1" -SpecUri $SpecUri -LabRoot $LabRoot 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error ("dispatch: validate-spec FAILED exit=" + $LASTEXITCODE + "; see validate.json near spec")
    exit 1
}
Emit 'validate' 'PASS'

# ---------------------------------------------------------------------------
# Phase 2: probe (dispatch-probe.ps1) with bounded backoff
#   exit 0 -> probe OK, proceed
#   exit 2 -> transient (server busy / worker booting); wait and retry
#   other  -> hard failure; bail out
# ---------------------------------------------------------------------------
Emit 'probe' "running dispatch-probe.ps1"
$attempts = 0
$probeOk  = $false
while ($attempts -lt $ProbeMaxRetries -and -not $probeOk) {
    $attempts += 1
    & "$LabRoot\dispatch-probe.ps1" -ApiBase $ApiBase -Token $Token 2>&1 | Out-Null
    $exit = $LASTEXITCODE
    if ($exit -eq 0) {
        $probeOk = $true
        break
    }
    if ($exit -eq 2) {
        Emit 'probe' ("WAIT (attempt " + $attempts + "/" + $ProbeMaxRetries + "); sleeping " + $ProbeRetryWaitSec + "s")
        Start-Sleep -Seconds $ProbeRetryWaitSec
        continue
    }
    Write-Error ("dispatch: probe FAILED exit=" + $exit + "; server unreachable or worker broken")
    exit 1
}
if (-not $probeOk) {
    Write-Error ("dispatch: probe never recovered after " + $ProbeMaxRetries + " attempts")
    exit 1
}
Emit 'probe' 'OK'

# ---------------------------------------------------------------------------
# Phase 3: create round
# ---------------------------------------------------------------------------
Emit 'create' "POST /api/manager/rounds"
$createBody = Get-Content -Raw -Path $CreatePayloadUri -Encoding UTF8
$headers = @{
    Authorization  = "Bearer $Token"
    'Content-Type' = 'application/json'
}
$createResp = $null
try {
    $createResp = Invoke-RestMethod `
        -Method Post `
        -Uri ($ApiBase + '/api/manager/rounds') `
        -Headers $headers `
        -Body $createBody `
        -TimeoutSec 60
} catch {
    Write-Error ("dispatch: create POST failed: " + $_.Exception.Message)
    exit 1
}
if (-not $createResp -or -not $createResp.round -or -not $createResp.round.id) {
    Write-Error "dispatch: create response missing round.id"
    exit 1
}
$roundId = $createResp.round.id
Emit 'create' ("round_id=" + $roundId)

# ---------------------------------------------------------------------------
# Phase 4: dispatch (POST /dispatch). HTTP timeout here is F5-class; the
# server may still process and we rely on the poll loop for truth.
# ---------------------------------------------------------------------------
Emit 'dispatch' ("POST /api/manager/rounds/" + $roundId + "/dispatch")
$dispatchBody = Get-Content -Raw -Path $DispatchPayloadUri -Encoding UTF8
try {
    $null = Invoke-RestMethod `
        -Method Post `
        -Uri ($ApiBase + '/api/manager/rounds/' + $roundId + '/dispatch') `
        -Headers $headers `
        -Body $dispatchBody `
        -TimeoutSec 30
    Emit 'dispatch' 'accepted (202)'
} catch {
    Emit 'dispatch' ("HTTP error during dispatch (proceeding to poll; F5 pattern): " + $_.Exception.Message)
}

# ---------------------------------------------------------------------------
# Phase 5: poll /report until terminal state or timeout
# ---------------------------------------------------------------------------
Emit 'poll' ("polling /report every " + $PollIntervalSec + "s up to " + $PollMaxSec + "s")
$pollDeadline = (Get-Date).AddSeconds($PollMaxSec)
$finalReport  = $null
while ((Get-Date) -lt $pollDeadline) {
    try {
        $report = Invoke-RestMethod `
            -Method Get `
            -Uri ($ApiBase + '/api/manager/rounds/' + $roundId + '/report') `
            -Headers $headers `
            -TimeoutSec 30
        $status = $report.round.status
        $agentCount = (@($report.round.agentIds)).Count
        $taskCount  = (@($report.round.taskIds)).Count
        Emit 'poll' ("status=" + $status + " agents=" + $agentCount + " tasks=" + $taskCount)
        if ($status -eq 'completed' -or $status -eq 'failed' -or $status -eq 'blocked') {
            $finalReport = $report
            break
        }
    } catch {
        Emit 'poll' ("transient error: " + $_.Exception.Message)
    }
    Start-Sleep -Seconds $PollIntervalSec
}
if (-not $finalReport) {
    Write-Error ("dispatch: poll timed out after " + $PollMaxSec + "s; round may still be running")
    exit 1
}
Emit 'poll' ("complete final_status=" + $finalReport.round.status)

# ---------------------------------------------------------------------------
# Phase 6: manifest — write runtime/<spec.round_id>/manifest.json
# ---------------------------------------------------------------------------
Emit 'manifest' "writing manifest.json"
$specObj = Read-JsonFile -Path $SpecUri
$specRoundId = $null
if ($specObj -and $specObj.PSObject.Properties.Name -contains 'round_id') {
    $specRoundId = [string]$specObj.round_id
}
if (-not $specRoundId) { $specRoundId = $roundId }
$manifestDir = Join-Path $LabRoot ("runtime\" + $specRoundId)
if (-not (Test-Path -LiteralPath $manifestDir)) {
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
}
$manifestPath = Join-Path $manifestDir 'manifest.json'

$openedAt = $null
if ($createResp.round.PSObject.Properties.Name -contains 'createdAt') {
    $openedAt = $createResp.round.createdAt
}
$closedAt = $null
if ($finalReport.round.PSObject.Properties.Name -contains 'completedAt') {
    $closedAt = $finalReport.round.completedAt
}
$summary = $null
if ($finalReport.round.PSObject.Properties.Name -contains 'summary') {
    $summary = $finalReport.round.summary
}

$manifest = [ordered]@{
    round_id            = $specRoundId
    server_round_id     = $roundId
    opened_at           = $openedAt
    closed_at           = $closedAt
    status              = $finalReport.round.status
    summary             = $summary
    agent_ids           = $finalReport.round.agentIds
    task_ids            = $finalReport.round.taskIds
    dispatcher          = 'dispatch.ps1 (R55)'
    dispatch_log_phases = @('validate','probe','create','dispatch','poll','manifest','cleanup')
    spec_uri            = $SpecUri
    create_payload_uri  = $CreatePayloadUri
    dispatch_payload_uri= $DispatchPayloadUri
    api_base            = $ApiBase
}
Write-Utf8NoBom -Path $manifestPath -Content ($manifest | ConvertTo-Json -Depth 10)
Emit 'manifest' ("written -> " + $manifestPath)

# ---------------------------------------------------------------------------
# Phase 7: cleanup — best-effort sessions.deleteByCwd on first online device
# ---------------------------------------------------------------------------
if ($SkipCleanup) {
    Emit 'cleanup' "skipped (-SkipCleanup)"
} else {
    Emit 'cleanup' ("sessions.deleteByCwd " + $WorkerCwd)
    try {
        $devices = Invoke-RestMethod `
            -Method Get `
            -Uri ($ApiBase + '/api/devices') `
            -Headers $headers `
            -TimeoutSec 30
        $device = $null
        if ($devices -and $devices.devices) {
            $device = $devices.devices | Where-Object { $_.connectionState -eq 'online' } | Select-Object -First 1
        }
        if ($device) {
            $cleanupBody = (@{
                method = 'sessions.deleteByCwd'
                params = @{ cwd = $WorkerCwd }
            } | ConvertTo-Json -Depth 4)
            $null = Invoke-RestMethod `
                -Method Post `
                -Uri ($ApiBase + '/api/devices/' + $device.id + '/behaviors/remote-claude/request') `
                -Headers $headers `
                -Body $cleanupBody `
                -TimeoutSec 30
            Emit 'cleanup' ("done device=" + $device.id)
        } else {
            Emit 'cleanup' "no online device; skipped"
        }
    } catch {
        Emit 'cleanup' ("error (non-fatal): " + $_.Exception.Message)
    }
}

# ---------------------------------------------------------------------------
# Final verdict
# ---------------------------------------------------------------------------
Write-Output ("dispatch: round_id=" + $roundId + " final_status=" + $finalReport.round.status)
if ($finalReport.round.status -eq 'completed') {
    exit 0
}
exit 1
