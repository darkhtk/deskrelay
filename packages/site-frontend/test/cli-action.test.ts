import { describe, expect, test } from "vitest";
import {
  claudeEventForTranscript,
  describeCliActionFromClaudeEvent,
  describeCliActionFromEnvelope,
  shouldAppendClaudeEventToTranscript,
} from "../src/claude/cli-action.ts";
import { t } from "../src/i18n.ts";

describe("CLI action descriptions", () => {
  test("describes run lifecycle envelopes", () => {
    expect(describeCliActionFromEnvelope("run.started", {})).toBe(t("cli.action.starting"));
    expect(describeCliActionFromEnvelope("run.finished", {})).toBe(t("cli.action.finished"));
    expect(describeCliActionFromEnvelope("run.error", {})).toBe(t("cli.action.error"));
    expect(describeCliActionFromEnvelope("adapter.meta", { phase: "approval_pending" })).toBe(
      t("cli.action.approval-waiting"),
    );
  });

  test("maps common Claude tool_use blocks to short actions", () => {
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      }),
    ).toBe(t("cli.action.tool.bash"));
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      }),
    ).toBe(t("cli.action.tool.read"));
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "mcp__server__tool", input: {} }] },
      }),
    ).toBe(t("cli.action.tool.mcp"));
  });

  test("describes text and tool-result phases", () => {
    expect(
      describeCliActionFromClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    ).toBe(t("cli.action.responding"));
    expect(
      describeCliActionFromClaudeEvent({
        type: "user",
        message: { content: [{ type: "tool_result", content: "ok" }] },
      }),
    ).toBe(t("cli.action.tool-result"));
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
