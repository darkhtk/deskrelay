// session-paths — translate between filesystem cwd ("C:\Users\me\proj")
// and the directory name claude uses inside ~/.claude/projects
// ("C--Users-me-proj"). The encoding is lossy on systems whose paths
// contain "-" since claude collapses path separators to "-" without
// escaping; we accept that lossiness and document it.
//
// Conventions observed in real claude installs:
//   Windows  C:\Users\darkh\Projects\foo  →  C--Users-darkh-Projects-foo
//   POSIX    /Users/me/proj                →  -Users-me-proj
//   POSIX    /home/me/dev/x                →  -home-me-dev-x
//
// Rule: replace every path-separator (\\ or /) AND every ":" with "-",
// then collapse any consecutive "-" runs introduced by adjacent
// separators (rare; only happens at root of a drive on Windows).

import { homedir } from "node:os";
import { join, sep } from "node:path";

/** Default location of claude's per-project session store. */
export function defaultClaudeProjectsDir(): string {
  // Honored env override is useful for tests.
  if (process.env.CLAUDE_PROJECTS_DIR) return process.env.CLAUDE_PROJECTS_DIR;
  return join(homedir(), ".claude", "projects");
}

/** Encode a filesystem cwd into the claude on-disk directory name. */
export function encodeCwdAsDirName(cwd: string): string {
  // Replace separators + drive-colon with "-" (the same character claude
  // emits). We don't escape pre-existing dashes; this is the documented
  // ambiguity claude itself accepts.
  return cwd.replace(/[\\/:]/g, "-");
}

/** Best-effort decode of a directory name back to a path. Several
 *  on-disk cwds can encode to the same dir name on Windows because
 *  drive letters aren't preserved as ":" — we make a reasonable guess
 *  by re-inserting ":" after a single uppercase ASCII letter at the
 *  start, and replacing remaining "-" with the OS separator. */
export function decodeDirNameAsCwd(name: string): string {
  if (name.length === 0) return name;
  // Windows-style: leading "<drive>--" → "<drive>:\..."
  const winMatch = name.match(/^([A-Za-z])--(.*)$/);
  if (winMatch) {
    const [, drive, rest] = winMatch;
    return `${drive}:${sep}${rest?.replace(/-/g, sep) ?? ""}`;
  }
  // POSIX-style: leading "-foo-bar" → "/foo/bar"
  if (name.startsWith("-")) {
    return name.replace(/-/g, "/");
  }
  // Otherwise: unknown shape; return as-is.
  return name;
}

export interface SessionFileInfo {
  /** Absolute path to the .jsonl file. */
  path: string;
  /** The session id (filename without `.jsonl`). */
  sessionId: string;
  /** Decoded cwd best-effort. */
  cwd: string;
  /** ms-precision modification time. */
  modifiedAtMs: number;
}
