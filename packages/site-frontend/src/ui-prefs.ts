import { createSignal } from "solid-js";

const SCROLL_TO_BOTTOM_ON_SEND_KEY = "cr.scroll-to-bottom-on-send";

function readScrollToBottomOnSend(): boolean {
  try {
    return globalThis.localStorage?.getItem(SCROLL_TO_BOTTOM_ON_SEND_KEY) !== "false";
  } catch {
    return true;
  }
}

const [scrollToBottomOnSend, setScrollToBottomOnSendSignal] = createSignal(
  readScrollToBottomOnSend(),
);

export { scrollToBottomOnSend };

export function setScrollToBottomOnSend(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(SCROLL_TO_BOTTOM_ON_SEND_KEY, value ? "true" : "false");
  } catch {
    // Private mode etc. The in-memory signal still updates for this tab.
  }
  setScrollToBottomOnSendSignal(value);
}
