// LocaleChooser — first-run language picker.
//
// Shown after sign-in but BEFORE the consent gate, so the consent text
// can render in the user's deliberately-chosen language. Only appears
// when localStorage["cr.locale"] is unset (= the user has never picked
// — auto-detection from navigator.language doesn't write to storage).
//
// Once a language is picked, the choice persists and this gate vanishes
// for subsequent visits. Settings contains the recurring language control.

import { type Component, For } from "solid-js";
import { LOCALES, LOCALE_LABELS, type LocaleId, locale, setLocale, t } from "../i18n.ts";

export interface LocaleChooserProps {
  /** Called after the user clicks a language button. The parent should
   *  update its `pickedLocale` signal so the next gate (consent) takes
   *  over the screen. */
  onPicked: () => void;
}

/** Rendered for every language so a first-run user sees the call to
 *  action in their script even before they pick. The dot separator
 *  keeps the line short on phones. */
const PROMPT_STACK = "Choose your language · 언어 선택 · 言語選択 · Выберите язык";

export const LocaleChooser: Component<LocaleChooserProps> = (props) => (
  <dialog open class="approval-modal-root" aria-label="Choose your language">
    <div class="approval-card" style={{ width: "min(420px, 95vw)", "max-width": "420px" }}>
      <div
        class="approval-header"
        style={{ "flex-direction": "column", "align-items": "stretch", gap: "6px" }}
      >
        <span aria-hidden="true" style={{ "font-size": "28px", "text-align": "center" }}>
          🌐
        </span>
        <span
          class="approval-title"
          style={{ "text-align": "center", "font-size": "14px", "line-height": "1.4" }}
        >
          {PROMPT_STACK}
        </span>
        <span
          class="settings-card-help"
          style={{ "text-align": "center", "margin-top": "4px", "font-size": "12px" }}
        >
          {t("locale-chooser.subtitle")}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
          "margin-top": "16px",
        }}
      >
        <For each={LOCALES}>
          {(id) => (
            <button
              type="button"
              class={`locale-chooser-btn${id === locale() ? " locale-chooser-btn-active" : ""}`}
              onClick={() => {
                setLocale(id);
                props.onPicked();
              }}
            >
              <span style={{ "font-size": "15px", "font-weight": "500" }}>{LOCALE_LABELS[id]}</span>
              <span class="settings-meta" style={{ "font-size": "11px" }}>
                {NATIVE_HINT[id]}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  </dialog>
);

/** Tiny secondary hint per language — the country/region cues that
 *  help disambiguate when a locale name alone isn't obvious. Kept
 *  English-script for "English" so the row layout stays consistent. */
const NATIVE_HINT: Record<LocaleId, string> = {
  en: "English",
  ko: "Korean",
  ja: "Japanese",
  ru: "Russian",
};
