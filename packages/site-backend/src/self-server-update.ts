import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SelfServerUpdateState = "idle" | "running" | "succeeded" | "failed";

export interface SelfServerUpdateStatus {
  state: SelfServerUpdateState;
  startedAt?: string;
  completedAt?: string;
  logPath?: string;
  pid?: number;
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
  now?: () => Date;
  bootstrapLogGraceMs?: number;
  logIdleStaleMs?: number;
  runningStaleMs?: number;
}

const DEFAULT_BOOTSTRAP_LOG_GRACE_MS = 10_000;
const DEFAULT_LOG_IDLE_STALE_MS = 2 * 60_000;
const DEFAULT_RUNNING_STALE_MS = 20 * 60_000;

export function createPowerShellSelfServerUpdater(
  options: PowerShellSelfServerUpdaterOptions,
): SelfServerUpdater {
  const statusPath = join(options.root, "state", "self-server-update-status.json");
  const now = options.now ?? (() => new Date());
  const bootstrapLogGraceMs = options.bootstrapLogGraceMs ?? DEFAULT_BOOTSTRAP_LOG_GRACE_MS;
  const logIdleStaleMs = options.logIdleStaleMs ?? DEFAULT_LOG_IDLE_STALE_MS;
  const runningStaleMs = options.runningStaleMs ?? DEFAULT_RUNNING_STALE_MS;

  return {
    async status() {
      return await readStatusWithRecovery(statusPath, {
        now,
        bootstrapLogGraceMs,
        logIdleStaleMs,
        runningStaleMs,
      });
    },

    async update() {
      if (process.platform !== "win32") {
        return {
          supported: false,
          started: false,
          error: "self server one-click update is currently Windows-only",
        };
      }

      const current = await readStatusWithRecovery(statusPath, {
        now,
        bootstrapLogGraceMs,
        logIdleStaleMs,
        runningStaleMs,
      });
      if (current.state === "running") {
        return {
          supported: true,
          started: false,
          error: "self server update is already running",
          status: current,
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
      const pidPath = join(stateDir, `self-server-update-${stamp}.pid`);
      const bootstrapPath = join(logDir, `self-server-update-${stamp}.bootstrap.ps1`);
      const status: SelfServerUpdateStatus = {
        state: "running",
        startedAt: now().toISOString(),
        logPath,
      };
      await writeStatus(statusPath, status);
      await writeFile(
        bootstrapPath,
        buildUpdaterBootstrapScript({
          scriptPath,
          root: options.root,
          repoRoot: options.repoRoot,
          branch: options.branch?.trim() || "main",
          logPath,
          statusPath,
          pidPath,
        }),
        "utf8",
      );
      let child: ChildProcess;
      try {
        child = spawn(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", bootstrapPath],
          {
            cwd: options.repoRoot,
            stdio: "ignore",
            windowsHide: true,
          },
        );
      } catch (err) {
        const failed = markFailed(
          status,
          now(),
          `failed to start updater: ${(err as Error).message}`,
        );
        await writeStatus(statusPath, failed);
        return {
          supported: true,
          started: false,
          error: failed.error ?? "failed to start updater",
          status: failed,
        };
      }
      const exitCode = await waitForExit(child);
      if (exitCode !== 0) {
        const failed = markFailed(
          status,
          now(),
          `failed to bootstrap updater: exit code ${exitCode}`,
        );
        await writeStatus(statusPath, failed);
        return {
          supported: true,
          started: false,
          error: failed.error ?? "failed to bootstrap updater",
          status: failed,
        };
      }
      const updaterPid = await readPidFile(pidPath);
      const runningStatus: SelfServerUpdateStatus = updaterPid
        ? { ...status, pid: updaterPid }
        : status;
      await writeStatus(statusPath, runningStatus);
      return {
        supported: true,
        started: true,
        logPath,
        status: runningStatus,
        ...(updaterPid ? { pid: updaterPid } : {}),
      };
    },
  };
}

interface StatusRecoveryOptions {
  now: () => Date;
  bootstrapLogGraceMs: number;
  logIdleStaleMs: number;
  runningStaleMs: number;
}

interface BootstrapScriptOptions {
  scriptPath: string;
  root: string;
  repoRoot: string;
  branch: string;
  logPath: string;
  statusPath: string;
  pidPath: string;
}

function buildUpdaterBootstrapScript(options: BootstrapScriptOptions): string {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    options.scriptPath,
    "-Root",
    options.root,
    "-RepoRoot",
    options.repoRoot,
    "-Branch",
    options.branch,
    "-LogPath",
    options.logPath,
    "-StatusPath",
    options.statusPath,
    "-NoOpenBrowser",
  ];
  const psArgs = args.map((arg) => quotePowerShellString(arg)).join(", ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(${psArgs}) -WindowStyle Hidden -PassThru`,
    `$process.Id | Set-Content -Encoding utf8 -Path ${quotePowerShellString(options.pidPath)}`,
    "",
  ].join("\n");
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function waitForExit(child: ChildProcess): Promise<number | null> {
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function readPidFile(path: string): Promise<number | null> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const raw = (await readFile(path, "utf8")).replace(/^\uFEFF/, "").trim();
      const pid = Number(raw);
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // The bootstrap process may not have written the pid file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function readStatusWithRecovery(
  path: string,
  options: StatusRecoveryOptions,
): Promise<SelfServerUpdateStatus> {
  const current = await readStatus(path);
  if (current.state !== "running") return current;

  const recovered = await recoverRunningStatus(current, options);
  if (recovered === current) return current;
  await writeStatus(path, recovered);
  return recovered;
}

async function recoverRunningStatus(
  status: SelfServerUpdateStatus,
  options: StatusRecoveryOptions,
): Promise<SelfServerUpdateStatus> {
  const startedAt = Date.parse(status.startedAt ?? "");
  if (!Number.isFinite(startedAt)) {
    return markFailed(
      status,
      options.now(),
      "self server update has an invalid startedAt timestamp",
    );
  }

  const ageMs = Math.max(0, options.now().getTime() - startedAt);
  if (typeof status.pid === "number" && !isProcessRunning(status.pid)) {
    return markFailed(
      status,
      options.now(),
      "self server update process is no longer running. Check the log and retry.",
    );
  }

  if (status.logPath) {
    try {
      const logStat = await stat(status.logPath);
      const logIdleMs = Math.max(0, options.now().getTime() - logStat.mtimeMs);
      if (
        typeof status.pid !== "number" &&
        ageMs > options.logIdleStaleMs &&
        logIdleMs > options.logIdleStaleMs
      ) {
        return markFailed(
          status,
          options.now(),
          "self server update stopped writing logs before it completed. Retry the update.",
        );
      }
    } catch {
      if (ageMs > options.bootstrapLogGraceMs) {
        return markFailed(
          status,
          options.now(),
          "self server update process exited before writing a log. Retry the update.",
        );
      }
    }
  }

  if (ageMs > options.runningStaleMs) {
    return markFailed(
      status,
      options.now(),
      "self server update did not finish within the expected time. Check the log and retry.",
    );
  }

  return status;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

function markFailed(
  status: SelfServerUpdateStatus,
  completedAt: Date,
  error: string,
): SelfServerUpdateStatus {
  return {
    ...status,
    state: "failed",
    completedAt: completedAt.toISOString(),
    error,
  };
}

async function readStatus(path: string): Promise<SelfServerUpdateStatus> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as Partial<SelfServerUpdateStatus>;
    if (parsed.state === "running" || parsed.state === "succeeded" || parsed.state === "failed") {
      return {
        state: parsed.state,
        ...(typeof parsed.startedAt === "string" ? { startedAt: parsed.startedAt } : {}),
        ...(typeof parsed.completedAt === "string" ? { completedAt: parsed.completedAt } : {}),
        ...(typeof parsed.logPath === "string" ? { logPath: parsed.logPath } : {}),
        ...(typeof parsed.pid === "number" ? { pid: parsed.pid } : {}),
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
