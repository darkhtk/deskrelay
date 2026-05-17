param(
    [Parameter(Mandatory=$true)][string]$SpecUri,
    [string]$LabRoot = 'C:\Users\darkh\Projects\orchestration-lab',
    [string]$ReportUri
)
$ErrorActionPreference = 'Stop'
# validate-spec.ps1 — pre-dispatch lint of spec.json that catches manager-side
# prompt self-inconsistencies BEFORE worker dispatch. Complements evaluate-spec.ps1
# (which runs at round close). PowerShell 5.1 compatible.

. "$PSScriptRoot\lib-common.ps1"

function Get-AssignmentRoleLabel {
    param($a)
    $role = ''
    if (Has-Prop $a 'role') { $role = [string]$a.role }
    $label = ''
    if (Has-Prop $a 'label') { $label = [string]$a.label }
    if ($label) { return ($role + ':' + $label) }
    return $role
}

function Get-AssignmentAllowedSet {
    param($a)
    $set = @()
    if (Has-Prop $a 'allowed_paths') {
        foreach ($p in $a.allowed_paths) {
            $set += (Resolve-LabPath ([string]$p) -LabRoot $LabRoot)
        }
    }
    return $set
}

function Invoke-Lint-AllowedPathsDisjoint {
    param($spec)
    $id = 'Invoke-Lint-AllowedPathsDisjoint'
    if (-not (Has-Prop $spec 'assignments')) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='no assignments' } }
    }
    $assigns = @($spec.assignments)
    $conflicts = @()
    for ($i = 0; $i -lt $assigns.Count; $i++) {
        $aSet = Get-AssignmentAllowedSet $assigns[$i]
        $aLabel = Get-AssignmentRoleLabel $assigns[$i]
        for ($j = $i + 1; $j -lt $assigns.Count; $j++) {
            $bSet = Get-AssignmentAllowedSet $assigns[$j]
            $bLabel = Get-AssignmentRoleLabel $assigns[$j]
            foreach ($p in $aSet) {
                if ($bSet -contains $p) {
                    $conflicts += [ordered]@{ path=$p; pair=@($aLabel, $bLabel) }
                }
            }
        }
    }
    $ok = ($conflicts.Count -eq 0)
    return [ordered]@{ id=$id; status=(Get-PassFail $ok); observed=[ordered]@{ conflict_paths=$conflicts } }
}

function Invoke-Lint-CanonicalExamplesMandate {
    param($spec)
    $id = 'Invoke-Lint-CanonicalExamplesMandate'
    $assigns = @()
    if (Has-Prop $spec 'assignments') { $assigns = @($spec.assignments) }
    if ($assigns.Count -le 1) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='single-assignment spec; R25 mandate not triggered' } }
    }
    $proseParts = @()
    if (Has-Prop $spec 'objective') { $proseParts += [string]$spec.objective }
    if (Has-Prop $spec 'round_close_criteria') { $proseParts += [string]$spec.round_close_criteria }
    foreach ($a in $assigns) {
        if (Has-Prop $a 'role') { $proseParts += [string]$a.role }
        if (Has-Prop $a 'label') { $proseParts += [string]$a.label }
        if (Has-Prop $a 'instruction') { $proseParts += [string]$a.instruction }
    }
    $prose = ($proseParts -join "`n").ToLowerInvariant()
    $triggers = @('format','shape','layout','convention')
    $hit = $null
    foreach ($t in $triggers) {
        if ($prose.Contains($t)) { $hit = $t; break }
    }
    if (-not $hit) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='no trigger phrase in prose' } }
    }
    $hasCanonical = $false
    if ((Has-Prop $spec 'canonical_examples') -and ($spec.canonical_examples -ne $null)) {
        if (@($spec.canonical_examples).Count -gt 0) { $hasCanonical = $true }
    }
    return [ordered]@{ id=$id; status=(Get-PassFail $hasCanonical); observed=[ordered]@{ trigger_phrase=$hit; note='R25 mandate'; canonical_examples_present=$hasCanonical } }
}

function Invoke-Lint-VerbatimStringsInCanonical {
    param($spec)
    $id = 'Invoke-Lint-VerbatimStringsInCanonical'
    $haystackParts = @()
    if ((Has-Prop $spec 'canonical_examples') -and ($spec.canonical_examples -ne $null)) {
        foreach ($ex in $spec.canonical_examples) {
            if (Has-Prop $ex 'content') { $haystackParts += [string]$ex.content }
        }
    }
    if (Has-Prop $spec 'objective') { $haystackParts += [string]$spec.objective }
    if (Has-Prop $spec 'title') { $haystackParts += [string]$spec.title }
    if (Has-Prop $spec 'round_close_criteria') { $haystackParts += [string]$spec.round_close_criteria }
    $haystack = $haystackParts -join "`n"
    $orphans = @()
    $checked = 0
    $assigns = @()
    if (Has-Prop $spec 'assignments') { $assigns = @($spec.assignments) }
    foreach ($a in $assigns) {
        if (-not (Has-Prop $a 'verbatim_strings')) { continue }
        $aLabel = Get-AssignmentRoleLabel $a
        foreach ($lit in $a.verbatim_strings) {
            $checked++
            $s = [string]$lit
            if (-not $haystack.Contains($s)) {
                $orphans += [ordered]@{ literal=$s; assignment=$aLabel }
            }
        }
    }
    if ($checked -eq 0) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='no verbatim_strings declared' } }
    }
    $ok = ($orphans.Count -eq 0)
    return [ordered]@{ id=$id; status=(Get-PassFail $ok); observed=[ordered]@{ orphans=$orphans; checked_count=$checked } }
}

function Invoke-Lint-ShimAuthorshipPreCheck {
    param($spec)
    $id = 'Invoke-Lint-ShimAuthorshipPreCheck'
    $implPaths = @()
    $shimPaths = @()
    $assigns = @()
    if (Has-Prop $spec 'assignments') { $assigns = @($spec.assignments) }
    foreach ($a in $assigns) {
        $role = ''
        if (Has-Prop $a 'role') { $role = ([string]$a.role).ToLowerInvariant() }
        $set = Get-AssignmentAllowedSet $a
        if ($role.StartsWith('implementer')) {
            foreach ($p in $set) { $implPaths += $p }
        } elseif ($role -eq 'verifier-runtime') {
            foreach ($p in $set) { $shimPaths += $p }
        }
    }
    $conflicts = @()
    foreach ($p in $implPaths) {
        if ($shimPaths -contains $p) { $conflicts += $p }
    }
    $rtDeclared = (Has-Prop $spec 'runtime_verification') -and ($spec.runtime_verification -ne $null)
    $shimMissing = $rtDeclared -and ($shimPaths.Count -eq 0)
    $ok = ($conflicts.Count -eq 0) -and (-not $shimMissing)
    return [ordered]@{ id=$id; status=(Get-PassFail $ok); observed=[ordered]@{ conflict_paths=$conflicts; shim_paths=$shimPaths; impl_paths=$implPaths; shim_missing=$shimMissing; runtime_declared=$rtDeclared } }
}

function Invoke-Lint-RuntimeVerificationCompleteness {
    param($spec)
    $id = 'Invoke-Lint-RuntimeVerificationCompleteness'
    if ((-not (Has-Prop $spec 'runtime_verification')) -or ($spec.runtime_verification -eq $null)) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='no runtime_verification declared' } }
    }
    $rt = $spec.runtime_verification
    $missing = @()
    if ((-not (Has-Prop $rt 'command')) -or [string]::IsNullOrEmpty([string]$rt.command)) {
        $missing += 'command'
    }
    if (-not (Has-Prop $rt 'expected_exit')) {
        $missing += 'expected_exit'
    } else {
        $ev = $rt.expected_exit
        $isInt = $false
        try { $null = [int]$ev; $isInt = $true } catch { $isInt = $false }
        if (-not $isInt) { $missing += 'expected_exit(not_int)' }
    }
    $rbr = $false
    if (Has-Prop $rt 'real_browser_required') { $rbr = [bool]$rt.real_browser_required }
    $keyboardHeuristic = $false
    $assigns = @()
    if (Has-Prop $spec 'assignments') { $assigns = @($spec.assignments) }
    foreach ($a in $assigns) {
        if (Has-Prop $a 'allowed_paths') {
            foreach ($p in $a.allowed_paths) {
                if (([string]$p).ToLowerInvariant().EndsWith('.html')) { $keyboardHeuristic = $true }
            }
        }
        if (Has-Prop $a 'verbatim_strings') {
            foreach ($lit in $a.verbatim_strings) {
                $s = [string]$lit
                if ($s.Contains('addEventListener')) { $keyboardHeuristic = $true }
                if ($s.Contains('keydown')) { $keyboardHeuristic = $true }
                if ($s.Contains('keyup')) { $keyboardHeuristic = $true }
            }
        }
    }
    $needsInteractions = $rbr -or $keyboardHeuristic
    if ($needsInteractions) {
        $hasInter = $false
        if ((Has-Prop $rt 'interactions') -and ($rt.interactions -ne $null)) {
            if (@($rt.interactions).Count -gt 0) { $hasInter = $true }
        }
        if (-not $hasInter) { $missing += 'interactions' }
    }
    $ok = ($missing.Count -eq 0)
    return [ordered]@{ id=$id; status=(Get-PassFail $ok); observed=[ordered]@{ missing=$missing; needs_interactions=$needsInteractions; real_browser_required=$rbr } }
}

function Invoke-Lint-ForbiddenActionsBaseline {
    param($spec)
    $id = 'Invoke-Lint-ForbiddenActionsBaseline'
    $needle = 'no incidental temp files'
    $missing = @()
    $checked = 0
    $assigns = @()
    if (Has-Prop $spec 'assignments') { $assigns = @($spec.assignments) }
    foreach ($a in $assigns) {
        if (-not (Has-Prop $a 'forbidden_actions')) { continue }
        $checked++
        $found = $false
        foreach ($f in $a.forbidden_actions) {
            $s = [string]$f
            if ($s.ToLowerInvariant().Contains($needle)) { $found = $true; break }
        }
        if (-not $found) {
            $missing += (Get-AssignmentRoleLabel $a)
        }
    }
    if ($checked -eq 0) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='no forbidden_actions declared anywhere (warning only, not fail)' } }
    }
    $ok = ($missing.Count -eq 0)
    return [ordered]@{ id=$id; status=(Get-PassFail $ok); observed=[ordered]@{ missing_baseline=$missing; checked_count=$checked; baseline_phrase=$needle } }
}

function Invoke-Lint-ExportContractMatches {
    param($spec)
    # F-R47-1: cross-worker import name drift caught pre-dispatch.
    # Reads $spec.module_export_contract[] and scans every worker prompt
    # referenced via $spec.inputs[] for TypeScript named imports
    # (`import { X } from './module'`). Each captured (module, symbols)
    # pair MUST satisfy the matching module_export_contract entry's exports.
    $id = 'Invoke-Lint-ExportContractMatches'
    if (-not (Has-Prop $spec 'module_export_contract')) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='no module_export_contract declared; lint skipped (not all rounds need this)' } }
    }
    $contract = @($spec.module_export_contract)
    if ($contract.Count -eq 0) {
        return [ordered]@{ id=$id; status='PASS'; observed=[ordered]@{ note='module_export_contract is empty; lint skipped' } }
    }
    $promptPaths = @()
    if (Has-Prop $spec 'inputs') {
        foreach ($p in $spec.inputs) {
            $sp = [string]$p
            if ($sp -match '\.txt$') {
                $resolved = Resolve-LabPath $sp -LabRoot $LabRoot
                if (Test-Path -LiteralPath $resolved) { $promptPaths += $resolved }
                elseif (Test-Path -LiteralPath $sp) { $promptPaths += $sp }
            }
        }
    }
    $unsatisfied = @()
    $importPattern = "import\s*\{\s*([^}]+)\s*\}\s*from\s*['""]\.\/([^'""]+)['""]"
    foreach ($pp in $promptPaths) {
        $text = Get-Content -Raw -Path $pp -Encoding UTF8
        if (-not $text) { continue }
        foreach ($m in [regex]::Matches($text, $importPattern)) {
            $rawSyms = $m.Groups[1].Value.Split(',')
            $syms = @()
            foreach ($rs in $rawSyms) {
                $clean = $rs.Trim() -replace '\s+as\s+\w+','' -replace '^type\s+',''
                if ($clean) { $syms += $clean }
            }
            $mod = ($m.Groups[2].Value -replace '\.tsx?$','') + '.ts'
            $entry = $null
            foreach ($e in $contract) {
                if ((Has-Prop $e 'module') -and ([string]$e.module -eq $mod)) { $entry = $e; break }
            }
            if (-not $entry) {
                $unsatisfied += [ordered]@{ prompt=$pp; module=$mod; missing=$syms; reason='module-not-in-contract' }
                continue
            }
            $exports = @()
            if (Has-Prop $entry 'exports') { $exports = @($entry.exports) }
            $missing = @()
            foreach ($s in $syms) {
                if ($exports -notcontains $s) { $missing += $s }
            }
            if ($missing.Count -gt 0) {
                $unsatisfied += [ordered]@{ prompt=$pp; module=$mod; missing=$missing; reason='symbols-not-declared' }
            }
        }
    }
    $modulesInContract = @()
    foreach ($e in $contract) {
        if (Has-Prop $e 'module') { $modulesInContract += [string]$e.module }
    }
    $ok = ($unsatisfied.Count -eq 0)
    return [ordered]@{
        id = $id
        status = (Get-PassFail $ok)
        observed = [ordered]@{
            modules_in_contract = $modulesInContract
            prompt_paths_scanned = $promptPaths
            unsatisfied_imports = $unsatisfied
        }
    }
}

$spec = Read-JsonFile $SpecUri
$specVersion = ''
if (Has-Prop $spec 'spec_version') { $specVersion = [string]$spec.spec_version }
$roundId = ''
if (Has-Prop $spec 'round_id') { $roundId = [string]$spec.round_id }

$results = @()
$results += (Invoke-Lint-AllowedPathsDisjoint $spec)
$results += (Invoke-Lint-CanonicalExamplesMandate $spec)
$results += (Invoke-Lint-VerbatimStringsInCanonical $spec)
$results += (Invoke-Lint-ShimAuthorshipPreCheck $spec)
$results += (Invoke-Lint-RuntimeVerificationCompleteness $spec)
$results += (Invoke-Lint-ForbiddenActionsBaseline $spec)
$results += (Invoke-Lint-ExportContractMatches $spec)

# F-R42-1: foreach instead of pipe.
# Where-Object pipe enumerates the OrderedDictionary in each result,
# inflating the count. foreach iterates the array elements directly.
$pass = 0; $fail = 0
foreach ($r in $results) {
    if ($r.status -eq 'PASS') { $pass++ }
    elseif ($r.status -eq 'FAIL') { $fail++ }
}

if (-not $ReportUri) {
    $ReportUri = Join-Path $LabRoot ("runtime\" + $roundId + "\validate.json")
}
$reportDir = Split-Path -Parent $ReportUri
if (-not (Test-Path -LiteralPath $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}

$out = [ordered]@{
    round_id = $roundId
    spec_version = $specVersion
    validated_at = (Get-Date).ToString('o')
    spec_uri = $SpecUri
    results = $results
    summary = [ordered]@{ total=$results.Count; pass=$pass; fail=$fail }
}
$json = $out | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path $ReportUri -Content $json

Write-Output ("validate written: " + $ReportUri)
Write-Output ("summary: total=" + $results.Count + " pass=" + $pass + " fail=" + $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
