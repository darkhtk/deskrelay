param(
  [Parameter(Mandatory = $true)]
  [string]$PromptPath,

  [string]$Command = "claude",

  [Parameter(Mandatory = $true)]
  [string]$ArgsPath
)

$ErrorActionPreference = 'Stop'

$prompt = Get-Content -LiteralPath $PromptPath -Raw -Encoding UTF8
$rawArgs = Get-Content -LiteralPath $ArgsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$claudeArgs = @()
foreach ($arg in $rawArgs) {
  $claudeArgs += [string]$arg
}
& $Command @claudeArgs $prompt
exit $LASTEXITCODE
