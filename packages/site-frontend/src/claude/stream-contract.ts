// Canonical browser/test contract vocabulary for the Claude Code stream-json
// surface. Pinned here so server, runtime adapter, browser, and tests share
// the same names. Sourced from claude-remote/public/claude-stream-contract.js
// (production-validated against real claude --output-format stream-json).
//
// The adapter passes through any event type unchanged — these sets are the
// *known* surface, not exhaustive whitelists. Unknown events should still
// render (renderers fall through to a generic block).

export const CLAUDE_STREAM_EVENT_TYPES = {
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  RESULT: "result",
  STREAM_EVENT: "stream_event",
  RATE_LIMIT_EVENT: "rate_limit_event",
} as const;

export type ClaudeStreamEventType =
  (typeof CLAUDE_STREAM_EVENT_TYPES)[keyof typeof CLAUDE_STREAM_EVENT_TYPES];

export const CLAUDE_STREAM_EVENT_TYPE_VALUES: ReadonlySet<string> = new Set(
  Object.values(CLAUDE_STREAM_EVENT_TYPES),
);

/** Built-in tool names. MCP tools follow `mcp__<server>__<tool>` and are
 *  detected via {@link isMcpToolName}. */
export const CLAUDE_BUILTIN_TOOL_NAMES = [
  "Bash",
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "Glob",
  "Grep",
  "Task",
  "TodoWrite",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
] as const;

export type ClaudeBuiltinToolName = (typeof CLAUDE_BUILTIN_TOOL_NAMES)[number];

export const CLAUDE_BUILTIN_TOOL_NAME_SET: ReadonlySet<string> = new Set(CLAUDE_BUILTIN_TOOL_NAMES);

export function isMcpToolName(name: unknown): boolean {
  return typeof name === "string" && name.startsWith("mcp__");
}

/** `result` event subtypes. `success` and the two error variants come from
 *  claude itself; `interrupted` is what the runtime adapter synthesizes for
 *  SIGINT flows that don't otherwise produce a result. */
export const CLAUDE_RESULT_SUBTYPES = {
  SUCCESS: "success",
  ERROR_MAX_TURNS: "error_max_turns",
  ERROR_DURING_EXECUTION: "error_during_execution",
  INTERRUPTED: "interrupted",
} as const;

export type ClaudeResultSubtype =
  (typeof CLAUDE_RESULT_SUBTYPES)[keyof typeof CLAUDE_RESULT_SUBTYPES];

/** Permission modes accepted by `--permission-mode` and visible in
 *  `system` init events. */
export const CLAUDE_PERMISSION_MODES = {
  DEFAULT: "default",
  PLAN: "plan",
  ACCEPT_EDITS: "acceptEdits",
  BYPASS_PERMISSIONS: "bypassPermissions",
} as const;

export type ClaudePermissionMode =
  (typeof CLAUDE_PERMISSION_MODES)[keyof typeof CLAUDE_PERMISSION_MODES];

export const CLAUDE_PERMISSION_MODE_VALUES: ReadonlySet<string> = new Set(
  Object.values(CLAUDE_PERMISSION_MODES),
);

/** Adapter-side meta event phases — emitted by the runtime adapter, not by
 *  claude. `kind: "adapter.meta"` distinguishes them from pass-through
 *  `kind: "claude.event"`. */
export const ADAPTER_META_PHASES = {
  SESSION_STARTED: "session_started",
  PARSE_ERROR: "parse_error",
  EXIT: "exit",
  SPAWN_ERROR: "spawn_error",
  APPROVAL_PENDING: "approval_pending",
  PERMISSION_MODE_CHANGED: "permission_mode_changed",
} as const;

export type AdapterMetaPhase = (typeof ADAPTER_META_PHASES)[keyof typeof ADAPTER_META_PHASES];

export const ADAPTER_META_PHASE_VALUES: ReadonlySet<string> = new Set(
  Object.values(ADAPTER_META_PHASES),
);

// ---- Content block shapes (assistant message inner content) ---------------
//
// Claude's stream-json `assistant` events carry a `message.content` array of
// blocks. The renderer handles three primary kinds; everything else falls
// through.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ToolResultContentBlock[] | { text?: string };
  is_error?: boolean;
}

export type ToolResultContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
    };

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string };
