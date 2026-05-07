// transcript-model — accumulates claude stream-json events into typed
// entries and renders them to an HTML string. Pure class, no DOM:
// the host (Transcript.tsx) calls render() and assigns the result to
// innerHTML so Solid's reactivity recomputes when events change.
//
// Ported from the original browser prototype/transcript.js (production-validated).
// Behavior preserved; types added; envelope handling kept compatible
// with both raw claude events (current platform wire) and the wrapped
// `{kind: "claude.event", event, cursor}` envelope (legacy ops-cure
// wire) so migration callers can use either.

import { escapeHtml, renderMarkdown } from "./message-renderer.ts";
import type { ClaudePermissionMode, ToolResultContentBlock } from "./stream-contract.ts";
import { renderToolResult, renderToolUse } from "./tool-renderers.ts";

interface SessionMeta {
  sessionId?: string | undefined;
  model?: string | undefined;
  cwd?: string | undefined;
  permissionMode?: ClaudePermissionMode | string | undefined;
  tools?: number | null | undefined;
  mcpServers?: number | null | undefined;
}

interface ExitMeta {
  code?: number | null | undefined;
  signal?: string | null | undefined;
  stderrTail?: string | null | undefined;
}

interface MessageBlock {
  kind: "text" | "tool_use" | "tool_result" | "thinking" | "image";
  // text / thinking
  text?: string | undefined;
  // tool_use
  entryId?: string | undefined;
  // tool_use / tool_result / image — opaque payload per kind
  payload?: unknown;
  source?: unknown;
}

interface MessageEntry {
  kind: "message";
  role: "user" | "assistant";
  cursor?: string | number | undefined;
  blocks: MessageBlock[];
}

interface ResultEntry {
  kind: "result";
  cursor?: string | number | undefined;
  subtype?: string | undefined;
  isError: boolean;
  text: string;
  costUsd?: number | undefined;
  durationMs?: number | undefined;
  turns?: number | undefined;
}

interface AdapterErrorEntry {
  kind: "adapter_error";
  cursor?: string | number | undefined;
  severity: "error" | "warn";
  phase: string;
  message: string;
  line?: string | undefined;
}

type Entry = MessageEntry | ResultEntry | AdapterErrorEntry;

/** Wire-level event shapes the model accepts. We deliberately keep them
 *  loose (`Record<string, unknown>`) — claude's stream-json adds fields
 *  over time and we don't want to be the schema bouncer. */
interface ClaudeRawEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  cwd?: string;
  permissionMode?: string;
  permission_mode?: string;
  tools?: unknown[];
  mcp_servers?: unknown[];
  message?: { role?: string; content?: string | unknown[] };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  [k: string]: unknown;
}

interface WrappedEnvelope {
  kind: "claude.event" | "adapter.meta" | "claude.exit" | "claude.parse_error" | "claude.stderr";
  event?: ClaudeRawEvent | undefined;
  cursor?: string | number | undefined;
  phase?: string | undefined;
  code?: number | null | undefined;
  signal?: string | null | undefined;
  stderrTail?: string | null | undefined;
  error?: string | undefined;
  line?: string | undefined;
  chunk?: string | undefined;
  data?: string | undefined;
  text?: string | undefined;
  stderr?: string | undefined;
  message?: string | undefined;
  [k: string]: unknown;
}

export class TranscriptModel {
  readonly entries: Entry[] = [];
  sessionMeta: SessionMeta | null = null;
  exitMeta: ExitMeta | null = null;
  #partialAssistantText = "";
  #partialAssistantEntry: MessageEntry | null = null;

  /** Ingest a raw claude stream-json event. Use this when the caller has
   *  already unwrapped the envelope (current platform wire). */
  ingestEvent(event: ClaudeRawEvent, cursor?: string | number): void {
    if (!event || typeof event !== "object") return;
    switch (event.type) {
      case "system":
        if (event.subtype === "init" && !this.sessionMeta) {
          this.sessionMeta = {
            sessionId: event.session_id,
            model: event.model,
            cwd: event.cwd,
            permissionMode: event.permissionMode ?? event.permission_mode,
            tools: Array.isArray(event.tools) ? event.tools.length : null,
            mcpServers: Array.isArray(event.mcp_servers) ? event.mcp_servers.length : null,
          };
        }
        return;
      case "assistant":
        this.#clearPartialAssistant();
        this.#appendMessage("assistant", event.message, cursor);
        return;
      case "user":
        this.#appendMessage("user", event.message, cursor);
        return;
      case "stream_event":
        this.#ingestStreamEvent(event, cursor);
        return;
      case "result":
        this.#clearPartialAssistant();
        this.entries.push({
          kind: "result",
          cursor,
          subtype: event.subtype,
          isError: !!event.is_error,
          text: event.result ?? "",
          ...(event.total_cost_usd !== undefined ? { costUsd: event.total_cost_usd } : {}),
          ...(event.duration_ms !== undefined ? { durationMs: event.duration_ms } : {}),
          ...(event.num_turns !== undefined ? { turns: event.num_turns } : {}),
        });
        return;
      // rate_limit_event + unknowns ignored at the transcript level.
      default:
        return;
    }
  }

  /** Ingest a wrapped envelope (legacy ops-cure wire). Dispatches to
   *  ingestEvent / ingestAdapterMeta / ingestStderr. */
  ingest(wrapped: WrappedEnvelope): void {
    if (!wrapped) return;
    if (wrapped.kind === "claude.event" && wrapped.event) {
      this.ingestEvent(wrapped.event, wrapped.cursor);
    } else if (wrapped.kind === "adapter.meta") {
      this.#ingestAdapterMeta(wrapped);
    } else if (wrapped.kind === "claude.exit") {
      this.#ingestAdapterMeta({ ...wrapped, phase: "exit" });
    } else if (wrapped.kind === "claude.parse_error") {
      this.#ingestAdapterMeta({ ...wrapped, phase: "parse_error" });
    } else if (wrapped.kind === "claude.stderr") {
      this.#ingestStderrChunk(wrapped);
    }
  }

  setExitMeta(meta: ExitMeta): void {
    this.exitMeta = meta;
  }

  #ingestAdapterMeta(wrapped: WrappedEnvelope): void {
    if (wrapped.phase === "exit") {
      this.exitMeta = {
        code: wrapped.code,
        signal: wrapped.signal,
        stderrTail:
          typeof wrapped.stderrTail === "string" && wrapped.stderrTail.length > 0
            ? wrapped.stderrTail
            : null,
      };
      return;
    }
    if (wrapped.phase === "spawn_error") {
      this.entries.push({
        kind: "adapter_error",
        cursor: wrapped.cursor,
        severity: "error",
        phase: "spawn_error",
        message: String(wrapped.error || "spawn failed"),
      });
      return;
    }
    if (wrapped.phase === "parse_error") {
      this.entries.push({
        kind: "adapter_error",
        cursor: wrapped.cursor,
        severity: "warn",
        phase: "parse_error",
        message: String(wrapped.error || "parse failed"),
        line: typeof wrapped.line === "string" ? wrapped.line : "",
      });
      return;
    }
  }

  #ingestStderrChunk(wrapped: WrappedEnvelope): void {
    const text = pickFirstString(wrapped, ["chunk", "data", "text", "stderr", "message"]);
    const body =
      text != null ? text : safeJsonStringify({ ...wrapped, kind: undefined, cursor: undefined });
    if (!body) return;
    this.entries.push({
      kind: "adapter_error",
      cursor: wrapped.cursor,
      severity: "warn",
      phase: "stderr",
      message: body.length > 200 ? `${body.slice(0, 200)}…` : body,
      line: body.length > 200 ? body : "",
    });
  }

  #appendMessage(
    role: "user" | "assistant",
    message: ClaudeRawEvent["message"],
    cursor: string | number | undefined,
  ): void {
    if (!message) return;
    if (typeof message.content === "string") {
      this.entries.push({
        kind: "message",
        role,
        cursor,
        blocks: [{ kind: "text", text: message.content }],
      });
      return;
    }
    if (!Array.isArray(message.content)) return;
    const blocks: MessageBlock[] = [];
    for (const raw of message.content) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as {
        type?: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
        thinking?: string;
        source?: unknown;
        tool_use_id?: string;
        content?: string | ToolResultContentBlock[];
        is_error?: boolean;
      };
      if (block.type === "text" && typeof block.text === "string") {
        blocks.push({ kind: "text", text: block.text });
      } else if (block.type === "tool_use" && typeof block.id === "string") {
        const entryId = `tu-${cursor ?? ""}-${block.id || blocks.length}`;
        blocks.push({ kind: "tool_use", entryId, payload: block });
      } else if (block.type === "tool_result") {
        blocks.push({ kind: "tool_result", payload: block });
      } else if (
        block.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking.trim().length > 0
      ) {
        blocks.push({ kind: "thinking", text: block.thinking });
      } else if (block.type === "image" && block.source) {
        blocks.push({ kind: "image", source: block.source });
      }
    }
    if (blocks.length === 0) return;
    this.entries.push({ kind: "message", role, cursor, blocks });
  }

  #ingestStreamEvent(event: ClaudeRawEvent, cursor: string | number | undefined): void {
    const inner =
      event.event && typeof event.event === "object"
        ? (event.event as Record<string, unknown>)
        : (event as Record<string, unknown>);
    const delta =
      inner.delta && typeof inner.delta === "object"
        ? (inner.delta as Record<string, unknown>)
        : null;
    const text = typeof delta?.text === "string" ? delta.text : "";
    if (!text) return;
    const deltaType = typeof delta?.type === "string" ? delta.type : "";
    const eventType = typeof inner.type === "string" ? inner.type : "";
    if (deltaType && deltaType !== "text_delta") return;
    if (eventType && eventType !== "content_block_delta" && eventType !== "stream_event") return;
    this.#appendPartialAssistantText(text, cursor);
  }

  #appendPartialAssistantText(text: string, cursor: string | number | undefined): void {
    this.#partialAssistantText += text;
    if (!this.#partialAssistantEntry) {
      this.#partialAssistantEntry = {
        kind: "message",
        role: "assistant",
        cursor,
        blocks: [{ kind: "text", text: this.#partialAssistantText }],
      };
      this.entries.push(this.#partialAssistantEntry);
      return;
    }
    this.#partialAssistantEntry.cursor = cursor;
    this.#partialAssistantEntry.blocks = [{ kind: "text", text: this.#partialAssistantText }];
  }

  #clearPartialAssistant(): void {
    if (this.#partialAssistantEntry) {
      const index = this.entries.indexOf(this.#partialAssistantEntry);
      if (index !== -1) this.entries.splice(index, 1);
    }
    this.#partialAssistantEntry = null;
    this.#partialAssistantText = "";
  }

  /** Produces a complete HTML string for the transcript pane. The host
   *  assigns this to a div's innerHTML. */
  render(): string {
    const out: string[] = [];
    if (this.sessionMeta) out.push(this.#renderSessionStrip());
    for (const entry of this.entries) out.push(this.#renderEntry(entry));
    if (this.exitMeta) out.push(this.#renderExitFooter());
    return out.join("");
  }

  #renderSessionStrip(): string {
    const meta = this.sessionMeta as SessionMeta;
    return `<div class="session-strip"><span class="session-id">session ${escapeHtml(
      (meta.sessionId ?? "").slice(0, 8),
    )}…</span>${meta.model ? `<span class="session-model">${escapeHtml(meta.model)}</span>` : ""}${
      meta.permissionMode
        ? `<span class="session-permission">${escapeHtml(meta.permissionMode)}</span>`
        : ""
    }</div>`;
  }

  #renderEntry(entry: Entry): string {
    if (entry.kind === "message") return this.#renderMessage(entry);
    if (entry.kind === "result") return this.#renderResult(entry);
    if (entry.kind === "adapter_error") return this.#renderAdapterError(entry);
    return "";
  }

  #renderMessage(entry: MessageEntry): string {
    const inner = entry.blocks.map((b) => this.#renderBlock(b)).join("");
    return `<div class="message message-${escapeHtml(entry.role)}" data-cursor="${escapeAttr(
      entry.cursor ?? "",
    )}">${inner}</div>`;
  }

  #renderBlock(block: MessageBlock): string {
    if (block.kind === "text") {
      return `<div class="block-text">${renderMarkdown(block.text ?? "")}</div>`;
    }
    if (block.kind === "thinking") {
      return `<details class="block-thinking"><summary>thinking</summary><pre><code>${escapeHtml(
        block.text ?? "",
      )}</code></pre></details>`;
    }
    if (block.kind === "image") {
      const src = imageSourceToDataUrl(block.source);
      if (!src) return "";
      return `<div class="block-image"><img src="${escapeAttr(
        src,
      )}" alt="image" loading="lazy" /></div>`;
    }
    if (block.kind === "tool_use") {
      const payload = block.payload as { id?: string; name?: string; input?: unknown };
      return `<div class="block-tool-use" data-tool-use-id="${escapeHtml(
        payload?.id ?? "",
      )}">${renderToolUse({
        type: "tool_use",
        id: payload.id ?? "",
        name: payload.name ?? "",
        ...(payload.input !== undefined ? { input: payload.input as Record<string, unknown> } : {}),
      })}</div>`;
    }
    if (block.kind === "tool_result") {
      return renderToolResult(block.payload as Parameters<typeof renderToolResult>[0]);
    }
    return "";
  }

  #renderResult(entry: ResultEntry): string {
    const cls = entry.isError ? "result-footer result-error" : "result-footer";
    const cost = entry.costUsd != null ? `$${Number(entry.costUsd).toFixed(4)}` : "";
    const duration = entry.durationMs != null ? `${entry.durationMs}ms` : "";
    const turns = entry.turns != null ? `${entry.turns} turn${entry.turns === 1 ? "" : "s"}` : "";
    const meta = [cost, duration, turns].filter(Boolean).join(" · ");
    const header = `<div class="${cls}" data-cursor="${escapeAttr(entry.cursor ?? "")}"><span class="result-status">${
      entry.isError ? "✕" : "✓"
    } ${escapeHtml(entry.subtype ?? "result")}</span>${
      meta ? `<span class="result-meta">${escapeHtml(meta)}</span>` : ""
    }</div>`;
    if (entry.isError && entry.text) {
      return `${header}<pre class="result-error-body" data-cursor="${escapeAttr(entry.cursor ?? "")}">${escapeHtml(
        entry.text,
      )}</pre>`;
    }
    return header;
  }

  #renderAdapterError(entry: AdapterErrorEntry): string {
    const sev =
      entry.severity === "error" ? "adapter-error-severity-error" : "adapter-error-severity-warn";
    const icon = entry.severity === "error" ? "✕" : "⚠";
    const lineHtml = entry.line
      ? `<pre class="adapter-error-line">${escapeHtml(entry.line)}</pre>`
      : "";
    return `<div class="adapter-error ${sev}" data-cursor="${escapeAttr(entry.cursor ?? "")}"><span class="adapter-error-status">${icon} ${escapeHtml(
      entry.phase,
    )}</span><span class="adapter-error-message">${escapeHtml(entry.message)}</span>${lineHtml}</div>`;
  }

  #renderExitFooter(): string {
    const meta = this.exitMeta as ExitMeta;
    const codePart = meta.code != null ? ` (code ${meta.code})` : "";
    const signalPart = meta.signal ? ` signal ${escapeHtml(meta.signal)}` : "";
    const errCls = meta.code != null && meta.code !== 0 ? " exit-footer-error" : "";
    const tail = meta.stderrTail
      ? `<pre class="exit-footer-stderr">${escapeHtml(meta.stderrTail)}</pre>`
      : "";
    return `<div class="exit-footer${errCls}">run exited${codePart}${signalPart}${tail}</div>`;
  }
}

function escapeAttr(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pickFirstString(obj: Record<string, unknown>, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function safeJsonStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return "";
  }
}

interface ImageSource {
  type?: string;
  media_type?: string;
  data?: string;
  url?: string;
}

function imageSourceToDataUrl(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const s = source as ImageSource;
  if (s.type === "base64" && typeof s.data === "string") {
    const mt = String(s.media_type ?? "").toLowerCase();
    if (!/^image\/[A-Za-z0-9.+-]+$/.test(mt)) return null;
    return `data:${mt};base64,${s.data}`;
  }
  if (s.type === "url" && typeof s.url === "string") {
    if (/^https?:\/\//.test(s.url)) return s.url;
    return null;
  }
  return null;
}
