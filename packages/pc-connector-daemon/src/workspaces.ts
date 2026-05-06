// workspaces.ts — workspace-root allowlist parsing + containment checks
// for the daemon's /fs/list + /fs/mkdir surface. Pure functions, no I/O,
// so they're trivially testable.
//
// Configured by the operator via CR_CONNECTOR_WORKSPACE_ROOTS. When the
// env is unset the daemon runs unrestricted (preserves the self-host
// workflow); when it's set — even to "" — we switch to restricted mode
// and `isInsideRoot` decides what listDir / makeDir may touch.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface WorkspaceRoots {
  /** "unrestricted" = legacy behaviour (env unset). "restricted" = only
   *  paths inside `roots` are allowed; the empty roots array means
   *  total lockdown (no listing, no mkdir). */
  mode: "unrestricted" | "restricted";
  /** Absolute, resolved paths with no trailing separator. Sorted +
   *  deduplicated so callers can render them deterministically. */
  roots: string[];
}

/** Expand a single leading `~` to the user's home directory. We don't
 *  support `~user/...` (rare, OS-dependent) — comment matches the same
 *  limitation already in fs.ts:listDir. */
export function expandTilde(input: string): string {
  if (!input) return input;
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return resolve(homedir(), input.slice(2));
  }
  return input;
}

/** Parse the comma-separated CR_CONNECTOR_WORKSPACE_ROOTS env value.
 *
 *   undefined          → { mode: "unrestricted", roots: [] }
 *   ""                 → { mode: "restricted",   roots: [] }   (lockdown)
 *   "~/proj, /srv/dev" → { mode: "restricted",   roots: [...] } */
export function parseWorkspaceRoots(raw: string | undefined): WorkspaceRoots {
  if (raw === undefined) return { mode: "unrestricted", roots: [] };
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const expanded = expandTilde(trimmed);
    const absolute = resolve(expanded);
    // Strip a trailing separator so isInsideRoot's `relative()` check
    // doesn't treat "/srv/dev" and "/srv/dev/" as different roots.
    const normalized = stripTrailingSep(absolute);
    seen.add(normalized);
  }
  return {
    mode: "restricted",
    roots: [...seen].sort(),
  };
}

/** True iff `abs` is the same path as one of the roots, or a descendant
 *  of one. Uses `path.relative` so prefix coincidences don't trick the
 *  check (e.g. `/home/proj` is *not* inside `/home/projects`). */
export function isInsideRoot(abs: string, config: WorkspaceRoots): boolean {
  if (config.mode === "unrestricted") return true;
  if (config.roots.length === 0) return false;
  const normalized = stripTrailingSep(resolve(abs));
  for (const root of config.roots) {
    if (normalized === root) return true;
    const rel = relative(root, normalized);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return true;
  }
  return false;
}

function stripTrailingSep(p: string): string {
  if (p.length <= 1) return p;
  // Windows: keep the trailing separator on drive roots like `C:\`.
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return p;
  if (p.endsWith(sep) || p.endsWith("/") || p.endsWith("\\")) {
    return p.slice(0, -1);
  }
  return p;
}
