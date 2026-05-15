import { createSignal } from "solid-js";

const BROWSER_CACHE_ENABLED_KEY = "cr.browser-cache.enabled";
const BROWSER_CACHE_CLEAR_ON_OPEN_KEY = "cr.browser-cache.clear-on-open";
const CACHE_STORAGE_NAME = "deskrelay-browser-cache-v1";
const CACHE_STORAGE_PREFIX = "deskrelay-browser-cache";
const SESSION_TRANSCRIPT_CACHE_PREFIX = "cr.session-transcript-cache";
const USAGE_CACHE_PREFIX = "cr.usage-cache";
export const MANAGER_ORCHESTRATION_CACHE_PREFIX = "cr.manager-orchestration-cache";
const LOCAL_CACHE_PREFIXES = [
  SESSION_TRANSCRIPT_CACHE_PREFIX,
  USAGE_CACHE_PREFIX,
  MANAGER_ORCHESTRATION_CACHE_PREFIX,
];
const LOCAL_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_PREVIEW_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export const SESSION_TRANSCRIPT_CACHE_TTL_MS = 10 * 60 * 1000;

export interface BrowserCacheClearResult {
  localStorageEntries: number;
  cacheStorageEntries: number;
}

interface CachedBrowserValue<T> {
  fetchedAt: number;
  value: T;
}

interface ImagePreviewCacheInput {
  deviceId: string;
  cwd: string;
  path: string;
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  try {
    const value = globalThis.localStorage?.getItem(name);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    // Storage can be blocked in private modes.
  }
  return defaultValue;
}

const [browserCacheEnabled, setBrowserCacheEnabledSignal] = createSignal(
  readBoolean(BROWSER_CACHE_ENABLED_KEY, false),
);
const [clearBrowserCacheOnOpen, setClearBrowserCacheOnOpenSignal] = createSignal(
  readBoolean(BROWSER_CACHE_CLEAR_ON_OPEN_KEY, true),
);

export { browserCacheEnabled, clearBrowserCacheOnOpen };

export function setBrowserCacheEnabled(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(BROWSER_CACHE_ENABLED_KEY, value ? "true" : "false");
  } catch {
    // The signal still reflects the user's choice for this tab.
  }
  setBrowserCacheEnabledSignal(value);
  if (!value) void clearDeskRelayBrowserCache();
}

export function setClearBrowserCacheOnOpen(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(BROWSER_CACHE_CLEAR_ON_OPEN_KEY, value ? "true" : "false");
  } catch {
    // The signal still reflects the user's choice for this tab.
  }
  setClearBrowserCacheOnOpenSignal(value);
}

function cachePart(value: string | number | null | undefined): string {
  return encodeURIComponent(String(value ?? "-").trim() || "-");
}

export function browserCacheKey(prefix: string, ...parts: Array<string | number | null>): string {
  return [prefix, ...parts.map(cachePart)].join(":");
}

export function sessionTranscriptCacheKey(input: {
  deviceId: string;
  instanceId: string;
  cwd: string;
  sessionId: string;
  eventLimit: number;
}): string {
  return browserCacheKey(
    SESSION_TRANSCRIPT_CACHE_PREFIX,
    input.deviceId,
    input.instanceId,
    input.cwd,
    input.sessionId,
    input.eventLimit,
  );
}

export function readBrowserCacheValue<T>(key: string, ttlMs: number): T | undefined {
  if (!browserCacheEnabled()) return undefined;
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CachedBrowserValue<T>>;
    if (typeof parsed.fetchedAt !== "number" || !("value" in parsed)) {
      globalThis.localStorage?.removeItem(key);
      return undefined;
    }
    if (Date.now() - parsed.fetchedAt >= ttlMs) {
      globalThis.localStorage?.removeItem(key);
      return undefined;
    }
    return parsed.value as T;
  } catch {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Ignore storage cleanup failures.
    }
    return undefined;
  }
}

export function writeBrowserCacheValue<T>(
  key: string,
  value: T,
  maxBytes = LOCAL_CACHE_MAX_BYTES,
): boolean {
  if (!browserCacheEnabled()) return false;
  try {
    const payload: CachedBrowserValue<T> = { fetchedAt: Date.now(), value };
    const serialized = JSON.stringify(payload);
    if (serialized.length > maxBytes) return false;
    globalThis.localStorage?.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearSessionTranscriptCache(deviceId?: string, sessionId?: string): number {
  const devicePart = deviceId ? cachePart(deviceId) : null;
  const sessionPart = sessionId ? cachePart(sessionId) : null;
  return clearLocalStorageKeys((key) => {
    if (!key.startsWith(`${SESSION_TRANSCRIPT_CACHE_PREFIX}:`)) return false;
    if (devicePart && !key.includes(`:${devicePart}:`)) return false;
    if (sessionPart && !key.includes(`:${sessionPart}:`)) return false;
    return true;
  });
}

function clearLocalStorageKeys(predicate: (key: string) => boolean): number {
  let removed = 0;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return 0;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && predicate(key)) keys.push(key);
    }
    for (const key of keys) {
      storage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Ignore storage failures; cache clearing is best-effort.
  }
  return removed;
}

export async function clearDeskRelayBrowserCache(): Promise<BrowserCacheClearResult> {
  const localStorageEntries = clearLocalStorageKeys((key) =>
    LOCAL_CACHE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}:`)),
  );
  let cacheStorageEntries = 0;
  try {
    if ("caches" in globalThis) {
      const keys = await globalThis.caches.keys();
      const targets = keys.filter(
        (key) => key === CACHE_STORAGE_NAME || key.startsWith(CACHE_STORAGE_PREFIX),
      );
      const results = await Promise.all(targets.map((key) => globalThis.caches.delete(key)));
      cacheStorageEntries = results.filter(Boolean).length;
    }
  } catch {
    // Cache API can be blocked in private modes.
  }
  return { localStorageEntries, cacheStorageEntries };
}

export async function clearDeskRelayBrowserCacheOnOpenIfNeeded(): Promise<BrowserCacheClearResult | null> {
  if (!clearBrowserCacheOnOpen()) return null;
  return clearDeskRelayBrowserCache();
}

function imagePreviewCacheRequest(input: ImagePreviewCacheInput): Request | null {
  try {
    const base =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://deskrelay.local";
    const url = new URL("/__deskrelay_cache__/image-preview", base);
    url.searchParams.set("device", input.deviceId);
    url.searchParams.set("cwd", input.cwd);
    url.searchParams.set("path", input.path);
    return new Request(url.toString(), { method: "GET" });
  } catch {
    return null;
  }
}

export async function readImagePreviewCache(input: ImagePreviewCacheInput): Promise<Blob | null> {
  if (!browserCacheEnabled()) return null;
  const request = imagePreviewCacheRequest(input);
  if (!request) return null;
  try {
    if (!("caches" in globalThis)) return null;
    const cache = await globalThis.caches.open(CACHE_STORAGE_NAME);
    const response = await cache.match(request);
    return response ? response.blob() : null;
  } catch {
    return null;
  }
}

export async function writeImagePreviewCache(
  input: ImagePreviewCacheInput,
  blob: Blob,
): Promise<void> {
  if (!browserCacheEnabled()) return;
  if (blob.size > IMAGE_PREVIEW_CACHE_MAX_BYTES) return;
  const request = imagePreviewCacheRequest(input);
  if (!request) return;
  try {
    if (!("caches" in globalThis)) return;
    const cache = await globalThis.caches.open(CACHE_STORAGE_NAME);
    await cache.put(
      request,
      new Response(blob, {
        headers: {
          "content-type": blob.type || "application/octet-stream",
          "x-deskrelay-cached-at": new Date().toISOString(),
        },
      }),
    );
  } catch {
    // Preview caching is an optimization only.
  }
}
