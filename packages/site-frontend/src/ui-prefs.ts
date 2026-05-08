import { createSignal } from "solid-js";

const SCROLL_TO_BOTTOM_ON_SEND_KEY = "cr.scroll-to-bottom-on-send";
const SHOW_CTX_USAGE_METER_KEY = "cr.show-ctx-usage-meter";
const SHOW_SESSION_USAGE_METER_KEY = "cr.show-session-usage-meter";
const SHOW_WEEK_USAGE_METER_KEY = "cr.show-week-usage-meter";
const TEMP_INSTRUCTIONS_KEY = "cr.instructions.temp-session";
const THEME_KEY = "cr.theme";

export type AppTheme = "light" | "dark";

export interface TemporaryInstructionPrefs {
  content: string;
}

export const FACTORY_TEMPORARY_INSTRUCTION_PREFS: TemporaryInstructionPrefs = {
  content: "",
};

function readScrollToBottomOnSend(): boolean {
  try {
    return globalThis.localStorage?.getItem(SCROLL_TO_BOTTOM_ON_SEND_KEY) !== "false";
  } catch {
    return true;
  }
}

function readOnByDefault(name: string): boolean {
  try {
    return globalThis.localStorage?.getItem(name) !== "false";
  } catch {
    return true;
  }
}

function readTheme(): AppTheme {
  try {
    const value = globalThis.localStorage?.getItem(THEME_KEY);
    return value === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function readString(name: string, storage: Storage | undefined | null): string {
  try {
    return storage?.getItem(name) ?? "";
  } catch {
    return "";
  }
}

function writeString(name: string, value: string, storage: Storage | undefined | null): void {
  try {
    if (value.trim()) storage?.setItem(name, value);
    else storage?.removeItem(name);
  } catch {
    // Private mode etc. The in-memory signal still updates for this tab.
  }
}

const [scrollToBottomOnSend, setScrollToBottomOnSendSignal] = createSignal(
  readScrollToBottomOnSend(),
);
const [showCtxUsageMeter, setShowCtxUsageMeterSignal] = createSignal(
  readOnByDefault(SHOW_CTX_USAGE_METER_KEY),
);
const [showSessionUsageMeter, setShowSessionUsageMeterSignal] = createSignal(
  readOnByDefault(SHOW_SESSION_USAGE_METER_KEY),
);
const [showWeekUsageMeter, setShowWeekUsageMeterSignal] = createSignal(
  readOnByDefault(SHOW_WEEK_USAGE_METER_KEY),
);
const [temporaryInstructions, setTemporaryInstructionsSignal] = createSignal(
  readString(TEMP_INSTRUCTIONS_KEY, globalThis.sessionStorage),
);
const [appTheme, setAppThemeSignal] = createSignal<AppTheme>(readTheme());

export {
  appTheme,
  scrollToBottomOnSend,
  showCtxUsageMeter,
  showSessionUsageMeter,
  showWeekUsageMeter,
};

export function setScrollToBottomOnSend(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(SCROLL_TO_BOTTOM_ON_SEND_KEY, value ? "true" : "false");
  } catch {
    // Private mode etc. The in-memory signal still updates for this tab.
  }
  setScrollToBottomOnSendSignal(value);
}

function writeOnByDefault(name: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(name, value ? "true" : "false");
  } catch {
    // Private mode etc. The in-memory signal still updates for this tab.
  }
}

export function setShowCtxUsageMeter(value: boolean): void {
  writeOnByDefault(SHOW_CTX_USAGE_METER_KEY, value);
  setShowCtxUsageMeterSignal(value);
}

export function setShowSessionUsageMeter(value: boolean): void {
  writeOnByDefault(SHOW_SESSION_USAGE_METER_KEY, value);
  setShowSessionUsageMeterSignal(value);
}

export function setShowWeekUsageMeter(value: boolean): void {
  writeOnByDefault(SHOW_WEEK_USAGE_METER_KEY, value);
  setShowWeekUsageMeterSignal(value);
}

export function setAppTheme(value: AppTheme): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, value);
  } catch {
    // Private mode etc. The in-memory signal still updates for this tab.
  }
  setAppThemeSignal(value);
}

export function getTemporaryInstructionPrefs(): TemporaryInstructionPrefs {
  return { content: temporaryInstructions() };
}

export function setTemporaryInstructionPrefs(value: TemporaryInstructionPrefs): void {
  writeString(TEMP_INSTRUCTIONS_KEY, value.content, globalThis.sessionStorage);
  setTemporaryInstructionsSignal(value.content);
}

export function resetTemporaryInstructionPrefs(): void {
  setTemporaryInstructionPrefs(FACTORY_TEMPORARY_INSTRUCTION_PREFS);
}

export function hasTemporaryInstructions(
  value: TemporaryInstructionPrefs = getTemporaryInstructionPrefs(),
): boolean {
  return Boolean(value.content.trim());
}

export function applyTemporaryInstructionsToMessage(
  message: string,
  value: TemporaryInstructionPrefs = getTemporaryInstructionPrefs(),
): string {
  if (!value.content.trim()) return message;
  const block = [
    "<deskrelay-temporary-instructions>",
    "These are temporary DeskRelay instructions for this browser session. Apply them only when they do not conflict with higher-priority instructions or the latest user request.",
    value.content.trim(),
    "</deskrelay-temporary-instructions>",
  ].join("\n");
  return `${block}\n\n${message}`;
}
