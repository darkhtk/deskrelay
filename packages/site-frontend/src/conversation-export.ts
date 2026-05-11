import type { ClaudeStreamEvent } from "./api.ts";
import { escapeHtml } from "./claude/message-renderer.ts";
import { TranscriptModel } from "./claude/transcript-model.ts";

export interface ConversationExportSnapshot {
  deviceId: string | null;
  deviceLabel?: string | null;
  sessionId?: string | null;
  title?: string | null;
  cwd: string;
  events: ClaudeStreamEvent[];
  generatedAt: string;
}

export function hasConversationExport(snapshot: ConversationExportSnapshot | null): boolean {
  return Boolean(snapshot?.events.length);
}

export function conversationExportFileBase(snapshot: ConversationExportSnapshot): string {
  const title = snapshot.title?.trim() || snapshot.sessionId?.slice(0, 8) || "conversation";
  const date = exportDatePart(snapshot.generatedAt);
  return sanitizeFilePart(`deskrelay-${date}-${title}`).slice(0, 96) || `deskrelay-${date}`;
}

export function conversationToMarkdown(snapshot: ConversationExportSnapshot): string {
  const lines = [
    "# DeskRelay Conversation",
    "",
    `- Device: ${snapshot.deviceLabel || snapshot.deviceId || "unknown"}`,
    `- Session: ${snapshot.sessionId || "new chat"}`,
    `- CWD: ${snapshot.cwd || "not set"}`,
    `- Exported: ${snapshot.generatedAt}`,
    `- Events: ${snapshot.events.length}`,
    "",
    "---",
    "",
  ];

  const body = eventsToMarkdown(snapshot.events);
  lines.push(body.trim() || "_No transcript content._", "");
  return lines.join("\n");
}

export function conversationToPrintableHtml(snapshot: ConversationExportSnapshot): string {
  const model = new TranscriptModel();
  for (const event of snapshot.events) model.ingestEvent(event);
  const title = escapeHtml(snapshot.title?.trim() || "DeskRelay conversation");
  const meta = [
    ["Device", snapshot.deviceLabel || snapshot.deviceId || "unknown"],
    ["Session", snapshot.sessionId || "new chat"],
    ["CWD", snapshot.cwd || "not set"],
    ["Exported", snapshot.generatedAt],
  ];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    :root {
      color: #1f1f1f;
      background: #fff;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.55;
    }
    body { margin: 32px auto; max-width: 820px; padding: 0 24px; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    .export-meta { color: #666; border-bottom: 1px solid #ddd; padding-bottom: 16px; margin-bottom: 24px; }
    .export-meta div { margin: 2px 0; }
    .session-strip { color: #777; border: 1px solid #ddd; border-radius: 999px; display: inline-flex; gap: 10px; padding: 4px 10px; margin-bottom: 16px; }
    .message { margin: 18px 0; page-break-inside: avoid; }
    .message-user { text-align: right; }
    .message-user .block-text { display: inline-block; text-align: left; background: #f5f2ef; border: 1px solid #e4ded8; border-radius: 14px; padding: 10px 14px; max-width: 80%; }
    .message-assistant .block-text { max-width: 100%; }
    pre, code { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; }
    pre { white-space: pre-wrap; background: #f6f6f6; border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; overflow-wrap: anywhere; }
    .block-tool-use, .block-tool-result, .result-footer, .result-error-body, .adapter-error { color: #666; border-top: 1px solid #e6e6e6; padding-top: 8px; margin-top: 12px; }
    .block-image img { max-width: 100%; border: 1px solid #ddd; border-radius: 8px; }
    .block-image figcaption { color: #777; font-size: 12px; }
    @media print {
      body { margin: 0 auto; }
      .message-user .block-text { max-width: 92%; }
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="export-meta">
    ${meta
      .map(
        ([label, value]) =>
          `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`,
      )
      .join("")}
  </div>
  ${model.render() || "<p><em>No transcript content.</em></p>"}
</body>
</html>`;
}

export function downloadConversationMarkdown(snapshot: ConversationExportSnapshot): string {
  const filename = `${conversationExportFileBase(snapshot)}.md`;
  downloadBlob(filename, conversationToMarkdown(snapshot), "text/markdown;charset=utf-8");
  return filename;
}

export function openConversationPdfPrint(snapshot: ConversationExportSnapshot): boolean {
  if (typeof window === "undefined") return false;
  const printWindow = window.open("", "_blank", "width=960,height=720");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(conversationToPrintableHtml(snapshot));
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    try {
      printWindow.print();
    } catch {
      // The printable window remains open so the user can print manually.
    }
  }, 150);
  return true;
}

function eventsToMarkdown(events: ClaudeStreamEvent[]): string {
  const chunks: string[] = [];
  let pendingAssistant = "";
  const flushPendingAssistant = () => {
    if (!pendingAssistant.trim()) {
      pendingAssistant = "";
      return;
    }
    chunks.push(`## Assistant\n\n${pendingAssistant.trim()}`);
    pendingAssistant = "";
  };

  for (const event of events) {
    const record = asRecord(event);
    if (!record) continue;
    const type = String(record.type ?? "");
    if (type !== "stream_event") flushPendingAssistant();

    if (type === "user" || type === "assistant") {
      const message = asRecord(record.message);
      const role = type === "user" ? "User" : "Assistant";
      const body = contentToMarkdown(message?.content);
      if (body.trim()) chunks.push(`## ${role}\n\n${body.trim()}`);
    } else if (type === "stream_event") {
      pendingAssistant += streamDeltaText(record);
    } else if (type === "result") {
      const result = typeof record.result === "string" ? record.result : "";
      const subtype = typeof record.subtype === "string" ? record.subtype : "result";
      const meta = [
        subtype,
        typeof record.total_cost_usd === "number"
          ? `$${Number(record.total_cost_usd).toFixed(4)}`
          : "",
        typeof record.duration_ms === "number" ? `${record.duration_ms}ms` : "",
        typeof record.num_turns === "number" ? `${record.num_turns} turn` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      chunks.push([`---\n\n_Result: ${meta}_`, result.trim()].filter(Boolean).join("\n\n"));
    }
  }
  flushPendingAssistant();
  return chunks.join("\n\n");
}

function contentToMarkdown(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((raw) => blockToMarkdown(asRecord(raw)))
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
}

function blockToMarkdown(block: Record<string, unknown> | null): string {
  if (!block) return "";
  if (block.type === "text" && typeof block.text === "string") return block.text;
  if (block.type === "thinking" && typeof block.thinking === "string") {
    return `> Thinking\n>\n${block.thinking
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n")}`;
  }
  if (block.type === "image") {
    return imageBlockToMarkdown(block);
  }
  if (block.type === "tool_use") {
    const name = typeof block.name === "string" ? block.name : "tool";
    return `### Tool: ${name}\n\n\`\`\`json\n${safeJson(block.input ?? {})}\n\`\`\``;
  }
  if (block.type === "tool_result") {
    const prefix = block.is_error ? "### Tool Result (error)" : "### Tool Result";
    return `${prefix}\n\n${toolResultContentToMarkdown(block.content)}`;
  }
  return `\`\`\`json\n${safeJson(block)}\n\`\`\``;
}

function imageBlockToMarkdown(block: Record<string, unknown>): string {
  const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : "image";
  const source = asRecord(block.source);
  if (!source) return `[image: ${name}]`;
  if (source.type === "base64") {
    const mediaType = typeof source.media_type === "string" ? source.media_type : "image/png";
    const data = typeof source.data === "string" ? source.data : "";
    return data
      ? `![${escapeMarkdownAlt(name)}](data:${mediaType};base64,${data})`
      : `[image: ${name}]`;
  }
  if (source.type === "url" && typeof source.url === "string") {
    return `![${escapeMarkdownAlt(name)}](${source.url})`;
  }
  return `[image: ${name}]`;
}

function toolResultContentToMarkdown(content: unknown): string {
  if (typeof content === "string") return fencedMaybe(content);
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        const block = asRecord(item);
        if (!block) return "";
        if (block.type === "text" && typeof block.text === "string") return fencedMaybe(block.text);
        if (block.type === "image") return imageBlockToMarkdown(block);
        return `\`\`\`json\n${safeJson(block)}\n\`\`\``;
      })
      .filter(Boolean)
      .join("\n\n");
  }
  const record = asRecord(content);
  if (record && typeof record.text === "string") return fencedMaybe(record.text);
  return content == null ? "" : `\`\`\`json\n${safeJson(content)}\n\`\`\``;
}

function streamDeltaText(record: Record<string, unknown>): string {
  const inner = asRecord(record.event) ?? record;
  const delta = asRecord(inner.delta);
  return typeof delta?.text === "string" ? delta.text : "";
}

function fencedMaybe(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.includes("\n") || trimmed.length > 120 ? `\`\`\`\n${trimmed}\n\`\`\`` : trimmed;
}

function downloadBlob(filename: string, content: string, type: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function exportDatePart(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown-date";
  return date.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/[\[\]\\]/g, "\\$&");
}
