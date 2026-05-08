import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DeskRelayBuildInfo {
  version: string;
  commit: string;
  shortCommit: string;
  dirty: boolean;
  source: "env" | "git" | "package" | "unknown";
}

let cached: DeskRelayBuildInfo | null = null;

export function getDeskRelayBuildInfo(root = process.cwd()): DeskRelayBuildInfo {
  if (cached) return cached;

  const envCommit =
    process.env.DESKRELAY_GIT_COMMIT?.trim() || process.env.GIT_COMMIT?.trim() || "";
  const envVersion = process.env.DESKRELAY_VERSION?.trim() || process.env.npm_package_version || "";
  if (envCommit) {
    cached = {
      version: envVersion || "0.0.0",
      commit: envCommit,
      shortCommit: envCommit.slice(0, 12),
      dirty: process.env.DESKRELAY_GIT_DIRTY === "1",
      source: "env",
    };
    return cached;
  }

  const packageVersion = readPackageVersion(root) || "0.0.0";
  const gitCommit = git(root, ["rev-parse", "HEAD"]);
  if (gitCommit) {
    const dirty = Boolean(git(root, ["status", "--porcelain", "--untracked-files=no"]));
    cached = {
      version: packageVersion,
      commit: gitCommit,
      shortCommit: gitCommit.slice(0, 12),
      dirty,
      source: "git",
    };
    return cached;
  }

  cached = {
    version: packageVersion,
    commit: "unknown",
    shortCommit: "unknown",
    dirty: false,
    source: packageVersion === "0.0.0" ? "unknown" : "package",
  };
  return cached;
}

export function sameDeskRelayBuild(
  a: DeskRelayBuildInfo | undefined,
  b: DeskRelayBuildInfo | undefined,
): boolean | null {
  if (!a || !b) return null;
  if (!a.commit || !b.commit || a.commit === "unknown" || b.commit === "unknown") return null;
  return a.commit === b.commit && a.dirty === b.dirty;
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

function readPackageVersion(root: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version : "";
  } catch {
    return "";
  }
}
