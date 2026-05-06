// NewChatCard — cwd picker + start button. The fs autocomplete logic
// lives in CwdPicker (also reused by DeviceSettingsDialog). The
// permission mode picker has been promoted to a sidebar-global control
// (PermissionModePicker) so changing it doesn't require opening a new
// chat card.

import { type Component, Show, createEffect, createSignal, untrack } from "solid-js";
import { api } from "../api.ts";
import type { ClaudePermissionMode } from "../claude/stream-contract.ts";
import { t } from "../i18n.ts";
import { CwdPicker } from "./CwdPicker.tsx";

export interface NewChatCardProps {
  /** Device the autocomplete should query. Required for fs autocomplete; if
   *  omitted, the card still works as plain text input but skips fs suggestions. */
  deviceId?: string | null;
  /** Current permission mode (lifted into the sidebar). Passed back to
   *  onConfirm so ChatView's startSession sees a stable value. */
  permissionMode: ClaudePermissionMode;
  deviceLabel?: string | null;
  onConfirm: (input: { cwd: string; permissionMode: ClaudePermissionMode }) => void;
  onCancel?: () => void;
  initialCwd?: string;
}

const SEP = "\\";

export const NewChatCard: Component<NewChatCardProps> = (props) => {
  const [cwd, setCwd] = createSignal(props.initialCwd ?? "");
  const [shake, setShake] = createSignal(false);

  const [mkdirOpen, setMkdirOpen] = createSignal(false);
  const [mkdirName, setMkdirName] = createSignal("");
  const [mkdirError, setMkdirError] = createSignal<string | null>(null);
  const [mkdirBusy, setMkdirBusy] = createSignal(false);

  let mkdirInputEl: HTMLInputElement | undefined;

  createEffect(() => {
    const next = props.initialCwd ?? "";
    untrack(() => {
      if (cwd() !== next) setCwd(next);
    });
  });

  function endsWithSep(value: string): boolean {
    return /[\\/]$/.test(value);
  }
  function extractParent(value: string): string {
    const m = value.match(/^(.*[\\/]).+$/);
    return m?.[1] ?? "";
  }
  function trailingSepFor(p: string): string {
    return p.includes("\\") ? "\\" : "/";
  }

  function getMkdirParent(): string {
    const value = cwd();
    if (!value) return "";
    return endsWithSep(value)
      ? value.replace(/[\\/]+$/, "")
      : extractParent(value).replace(/[\\/]+$/, "");
  }

  async function submitMkdir(): Promise<void> {
    if (!props.deviceId) {
      setMkdirError(t("new-chat.mkdir.error.no-device"));
      return;
    }
    const parent = getMkdirParent();
    const name = mkdirName().trim();
    setMkdirError(null);
    if (!parent) {
      setMkdirError(t("new-chat.mkdir.error.parent"));
      return;
    }
    if (!name) {
      setMkdirError(t("new-chat.mkdir.error.name"));
      return;
    }
    setMkdirBusy(true);
    try {
      const result = await api.fsMkdir(props.deviceId, parent, name);
      const sep = trailingSepFor(result.path);
      const next = result.path.endsWith(sep) ? result.path : `${result.path}${sep}`;
      setCwd(next);
      setMkdirOpen(false);
      setMkdirName("");
    } catch (err) {
      setMkdirError((err as Error).message);
    } finally {
      setMkdirBusy(false);
    }
  }

  function submit(): void {
    const value = cwd().trim();
    if (!value) {
      setShake(true);
      setTimeout(() => setShake(false), 2000);
      return;
    }
    props.onConfirm({ cwd: value, permissionMode: props.permissionMode });
  }

  return (
    <div class={`new-chat-card-inner${shake() ? " text-input-error" : ""}`}>
      <label class="sidebar-label" for="new-chat-cwd">
        {t("new-chat.cwd.label")}
      </label>
      <CwdPicker
        id="new-chat-cwd"
        deviceId={props.deviceId}
        deviceLabel={props.deviceLabel}
        value={cwd()}
        onChange={setCwd}
        onSubmit={submit}
        onEscape={() => props.onCancel?.()}
      />

      <Show when={!mkdirOpen()}>
        <button
          type="button"
          class="new-chat-mkdir-open"
          onClick={() => {
            setMkdirOpen(true);
            setMkdirError(null);
            setMkdirName("");
            queueMicrotask(() => mkdirInputEl?.focus?.());
          }}
        >
          {t("new-chat.mkdir.open")}
        </button>
      </Show>

      <Show when={mkdirOpen()}>
        <div class="new-chat-mkdir-form">
          <div class="new-chat-mkdir-help">
            {getMkdirParent()
              ? t("new-chat.mkdir.help", { parent: getMkdirParent() })
              : t("new-chat.mkdir.help.empty")}
          </div>
          <input
            ref={mkdirInputEl}
            type="text"
            class="text-input new-chat-mkdir-name-input"
            placeholder={t("new-chat.mkdir.placeholder")}
            autocomplete="off"
            value={mkdirName()}
            onInput={(e) => setMkdirName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitMkdir();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setMkdirOpen(false);
              }
            }}
          />
          <div class="new-chat-mkdir-actions">
            <button type="button" class="secondary-button" onClick={() => setMkdirOpen(false)}>
              {t("new-chat.mkdir.cancel")}
            </button>
            <button
              type="button"
              class="primary-button"
              disabled={mkdirBusy()}
              onClick={() => void submitMkdir()}
            >
              {mkdirBusy() ? t("new-chat.mkdir.submit.busy") : t("new-chat.mkdir.submit")}
            </button>
          </div>
          <Show when={mkdirError()}>
            <div class="new-chat-mkdir-error">{mkdirError()}</div>
          </Show>
        </div>
      </Show>

      <div class="new-chat-card-actions">
        <button type="button" class="secondary-button" onClick={() => props.onCancel?.()}>
          {t("new-chat.actions.cancel")}
        </button>
        <button type="button" class="primary-button" disabled={!cwd().trim()} onClick={submit}>
          {t("new-chat.actions.start")}
        </button>
      </div>
    </div>
  );
};

export { SEP };
