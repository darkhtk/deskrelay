param(
    [Parameter(Mandatory=$true)][string]$SpecUri,
    [string]$LabRoot = 'C:\Users\darkh\Projects\orchestration-lab',
    [string]$OutUri,
    [string]$SnapshotAt
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib-common.ps1"

function Get-SnapshotPath {
    param([string]$RoundId)
    $effective = $RoundId
    if (-not [string]::IsNullOrEmpty($SnapshotAt)) { $effective = $SnapshotAt }
    return (Join-Path -Path $LabRoot -ChildPath ("runtime\" + $effective + "\pre-snapshot.json"))
}

function Invoke-Rule-Exists {
    param($check)
    $full = Resolve-LabPath $check.path -LabRoot $LabRoot
    $ok = Test-Path -LiteralPath $full -PathType Leaf
    return [ordered]@{ id=$check.id; rule=$check.rule; status=(Get-PassFail $ok); observed=@{ path=$check.path; exists=$ok } }
}

function Invoke-Rule-SelectStringPresence {
    param($check)
    $full = Resolve-LabPath $check.file -LabRoot $LabRoot
    if (-not (Test-Path -LiteralPath $full)) {
        return [ordered]@{ id=$check.id; rule=$check.rule; status='FAIL'; observed=@{ file=$check.file; missing=$true }; note='file not found' }
    }
    $thresh = 1; if (Has-Prop $check 'must_match_each_gte') { $thresh = [int]$check.must_match_each_gte }
    $counts = @{}; $allOk = $true
    foreach ($pat in $check.patterns) {
        $m = Select-String -Path $full -SimpleMatch -Pattern $pat -AllMatches
        $c = 0; if ($m) { foreach ($x in $m) { $c += $x.Matches.Count } }
        $counts[$pat] = $c; if ($c -lt $thresh) { $allOk = $false }
    }
    return [ordered]@{ id=$check.id; rule=$check.rule; status=(Get-PassFail $allOk); observed=@{ file=$check.file; counts=$counts; threshold=$thresh } }
}

function Invoke-Rule-LineCap {
    param($check)
    $full = Resolve-LabPath $check.file -LabRoot $LabRoot
    if (-not (Test-Path -LiteralPath $full)) {
        return [ordered]@{ id=$check.id; rule=$check.rule; status='FAIL'; observed=@{ file=$check.file; missing=$true } }
    }
    $lines = (Get-Content -LiteralPath $full -Encoding UTF8).Count
    $ok = $lines -le [int]$check.max_lines
    return [ordered]@{ id=$check.id; rule=$check.rule; status=(Get-PassFail $ok); observed=@{ file=$check.file; lines=$lines; max_lines=[int]$check.max_lines } }
}

function Invoke-Rule-PreservedHeadings {
    param($check)
    $full = Resolve-LabPath $check.file -LabRoot $LabRoot
    if (-not (Test-Path -LiteralPath $full)) {
        return [ordered]@{ id=$check.id; rule=$check.rule; status='FAIL'; observed=@{ file=$check.file; missing=$true } }
    }
    $content = Get-Content -LiteralPath $full -Encoding UTF8
    $counts = @{}; $allOk = $true
    foreach ($h in $check.headings) {
        $c = 0
        foreach ($line in $content) { if ($line -eq $h) { $c++ } }
        $counts[$h] = $c; if ($c -ne 1) { $allOk = $false }
    }
    return [ordered]@{ id=$check.id; rule=$check.rule; status=(Get-PassFail $allOk); observed=@{ file=$check.file; heading_counts=$counts } }
}

function Get-TopLevelHashes {
    $out = @()
    foreach ($f in (Get-ChildItem -LiteralPath $LabRoot -File | Sort-Object Name)) {
        $h = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
        $out += [ordered]@{ Name=$f.Name; Hash=$h }
    }
    return $out
}

function Invoke-Rule-HashDiffSet {
    param($check, $roundId)
    $snapPath = Get-SnapshotPath $roundId
    if (-not (Test-Path -LiteralPath $snapPath)) {
        return [ordered]@{ id=$check.id; rule=$check.rule; status='FAIL'; observed=@{ snapshot_missing=$true; path=$snapPath } }
    }
    $pre = Read-JsonFile $snapPath
    $preMap = @{}; foreach ($e in $pre) { $preMap[$e.Name] = $e.Hash }
    $currMap = @{}; foreach ($e in (Get-TopLevelHashes)) { $currMap[$e.Name] = $e.Hash }
    $changed = @(); $added = @(); $removed = @(); $unchanged = 0
    foreach ($n in $currMap.Keys) {
        if ($preMap.ContainsKey($n)) {
            if ($preMap[$n] -ne $currMap[$n]) { $changed += $n } else { $unchanged++ }
        } else { $added += $n }
    }
    foreach ($n in $preMap.Keys) { if (-not $currMap.ContainsKey($n)) { $removed += $n } }
    $expChanged = @(); if (Has-Prop $check 'expected_changed') { $expChanged = @($check.expected_changed) }
    $expAdded = @(); if (Has-Prop $check 'expected_added') { $expAdded = @($check.expected_added) }
    $minUnch = 0; if (Has-Prop $check 'expected_unchanged_gte') { $minUnch = [int]$check.expected_unchanged_gte }
    $diffC = @(Compare-Object -ReferenceObject @($expChanged | Sort-Object) -DifferenceObject @($changed | Sort-Object) -SyncWindow 0)
    $diffA = @(Compare-Object -ReferenceObject @($expAdded | Sort-Object) -DifferenceObject @($added | Sort-Object) -SyncWindow 0)
    $ok = ($diffC.Count -eq 0) -and ($diffA.Count -eq 0) -and ($unchanged -ge $minUnch)
    return [ordered]@{ id=$check.id; rule=$check.rule; status=(Get-PassFail $ok); observed=@{ changed=$changed; added=$added; removed=$removed; unchanged_count=$unchanged; expected_changed=$expChanged; expected_added=$expAdded; expected_unchanged_gte=$minUnch } }
}

function Invoke-Rule-V08Equivalent {
    param($check, $roundId)
    $snapPath = Get-SnapshotPath $roundId
    if (-not (Test-Path -LiteralPath $snapPath)) {
        return [ordered]@{ id=$check.id; rule=$check.rule; status='FAIL'; observed=@{ snapshot_missing=$true } }
    }
    $pre = Read-JsonFile $snapPath
    $preNames = @{}; foreach ($e in $pre) { $preNames[$e.Name] = $true }
    $curr = Get-ChildItem -LiteralPath $LabRoot -File | ForEach-Object { $_.Name }
    $expectedAdds = @(); if (Has-Prop $check 'expected_adds') { $expectedAdds = @($check.expected_adds) }
    $expectedSet = @{}; foreach ($n in $expectedAdds) { $expectedSet[$n] = $true }
    $unexpected = @()
    foreach ($n in $curr) {
        if (-not $preNames.ContainsKey($n) -and -not $expectedSet.ContainsKey($n)) { $unexpected += $n }
    }
    $ok = ($unexpected.Count -eq 0)
    return [ordered]@{ id=$check.id; rule=$check.rule; status=(Get-PassFail $ok); observed=@{ unexpected_adds=$unexpected; expected_adds=$expectedAdds } }
}

function Invoke-Rule-SubdirAdd {
    param($check)
    return [ordered]@{ id=$check.id; rule=$check.rule; status='PASS'; observed=@{ delegated='V09'; note='subdir-add delegated' } }
}

function Invoke-Rule-ShimAuthorshipIndependence {
    param($check)
    $implPaths = @()
    $shimPaths = @()
    foreach ($a in $check.assignments) {
        $role = ([string]$a.role).ToLowerInvariant()
        if (Has-Prop $a 'allowed_paths') {
            foreach ($p in $a.allowed_paths) {
                $resolved = Resolve-LabPath $p -LabRoot $LabRoot
                if ($role.StartsWith('implementer')) { $implPaths += $resolved }
                elseif ($role -eq 'verifier-runtime') { $shimPaths += $resolved }
            }
        }
    }
    $conflicts = @()
    foreach ($p in $implPaths) {
        if ($shimPaths -contains $p) { $conflicts += $p }
    }
    $rtDeclared = (Has-Prop $check 'runtime_verification') -and ($check.runtime_verification -ne $null)
    $shimRequired = $rtDeclared
    $shimMissing = $shimRequired -and ($shimPaths.Count -eq 0)
    $ok = ($conflicts.Count -eq 0) -and (-not $shimMissing)
    return [ordered]@{
        id = $check.id
        rule = $check.rule
        status = (Get-PassFail $ok)
        observed = [ordered]@{
            conflict_paths = $conflicts
            shim_paths = $shimPaths
            impl_paths = $implPaths
            shim_missing = $shimMissing
        }
    }
}

function Invoke-Rule-ShimAntiPatterns {
    param($check)
    # F-R37-1: regex closing-quote anchor allows optional trailing `\<char>` escape.
    $shimPath = Resolve-LabPath $check.shim_path -LabRoot $LabRoot
    if (-not (Test-Path -LiteralPath $shimPath)) {
        return [ordered]@{
            id = $check.id
            rule = $check.rule
            status = 'FAIL'
            observed = [ordered]@{ shim_path = $check.shim_path; missing = $true }
        }
    }
    $src = Get-Content -Path $shimPath -Raw -Encoding UTF8
    $selfOut = @()
    if ((Has-Prop $check 'expected_stdout_substrings') -and $check.expected_stdout_substrings) {
        foreach ($literal in $check.expected_stdout_substrings) {
            $esc = [regex]::Escape($literal)
            # F-R37-1: closing-quote anchor must allow trailing escape sequences like
            # `\n`, `\r`, `\t`, `\\`, `\'`, `\"` between the literal end and the
            # closing quote. Use a non-greedy escape-sequence class.
            $patternProcess = 'process\.stdout\.write\s*\(\s*[''"]' + $esc + '(?:\\.)?[''"]'
            $patternConsole = 'console\.log\s*\(\s*[''"]' + $esc + '(?:\\.)?[''"]'
            if ($src -match $patternProcess) { $selfOut += @{ literal=$literal; via='process.stdout.write' } }
            elseif ($src -match $patternConsole) { $selfOut += @{ literal=$literal; via='console.log' } }
        }
    }
    $mockedDom = @()
    $rbr = $false
    if (Has-Prop $check 'real_browser_required') { $rbr = [bool]$check.real_browser_required }
    if ($rbr) {
        foreach ($needle in @('vm.runInContext','vm.runInNewContext','eval(','new Function(')) {
            if ($src.Contains($needle)) { $mockedDom += $needle }
        }
    }
    $ok = ($selfOut.Count -eq 0) -and ($mockedDom.Count -eq 0)
    return [ordered]@{
        id = $check.id
        rule = $check.rule
        status = (Get-PassFail $ok)
        observed = [ordered]@{
            shim_path = $check.shim_path
            self_output_hits = $selfOut
            mocked_dom_hits = $mockedDom
        }
    }
}

$spec = Read-JsonFile $SpecUri
$roundId = $spec.round_id
$results = @()
foreach ($check in $spec.declared_checks) {
    # F-R42-1: comma-prefix each append so the ordered hashtable
    # is wrapped in a single-element array, not unrolled to its
    # key-value pairs (which inflated summary.fail count).
    switch ($check.rule) {
        'exists'                 { $results += ,(Invoke-Rule-Exists $check) }
        'select-string-presence' { $results += ,(Invoke-Rule-SelectStringPresence $check) }
        'line-cap'               { $results += ,(Invoke-Rule-LineCap $check) }
        'preserved-headings'     { $results += ,(Invoke-Rule-PreservedHeadings $check) }
        'hash-diff-set'          { $results += ,(Invoke-Rule-HashDiffSet $check $roundId) }
        'v08-equivalent'         { $results += ,(Invoke-Rule-V08Equivalent $check $roundId) }
        'subdir-add'             { $results += ,(Invoke-Rule-SubdirAdd $check) }
        'shim-authorship-independence' { $results += ,(Invoke-Rule-ShimAuthorshipIndependence $check) }
        'shim-anti-patterns'           { $results += ,(Invoke-Rule-ShimAntiPatterns $check) }
        default                  { $results += ,([ordered]@{ id=$check.id; rule=$check.rule; status='FAIL'; observed=@{}; note='unknown rule' }) }
    }
}

# F-R42-1 (R45 manager bookkeeping 1/5): foreach instead of pipe.
# Where-Object pipe enumerates the OrderedDictionary in each result,
# inflating the count by ~4x. foreach iterates the array elements directly.
$pass = 0; $fail = 0; $skip = 0
foreach ($r in $results) {
    if ($r.status -eq 'PASS') { $pass++ }
    elseif ($r.status -eq 'FAIL') { $fail++ }
    elseif ($r.status -eq 'SKIP') { $skip++ }
}
$total = $results.Count

$defAck = @()
if ((Has-Prop $spec 'defeater_fields') -and $spec.defeater_fields) {
    foreach ($prop in $spec.defeater_fields.PSObject.Properties) { $defAck += $prop.Value }
}

$out = [ordered]@{
    round_id = $roundId
    evaluated_at = (Get-Date).ToString('o')
    spec_uri = $SpecUri
    results = $results
    summary = [ordered]@{ total=$total; pass=$pass; fail=$fail; skipped=$skip }
    defeaters_acknowledged = $defAck
}

if (-not $OutUri) { $OutUri = Join-Path $LabRoot ("runtime\" + $roundId + "\verify.json") }
$outDir = Split-Path -Parent $OutUri
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$json = $out | ConvertTo-Json -Depth 8
Write-Utf8NoBom -Path $OutUri -Content $json

Write-Output ("verify written: " + $OutUri)
Write-Output ("summary: total=" + $total + " pass=" + $pass + " fail=" + $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
