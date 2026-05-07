// CwdPicker — text input that queries the daemon's /fs/list as the user
// types and pops a suggestion list of subdirectories. Used by NewChatCard
// (start a session in cwd X) and DeviceSettingsDialog (default cwd pref).
//
// Behaviors mirrored from the original browser prototype/new-chat.js:
//   - Trailing-separator trick: applying a suggestion sets the value to
//     `<fullPath><sep>` so the next keystroke browses children.
//   - Race-condition guard via an active-fetch counter.
//   - ArrowDown/ArrowUp move highlight, Tab/Enter completes, Escape closes.

import { type Component, For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { type FsEntry, type FsRootsResponse, api } from "../api.ts";
import { t } from "../i18n.ts";
import {
  OfflineHint,
  daemonOfflineBannerMessage,
  isDaemonOfflineMessage,
} from "./OfflineHint.tsx";

export interface CwdPickerProps {
  /** Device that owns the filesystem we're navigating. */
  deviceId?: string | null | undefined;
  /** Current value (controlled). */
  value: string;
  onChange: (next: string) => void;
  /** Submit handler (Enter when the picker is closed, or no highlight). */
  onSubmit?: () => void;
  /** Escape handler — let the parent decide whether Escape closes the
   *  whole dialog or just the picker. */
  onEscape?: () => void;
  placeholder?: string;
  id?: string;
  deviceLabel?: string | null | undefined;
}

export const CwdPicker: Component<CwdPickerProps> = (props) => {
  const [suggestions, setSuggestions] = createSignal<FsEntry[]>([]);
  const [highlight, setHighlight] = createSignal(-1);
  const [status, setStatus] = createSignal<string | null>(null);
  // Last raw error string from /fs/list — separate from `status` because
  // the OfflineHint child needs the original backend message (without
  // the cwd.status.failed wrapper) to detect the offline pattern.
  const [lastErrorMsg, setLastErrorMsg] = createSignal<string | null>(null);
  // Workspace allowlist (loaded once per deviceId). When restricted, a
  // chip-row above the picker exposes the roots as one-click starting
  // points; the daemon also returns these as the synthetic listing for
  // an empty path, so typing-from-scratch still works.
  const [roots, setRoots] = createSignal<FsRootsResponse | null>(null);
  let activeFetch = 0;
  let inputEl!: HTMLInputElement;

  createEffect(() => {
    const id = props.deviceId;
    if (!id) {
      setRoots(null);
      return;
    }
    void api
      .fsRoots(id)
      .then((r) => setRoots(r))
      .catch(() => {
        // Older daemons (pre-allowlist) don't ship /fs/roots — treat as
        // unrestricted so the picker keeps its prior behaviour.
        setRoots({ mode: "unrestricted", roots: [] });
      });
  });

  function endsWithSep(value: string): boolean {
    return /[\\/]$/.test(value);
  }
  function extractParent(value: string): string {
    const m = value.match(/^(.*[\\/]).+$/);
    return m?.[1] ?? "";
  }
  function extractBasename(value: string): string {
    const idx = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
    return idx === -1 ? value : value.slice(idx + 1);
  }
  function trailingSepFor(p: string): string {
    return p.includes("\\") ? "\\" : "/";
  }

  async function loadSuggestions(rawValue: string): Promise<void> {
    if (!props.deviceId) return;
    const value = String(rawValue ?? "");
    const lookup = endsWithSep(value) ? value : extractParent(value);
    const filterPrefix = endsWithSep(value) ? "" : extractBasename(value);

    activeFetch += 1;
    const my = activeFetch;
    setStatus(t("cwd.status.loading"));
    setSuggestions([]);
    setHighlight(-1);

    try {
      const res = await api.fsList(props.deviceId, lookup);
      if (my !== activeFetch) return;
      const lower = filterPrefix.toLowerCase();
      const filtered = res.entries
        .filter((e) => !lower || e.name.toLowerCase().startsWith(lower))
        .slice(0, 50);
      setSuggestions(filtered);
      if (filtered.length === 0) {
        setStatus(
          lower ? t("cwd.status.no-prefix-match", { prefix: filterPrefix }) : t("cwd.status.empty"),
        );
      } else {
        setStatus(null);
      }
      setHighlight(filtered.length > 0 ? 0 : -1);
    } catch (err) {
      if (my !== activeFetch) return;
      const raw = (err as Error).message;
      setLastErrorMsg(raw);
      setStatus(
        t("cwd.status.failed", {
          error: isDaemonOfflineMessage(raw) ? daemonOfflineBannerMessage(props.deviceLabel) : raw,
        }),
      );
      setSuggestions([]);
      setHighlight(-1);
    }
  }

  function applySuggestion(idx: number): boolean {
    const entry = suggestions()[idx];
    if (!entry) return false;
    return applyPath(entry.fullPath);
  }

  function applyPath(rawPath: string): boolean {
    const sep = trailingSepFor(rawPath);
    const next = rawPath.endsWith(sep) ? rawPath : `${rawPath}${sep}`;
    props.onChange(next);
    inputEl.value = next;
    closeSuggestions();
    inputEl.focus?.();
    void loadSuggestions(next);
    return true;
  }

  function closeSuggestions(): void {
    setSuggestions([]);
    setHighlight(-1);
    setStatus(null);
    setLastErrorMsg(null);
  }

  function moveHighlight(delta: number): void {
    const list = suggestions();
    if (list.length === 0) return;
    setHighlight((cur) => (cur + delta + list.length) % list.length);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === "Tab" && suggestions().length > 0) {
      event.preventDefault();
      applySuggestion(highlight() >= 0 ? highlight() : 0);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (highlight() >= 0) {
        applySuggestion(highlight());
      } else {
        props.onSubmit?.();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (suggestions().length > 0) {
        closeSuggestions();
      } else {
        props.onEscape?.();
      }
    }
  }

  onCleanup(() => {
    activeFetch += 1;
  });

  function rootChips(): string[] {
    const r = roots();
    if (!r || r.mode !== "restricted") return [];
    return r.roots;
  }

  return (
    <>
      <Show when={rootChips().length > 0}>
        <div class="cwd-roots-chips" aria-label={t("cwd.roots.label")}>
          <span class="cwd-roots-label">{t("cwd.roots.label")}</span>
          <For each={rootChips()}>
            {(root) => (
              <button
                type="button"
                class="cwd-roots-chip"
                onClick={() => applyPath(root)}
                title={root}
              >
                {root}
              </button>
            )}
          </For>
        </div>
      </Show>
      <input
        ref={inputEl}
        id={props.id}
        type="text"
        class="text-input"
        placeholder={props.placeholder ?? t("cwd.placeholder")}
        autocomplete="off"
        value={props.value}
        onFocus={() => void loadSuggestions(props.value)}
        onInput={(e) => {
          props.onChange(e.currentTarget.value);
          void loadSuggestions(e.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
      />
      <Show when={suggestions().length > 0 || status()}>
        <div class="new-chat-suggest">
          <Show
            when={suggestions().length > 0}
            fallback={
              <>
                <div class="new-chat-suggest-status">{status()}</div>
                <Show when={isDaemonOfflineMessage(lastErrorMsg())}>
                  <OfflineHint
                    message={lastErrorMsg()}
                    deviceLabel={props.deviceLabel}
                    onRetry={() => void loadSuggestions(props.value)}
                  />
                </Show>
              </>
            }
          >
            <For each={suggestions()}>
              {(entry, i) => (
                <button
                  type="button"
                  class={`new-chat-suggest-item${
                    i() === highlight() ? " new-chat-suggest-active" : ""
                  }`}
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(i());
                  }}
                >
                  <span class="new-chat-suggest-name">{entry.name}</span>
                  <span class="new-chat-suggest-path">{entry.fullPath}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </>
  );
};
