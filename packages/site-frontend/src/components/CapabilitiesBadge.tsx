// CapabilitiesBadge — small icon strip showing the running session's
// metadata (model, permission mode, tool count, MCP server count).
//
// Source of truth: claude's first `system: init` event. The Transcript
// model captures this in `sessionMeta`; we receive it via the events
// prop and render one icon per non-empty field when a session is live.
//
// Visual: flat row of icon + value pairs (no chip background, no border)
// so it sits inline at the bottom of the sidebar without adding panel
// depth. The textual label moves into the `title` attribute (tooltip)
// and aria-label for accessibility — the icon carries the meaning.

import { type Component, For, type JSX, Show, createMemo } from "solid-js";
import type { ClaudeStreamEvent } from "../api.ts";
import { TranscriptModel } from "../claude/transcript-model.ts";
import { t } from "../i18n.ts";

export interface CapabilitiesBadgeProps {
  /** Same events array the Transcript renders from — we re-parse the
   *  init event to extract metadata. Cheap (one event lookup). */
  events: ClaudeStreamEvent[];
  /** Confirmed mode from the active run/session. When present, this wins
   *  over older transcript init metadata. */
  permissionMode?: string | null;
}

type ChipKind = "model" | "mode" | "tools" | "mcp";

interface Chip {
  kind: ChipKind;
  label: string;
  value: string;
}

export const CapabilitiesBadge: Component<CapabilitiesBadgeProps> = (props) => {
  const meta = createMemo(() => {
    const m = new TranscriptModel();
    for (const event of props.events) {
      m.ingestEvent(event as Parameters<TranscriptModel["ingestEvent"]>[0]);
      if (m.sessionMeta) break; // first init wins; don't replay the rest
    }
    return m.sessionMeta;
  });

  const chips = (): Chip[] => {
    const m = meta();
    const permissionMode = props.permissionMode ?? m?.permissionMode;
    if (!m && !permissionMode) return [];
    const out: Chip[] = [];
    if (m?.model) out.push({ kind: "model", label: t("cb.model"), value: m.model });
    if (permissionMode) {
      out.push({ kind: "mode", label: t("cb.mode"), value: String(permissionMode) });
    }
    if (typeof m?.tools === "number" && m.tools > 0) {
      out.push({ kind: "tools", label: t("cb.tools"), value: String(m.tools) });
    }
    if (typeof m?.mcpServers === "number" && m.mcpServers > 0) {
      out.push({ kind: "mcp", label: t("cb.mcp"), value: String(m.mcpServers) });
    }
    return out;
  };

  return (
    <Show when={chips().length > 0}>
      <div class="capabilities-badge" aria-label="session capabilities">
        <For each={chips()}>
          {(chip) => (
            <span
              class={`cap-chip cap-chip-${chip.kind}`}
              title={`${chip.label}: ${chip.value}`}
              aria-label={`${chip.label}: ${chip.value}`}
            >
              <span class="cap-chip-icon" aria-hidden="true">
                {ICONS[chip.kind]}
              </span>
              <span class="cap-chip-value">{chip.value}</span>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
};

// 12×12 inline SVGs (no external deps, no font loading). Stroke =
// currentColor so they pick up the surrounding text color, opacity is
// dialed back in CSS to feel like an icon-vs-text rather than two
// equal-weight tokens.
const ICONS: Record<ChipKind, JSX.Element> = {
  // Sparkle — matches the brand mark used in the header.
  model: (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M6 0.5l1.05 3.45L10.5 5l-3.45 1.05L6 9.5 4.95 6.05 1.5 5l3.45-1.05L6 0.5z" />
      <circle cx="10" cy="10" r="0.9" />
      <circle cx="2" cy="10" r="0.7" />
    </svg>
  ),
  // Shield — permission boundary.
  mode: (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M6 1l4 1.4v3.5c0 2.4-1.7 4.4-4 5-2.3-0.6-4-2.6-4-5V2.4L6 1z" />
    </svg>
  ),
  // Wrench — tool count.
  tools: (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 1.5a2.4 2.4 0 0 0-3 3L1.7 9.3a1 1 0 1 0 1.4 1.4L7.5 6.3a2.4 2.4 0 0 0 3-3L8.7 5l-1.4-1.4 1.4-1.4z" />
    </svg>
  ),
  // Three connected dots — MCP servers as a tiny network.
  mcp: (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="0.9"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <line x1="2.5" y1="2.5" x2="6" y2="6" />
      <line x1="9.5" y1="2.5" x2="6" y2="6" />
      <line x1="2.5" y1="9.5" x2="6" y2="6" />
      <circle cx="2.5" cy="2.5" r="1.3" />
      <circle cx="9.5" cy="2.5" r="1.3" />
      <circle cx="2.5" cy="9.5" r="1.3" />
      <circle cx="6" cy="6" r="1.3" />
    </svg>
  ),
};
