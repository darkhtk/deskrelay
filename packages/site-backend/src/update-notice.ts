import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type DeskRelayBuildInfo, getDeskRelayBuildInfo } from "@deskrelay/shared/version";

const execFileAsync = promisify(execFile);

export interface UpdateNoticePayload {
  message: string;
  level?: "info" | "warning";
}

export interface UpdateNoticeSource {
  read(): Promise<UpdateNoticePayload | null>;
}

export interface GitUpdateNoticeOptions {
  repoRoot: string;
  branch?: string;
  nextVersion?: string;
  pollMs?: number;
  timeoutMs?: number;
  build?: DeskRelayBuildInfo;
  runner?: GitCommandRunner;
}

const DEFAULT_BRANCH = "main";
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 2_000;

type GitCommandRunner = (
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string }>;

export function createGitUpdateNoticeSource(options: GitUpdateNoticeOptions): UpdateNoticeSource {
  const branch = options.branch?.trim() || DEFAULT_BRANCH;
  const pollMs = options.pollMs && options.pollMs > 0 ? options.pollMs : DEFAULT_POLL_MS;
  const timeoutMs =
    options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const runner = options.runner ?? runGitCommand;
  let cached: { payload: UpdateNoticePayload; checkedAt: number } | null = null;
  let inflight: Promise<UpdateNoticePayload> | null = null;

  async function refresh(): Promise<UpdateNoticePayload> {
    const build = options.build ?? getDeskRelayBuildInfo(options.repoRoot);
    const currentVersion = normalizeVersion(build.version) || "0.0.0";
    const explicitNextVersion = normalizeVersion(options.nextVersion);
    const prefix = `현재 버젼 ${formatVersion(currentVersion)}`;
    const currentCommit = normalizeCommit(build.commit);
    if (explicitNextVersion && explicitNextVersion !== currentVersion) {
      return {
        message: `${prefix}, 다음 버젼 ${formatVersion(explicitNextVersion)}`,
        level: "warning",
      };
    }
    if (!currentCommit) return { message: prefix, level: "info" };

    const remoteCommit = await readRemoteCommit(options.repoRoot, branch, timeoutMs, runner);
    if (!remoteCommit) return { message: prefix, level: "info" };

    if (remoteCommit === currentCommit) {
      return { message: prefix, level: "info" };
    }

    const remoteVersion = await readRemotePackageVersion(
      options.repoRoot,
      branch,
      timeoutMs,
      runner,
    );
    if (!remoteVersion || remoteVersion === currentVersion)
      return { message: prefix, level: "info" };
    return {
      message: `${prefix}, 다음 버젼 ${formatVersion(remoteVersion)}`,
      level: "warning",
    };
  }

  return {
    async read() {
      const now = Date.now();
      if (cached && now - cached.checkedAt < pollMs) return cached.payload;
      if (!inflight) {
        inflight = refresh()
          .then((payload) => {
            cached = { payload, checkedAt: Date.now() };
            return payload;
          })
          .finally(() => {
            inflight = null;
          });
      }
      return await inflight;
    },
  };
}

async function readRemoteCommit(
  repoRoot: string,
  branch: string,
  timeoutMs: number,
  runner: GitCommandRunner,
): Promise<string | null> {
  try {
    const { stdout } = await runner(["ls-remote", "origin", `refs/heads/${branch}`], {
      cwd: repoRoot,
      timeoutMs,
    });
    const commit = stdout.trim().split(/\s+/)[0] ?? "";
    return normalizeCommit(commit);
  } catch {
    return null;
  }
}

async function readRemotePackageVersion(
  repoRoot: string,
  branch: string,
  timeoutMs: number,
  runner: GitCommandRunner,
): Promise<string | null> {
  const refs = [`origin/${branch}:package.json`, `refs/remotes/origin/${branch}:package.json`];
  for (const ref of refs) {
    try {
      const { stdout } = await runner(["show", ref], { cwd: repoRoot, timeoutMs });
      const parsed = JSON.parse(stdout) as { version?: unknown };
      const version = normalizeVersion(
        typeof parsed.version === "string" ? parsed.version : undefined,
      );
      if (version) return version;
    } catch {
      // Try the next local remote ref shape before giving up.
    }
  }
  return null;
}

function normalizeCommit(value: string | undefined): string | null {
  const commit = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

function normalizeVersion(value: string | undefined): string | null {
  const version = value?.trim().replace(/^v/i, "") ?? "";
  return version ? version : null;
}

function formatVersion(version: string): string {
  return `v${version.replace(/^v/i, "")}`;
}

async function runGitCommand(
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return { stdout };
}
