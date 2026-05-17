# lib-common.ps1 — shared helpers. DESIGN-ANCHOR-R43.
# Imported via dot-sourcing: `. "$PSScriptRoot\lib-common.ps1"`.
# PowerShell 5.1 compatible.

# Optional version constant (not exported, informational only):
$Script:LibCommonVersion = '0.1.0'

function Read-JsonFile {
    param([string]$Path)
    return (Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Resolve-LabPath {
    param(
        [string]$Rel,
        [string]$LabRoot
    )
    if ([string]::IsNullOrEmpty($Rel)) { return $Rel }
    if ($Rel -match '^[A-Za-z]:\\') { return $Rel }
    if ($Rel.StartsWith($LabRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $Rel }
    return (Join-Path -Path $LabRoot -ChildPath $Rel)
}

function Get-PassFail {
    param($b)
    if ($b) { 'PASS' } else { 'FAIL' }
}

function Has-Prop {
    param($o, [string]$n)
    return ($o -ne $null -and $o.PSObject.Properties.Name -contains $n)
}

function Read-SiteToken {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $raw = Get-Content -Raw -Path $Path -Encoding UTF8
    if (-not $raw) { return '' }
    # Strip UTF-8 BOM (3 bytes) + any trailing CR/LF.
    $stripped = $raw -replace "^\xef\xbb\xbf", '' -replace "\r|\n", ''
    return $stripped
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $outDir = Split-Path -Parent $Path
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}
