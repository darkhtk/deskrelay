import { afterEach, describe, expect, test } from "vitest";
import {
  appTheme,
  applyTemporaryInstructionsToMessage,
  getTemporaryInstructionPrefs,
  resetTemporaryInstructionPrefs,
  setAppTheme,
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
  setShowCtxUsageMeter(true);
  setShowSessionUsageMeter(true);
  setShowWeekUsageMeter(true);
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
