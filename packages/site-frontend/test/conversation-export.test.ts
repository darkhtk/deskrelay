import { describe, expect, test } from "vitest";
import type { ClaudeStreamEvent } from "../src/api.ts";
import {
  type ConversationExportSnapshot,
  conversationExportFileBase,
  conversationToMarkdown,
  conversationToPrintableHtml,
  hasConversationExport,
} from "../src/conversation-export.ts";

function snapshot(events: ClaudeStreamEvent[]): ConversationExportSnapshot {
  return {
    deviceId: "dev_1",
    deviceLabel: "HOMEDEV (Server)",
    sessionId: "session-123456789",
    title: "hello/world?",
    cwd: "C:\\Users\\darkh\\Projects\\demo",
    events,
    generatedAt: "2026-05-11T09:30:00.000Z",
  };
}

describe("conversation export", () => {
  test("detects whether there is a loaded conversation", () => {
    expect(hasConversationExport(null)).toBe(false);
    expect(hasConversationExport(snapshot([]))).toBe(false);
    expect(
      hasConversationExport(
        snapshot([
          { type: "user", message: { role: "user", content: "ping" } } as ClaudeStreamEvent,
        ]),
      ),
    ).toBe(true);
  });

  test("renders user, assistant, image, tool, and result blocks as markdown", () => {
    const markdown = conversationToMarkdown(
      snapshot([
        { type: "user", message: { role: "user", content: "ping" } } as ClaudeStreamEvent,
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "pong" },
              {
                type: "tool_use",
                id: "tool-1",
                name: "Read",
                input: { file_path: "README.md" },
              },
            ],
          },
        } as ClaudeStreamEvent,
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "image",
                name: "dog.png",
                source: { type: "base64", media_type: "image/png", data: "abc123" },
              },
            ],
          },
        } as ClaudeStreamEvent,
        {
          type: "result",
          subtype: "success",
          total_cost_usd: 0.0123,
          duration_ms: 321,
          num_turns: 1,
        } as ClaudeStreamEvent,
      ]),
    );

    expect(markdown).toContain("# DeskRelay Conversation");
    expect(markdown).toContain("## User\n\nping");
    expect(markdown).toContain("## Assistant\n\npong");
    expect(markdown).toContain("### Tool: Read");
    expect(markdown).toContain("![dog.png](data:image/png;base64,abc123)");
    expect(markdown).toContain("_Result: success · $0.0123 · 321ms · 1 turn_");
  });

  test("sanitizes the download base name", () => {
    expect(conversationExportFileBase(snapshot([]))).toBe("deskrelay-2026-05-11-0930-hello-world");
  });

  test("renders printable html with transcript content", () => {
    const html = conversationToPrintableHtml(
      snapshot([
        { type: "assistant", message: { role: "assistant", content: "pong" } } as ClaudeStreamEvent,
      ]),
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("HOMEDEV (Server)");
    expect(html).toContain("pong");
  });
});
