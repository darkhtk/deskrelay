[CmdletBinding()]
param(
  [ValidateSet("install", "remove", "status")]
  [string]$Action = "install",
  [string]$Root = "",
  [string]$RepoRoot = "",
  [string]$TaskName = "DeskRelay Self Server"
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  param([string]$Explicit)
  if ($Explicit) {
    return [System.IO.Path]::GetFullPath($Explicit)
  }
  $root = (& git rev-parse --show-toplevel 2>$null)
  if (-not $root) {
    throw "Could not resolve repo root. Run this script from the repository or pass -RepoRoot."
  }
  return [System.IO.Path]::GetFullPath($root.Trim())
}

function Get-FullPathNoResolve {
  param([string]$Path, [string]$Repo)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    $Path = Join-Path $Repo ".self-server"
  }
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Quote-PsString {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Test-WindowsTaskSchedulerAvailable {
  return $env:OS -like "*Windows*"
}

function Get-Task {
  param([string]$Name)
  try {
    return Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  } catch {
    return $null
  }
}

function Write-AutostartScript {
  param([string]$Repo, [string]$StateRoot)
  $stateDir = Join-Path $StateRoot "state"
  $logDir = Join-Path $StateRoot "logs"
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  $scriptPath = Join-Path $stateDir "deskrelay-self-server-autostart.ps1"
  $logPath = Join-Path $logDir "self-server-autostart.log"
  $startScript = Join-Path $Repo "scripts\self-pc-server-start.ps1"
  $content = @"
`$ErrorActionPreference = 'Continue'
`$logFile = $(Quote-PsString $logPath)
try {
  "[`$(Get-Date -Format o)] starting DeskRelay self server" | Out-File -Encoding utf8 -Append -FilePath `$logFile
  Set-Location -LiteralPath $(Quote-PsString $Repo)
  powershell -NoProfile -ExecutionPolicy Bypass -File $(Quote-PsString $startScript) -Root $(Quote-PsString $StateRoot) -RepoRoot $(Quote-PsString $Repo) -NoOpenBrowser -NoAutostart *>> `$logFile
  `$code = `$LASTEXITCODE
  "[`$(Get-Date -Format o)] self server start exited with code `$code" | Out-File -Encoding utf8 -Append -FilePath `$logFile
  exit `$code
} catch {
  "[`$(Get-Date -Format o)] self server autostart failed: `$(`$_.Exception.Message)" | Out-File -Encoding utf8 -Append -FilePath `$logFile
  exit 1
}
"@
  $content | Set-Content -Encoding utf8 -Path $scriptPath
  return [pscustomobject]@{ ScriptPath = $scriptPath; LogPath = $logPath }
}

function Install-AutostartTask {
  param([string]$Name, [string]$ScriptPath)
  $argInner = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argInner
  $trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -Force | Out-Null
}

function Remove-AutostartTask {
  param([string]$Name)
  $task = Get-Task -Name $Name
  if (-not $task) {
    return $false
  }
  try {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  } catch {
    # Best effort only.
  }
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false
  return $true
}

if (-not (Test-WindowsTaskSchedulerAvailable)) {
  throw "DeskRelay self server autostart is currently supported on Windows only."
}

$repo = Get-RepoRoot -Explicit $RepoRoot
$root = Get-FullPathNoResolve -Path $Root -Repo $repo

if ($Action -eq "install") {
  $written = Write-AutostartScript -Repo $repo -StateRoot $root
  Install-AutostartTask -Name $TaskName -ScriptPath $written.ScriptPath
  Write-Host "self server autostart installed: $TaskName"
  Write-Host "script: $($written.ScriptPath)"
  Write-Host "log: $($written.LogPath)"
  exit 0
}

if ($Action -eq "remove") {
  $removed = Remove-AutostartTask -Name $TaskName
  $scriptPath = Join-Path (Join-Path $root "state") "deskrelay-self-server-autostart.ps1"
  if (Test-Path -LiteralPath $scriptPath) {
    Remove-Item -Force -LiteralPath $scriptPath
  }
  if ($removed) {
    Write-Host "self server autostart removed: $TaskName"
  } else {
    Write-Host "(self server autostart already absent: $TaskName)"
  }
  exit 0
}

$task = Get-Task -Name $TaskName
if ($task) {
  Write-Host "self server autostart installed: $TaskName"
  try {
    Get-ScheduledTaskInfo -TaskName $TaskName | Format-List TaskName,LastRunTime,LastTaskResult,NextRunTime
  } catch {
    Write-Host "Could not read scheduled task run info: $($_.Exception.Message)"
  }
} else {
  Write-Host "(self server autostart not installed: $TaskName)"
}
