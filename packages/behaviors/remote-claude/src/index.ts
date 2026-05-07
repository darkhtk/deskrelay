// remote-claude — entry. Registers a single `chat` method that spawns
// claude for one user message and streams events back to the broker.
//
// Method:
//   chat({ cwd, message, attachments?, sessionId?, runId? }) → { ok, eventCount }
//     - cwd: where claude runs (the user's project root)
//     - message: the user's prompt
//     - attachments: optional browser image attachments
//     - sessionId: optional, resume an existing claude session
//     - runId: optional caller-chosen id; events are published to
//              `remote-claude.run:{runId}` so the browser can subscribe
//              to one specific run. If omitted, a random id is used and
//              returned.
//
// Events published (each is one ClaudeStreamEvent payload from claude):
//   kind="claude.event"   — every JSONL line (assistant text, tool use,
//                            permission request, result, etc.)
//   kind="claude.stderr"  — claude wrote to stderr (warnings)
//   kind="run.started"    — first event of a run
//   kind="run.finished"   — last event; payload = { exitCode, eventCount }
//   kind="run.error"      — claude exited non-zero or threw
//
// All events go to `remote-claude.run:{runId}` (the per-run space). For
// listing/monitoring, future sessions space TBD.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type RunBehaviorOptions, runBehavior } from "@claude-remote/behavior-sdk/runtime";
import manifest from "../manifest.json" with { type: "json" };
import {
  ClaudeRunError,
  type ClaudeStreamEvent,
  probeClaudeSlashCommands,
  runClaude,
} from "./claude-runner.ts";
import {
  type DeleteSessionOptions,
  type DeleteSessionResult,
  type DeleteSessionsForCwdOptions,
  type DeleteSessionsForCwdResult,
  type DeleteSessionsForSessionIdOptions,
  type DeleteSessionsForSessionIdResult,
  type ListSessionsOptions,
  type ReadSessionOptions,
  type SessionSummary,
  type SessionTranscript,
  deleteSession,
  deleteSessionsForCwd,
  deleteSessionsForSessionId,
  listSessions,
  readSession,
} from "./sessions-store.ts";

interface ChatParams {
  cwd: string;
  message: string;
  attachments?: ChatAttachment[];
  sessionId?: string;
  runId?: string;
  /** claude `--permission-mode` value. Unknown values are dropped (we
   *  fall back to claude's default rather than passing garbage to the
   *  CLI). */
  permissionMode?: string;
  /** Per-device security profile that controls the PreToolUse hook's
   *  fail-policy when the daemon is unreachable:
   *    "relaxed" — fail open (allow tool use).
   *    "normal"  — fail closed.
   *    "strict"  — fail closed (reserved for stronger future enforcement).
   *  Defaults to "relaxed" so existing self-host workflows keep
   *  working unchanged. The frontend persists the chosen profile in
   *  localStorage and passes it on every chat request. */
  securityProfile?: string;
  /** Optional claude `--model` value selected by the browser. */
  model?: string;
  /** For tests/dev — substitute the executable. */
  command?: string[];
}

interface ChatAttachment {
  name?: string;
  mimeType: string;
  size?: number;
  dataBase64: string;
}

const VALID_PERMISSION_MODES = new Set([
  "default",
  "auto",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
  "plan",
]);
const VALID_SECURITY_PROFILES = new Set(["relaxed", "normal", "strict"]);

interface SessionsListParams {
  cwd?: string;
  limit?: number;
  projectsDir?: string;
  /** Case-insensitive substring filter on cwd + title. */
  searchQuery?: string;
  /** ISO; only include sessions modified at or after this timestamp. */
  modifiedSince?: string;
  /** Keep only the newest readable row for each sessionId. */
  dedupeSessionIds?: boolean;
}

interface SessionsReadParams {
  cwd: string;
  sessionId: string;
  projectsDir?: string;
  maxBytes?: number;
  eventLimit?: number;
}

interface SessionsDeleteParams {
  cwd: string;
  sessionId: string;
  projectsDir?: string;
}

interface SessionsDeleteByCwdParams {
  cwd: string;
  projectsDir?: string;
}

interface SessionsDeleteBySessionIdParams {
  sessionId: string;
  projectsDir?: string;
}

interface InterruptParams {
  runId: string;
}

interface InterruptResult {
  ok: true;
  /** false when the runId wasn't found (already finished or never started) — not an error. */
  found: boolean;
}

interface SlashCommandsParams {
  cwd?: string;
  command?: string[];
}

interface SlashCommandsResult {
  slashCommands: string[];
  skills: string[];
  claudeVersion?: string;
  model?: string;
}

interface ContextUsageParams {
  cwd: string;
  sessionId?: string;
  scope?: "session" | "week";
  permissionMode?: string;
  model?: string;
  command?: string[];
}

interface ContextUsageSnapshot {
  remainingPercent: number | null;
  usedPercent: number | null;
  source: "event" | "text";
  resetAt?: string;
  rateLimitType?: string;
  status?: string;
}

interface ContextUsageResult {
  usage: ContextUsageSnapshot | null;
  eventCount: number;
  checkedAt: string;
}

interface UsageLimitsResult {
  session: ContextUsageSnapshot | null;
  week: ContextUsageSnapshot | null;
  sonnetWeek: ContextUsageSnapshot | null;
  checkedAt: string;
}

interface PermissionsInspectParams {
  cwd?: string;
}

interface PermissionsUpdateParams {
  cwd?: string;
  path?: string;
  allow?: unknown;
}

interface PermissionSourceSummary {
  label: string;
  path: string;
  exists: boolean;
  allow: string[];
  deny: string[];
  ask: string[];
  defaultMode?: string;
  error?: string;
}

interface PermissionsInspectResult {
  sources: PermissionSourceSummary[];
}

interface PermissionsUpdateResult {
  source: PermissionSourceSummary;
}

// Per-run abort registry. Each in-flight `chat` call registers its
// AbortController under runId; the `interrupt` JSON-RPC method looks it
// up and aborts. When the chat completes (success or error) we
// deregister so a stale runId doesn't accumulate.
const inflightRuns = new Map<string, AbortController>();

function safeClaudeModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const model = value.trim();
  if (!model || model.length > 120 || model.startsWith("-")) return undefined;
  if (!/^[A-Za-z0-9._:[\]-]+$/.test(model)) return undefined;
  return model;
}

/** Behavior definition exported as a value so the daemon can load
 *  remote-claude in-process (no subprocess, no JSONRPC stdio). The
 *  bottom-of-file `if (import.meta.main)` block keeps the legacy
 *  subprocess entry working too — the file behaves as both a script
 *  (when spawned by behavior-host) and a module (when imported by the
 *  daemon). The two paths share this same object. */
export const behaviorDef: RunBehaviorOptions = {
  manifest: manifest as never,
  async start(ctx) {
    ctx.logger.info("remote-claude started", { instanceId: ctx.settings.instanceId });

    ctx.onRequest<SessionsListParams, SessionSummary[]>("sessions.list", async (params) => {
      const opts: ListSessionsOptions = {};
      if (params?.cwd !== undefined) opts.cwd = params.cwd;
      if (params?.limit !== undefined) opts.limit = params.limit;
      if (params?.projectsDir !== undefined) opts.projectsDir = params.projectsDir;
      if (params?.searchQuery !== undefined) opts.searchQuery = params.searchQuery;
      if (params?.modifiedSince !== undefined) opts.modifiedSince = params.modifiedSince;
      if (params?.dedupeSessionIds !== undefined) opts.dedupeSessionIds = params.dedupeSessionIds;
      return await listSessions(opts);
    });

    ctx.onRequest<SessionsReadParams, SessionTranscript>("sessions.read", async (params) => {
      if (!params || typeof params.cwd !== "string" || typeof params.sessionId !== "string") {
        throw new Error("sessions.read: cwd and sessionId are required");
      }
      const opts: ReadSessionOptions = {
        cwd: params.cwd,
        sessionId: params.sessionId,
      };
      if (params.projectsDir !== undefined) opts.projectsDir = params.projectsDir;
      if (params.maxBytes !== undefined) opts.maxBytes = params.maxBytes;
      if (params.eventLimit !== undefined) opts.eventLimit = params.eventLimit;
      return await readSession(opts);
    });

    ctx.onRequest<
      { command?: string[] },
      {
        claudeAvailable: boolean;
        claudeVersion?: string;
        error?: string;
      }
    >("diagnostics", async (params) => {
      // Probe whether `claude` is callable in this OS user's PATH and
      // capture its version string. Used by the frontend Device
      // diagnostics panel to tell the user "you need to install Claude
      // CLI" instead of just "no response from claude".
      const { spawn } = await import("node:child_process");
      const cmd = params?.command?.[0] ?? "claude";
      const args = (params?.command?.slice(1) ?? []).concat(["--version"]);
      return await new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let proc: ReturnType<typeof spawn>;
        try {
          proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        } catch (err) {
          resolve({ claudeAvailable: false, error: (err as Error).message });
          return;
        }
        proc.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        proc.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        proc.on("error", (err) => {
          resolve({ claudeAvailable: false, error: err.message });
        });
        proc.on("close", (code) => {
          if (code === 0) {
            const version = stdout.trim().split(/\s+/).pop() ?? "";
            resolve({
              claudeAvailable: true,
              ...(version ? { claudeVersion: version } : {}),
            });
          } else {
            resolve({
              claudeAvailable: false,
              error: stderr.trim() || `claude --version exited ${code}`,
            });
          }
        });
      });
    });

    ctx.onRequest<SlashCommandsParams, SlashCommandsResult>("slashCommands", async (params) => {
      const cwd = typeof params?.cwd === "string" && params.cwd.trim() ? params.cwd : process.cwd();
      return await probeClaudeSlashCommands({
        cwd,
        ...(params?.command ? { command: params.command } : {}),
        onMalformedStdout: (line, error) => {
          ctx.logger.warn("slash command probe malformed stdout", { line, error: error.message });
        },
        onStderrLine: (line) => {
          ctx.logger.warn("slash command probe stderr", { line });
        },
      });
    });

    ctx.onRequest<ContextUsageParams, ContextUsageResult>("context.usage", async (params) => {
      if (!params || typeof params.cwd !== "string" || !params.cwd.trim()) {
        throw new Error("context.usage: cwd is required");
      }
      const scope =
        params.scope === "session" || params.scope === "week" ? params.scope : undefined;
      if (scope && !params.command) {
        return {
          usage: null,
          eventCount: 0,
          checkedAt: new Date().toISOString(),
        };
      }
      const events: ClaudeStreamEvent[] = [];
      const permissionMode =
        params.permissionMode && VALID_PERMISSION_MODES.has(params.permissionMode)
          ? params.permissionMode
          : undefined;
      const model = safeClaudeModel(params.model);
      const result = await runClaude({
        cwd: params.cwd,
        message: "/context",
        ...(params.sessionId ? { resumeSessionId: params.sessionId } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(model ? { model } : {}),
        ...(params.command ? { command: params.command } : {}),
        extraArgs: ["--max-budget-usd", "0.01"],
        onEvent: (event) => {
          events.push(event);
        },
        onMalformedStdout: (line, error) => {
          ctx.logger.warn("context usage malformed stdout", { line, error: error.message });
        },
        onStderrLine: (line) => {
          ctx.logger.warn("context usage stderr", { line });
        },
      });
      return {
        usage:
          scope === "session"
            ? latestRateLimitUsageSnapshot(events, "five_hour")
            : scope === "week"
              ? latestRateLimitUsageSnapshot(events, "weekly")
              : latestContextUsageSnapshot(events),
        eventCount: result.eventCount,
        checkedAt: new Date().toISOString(),
      };
    });

    ctx.onRequest<Record<string, never>, UsageLimitsResult>("usage.limits", async () => {
      try {
        return await fetchClaudeUsageLimits();
      } catch (err) {
        ctx.logger.warn("Claude usage limits unavailable", { error: (err as Error).message });
        return emptyUsageLimitsResult();
      }
    });

    ctx.onRequest<PermissionsInspectParams, PermissionsInspectResult>(
      "permissions.inspect",
      async (params) => {
        const cwd =
          typeof params?.cwd === "string" && params.cwd.trim() ? params.cwd : process.cwd();
        const sources = permissionSourcesForCwd(cwd);
        return {
          sources: await Promise.all(sources.map((source) => readPermissionSource(source))),
        };
      },
    );

    ctx.onRequest<PermissionsUpdateParams, PermissionsUpdateResult>(
      "permissions.update",
      async (params) => {
        const cwd =
          typeof params?.cwd === "string" && params.cwd.trim() ? params.cwd : process.cwd();
        if (!params || typeof params.path !== "string" || !params.path.trim()) {
          throw new Error("permissions.update: path is required");
        }
        const target = matchingPermissionSource(cwd, params.path);
        if (!target) {
          throw new Error("permissions.update: path is not a known Claude settings file");
        }
        const allow = normalizePermissionUpdateList(params.allow);
        await writePermissionSourceAllow(target.path, allow);
        return { source: await readPermissionSource(target) };
      },
    );

    ctx.onRequest<SessionsDeleteParams, DeleteSessionResult>("sessions.delete", async (params) => {
      if (!params || typeof params.cwd !== "string" || typeof params.sessionId !== "string") {
        throw new Error("sessions.delete: cwd and sessionId are required");
      }
      const opts: DeleteSessionOptions = {
        cwd: params.cwd,
        sessionId: params.sessionId,
      };
      if (params.projectsDir !== undefined) opts.projectsDir = params.projectsDir;
      return await deleteSession(opts);
    });

    ctx.onRequest<SessionsDeleteBySessionIdParams, DeleteSessionsForSessionIdResult>(
      "sessions.deleteBySessionId",
      async (params) => {
        if (!params || typeof params.sessionId !== "string") {
          throw new Error("sessions.deleteBySessionId: sessionId is required");
        }
        const opts: DeleteSessionsForSessionIdOptions = { sessionId: params.sessionId };
        if (params.projectsDir !== undefined) opts.projectsDir = params.projectsDir;
        return await deleteSessionsForSessionId(opts);
      },
    );

    ctx.onRequest<SessionsDeleteByCwdParams, DeleteSessionsForCwdResult>(
      "sessions.deleteByCwd",
      async (params) => {
        if (!params || typeof params.cwd !== "string") {
          throw new Error("sessions.deleteByCwd: cwd is required");
        }
        const opts: DeleteSessionsForCwdOptions = { cwd: params.cwd };
        if (params.projectsDir !== undefined) opts.projectsDir = params.projectsDir;
        return await deleteSessionsForCwd(opts);
      },
    );

    ctx.onRequest<ChatParams, { ok: true; runId: string; accepted: true; eventCount: number }>(
      "chat",
      async (params) => {
        if (!params || typeof params.cwd !== "string" || typeof params.message !== "string") {
          throw new Error("chat: cwd and message are required strings");
        }
        const runId = params.runId ?? `run_${randomBytes(8).toString("hex")}`;
        const space = ctx.makeSpace("run", runId);
        const startedAt = new Date().toISOString();

        const abort = new AbortController();
        inflightRuns.set(runId, abort);

        ctx.publish({
          spaceId: space,
          kind: "run.started",
          content: { runId, cwd: params.cwd, message: params.message, startedAt },
        });

        const run = async () => {
          try {
            const permissionMode =
              params.permissionMode && VALID_PERMISSION_MODES.has(params.permissionMode)
                ? params.permissionMode
                : undefined;
            const securityProfile =
              params.securityProfile && VALID_SECURITY_PROFILES.has(params.securityProfile)
                ? params.securityProfile
                : "relaxed";
            const model = safeClaudeModel(params.model);
            const result = await runClaude({
              cwd: params.cwd,
              message: params.message,
              ...(Array.isArray(params.attachments) ? { attachments: params.attachments } : {}),
              signal: abort.signal,
              ...(params.sessionId ? { resumeSessionId: params.sessionId } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              ...(model ? { model } : {}),
              ...(params.command ? { command: params.command } : {}),
              // Threaded into the spawned claude CLI's env so the hook
              // script picks the right fail-policy (see hooks/pretooluse.ts).
              env: { CR_PRETOOLUSE_FAIL_POLICY: securityProfile },
              onEvent: (event) => {
                ctx.publish({ spaceId: space, kind: "claude.event", content: event });
              },
              onStderrLine: (line) => {
                ctx.publish({ spaceId: space, kind: "claude.stderr", content: { line } });
              },
              onMalformedStdout: (line, error) => {
                ctx.logger.warn("malformed stdout line", { line, error: error.message });
              },
            });

            ctx.publish({
              spaceId: space,
              kind: "run.finished",
              content: {
                runId,
                exitCode: result.exitCode,
                eventCount: result.eventCount,
                finishedAt: new Date().toISOString(),
              },
            });
          } catch (err) {
            const isClaudeErr = err instanceof ClaudeRunError;
            ctx.publish({
              spaceId: space,
              kind: "run.error",
              content: {
                runId,
                message: (err as Error).message,
                ...(isClaudeErr ? { exitCode: err.exitCode, stderr: err.stderr } : {}),
              },
            });
          } finally {
            inflightRuns.delete(runId);
          }
        };

        void run();
        return { ok: true as const, runId, accepted: true as const, eventCount: 0 };
      },
    );

    ctx.onRequest<InterruptParams, InterruptResult>("interrupt", async (params) => {
      if (!params || typeof params.runId !== "string") {
        throw new Error("interrupt: runId is required");
      }
      const controller = inflightRuns.get(params.runId);
      if (!controller) {
        // Not found = either the run already finished, or never started.
        // Either way the user's intent ("stop this") is satisfied; report
        // found:false so the caller can decide whether to surface UI feedback.
        return { ok: true as const, found: false };
      }
      controller.abort();
      return { ok: true as const, found: true };
    });
  },
  async stop(ctx) {
    for (const controller of inflightRuns.values()) {
      controller.abort();
    }
    inflightRuns.clear();
    ctx.logger.info("remote-claude stopping");
  },
};

// Legacy subprocess path: when this file is invoked as a script (the
// behavior-host CLI does `import("…/index.ts")`), `import.meta.main` is
// true and we wire stdio JSONRPC via runBehavior. When the daemon
// imports the module to load in-process, `main` is false and the
// runBehavior call is skipped — the daemon constructs an
// InProcessBehaviorHost with `behaviorDef` directly.
if (import.meta.main) {
  await runBehavior(behaviorDef);
}

function permissionSourcesForCwd(cwd: string): Array<{ label: string; path: string }> {
  return [
    { label: "User settings", path: join(homedir(), ".claude", "settings.json") },
    { label: "Project settings", path: join(cwd, ".claude", "settings.json") },
    { label: "Project local settings", path: join(cwd, ".claude", "settings.local.json") },
  ];
}

function matchingPermissionSource(
  cwd: string,
  path: string,
): { label: string; path: string } | null {
  const requested = resolve(path);
  return (
    permissionSourcesForCwd(cwd).find((source) => sameFilesystemPath(source.path, requested)) ??
    null
  );
}

function sameFilesystemPath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

async function readPermissionSource(source: {
  label: string;
  path: string;
}): Promise<PermissionSourceSummary> {
  try {
    const raw = await readFile(source.path, "utf8");
    const parsed = JSON.parse(raw) as { permissions?: unknown };
    const permissions =
      parsed.permissions && typeof parsed.permissions === "object"
        ? (parsed.permissions as Record<string, unknown>)
        : {};
    return {
      label: source.label,
      path: source.path,
      exists: true,
      allow: stringList(permissions.allow),
      deny: stringList(permissions.deny),
      ask: stringList(permissions.ask),
      ...(typeof permissions.defaultMode === "string"
        ? { defaultMode: permissions.defaultMode }
        : {}),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      label: source.label,
      path: source.path,
      exists: false,
      allow: [],
      deny: [],
      ask: [],
      ...(code === "ENOENT" ? {} : { error: (err as Error).message }),
    };
  }
}

async function writePermissionSourceAllow(path: string, allow: string[]): Promise<void> {
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await readFile(path, "utf8");
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("settings file must be a JSON object");
    }
    parsed = value as Record<string, unknown>;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }

  const permissions =
    parsed.permissions &&
    typeof parsed.permissions === "object" &&
    !Array.isArray(parsed.permissions)
      ? { ...(parsed.permissions as Record<string, unknown>) }
      : {};
  permissions.allow = allow;
  parsed.permissions = permissions;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function normalizePermissionUpdateList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("permissions.update: allow must be an array");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("permissions.update: allow entries must be strings");
    }
    const entry = item.trim();
    if (!entry) throw new Error("permissions.update: allow entries cannot be empty");
    if (entry.length > 200) {
      throw new Error("permissions.update: allow entries must be 200 characters or less");
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  if (out.length > 100) throw new Error("permissions.update: allow list is too large");
  return out;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function latestContextUsageSnapshot(events: ClaudeStreamEvent[]): ContextUsageSnapshot | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const snapshot = contextUsageFromEvent(events[i]);
    if (snapshot) return snapshot;
  }
  return null;
}

function latestRateLimitUsageSnapshot(
  events: ClaudeStreamEvent[],
  target: "five_hour" | "weekly",
): ContextUsageSnapshot | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const snapshot = rateLimitUsageFromEvent(events[i], target);
    if (snapshot) return snapshot;
  }
  return null;
}

function rateLimitUsageFromEvent(
  event: unknown,
  target: "five_hour" | "weekly",
): ContextUsageSnapshot | null {
  const record = asRecord(event);
  if (!record || record.type !== "rate_limit_event") return null;
  const info = asRecord(record.rate_limit_info);
  if (!info) return null;
  const rateLimitType = typeof info.rateLimitType === "string" ? info.rateLimitType : "";
  const normalizedType = rateLimitType.toLowerCase().replace(/[-\s]+/g, "_");
  const isTarget =
    target === "five_hour"
      ? normalizedType === "five_hour" || normalizedType === "session"
      : normalizedType === "weekly" || normalizedType === "week";
  if (!isTarget) return null;

  const resetsAt = numericValue(info.resetsAt);
  const resetAt =
    resetsAt !== null && resetsAt > 0 ? new Date(resetsAt * 1000).toISOString() : undefined;
  const status = typeof info.status === "string" ? info.status : undefined;
  return {
    remainingPercent: null,
    usedPercent: null,
    source: "event",
    rateLimitType,
    ...(resetAt ? { resetAt } : {}),
    ...(status ? { status } : {}),
  };
}

async function fetchClaudeUsageLimits(): Promise<UsageLimitsResult> {
  const token = await readClaudeOAuthAccessToken();
  if (!token) return emptyUsageLimitsResult();

  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    method: "GET",
    signal: AbortSignal.timeout(5000),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "claude-code/2.1.132",
      "anthropic-beta": "oauth-2025-04-20",
    },
  });
  if (!res.ok) throw new Error(`Claude usage API returned HTTP ${res.status}`);
  const body = asRecord(await res.json());
  if (!body) return emptyUsageLimitsResult();
  return {
    session: usageLimitSnapshot(body.five_hour, "five_hour"),
    week: usageLimitSnapshot(body.seven_day, "seven_day"),
    sonnetWeek: usageLimitSnapshot(body.seven_day_sonnet, "seven_day_sonnet"),
    checkedAt: new Date().toISOString(),
  };
}

function emptyUsageLimitsResult(): UsageLimitsResult {
  return {
    session: null,
    week: null,
    sonnetWeek: null,
    checkedAt: new Date().toISOString(),
  };
}

async function readClaudeOAuthAccessToken(): Promise<string | null> {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) return envToken;

  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  try {
    const raw = await readFile(join(configDir, ".credentials.json"), "utf8");
    const credentials = asRecord(JSON.parse(raw));
    const oauth = asRecord(credentials?.claudeAiOauth);
    const accessToken = typeof oauth?.accessToken === "string" ? oauth.accessToken.trim() : "";
    return accessToken || null;
  } catch {
    return null;
  }
}

function usageLimitSnapshot(value: unknown, rateLimitType: string): ContextUsageSnapshot | null {
  const record = asRecord(value);
  if (!record) return null;
  const usedPercent = firstPercent(record, ["utilization", "used_percentage", "usedPercentage"]);
  if (usedPercent === null) return null;
  const resetAt = usageLimitResetAt(record);
  return {
    remainingPercent: clampPercent(100 - usedPercent),
    usedPercent,
    source: "event",
    rateLimitType,
    ...(resetAt ? { resetAt } : {}),
  };
}

function usageLimitResetAt(record: Record<string, unknown>): string | undefined {
  const value = record.resets_at ?? record.resetsAt;
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const epochSeconds = numericValue(value);
  return epochSeconds !== null && epochSeconds > 0
    ? new Date(epochSeconds * 1000).toISOString()
    : undefined;
}

function contextUsageFromEvent(event: unknown): ContextUsageSnapshot | null {
  const record = asRecord(event);
  if (!record) return null;
  const message = asRecord(record.message);
  const candidates = [
    record,
    asRecord(record.usage),
    asRecord(record.context),
    asRecord(record.result),
    message,
    message ? asRecord(message.usage) : null,
    message ? asRecord(message.context) : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const snapshot = contextUsageFromRecord(candidate);
    if (snapshot) return snapshot;
  }
  for (const text of contextTextFields(record)) {
    const snapshot = contextUsageFromText(text);
    if (snapshot) return snapshot;
  }
  return null;
}

function contextUsageFromRecord(record: Record<string, unknown>): ContextUsageSnapshot | null {
  const remaining = firstPercent(record, [
    "context_remaining_percent",
    "contextRemainingPercent",
    "remaining_context_percent",
    "remainingContextPercent",
    "remaining_percent",
    "remainingPercent",
  ]);
  if (remaining !== null) return usageFromRemaining(remaining, "event");

  const used = firstPercent(record, [
    "context_usage_percent",
    "contextUsagePercent",
    "context_used_percent",
    "contextUsedPercent",
    "used_percent",
    "usedPercent",
    "percent_used",
    "percentUsed",
  ]);
  if (used !== null) return usageFromUsed(used, "event");

  const maxTokens = firstNumber(record, [
    "context_window",
    "contextWindow",
    "context_window_tokens",
    "contextWindowTokens",
    "max_context_tokens",
    "maxContextTokens",
    "max_tokens",
    "maxTokens",
    "limit",
  ]);
  if (!maxTokens || maxTokens <= 0) return null;

  const remainingTokens = firstNumber(record, [
    "remaining_tokens",
    "remainingTokens",
    "context_remaining_tokens",
    "contextRemainingTokens",
  ]);
  if (remainingTokens !== null)
    return usageFromRemaining((remainingTokens / maxTokens) * 100, "event");

  const usedTokens = firstNumber(record, [
    "used_tokens",
    "usedTokens",
    "context_used_tokens",
    "contextUsedTokens",
    "input_tokens",
    "inputTokens",
    "total_tokens",
    "totalTokens",
  ]);
  return usedTokens !== null ? usageFromUsed((usedTokens / maxTokens) * 100, "event") : null;
}

function contextUsageFromText(text: string): ContextUsageSnapshot | null {
  if (!text || !/\bcontext\b/i.test(text) || !/%/.test(text)) return null;
  const normalized = text.replace(/\s+/g, " ");

  const freeSpaceMatch = normalized.match(
    /\|\s*Free space\s*\|[^|]*\|\s*(\d{1,3}(?:\.\d+)?)\s*%\s*\|/i,
  );
  if (freeSpaceMatch?.[1]) return usageFromRemaining(Number(freeSpaceMatch[1]), "text");

  const claudeContextTokensMatch = normalized.match(
    /\*\*Tokens:\*\*\s*[^()]*\((\d{1,3}(?:\.\d+)?)\s*%\)/i,
  );
  if (claudeContextTokensMatch?.[1]) {
    return usageFromUsed(Number(claudeContextTokensMatch[1]), "text");
  }

  const remainingMatch =
    normalized.match(/(?:remaining|left|available|free)[^0-9%]{0,48}(\d{1,3}(?:\.\d+)?)\s*%/i) ??
    normalized.match(/(\d{1,3}(?:\.\d+)?)\s*%[^.]{0,48}(?:remaining|left|available|free)/i);
  if (remainingMatch?.[1]) return usageFromRemaining(Number(remainingMatch[1]), "text");

  const usedMatch =
    normalized.match(/(?:used|usage|full)[^0-9%]{0,48}(\d{1,3}(?:\.\d+)?)\s*%/i) ??
    normalized.match(/(\d{1,3}(?:\.\d+)?)\s*%[^.]{0,48}(?:used|usage|full)/i);
  return usedMatch?.[1] ? usageFromUsed(Number(usedMatch[1]), "text") : null;
}

function contextTextFields(record: Record<string, unknown>): string[] {
  const fields = [messageText(record)];
  if (typeof record.result === "string") fields.push(record.result);
  if (typeof record.content === "string") fields.push(record.content);
  if (typeof record.text === "string") fields.push(record.text);
  return fields.filter((field) => field.trim().length > 0);
}

function messageText(record: Record<string, unknown>): string {
  const message = asRecord(record.message);
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const item = asRecord(block);
      return typeof item?.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function firstPercent(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numericValue(record[key]);
    if (value !== null) return clampPercent(value);
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numericValue(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/%$/, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function usageFromRemaining(
  value: number,
  source: ContextUsageSnapshot["source"],
): ContextUsageSnapshot {
  const remainingPercent = clampPercent(value);
  return {
    remainingPercent,
    usedPercent: clampPercent(100 - remainingPercent),
    source,
  };
}

function usageFromUsed(
  value: number,
  source: ContextUsageSnapshot["source"],
): ContextUsageSnapshot {
  const usedPercent = clampPercent(value);
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    source,
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
