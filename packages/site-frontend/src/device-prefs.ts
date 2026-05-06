// device-prefs — small per-device UI preferences kept in localStorage.
//
// These don't go to the backend because they're per-browser convenience
// (default cwd, etc.) and a future shared-server shape would need explicit storage for
// what is essentially client state. If we ever want cross-device sync
// we can promote this into the user-prefs API.

const KEY_PREFIX = "cr:device:";

function key(deviceId: string, name: string): string {
  return `${KEY_PREFIX}${deviceId}:${name}`;
}

function safeGet(name: string): string | null {
  try {
    return globalThis.localStorage?.getItem(name) ?? null;
  } catch {
    return null;
  }
}

function safeSet(name: string, value: string | null): void {
  try {
    if (value === null) {
      globalThis.localStorage?.removeItem(name);
    } else {
      globalThis.localStorage?.setItem(name, value);
    }
  } catch {
    // localStorage can be disabled (private mode, quota exceeded). The
    // pref just doesn't persist — UI still works for the session.
  }
}

export function getDeviceDefaultCwd(deviceId: string): string | null {
  return safeGet(key(deviceId, "defaultCwd"));
}

export function setDeviceDefaultCwd(deviceId: string, value: string | null): void {
  safeSet(key(deviceId, "defaultCwd"), value);
}

// ---- selected Claude model -----------------------------------------

export function getDeviceClaudeModel(deviceId: string): string | null {
  const raw = safeGet(key(deviceId, "claudeModel"));
  return raw && isSafeClaudeModel(raw) ? raw : null;
}

export function setDeviceClaudeModel(deviceId: string, value: string | null): void {
  if (value === null || value.trim() === "") {
    safeSet(key(deviceId, "claudeModel"), null);
    return;
  }
  const model = value.trim();
  if (!isSafeClaudeModel(model)) return;
  safeSet(key(deviceId, "claudeModel"), model);
}

export function isSafeClaudeModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 120 &&
    !value.startsWith("-") &&
    /^[A-Za-z0-9._:[\]-]+$/.test(value)
  );
}

// ---- always-allow tool list (Phase G4) -------------------------------

export function getAlwaysAllowedTools(deviceId: string): Set<string> {
  const raw = safeGet(key(deviceId, "alwaysAllowedTools"));
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

export function setAlwaysAllowed(deviceId: string, tool: string, allow: boolean): void {
  const current = getAlwaysAllowedTools(deviceId);
  if (allow) current.add(tool);
  else current.delete(tool);
  if (current.size === 0) {
    safeSet(key(deviceId, "alwaysAllowedTools"), null);
  } else {
    safeSet(key(deviceId, "alwaysAllowedTools"), JSON.stringify([...current].sort()));
  }
}

export function isAlwaysAllowed(deviceId: string, tool: string): boolean {
  return getAlwaysAllowedTools(deviceId).has(tool);
}

export function clearAlwaysAllowed(deviceId: string): void {
  safeSet(key(deviceId, "alwaysAllowedTools"), null);
}

// ---- security profile (PreToolUse fail-policy) ----------------------

/** Per-device security profile that controls what the PreToolUse hook
 *  does when the daemon is unreachable. Persisted in localStorage so a
 *  fresh browser doesn't lose the user's choice. */
export type SecurityProfile = "relaxed" | "normal" | "strict";

const DEFAULT_SECURITY_PROFILE: SecurityProfile = "relaxed";
const VALID_SECURITY_PROFILES: ReadonlySet<SecurityProfile> = new Set([
  "relaxed",
  "normal",
  "strict",
]);

export function getDeviceSecurityProfile(deviceId: string): SecurityProfile {
  const raw = safeGet(key(deviceId, "securityProfile"));
  if (!raw) return DEFAULT_SECURITY_PROFILE;
  return VALID_SECURITY_PROFILES.has(raw as SecurityProfile)
    ? (raw as SecurityProfile)
    : DEFAULT_SECURITY_PROFILE;
}

export function setDeviceSecurityProfile(deviceId: string, value: SecurityProfile): void {
  if (!VALID_SECURITY_PROFILES.has(value)) return;
  safeSet(key(deviceId, "securityProfile"), value);
}

// ---- bulk wipe (called on unpair / removal) -------------------------

/** Per-device pref keys this module owns. Listed once so {@link clearDevicePrefs}
 *  stays in sync with whatever new pref the next feature adds. */
const PER_DEVICE_KEYS = [
  "defaultCwd",
  "claudeModel",
  "alwaysAllowedTools",
  "securityProfile",
] as const;

/** Drop every per-device pref this module persists in localStorage.
 *  Called from both DeviceSettingsDialog unpair and DeviceShell list
 *  removal so the next pairing of a same-id device starts clean and
 *  stale local state can't bleed back into the UI. */
export function clearDevicePrefs(deviceId: string): void {
  for (const name of PER_DEVICE_KEYS) {
    safeSet(key(deviceId, name), null);
  }
}
