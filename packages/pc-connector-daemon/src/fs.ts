// fs.ts — directory listing + mkdir for the cwd picker autocomplete in
// the browser frontend.
//
// Daemon-level concern: behaviors don't see this. The daemon process
// runs on the user's PC under their auth, so the surface is exactly
// what the user themselves can read/write — no extra sandboxing
// because the picker exists to navigate the user's filesystem.
//
// Ported from the original browser prototype source/fs-list.js (user-owned source, TS port).

import { execFileSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, parse, resolve } from "node:path";
import { type WorkspaceRoots, isInsideRoot } from "./workspaces.ts";

const isWindows = process.platform === "win32";

const UNRESTRICTED: WorkspaceRoots = { mode: "unrestricted", roots: [] };

export interface FsListEntry {
  name: string;
  fullPath: string;
  isDir: true;
}

export interface FsListResult {
  /** The resolved absolute path that was listed. Empty for the Windows
   *  drive-roots pseudo listing. */
  path: string;
  /** Absolute path of the parent. null when at root. */
  parent: string | null;
  entries: FsListEntry[];
}

export interface MakeDirInput {
  parent: string;
  name: string;
}

export interface MakeDirResult {
  path: string;
  parent: string;
  name: string;
}

export class FsError extends Error {
  constructor(
    message: string,
    readonly code: "ENOENT" | "ENOTDIR" | "EPERM" | "EINVAL" | "EEXIST" | "EFORBIDDEN",
  ) {
    super(message);
    this.name = "FsError";
  }
}

function forbidden(absPath: string): FsError {
  return new FsError(
    `forbidden: ${absPath} is outside the configured workspace roots`,
    "EFORBIDDEN",
  );
}

/** List the immediate subdirectories of `rawPath`. Empty / "/" / "\"
 *  triggers the Windows drive-roots view (or POSIX root) when running
 *  unrestricted, or a synthetic listing of the configured workspace
 *  roots when restricted. Hidden entries (dotfiles) and non-directories
 *  are filtered out. Symlinks are followed but their realpath must
 *  remain inside an allowed root. */
export async function listDir(
  rawPath: string,
  roots: WorkspaceRoots = UNRESTRICTED,
): Promise<FsListResult> {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed || trimmed === "/" || trimmed === "\\") {
    if (roots.mode === "restricted") return listRoots(roots);
    if (isWindows) return listDrives();
    return listChildren("/", roots);
  }

  let resolved = trimmed;
  if (resolved === "~" || resolved.startsWith("~/") || resolved.startsWith("~\\")) {
    resolved = join(homedir(), resolved.slice(1).replace(/^[\\/]/, ""));
  }
  resolved = resolve(resolved);
  if (!isInsideRoot(resolved, roots)) throw forbidden(resolved);
  return listChildren(resolved, roots);
}

async function listChildren(absPath: string, roots: WorkspaceRoots): Promise<FsListResult> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(absPath);
  } catch (err) {
    throw new FsError(`cannot access path: ${absPath} (${(err as Error).message})`, "ENOENT");
  }
  if (!s.isDirectory()) {
    throw new FsError(`not a directory: ${absPath}`, "ENOTDIR");
  }

  // Bun's Dirent is parameterized over the entry-name encoding; we want the
  // plain-string variant for ASCII-friendly path joins. The unknown cast is
  // intentional — Bun's readdir return type is narrower than Node's here.
  let raw: Dirent[];
  try {
    raw = (await readdir(absPath, { withFileTypes: true })) as unknown as Dirent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      throw new FsError(`permission denied: ${absPath}`, "EPERM");
    }
    throw err;
  }

  const entries: FsListEntry[] = [];
  for (const dirent of raw) {
    // Bun types `dirent.name` as NonSharedBuffer while Node types it as
    // string. String() coerces both into the string we actually want.
    const name = String(dirent.name);
    if (name.startsWith(".")) continue;
    const fullPath = join(absPath, name);
    let isDir = dirent.isDirectory();
    const isSymlink = dirent.isSymbolicLink();
    if (!isDir && isSymlink) {
      try {
        const sub = await stat(fullPath);
        isDir = sub.isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    // For symlinks under a restricted config, also check the real
    // target — a link inside the root that points outside it would
    // otherwise let a client navigate to a forbidden path on the next
    // click.
    if (isSymlink && roots.mode === "restricted") {
      let real: string;
      try {
        real = await realpath(fullPath);
      } catch {
        // Broken / racing symlink — drop it rather than expose a name.
        continue;
      }
      if (!isInsideRoot(real, roots)) continue;
    }
    entries.push({
      name,
      fullPath,
      isDir: true,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return {
    path: absPath,
    parent: parentOf(absPath),
    entries,
  };
}

/** Synthetic top-level listing for restricted mode: each configured
 *  workspace root becomes one entry. Lets the cwd picker show "where
 *  can I go?" without leaking real drives or POSIX root. */
function listRoots(roots: WorkspaceRoots): FsListResult {
  const entries: FsListEntry[] = roots.roots.map((root) => ({
    name: basename(root) || root,
    fullPath: root,
    isDir: true,
  }));
  return {
    path: "",
    parent: null,
    entries,
  };
}

function parentOf(absPath: string): string | null {
  const parsed = parse(absPath);
  if (isWindows && parsed.dir === absPath) return null;
  if (!isWindows && absPath === "/") return null;
  if (parsed.dir === absPath) return null;
  return parsed.dir;
}

/** Create a new directory at parent/name. Validates name to prevent
 *  path-separator escape attempts and Windows-reserved characters that
 *  would silently break later. Restricted mode requires the parent and
 *  the resulting target to be inside an allowed workspace root. */
export async function makeDir(
  input: MakeDirInput,
  roots: WorkspaceRoots = UNRESTRICTED,
): Promise<MakeDirResult> {
  const trimmedParent = String(input.parent || "").trim();
  const trimmedName = String(input.name || "").trim();
  if (!trimmedParent) throw new FsError("parent is required", "EINVAL");
  if (!trimmedName) throw new FsError("name is required", "EINVAL");
  if (/[\\/]/.test(trimmedName) || trimmedName === "." || trimmedName === "..") {
    throw new FsError("name must not contain path separators or be . / ..", "EINVAL");
  }
  if (/[<>:"|?*]/.test(trimmedName)) {
    throw new FsError("name contains invalid characters", "EINVAL");
  }
  const resolvedParent = resolve(trimmedParent);
  if (!isInsideRoot(resolvedParent, roots)) throw forbidden(resolvedParent);
  let parentStat: Awaited<ReturnType<typeof stat>>;
  try {
    parentStat = await stat(resolvedParent);
  } catch (err) {
    throw new FsError(
      `parent does not exist: ${resolvedParent} (${(err as Error).message})`,
      "ENOENT",
    );
  }
  if (!parentStat.isDirectory()) {
    throw new FsError(`parent is not a directory: ${resolvedParent}`, "ENOTDIR");
  }
  const target = join(resolvedParent, trimmedName);
  // Defence in depth — name is already filtered for / and \, but a
  // double-check on the resolved target catches any future loophole.
  if (!isInsideRoot(target, roots)) throw forbidden(target);
  try {
    await mkdir(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new FsError(`already exists: ${target}`, "EEXIST");
    }
    throw err;
  }
  return { path: target, parent: resolvedParent, name: trimmedName };
}

/** Windows drive listing — returns a synthetic FsListResult whose entries
 *  are drive roots like `C:\`. wmic is the most portable enumeration
 *  across Windows editions; the exec fallback probes a few common
 *  letters to avoid hangs on absent network shares. */
function listDrives(): FsListResult {
  let drives: string[] = [];
  try {
    const out = execFileSync("wmic", ["logicaldisk", "get", "name"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    });
    drives = String(out)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z]:$/.test(s));
  } catch {
    drives = [];
    for (const ch of "CDEFGH") {
      try {
        const root = `${ch}:\\`;
        execFileSync("cmd", ["/c", "dir", "/b", root], {
          stdio: "ignore",
          timeout: 500,
          windowsHide: true,
        });
        drives.push(`${ch}:`);
      } catch {
        // drive missing
      }
    }
  }
  const entries: FsListEntry[] = drives.map((letter) => ({
    name: `${letter}\\`,
    fullPath: `${letter}\\`,
    isDir: true,
  }));
  return {
    path: "",
    parent: null,
    entries,
  };
}
