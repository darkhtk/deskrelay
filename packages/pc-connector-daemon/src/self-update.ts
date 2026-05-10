import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { getDeskRelayBuildInfo } from "@deskrelay/shared/version";
import { queryLoginTask } from "./login-task.ts";

const execFileAsync = promisify(execFile);

export interface LocalConnectorUpdateResult {
  ok: true;
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
  warning?: string;
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
  const repoRoot = options.repoRoot ?? process.cwd();
  const branch = options.branch?.trim() || DEFAULT_BRANCH;
  const runner = options.runner ?? runCommand;
  const beforeBuild = getDeskRelayBuildInfo(repoRoot);
  const beforeCommit = await gitText(runner, repoRoot, ["rev-parse", "HEAD"]);

  if (!existsSync(`${repoRoot}/.git`) && !existsSync(`${repoRoot}\\.git`)) {
    throw new Error(`DeskRelay source checkout not found: ${repoRoot}`);
  }

  const dirty = await gitText(runner, repoRoot, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.trim()) {
    throw new Error(
      "Cannot update while tracked files have local changes. Commit or stash them, then retry.",
    );
  }

  await runner("git", ["fetch", "origin", branch], { cwd: repoRoot, timeoutMs: UPDATE_TIMEOUT_MS });
  const remoteCommit = await gitText(runner, repoRoot, ["rev-parse", `origin/${branch}`]);
  if (!remoteCommit) {
    throw new Error(`Could not resolve origin/${branch}.`);
  }

  if (remoteCommit !== beforeCommit) {
    await runner("git", ["pull", "--ff-only", "origin", branch], {
      cwd: repoRoot,
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
  }

  await runner("bun", ["install"], { cwd: repoRoot, timeoutMs: UPDATE_TIMEOUT_MS });
  const afterCommit = await gitText(runner, repoRoot, ["rev-parse", "HEAD"]);
  const loginTask = await (options.loginTaskStatus ?? defaultLoginTaskStatus)();
  const restartScheduled = Boolean(loginTask.supported && loginTask.installed);

  return {
    ok: true,
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
    ...(restartScheduled
      ? {}
      : {
          warning:
            "Connector updated, but no Windows login task was detected. Restart the connector manually.",
        }),
  };
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
