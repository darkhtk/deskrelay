import { createSignal } from "solid-js";

const SCROLL_TO_BOTTOM_ON_SEND_KEY = "cr.scroll-to-bottom-on-send";
const SHOW_CTX_USAGE_METER_KEY = "cr.show-ctx-usage-meter";
const SHOW_SESSION_USAGE_METER_KEY = "cr.show-session-usage-meter";
const SHOW_WEEK_USAGE_METER_KEY = "cr.show-week-usage-meter";
const GLOBAL_INSTRUCTIONS_KEY = "cr.instructions.global";
const LOCAL_INSTRUCTIONS_KEY = "cr.instructions.local";
const SESSION_INSTRUCTIONS_KEY = "cr.instructions.session";

export interface CustomInstructionPrefs {
  global: string;
  local: string;
  session: string;
}

export const FACTORY_CUSTOM_INSTRUCTION_PREFS: CustomInstructionPrefs = {
  global: "",
  local: "",
  session: "",
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
const [globalInstructions, setGlobalInstructionsSignal] = createSignal(
  readString(GLOBAL_INSTRUCTIONS_KEY, globalThis.localStorage),
);
const [localInstructions, setLocalInstructionsSignal] = createSignal(
  readString(LOCAL_INSTRUCTIONS_KEY, globalThis.localStorage),
);
const [sessionInstructions, setSessionInstructionsSignal] = createSignal(
  readString(SESSION_INSTRUCTIONS_KEY, globalThis.sessionStorage),
);

export { scrollToBottomOnSend, showCtxUsageMeter, showSessionUsageMeter, showWeekUsageMeter };

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

export function getCustomInstructionPrefs(): CustomInstructionPrefs {
  return {
    global: globalInstructions(),
    local: localInstructions(),
    session: sessionInstructions(),
  };
}

export function setCustomInstructionPrefs(value: CustomInstructionPrefs): void {
  writeString(GLOBAL_INSTRUCTIONS_KEY, value.global, globalThis.localStorage);
  writeString(LOCAL_INSTRUCTIONS_KEY, value.local, globalThis.localStorage);
  writeString(SESSION_INSTRUCTIONS_KEY, value.session, globalThis.sessionStorage);
  setGlobalInstructionsSignal(value.global);
  setLocalInstructionsSignal(value.local);
  setSessionInstructionsSignal(value.session);
}

export function resetCustomInstructionPrefs(): void {
  setCustomInstructionPrefs(FACTORY_CUSTOM_INSTRUCTION_PREFS);
}

export function hasCustomInstructions(value: CustomInstructionPrefs = getCustomInstructionPrefs()): boolean {
  return Boolean(value.global.trim() || value.local.trim() || value.session.trim());
}

export function applyCustomInstructionsToMessage(
  message: string,
  value: CustomInstructionPrefs = getCustomInstructionPrefs(),
): string {
  const candidates: Array<[string, string]> = [
    ["Global", value.global] as [string, string],
    ["Local", value.local] as [string, string],
    ["Session", value.session] as [string, string],
  ];
  const entries = candidates.filter(([, text]) => text.trim().length > 0);
  if (entries.length === 0) return message;
  const block = [
    "<deskrelay-user-instructions>",
    "These are user-managed DeskRelay instructions. Apply them only when they do not conflict with higher-priority instructions or the latest user request.",
    ...entries.flatMap(([label, text]) => [``, `## ${label}`, text.trim()]),
    "</deskrelay-user-instructions>",
  ].join("\n");
  return `${block}\n\n${message}`;
}
