import type { ClaudeStreamEvent } from "../api.ts";
import { t } from "../i18n.ts";

export function describeCliActionFromEnvelope(
  kind: string | undefined,
  content: unknown,
): string | null {
  switch (kind) {
    case "run.started":
      return t("cli.action.starting");
    case "claude.event":
      return describeCliActionFromClaudeEvent(content);
    case "claude.stderr":
      return t("cli.action.warning");
    case "adapter.meta":
      return describeAdapterMetaAction(content);
    case "run.finished":
      return t("cli.action.finished");
    case "run.error":
      return t("cli.action.error");
    default:
      return null;
  }
}

export function isApprovalWaitingAction(label: string | null): boolean {
  return label === t("cli.action.approval-waiting");
}

function describeAdapterMetaAction(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const phase = (content as { phase?: unknown }).phase;
  return phase === "approval_pending" ? t("cli.action.approval-waiting") : null;
}

export function describeCliActionFromClaudeEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as ClaudeStreamEvent;
  if (e.type === "system") return t("cli.action.initializing");
  if (e.type === "result") return t("cli.action.finishing");
  if (e.type === "assistant") {
    const blocks = messageContentBlocks(e);
    const toolUse = blocks.find((block) => block.type === "tool_use");
    if (toolUse) return describeToolAction(toolUse);
    if (blocks.some((block) => block.type === "thinking")) return t("cli.action.thinking");
    if (blocks.some((block) => block.type === "text")) return t("cli.action.responding");
  }
  if (e.type === "user") {
    const blocks = messageContentBlocks(e);
    if (blocks.some((block) => block.type === "tool_result")) return t("cli.action.tool-result");
  }
  return null;
}

export function shouldAppendClaudeEventToTranscript(event: unknown): boolean {
  return claudeEventForTranscript(event) !== null;
}

export function claudeEventForTranscript(event: unknown): ClaudeStreamEvent | null {
  if (!event || typeof event !== "object") return null;
  const e = event as ClaudeStreamEvent;
  if (e.type === "assistant" || e.type === "user") {
    const content = messageContentBlocks(e).filter(isUserVisibleMessageBlock);
    if (content.length === 0) return null;
    const message =
      e.message && typeof e.message === "object" ? (e.message as Record<string, unknown>) : {};
    return { ...e, message: { ...message, content } };
  }
  if (e.type === "stream_event") return hasTextDelta(e) ? e : null;
  return e;
}

function messageContentBlocks(event: ClaudeStreamEvent): Array<Record<string, unknown>> {
  const message = event.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is Record<string, unknown> => Boolean(block) && typeof block === "object",
  );
}

function isUserVisibleMessageBlock(block: Record<string, unknown>): boolean {
  return block.type === "text" || block.type === "image";
}

function hasTextDelta(event: ClaudeStreamEvent): boolean {
  const source =
    event.event && typeof event.event === "object"
      ? (event.event as Record<string, unknown>)
      : (event as Record<string, unknown>);
  const delta =
    source.delta && typeof source.delta === "object"
      ? (source.delta as Record<string, unknown>)
      : null;
  return typeof delta?.text === "string" && delta.text.length > 0;
}

function describeToolAction(toolUse: Record<string, unknown>): string {
  const name = typeof toolUse.name === "string" ? toolUse.name : "";
  const normalized = name.toLowerCase();
  if (normalized === "bash") return t("cli.action.tool.bash");
  if (normalized === "read") return t("cli.action.tool.read");
  if (normalized === "write" || normalized === "edit" || normalized === "multiedit") {
    return t("cli.action.tool.edit");
  }
  if (normalized === "grep" || normalized === "glob" || normalized === "ls") {
    return t("cli.action.tool.search");
  }
  if (normalized === "todowrite") return t("cli.action.tool.todo");
  if (normalized === "webfetch" || normalized === "websearch") return t("cli.action.tool.web");
  if (normalized.startsWith("mcp__")) return t("cli.action.tool.mcp");
  return t("cli.action.tool.generic", { tool: name || "tool" });
}
