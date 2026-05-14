import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
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
      const restartLogPath = join(logDir, "self-server-restart.log");
      const script = buildRestartScript({
        repoRoot: options.repoRoot,
        root: options.root,
        logPath,
      });
      try {
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          event: "restart-requested",
          pid: process.pid,
        }) + "\n";
        await appendFile(restartLogPath, entry, "utf8");
      } catch { /* never block restart on audit failure */ }
      let logFd: number | undefined;
      try {
        logFd = openSync(logPath, "a");
      } catch (err) {
        console.warn("self-server-restart.log fd open failed:", (err as Error).message);
      }
      const child = spawn("powershell.exe", restartBootstrapArgs(script), {
        cwd: options.repoRoot,
        detached: true,
        stdio: logFd !== undefined ? ["ignore", logFd, logFd] : "ignore",
        windowsHide: true,
      });
      child.on("error", (err) => {
        appendFile(restartLogPath, JSON.stringify({
          ts: new Date().toISOString(),
          event: "spawn-error",
          error: err.message,
        }) + "\n", "utf8").catch(() => {});
        if (logFd !== undefined) { try { closeSync(logFd); } catch { /* noop */ } }
      });
      child.on("exit", (code, signal) => {
        appendFile(restartLogPath, JSON.stringify({
          ts: new Date().toISOString(),
          event: "spawn-exit",
          code,
          signal,
        }) + "\n", "utf8").catch(() => {});
        if (logFd !== undefined) { try { closeSync(logFd); } catch { /* noop */ } }
      });
      child.unref();
      return {
        supported: true,
        accepted: true,
        message: "self-server restart requested",
        logPath,
        ...(child.pid ? { pid: child.pid } : {}),
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

function buildRestartScript(input: { repoRoot: string; root: string; logPath: string }): string {
  const stopScript = join(input.repoRoot, "scripts", "self-pc-server-stop.ps1");
  const startScript = join(input.repoRoot, "scripts", "self-pc-server-start.ps1");
  return [
    "$ErrorActionPreference = 'Continue'",
    "Start-Sleep -Milliseconds 500",
    `& ${quotePowerShell(stopScript)} -Root ${quotePowerShell(input.root)} -RepoRoot ${quotePowerShell(input.repoRoot)} *>> ${quotePowerShell(input.logPath)}`,
    "Start-Sleep -Seconds 1",
    `& ${quotePowerShell(startScript)} -Root ${quotePowerShell(input.root)} -RepoRoot ${quotePowerShell(input.repoRoot)} -NoOpenBrowser *>> ${quotePowerShell(input.logPath)}`,
  ].join("\n");
}

function restartBootstrapArgs(script: string): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
