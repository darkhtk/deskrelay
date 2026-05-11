import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
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
      const script = buildRestartScript({
        repoRoot: options.repoRoot,
        root: options.root,
        logPath,
      });
      const child = spawn("powershell.exe", restartBootstrapArgs(script), {
        cwd: options.repoRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
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
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .map((row) => normalizeProcessComponent(row))
    .filter((row): row is ManagerProcessComponent => row !== null);
}

function normalizeProcessComponent(value: unknown): ManagerProcessComponent | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "process";
  const pid = typeof row.pid === "number" && Number.isInteger(row.pid) ? row.pid : undefined;
  const logPath = typeof row.log === "string" && row.log.trim() ? row.log.trim() : undefined;
  return {
    name,
    ...(pid ? { pid } : {}),
    alive: pid ? isProcessRunning(pid) : false,
    ...(logPath ? { logPath } : {}),
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
