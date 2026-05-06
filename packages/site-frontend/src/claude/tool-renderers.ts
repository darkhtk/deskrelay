// tool-renderers — per-tool renderers for `tool_use` and `tool_result`
// blocks. Each renderer is a pure function that takes the block payload
// and returns an HTML string. Unknown tool names fall through to
// renderDefault.
//
// Ported from claude-remote/public/tool-renderers.js (production-validated
// against real Claude Code tool calls). TS types added; behavior unchanged.

import { escapeHtml } from "./message-renderer.ts";
import type { ToolResultContentBlock, ToolUseBlock } from "./stream-contract.ts";

function truncate(str: unknown, max = 4_000): string {
  if (str == null) return "";
  const s = String(str);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (${s.length - max} more characters truncated)`;
}

function field(label: string, value: unknown): string {
  if (value == null || value === "") return "";
  return `<div class="tool-field"><span class="tool-field-label">${escapeHtml(
    label,
  )}</span><span class="tool-field-value">${escapeHtml(value)}</span></div>`;
}

function firstLine(value: unknown, max = 80): string {
  if (value == null) return "";
  const line = String(value).split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

function basename(path: unknown): string {
  if (!path) return "";
  const m = String(path).match(/[^/\\]+$/);
  return m ? m[0] : String(path);
}

function shell(toolKey: string, toolName: string, peek: string, body: string): string {
  const peekHtml = peek ? `<span class="tool-peek">${escapeHtml(peek)}</span>` : "";
  return `<details class="tool-trace tool-${escapeHtml(
    toolKey,
  )}"><summary class="tool-header"><span class="tool-icon">⚙</span><span class="tool-name">${escapeHtml(
    toolName,
  )}</span>${peekHtml}</summary><div class="tool-body">${body}</div></details>`;
}

type ToolRenderArg = Pick<ToolUseBlock, "name"> & {
  input?: Record<string, unknown>;
};

export function renderBash({ name, input = {} }: ToolRenderArg): string {
  const i = input as { command?: string; description?: string; cwd?: string; timeout?: number };
  const body = `
    <pre class="tool-command"><code>${escapeHtml(i.command ?? "")}</code></pre>
    ${field("description", i.description)}
    ${field("cwd", i.cwd)}
    ${i.timeout != null ? field("timeout (ms)", String(i.timeout)) : ""}
  `;
  return shell("bash", name || "Bash", firstLine(i.command), body);
}

export function renderRead({ name, input = {} }: ToolRenderArg): string {
  const i = input as { file_path?: string; path?: string; offset?: number; limit?: number };
  const file = i.file_path ?? i.path;
  const range =
    i.offset != null || i.limit != null
      ? `lines ${i.offset ?? 1}–${i.limit != null ? Number(i.offset ?? 0) + Number(i.limit) : "end"}`
      : "";
  const body = `
    ${field("file", file)}
    ${range ? field("range", range) : ""}
  `;
  return shell("read", name || "Read", basename(file), body);
}

export function renderEdit({ name, input = {} }: ToolRenderArg): string {
  const i = input as {
    file_path?: string;
    path?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
  };
  const file = i.file_path ?? i.path;
  const peek = [basename(file), i.replace_all ? "replace_all" : ""].filter(Boolean).join(" · ");
  const body = `
    ${field("file", file)}
    <div class="tool-diff"><div class="tool-diff-old"><div class="tool-diff-label">- old</div><pre>${escapeHtml(
      truncate(i.old_string ?? "", 1500),
    )}</pre></div><div class="tool-diff-new"><div class="tool-diff-label">+ new</div><pre>${escapeHtml(
      truncate(i.new_string ?? "", 1500),
    )}</pre></div></div>
    ${i.replace_all ? `<div class="tool-flag">replace_all</div>` : ""}
  `;
  return shell("edit", name || "Edit", peek, body);
}

export function renderWrite({ name, input = {} }: ToolRenderArg): string {
  const i = input as { file_path?: string; path?: string; content?: string };
  const file = i.file_path ?? i.path;
  const body = `
    ${field("file", file)}
    <pre class="tool-content"><code>${escapeHtml(truncate(i.content ?? "", 2000))}</code></pre>
  `;
  return shell("write", name || "Write", basename(file), body);
}

export function renderGlob({ name, input = {} }: ToolRenderArg): string {
  const i = input as { pattern?: string; path?: string };
  const body = `${field("pattern", i.pattern)}${field("path", i.path)}`;
  return shell("glob", name || "Glob", firstLine(i.pattern), body);
}

export function renderGrep({ name, input = {} }: ToolRenderArg): string {
  const i = input as { pattern?: string; path?: string; type?: string; glob?: string };
  const body = `${field("pattern", i.pattern)}${field("path", i.path)}${field(
    "type",
    i.type,
  )}${field("glob", i.glob)}`;
  return shell("grep", name || "Grep", firstLine(i.pattern), body);
}

interface TodoItem {
  status?: string;
  subject?: string;
  content?: string;
}

export function renderTodoWrite({ input = {} }: ToolRenderArg): string {
  const i = input as { todos?: TodoItem[] };
  const todos = Array.isArray(i.todos) ? i.todos : [];
  const list = todos
    .map(
      (t) =>
        `<li class="todo-${escapeHtml(t.status || "pending")}">${escapeHtml(
          t.subject || t.content || "",
        )}</li>`,
    )
    .join("");
  const body = `<ul class="tool-todos">${list}</ul>`;
  const peek = todos.length > 0 ? `${todos.length} item${todos.length === 1 ? "" : "s"}` : "";
  return shell("todo", "TodoWrite", peek, body);
}

export function renderDefault({ name, input = {} }: ToolRenderArg): string {
  let body: string;
  try {
    body = JSON.stringify(input, null, 2);
  } catch {
    body = String(input);
  }
  return shell(
    "default",
    name || "Tool",
    "",
    `<pre class="tool-input"><code>${escapeHtml(truncate(body, 4000))}</code></pre>`,
  );
}

const REGISTRY: Record<string, (arg: ToolRenderArg) => string> = {
  Bash: renderBash,
  Read: renderRead,
  Edit: renderEdit,
  MultiEdit: renderEdit,
  Write: renderWrite,
  Glob: renderGlob,
  Grep: renderGrep,
  TodoWrite: renderTodoWrite,
};

export function renderToolUse(block: ToolUseBlock): string {
  const renderer = REGISTRY[block.name] ?? renderDefault;
  return renderer({ name: block.name, input: block.input ?? {} });
}

interface ToolResultArg {
  tool_use_id?: string;
  content: string | ToolResultContentBlock[] | { text?: string } | null | undefined;
  is_error?: boolean;
}

export function renderToolResult({ tool_use_id, content, is_error }: ToolResultArg): string {
  const cls = is_error ? "tool-result tool-result-error" : "tool-result";
  const inner = renderResultContent(content);
  const peek = firstLine(extractFirstText(content));
  const peekHtml = peek ? `<span class="tool-result-peek">${escapeHtml(peek)}</span>` : "";
  const label = is_error ? "✕ result (error)" : "✓ result";
  const openAttr = hasRenderableImage(content) ? " open" : "";
  return `<details class="${cls}"${openAttr} data-tool-use-id="${escapeHtml(
    tool_use_id ?? "",
  )}"><summary class="tool-result-summary"><span class="tool-result-label">${label}</span>${peekHtml}</summary><div class="tool-result-body">${inner}</div></details>`;
}

function extractFirstText(content: ToolResultArg["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") return block.text;
      if (block.type === "image") return "(image)";
    }
    return "";
  }
  if (typeof content === "object" && typeof content.text === "string") return content.text;
  return "";
}

function renderResultContent(content: ToolResultArg["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") {
    return `<pre><code>${escapeHtml(truncate(content, 4000))}</code></pre>`;
  }
  if (!Array.isArray(content)) {
    if (typeof content.text === "string") {
      return `<pre><code>${escapeHtml(truncate(content.text, 4000))}</code></pre>`;
    }
    return `<pre><code>${escapeHtml(truncate(JSON.stringify(content), 4000))}</code></pre>`;
  }
  const parts: string[] = [];
  let textBuf = "";
  function flushText() {
    if (!textBuf) return;
    parts.push(`<pre><code>${escapeHtml(truncate(textBuf, 4000))}</code></pre>`);
    textBuf = "";
  }
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      textBuf += (textBuf ? "\n" : "") + block.text;
      continue;
    }
    if (block.type === "image" && "source" in block && block.source) {
      flushText();
      const src = imageSourceToSrc(block.source);
      if (src) {
        parts.push(
          `<img src="${escapeAttr(
            src,
          )}" alt="tool image" loading="lazy" referrerpolicy="no-referrer" class="tool-result-image" />`,
        );
      }
    }
  }
  flushText();
  return parts.join("");
}

function hasRenderableImage(content: ToolResultArg["content"]): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block &&
      typeof block === "object" &&
      block.type === "image" &&
      "source" in block &&
      Boolean(block.source) &&
      imageSourceToSrc(block.source as ImageSource) !== null,
  );
}

interface ImageSource {
  type?: string;
  media_type?: string;
  data?: string;
  url?: string;
}

function imageSourceToSrc(source: ImageSource): string | null {
  if (!source || typeof source !== "object") return null;
  if (
    source.type === "base64" &&
    typeof source.media_type === "string" &&
    typeof source.data === "string"
  ) {
    if (!/^image\/[A-Za-z0-9.+-]+$/.test(source.media_type)) return null;
    return `data:${source.media_type};base64,${source.data}`;
  }
  if (
    source.type === "url" &&
    typeof source.url === "string" &&
    source.url.startsWith("https://")
  ) {
    return source.url;
  }
  return null;
}

function escapeAttr(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
