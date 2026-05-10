import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SelfServerUpdateState = "idle" | "running" | "succeeded" | "failed";

export interface SelfServerUpdateStatus {
  state: SelfServerUpdateState;
  startedAt?: string;
  completedAt?: string;
  logPath?: string;
  before?: string;
  after?: string;
  changed?: boolean;
  error?: string;
}

export interface SelfServerUpdateStart {
  supported: boolean;
  started: boolean;
  logPath?: string;
  pid?: number;
  error?: string;
  status?: SelfServerUpdateStatus;
}

export interface SelfServerUpdater {
  update(): Promise<SelfServerUpdateStart>;
  status(): Promise<SelfServerUpdateStatus>;
}

export interface PowerShellSelfServerUpdaterOptions {
  repoRoot: string;
  root: string;
  branch?: string;
}

export function createPowerShellSelfServerUpdater(
  options: PowerShellSelfServerUpdaterOptions,
): SelfServerUpdater {
  const statusPath = join(options.root, "state", "self-server-update-status.json");

  return {
    async status() {
      return await readStatus(statusPath);
    },

    async update() {
      if (process.platform !== "win32") {
        return {
          supported: false,
          started: false,
          error: "self server one-click update is currently Windows-only",
        };
      }

      const scriptPath = join(options.repoRoot, "scripts", "self-pc-server-update.ps1");
      if (!existsSync(scriptPath)) {
        return {
          supported: true,
          started: false,
          error: `update script not found: ${scriptPath}`,
        };
      }

      const logDir = join(options.root, "logs");
      const stateDir = join(options.root, "state");
      await mkdir(logDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logPath = join(logDir, `self-server-update-${stamp}.log`);
      const status: SelfServerUpdateStatus = {
        state: "running",
        startedAt: new Date().toISOString(),
        logPath,
      };
      await writeStatus(statusPath, status);
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-File",
          scriptPath,
          "-Root",
          options.root,
          "-RepoRoot",
          options.repoRoot,
          "-Branch",
          options.branch?.trim() || "main",
          "-LogPath",
          logPath,
          "-StatusPath",
          statusPath,
          "-NoOpenBrowser",
        ],
        {
          cwd: options.repoRoot,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      child.unref();
      return {
        supported: true,
        started: true,
        logPath,
        status,
        ...(child.pid ? { pid: child.pid } : {}),
      };
    },
  };
}

async function readStatus(path: string): Promise<SelfServerUpdateStatus> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<SelfServerUpdateStatus>;
    if (parsed.state === "running" || parsed.state === "succeeded" || parsed.state === "failed") {
      return {
        state: parsed.state,
        ...(typeof parsed.startedAt === "string" ? { startedAt: parsed.startedAt } : {}),
        ...(typeof parsed.completedAt === "string" ? { completedAt: parsed.completedAt } : {}),
        ...(typeof parsed.logPath === "string" ? { logPath: parsed.logPath } : {}),
        ...(typeof parsed.before === "string" ? { before: parsed.before } : {}),
        ...(typeof parsed.after === "string" ? { after: parsed.after } : {}),
        ...(typeof parsed.changed === "boolean" ? { changed: parsed.changed } : {}),
        ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
      };
    }
  } catch {
    // Missing or malformed status means no update has been requested yet.
  }
  return { state: "idle" };
}

async function writeStatus(path: string, status: SelfServerUpdateStatus): Promise<void> {
  await writeFile(path, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}
