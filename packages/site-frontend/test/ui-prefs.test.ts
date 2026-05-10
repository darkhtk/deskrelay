import { afterEach, describe, expect, test } from "vitest";
import {
  appTheme,
  applyTemporaryInstructionsToMessage,
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CHAT_TRANSCRIPT_EVENT_LIMIT_DEFAULT,
  CHAT_TRANSCRIPT_EVENT_LIMIT_MAX,
  CHAT_TRANSCRIPT_EVENT_LIMIT_MIN,
  chatFontSize,
  chatTranscriptEventLimit,
  getTemporaryInstructionPrefs,
  resetTemporaryInstructionPrefs,
  newChatCwdBrowseMode,
  setAppTheme,
  setChatFontSize,
  setChatTranscriptEventLimit,
  setNewChatCwdBrowseMode,
  setTemporaryInstructionPrefs,
  setShowCtxUsageMeter,
  setShowSessionUsageMeter,
  setShowWeekUsageMeter,
  hasTemporaryInstructions,
  showCtxUsageMeter,
  showSessionUsageMeter,
  showWeekUsageMeter,
} from "../src/ui-prefs.ts";

afterEach(() => {
  resetTemporaryInstructionPrefs();
  setAppTheme("light");
  setChatFontSize(CHAT_FONT_SIZE_DEFAULT);
  setChatTranscriptEventLimit(CHAT_TRANSCRIPT_EVENT_LIMIT_DEFAULT);
  setShowCtxUsageMeter(true);
  setShowSessionUsageMeter(true);
  setShowWeekUsageMeter(true);
  setNewChatCwdBrowseMode("allowed-roots");
  localStorage.clear();
  sessionStorage.clear();
});

describe("theme preferences", () => {
  test("default to light mode", () => {
    expect(appTheme()).toBe("light");
  });

  test("can switch between light and dark", () => {
    setAppTheme("dark");
    expect(appTheme()).toBe("dark");
    expect(localStorage.getItem("cr.theme")).toBe("dark");

    setAppTheme("light");
    expect(appTheme()).toBe("light");
    expect(localStorage.getItem("cr.theme")).toBe("light");
  });
});

describe("chat font size preferences", () => {
  test("default to the current chat font size", () => {
    expect(chatFontSize()).toBe(CHAT_FONT_SIZE_DEFAULT);
  });

  test("can persist and clamp the chat font size", () => {
    setChatFontSize(18);
    expect(chatFontSize()).toBe(18);
    expect(localStorage.getItem("cr.chat-font-size")).toBe("18");

    setChatFontSize(CHAT_FONT_SIZE_MAX + 10);
    expect(chatFontSize()).toBe(CHAT_FONT_SIZE_MAX);

    setChatFontSize(CHAT_FONT_SIZE_MIN - 10);
    expect(chatFontSize()).toBe(CHAT_FONT_SIZE_MIN);
  });
});

describe("transcript display limit preferences", () => {
  test("default to the latest 100 events", () => {
    expect(chatTranscriptEventLimit()).toBe(CHAT_TRANSCRIPT_EVENT_LIMIT_DEFAULT);
  });

  test("can persist and clamp the transcript display limit", () => {
    setChatTranscriptEventLimit(350);
    expect(chatTranscriptEventLimit()).toBe(350);
    expect(localStorage.getItem("cr.chat-transcript-event-limit")).toBe("350");

    setChatTranscriptEventLimit(CHAT_TRANSCRIPT_EVENT_LIMIT_MAX + 500);
    expect(chatTranscriptEventLimit()).toBe(CHAT_TRANSCRIPT_EVENT_LIMIT_MAX);

    setChatTranscriptEventLimit(CHAT_TRANSCRIPT_EVENT_LIMIT_MIN - 50);
    expect(chatTranscriptEventLimit()).toBe(CHAT_TRANSCRIPT_EVENT_LIMIT_MIN);
  });
});

describe("usage display preferences", () => {
  test("default to visible", () => {
    expect(showCtxUsageMeter()).toBe(true);
    expect(showSessionUsageMeter()).toBe(true);
    expect(showWeekUsageMeter()).toBe(true);
  });

  test("can hide and restore individual usage meters", () => {
    setShowCtxUsageMeter(false);
    setShowSessionUsageMeter(false);
    setShowWeekUsageMeter(false);

    expect(showCtxUsageMeter()).toBe(false);
    expect(showSessionUsageMeter()).toBe(false);
    expect(showWeekUsageMeter()).toBe(false);

    setShowCtxUsageMeter(true);
    setShowSessionUsageMeter(true);
    setShowWeekUsageMeter(true);

    expect(showCtxUsageMeter()).toBe(true);
    expect(showSessionUsageMeter()).toBe(true);
    expect(showWeekUsageMeter()).toBe(true);
  });
});

describe("new chat cwd browse preferences", () => {
  test("default to allowed workspace roots", () => {
    expect(newChatCwdBrowseMode()).toBe("allowed-roots");
  });

  test("can switch to unrestricted browsing", () => {
    setNewChatCwdBrowseMode("unrestricted");

    expect(newChatCwdBrowseMode()).toBe("unrestricted");
    expect(localStorage.getItem("cr.new-chat-cwd-browse-mode")).toBe("unrestricted");

    setNewChatCwdBrowseMode("allowed-roots");
    expect(newChatCwdBrowseMode()).toBe("allowed-roots");
  });
});

describe("temporary instruction preferences", () => {
  test("factory state is empty and does not alter messages", () => {
    resetTemporaryInstructionPrefs();

    expect(getTemporaryInstructionPrefs()).toEqual({ content: "" });
    expect(hasTemporaryInstructions()).toBe(false);
    expect(applyTemporaryInstructionsToMessage("ping")).toBe("ping");
  });

  test("session instructions are prepended only after the user edits them", () => {
    setTemporaryInstructionPrefs({ content: "Be concise." });

    const message = applyTemporaryInstructionsToMessage("ping");

    expect(hasTemporaryInstructions()).toBe(true);
    expect(message).toContain("<deskrelay-temporary-instructions>");
    expect(message).toContain("Be concise.");
    expect(message.endsWith("\n\nping")).toBe(true);
  });
});
