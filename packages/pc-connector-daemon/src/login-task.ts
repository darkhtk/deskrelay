// login-task.ts -- Windows per-user Task Scheduler integration.
//
// The site pairing flow should not leave users babysitting a foreground
// daemon terminal. On Windows we install a current-user ONLOGON task that
// runs a tiny PowerShell supervisor script from the connector state dir.
// The supervisor restarts the daemon after crashes, and `uninstall`
// removes the task before deleting local state.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { defaultStateDir } from "./state-file.ts";

export const WINDOWS_LOGIN_TASK_NAME = "DeskRelay Connector";
export const WINDOWS_LOGIN_TASK_SCRIPT_NAME = "cr-connector-login-task.ps1";
export const WINDOWS_LOGIN_TASK_LOG_NAME = "connector.log";
export const WINDOWS_LOGIN_TASK_LOCK_NAME = "connector-supervisor.lock";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface LoginTaskLaunch {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface InstallLoginTaskOptions {
  platform?: NodeJS.Platform;
  taskName?: string;
  stateDir?: string;
  runner?: CommandRunner;
  launch?: LoginTaskLaunch;
  start?: boolean;
}

export interface InstallLoginTaskResult {
  supported: boolean;
  installed: boolean;
  started: boolean;
  taskName: string;
  scriptPath?: string;
  logPath?: string;
  action?: string;
}

export interface RemoveLoginTaskOptions {
  platform?: NodeJS.Platform;
  taskName?: string;
  runner?: CommandRunner;
}

export interface RemoveLoginTaskResult {
  supported: boolean;
  removed: boolean;
  taskName: string;
}

export interface RemoveSourceRunLoginTaskOptions extends RemoveLoginTaskOptions {
  stateDir?: string;
}

export interface RemoveSourceRunLoginTaskResult extends RemoveLoginTaskResult {
  skippedReason?: "not-installed" | "script-missing" | "not-source-run";
}

export interface QueryLoginTaskOptions {
  platform?: NodeJS.Platform;
  taskName?: string;
  runner?: CommandRunner;
}

export interface QueryLoginTaskResult {
  supported: boolean;
  installed: boolean;
  taskName: string;
  raw?: string;
}

function defaultWindowsLoginTaskName(): string {
  const override = process.env.CR_CONNECTOR_LOGIN_TASK_NAME?.trim();
  return override || WINDOWS_LOGIN_TASK_NAME;
}

export async function installLoginTask(
  opts: InstallLoginTaskOptions = {},
): Promise<InstallLoginTaskResult> {
  const platform = opts.platform ?? process.platform;
  const taskName = opts.taskName ?? defaultWindowsLoginTaskName();
  if (platform !== "win32") {
    return { supported: false, installed: false, started: false, taskName };
  }

  const runner = opts.runner ?? runCommand;
  const stateDir = opts.stateDir ?? defaultStateDir();
  const scriptPath = join(stateDir, WINDOWS_LOGIN_TASK_SCRIPT_NAME);
  const logPath = join(stateDir, "logs", WINDOWS_LOGIN_TASK_LOG_NAME);
  const launch = opts.launch ?? defaultLoginTaskLaunch();
  const action = windowsTaskAction(scriptPath);

  await mkdir(stateDir, { recursive: true });
  await writeFile(scriptPath, buildWindowsLoginTaskScript(launch, logPath), "utf8");

  // If an older copy is running, stop it so the replace-with-Force step
  // below doesn't race against a live process bound to the daemon port.
  await runner("schtasks.exe", ["/End", "/TN", taskName]).catch(() => ({
    code: 1,
    stdout: "",
    stderr: "",
  }));

  // Register via PowerShell's Register-ScheduledTask cmdlet, NOT schtasks.exe.
  // schtasks.exe rejects /SC ONLOGON /RL LIMITED /F with "Access is denied"
  // when invoked without admin elevation, even though the resulting task
  // would be a per-user, limited-privilege task that the user could
  // perfectly well own. Register-ScheduledTask uses the Task Scheduler COM
  // surface, which lets a non-admin user create + replace tasks under
  // their own SID. Without this, every fresh `cr-connector pair --login-task`
  // run on Windows fails the persistence step and the daemon dies on
  // logout/reboot — caught after an alpha tester's device went offline
  // overnight despite a successful initial pair.
  const create = await runner("powershell.exe", buildWindowsRegisterTaskArgs(taskName, scriptPath));
  if (create.code !== 0) {
    throw new Error(`failed to create login task: ${combineOutput(create)}`);
  }

  let started = false;
  if (opts.start) {
    const run = await runner("schtasks.exe", ["/Run", "/TN", taskName]);
    if (run.code !== 0) {
      throw new Error(`failed to start login task: ${combineOutput(run)}`);
    }
    started = true;
  }

  return {
    supported: true,
    installed: true,
    started,
    taskName,
    scriptPath,
    logPath,
    action,
  };
}

export async function removeLoginTask(
  opts: RemoveLoginTaskOptions = {},
): Promise<RemoveLoginTaskResult> {
  const platform = opts.platform ?? process.platform;
  const taskName = opts.taskName ?? defaultWindowsLoginTaskName();
  if (platform !== "win32") return { supported: false, removed: false, taskName };

  const runner = opts.runner ?? runCommand;
  const query = await runner("schtasks.exe", ["/Query", "/TN", taskName]);
  if (query.code !== 0) return { supported: true, removed: false, taskName };

  await runner("schtasks.exe", ["/End", "/TN", taskName]).catch(() => ({
    code: 1,
    stdout: "",
    stderr: "",
  }));
  const del = await runner("powershell.exe", buildWindowsUnregisterTaskArgs(taskName));
  if (del.code !== 0) {
    throw new Error(`failed to delete login task: ${combineOutput(del)}`);
  }
  return { supported: true, removed: true, taskName };
}

export async function removeSourceRunLoginTask(
  opts: RemoveSourceRunLoginTaskOptions = {},
): Promise<RemoveSourceRunLoginTaskResult> {
  const platform = opts.platform ?? process.platform;
  const taskName = opts.taskName ?? defaultWindowsLoginTaskName();
  if (platform !== "win32") {
    return { supported: false, removed: false, taskName };
  }

  const runner = opts.runner ?? runCommand;
  const query = await queryLoginTask({ platform, taskName, runner });
  if (!query.installed) {
    return { supported: true, removed: false, taskName, skippedReason: "not-installed" };
  }

  const script = await readLoginTaskScript(opts.stateDir);
  if (!script) {
    return { supported: true, removed: false, taskName, skippedReason: "script-missing" };
  }
  if (!isSourceRunLoginTaskScript(script)) {
    return { supported: true, removed: false, taskName, skippedReason: "not-source-run" };
  }

  return await removeLoginTask({ platform, taskName, runner });
}

export async function queryLoginTask(
  opts: QueryLoginTaskOptions = {},
): Promise<QueryLoginTaskResult> {
  const platform = opts.platform ?? process.platform;
  const taskName = opts.taskName ?? defaultWindowsLoginTaskName();
  if (platform !== "win32") return { supported: false, installed: false, taskName };

  const runner = opts.runner ?? runCommand;
  const query = await runner("schtasks.exe", ["/Query", "/TN", taskName, "/FO", "LIST", "/V"]);
  if (query.code !== 0) return { supported: true, installed: false, taskName };
  return { supported: true, installed: true, taskName, raw: query.stdout || query.stderr };
}

export function defaultLoginTaskLaunch(
  argv = process.argv,
  execPath = process.execPath,
  cwd = process.cwd(),
): LoginTaskLaunch {
  const command = resolve(execPath);
  const base = basename(command).toLowerCase();
  if (isPackagedConnectorBinary(base)) {
    return { command, args: [], cwd: dirname(command) };
  }

  const scriptArg = argv[1];
  const script =
    scriptArg && !scriptArg.startsWith("-")
      ? resolve(cwd, scriptArg)
      : resolve(import.meta.dir, "bin.ts");
  return { command, args: ["run", script], cwd };
}

export function isPackagedConnectorBinary(base: string): boolean {
  return (
    /^cr[-_]connector(\.exe)?$/.test(base) ||
    /^cr[-_]connector[-_](win32|windows|darwin|linux|macos)[-_].*(\.exe)?$/.test(base)
  );
}

export function isSourceRunLoginTaskScript(script: string): boolean {
  const normalized = script.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("$argv = @('run'") &&
    normalized.includes("packages/pc-connector-daemon/src/bin.ts")
  );
}

/** Build args for `powershell.exe` that invoke Register-ScheduledTask under
 *  the current user's SID, replacing any prior task with the same name.
 *  The inner PowerShell script is passed via `-EncodedCommand` (UTF-16-LE
 *  base64) so we don't have to fight cmd.exe / powershell.exe quote rules
 *  for paths containing spaces or quotes. Decodable for testing via:
 *      Buffer.from(args.at(-1), "base64").toString("utf16le")  */
export function buildWindowsRegisterTaskArgs(taskName: string, scriptPath: string): string[] {
  const tn = singleQuoteForPowerShell(taskName);
  // The action's argument string passes -File "<scriptPath>" to powershell.
  // PowerShell -File parses standard Windows command-line quoting; doubling
  // any embedded `"` keeps a path with quotes intact.
  const argInner = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath.replace(/"/g, '""')}"`;
  const argEsc = singleQuoteForPowerShell(argInner);
  const psScript = [
    `$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${argEsc}`,
    "$trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries",
    `Register-ScheduledTask -TaskName ${tn} -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -Force | Out-Null`,
    "exit 0",
  ].join("; ");
  const b64 = Buffer.from(psScript, "utf16le").toString("base64");
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", b64];
}

export function buildWindowsUnregisterTaskArgs(taskName: string): string[] {
  const tn = singleQuoteForPowerShell(taskName);
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    `$task = Get-ScheduledTask -TaskName ${tn} -ErrorAction SilentlyContinue`,
    "if ($task) {",
    `  Unregister-ScheduledTask -TaskName ${tn} -Confirm:$false`,
    "}",
    "exit 0",
  ].join("; ");
  const b64 = Buffer.from(psScript, "utf16le").toString("base64");
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", b64];
}

function singleQuoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function windowsTaskAction(scriptPath: string): string {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath.replace(/"/g, '""')}"`;
}

export function buildWindowsLoginTaskScript(launch: LoginTaskLaunch, logPath: string): string {
  const logDir = dirname(logPath);
  const lockPath = join(logDir, WINDOWS_LOGIN_TASK_LOCK_NAME);
  const argv = launch.args.map(psSingleQuoted).join(", ");
  const envLines = Object.entries(launch.env ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `$env:${key} = ${psSingleQuoted(value)}`);
  return [
    "$ErrorActionPreference = 'Continue'",
    `$logDir = ${psSingleQuoted(logDir)}`,
    `$logFile = ${psSingleQuoted(logPath)}`,
    `$lockFile = ${psSingleQuoted(lockPath)}`,
    "New-Item -ItemType Directory -Force -Path $logDir | Out-Null",
    "$lockStream = $null",
    "try {",
    "  $lockStream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)",
    "} catch {",
    '  "[$(Get-Date -Format o)] another connector supervisor is already running; exiting" | Out-File -FilePath $logFile -Append -Encoding utf8',
    "  exit 0",
    "}",
    `$exe = ${psSingleQuoted(launch.command)}`,
    `$argv = @(${argv})`,
    `$cwd = ${psSingleQuoted(launch.cwd)}`,
    ...envLines,
    "try {",
    "while ($true) {",
    "  try {",
    "    Set-Location -LiteralPath $cwd",
    '    "[$(Get-Date -Format o)] starting cr-connector" | Out-File -FilePath $logFile -Append -Encoding utf8',
    "    & $exe @argv *>> $logFile",
    "    $code = $LASTEXITCODE",
    "  } catch {",
    "    $code = 1",
    '    "[$(Get-Date -Format o)] cr-connector launch failed: $($_.Exception.Message)" | Out-File -FilePath $logFile -Append -Encoding utf8',
    "  }",
    '  "[$(Get-Date -Format o)] cr-connector exited with code $code; restarting in 5 seconds" | Out-File -FilePath $logFile -Append -Encoding utf8',
    "  Start-Sleep -Seconds 5",
    "}",
    "} finally {",
    "  if ($lockStream) { $lockStream.Dispose() }",
    "}",
    "",
  ].join("\n");
}

export async function readLoginTaskScript(
  stateDir = defaultStateDir(),
): Promise<string | undefined> {
  try {
    return await readFile(join(stateDir, WINDOWS_LOGIN_TASK_SCRIPT_NAME), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolveResult, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function combineOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim() || `exit code ${result.code}`;
}
