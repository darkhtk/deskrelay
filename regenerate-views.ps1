param(
    [string]$LabRoot = 'C:\Users\darkh\Projects\orchestration-lab',
    [string]$DryRun
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib-common.ps1"

# facts_sources: files this projection reads from.
$facts_sources = @('FAILURES.md','TASKS.md','REVIEW.md','runtime\*\audit.log')

function Count-FactsSources {
    $count = 0
    foreach ($p in $facts_sources) {
        $full = Join-Path $LabRoot $p
        if ($p -like '*\**') {
            $count += @(Get-ChildItem -Path $full -ErrorAction SilentlyContinue).Count
        } elseif (Test-Path -LiteralPath $full) { $count++ }
    }
    return $count
}

function Get-CurrentRound {
    $manifestDir = Join-Path $LabRoot 'runtime'
    if (-not (Test-Path -LiteralPath $manifestDir)) { return [ordered]@{ latest=$null; in_flight=@() } }
    $rounds = Get-ChildItem -LiteralPath $manifestDir -Directory | Sort-Object Name
    $latest = $null; $inFlight = @()
    foreach ($r in $rounds) {
        $mf = Join-Path $r.FullName 'manifest.json'
        if (-not (Test-Path -LiteralPath $mf)) { continue }
        try { $obj = Read-JsonFile $mf } catch { continue }
        $latest = $r.Name
        if ((Has-Prop $obj 'status') -and $obj.status -eq 'opened') { $inFlight += $r.Name }
    }
    return [ordered]@{ latest=$latest; in_flight=$inFlight }
}

function Categorize-Artifact {
    param([string]$Name, [string]$Rel)
    if ($Rel -like 'runtime\*') { return 'runtime' }
    if ($Rel -like 'refs\*')    { return 'reference' }
    if ($Rel -like 'board\*')   { return 'board' }
    $n = $Name.ToLowerInvariant()
    if ($n -like '*.ps1')  { return 'script' }
    if ($n -like '*.md')   { return 'doc' }
    if ($n -like '*.json') { return 'data' }
    return 'other'
}

function Guess-Owner {
    param([string]$Name)
    $n = $Name.ToLowerInvariant()
    if ($n -in @('tasks.md','state.md','artifacts.md')) { return 'manager' }
    if ($n -in @('verification.md','review.md','critique.md')) { return 'verifier' }
    if ($n -in @('protocol.md','agents.md','worker-contract.md')) { return 'protocol' }
    if ($n -in @('architecture.md','spec-schema.md')) { return 'architect' }
    if ($n -like '*.ps1') { return 'implementer' }
    return 'shared'
}

function Get-RoundIntroduced {
    param([string]$Name)
    $auditRoot = Join-Path $LabRoot 'runtime'
    if (-not (Test-Path -LiteralPath $auditRoot)) { return $null }
    $logs = Get-ChildItem -LiteralPath $auditRoot -Recurse -Filter 'audit.log' -ErrorAction SilentlyContinue | Sort-Object FullName
    foreach ($log in $logs) {
        $hit = Select-String -LiteralPath $log.FullName -SimpleMatch -Pattern $Name -ErrorAction SilentlyContinue
        if ($hit) { return (Split-Path -Leaf (Split-Path -Parent $log.FullName)) }
    }
    return $null
}

function Build-Catalog {
    # R12: exclude files under runtime\ from the Catalog projection (Round Index covers them separately).
    $rows = @()
    foreach ($f in (Get-ChildItem -LiteralPath $LabRoot -File -ErrorAction SilentlyContinue | Sort-Object Name)) {
        if ($f.FullName -match '\\runtime\\') { continue }
        $rows += [ordered]@{ path=$f.Name; category=(Categorize-Artifact $f.Name $f.Name); owner=(Guess-Owner $f.Name); round_introduced=(Get-RoundIntroduced $f.Name); status='present' }
    }
    foreach ($sub in @('refs','board')) {
        $subRoot = Join-Path $LabRoot $sub
        if (-not (Test-Path -LiteralPath $subRoot)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $subRoot -File -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName)) {
            if ($f.FullName -match '\\runtime\\') { continue }
            $rel = $f.FullName.Substring($LabRoot.Length).TrimStart('\')
            $rows += [ordered]@{ path=$rel; category=(Categorize-Artifact $f.Name $rel); owner=(Guess-Owner $f.Name); round_introduced=(Get-RoundIntroduced $f.Name); status='present' }
        }
    }
    return $rows
}

function Build-RoundIndex {
    $lines = @('## Round Index','','| round_id | status | opened_at | closed_at |','| --- | --- | --- | --- |')
    $runtimeRoot = Join-Path $LabRoot 'runtime'
    if (-not (Test-Path -LiteralPath $runtimeRoot)) { return ($lines -join "`r`n") + "`r`n" }
    foreach ($rd in (Get-ChildItem -LiteralPath $runtimeRoot -Directory | Sort-Object Name)) {
        $mf = Join-Path $rd.FullName 'manifest.json'
        $status = '-'; $opened = '-'; $closed = '-'
        if (Test-Path -LiteralPath $mf) {
            try {
                $obj = Get-Content -Raw -Encoding UTF8 -Path $mf | ConvertFrom-Json
                if ($obj.PSObject.Properties.Name -contains 'status'    -and $obj.status)    { $status = [string]$obj.status }
                if ($obj.PSObject.Properties.Name -contains 'opened_at' -and $obj.opened_at) { $opened = [string]$obj.opened_at }
                if ($obj.PSObject.Properties.Name -contains 'closed_at' -and $obj.closed_at) { $closed = [string]$obj.closed_at }
            } catch { }
        }
        $lines += ('| ' + $rd.Name + ' | ' + $status + ' | ' + $opened + ' | ' + $closed + ' |')
    }
    return ($lines -join "`r`n") + "`r`n"
}

function Build-StateView {
    param($cr)
    $lines = @('## current_round','')
    if ($cr.latest) { $lines += ('- latest: ' + $cr.latest) } else { $lines += '- latest: (none)' }
    if ($cr.in_flight.Count -gt 0) { $lines += ('- in_flight: ' + ($cr.in_flight -join ', ')) } else { $lines += '- in_flight: (none)' }
    return ($lines -join "`r`n") + "`r`n"
}

function Build-CatalogView {
    param($rows)
    $lines = @('## Catalog','','| path | category | owner | round_introduced | status |','| --- | --- | --- | --- | --- |')
    foreach ($r in $rows) {
        $intro = $r.round_introduced; if (-not $intro) { $intro = '-' }
        $lines += ('| ' + $r.path + ' | ' + $r.category + ' | ' + $r.owner + ' | ' + $intro + ' | ' + $r.status + ' |')
    }
    return ($lines -join "`r`n") + "`r`n"
}

$factsCount = Count-FactsSources
$currentRound = Get-CurrentRound
$rows = Build-Catalog
$stateBody = Build-StateView $currentRound
$catalogBody = Build-CatalogView $rows
$roundIndexBody = Build-RoundIndex
$artifactsBody = $catalogBody + "`r`n" + $roundIndexBody

$stateTargetPath = Join-Path $LabRoot 'STATE.md'
$artifactsTargetPath = Join-Path $LabRoot 'ARTIFACTS.md'
$stateBytes = [System.Text.Encoding]::UTF8.GetByteCount($stateBody)
$artifactsBytes = [System.Text.Encoding]::UTF8.GetByteCount($artifactsBody)
$catalogBytes = [System.Text.Encoding]::UTF8.GetByteCount($catalogBody)
$roundIndexBytes = [System.Text.Encoding]::UTF8.GetByteCount($roundIndexBody)

$derived_views = @(
    [ordered]@{ path=$stateTargetPath;     bytes_would_write=$stateBytes;     sections=@('## current_round');                defeaters=@('section-only projection: full STATE.md rewrite not wired until R11') },
    [ordered]@{ path=$artifactsTargetPath; bytes_would_write=$artifactsBytes; sections=@('## Catalog','## Round Index');     section_bytes=[ordered]@{ catalog=$catalogBytes; round_index=$roundIndexBytes }; defeaters=@('R12: ## Catalog excludes files under runtime\; ## Round Index added','best-effort heuristics for category/owner/round_introduced; not authoritative until R11') }
)

$summary = [ordered]@{
    lab_root = $LabRoot
    facts_sources = $facts_sources
    facts_sources_count = $factsCount
    derived_views = $derived_views
    dry_run = $true
    note = 'STUB: STATE.md and ARTIFACTS.md are NOT modified in this version. Real wiring lands in R11+.'
}

Write-Output '--- regenerate-views (dry-run stub) ---'
Write-Output ('Would write: ' + $stateTargetPath + ' (' + $stateBytes + ' bytes for ## current_round section)')
Write-Output '---- STATE.md ## current_round (intended) ----'
Write-Output $stateBody
Write-Output ('Would write: ' + $artifactsTargetPath + ' (' + $artifactsBytes + ' bytes: ## Catalog ' + $catalogBytes + ' bytes, ## Round Index ' + $roundIndexBytes + ' bytes)')
Write-Output '---- ARTIFACTS.md ## Catalog (intended, excludes runtime\) ----'
Write-Output $catalogBody
Write-Output '---- ARTIFACTS.md ## Round Index (intended) ----'
Write-Output $roundIndexBody

if ($DryRun) {
    $outDir = Split-Path -Parent $DryRun
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    $json = $summary | ConvertTo-Json -Depth 8
    Write-Utf8NoBom -Path $DryRun -Content $json
    Write-Output ('summary written: ' + $DryRun)
} else {
    $summary | ConvertTo-Json -Depth 8
}
exit 0
