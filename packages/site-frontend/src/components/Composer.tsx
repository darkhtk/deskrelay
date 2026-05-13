// Composer — message input + send button + slash-command picker.
//
// Ported from the original browser prototype/composer.js (production-validated). Key
// behaviors preserved:
//   - Multi-turn never blocks input. Send stays enabled while a previous
//     turn is in flight; the daemon queues follow-up messages. Stop is a
//     separate affordance so sending and interrupting stay unambiguous.
//   - Slash picker pops on "/" at the start of the first line. Closes once
//     the user types a space (moved past command name into args).
//   - Picker keyboard: ArrowDown / ArrowUp move highlight, Tab or Enter
//     completes, Escape closes.
//   - Escape stops the in-flight turn when the slash picker is not open.
//   - IME-safe: ignores Enter while isComposing or keyCode 229 (Korean /
//     Japanese / Chinese commit-Enter must not double-submit).
//   - Enter sends, Shift+Enter inserts newline.
//   - hasExtraContent() lets attachments keep send enabled even when text
//     is empty.

import { type Component, For, type JSX, Show, createEffect, createSignal } from "solid-js";
import {
  BUILTIN_SLASH_COMMANDS,
  type SlashCommand,
  applySlashCompletion,
  filterSlashCommands,
} from "../claude/slash-commands.ts";
import { t } from "../i18n.ts";

const COMPOSER_INPUT_MAX_HEIGHT = 240;

export interface ComposerProps {
  /** Called with the trimmed text when the user submits. */
  onSend: (value: string) => Promise<void> | void;
  /** Called by the dedicated stop button while a turn is in flight. */
  onInterrupt?: () => void;
  /** Lets attachments keep send enabled when text is empty. */
  hasExtraContent?: () => boolean;
  /** Override the slash-command list (tests / future per-user filtering). */
  slashCommands?: ReadonlyArray<SlashCommand>;
  /** External "is the previous turn still running?" signal. The composer
   *  keeps accepting input; the daemon serializes queued messages. */
  inFlight?: boolean;
  /** Optional initial value (uncontrolled — change once at mount). */
  initialValue?: string;
  /** Click handler for the "+" attach button on the composer footer.
   *  Hosts wire this to open a file picker (Attachments component). */
  onAttachClick?: () => void;
  /** Remaining context percentage. `null` shows a pending text state. */
  contextRemainingPercent?: number | null | undefined;
  /** Disable text entry and submit while the host is busy. */
  disabled?: boolean;
  /** Optional placeholder override for composer variants. */
  placeholder?: string;
  /** Prefix for DOM ids when multiple composers are mounted at once. */
  idPrefix?: string;
  /** Optional host-specific actions rendered directly left of stop/send. */
  extraActions?: JSX.Element;
}

export const Composer: Component<ComposerProps> = (props) => {
  const [value, setValue] = createSignal(props.initialValue ?? "");
  const [suggestions, setSuggestions] = createSignal<SlashCommand[]>([]);
  const [highlight, setHighlight] = createSignal<number>(-1);
  const commands = () => props.slashCommands ?? BUILTIN_SLASH_COMMANDS;
  const idPrefix = () => props.idPrefix ?? "composer";
  const hasExtra = () => {
    try {
      return typeof props.hasExtraContent === "function" && !!props.hasExtraContent();
    } catch {
      return false;
    }
  };
  const canSend = () => !props.disabled && (value().trim().length > 0 || hasExtra());
  const contextRemaining = () => {
    const value = props.contextRemainingPercent;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
  };
  const contextRemainingRounded = () => {
    const value = contextRemaining();
    return value === null ? null : Math.round(value);
  };
  const contextTone = () => {
    const value = contextRemaining();
    if (value === null) return "unknown";
    if (value >= 70) return "good";
    if (value >= 40) return "warn";
    return "danger";
  };
  const contextLabel = () => {
    const value = contextRemainingRounded();
    return value === null ? "컨텍스트 압축 정보 확인 중" : `컨텍스트 압축까지 ${value}% 남았습니다`;
  };
  let inputEl!: HTMLTextAreaElement;
  let slashPickerEl: HTMLDivElement | undefined;

  function resizeInput() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    const scrollHeight = inputEl.scrollHeight;
    inputEl.style.overflowY = scrollHeight > COMPOSER_INPUT_MAX_HEIGHT ? "auto" : "hidden";
    if (scrollHeight > 0) {
      inputEl.style.height = `${Math.min(scrollHeight, COMPOSER_INPUT_MAX_HEIGHT)}px`;
    } else {
      inputEl.style.removeProperty("height");
    }
  }

  function scheduleInputResize() {
    queueMicrotask(resizeInput);
  }

  createEffect(() => {
    value();
    scheduleInputResize();
  });

  createEffect(() => {
    const idx = highlight();
    if (idx < 0 || suggestions().length === 0) return;
    requestAnimationFrame(() => {
      const active = slashPickerEl?.querySelector<HTMLElement>(".slash-suggest-active");
      if (typeof active?.scrollIntoView === "function") {
        active.scrollIntoView({ block: "nearest" });
      }
    });
  });

  function refreshSlash(next: string) {
    const matches = filterSlashCommands(next, commands());
    setSuggestions(matches);
    setHighlight(matches.length > 0 ? 0 : -1);
  }

  function moveHighlight(delta: number) {
    const list = suggestions();
    if (list.length === 0) return;
    setHighlight((cur) => (cur + delta + list.length) % list.length);
  }

  function applyChosen(idx: number): boolean {
    const list = suggestions();
    const chosen = list[idx];
    if (!chosen) return false;
    const next = applySlashCompletion(value(), chosen.name);
    setValue(next);
    inputEl.value = next;
    scheduleInputResize();
    setSuggestions([]);
    setHighlight(-1);
    inputEl.focus?.();
    return true;
  }

  async function submit() {
    if (props.disabled) return;
    const text = value().trim();
    if (!text && !hasExtra()) return;
    const previous = value();
    setValue("");
    inputEl.value = "";
    scheduleInputResize();
    setSuggestions([]);
    setHighlight(-1);
    try {
      await props.onSend(text);
    } catch {
      // Restore the draft so the user doesn't lose their input on
      // transient failures. The parent's onSend handler is responsible
      // for surfacing the actual error to the user (toast / banner) —
      // we just keep the input recoverable.
      setValue(previous);
      inputEl.value = previous;
      scheduleInputResize();
    }
  }

  function handleSendClick() {
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!event) return;
    if (props.disabled) return;
    // IME safety: don't fire submit on the Enter that commits a composing
    // syllable. Without this, Korean/Japanese/Chinese input double-submits.
    if (event.isComposing || event.keyCode === 229) return;

    // Slash picker hijacks navigation keys when open.
    if (suggestions().length > 0) {
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
      if (event.key === "Tab") {
        event.preventDefault();
        applyChosen(highlight());
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestions([]);
        setHighlight(-1);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        applyChosen(highlight());
        return;
      }
    }

    if (event.key === "Escape" && props.inFlight && props.onInterrupt) {
      event.preventDefault();
      props.onInterrupt();
      return;
    }

    const isEnter = event.key === "Enter" || event.code === "Enter";
    if (!isEnter) return;
    if (event.shiftKey) return;
    event.preventDefault();
    void submit();
  }

  function handleInput(event: InputEvent) {
    const target = event.target as HTMLTextAreaElement;
    const next = target.value;
    setValue(next);
    scheduleInputResize();
    refreshSlash(next);
  }

  return (
    <>
      <Show when={suggestions().length > 0}>
        <div class="slash-picker-root" ref={slashPickerEl}>
          <ul class="slash-picker">
            <For each={suggestions()}>
              {(c, i) => (
                <li>
                  <button
                    type="button"
                    class={`slash-suggest-item${i() === highlight() ? " slash-suggest-active" : ""}`}
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      // mousedown so the input doesn't lose focus before click.
                      e.preventDefault();
                      applyChosen(i());
                    }}
                  >
                    <span class="slash-suggest-name">{c.name}</span>
                    <span class="slash-suggest-hint">{c.hint}</span>
                    <Show when={c.paid}>
                      <span class="slash-suggest-paid" title={t("composer.slash.paid.title")}>
                        {t("composer.slash.paid")}
                      </span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      <form
        class="composer-card"
        id={`${idPrefix()}-form`}
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <textarea
          ref={inputEl}
          id={`${idPrefix()}-input`}
          class="composer-input"
          rows={2}
          placeholder={props.placeholder ?? t("composer.placeholder")}
          autocomplete="off"
          spellcheck={false}
          disabled={props.disabled}
          value={value()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
        <div class="composer-footer">
          {/* Attach button is opt-in via the `onAttachClick` prop so hosts
              can choose whether their transport supports image blocks. */}
          <Show when={props.onAttachClick}>
            <button
              type="button"
              class="composer-attach"
              aria-label={t("composer.attach.aria")}
              onClick={() => props.onAttachClick?.()}
            >
              +
            </button>
          </Show>
          <Show when={props.contextRemainingPercent !== undefined}>
            <output
              class={`composer-context-status composer-context-status-${contextTone()}`}
              aria-live="polite"
            >
              {contextLabel()}
            </output>
          </Show>
          <div class="composer-actions">
            <Show when={props.extraActions}>
              {(actions) => <div class="composer-preset-actions">{actions()}</div>}
            </Show>
            <button
              type="button"
              class="composer-stop"
              aria-label={t("composer.stop.aria")}
              title={t("composer.stop.title")}
              hidden={!props.inFlight}
              onClick={() => props.onInterrupt?.()}
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
                style={{ width: "12px", height: "12px" }}
              >
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
            </button>
            <button
              type="button"
              class="composer-send"
              aria-label={t("composer.send.aria")}
              title={t("composer.send.title")}
              onClick={handleSendClick}
              disabled={!canSend()}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 19V5M5 12l7-7 7 7"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </form>
    </>
  );
};
