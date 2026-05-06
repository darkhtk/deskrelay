import { describe, expect, test } from "vitest";
import {
  claudeEventForTranscript,
  describeCliActionFromClaudeEvent,
  describeCliActionFromEnvelope,
  shouldAppendClaudeEventToTranscript,
} from "../src/claude/cli-action.ts";

describe("CLI action descriptions", () => {
  test("describes run lifecycle envelopes", () => {
    expect(describeCliActionFromEnvelope("run.started", {})).toBe("Starting Claude CLI");
    expect(describeCliActionFromEnvelope("run.finished", {})).toBe("Claude CLI finished");
    expect(describeCliActionFromEnvelope("run.error", {})).toBe("Claude CLI error");
    expect(describeCliActionFromEnvelope("adapter.meta", { phase: "approval_pending" })).toBe(
      "Waiting for permission approval",
    );
  });

  test("maps common Claude tool_use blocks to short actions", () => {
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      }),
    ).toBe("Running Bash");
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      }),
    ).toBe("Reading files");
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "mcp__server__tool", input: {} }] },
      }),
    ).toBe("Using MCP tool");
  });

  test("describes text and tool-result phases", () => {
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    ).toBe("Writing response");
    expect(
      describeCliActionFromClaudeEvent({
        type: "user",
        message: { content: [{ type: "tool_result", content: "ok" }] },
      }),
    ).toBe("Reading tool result");
  });

  test("keeps user-facing Claude events in the transcript", () => {
    expect(
      shouldAppendClaudeEventToTranscript({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    ).toBe(true);
    expect(
      shouldAppendClaudeEventToTranscript({
        type: "assistant",
        message: { content: "hello as a string" },
      }),
    ).toBe(true);
    expect(
      shouldAppendClaudeEventToTranscript({
        type: "user",
        message: {
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "iVBORw0KG" },
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      shouldAppendClaudeEventToTranscript({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "h" } },
      }),
    ).toBe(true);
  });

  test("keeps transient tool activity out of the transcript", () => {
    expect(
      shouldAppendClaudeEventToTranscript({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      }),
    ).toBe(false);
    expect(
      shouldAppendClaudeEventToTranscript({
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "checking files" }] },
      }),
    ).toBe(false);
    expect(
      shouldAppendClaudeEventToTranscript({
        type: "user",
        message: { content: [{ type: "tool_result", content: "ok" }] },
      }),
    ).toBe(false);
  });

  test("strips transient blocks when a visible message is mixed with tool activity", () => {
    const event = claudeEventForTranscript({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I checked it." },
          { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    });

    expect(event).toEqual({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I checked it." }],
      },
    });
  });
});
