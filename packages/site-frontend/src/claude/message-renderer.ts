// message-renderer — minimal markdown → safe HTML string. Targets the
// patterns Claude actually emits in chat-style responses; not a full
// CommonMark implementation.
//
// Ported from the original browser prototype/message-renderer.js (production-validated)
// with TS types added. Pattern set:
//   - Triple-backtick fenced code blocks (with optional language tag)
//   - Inline `code`
//   - Headers (# ## ### …)
//   - Bold (**text**) and italic (*text* or _text_)
//   - Unordered lists (- item) and ordered lists (1. item)
//   - Blockquotes (> text)
//   - Horizontal rules (---)
//   - Links [text](https?://url) — only http/https schemes are kept
//   - Paragraphs separated by blank lines; single newlines render as <br>
//   - GitHub-style tables
// Anything outside these patterns is HTML-escaped.
//
// Markdown images `![alt](url)` accept https:// and data:image/* sources
// directly. Local image paths render as inert placeholders hydrated by
// Transcript.tsx; http and other schemes pass through as escaped text so
// referrers don't leak via hostile URLs.
//
// Escape order matters: structural patterns (headers, blockquotes, lists)
// are detected on RAW text, then `applyInline` escapes the captured content
// before applying inline patterns (bold, italic, links). Code block and
// inline-code bodies are escaped at restoration time.

export function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CODEBLOCK_TOKEN = (id: number) => ` CB${id} `;
const INLINECODE_TOKEN = (id: number) => ` IC${id} `;

interface CodeBlock {
  lang: string;
  body: string;
}

export function renderMarkdown(rawText: unknown): string {
  if (rawText == null) return "";
  let text = String(rawText);

  // 1. Pull code blocks out so their bodies don't get markdown-mangled.
  const codeBlocks: CodeBlock[] = [];
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, langRaw: string, body: string) => {
    const id = codeBlocks.length;
    codeBlocks.push({ lang: langRaw.trim(), body: body.replace(/\n$/, "") });
    return CODEBLOCK_TOKEN(id);
  });

  // 2. Pull inline code out for the same reason.
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_, body: string) => {
    const id = inlineCodes.length;
    inlineCodes.push(body);
    return INLINECODE_TOKEN(id);
  });

  // 3. Detect block structure on raw text. Inline content escape is
  // deferred to applyInline at emission time.
  const lines = text.split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let listItems: string[] = [];
  let inBlockquote = false;
  let bqLines: string[] = [];

  function flushParagraph() {
    if (para.length === 0) return;
    blocks.push(`<p>${para.map(applyInline).join("<br>")}</p>`);
    para = [];
  }
  function flushList() {
    if (listItems.length === 0) return;
    const tag = listKind === "ol" ? "ol" : "ul";
    blocks.push(
      `<${tag}>${listItems.map((item) => `<li>${applyInline(item)}</li>`).join("")}</${tag}>`,
    );
    listItems = [];
    listKind = null;
  }
  function flushBlockquote() {
    if (!inBlockquote || bqLines.length === 0) {
      inBlockquote = false;
      bqLines = [];
      return;
    }
    blocks.push(`<blockquote>${bqLines.map(applyInline).join("<br>")}</blockquote>`);
    inBlockquote = false;
    bqLines = [];
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushBlockquote();
      blocks.push("<hr>");
      continue;
    }
    const headerMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headerMatch) {
      flushParagraph();
      flushList();
      flushBlockquote();
      const [, hashes = "", body = ""] = headerMatch;
      blocks.push(`<h${hashes.length}>${applyInline(body)}</h${hashes.length}>`);
      continue;
    }
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      flushParagraph();
      flushList();
      inBlockquote = true;
      bqLines.push(bqMatch[1] ?? "");
      continue;
    }
    if (inBlockquote) {
      flushBlockquote();
    }
    const table = tryParseTable(lines, lineIndex);
    if (table) {
      flushParagraph();
      flushList();
      blocks.push(table.html);
      lineIndex = table.nextIndex - 1;
      continue;
    }
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listKind && listKind !== "ul") flushList();
      listKind = "ul";
      listItems.push(ulMatch[1] ?? "");
      continue;
    }
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listKind && listKind !== "ol") flushList();
      listKind = "ol";
      listItems.push(olMatch[1] ?? "");
      continue;
    }
    if (listKind) {
      flushList();
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    para.push(line);
  }

  flushParagraph();
  flushList();
  flushBlockquote();

  let result = blocks.join("");

  // 4. Restore inline code (escape body at restoration time).
  result = result.replace(/ IC(\d+) /g, (_, id: string) => {
    const body = inlineCodes[Number(id)] ?? "";
    if (isLocalImagePath(body)) return localImagePreviewHtml(body, body);
    return `<code>${escapeHtml(body)}</code>`;
  });

  // 5. Restore code blocks. The `data-copy` button is hooked up by the
  // host (DOM event delegation) — see Transcript.tsx.
  result = result.replace(/ CB(\d+) /g, (_, id: string) => {
    const block = codeBlocks[Number(id)] as CodeBlock;
    const lang = block.lang ? escapeHtml(block.lang) : "";
    const langClass = lang ? ` class="language-${lang}"` : "";
    const langAttr = lang ? ` data-language="${lang}"` : "";
    return `<pre${langAttr}><code${langClass}>${escapeHtml(
      block.body,
    )}</code><button type="button" class="copy-button" data-copy>Copy</button></pre>`;
  });

  return result;
}

function applyInline(segment: string): string {
  // Escape first so any future regexes work on safe characters.
  let s = escapeHtml(segment);
  // Bold first (so ** doesn't get eaten as two single-* italics).
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");
  s = s.replace(/(?<![_\w])_([^_\n]+)_(?!\w)/g, "<em>$1</em>");
  s = s.replace(
    /!\[([^\]]*)\]\(((?![A-Za-z][A-Za-z0-9+.-]*:\/\/)(?!data:)[^)\n]+?\.(?:png|jpe?g|webp|gif))\)/gi,
    (_, alt: string, path: string) => localImagePreviewHtml(path, alt),
  );
  // Image syntax `![alt](url)` — must come before link to consume the `!`
  // prefix; only https:// and data:image/... are accepted.
  s = s.replace(
    /!\[([^\]]*)\]\((https:\/\/[^)\s]+|data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/g,
    (_, alt: string, url: string) =>
      `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" referrerpolicy="no-referrer" class="message-image" />`,
  );
  // Links — only http/https. Negative lookbehind for `!` keeps any leftover
  // image syntax (URL didn't pass the safelist) from being matched as a link.
  s = s.replace(
    /(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label: string, url: string) =>
      `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
  return s;
}

interface TableParseResult {
  html: string;
  nextIndex: number;
}

function tryParseTable(lines: string[], start: number): TableParseResult | null {
  const headerLine = lines[start] ?? "";
  const separatorLine = lines[start + 1] ?? "";
  if (!looksLikeTableRow(headerLine) || !looksLikeTableSeparator(separatorLine)) {
    return null;
  }
  const headers = splitTableRow(headerLine);
  const separators = splitTableRow(separatorLine);
  if (headers.length < 2 || separators.length < 2) return null;
  if (separators.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  const columnCount = Math.max(headers.length, separators.length);
  const alignments = separators.map(parseAlignment);
  const rows: string[][] = [];
  let nextIndex = start + 2;
  while (nextIndex < lines.length && looksLikeTableRow(lines[nextIndex] ?? "")) {
    rows.push(splitTableRow(lines[nextIndex] ?? ""));
    nextIndex += 1;
  }
  const headerHtml = normalizeCells(headers, columnCount)
    .map((cell, i) => `<th${alignmentClass(alignments[i])}>${applyInline(cell)}</th>`)
    .join("");
  const bodyHtml = rows
    .map((row) => {
      const cells = normalizeCells(row, columnCount)
        .map((cell, i) => `<td${alignmentClass(alignments[i])}>${applyInline(cell)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return {
    html: `<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
    nextIndex,
  };
}

function looksLikeTableRow(line: string): boolean {
  if (!line.includes("|")) return false;
  return splitTableRow(line).length >= 2;
}

function looksLikeTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function normalizeCells(cells: string[], count: number): string[] {
  const next = cells.slice(0, count);
  while (next.length < count) next.push("");
  return next;
}

function parseAlignment(cell: string): "left" | "right" | "center" | undefined {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

function alignmentClass(value: "left" | "right" | "center" | undefined): string {
  return value ? ` class="align-${value}"` : "";
}

function isLocalImagePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed) || trimmed.startsWith("data:")) {
    return false;
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(trimmed);
}

function localImagePreviewHtml(path: string, alt: string): string {
  return `<figure class="local-image-preview" data-local-image-path="${escapeAttr(
    path,
  )}" data-local-image-alt="${escapeAttr(
    alt,
  )}" role="group"><span class="local-image-preview-status">Image preview</span></figure>`;
}

function escapeAttr(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
