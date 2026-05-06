import { createSignal } from "solid-js";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import ru from "./locales/ru.json";

export const LOCALES = ["en", "ko", "ja", "ru"] as const;
export type LocaleId = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<LocaleId, string> = {
  en: "English",
  ko: "한국어",
  ja: "日本語",
  ru: "Русский",
};

const dictionaries: Record<LocaleId, Record<string, string>> = {
  en: en as Record<string, string>,
  ko: ko as Record<string, string>,
  ja: ja as Record<string, string>,
  ru: ru as Record<string, string>,
};

const STORAGE_KEY = "cr.locale";

function detectLocale(): LocaleId {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as LocaleId;
  } catch {
    // ignore
  }
  return "en";
}

const [locale, _setLocale] = createSignal<LocaleId>(detectLocale());

export function setLocale(next: LocaleId): void {
  if (!(LOCALES as readonly string[]).includes(next)) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  _setLocale(next);
}

export { locale };

export function hasExplicitLocale(): boolean {
  try {
    return Boolean(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const dict = dictionaries[locale()];
  const tpl = dict[key] ?? dictionaries.en[key] ?? key;
  if (!tpl.includes("{")) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, slot: string) => {
    const value = params[slot];
    return value === undefined ? `{${slot}}` : String(value);
  });
}

export function tn(
  prefix: string,
  count: number,
  params: Record<string, string | number> = {},
): string {
  const suffix = count === 1 ? "singular" : "plural";
  return t(`${prefix}.${suffix}`, params);
}
