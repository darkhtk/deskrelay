import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { type DiagnosticStep, type UpdateState, normalizeDiagnosticStep } from "@deskrelay/shared";
import { getDeskRelayBuildInfo } from "@deskrelay/shared/version";
import { queryLoginTask } from "./login-task.ts";

const execFileAsync = promisify(execFile);

export interface LocalConnectorUpdateResult {
  ok: true;
  state: Extract<UpdateState, "succeeded" | "restart_required">;
  repoRoot: string;
  branch: string;
  before: {
    commit: string;
    shortCommit: string;
    dirty: boolean;
  };
  after: {
    commit: string;
    shortCommit: string;
  };
  changed: boolean;
  loginTask: {
    supported: boolean;
    installed: boolean;
    taskName: string;
  };
  restartScheduled: boolean;
  restartRequested: boolean;
  restartRequestError?: string;
  warning?: string;
  steps: DiagnosticStep[];
}

export interface LocalConnectorUpdateOptions {
  repoRoot?: string;
  branch?: string;
  runner?: CommandRunner;
  loginTaskStatus?: () => Promise<{
    supported: boolean;
    installed: boolean;
    taskName: string;
  }>;
  restartLoginTask?: (taskName: string) => Promise<{ ok: boolean; error?: string }>;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

const DEFAULT_BRANCH = "main";
const UPDATE_TIMEOUT_MS = 120_000;

export async function updateLocalSourceConnector(
  options: LocalConnectorUpdateOptions = {},
): Promise<LocalConnectorUpdateResult> {
  const steps: DiagnosticStep[] = [];
  const repoRoot = options.repoRoot ?? process.cwd();
  const runner = options.runner ?? runCommand;
  const requestedBranch = options.branch?.trim();
  const branch = normalizeUpdateBranch(
    requestedBranch || (await readCurrentGitBranch(runner, repoRoot)),
  );
  const beforeBuild = getDeskRelayBuildInfo(repoRoot);
  const beforeCommit = await gitText(runner, repoRoot, ["rev-parse", "HEAD"]);

  if (!existsSync(`${repoRoot}/.git`) && !existsSync(`${repoRoot}\\.git`)) {
    throw new Error(`DeskRelay source checkout not found: ${repoRoot}`);
  }
  addUpdateStep(steps, "repo", "source checkout", "ok", `using ${repoRoot}`);

  const dirty = await gitText(runner, repoRoot, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.trim()) {
    throw new Error(
      "Cannot update while tracked files have local changes. Commit or stash them, then retry.",
    );
  }
  addUpdateStep(steps, "working-tree", "working tree", "ok", "no tracked local changes");

  await runner("git", ["fetch", "origin", branch], { cwd: repoRoot, timeoutMs: UPDATE_TIMEOUT_MS });
  addUpdateStep(steps, "git-fetch", "git fetch", "ok", `fetched origin/${branch}`);
  const remoteCommit = await gitText(runner, repoRoot, ["rev-parse", `origin/${branch}`]);
  if (!remoteCommit) {
    throw new Error(`Could not resolve origin/${branch}.`);
  }

  if (remoteCommit !== beforeCommit) {
    await runner("git", ["pull", "--ff-only", "origin", branch], {
      cwd: repoRoot,
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    addUpdateStep(
      steps,
      "git-pull",
      "git pull",
      "repaired",
      `fast-forwarded ${shortCommit(beforeCommit)} to ${shortCommit(remoteCommit)}`,
    );
  } else {
    addUpdateStep(steps, "git-pull", "git pull", "skipped", "already at origin head");
  }

  await runner("bun", ["install"], { cwd: repoRoot, timeoutMs: UPDATE_TIMEOUT_MS });
  addUpdateStep(steps, "dependencies", "dependencies", "ok", "bun install completed");
  const afterCommit = await gitText(runner, repoRoot, ["rev-parse", "HEAD"]);
  const loginTask = await (options.loginTaskStatus ?? defaultLoginTaskStatus)();
  const restartScheduled = Boolean(loginTask.supported && loginTask.installed);
  addUpdateStep(
    steps,
    "login-task",
    "login task",
    restartScheduled ? "ok" : "warn",
    restartScheduled
      ? `${loginTask.taskName} is installed`
      : "connector login task was not detected",
    restartScheduled
      ? { retrySafe: true }
      : { action: "Restart the connector manually after the update.", retrySafe: true },
  );
  const restartRequest = restartScheduled
    ? await (options.restartLoginTask ?? defaultRestartLoginTask)(loginTask.taskName).catch(
        (err) => ({
          ok: false,
          error: (err as Error).message,
        }),
      )
    : { ok: false };
  const restartRequested = restartRequest.ok === true;
  const restartRequestError = restartRequest.ok ? undefined : restartRequest.error;
  addUpdateStep(
    steps,
    "restart",
    "connector restart",
    restartRequested ? "ok" : "warn",
    restartRequested
      ? "restart was requested through the login task"
      : restartRequestError
        ? `restart request failed: ${restartRequestError}`
        : "manual restart is required",
    restartRequested
      ? { retrySafe: true }
      : {
          action: restartRequestError
            ? "Restart the DeskRelay Connector login task manually, then refresh diagnostics."
            : "Start the connector manually or install the login task.",
          retrySafe: true,
        },
  );
  const state: Extract<UpdateState, "succeeded" | "restart_required"> =
    restartScheduled && restartRequested ? "succeeded" : "restart_required";

  return {
    ok: true,
    state,
    repoRoot,
    branch,
    before: {
      commit: beforeCommit || beforeBuild.commit,
      shortCommit: shortCommit(beforeCommit || beforeBuild.commit),
      dirty: beforeBuild.dirty,
    },
    after: {
      commit: afterCommit || remoteCommit,
      shortCommit: shortCommit(afterCommit || remoteCommit),
    },
    changed: Boolean(beforeCommit && afterCommit && beforeCommit !== afterCommit),
    loginTask: {
      supported: loginTask.supported,
      installed: loginTask.installed,
      taskName: loginTask.taskName,
    },
    restartScheduled,
    restartRequested,
    ...(restartRequestError ? { restartRequestError } : {}),
    ...(!restartScheduled
      ? {
          warning:
            "Connector updated, but no Windows login task was detected. Restart the connector manually.",
        }
      : {}),
    ...(restartScheduled && restartRequestError
      ? {
          warning: `Connector updated, but automatic restart request failed: ${restartRequestError}`,
        }
      : {}),
    steps,
  };
}

async function readCurrentGitBranch(runner: CommandRunner, repoRoot: string): Promise<string> {
  const current = await gitText(runner, repoRoot, ["branch", "--show-current"]).catch(() => "");
  if (current) return current;
  const fallback = await gitText(runner, repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(
    () => "",
  );
  return fallback && fallback !== "HEAD" ? fallback : DEFAULT_BRANCH;
}

function normalizeUpdateBranch(value: string): string {
  const branch = value.trim();
  if (
    !branch ||
    branch.length > 200 ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    throw new Error(`Invalid update branch: ${value}`);
  }
  return branch;
}

function addUpdateStep(
  steps: DiagnosticStep[],
  id: string,
  label: string,
  status: DiagnosticStep["status"],
  summary: string,
  options: { action?: string; retrySafe?: boolean } = {},
): void {
  steps.push(
    normalizeDiagnosticStep({
      id,
      label,
      status,
      summary,
      ...(options.action ? { action: options.action } : {}),
      ...(options.retrySafe ? { retrySafe: true } : {}),
      source: "updater",
      lastCheckedAt: new Date().toISOString(),
    }),
  );
}

async function defaultLoginTaskStatus(): Promise<{
  supported: boolean;
  installed: boolean;
  taskName: string;
}> {
  return await queryLoginTask().catch(() => ({
    supported: process.platform === "win32",
    installed: false,
    taskName: "DeskRelay Connector",
  }));
}

async function defaultRestartLoginTask(taskName: string): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32")
    return { ok: false, error: "Windows login task is unsupported" };
  try {
    const helper = spawn("powershell.exe", buildDeferredLoginTaskRestartArgs(taskName), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    helper.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function gitText(runner: CommandRunner, cwd: string, args: string[]): Promise<string> {
  const { stdout } = await runner("git", args, { cwd, timeoutMs: UPDATE_TIMEOUT_MS });
  return stdout.trim();
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

function shortCommit(commit: string): string {
  return commit && commit !== "unknown" ? commit.slice(0, 12) : "unknown";
}

function buildDeferredLoginTaskRestartArgs(taskName: string): string[] {
  const tn = psSingleQuoted(taskName);
  const psScript = [
    "$ErrorActionPreference = 'Continue'",
    "Start-Sleep -Milliseconds 750",
    `schtasks.exe /End /TN ${tn} *> $null`,
    "Start-Sleep -Milliseconds 500",
    `schtasks.exe /Run /TN ${tn} *> $null`,
  ].join("; ");
  return [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
    Buffer.from(psScript, "utf16le").toString("base64"),
  ];
}

function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
