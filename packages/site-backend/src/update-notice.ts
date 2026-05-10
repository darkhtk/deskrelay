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
    const currentCommit = normalizeCommit(build.commit);
    const currentShort = shortCommit(currentCommit) || build.shortCommit || "unknown";
    const versionText = build.version ? ` ${build.version}` : "";
    const prefix = `현재 설치 버전${versionText} (${currentShort})`;
    if (!currentCommit) {
      return {
        message: `${prefix} · 업데이트 확인 불가`,
        level: "warning",
      };
    }

    const remoteCommit = await readRemoteCommit(options.repoRoot, branch, timeoutMs, runner);
    if (!remoteCommit) {
      return {
        message: `${prefix} · 업데이트 확인 불가`,
        level: "warning",
      };
    }

    if (remoteCommit === currentCommit) {
      if (build.dirty) {
        return {
          message: `${prefix} · 최신 상태 · 로컬 변경 있음`,
          level: "warning",
        };
      }
      return { message: `${prefix} · 최신 상태`, level: "info" };
    }

    const remoteShort = shortCommit(remoteCommit) || "unknown";
    const dirtySuffix = build.dirty ? " · 로컬 변경 있음" : "";
    return {
      message: `${prefix} · 업데이트 있음 (${remoteShort})${dirtySuffix}`,
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

function normalizeCommit(value: string | undefined): string | null {
  const commit = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

function shortCommit(value: string | null): string | null {
  return value ? value.slice(0, 7) : null;
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
