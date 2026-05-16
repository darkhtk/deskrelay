import { createSignal } from "solid-js";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

export const DEFAULT_LOCALE = "ko";
export const LOCALES = ["ko", "en"] as const;
export type LocaleId = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<LocaleId, string> = {
  ko: "한국어",
  en: "English",
};

const dictionaries: Record<LocaleId, Partial<Record<string, string>>> = {
  ko: ko as Record<string, string>,
  en: en as Record<string, string>,
};

const STORAGE_KEY = "cr.locale";

function isLocaleId(value: string | null | undefined): value is LocaleId {
  return LOCALES.includes(value as LocaleId);
}

function applyDocumentLocale(next: LocaleId): void {
  try {
    globalThis.document?.documentElement.setAttribute("lang", next);
  } catch {
    // SSR/tests without document still keep the signal and storage in sync.
  }
}

function readStoredLocale(): LocaleId {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isLocaleId(value)) return value;
    if (value) globalThis.localStorage?.setItem(STORAGE_KEY, DEFAULT_LOCALE);
  } catch {
    // Ignore storage failures; Korean remains the safe default.
  }
  return DEFAULT_LOCALE;
}

const [locale, _setLocale] = createSignal<LocaleId>(readStoredLocale());
applyDocumentLocale(locale());

export function setLocale(next: string): void {
  const normalized = isLocaleId(next) ? next : DEFAULT_LOCALE;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, normalized);
  } catch {
    // Private mode etc. The in-memory signal still updates for this tab.
  }
  _setLocale(normalized);
  applyDocumentLocale(normalized);
}

export { locale };

export function hasExplicitLocale(): boolean {
  try {
    return isLocaleId(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const dict = dictionaries[locale()];
  const tpl = dict[key] ?? dictionaries.ko[key] ?? dictionaries.en[key] ?? key;
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
