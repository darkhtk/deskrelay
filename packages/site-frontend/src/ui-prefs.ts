import { createSignal } from "solid-js";

const SCROLL_TO_BOTTOM_ON_SEND_KEY = "cr.scroll-to-bottom-on-send";
const SHOW_CTX_USAGE_METER_KEY = "cr.show-ctx-usage-meter";
const SHOW_SESSION_USAGE_METER_KEY = "cr.show-session-usage-meter";
const SHOW_WEEK_USAGE_METER_KEY = "cr.show-week-usage-meter";

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
