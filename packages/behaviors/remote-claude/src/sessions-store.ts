// sessions-store — discover + read claude session files on disk.
//
// claude writes one .jsonl file per session, organized as
//   <claudeProjectsDir>/<encoded-cwd>/<sessionId>.jsonl
// where each line is one event (user/assistant/tool_use/result/...).
//
// `listSessions` walks every <encoded-cwd>/<*.jsonl> entry, picks up
// stat metadata, and tries to extract a one-line title from the first
// `user` event in the file (best-effort, capped to 80 chars).
//
// `readSession` returns the raw events of a single session.

import { open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { join, normalize } from "node:path";
import {
  type SessionFileInfo,
  decodeDirNameAsCwd,
  defaultClaudeProjectsDir,
  encodeCwdAsDirName,
} from "./session-paths.ts";

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  /** First few words from the first user message, or empty string. */
  title: string;
  /** Untruncated first user message for hover/tooltips. */
  fullTitle?: string;
  /** ISO 8601, ms precision. */
  modifiedAt: string;
  /** byte length of the .jsonl file. */
  fileSize: number;
}

export interface SessionTranscript {
  sessionId: string;
  cwd: string;
  /** Last known permission mode from a system init event in the returned
   *  file window. Missing when the init event is outside the readable
   *  range or from an older CLI that did not report it. */
  permissionMode?: string;
  /** Raw, unvalidated event objects from the .jsonl file. */
  events: unknown[];
  /** True when a large .jsonl was tailed instead of returned in full. */
  truncated?: boolean;
  /** Full .jsonl byte size on disk. */
  totalBytes?: number;
  /** Number of bytes read from the end of the .jsonl file. */
  returnedBytes?: number;
  /** Read cap used for this response. */
  maxBytes?: number;
  /** Number of parsed events before applying `eventLimit`. */
  totalEvents?: number;
  /** Number of events returned to the caller. */
  returnedEvents?: number;
  /** Event cap used for this response. */
  eventLimit?: number;
  /** True when older parsed events were dropped by `eventLimit`. */
  eventsTruncated?: boolean;
}

const TITLE_MAX_LEN = 80;
export const DEFAULT_READ_SESSION_MAX_BYTES = 8 * 1024 * 1024;

export interface ListSessionsOptions {
  /** Override `~/.claude/projects/`. */
  projectsDir?: string;
  /** Cap on number of sessions returned (newest first). */
  limit?: number;
  /** Only include sessions for this exact cwd. */
  cwd?: string;
  /** Case-insensitive substring filter. Matches against `cwd` AND the
   *  extracted title. Saves the frontend from doing a 2nd pass over
   *  large session lists. */
  searchQuery?: string;
  /** ISO timestamp; only include sessions modified at or after this
   *  point. Useful for "since I last opened the app" discovery. */
  modifiedSince?: string;
  /** When true, keep only the newest readable file for each sessionId.
   *  Useful for user-facing lists when Claude leaves duplicate-looking
   *  copies across project dirs. */
  dedupeSessionIds?: boolean;
}

export async function listSessions(options: ListSessionsOptions = {}): Promise<SessionSummary[]> {
  const root = options.projectsDir ?? defaultClaudeProjectsDir();
  let projectDirs: string[];
  try {
    projectDirs = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const collected: SessionFileInfo[] = [];
  for (const dirName of projectDirs) {
    // Claude stores subagent transcripts under a synthetic project dir.
    // Those files carry the parent conversation's sessionId but are not
    // independently resumable user chats, so showing them in the sidebar
    // creates duplicate-looking conversation rows.
    if (dirName === "subagents") continue;
    const projectPath = join(root, dirName);
    let entries: string[];
    try {
      entries = await readdir(projectPath);
    } catch {
      continue; // skip non-directories or unreadable entries
    }
    const cwd = decodeDirNameAsCwd(dirName);
    for (const file of entries) {
      if (!file.endsWith(".jsonl")) continue;
      const fullPath = join(projectPath, file);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(fullPath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      collected.push({
        path: fullPath,
        sessionId: file.slice(0, -".jsonl".length),
        cwd,
        modifiedAtMs: st.mtimeMs,
      });
    }
  }

  collected.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);

  // Apply modifiedSince before title extraction so we don't pay the
  // file-read cost for filtered-out entries.
  const sinceMs =
    options.modifiedSince !== undefined ? Date.parse(options.modifiedSince) : Number.NaN;
  const filteredByTime = Number.isFinite(sinceMs)
    ? collected.filter((c) => c.modifiedAtMs >= sinceMs)
    : collected;

  const query = options.searchQuery?.trim().toLowerCase();
  const limit = options.limit !== undefined && options.limit > 0 ? options.limit : undefined;

  const summaries: SessionSummary[] = [];
  const seenSessionIds = new Set<string>();
  for (const info of filteredByTime) {
    const metadata = await extractSessionMetadata(info.path);
    if (metadata.internalCommandOnly) {
      await unlink(info.path).catch(() => undefined);
      continue;
    }
    const cwd = metadata.cwd ?? info.cwd;
    if (options.cwd !== undefined && options.cwd !== cwd) continue;
    if (options.dedupeSessionIds && seenSessionIds.has(info.sessionId)) continue;
    const finalPath = sessionFilePath(root, cwd, info.sessionId);
    if (!sameFilesystemPath(info.path, finalPath)) continue;
    const fileSize = await readableFileSize(finalPath);
    if (fileSize === undefined) continue;
    if (options.dedupeSessionIds) seenSessionIds.add(info.sessionId);
    summaries.push({
      sessionId: info.sessionId,
      cwd,
      title: metadata.title,
      ...(metadata.fullTitle ? { fullTitle: metadata.fullTitle } : {}),
      modifiedAt: new Date(info.modifiedAtMs).toISOString(),
      fileSize,
    });
    if (!query && limit !== undefined && summaries.length >= limit) break;
  }

  const matched = query
    ? summaries.filter(
        (s) => s.cwd.toLowerCase().includes(query) || s.title.toLowerCase().includes(query),
      )
    : summaries;
  return limit !== undefined ? matched.slice(0, limit) : matched;
}

export interface ReadSessionOptions {
  projectsDir?: string;
  /** The cwd this session belongs to (so we know which subdir to look in). */
  cwd: string;
  sessionId: string;
  /** Cap response size by reading only the tail of large session files. */
  maxBytes?: number;
  /** Cap the transcript to the newest N parsed events. */
  eventLimit?: number;
}

export async function readSession(options: ReadSessionOptions): Promise<SessionTranscript> {
  const root = options.projectsDir ?? defaultClaudeProjectsDir();
  const path = sessionFilePath(root, options.cwd, options.sessionId);
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  const st = await stat(path);
  const truncated = st.size > maxBytes;
  const raw = truncated
    ? await readTailUtf8(path, st.size, maxBytes)
    : await readFile(path, "utf8");
  const events: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines — claude occasionally writes partial output
      // when a session is interrupted mid-write.
    }
  }
  const permissionMode = extractPermissionMode(events);
  const totalEvents = events.length;
  const eventLimit = normalizeEventLimit(options.eventLimit);
  const limitedEvents =
    eventLimit !== undefined && totalEvents > eventLimit ? events.slice(-eventLimit) : events;
  const eventsTruncated = limitedEvents.length < totalEvents;
  return {
    sessionId: options.sessionId,
    cwd: options.cwd,
    ...(permissionMode ? { permissionMode } : {}),
    events: limitedEvents,
    ...(truncated
      ? { truncated: true, totalBytes: st.size, returnedBytes: maxBytes, maxBytes }
      : { totalBytes: st.size, returnedBytes: st.size, maxBytes }),
    totalEvents,
    returnedEvents: limitedEvents.length,
    ...(eventLimit !== undefined ? { eventLimit } : {}),
    ...(eventsTruncated ? { eventsTruncated: true } : {}),
  };
}

function extractPermissionMode(events: unknown[]): string | undefined {
  let found: string | undefined;
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const e = event as {
      type?: unknown;
      subtype?: unknown;
      permissionMode?: unknown;
      permission_mode?: unknown;
    };
    if (e.type !== "system" || e.subtype !== "init") continue;
    const mode = e.permissionMode ?? e.permission_mode;
    if (typeof mode === "string" && mode.trim()) found = mode;
  }
  return found;
}

function encodeCwd(cwd: string): string {
  return encodeCwdAsDirName(cwd);
}

function sessionFilePath(root: string, cwd: string, sessionId: string): string {
  return join(root, encodeCwd(cwd), `${sessionId}.jsonl`);
}

function sameFilesystemPath(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function readableFileSize(path: string): Promise<number | undefined> {
  try {
    const st = await stat(path);
    if (!st.isFile()) return undefined;
    const handle = await open(path, "r");
    try {
      return st.size;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function normalizeMaxBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_READ_SESSION_MAX_BYTES;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_READ_SESSION_MAX_BYTES;
  return Math.floor(value);
}

function normalizeEventLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

async function readTailUtf8(path: string, totalBytes: number, maxBytes: number): Promise<string> {
  const offset = Math.max(0, totalBytes - maxBytes);
  const length = totalBytes - offset;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    let raw = buffer.subarray(0, bytesRead).toString("utf8");
    if (offset > 0) {
      const firstLf = raw.indexOf("\n");
      raw = firstLf === -1 ? "" : raw.slice(firstLf + 1);
    }
    return raw;
  } finally {
    await handle.close();
  }
}

export interface DeleteSessionOptions {
  projectsDir?: string;
  /** The cwd this session belongs to (so we know which subdir to look in). */
  cwd: string;
  sessionId: string;
}

export interface DeleteSessionResult {
  /** True iff the file was actually removed (false = it was already gone). */
  deleted: boolean;
  /** Absolute path of the file that was (or would have been) removed. */
  path: string;
}

/** Delete a single session's .jsonl file from disk. Idempotent — a missing
 *  file is treated as success (deleted: false), so repeat clicks from the
 *  UI don't surface confusing errors. Path-traversal proof: sessionId is
 *  validated against a strict character class, and cwd is re-encoded with
 *  the same encodeCwd() the writer used (no `..` escape route). */
export async function deleteSession(options: DeleteSessionOptions): Promise<DeleteSessionResult> {
  if (!/^[A-Za-z0-9._-]+$/.test(options.sessionId)) {
    throw new Error(`invalid sessionId: ${JSON.stringify(options.sessionId)}`);
  }
  const root = options.projectsDir ?? defaultClaudeProjectsDir();
  const path = sessionFilePath(root, options.cwd, options.sessionId);
  try {
    await unlink(path);
    return { deleted: true, path };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { deleted: false, path };
    }
    throw err;
  }
}

export interface DeleteSessionsForCwdOptions {
  projectsDir?: string;
  cwd: string;
}

export interface DeleteSessionsForCwdResult {
  cwd: string;
  /** Number of listable sessions found for this cwd before deletion. */
  total: number;
  /** Number of files actually removed. */
  deleted: number;
  /** Number of files already gone by the time deletion ran. */
  missing: number;
  /** Absolute paths touched or checked. */
  paths: string[];
}

export async function deleteSessionsForCwd(
  options: DeleteSessionsForCwdOptions,
): Promise<DeleteSessionsForCwdResult> {
  if (typeof options.cwd !== "string" || !options.cwd.trim()) {
    throw new Error("cwd is required");
  }
  const sessions = await listSessions({
    ...(options.projectsDir ? { projectsDir: options.projectsDir } : {}),
    cwd: options.cwd,
  });
  let deleted = 0;
  let missing = 0;
  const paths: string[] = [];
  for (const session of sessions) {
    const result = await deleteSession({
      ...(options.projectsDir ? { projectsDir: options.projectsDir } : {}),
      cwd: session.cwd,
      sessionId: session.sessionId,
    });
    paths.push(result.path);
    if (result.deleted) deleted += 1;
    else missing += 1;
  }
  return { cwd: options.cwd, total: sessions.length, deleted, missing, paths };
}

export interface DeleteSessionsForSessionIdOptions {
  projectsDir?: string;
  sessionId: string;
}

export interface DeleteSessionsForSessionIdResult {
  sessionId: string;
  /** Number of matching .jsonl files found across user project dirs. */
  total: number;
  /** Number of files actually removed. */
  deleted: number;
  /** Number of files already gone by the time deletion ran. */
  missing: number;
  /** Absolute paths touched or checked. */
  paths: string[];
}

/** Delete every user-visible physical copy of a sessionId across cwd
 *  project dirs. Claude can leave duplicate-looking session files when
 *  the same sessionId appears under multiple encoded cwd folders; the
 *  browser treats sessionId as the identity, so deletion should do the
 *  same. Unlike `listSessions({ dedupeSessionIds: true })`, this scans
 *  physical filenames directly so stale aliases disappear too. */
export async function deleteSessionsForSessionId(
  options: DeleteSessionsForSessionIdOptions,
): Promise<DeleteSessionsForSessionIdResult> {
  if (!/^[A-Za-z0-9._-]+$/.test(options.sessionId)) {
    throw new Error(`invalid sessionId: ${JSON.stringify(options.sessionId)}`);
  }
  const root = options.projectsDir ?? defaultClaudeProjectsDir();
  let projectDirs: string[];
  try {
    projectDirs = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { sessionId: options.sessionId, total: 0, deleted: 0, missing: 0, paths: [] };
    }
    throw err;
  }

  const candidates: string[] = [];
  for (const dirName of projectDirs) {
    if (dirName === "subagents") continue;
    const projectPath = join(root, dirName);
    const path = join(projectPath, `${options.sessionId}.jsonl`);
    try {
      const st = await stat(path);
      if (st.isFile()) candidates.push(path);
    } catch {
      // Non-directory project entries, missing files, and unreadable
      // folders are ignored, matching listSessions' best-effort discovery.
    }
  }

  let deleted = 0;
  let missing = 0;
  const paths: string[] = [];
  for (const path of candidates) {
    paths.push(path);
    try {
      await unlink(path);
      deleted += 1;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        missing += 1;
        continue;
      }
      throw err;
    }
  }
  return { sessionId: options.sessionId, total: candidates.length, deleted, missing, paths };
}

interface SessionMetadata {
  title: string;
  fullTitle?: string;
  cwd?: string;
  internalCommandOnly?: boolean;
}

const INTERNAL_LOCAL_COMMANDS = new Set(["/context", "/status", "/usage"]);

async function extractSessionMetadata(jsonlPath: string): Promise<SessionMetadata> {
  let raw: string;
  try {
    raw = await readFile(jsonlPath, "utf8");
  } catch {
    return { title: "" };
  }

  let title = "";
  let fullTitle: string | undefined;
  let cwd: string | undefined;
  let sawInternalLocalCommand = false;
  let sawRegularUserText = false;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    cwd ??= eventCwd(parsed);
    for (const text of userTextParts(parsed)) {
      if (isInternalLocalCommandText(text)) {
        sawInternalLocalCommand = true;
        continue;
      }
      const collapsed = text.replace(/\s+/g, " ").trim();
      if (collapsed.length > 0) {
        sawRegularUserText = true;
      }
      if (!title && collapsed.length > 0) {
        fullTitle = collapsed;
        title =
          collapsed.length > TITLE_MAX_LEN
            ? `${collapsed.slice(0, TITLE_MAX_LEN - 3)}...`
            : collapsed;
      }
    }

    if (sawRegularUserText && title && cwd !== undefined) {
      return fullTitle && fullTitle !== title ? { title, fullTitle, cwd } : { title, cwd };
    }
  }

  return {
    title,
    ...(fullTitle && fullTitle !== title ? { fullTitle } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(sawInternalLocalCommand && !sawRegularUserText ? { internalCommandOnly: true } : {}),
  };
}

function userTextParts(event: unknown): string[] {
  if (typeof event !== "object" || event === null) return [];
  const e = event as Record<string, unknown>;
  if (e.type !== "user") return [];
  // claude writes user events as { type: "user", message: { role, content } }
  // where content is either a string or an array of content blocks.
  const message = e.message as Record<string, unknown> | undefined;
  if (!message) return [];
  if (typeof message.content === "string") return [message.content];
  if (Array.isArray(message.content)) {
    const texts: string[] = [];
    for (const block of message.content) {
      if (typeof block === "object" && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
      }
    }
    return texts;
  }
  return [];
}

function isInternalLocalCommandText(text: string): boolean {
  if (!text.includes("<local-command-caveat>")) return false;
  if (!text.includes("</local-command-caveat>")) return false;
  const command = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/)?.[1]?.trim();
  return command !== undefined && INTERNAL_LOCAL_COMMANDS.has(command);
}

function eventCwd(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const cwd = (event as Record<string, unknown>).cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd : undefined;
}
