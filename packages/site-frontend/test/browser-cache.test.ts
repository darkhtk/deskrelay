import { afterEach, describe, expect, test } from "vitest";
import {
  browserCacheEnabled,
  clearBrowserCacheOnOpen,
  clearDeskRelayBrowserCache,
  clearDeskRelayBrowserCacheOnOpenIfNeeded,
  readBrowserCacheValue,
  setBrowserCacheEnabled,
  setClearBrowserCacheOnOpen,
  writeBrowserCacheValue,
} from "../src/browser-cache.ts";

afterEach(async () => {
  setBrowserCacheEnabled(true);
  setClearBrowserCacheOnOpen(false);
  await clearDeskRelayBrowserCache();
  localStorage.clear();
});

describe("browser cache preferences", () => {
  test("default to enabled cache without clear-on-open", () => {
    expect(browserCacheEnabled()).toBe(true);
    expect(clearBrowserCacheOnOpen()).toBe(false);
  });

  test("persist cache toggles in localStorage", () => {
    setBrowserCacheEnabled(true);
    setClearBrowserCacheOnOpen(false);

    expect(browserCacheEnabled()).toBe(true);
    expect(clearBrowserCacheOnOpen()).toBe(false);
    expect(localStorage.getItem("cr.browser-cache.enabled")).toBe("true");
    expect(localStorage.getItem("cr.browser-cache.clear-on-open")).toBe("false");
  });

  test("only reads and writes cached values when cache is enabled", () => {
    expect(writeBrowserCacheValue("cr.usage-cache:test", { ok: true })).toBe(false);
    expect(readBrowserCacheValue("cr.usage-cache:test", 1000)).toBeUndefined();

    setBrowserCacheEnabled(true);
    expect(writeBrowserCacheValue("cr.usage-cache:test", { ok: true })).toBe(true);
    expect(readBrowserCacheValue("cr.usage-cache:test", 1000)).toEqual({ ok: true });

    setBrowserCacheEnabled(false);
    expect(readBrowserCacheValue("cr.usage-cache:test", 1000)).toBeUndefined();
  });

  test("clears DeskRelay cache without removing auth or UI preferences", async () => {
    setBrowserCacheEnabled(true);
    writeBrowserCacheValue("cr.usage-cache:limits:dev", { session: null, week: null });
    writeBrowserCacheValue("cr.session-transcript-cache:dev:session", { events: [] });
    localStorage.setItem("cr.site-token.localhost", "site-token");
    localStorage.setItem("cr.theme", "dark");

    const result = await clearDeskRelayBrowserCache();

    expect(result.localStorageEntries).toBe(2);
    expect(localStorage.getItem("cr.usage-cache:limits:dev")).toBeNull();
    expect(localStorage.getItem("cr.session-transcript-cache:dev:session")).toBeNull();
    expect(localStorage.getItem("cr.site-token.localhost")).toBe("site-token");
    expect(localStorage.getItem("cr.theme")).toBe("dark");
  });

  test("clear-on-open removes existing cache only when enabled", async () => {
    setBrowserCacheEnabled(true);
    writeBrowserCacheValue("cr.usage-cache:ctx:dev", { remainingPercent: 90 });
    setClearBrowserCacheOnOpen(false);

    expect(await clearDeskRelayBrowserCacheOnOpenIfNeeded()).toBeNull();
    expect(localStorage.getItem("cr.usage-cache:ctx:dev")).not.toBeNull();

    setClearBrowserCacheOnOpen(true);
    await clearDeskRelayBrowserCacheOnOpenIfNeeded();
    expect(localStorage.getItem("cr.usage-cache:ctx:dev")).toBeNull();
  });
});
