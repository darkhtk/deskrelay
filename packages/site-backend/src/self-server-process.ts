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
  const stopScript = join(input.repoRoot, "scripts", "self-pc-server-stop.ps1");
  const startScript = join(input.repoRoot, "scripts", "self-pc-server-start.ps1");
  return [
    "$ErrorActionPreference = 'Continue'",
    `$restartLogPath = ${quotePowerShell(input.logPath)}`,
    "function Invoke-LoggedScript {",
    "  param([string]$ScriptPath, [string[]]$Arguments)",
    "  & $ScriptPath @Arguments *>&1 | Out-File -Encoding utf8 -Append -FilePath $restartLogPath",
    "}",
    `"[ $((Get-Date).ToUniversalTime().ToString('o')) ] restart helper started for current site-backend pid=${input.currentPid}" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "Start-Sleep -Milliseconds 2500",
    `$currentSiteBackendPid = ${input.currentPid}`,
    "if ($currentSiteBackendPid -gt 0) {",
    `  "[$((Get-Date).ToUniversalTime().ToString('o'))] stopping current site-backend pid=$currentSiteBackendPid" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "  $currentSiteBackend = Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue",
    "  if ($currentSiteBackend) {",
    "    Stop-Process -Id $currentSiteBackendPid -Force -ErrorAction SilentlyContinue",
    "    $deadline = (Get-Date).AddSeconds(10)",
    "    while ((Get-Date) -lt $deadline -and (Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue)) {",
    "      Start-Sleep -Milliseconds 250",
    "    }",
    "    if (Get-Process -Id $currentSiteBackendPid -ErrorAction SilentlyContinue) {",
    "      throw \"Current site-backend pid=$currentSiteBackendPid is still running after restart stop request.\"",
    "    }",
    "  } else {",
    `    "[$((Get-Date).ToUniversalTime().ToString('o'))] current site-backend pid=$currentSiteBackendPid was already stopped" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
    "  }",
    "}",
    `Invoke-LoggedScript -ScriptPath ${quotePowerShell(stopScript)} -Arguments @('-Root', ${quotePowerShell(input.root)}, '-RepoRoot', ${quotePowerShell(input.repoRoot)})`,
    "Start-Sleep -Seconds 1",
    `Invoke-LoggedScript -ScriptPath ${quotePowerShell(startScript)} -Arguments @('-Root', ${quotePowerShell(input.root)}, '-RepoRoot', ${quotePowerShell(input.repoRoot)}, '-NoOpenBrowser')`,
    `"[ $((Get-Date).ToUniversalTime().ToString('o')) ] restart helper completed" | Out-File -Encoding utf8 -Append -FilePath ${quotePowerShell(input.logPath)}`,
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

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
