import { createSignal } from "solid-js";
import ko from "./locales/ko.json";

export const LOCALES = ["ko"] as const;
export type LocaleId = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<LocaleId, string> = {
  ko: "한국어",
};

const dictionaries: Record<LocaleId, Record<string, string>> = {
  ko: ko as Record<string, string>,
};

const STORAGE_KEY = "cr.locale";

function persistKoreanLocale(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, "ko");
  } catch {
    // ignore
  }
}

function detectLocale(): LocaleId {
  persistKoreanLocale();
  return "ko";
}

const [locale, _setLocale] = createSignal<LocaleId>(detectLocale());

export function setLocale(_next: string): void {
  persistKoreanLocale();
  _setLocale("ko");
}

export { locale };

export function hasExplicitLocale(): boolean {
  persistKoreanLocale();
  return true;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const dict = dictionaries[locale()];
  const tpl = dict[key] ?? dictionaries.ko[key] ?? key;
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
