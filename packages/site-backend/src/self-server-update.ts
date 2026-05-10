import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface SelfServerUpdateStart {
  supported: boolean;
  started: boolean;
  logPath?: string;
  pid?: number;
  error?: string;
}

export interface SelfServerUpdater {
  update(): Promise<SelfServerUpdateStart>;
}

export interface PowerShellSelfServerUpdaterOptions {
  repoRoot: string;
  root: string;
  branch?: string;
}

export function createPowerShellSelfServerUpdater(
  options: PowerShellSelfServerUpdaterOptions,
): SelfServerUpdater {
  return {
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
      await mkdir(logDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logPath = join(logDir, `self-server-update-${stamp}.log`);
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
        ...(child.pid ? { pid: child.pid } : {}),
      };
    },
  };
}
