[CmdletBinding()]
param(
  [string]$Repo = "",
  [string]$RepoUrl = "https://github.com/darkhtk/deskrelay.git",
  [string]$Branch = "main",
  [string]$WorkspaceRoots = "",
  [switch]$WithTailscale,
  [switch]$NoOpenBrowser,
  [switch]$NoAutostart
)

$ErrorActionPreference = "Stop"

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Update-ProcessPath {
  $parts = @()
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($machine) { $parts += $machine }
  if ($user) { $parts += $user }
  $common = @(
    (Join-Path $HOME ".bun\bin"),
    (Join-Path $env:ProgramFiles "Git\cmd"),
    (Join-Path $env:ProgramFiles "Tailscale"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps")
  )
  foreach ($path in $common) {
    if ($path -and (Test-Path -LiteralPath $path)) { $parts += $path }
  }
  $env:Path = (@($parts | Where-Object { $_ } | Select-Object -Unique) -join ";")
}

function Install-FromPackageManager {
  param([string]$Id, [string]$DisplayName)
  if (-not (Test-Command "winget")) {
    throw "$DisplayName is not installed and this Windows installation has no command-line package manager available. Install $DisplayName manually, reopen PowerShell, then run this installer again."
  }
  Write-Host "Installing $DisplayName..."
  Invoke-Native "winget" @(
    "install",
    "--id",
    $Id,
    "--exact",
    "--source",
    "winget",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )
  Update-ProcessPath
}

function Ensure-Git {
  if (Test-Command "git") {
    Write-Host "Git: installed"
    return
  }
  Install-FromPackageManager -Id "Git.Git" -DisplayName "Git"
  if (-not (Test-Command "git")) {
    throw "Git installation finished, but git is still not on PATH. Reopen PowerShell and run this installer again."
  }
}

function Ensure-Bun {
  if (Test-Command "bun") {
    $version = (& bun --version 2>$null)
    Write-Host "Bun: installed ($version)"
    return
  }
  Write-Host "Installing Bun..."
  $installer = Invoke-WebRequest -UseBasicParsing -Uri "https://bun.sh/install.ps1"
  Invoke-Expression $installer.Content
  Update-ProcessPath
  if (-not (Test-Command "bun")) {
    throw "Bun installation finished, but bun is still not on PATH. Reopen PowerShell and run this installer again."
  }
}

function Get-TailscaleIp {
  $ip = ""
  if (Test-Command "tailscale") {
    $raw = & tailscale ip -4 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($raw)) {
      $ip = [string]$raw.Trim()
    }
  }
  if ($ip) {
    return $ip
  }
  $netIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -like "*Tailscale*" -and $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($netIp) {
    return [string]$netIp
  }
  return ""
}

function Ensure-Tailscale {
  if (-not $WithTailscale) {
    if (Test-Command "tailscale") {
      $ip = Get-TailscaleIp
      if ($ip) {
        Write-Host "Tailscale: online ($ip)"
      } else {
        Write-Host "Tailscale: installed, not logged in"
      }
    } else {
      Write-Host "Tailscale: skipped. Use -WithTailscale to install/login for external access."
    }
    return
  }

  if (-not (Test-Command "tailscale")) {
    Install-FromPackageManager -Id "Tailscale.Tailscale" -DisplayName "Tailscale"
  }
  if (-not (Test-Command "tailscale")) {
    throw "Tailscale installation finished, but tailscale is still not on PATH. Reopen PowerShell and run this installer again."
  }

  $ip = Get-TailscaleIp
  if ($ip) {
    Write-Host "Tailscale: online ($ip)"
    return
  }

  Write-Host "Starting Tailscale login..."
  & tailscale up
  $ip = Get-TailscaleIp
  if (-not $ip) {
    throw "Tailscale is installed but has no IPv4 address yet. Finish Tailscale login, then run this installer again."
  }
  Write-Host "Tailscale: online ($ip)"
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
  $backup = Join-Path (Split-Path -Parent $Path) "deskrelay.server.backup.$stamp"
  $i = 1
  while (Test-Path -LiteralPath $backup) {
    $backup = Join-Path (Split-Path -Parent $Path) "deskrelay.server.backup.$stamp.$i"
    $i += 1
  }
  Write-Warning "$Reason Moving existing folder to $backup"
  Set-Location -LiteralPath (Split-Path -Parent $Path)
  Move-Item -LiteralPath $Path -Destination $backup
}

function Clone-Fresh {
  param([string]$Url, [string]$Path, [string]$BranchName)
  Invoke-Native "git" @("clone", "--branch", $BranchName, $Url, $Path)
  Set-Location -LiteralPath $Path
}

function Ensure-Repo {
  param([string]$Path, [string]$Url, [string]$BranchName)
  if (Test-Path -LiteralPath $Path) {
    if (-not (Test-Path -LiteralPath (Join-Path $Path ".git"))) {
      Backup-ExistingRepo -Path $Path -Reason "DeskRelay server path exists but is not a git repository."
      Clone-Fresh -Url $Url -Path $Path -BranchName $BranchName
      return
    }
    Set-Location -LiteralPath $Path
    $origin = (& git config --get remote.origin.url 2>$null)
    if (
      $LASTEXITCODE -ne 0 -or
      [string]::IsNullOrWhiteSpace($origin) -or
      (Normalize-RepoUrl $origin) -ne (Normalize-RepoUrl $Url)
    ) {
      Backup-ExistingRepo -Path $Path -Reason "DeskRelay server git remote is not $Url."
      Clone-Fresh -Url $Url -Path $Path -BranchName $BranchName
      return
    }
    $dirty = (& git status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $dirty) {
      Backup-ExistingRepo -Path $Path -Reason "DeskRelay server folder has local changes or unreadable git status."
      Clone-Fresh -Url $Url -Path $Path -BranchName $BranchName
      return
    }
    try {
      Invoke-Native "git" @("fetch", "origin", $BranchName)
      Invoke-Native "git" @("checkout", $BranchName)
      Invoke-Native "git" @("pull", "--ff-only", "origin", $BranchName)
    } catch {
      Backup-ExistingRepo -Path $Path -Reason "DeskRelay server repo could not update cleanly."
      Clone-Fresh -Url $Url -Path $Path -BranchName $BranchName
    }
    return
  }
  Clone-Fresh -Url $Url -Path $Path -BranchName $BranchName
}

function Stop-ExistingSelfServer {
  param([string]$Path)
  $stopScript = Join-Path $Path "scripts\self-pc-server-stop.ps1"
  if (-not (Test-Path -LiteralPath $stopScript)) {
    return
  }
  $stateRoot = Join-Path $Path ".self-server"
  try {
    & powershell -ExecutionPolicy Bypass -File $stopScript -Root $stateRoot -RepoRoot $Path
  } catch {
    Write-Warning "Could not stop an existing DeskRelay self server cleanly: $($_.Exception.Message)"
  }
}

if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = Join-Path $HOME "deskrelay"
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoots)) {
  $WorkspaceRoots = Join-Path $HOME "Projects"
}

Write-Host "DeskRelay self-host server installer"
Write-Host "Repo: $Repo"
Write-Host "Branch: $Branch"
Write-Host "Workspace roots: $WorkspaceRoots"

Update-ProcessPath
Ensure-Git
Ensure-Bun
Ensure-Tailscale
Ensure-Repo -Path $Repo -Url $RepoUrl -BranchName $Branch

if (-not (Test-Path -LiteralPath $WorkspaceRoots)) {
  New-Item -ItemType Directory -Force -Path $WorkspaceRoots | Out-Null
}

Invoke-Native "bun" @("install")
Stop-ExistingSelfServer -Path $Repo

$startArgs = @(
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  (Join-Path $Repo "scripts\self-pc-server-start.ps1"),
  "-RepoRoot",
  $Repo,
  "-WorkspaceRoots",
  $WorkspaceRoots
)
if ($NoOpenBrowser) {
  $startArgs += "-NoOpenBrowser"
}
if ($NoAutostart) {
  $startArgs += "-NoAutostart"
}

& powershell @startArgs
if ($LASTEXITCODE -ne 0) {
  throw "self-pc-server-start failed with exit code $LASTEXITCODE"
}
