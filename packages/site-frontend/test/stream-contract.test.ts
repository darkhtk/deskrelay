import { describe, expect, test } from "vitest";
import {
  ADAPTER_META_PHASES,
  ADAPTER_META_PHASE_VALUES,
  CLAUDE_BUILTIN_TOOL_NAMES,
  CLAUDE_BUILTIN_TOOL_NAME_SET,
  CLAUDE_PERMISSION_MODE_VALUES,
  CLAUDE_RESULT_SUBTYPES,
  CLAUDE_STREAM_EVENT_TYPE_VALUES,
  isMcpToolName,
} from "../src/claude/stream-contract.ts";

describe("CLAUDE_STREAM_EVENT_TYPES", () => {
  test("includes the six known event types", () => {
    expect(CLAUDE_STREAM_EVENT_TYPE_VALUES.has("system")).toBe(true);
    expect(CLAUDE_STREAM_EVENT_TYPE_VALUES.has("user")).toBe(true);
    expect(CLAUDE_STREAM_EVENT_TYPE_VALUES.has("assistant")).toBe(true);
    expect(CLAUDE_STREAM_EVENT_TYPE_VALUES.has("result")).toBe(true);
    expect(CLAUDE_STREAM_EVENT_TYPE_VALUES.has("stream_event")).toBe(true);
    expect(CLAUDE_STREAM_EVENT_TYPE_VALUES.has("rate_limit_event")).toBe(true);
  });
});

describe("CLAUDE_BUILTIN_TOOL_NAMES", () => {
  test("contains the canonical built-ins", () => {
    for (const name of [
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
    ]) {
      expect(CLAUDE_BUILTIN_TOOL_NAME_SET.has(name)).toBe(true);
    }
  });

  test("array length matches set size (no dupes)", () => {
    expect(CLAUDE_BUILTIN_TOOL_NAMES.length).toBe(CLAUDE_BUILTIN_TOOL_NAME_SET.size);
  });
});

describe("isMcpToolName", () => {
  test("matches mcp__ prefix", () => {
    expect(isMcpToolName("mcp__server__list_files")).toBe(true);
  });
  test("rejects built-ins and bare strings", () => {
    expect(isMcpToolName("Bash")).toBe(false);
    expect(isMcpToolName("server__tool")).toBe(false);
  });
  test("rejects non-strings", () => {
    expect(isMcpToolName(null)).toBe(false);
    expect(isMcpToolName(42)).toBe(false);
    expect(isMcpToolName(undefined)).toBe(false);
  });
});

describe("CLAUDE_RESULT_SUBTYPES", () => {
  test("covers success + 2 error variants + interrupted", () => {
    expect(CLAUDE_RESULT_SUBTYPES.SUCCESS).toBe("success");
    expect(CLAUDE_RESULT_SUBTYPES.ERROR_MAX_TURNS).toBe("error_max_turns");
    expect(CLAUDE_RESULT_SUBTYPES.ERROR_DURING_EXECUTION).toBe("error_during_execution");
    expect(CLAUDE_RESULT_SUBTYPES.INTERRUPTED).toBe("interrupted");
  });
});

describe("CLAUDE_PERMISSION_MODES", () => {
  test("matches the CLI flag values", () => {
    expect(CLAUDE_PERMISSION_MODE_VALUES).toEqual(
      new Set(["default", "auto", "plan", "acceptEdits", "dontAsk", "bypassPermissions"]),
    );
  });
});

describe("ADAPTER_META_PHASES", () => {
  test("covers session lifecycle + approval phases", () => {
    expect(ADAPTER_META_PHASE_VALUES.has("session_started")).toBe(true);
    expect(ADAPTER_META_PHASE_VALUES.has("exit")).toBe(true);
    expect(ADAPTER_META_PHASE_VALUES.has("approval_pending")).toBe(true);
    expect(ADAPTER_META_PHASE_VALUES.has("permission_mode_changed")).toBe(true);
  });

  test("matches the literal phase values", () => {
    expect(ADAPTER_META_PHASES.SESSION_STARTED).toBe("session_started");
    expect(ADAPTER_META_PHASES.SPAWN_ERROR).toBe("spawn_error");
  });
});
