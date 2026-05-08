import { afterEach, describe, expect, test } from "vitest";
import {
  applyCustomInstructionsToMessage,
  getCustomInstructionPrefs,
  resetCustomInstructionPrefs,
  setCustomInstructionPrefs,
  setShowCtxUsageMeter,
  setShowSessionUsageMeter,
  setShowWeekUsageMeter,
  hasCustomInstructions,
  showCtxUsageMeter,
  showSessionUsageMeter,
  showWeekUsageMeter,
} from "../src/ui-prefs.ts";

afterEach(() => {
  resetCustomInstructionPrefs();
  setShowCtxUsageMeter(true);
  setShowSessionUsageMeter(true);
  setShowWeekUsageMeter(true);
  localStorage.clear();
  sessionStorage.clear();
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

describe("custom instruction preferences", () => {
  test("factory state is empty and does not alter messages", () => {
    resetCustomInstructionPrefs();

    expect(getCustomInstructionPrefs()).toEqual({
      global: "",
      local: "",
      session: "",
    });
    expect(hasCustomInstructions()).toBe(false);
    expect(applyCustomInstructionsToMessage("ping")).toBe("ping");
  });

  test("saved instructions are prepended only after the user edits them", () => {
    setCustomInstructionPrefs({
      global: "Answer in Korean.",
      local: "",
      session: "Be concise.",
    });

    const message = applyCustomInstructionsToMessage("ping");

    expect(hasCustomInstructions()).toBe(true);
    expect(message).toContain("<deskrelay-user-instructions>");
    expect(message).toContain("## Global");
    expect(message).toContain("Answer in Korean.");
    expect(message).toContain("## Session");
    expect(message).toContain("Be concise.");
    expect(message.endsWith("\n\nping")).toBe(true);
  });
});
