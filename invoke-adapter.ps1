# WorkerSpec adapter dispatch entry point (R8).
# Loads a spec, selects an assignment, captures pre/post file hashes, appends audit
# entries, and (in R9) dispatches to the DeskRelay manager API. R8 stubs dispatch.
param(
    [Parameter(Mandatory)] [string]$SpecUri,
    [Parameter(Mandatory)] [string]$RoundId,
    [Parameter(Mandatory)] [string]$AssignmentRole,
    [string]$AdapterId = 'claude-code',
    [int]$TimeoutMs = 600000
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date

function Get-IsoTimestamp {
    return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

function Get-SafeHash {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

# --- 1. Load spec.json ---
if (-not (Test-Path -LiteralPath $SpecUri)) {
    throw "WorkerSpec not found at $SpecUri"
}
$specRaw = Get-Content -Raw -Encoding UTF8 -LiteralPath $SpecUri
$spec = $specRaw | ConvertFrom-Json

# --- 2. Select assignment by role and validate allowed_paths ---
$assignment = $null
foreach ($a in @($spec.assignments)) {
    if ($a.role -eq $AssignmentRole) { $assignment = $a; break }
}
if ($null -eq $assignment) {
    throw "WorkerSpec has no assignment for role '$AssignmentRole'"
}
if ($null -eq $assignment.allowed_paths -or -not ($assignment.allowed_paths -is [System.Array])) {
    throw "WorkerSpec assignment is missing allowed_paths array"
}
$allowedPaths = @()
foreach ($p in $assignment.allowed_paths) {
    if (-not [System.IO.Path]::IsPathRooted($p)) {
        throw "allowed_paths entry must be absolute: $p"
    }
    $allowedPaths += $p
}

# --- 3. Capture hash_before ---
$hashBefore = @{}
foreach ($p in $allowedPaths) { $hashBefore[$p] = Get-SafeHash -Path $p }

# --- 4. Locate audit.log under lab/runtime/<RoundId>/ ---
$specDir = Split-Path -Parent $SpecUri
$runtimeDir = $specDir
$cur = $specDir
while ($null -ne $cur -and $cur -ne '') {
    $cand = Join-Path $cur ("lab\runtime\" + $RoundId)
    if (Test-Path -LiteralPath $cand) { $runtimeDir = $cand; break }
    $parent = Split-Path -Parent $cur
    if (-not $parent -or $parent -eq $cur) { break }
    $cur = $parent
}
if (-not (Test-Path -LiteralPath $runtimeDir)) {
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
}
$auditLogPath = Join-Path $runtimeDir 'audit.log'

# Resolve prompt_uri for this role from spec.inputs
$promptUri = $null
if ($spec.inputs) {
    foreach ($inp in @($spec.inputs)) {
        if ($inp.role -eq $AssignmentRole) {
            if ($inp.uri) { $promptUri = $inp.uri } elseif ($inp.path) { $promptUri = $inp.path }
            break
        }
    }
}

$actor = "agent_${RoundId}_${AssignmentRole}"
$pathList = ($allowedPaths -join ',')
$startEntry = "$(Get-IsoTimestamp) | actor=$actor | event=adapter_start | detail=profile=$AdapterId allowed_paths=$pathList prompt_uri=$promptUri"
Add-Content -LiteralPath $auditLogPath -Value $startEntry -Encoding UTF8

# --- 5. Build dispatch body (real POST lands in R9) ---
$siteToken = $env:DESKRELAY_SITE_TOKEN
$cwd = 'C:\sourcetree\DeskRelay\deskrelay'
$body = $null
if ($AdapterId -eq 'claude-code') {
    $body = [ordered]@{
        profile   = 'claude-code'
        cwd       = $cwd
        timeoutMs = $TimeoutMs
        prompt    = "Read your task brief from this file and follow it exactly: $promptUri"
    }
} elseif ($AdapterId -eq 'powershell-shim') {
    $preamble = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; `$OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null;"
    $body = [ordered]@{
        profile   = 'powershell'
        cwd       = $cwd
        timeoutMs = $TimeoutMs
        prompt    = "$preamble Get-Content -Encoding UTF8 '$promptUri' | claude -p"
    }
} else {
    throw "Unknown AdapterId: $AdapterId (expected 'claude-code' or 'powershell-shim')"
}

Write-Host "[stub] POST /api/manager/workers/run (DESKRELAY_SITE_TOKEN present: $([bool]$siteToken))"
Write-Host ($body | ConvertTo-Json -Depth 6)
$exitState = 'stub'

# --- 6. Capture hash_after and build artifacts[] ---
$artifacts = @()
foreach ($p in $allowedPaths) {
    $artifacts += [pscustomobject]@{
        path        = $p
        hash_before = $hashBefore[$p]
        hash_after  = Get-SafeHash -Path $p
    }
}

# --- 7. Detect filesystem changes outside allowed_paths via pre-snapshot ---
$violations = @()
$preSnapshotPath = Join-Path $runtimeDir 'pre-snapshot.json'
if (Test-Path -LiteralPath $preSnapshotPath) {
    $preSnapshot = Get-Content -Raw -Encoding UTF8 -LiteralPath $preSnapshotPath | ConvertFrom-Json
    $allowedSet = @{}
    foreach ($ap in $allowedPaths) { $allowedSet[$ap.ToLower()] = $true }
    $entries = $null
    if ($preSnapshot.files) { $entries = $preSnapshot.files } else { $entries = $preSnapshot }
    foreach ($prop in $entries.PSObject.Properties) {
        $filePath = $prop.Name
        $oldHash = $prop.Value
        if ($allowedSet.ContainsKey($filePath.ToLower())) { continue }
        $newHash = Get-SafeHash -Path $filePath
        if ($newHash -ne $oldHash) {
            $violations += [pscustomobject]@{
                type   = 'allowed_paths_violation'
                detail = "path=$filePath hash_before=$oldHash hash_after=$newHash"
            }
        }
    }
}

$durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds

# --- 8. adapter_done audit entry ---
$doneEntry = "$(Get-IsoTimestamp) | actor=$actor | event=adapter_done | detail=exit_state=$exitState duration_ms=$durationMs artifacts=$($artifacts.Count) violations=$($violations.Count)"
Add-Content -LiteralPath $auditLogPath -Value $doneEntry -Encoding UTF8

# --- 9. Final structured result ---
$result = [pscustomobject]@{
    adapter_id    = $AdapterId
    round_id      = $RoundId
    role          = $AssignmentRole
    artifacts     = @($artifacts)
    violations    = @($violations)
    exit_state    = $exitState
    audit_entries = @('adapter_start', 'adapter_done')
    duration_ms   = $durationMs
}
$result | ConvertTo-Json -Depth 8 -Compress
