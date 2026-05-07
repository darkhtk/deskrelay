[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $true)]
  [string]$SiteToken,

  [string]$WorkspaceRoots = "",
  [string]$Label = "",
  [string]$Repo = "",
  [string]$RepoUrl = "https://github.com/darkhtk/deskrelay.git"
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $Hint"
  }
}

function Invoke-Native {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Normalize-RepoUrl {
  param([string]$Url)
  $value = $Url.Trim().TrimEnd("/")
  if ($value.EndsWith(".git")) {
    $value = $value.Substring(0, $value.Length - 4)
  }
  return $value.ToLowerInvariant()
}

function Backup-ExistingRepo {
  param([string]$Path, [string]$Reason)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = Join-Path (Split-Path -Parent $Path) "deskrelay.backup.$stamp"
  $i = 1
  while (Test-Path -LiteralPath $backup) {
    $backup = Join-Path (Split-Path -Parent $Path) "deskrelay.backup.$stamp.$i"
    $i += 1
  }
  Write-Warning "$Reason Moving existing folder to $backup"
  Set-Location -LiteralPath (Split-Path -Parent $Path)
  Move-Item -LiteralPath $Path -Destination $backup
}

function Clone-Fresh {
  param([string]$Url, [string]$Path)
  Invoke-Native "git" @("clone", $Url, $Path)
  Set-Location -LiteralPath $Path
}

function Ensure-DeskRelayRepo {
  param([string]$Path, [string]$Url)

  if (Test-Path -LiteralPath $Path) {
    if (-not (Test-Path -LiteralPath (Join-Path $Path ".git"))) {
      Backup-ExistingRepo -Path $Path -Reason "DeskRelay path exists but is not a git repository."
    }
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    Clone-Fresh -Url $Url -Path $Path
    return
  }

  Set-Location -LiteralPath $Path
  $origin = (& git config --get remote.origin.url 2>$null)
  if (
    $LASTEXITCODE -ne 0 -or
    [string]::IsNullOrWhiteSpace($origin) -or
    (Normalize-RepoUrl $origin) -ne (Normalize-RepoUrl $Url)
  ) {
    Backup-ExistingRepo -Path $Path -Reason "DeskRelay git remote is not $Url."
    Clone-Fresh -Url $Url -Path $Path
    return
  }

  $dirty = (& git status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $dirty) {
    Backup-ExistingRepo -Path $Path -Reason "DeskRelay folder has local changes or unreadable git status."
    Clone-Fresh -Url $Url -Path $Path
    return
  }

  try {
    Invoke-Native "git" @("fetch", "origin", "main")
    Invoke-Native "git" @("checkout", "main")
    Invoke-Native "git" @("pull", "--ff-only", "origin", "main")
  } catch {
    Backup-ExistingRepo -Path $Path -Reason "DeskRelay could not update cleanly."
    Clone-Fresh -Url $Url -Path $Path
  }
}

if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = Join-Path $HOME "deskrelay"
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoots)) {
  $WorkspaceRoots = Join-Path $HOME "Projects"
}
if ([string]::IsNullOrWhiteSpace($Label)) {
  $Label = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "DeskRelay PC" }
}

Require-Command "git" "Install Git for Windows, then run this command again."
Require-Command "bun" "Install Bun, then run this command again."

Ensure-DeskRelayRepo -Path $Repo -Url $RepoUrl

if (-not (Test-Path -LiteralPath $WorkspaceRoots)) {
  New-Item -ItemType Directory -Force -Path $WorkspaceRoots | Out-Null
}

Invoke-Native "bun" @("install")
Invoke-Native "bun" @(
  "run",
  "packages/pc-connector-daemon/src/bin.ts",
  "register-self",
  "--server",
  $Server.TrimEnd("/"),
  "--site-token",
  $SiteToken,
  "--workspace-roots",
  $WorkspaceRoots,
  "--label",
  $Label
)

Write-Host "Registered $Label with DeskRelay server: $($Server.TrimEnd('/'))"
