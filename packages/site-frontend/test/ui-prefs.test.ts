import { afterEach, describe, expect, test } from "vitest";
import {
  setShowCtxUsageMeter,
  setShowSessionUsageMeter,
  setShowWeekUsageMeter,
  showCtxUsageMeter,
  showSessionUsageMeter,
  showWeekUsageMeter,
} from "../src/ui-prefs.ts";

afterEach(() => {
  setShowCtxUsageMeter(true);
  setShowSessionUsageMeter(true);
  setShowWeekUsageMeter(true);
  localStorage.clear();
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
