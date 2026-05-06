// device-prefs — tiny localStorage helper module. The interesting
// invariant for the unpair work is that clearDevicePrefs() drops every
// per-device key in one shot so a re-pair (or even a same-id collision)
// can't inherit stale grants.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  clearDevicePrefs,
  getAlwaysAllowedTools,
  getDeviceDefaultCwd,
  getDeviceSecurityProfile,
  setAlwaysAllowed,
  setDeviceDefaultCwd,
  setDeviceSecurityProfile,
} from "../src/device-prefs.ts";

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("clearDevicePrefs", () => {
  test("drops defaultCwd, alwaysAllowedTools, and securityProfile in one call", () => {
    const id = "dev_abc";
    setDeviceDefaultCwd(id, "/home/me/work");
    setAlwaysAllowed(id, "Read", true);
    setAlwaysAllowed(id, "Bash", true);
    setDeviceSecurityProfile(id, "strict");

    expect(getDeviceDefaultCwd(id)).toBe("/home/me/work");
    expect([...getAlwaysAllowedTools(id)].sort()).toEqual(["Bash", "Read"]);
    expect(getDeviceSecurityProfile(id)).toBe("strict");

    clearDevicePrefs(id);

    expect(getDeviceDefaultCwd(id)).toBeNull();
    expect(getAlwaysAllowedTools(id).size).toBe(0);
    // securityProfile falls back to its module-level default after wipe.
    expect(getDeviceSecurityProfile(id)).toBe("relaxed");
  });

  test("only touches the target device — siblings are untouched", () => {
    setDeviceDefaultCwd("dev_keep", "/keep");
    setAlwaysAllowed("dev_keep", "Edit", true);
    setDeviceSecurityProfile("dev_keep", "normal");

    setDeviceDefaultCwd("dev_drop", "/drop");
    setAlwaysAllowed("dev_drop", "Edit", true);
    setDeviceSecurityProfile("dev_drop", "strict");

    clearDevicePrefs("dev_drop");

    expect(getDeviceDefaultCwd("dev_keep")).toBe("/keep");
    expect(getAlwaysAllowedTools("dev_keep").has("Edit")).toBe(true);
    expect(getDeviceSecurityProfile("dev_keep")).toBe("normal");

    expect(getDeviceDefaultCwd("dev_drop")).toBeNull();
    expect(getAlwaysAllowedTools("dev_drop").size).toBe(0);
    expect(getDeviceSecurityProfile("dev_drop")).toBe("relaxed");
  });

  test("idempotent: calling on an already-empty deviceId is a no-op", () => {
    expect(() => clearDevicePrefs("dev_never_seen")).not.toThrow();
    expect(getDeviceDefaultCwd("dev_never_seen")).toBeNull();
    expect(getAlwaysAllowedTools("dev_never_seen").size).toBe(0);
  });
});
