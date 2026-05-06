// LocalePicker — reusable select for switching the active UI locale.
// The mounted recurring control now lives in Settings > General.
// Persists via i18n.ts localStorage; rerenders are reactive across the
// whole app since every t() call reads the locale signal.

import { type Component, For } from "solid-js";
import { LOCALES, LOCALE_LABELS, type LocaleId, locale, setLocale } from "../i18n.ts";

export const LocalePicker: Component = () => {
  return (
    <div class="permission-mode-picker">
      <label class="sidebar-label" for="locale-picker">
        {LOCALE_LABELS[locale()]}
      </label>
      <select
        id="locale-picker"
        class="text-input"
        value={locale()}
        onChange={(e) => setLocale(e.currentTarget.value as LocaleId)}
      >
        <For each={LOCALES}>{(id) => <option value={id}>{LOCALE_LABELS[id]}</option>}</For>
      </select>
    </div>
  );
};
