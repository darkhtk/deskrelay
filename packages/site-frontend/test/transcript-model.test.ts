// Tests for TranscriptModel — covers the entry accumulation logic + render
// output. Ported from the original browser prototype tests/transcript.test.* but recast to
// the model-only API (no DOM); the Solid component layer is tested
// separately in transcript-component.test.tsx.

import { describe, expect, test } from "vitest";
import { TranscriptModel } from "../src/claude/transcript-model.ts";

describe("TranscriptModel — system init", () => {
  test("captures session metadata once", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "system",
      subtype: "init",
      session_id: "sess_abc12345",
      model: "claude-opus-4-7",
      cwd: "/home/user",
      permissionMode: "default",
      tools: [{}, {}, {}],
      mcp_servers: [{}, {}],
    });
    expect(m.sessionMeta?.sessionId).toBe("sess_abc12345");
    expect(m.sessionMeta?.model).toBe("claude-opus-4-7");
    expect(m.sessionMeta?.tools).toBe(3);
    expect(m.sessionMeta?.mcpServers).toBe(2);
  });

  test("does not overwrite session metadata on repeat init", () => {
    const m = new TranscriptModel();
    m.ingestEvent({ type: "system", subtype: "init", session_id: "first" });
    m.ingestEvent({ type: "system", subtype: "init", session_id: "second" });
    expect(m.sessionMeta?.sessionId).toBe("first");
  });

  test("non-init system events are ignored", () => {
    const m = new TranscriptModel();
    m.ingestEvent({ type: "system", subtype: "other" });
    expect(m.sessionMeta).toBeNull();
    expect(m.entries).toHaveLength(0);
  });
});

describe("TranscriptModel — assistant + user messages", () => {
  test("text block becomes a message entry", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    });
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]?.kind).toBe("message");
    if (m.entries[0]?.kind === "message") {
      expect(m.entries[0].role).toBe("assistant");
      expect(m.entries[0].blocks[0]).toEqual({ kind: "text", text: "hello" });
    }
  });

  test("user message with text block", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hi claude" }] },
    });
    expect(m.entries[0]?.kind === "message" && m.entries[0].role).toBe("user");
  });

  test("user image block keeps attachment metadata in the rendered transcript", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            name: "photo.png",
            size: 2048,
            source: {
              type: "base64",
              media_type: "image/png",
              data: "aW1hZ2U=",
            },
          },
        ],
      },
    });
    const html = m.render();
    expect(html).toContain("photo.png");
    expect(html).toContain("2 KiB");
  });

  test("string content becomes a text message entry", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "assistant",
      message: { role: "assistant", content: "hello as a string" },
    });
    expect(m.render()).toContain("hello as a string");
  });

  test("transient tool activity is ignored", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "pwd" } }],
      },
    });
    m.ingestEvent({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "C:\\repo" }],
      },
    });
    expect(m.entries).toHaveLength(0);
    expect(m.render()).toBe("");
  });

  test("visible text is kept when mixed with transient tool activity", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I checked it." },
          { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    });
    expect(m.entries).toHaveLength(1);
    if (m.entries[0]?.kind === "message") {
      expect(m.entries[0].blocks).toEqual([{ kind: "text", text: "I checked it." }]);
    }
  });

  test("thinking block is kept (non-empty)", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "let me think" }] },
    });
    if (m.entries[0]?.kind === "message") {
      expect(m.entries[0].blocks[0]?.kind).toBe("thinking");
    }
  });

  test("empty thinking is dropped", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "   " }] },
    });
    expect(m.entries).toHaveLength(0);
  });

  test("messages with no recognized blocks produce no entry", () => {
    const m = new TranscriptModel();
    m.ingestEvent({ type: "assistant", message: { content: [{ type: "unknown" }] } });
    expect(m.entries).toHaveLength(0);
  });

  test("stream_event text deltas render as a live partial assistant message", () => {
    const m = new TranscriptModel();
    m.ingestEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "hel" },
        },
      },
      1,
    );
    m.ingestEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "lo" },
        },
      },
      2,
    );
    expect(m.entries).toHaveLength(1);
    if (m.entries[0]?.kind === "message") {
      expect(m.entries[0].role).toBe("assistant");
      expect(m.entries[0].blocks[0]).toEqual({ kind: "text", text: "hello" });
      expect(m.entries[0].cursor).toBe(2);
    }
    expect(m.render()).toContain("hello");
  });

  test("final assistant message replaces the live partial assistant message", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "stream_event",
      delta: { type: "text_delta", text: "partial" },
    });
    m.ingestEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "final" }] },
    });
    expect(m.entries).toHaveLength(1);
    expect(m.render()).not.toContain("partial");
    expect(m.render()).toContain("final");
  });
});

describe("TranscriptModel — result + exit", () => {
  test("result event captures timestamp / duration / turns without cost", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      timestamp: "2026-05-15T13:05:09+09:00",
      total_cost_usd: 0.0123,
      duration_ms: 4500,
      num_turns: 3,
    });
    expect(m.entries[0]).toMatchObject({
      kind: "result",
      isError: false,
      timestampMs: Date.parse("2026-05-15T13:05:09+09:00"),
      durationMs: 4500,
      turns: 3,
    });
    expect(m.render()).toContain("13:05:09");
    expect(m.render()).not.toContain("$0.0123");
  });

  test("error result keeps the body text", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "rate limited",
    });
    if (m.entries[0]?.kind === "result") {
      expect(m.entries[0].isError).toBe(true);
      expect(m.entries[0].text).toBe("rate limited");
    }
  });

  test("exit envelope sets exitMeta with stderrTail", () => {
    const m = new TranscriptModel();
    m.ingest({ kind: "claude.exit", code: 1, signal: null, stderrTail: "boom" });
    expect(m.exitMeta).toEqual({ code: 1, signal: null, stderrTail: "boom" });
  });
});

describe("TranscriptModel — adapter errors", () => {
  test("spawn_error becomes an error-severity adapter_error", () => {
    const m = new TranscriptModel();
    m.ingest({ kind: "adapter.meta", phase: "spawn_error", error: "ENOENT claude" });
    if (m.entries[0]?.kind === "adapter_error") {
      expect(m.entries[0].severity).toBe("error");
      expect(m.entries[0].message).toContain("ENOENT");
    }
  });

  test("parse_error becomes a warn-severity adapter_error with the offending line", () => {
    const m = new TranscriptModel();
    m.ingest({ kind: "claude.parse_error", error: "bad json", line: "{ malformed" });
    if (m.entries[0]?.kind === "adapter_error") {
      expect(m.entries[0].severity).toBe("warn");
      expect(m.entries[0].line).toBe("{ malformed");
    }
  });

  test("stderr chunk becomes a warn adapter_error", () => {
    const m = new TranscriptModel();
    m.ingest({ kind: "claude.stderr", chunk: "deprecation: foo" });
    if (m.entries[0]?.kind === "adapter_error") {
      expect(m.entries[0].phase).toBe("stderr");
      expect(m.entries[0].message).toContain("deprecation");
    }
  });
});

describe("TranscriptModel.render", () => {
  test("session strip + assistant message + result footer", () => {
    const m = new TranscriptModel();
    m.ingestEvent({ type: "system", subtype: "init", session_id: "sess_xyz12345" });
    m.ingestEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "**bold**" }] },
    });
    m.ingestEvent({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
    });
    const html = m.render();
    expect(html).toContain("session-strip");
    expect(html).toContain("sess_xyz"); // truncated to first 8 chars
    expect(html).toContain('class="message message-assistant"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("result-footer");
    expect(html).toContain("✓");
  });

  test("error result includes the body text in a <pre>", () => {
    const m = new TranscriptModel();
    m.ingestEvent({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "rate limited",
    });
    const html = m.render();
    expect(html).toContain("result-error");
    expect(html).toContain("rate limited");
  });

  test("exit footer with non-zero code marks as error", () => {
    const m = new TranscriptModel();
    m.setExitMeta({ code: 2, signal: null, stderrTail: "panic" });
    const html = m.render();
    expect(html).toContain("exit-footer-error");
    expect(html).toContain("(code 2)");
    expect(html).toContain("panic");
  });

  test("empty model renders empty string", () => {
    expect(new TranscriptModel().render()).toBe("");
  });
});

describe("TranscriptModel — wrapped envelope dispatch", () => {
  test("claude.event with assistant text round-trips through ingestEvent", () => {
    const m = new TranscriptModel();
    m.ingest({
      kind: "claude.event",
      cursor: 5,
      event: {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      },
    });
    expect(m.entries).toHaveLength(1);
    if (m.entries[0]?.kind === "message") {
      expect(m.entries[0].cursor).toBe(5);
    }
  });

  test("unknown wrapped kind is silently ignored", () => {
    const m = new TranscriptModel();
    m.ingest({ kind: "unknown.thing" } as never);
    expect(m.entries).toHaveLength(0);
  });
});
