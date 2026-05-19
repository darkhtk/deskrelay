import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import type {
  ManagerProcessComponent,
  ManagerProcessStatus,
  ManagerRestartResult,
} from "@deskrelay/shared";
import { getDeskRelayBuildInfo } from "@deskrelay/shared/version";
import type { SelfServerAutostartStatus } from "./self-server-autostart.ts";

export interface SelfServerProcessController {
  status(): Promise<ManagerProcessStatus>;
  restart(): Promise<ManagerRestartResult>;
}

export interface PowerShellSelfServerProcessControllerOptions {
  repoRoot: string;
  root: string;
  processFile?: string;
  logDir?: string;
  autostartStatus?: () => Promise<SelfServerAutostartStatus>;
  gracefulShutdown?: () => void;
}

const SERVER_STARTED_AT = new Date().toISOString();

export function createPowerShellSelfServerProcessController(
  options: PowerShellSelfServerProcessControllerOptions,
): SelfServerProcessController {
  const processFile = options.processFile ?? join(options.root, "state", "dev-processes.json");
  const logDir = options.logDir ?? join(options.root, "logs");

  return {
    async status() {
      const components = await readProcessComponents(processFile);
      const autostart = await options.autostartStatus?.().catch((err) => ({
        supported: process.platform === "win32",
        installed: false,
        taskName: "DeskRelay Self Server",
        error: (err as Error).message,
      }));
      return {
        scope: "server",
        kind: "site-server",
        build: getDeskRelayBuildInfo(options.repoRoot),
        pid: process.pid,
        startedAt: SERVER_STARTED_AT,
        uptimeMs: Math.max(0, Date.now() - Date.parse(SERVER_STARTED_AT)),
        platform: process.platform,
        arch: process.arch,
        ...(components.length > 0 ? { components } : {}),
        ...(autostart
          ? {
              autostart: {
                supported: autostart.supported,
                installed: autostart.installed,
                taskName: autostart.taskName,
                ...(autostart.error ? { error: autostart.error } : {}),
              },
            }
          : {}),
      };
    },

    async restart() {
      if (process.platform !== "win32") {
        return {
          supported: false,
          accepted: false,
          message: "self-server restart is currently Windows-only",
        };
      }
      await mkdir(logDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logPath = join(logDir, `self-server-restart-${stamp}.log`);
      const scriptPath = join(logDir, `self-server-restart-${stamp}.ps1`);
      const launcherPath = join(logDir, `self-server-restart-${stamp}.launcher.ps1`);
      const pidPath = join(logDir, `self-server-restart-${stamp}.pid`);
      const restartLogPath = join(logDir, "self-server-restart.log");
      const script = buildRestartScript({
        repoRoot: options.repoRoot,
        root: options.root,
        logPath,
        currentPid: process.pid,
      });
      await writeFile(scriptPath, script, "utf8");
      await writeFile(
        launcherPath,
        buildRestartLauncherScript({
          repoRoot: options.repoRoot,
          scriptPath,
          pidPath,
          restartLogPath,
        }),
        "utf8",
      );
      try {
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          event: "restart-requested",
          pid: process.pid,
          scriptPath,
          launcherPath,
        }) + "\n";
        await appendFile(restartLogPath, entry, "utf8");
      } catch { /* never block restart on audit failure */ }
      let child;
      try {
        child = spawn("powershell.exe", restartScriptArgs(launcherPath), {
          cwd: options.repoRoot,
          stdio: "ignore",
          windowsHide: true,
        });
      } catch (err) {
        const message = `failed to launch self-server restart helper: ${(err as Error).message}`;
        await appendFile(restartLogPath, JSON.stringify({
          ts: new Date().toISOString(),
          event: "spawn-throw",
          error: message,
        }) + "\n", "utf8").catch(() => {});
        return {
          supported: true,
          accepted: false,
          message,
          logPath,
          previousPid: process.pid,
        };
      }
      child.on("error", (err) => {
        appendFile(restartLogPath, JSON.stringify({
          ts: new Date().toISOString(),
          event: "spawn-error",
          error: err.message,
        }) + "\n", "utf8").catch(() => {});
      });
      child.on("exit", (code, signal) => {
        appendFile(restartLogPath, JSON.stringify({
          ts: new Date().toISOString(),
          event: "spawn-exit",
          code,
          signal,
        }) + "\n", "utf8").catch(() => {});
      });
      child.unref();
      const helperPid = await readPidFile(pidPath, 1_200);
      scheduleGracefulShutdown(options.gracefulShutdown, restartLogPath);
      return {
        supported: true,
        accepted: true,
        message: "self-server restart requested",
        logPath,
        ...(helperPid !== null ? { pid: helperPid } : child.pid ? { pid: child.pid } : {}),
        previousPid: process.pid,
      };
    },
  };
}

async function readProcessComponents(processFile: string): Promise<ManagerProcessComponent[]> {
  let raw: string;
  try {
    raw = await readFile(processFile, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripUtf8Bom(raw));
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const components = await Promise.all(rows.map((row) => normalizeProcessComponent(row)));
  return components.filter((row): row is ManagerProcessComponent => row !== null);
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

async function normalizeProcessComponent(value: unknown): Promise<ManagerProcessComponent | null> {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "process";
  const pid = typeof row.pid === "number" && Number.isInteger(row.pid) ? row.pid : undefined;
  const logPath = typeof row.log === "string" && row.log.trim() ? row.log.trim() : undefined;
  const alive = pid ? isProcessRunning(pid) : false;
  const endpoint = expectedComponentEndpoint(name);
  const portReachable = endpoint
    ? await probeTcpPort(endpoint.host, endpoint.port, 300)
    : undefined;
  return {
    name,
    ...(pid ? { pid } : {}),
    alive,
    ...(logPath ? { logPath } : {}),
    ...componentDetail({ pid, alive, endpoint, portReachable }),
  };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

function expectedComponentEndpoint(name: string): { host: string; port: number } | undefined {
  const normalized = name.toLowerCase();
  if (normalized === "daemon" && process.env.CR_CONNECTOR_PORT) {
    return { host: "127.0.0.1", port: Number(process.env.CR_CONNECTOR_PORT) };
  }
  if (normalized === "site-backend" && process.env.CR_SITE_PORT) {
    return { host: "127.0.0.1", port: Number(process.env.CR_SITE_PORT) };
  }
  if (normalized === "site-frontend" && process.env.CR_DEV_FRONTEND_URL) {
    try {
      const url = new URL(process.env.CR_DEV_FRONTEND_URL);
      return { host: "127.0.0.1", port: url.port ? Number(url.port) : 80 };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function componentDetail(input: {
  pid: number | undefined;
  alive: boolean;
  endpoint: { host: string; port: number } | undefined;
  portReachable: boolean | undefined;
}): Pick<ManagerProcessComponent, "detail"> {
  if (!input.pid) return { detail: "pid not recorded" };
  if (!input.alive) return { detail: "recorded pid is not running" };
  if (input.endpoint && !input.portReachable) {
    return {
      detail: `process is running but ${input.endpoint.host}:${input.endpoint.port} is not reachable`,
    };
  }
  if (input.endpoint && input.portReachable) {
    return { detail: `process and ${input.endpoint.host}:${input.endpoint.port} are reachable` };
  }
  return {};
}

function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function buildRestartScript(input: {
  repoRoot: string;
  root: string;
  logPath: string;
  currentPid: number;
}): string {
  const envFile = join(input.root, "dev.env.ps1");
  const processFile = join(input.root, "state", "dev-processes.json");
  const backendLog = join(input.root, "logs", "site-backend.log");
  const backendRunner = join(input.root, "logs", "site-backend.runner.ps1");
  const daemonLog = join(input.root, "logs", "daemon.log");
  const daemonRunner = join(input.root, "logs", "daemon.runner.ps1");
  const frontendLog = join(input.root, "logs", "site-frontend.log");
  const frontendRunner = join(input.root, "logs", "site-frontend.runner.ps1");
  return [
    "$ErrorActionPreference = 'Continue'",
    `$restartLogPath = ${quotePowerShell(input.logPath)}`,
    `"[ $((Get-Date).ToUniversalTime().ToString('o')) ] restart helper started for current site-backend pid=${input.currentPid}" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "Start-Sleep -Milliseconds 2500",
    `$currentSiteBackendPid = ${input.currentPid}`,
    "if ($currentSiteBackendPid -gt 0) {",
    `  "[$((Get-Date).ToUniversalTime().ToString('o'))] waiting for current site-backend pid=$currentSiteBackendPid to stop" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "  $currentSiteBackend = Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue",
    "  if ($currentSiteBackend) {",
    "    $deadline = (Get-Date).AddSeconds(20)",
    "    while ((Get-Date) -lt $deadline -and (Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue)) {",
    "      Start-Sleep -Milliseconds 250",
    "    }",
    "    if (Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue) {",
    `      "[$((Get-Date).ToUniversalTime().ToString('o'))] current site-backend pid=$currentSiteBackendPid did not stop gracefully; forcing stop" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "      Stop-Process -Id $currentSiteBackendPid -Force -ErrorAction SilentlyContinue",
    "      $forceDeadline = (Get-Date).AddSeconds(10)",
    "      while ((Get-Date) -lt $forceDeadline -and (Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue)) {",
    "        Start-Sleep -Milliseconds 250",
    "      }",
    "      if (Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue) {",
    "        throw \"Current site-backend pid=$currentSiteBackendPid is still running after forced restart stop request.\"",
    "      }",
    "    } else {",
    `      "[$((Get-Date).ToUniversalTime().ToString('o'))] current site-backend pid=$currentSiteBackendPid stopped gracefully" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "    }",
    "  } else {",
    `    "[$((Get-Date).ToUniversalTime().ToString('o'))] current site-backend pid=$currentSiteBackendPid was already stopped" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "  }",
    "}",
    `$backendRunner = ${quotePowerShell(backendRunner)}`,
    "if (-not (Test-Path -LiteralPath $backendRunner)) {",
    "  throw \"site-backend runner not found: $backendRunner\"",
    "}",
    "$backendProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $backendRunner) -WindowStyle Hidden -PassThru",
    `"[ $((Get-Date).ToUniversalTime().ToString('o')) ] started site-backend runner pid=$($backendProcess.Id)" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    updateBackendProcessFileScript({
      processFile,
      backendLog,
      backendRunner,
      daemonLog,
      daemonRunner,
      frontendLog,
      frontendRunner,
    }),
    `. ${quotePowerShell(envFile)}`,
    "$siteHealthUrl = \"$env:CR_DEV_SITE_URL/healthz\"",
    "$deadline = (Get-Date).AddSeconds(25)",
    "$lastHealthError = $null",
    "$siteReady = $false",
    "while ((Get-Date) -lt $deadline) {",
    "  try {",
    "    Invoke-RestMethod -Method Get -Uri $siteHealthUrl -TimeoutSec 2 | Out-Null",
    "    $siteReady = $true",
    "    break",
    "  } catch {",
    "    $lastHealthError = $_.Exception.Message",
    "    Start-Sleep -Milliseconds 500",
    "  }",
    "}",
    "if (-not $siteReady) {",
    "  throw \"Timed out waiting for restarted site-backend at $siteHealthUrl. Last error: $lastHealthError\"",
    "}",
    `"[ $((Get-Date).ToUniversalTime().ToString('o')) ] restart helper completed" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
  ].join("\n");
}

function updateBackendProcessFileScript(input: {
  processFile: string;
  backendLog: string;
  backendRunner: string;
  daemonLog: string;
  daemonRunner: string;
  frontendLog: string;
  frontendRunner: string;
}): string {
  return [
    `$processFile = ${quotePowerShell(input.processFile)}`,
    "$startedAt = (Get-Date).ToUniversalTime().ToString('o')",
    "function Find-RunnerEntry {",
    "  param([string]$Name, [string]$Command, [string]$LogPath, [string]$RunnerPath)",
    "  $runnerProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
    "    $cmd = [string]$_.CommandLine",
    "    $cmd -like \"*${RunnerPath}*\" -and $cmd -like '*-File*' -and $cmd -notlike '*-Command*' -and [int]$_.ProcessId -ne $PID",
    "  } | Sort-Object CreationDate -Descending | Select-Object -First 1",
    "  if (-not $runnerProcess) { return $null }",
    "  return [pscustomobject]@{",
    "    name = $Name",
    "    pid = [int]$runnerProcess.ProcessId",
    "    command = $Command",
    "    log = $LogPath",
    "    runner = $RunnerPath",
    "    startedAt = $startedAt",
    "  }",
    "}",
    "$backendEntry = [pscustomobject]@{",
    "  name = 'site-backend'",
    "  pid = $backendProcess.Id",
    "  command = 'bun run packages/site-backend/src/bin.ts'",
    `  log = ${quotePowerShell(input.backendLog)}`,
    `  runner = ${quotePowerShell(input.backendRunner)}`,
    "  startedAt = $startedAt",
    "}",
    `$daemonEntry = Find-RunnerEntry -Name 'daemon' -Command 'bun run packages/pc-connector-daemon/src/bin.ts' -LogPath ${quotePowerShell(input.daemonLog)} -RunnerPath ${quotePowerShell(input.daemonRunner)}`,
    `$frontendEntry = Find-RunnerEntry -Name 'site-frontend' -Command 'bun --filter @deskrelay/site-frontend dev -- --host 0.0.0.0 --port 18193' -LogPath ${quotePowerShell(input.frontendLog)} -RunnerPath ${quotePowerShell(input.frontendRunner)}`,
    "$entries = @()",
    "if (Test-Path -LiteralPath $processFile) {",
    "  try {",
    "    $raw = Get-Content -Raw -LiteralPath $processFile",
    "    if (-not [string]::IsNullOrWhiteSpace($raw)) {",
    "      $parsed = ConvertFrom-Json -InputObject $raw",
    "      $entries = @($parsed)",
    "    }",
    "  } catch {",
    "    $entries = @()",
    "  }",
    "}",
    "$entryMap = @{}",
    "foreach ($entry in $entries) {",
    "  if ($entry.name) {",
    "    $entryMap[[string]$entry.name] = $entry",
    "  }",
    "}",
    "if ($daemonEntry) { $entryMap['daemon'] = $daemonEntry }",
    "$entryMap['site-backend'] = $backendEntry",
    "if ($frontendEntry) { $entryMap['site-frontend'] = $frontendEntry }",
    "$updated = @()",
    "foreach ($name in @('daemon', 'site-backend', 'site-frontend')) {",
    "  if ($entryMap.ContainsKey($name)) { $updated += $entryMap[$name] }",
    "}",
    "foreach ($entry in $entries) {",
    "  if ($entry.name -and @('daemon', 'site-backend', 'site-frontend') -notcontains [string]$entry.name) {",
    "    $updated += $entry",
    "  }",
    "}",
    "ConvertTo-Json -InputObject @($updated) -Depth 4 | Set-Content -Encoding utf8 -Path $processFile",
  ].join("\n");
}

function buildRestartLauncherScript(input: {
  repoRoot: string;
  scriptPath: string;
  pidPath: string;
  restartLogPath: string;
}): string {
  const psArgs = restartScriptArgs(input.scriptPath).map((arg) => quotePowerShell(arg)).join(", ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(${psArgs}) -WorkingDirectory ${quotePowerShell(input.repoRoot)} -WindowStyle Hidden -PassThru`,
    `$process.Id | Set-Content -Encoding utf8 -Path ${quotePowerShell(input.pidPath)}`,
    `$entry = @{ ts = (Get-Date).ToUniversalTime().ToString('o'); event = 'helper-started'; pid = $process.Id; scriptPath = ${quotePowerShell(input.scriptPath)} } | ConvertTo-Json -Compress`,
    `$entry | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.restartLogPath)}`,
    "",
  ].join("\n");
}

function restartScriptArgs(scriptPath: string): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    scriptPath,
  ];
}

async function readPidFile(path: string, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = (await readFile(path, "utf8")).replace(/^\uFEFF/, "").trim();
      const pid = Number(raw);
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // The launcher may not have written the helper pid yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function scheduleGracefulShutdown(
  gracefulShutdown: (() => void) | undefined,
  restartLogPath: string,
): void {
  if (!gracefulShutdown) return;
  const timer = setTimeout(() => {
    try {
      gracefulShutdown();
    } catch (err) {
      appendFile(restartLogPath, JSON.stringify({
        ts: new Date().toISOString(),
        event: "graceful-shutdown-error",
        error: (err as Error).message,
      }) + "\n", "utf8").catch(() => {});
    }
  }, 600);
  (timer as { unref?: () => void }).unref?.();
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
