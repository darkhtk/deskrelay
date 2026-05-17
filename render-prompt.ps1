param(
  [Parameter(Mandatory)][string]$TemplateId,
  [Parameter(Mandatory)][string]$DeltaJson,
  [string]$LabRoot = 'C:\Users\darkh\Projects\orchestration-lab',
  [string]$OutPath
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib-common.ps1"

# Step 1: Read PROMPT-TEMPLATES.md.
$templatesPath = Join-Path $LabRoot 'PROMPT-TEMPLATES.md'
if (-not (Test-Path -LiteralPath $templatesPath)) {
  [Console]::Error.WriteLine("error: PROMPT-TEMPLATES.md not found at $templatesPath")
  exit 1
}
$content = Get-Content -LiteralPath $templatesPath -Raw -Encoding UTF8
$lines = $content -split "`r?`n"

# Step 2: Resolve role and optional version from TemplateId.
$role = $TemplateId
$version = ''
if ($TemplateId -match '^([a-zA-Z0-9_-]+)\.(v\d+)$') {
  $role = $Matches[1]
  $version = $Matches[2]
}

# Step 3: Locate the target H3 heading.
$targetIdx = -1
if ($version) {
  $needle = "### $role.$version"
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].TrimEnd() -eq $needle) { $targetIdx = $i; break }
  }
} else {
  $bareIdx = -1
  $latestVerIdx = -1
  $latestVerNum = -1
  $rolePattern = '^### ' + [regex]::Escape($role) + '\.v(\d+)$'
  for ($i = 0; $i -lt $lines.Length; $i++) {
    $h = $lines[$i].TrimEnd()
    if ($h -eq "### $role") { $bareIdx = $i; continue }
    if ($h -match $rolePattern) {
      $n = [int]$Matches[1]
      if ($n -gt $latestVerNum) { $latestVerNum = $n; $latestVerIdx = $i }
    }
  }
  if ($latestVerIdx -ge 0) { $targetIdx = $latestVerIdx }
  elseif ($bareIdx -ge 0) { $targetIdx = $bareIdx }
}
if ($targetIdx -lt 0) {
  [Console]::Error.WriteLine("error: template '$TemplateId' not found in PROMPT-TEMPLATES.md")
  exit 1
}

# Step 4: Extract the fenced code block immediately following the H3.
$inFence = $false
$skeletonLines = @()
$fenceClosed = $false
for ($i = $targetIdx + 1; $i -lt $lines.Length; $i++) {
  $L = $lines[$i]
  if (-not $inFence) {
    if ($L -match '^```') { $inFence = $true; continue }
    if ($L -match '^### ' -or $L -match '^## ') { break }
  } else {
    if ($L -match '^```') { $fenceClosed = $true; break }
    $skeletonLines += $L
  }
}
if (-not $fenceClosed) {
  [Console]::Error.WriteLine("error: no closed fenced skeleton after $($lines[$targetIdx])")
  exit 1
}
$skeleton = $skeletonLines -join "`r`n"

# Step 5: Parse delta JSON. Arrays render as newline-bulleted lists.
try {
  $delta = $DeltaJson | ConvertFrom-Json
} catch {
  [Console]::Error.WriteLine("error: failed to parse DeltaJson: $($_.Exception.Message)")
  exit 1
}
$values = @{}
foreach ($prop in $delta.PSObject.Properties) {
  $v = $prop.Value
  if (($v -is [System.Array]) -or ($v -is [System.Collections.IList] -and -not ($v -is [string]))) {
    $items = @()
    foreach ($it in $v) { $items += "- $it" }
    $values[$prop.Name] = ($items -join "`r`n")
  } else {
    if ($null -eq $v) { $values[$prop.Name] = '' } else { $values[$prop.Name] = [string]$v }
  }
}

# Step 6: Substitute every {{placeholder}} from the skeleton.
$rendered = $skeleton
$found = [regex]::Matches($rendered, '\{\{([a-zA-Z0-9_]+)\}\}')
$seen = @{}
$missing = @()
foreach ($m in $found) {
  $name = $m.Groups[1].Value
  if ($seen.ContainsKey($name)) { continue }
  $seen[$name] = $true
  if ($values.ContainsKey($name)) {
    $rendered = $rendered.Replace('{{' + $name + '}}', $values[$name])
  } else {
    $missing += $name
    [Console]::Error.WriteLine("warning: placeholder {{$name}} has no delta value; left as-is")
  }
}

# Step 7: Resolve output path.
if ($OutPath) {
  $outFinal = $OutPath
} else {
  $roundId = ''
  if ($delta.PSObject.Properties.Name -contains 'round_id') {
    $roundId = [string]$delta.round_id
  }
  if (-not $roundId) {
    [Console]::Error.WriteLine("error: cannot derive default OutPath; delta.round_id missing")
    exit 1
  }
  $promptsDir = Join-Path (Join-Path (Join-Path $LabRoot 'runtime') $roundId) 'prompts'
  if (-not (Test-Path -LiteralPath $promptsDir)) {
    New-Item -ItemType Directory -Path $promptsDir -Force | Out-Null
  }
  $outFinal = Join-Path $promptsDir ($role + '.txt')
}

# Step 8: Write the rendered prompt as UTF-8 (no BOM).
Write-Utf8NoBom -Path $outFinal -Content $rendered

if ($missing.Count -gt 0) { exit 1 } else { exit 0 }
