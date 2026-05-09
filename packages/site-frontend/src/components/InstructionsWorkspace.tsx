import { type Component, For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { ClaudeInstructionScope, ClaudeInstructionSource } from "../api.ts";
import { t } from "../i18n.ts";
import { instructionScopePlaceholder } from "../instruction-copy.ts";

interface InstructionStatus {
  scope: ClaudeInstructionScope;
  kind: "success" | "error";
  message: string;
}

interface ActiveEdit {
  scope: ClaudeInstructionScope;
  line: number;
}

export interface InstructionsWorkspaceProps {
  cwd: string;
  sources: ClaudeInstructionSource[];
  loading: boolean;
  error: string | null;
  draft: (source: ClaudeInstructionSource) => string;
  dirty: (source: ClaudeInstructionSource) => boolean;
  savingScope: ClaudeInstructionScope | null;
  status: InstructionStatus | null;
  onInput: (source: ClaudeInstructionSource, content: string) => void;
  onReset: (source: ClaudeInstructionSource) => void;
  onSave: (source: ClaudeInstructionSource) => void;
  onDelete: (source: ClaudeInstructionSource) => void;
  onReload: () => void;
  onBack: () => void;
}

function lineCount(content: string): number {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length;
}

function sourceLines(content: string): string[] {
  if (!content) return [];
  return content.split(/\r\n|\r|\n/);
}

function lineOffset(content: string, line: number): number {
  if (line <= 1) return 0;
  let offset = 0;
  const lines = content.split(/\r\n|\r|\n/);
  for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset;
}

export const InstructionsWorkspace: Component<InstructionsWorkspaceProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const [activeEdit, setActiveEdit] = createSignal<ActiveEdit | null>(null);
  let editorEl: HTMLTextAreaElement | undefined;

  const sources = createMemo(() =>
    props.sources.filter((source) => source.scope !== "managed"),
  );
  const activeSource = createMemo(() => {
    const active = activeEdit();
    if (!active) return null;
    return sources().find((source) => source.scope === active.scope) ?? null;
  });
  const projectName = createMemo(() => {
    const cwd = props.cwd.trim();
    if (!cwd) return t("instructions.workspace.no-cwd");
    const normalized = cwd.replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).pop() || normalized;
  });

  createEffect(() => {
    const active = activeEdit();
    const source = activeSource();
    if (!active || !source) return;
    queueMicrotask(() => {
      if (!editorEl) return;
      const offset = lineOffset(props.draft(source), active.line);
      editorEl.focus();
      editorEl.setSelectionRange(offset, offset);
      const lineHeight = 20;
      editorEl.scrollTop = Math.max(0, (active.line - 3) * lineHeight);
    });
  });

  function toggle(scope: ClaudeInstructionScope) {
    setCollapsed((current) => ({ ...current, [scope]: !current[scope] }));
  }

  function openEditor(source: ClaudeInstructionSource, line: number) {
    if (source.readonly) return;
    setActiveEdit({ scope: source.scope, line });
  }

  function closeEditor() {
    setActiveEdit(null);
  }

  return (
    <div class="instructions-workspace">
      <header class="instructions-workspace-header">
        <button type="button" class="sidebar-inline-button" onClick={props.onBack}>
          {t("instructions.workspace.back")}
        </button>
        <div class="instructions-workspace-title">
          <strong>{projectName()}</strong>
          <span>{props.cwd || t("instructions.workspace.no-cwd")}</span>
        </div>
        <button type="button" class="sidebar-inline-button" onClick={props.onReload}>
          {t("instructions.workspace.reload")}
        </button>
      </header>

      <Show when={!props.loading} fallback={<p class="sidebar-empty">{t("instructions.loading")}</p>}>
        <Show when={!props.error} fallback={<p class="settings-error">{props.error}</p>}>
          <main class="instructions-workspace-main" aria-label={t("instructions.workspace.title")}>
            <For each={sources()}>
              {(source) => {
                const count = () => lineCount(source.content);
                const lines = () => sourceLines(source.content);
                const isCollapsed = () => Boolean(collapsed()[source.scope]);
                const sourceStatus = () =>
                  props.status?.scope === source.scope ? props.status : null;
                return (
                  <section
                    class="instruction-scope-card"
                    classList={{
                      "is-missing": !source.exists,
                      "is-readonly": source.readonly,
                    }}
                  >
                    <button
                      type="button"
                      class="instruction-scope-header"
                      onClick={() => toggle(source.scope)}
                      aria-expanded={!isCollapsed()}
                    >
                      <span class="instruction-scope-caret">{isCollapsed() ? "▶" : "▼"}</span>
                      <span class="instruction-scope-label">{source.label}</span>
                      <span class="instruction-scope-path">{source.path}</span>
                      <span class="instruction-scope-count">
                        {source.exists
                          ? t("instructions.workspace.line-count", { count: String(count()) })
                          : t("instructions.source.missing")}
                      </span>
                    </button>

                    <Show when={!isCollapsed()}>
                      <Show when={source.error}>
                        <p class="settings-error">{source.error}</p>
                      </Show>
                      <Show
                        when={source.exists}
                        fallback={
                          <button
                            type="button"
                            class="instruction-create-button"
                            onClick={() => openEditor(source, 1)}
                            disabled={source.readonly || Boolean(source.error)}
                          >
                            {t("instructions.workspace.create", { label: source.label })}
                          </button>
                        }
                      >
                        <Show
                          when={lines().length > 0}
                          fallback={
                            <button
                              type="button"
                              class="instruction-create-button"
                              onClick={() => openEditor(source, 1)}
                              disabled={source.readonly}
                            >
                              {t("instructions.content.empty")}
                            </button>
                          }
                        >
                          <pre class="instruction-source-lines">
                            <For each={lines()}>
                              {(line, index) => {
                                const lineNo = () => index() + 1;
                                const active = () =>
                                  activeEdit()?.scope === source.scope &&
                                  activeEdit()?.line === lineNo();
                                return (
                                  <button
                                    type="button"
                                    class="instruction-source-line"
                                    classList={{ "is-active": active() }}
                                    onClick={() => openEditor(source, lineNo())}
                                  >
                                    <span class="instruction-line-number">{lineNo()}</span>
                                    <span class="instruction-line-text">{line || " "}</span>
                                  </button>
                                );
                              }}
                            </For>
                          </pre>
                        </Show>
                      </Show>
                      <Show when={sourceStatus()}>
                        {(status) => (
                          <p
                            classList={{
                              "settings-error": status().kind === "error",
                              "settings-success": status().kind === "success",
                            }}
                          >
                            {status().message}
                          </p>
                        )}
                      </Show>
                    </Show>
                  </section>
                );
              }}
            </For>
          </main>
        </Show>
      </Show>

      <Show when={activeSource()}>
        {(source) => (
          <aside class="instruction-editor-drawer" aria-label={t("instructions.workspace.editor")}>
            <div class="instruction-editor-header">
              <strong>{source().label}</strong>
              <span title={source().path}>{source().path}</span>
            </div>
            <textarea
              ref={editorEl}
              class="instruction-editor-textarea"
              value={props.draft(source())}
              placeholder={instructionScopePlaceholder(source().scope)}
              disabled={props.savingScope === source().scope || source().readonly}
              onInput={(event) => props.onInput(source(), event.currentTarget.value)}
            />
            <div class="instruction-editor-actions">
              <Show when={source().exists}>
                <button
                  type="button"
                  class="sidebar-inline-button danger"
                  onClick={() => props.onDelete(source())}
                  disabled={props.savingScope === source().scope || source().readonly}
                >
                  {t("chat.sidebar.instructions.delete")}
                </button>
              </Show>
              <button
                type="button"
                class="sidebar-inline-button"
                onClick={() => props.onReset(source())}
                disabled={!props.dirty(source()) || props.savingScope === source().scope}
              >
                {t("chat.sidebar.instructions.revert")}
              </button>
              <button
                type="button"
                class="sidebar-inline-button primary"
                onClick={() => props.onSave(source())}
                disabled={!props.dirty(source()) || props.savingScope === source().scope}
              >
                {props.savingScope === source().scope
                  ? t("chat.sidebar.instructions.saving")
                  : t("chat.sidebar.instructions.save")}
              </button>
              <button type="button" class="sidebar-inline-button" onClick={closeEditor}>
                {t("instructions.workspace.close")}
              </button>
            </div>
          </aside>
        )}
      </Show>
    </div>
  );
};
