// SessionList: sidebar list of past sessions for the active behavior
// instance. Sorted mtime-desc by the caller.

import { type Component, For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { cwdBasename, formatAgo } from "../claude/session-utils.ts";
import { t } from "../i18n.ts";

const ARM_TIMEOUT_MS = 3000;

export interface SessionEntry {
  sessionId: string;
  /** Latest user prompt or first assistant line used as the row title. */
  title?: string;
  /** Untruncated title for native hover tooltips. */
  fullTitle?: string;
  /** Working directory the session was started with. */
  cwd?: string;
  /** Last-modified epoch ms drives the relative-time badge. */
  updatedAt?: number;
  /** Origin tag: "web" if the session was created in the browser, "cli"
   *  if the user ran `claude` directly on the PC. */
  via?: "web" | "cli" | undefined;
}

export interface SessionListProps {
  entries: SessionEntry[];
  /** Currently selected session id (drives the highlight). */
  selectedId?: string | null | undefined;
  /** Click handler. Receives the id and the entry for callers that need it. */
  onSelect?: (id: string, entry: SessionEntry | undefined) => void;
  /** Confirmed delete (after arm + second click). */
  onDelete?: (id: string) => void;
  /** Optional row-level deletion state for sessions already being removed. */
  deletingIds?: Record<string, boolean | undefined> | undefined;
  /** Confirmed delete of every session in a cwd group. */
  onDeleteGroup?: (cwd: string, entries: SessionEntry[]) => void;
  /** Optional cwd-group deletion state. Rendered inline under the group
   *  header: no card, no panel, no background depth. */
  deletingGroups?: Record<string, SessionGroupDeleteProgress | undefined> | undefined;
  /** When true, render entries grouped by cwd with a sticky header per
   *  workspace. Default false keeps the legacy flat list. */
  groupByCwd?: boolean | undefined;
  /** Preferred cwd to expand when grouped rows first appear. */
  preferredExpandedCwd?: string | null | undefined;
  /** Expand every group while filtering so search results are never hidden. */
  expandAllGroups?: boolean | undefined;
  /** Resets in-memory group toggles when the active device changes. */
  groupStateKey?: string | null | undefined;
}

export interface SessionGroupDeleteProgress {
  total?: number | undefined;
  completed?: number | undefined;
}

export const SessionList: Component<SessionListProps> = (props) => {
  const [armedId, setArmedId] = createSignal<string | null>(null);
  const [armedGroupCwd, setArmedGroupCwd] = createSignal<string | null>(null);
  const [groupToggles, setGroupToggles] = createSignal<Record<string, boolean | undefined>>({});
  let lastGroupStateKey = props.groupStateKey;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  function clearArm() {
    setArmedId(null);
    setArmedGroupCwd(null);
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  }

  function arm(id: string) {
    if (armedId() === id) return;
    clearArm();
    setArmedId(id);
    armTimer = setTimeout(() => {
      setArmedId(null);
      armTimer = null;
    }, ARM_TIMEOUT_MS);
  }

  function armGroup(cwd: string) {
    if (armedGroupCwd() === cwd) return;
    clearArm();
    setArmedGroupCwd(cwd);
    armTimer = setTimeout(() => {
      setArmedGroupCwd(null);
      armTimer = null;
    }, ARM_TIMEOUT_MS);
  }

  function handleSelect(id: string) {
    if ((armedId() && armedId() !== id) || armedGroupCwd()) clearArm();
    props.onSelect?.(
      id,
      props.entries.find((e) => e.sessionId === id),
    );
  }

  function handleDelete(id: string) {
    if (props.deletingIds?.[id]) return;
    if (armedId() === id) {
      clearArm();
      props.onDelete?.(id);
    } else {
      arm(id);
    }
  }

  function handleGroupDelete(cwd: string, rows: SessionEntry[]) {
    if (props.deletingGroups?.[cwd]) return;
    if (armedGroupCwd() === cwd) {
      clearArm();
      props.onDeleteGroup?.(cwd, rows);
    } else {
      armGroup(cwd);
    }
  }

  function selectedGroupCwd(): string | null {
    const selected = props.entries.find((entry) => entry.sessionId === props.selectedId);
    return selected?.cwd ?? null;
  }

  function preferredGroupCwd(): string | null {
    const groups = grouped();
    const selectedCwd = selectedGroupCwd();
    if (selectedCwd !== null && groups.some((group) => group.cwd === selectedCwd)) {
      return selectedCwd;
    }
    const preferred = props.preferredExpandedCwd;
    if (preferred && groups.some((group) => group.cwd === preferred)) {
      return preferred;
    }
    return groups[0]?.cwd ?? null;
  }

  function isGroupExpanded(cwd: string): boolean {
    if (props.expandAllGroups) return true;
    const toggled = groupToggles()[cwd];
    if (toggled !== undefined) return toggled;
    return cwd === preferredGroupCwd();
  }

  function toggleGroup(cwd: string) {
    clearArm();
    const nextExpanded = !isGroupExpanded(cwd);
    setGroupToggles((current) => ({ ...current, [cwd]: nextExpanded }));
  }

  createEffect(() => {
    const key = props.groupStateKey;
    if (key === lastGroupStateKey) return;
    lastGroupStateKey = key;
    clearArm();
    setGroupToggles({});
  });

  createEffect(() => {
    const selectedCwd = selectedGroupCwd();
    if (!selectedCwd) return;
    setGroupToggles((current) =>
      current[selectedCwd] === false ? { ...current, [selectedCwd]: true } : current,
    );
  });

  createEffect(() => {
    const known = new Set(grouped().map((group) => group.cwd));
    setGroupToggles((current) => {
      let changed = false;
      const next = { ...current };
      for (const cwd of Object.keys(next)) {
        if (known.has(cwd)) continue;
        delete next[cwd];
        changed = true;
      }
      return changed ? next : current;
    });
  });

  onCleanup(() => {
    if (armTimer) clearTimeout(armTimer);
  });

  /** Group entries by cwd for the optional grouped view. Each group
   *  preserves the caller's input ordering (newest-first). */
  function grouped(): Array<{ cwd: string; rows: SessionEntry[] }> {
    const order: string[] = [];
    const map = new Map<string, SessionEntry[]>();
    for (const e of props.entries) {
      const key = e.cwd ?? "";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)?.push(e);
    }
    return order.map((cwd) => ({ cwd, rows: map.get(cwd) ?? [] }));
  }

  function groupDeleteProgress(cwd: string): SessionGroupDeleteProgress | undefined {
    return props.deletingGroups?.[cwd];
  }

  function progressLabel(progress: SessionGroupDeleteProgress): string {
    if (typeof progress.total === "number" && typeof progress.completed === "number") {
      return t("sl.delete-group.progress-count", {
        done: Math.min(progress.completed, progress.total),
        total: progress.total,
      });
    }
    return t("sl.delete-group.progress");
  }

  function progressPercent(progress: SessionGroupDeleteProgress): number | null {
    if (
      typeof progress.total !== "number" ||
      typeof progress.completed !== "number" ||
      progress.total <= 0
    ) {
      return null;
    }
    return Math.max(0, Math.min(100, (progress.completed / progress.total) * 100));
  }

  return (
    <div class="session-list">
      <Show
        when={props.entries.length > 0}
        fallback={<div class="session-empty">{t("sl.empty")}</div>}
      >
        <Show
          when={props.groupByCwd}
          fallback={<For each={props.entries}>{(entry) => renderRow(entry)}</For>}
        >
          <For each={grouped()}>
            {(group) => (
              <>
                <div
                  class={`session-list-group-header${
                    isGroupExpanded(group.cwd) ? " session-list-group-header-expanded" : ""
                  }`}
                  title={group.cwd}
                >
                  <button
                    type="button"
                    class="session-list-group-toggle"
                    aria-expanded={isGroupExpanded(group.cwd) ? "true" : "false"}
                    onClick={() => toggleGroup(group.cwd)}
                  >
                    <span class="session-list-group-caret" aria-hidden="true">
                      {isGroupExpanded(group.cwd) ? "v" : ">"}
                    </span>
                    <span class="session-list-group-title">{cwdBasename(group.cwd) || "—"}</span>
                    <span class="session-list-group-count">{group.rows.length}</span>
                  </button>
                  <Show when={props.onDeleteGroup}>
                    <button
                      type="button"
                      class={`session-group-delete${
                        armedGroupCwd() === group.cwd ? " session-group-delete-armed" : ""
                      }`}
                      disabled={Boolean(groupDeleteProgress(group.cwd))}
                      aria-label={
                        armedGroupCwd() === group.cwd
                          ? t("sl.delete-group.aria.confirm")
                          : t("sl.delete-group.aria")
                      }
                      title={
                        armedGroupCwd() === group.cwd
                          ? t("sl.delete-group.aria.confirm")
                          : t("sl.delete-group.aria")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGroupDelete(group.cwd, group.rows);
                      }}
                    >
                      {armedGroupCwd() === group.cwd ? t("sl.delete-group.label") : "×"}
                    </button>
                  </Show>
                </div>
                <Show when={groupDeleteProgress(group.cwd)}>
                  {(progress) => {
                    const pct = () => progressPercent(progress());
                    return (
                      <div class="session-group-progress" aria-live="polite">
                        <div class="session-group-progress-label">{progressLabel(progress())}</div>
                        <div class="session-group-progress-line" aria-hidden="true">
                          <div
                            class={
                              pct() === null
                                ? "session-group-progress-fill session-group-progress-fill-busy"
                                : "session-group-progress-fill"
                            }
                            style={pct() === null ? undefined : { width: `${pct() ?? 0}%` }}
                          />
                        </div>
                      </div>
                    );
                  }}
                </Show>
                <Show when={isGroupExpanded(group.cwd)}>
                  <For each={group.rows}>{(entry) => renderRow(entry)}</For>
                </Show>
              </>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );

  function renderRow(entry: SessionEntry) {
    const isSelected = () => entry.sessionId === props.selectedId;
    const isArmed = () => entry.sessionId === armedId();
    const isDeleting = () => Boolean(props.deletingIds?.[entry.sessionId]);
    const title = () => entry.title || t("sl.no-preview");
    const fullTitle = () => entry.fullTitle || entry.title || t("sl.no-preview");
    return (
      <div
        class={`session-item-row${isArmed() ? " session-item-row-armed" : ""}${
          isDeleting() ? " session-item-row-deleting" : ""
        }`}
      >
        <button
          type="button"
          class={`session-item${isSelected() ? " session-item-selected" : ""}`}
          title={fullTitle()}
          disabled={isDeleting()}
          onClick={() => handleSelect(entry.sessionId)}
        >
          <div class="session-item-title">
            <Show when={entry.via}>
              <span class={`session-item-via session-item-via-${entry.via}`}>{entry.via}</span>
            </Show>
            {title()}
          </div>
          <div class="session-item-meta">
            <span class="session-item-cwd">{cwdBasename(entry.cwd)}</span>
            <span class="session-item-time">{formatAgo(entry.updatedAt)}</span>
          </div>
        </button>
        <button
          type="button"
          class={`session-item-delete${isArmed() ? " session-item-delete-armed" : ""}${
            isDeleting() ? " session-item-delete-deleting" : ""
          }`}
          aria-label={
            isDeleting()
              ? t("sl.delete.progress")
              : isArmed()
                ? t("sl.delete.aria.confirm")
                : t("sl.delete.aria")
          }
          title={isDeleting() ? t("sl.delete.progress") : undefined}
          disabled={isDeleting()}
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(entry.sessionId);
          }}
        >
          {isDeleting() ? t("sl.delete.progress") : isArmed() ? t("sl.delete.label") : "×"}
        </button>
      </div>
    );
  }
};
