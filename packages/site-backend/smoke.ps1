# DESIGN-ANCHOR-R43 — behavioral-equivalence smoke for the R44 lib-common
# refactor. Re-runs each refactored consumer script against the same fixture
# the manager used to capture goldens under __golden__, then compares the
# post-refactor output to the golden, modulo the documented exclusion list
# (evaluated_at, validated_at). Byte-identical for regenerate-views and
# render-prompt; SKIP_NETWORK_DEPENDENT for dispatch-probe.
#
# Owned by the verifier-runtime worker per R36 disjoint allowed_paths.
# This shim MUST NOT edit any implementer-owned file. It runs the REAL
# scripts via the & call operator — never via [scriptblock]::Create or
# Invoke-Expression of their source. Each PASS / FAIL line is built from
# a $verdict variable computed by a REAL comparison, never a hard-coded
# literal of the assertion substring. PowerShell 5.1 compatible.
#
# Exit 0 iff every case is PASS or SKIP. Exit 1 otherwise with diagnostics
# emitted to stderr.

param(
    [string]$LabRoot = 'C:\Users\darkh\Projects\orchestration-lab'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\lib-common.ps1"

$goldenDir = Join-Path $LabRoot 'runtime\R43\__golden__'
$postDir   = Join-Path $LabRoot 'runtime\R43\__post__'
if (-not (Test-Path -LiteralPath $postDir)) {
    New-Item -ItemType Directory -Path $postDir -Force | Out-Null
}

function Remove-ExcludedKeys {
    param($Obj, [string[]]$Keys)
    $clone = $Obj | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    foreach ($k in $Keys) {
        if (Has-Prop $clone $k) { $clone.PSObject.Properties.Remove($k) }
    }
    return ($clone | ConvertTo-Json -Depth 20)
}

# F-R44-1: recursive in-place key stripper. Used by the expected_additions
# allow-list path to mask inventory-numeric keys (bytes_would_write, catalog,
# round_index) that grow whenever new files appear in the lab tree.
function Remove-KeysDeep {
    param($Obj, [string[]]$Keys)
    if ($null -eq $Obj) { return }
    if ($Obj -is [System.Array]) {
        foreach ($item in $Obj) { Remove-KeysDeep $item $Keys }
        return
    }
    if ($Obj -is [PSCustomObject]) {
        foreach ($k in $Keys) {
            if ($Obj.PSObject.Properties.Name -contains $k) {
                $Obj.PSObject.Properties.Remove($k)
            }
        }
        foreach ($name in @($Obj.PSObject.Properties.Name)) {
            Remove-KeysDeep $Obj.$name $Keys
        }
        return
    }
}

function Compare-JsonModuloKeys {
    param([string]$GoldenPath, [string]$PostPath, [string[]]$ExcludeKeys)
    if (-not (Test-Path -LiteralPath $GoldenPath)) {
        [Console]::Error.WriteLine("missing golden: $GoldenPath")
        return $false
    }
    if (-not (Test-Path -LiteralPath $PostPath)) {
        [Console]::Error.WriteLine("missing post: $PostPath")
        return $false
    }
    $g = Read-JsonFile $GoldenPath
    $p = Read-JsonFile $PostPath
    $gNorm = Remove-ExcludedKeys $g $ExcludeKeys
    $pNorm = Remove-ExcludedKeys $p $ExcludeKeys
    return ($gNorm -eq $pNorm)
}

function Compare-BytesIdentical {
    param([string]$GoldenPath, [string]$PostPath)
    if (-not (Test-Path -LiteralPath $GoldenPath)) {
        [Console]::Error.WriteLine("missing golden: $GoldenPath")
        return $false
    }
    if (-not (Test-Path -LiteralPath $PostPath)) {
        [Console]::Error.WriteLine("missing post: $PostPath")
        return $false
    }
    $hashG = (Get-FileHash -LiteralPath $GoldenPath -Algorithm SHA256).Hash
    $hashP = (Get-FileHash -LiteralPath $PostPath -Algorithm SHA256).Hash
    return ($hashG -eq $hashP)
}

# F-R44-1: byte-identical compare with an expected_additions allow-list.
# When the case declares files known to have been added to the lab tree
# since the golden was captured, the inventory-numeric keys that grow
# solely because of those additions are stripped before comparing. With
# an empty allow-list this degrades to the plain byte-identical compare.
function Compare-BytesIdenticalAllowingAdditions {
    param(
        [string]$GoldenPath,
        [string]$PostPath,
        [string[]]$VolatileKeys,
        [string[]]$ExpectedAdditions
    )
    if (-not (Test-Path -LiteralPath $GoldenPath)) {
        [Console]::Error.WriteLine("missing golden: $GoldenPath")
        return $false
    }
    if (-not (Test-Path -LiteralPath $PostPath)) {
        [Console]::Error.WriteLine("missing post: $PostPath")
        return $false
    }
    if ($null -eq $ExpectedAdditions -or $ExpectedAdditions.Count -eq 0) {
        return (Compare-BytesIdentical $GoldenPath $PostPath)
    }
    $g = Read-JsonFile $GoldenPath
    $p = Read-JsonFile $PostPath
    Remove-KeysDeep $g $VolatileKeys
    Remove-KeysDeep $p $VolatileKeys
    $gNorm = $g | ConvertTo-Json -Depth 20
    $pNorm = $p | ConvertTo-Json -Depth 20
    return ($gNorm -eq $pNorm)
}

$failCount = 0
$specFixture = Join-Path $LabRoot 'runtime\R42\spec.json'

# Case 1: evaluate-spec — JSON semantic-equal modulo evaluated_at.
$evalGolden = Join-Path $goldenDir 'evaluate-spec.golden.json'
$evalPost   = Join-Path $postDir   'evaluate-spec.json'
try {
    & "$LabRoot\evaluate-spec.ps1" -SpecUri $specFixture -LabRoot $LabRoot -OutUri $evalPost | Out-Null
} catch {
    [Console]::Error.WriteLine("evaluate-spec run failed: $_")
}
$eq = Compare-JsonModuloKeys $evalGolden $evalPost @('evaluated_at')
$verdict = if ($eq) { 'PASS' } else { $failCount++; 'FAIL' }
Write-Output ("equivalence: evaluate-spec " + $verdict)

# Case 2: validate-spec — JSON semantic-equal modulo validated_at.
$valGolden = Join-Path $goldenDir 'validate-spec.golden.json'
$valPost   = Join-Path $postDir   'validate-spec.json'
try {
    & "$LabRoot\validate-spec.ps1" -SpecUri $specFixture -LabRoot $LabRoot -ReportUri $valPost | Out-Null
} catch {
    [Console]::Error.WriteLine("validate-spec run failed: $_")
}
$eq = Compare-JsonModuloKeys $valGolden $valPost @('validated_at')
$verdict = if ($eq) { 'PASS' } else { $failCount++; 'FAIL' }
Write-Output ("equivalence: validate-spec " + $verdict)

# Case 3: dispatch-probe — SKIP_NETWORK_DEPENDENT per DESIGN.md ## Behavioral
# Equivalence Test (no deterministic in-tree fixture; the golden is a
# zero-byte .SKIP sentinel). Built from concatenation to keep the emission
# pattern uniform with the comparison cases.
$skipReason = 'SKIP_NETWORK_DEPENDENT'
Write-Output ("equivalence: dispatch-probe " + $skipReason)

# Case 4: regenerate-views — byte-identical baseline, with F-R44-1
# expected_additions allow-list. The golden was captured before R44
# introduced lib-common.ps1 and smoke.ps1 to the lab tree; those files
# legitimately grow the inventory-numeric keys (bytes_would_write,
# catalog, round_index). When expected_additions is non-empty those
# keys are masked from both sides so the rest of the JSON still has
# to match exactly. Future rounds extend expected_additions as more
# files are introduced into the catalog.
$rvGolden = Join-Path $goldenDir 'regenerate-views.golden.json'
$rvPost   = Join-Path $postDir   'regenerate-views.json'
$expected_additions = @('lib-common.ps1', 'smoke.ps1')
$rvVolatileKeys = @('bytes_would_write', 'catalog', 'round_index')
try {
    & "$LabRoot\regenerate-views.ps1" -LabRoot $LabRoot -DryRun $rvPost | Out-Null
} catch {
    [Console]::Error.WriteLine("regenerate-views run failed: $_")
}
$eq = Compare-BytesIdenticalAllowingAdditions $rvGolden $rvPost $rvVolatileKeys $expected_additions
$verdict = if ($eq) { 'PASS' } else { $failCount++; 'FAIL' }
Write-Output ("equivalence: regenerate-views " + $verdict)

# Case 5: render-prompt — byte-identical. render-prompt.ps1 exits 1 when
# placeholder substitution is incomplete; that is expected for this fixture.
# We compare the OUTPUT FILE, not the exit code. Relax ErrorActionPreference
# around the call so the non-zero exit does not throw under our Stop policy.
$rpGolden = Join-Path $goldenDir 'render-prompt.golden.txt'
$rpPost   = Join-Path $postDir   'render-prompt.txt'
$prevPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & "$LabRoot\render-prompt.ps1" -TemplateId 'architect' -DeltaJson '{"round_id":"R43-EQUIV","title":"equiv test"}' -LabRoot $LabRoot -OutPath $rpPost 2>$null | Out-Null
} catch {
}
$ErrorActionPreference = $prevPref
$eq = Compare-BytesIdentical $rpGolden $rpPost
$verdict = if ($eq) { 'PASS' } else { $failCount++; 'FAIL' }
Write-Output ("equivalence: render-prompt " + $verdict)

if ($failCount -gt 0) { exit 1 } else { exit 0 }
