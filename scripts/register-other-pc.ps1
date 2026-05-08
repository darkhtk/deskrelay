[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$SiteToken,

  [string]$WorkspaceRoots = "",
  [string]$Label = "",
  [string]$Repo = "",
  [string]$RepoUrl = "https://github.com/darkhtk/deskrelay.git",
  [int]$Port = 18091
)

$ErrorActionPreference = "Stop"

$installer = Join-Path $PSScriptRoot "install-connector.ps1"
if (-not (Test-Path -LiteralPath $installer)) {
  $installer = Join-Path $env:TEMP "deskrelay-install-connector.ps1"
  Invoke-WebRequest -UseBasicParsing `
    -Uri "https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/install-connector.ps1" `
    -OutFile $installer
}

$argsList = @(
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $installer,
  "-Server",
  $Server,
  "-SiteToken",
  $SiteToken
)
if (-not [string]::IsNullOrWhiteSpace($WorkspaceRoots)) {
  $argsList += @("-WorkspaceRoots", $WorkspaceRoots)
}
if (-not [string]::IsNullOrWhiteSpace($Label)) {
  $argsList += @("-Label", $Label)
}
if (-not [string]::IsNullOrWhiteSpace($Repo)) {
  $argsList += @("-Repo", $Repo)
}
if (-not [string]::IsNullOrWhiteSpace($RepoUrl)) {
  $argsList += @("-RepoUrl", $RepoUrl)
}
$argsList += @("-Port", [string]$Port)

powershell @argsList
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
