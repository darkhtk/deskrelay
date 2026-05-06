// git.ts — read-only git status probe for a cwd. Used by the daemon's
// /git/status endpoint so the chat context bar can warn before sending
// a destructive command to a repo on `main` with uncommitted changes.
//
// Safety:
//   - We only read state; never run `git checkout`, `git reset`, etc.
//   - Commands run via execFile (no shell) with explicit args; cwd is
//     resolved + must lie inside a configured workspace root before we
//     even spawn git.
//   - Missing git binary → isRepo: false (not an error). The frontend
//     can render "git not installed" if it cares.

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type WorkspaceRoots, isInsideRoot } from "./workspaces.ts";

const execFileAsync = promisify(execFile);

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  dirty?: boolean;
  /** modified + untracked + staged file counts (porcelain v1 lines). */
  modifiedCount?: number;
  stagedCount?: number;
  /** Commits ahead/behind upstream. Both undefined when no upstream. */
  ahead?: number;
  behind?: number;
  /** Set when a probe-level error happened (git missing, permission, etc.). */
  error?: string;
}

const GIT_TIMEOUT_MS = 3_000;

export async function gitStatus(rawCwd: string, roots: WorkspaceRoots): Promise<GitStatus> {
  const cwd = resolve(rawCwd);
  if (!isInsideRoot(cwd, roots)) {
    return { isRepo: false, error: "cwd is outside the configured workspace roots" };
  }
  // Cheap repo check: `git rev-parse --is-inside-work-tree`. Spawn-fail
  // (git not installed) → isRepo:false with an explanatory error.
  let inside: string;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
    });
    inside = stdout.trim();
  } catch (err) {
    const msg = (err as { code?: string; message?: string }).message ?? "git probe failed";
    if ((err as { code?: string }).code === "ENOENT") {
      return { isRepo: false, error: "git is not installed or not on PATH" };
    }
    // Most errors here are "not a git repo" (exit 128). Don't treat
    // those as failures — the UI just renders "not a repo".
    if (/not a git repository/i.test(msg)) return { isRepo: false };
    return { isRepo: false, error: msg };
  }
  if (inside !== "true") return { isRepo: false };

  // Full porcelain v2 with branch info gives us everything in one go:
  //   # branch.head <branch>
  //   # branch.upstream <up>            (optional)
  //   # branch.ab +<ahead> -<behind>    (optional)
  //   1 .M ...                          (changed entries)
  //   ? path                            (untracked)
  //
  // We only count entries; the user gets to look at the actual diff
  // through their own git client.
  let stdout = "";
  try {
    const r = await execFileAsync(
      "git",
      ["status", "--porcelain=v2", "--branch", "--ahead-behind"],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    stdout = r.stdout;
  } catch (err) {
    return { isRepo: true, error: (err as Error).message };
  }
  let branch: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  let modified = 0;
  let staged = 0;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const parts = line.slice("# branch.ab ".length).trim().split(/\s+/);
      ahead = parts[0] ? Number(parts[0].replace(/^\+/, "")) : undefined;
      behind = parts[1] ? Number(parts[1].replace(/^-/, "")) : undefined;
      continue;
    }
    if (line.startsWith("# ")) continue;
    // 1 / 2 / u / ? entries all count toward modified; we tease out
    // staged ones by inspecting the XY status field on porcelain v2's
    // "1" / "2" entries (next two chars after the leading code).
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      modified += 1;
      const parts = line.split(" ");
      const xy = parts[1] ?? ".."; // e.g. "M.", ".M", "MM"
      if (xy[0] && xy[0] !== ".") staged += 1;
    } else if (line.startsWith("u ")) {
      modified += 1;
    } else if (line.startsWith("? ")) {
      modified += 1;
    }
  }
  return {
    isRepo: true,
    ...(branch !== undefined ? { branch } : {}),
    dirty: modified > 0,
    modifiedCount: modified,
    stagedCount: staged,
    ...(ahead !== undefined ? { ahead } : {}),
    ...(behind !== undefined ? { behind } : {}),
  };
}
