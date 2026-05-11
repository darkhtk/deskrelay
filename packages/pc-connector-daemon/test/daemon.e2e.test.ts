import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BehaviorFetcher } from "../src/behavior-fetcher.ts";
import { Daemon } from "../src/daemon.ts";
import { parseWorkspaceRoots } from "../src/workspaces.ts";

const ECHO_PKG_DIR = join(import.meta.dir, "..", "..", "behaviors", "echo");
const TEST_AUTH_TOKEN = "test-token-deadbeef-0123456789abcdef";

let daemon: Daemon;
let baseUrl: string;

async function http(
  method: string,
  path: string,
  body?: unknown,
  options: { token?: string | null } = {},
): Promise<{ status: number; data: unknown }> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  // Default to the test token; pass token: null to skip auth, or
  // token: "wrong" to deliberately mismatch.
  const token = options.token === undefined ? TEST_AUTH_TOKEN : options.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  if (Object.keys(headers).length > 0) init.headers = headers;
  const res = await fetch(`${baseUrl}${path}`, init);
  let data: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

beforeEach(() => {
  daemon = new Daemon({ port: 0, bunPath: process.execPath, authToken: TEST_AUTH_TOKEN });
  const listening = daemon.start();
  baseUrl = `http://${listening.host}:${listening.port}`;
});

afterEach(async () => {
  await daemon.stop();
});

describe("Daemon HTTP API — basics", () => {
  test("GET /status returns ok with empty behaviors initially", async () => {
    const r = await http("GET", "/status");
    expect(r.status).toBe(200);
    const d = r.data as { ok: boolean; behaviors: unknown[]; brokerStats: unknown };
    expect(d.ok).toBe(true);
    expect(d.behaviors).toEqual([]);
  });

  test("GET /status exposes connector build info", async () => {
    const r = await http("GET", "/status");
    expect(r.status).toBe(200);
    const d = r.data as {
      build?: { version?: string; commit?: string; shortCommit?: string; dirty?: boolean };
    };
    expect(d.build?.version).toBe("0.0.0");
    expect(typeof d.build?.shortCommit).toBe("string");
    expect(typeof d.build?.dirty).toBe("boolean");
  });

  test("GET /capabilities lists manager API routes and behavior methods", async () => {
    const r = await http("GET", "/capabilities");
    expect(r.status).toBe(200);
    const d = r.data as {
      scope?: string;
      apiVersion?: string;
      features?: string[];
      routes?: Array<{ method: string; path: string }>;
      behaviorMethods?: string[];
    };
    expect(d.scope).toBe("device");
    expect(d.apiVersion).toBe("2026-05-11");
    expect(d.features).toContain("process.restart");
    expect(d.routes?.some((route) => route.path === "/logs")).toBe(true);
    expect(d.behaviorMethods).toContain("chat");
  });

  test("GET /logs tails the configured connector log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deskrelay-log-"));
    const logPath = join(dir, "connector.log");
    writeFileSync(
      logPath,
      [
        JSON.stringify({ level: "info", msg: "one" }),
        JSON.stringify({ level: "error", msg: "two" }),
        JSON.stringify({ level: "error", msg: "three" }),
        "",
      ].join("\n"),
      "utf8",
    );
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      logPath,
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;
    try {
      const r = await http("GET", "/logs?tail=1&level=error");
      expect(r.status).toBe(200);
      const d = r.data as { exists?: boolean; lines?: string[]; truncated?: boolean };
      expect(d.exists).toBe(true);
      expect(d.lines).toEqual([JSON.stringify({ level: "error", msg: "three" })]);
      expect(d.truncated).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("GET /process/status reports the daemon process", async () => {
    const r = await http("GET", "/process/status");
    expect(r.status).toBe(200);
    const d = r.data as {
      scope?: string;
      kind?: string;
      pid?: number;
      uptimeMs?: number;
      listening?: { port?: number };
    };
    expect(d.scope).toBe("device");
    expect(d.kind).toBe("connector-daemon");
    expect(d.pid).toBe(process.pid);
    expect(typeof d.uptimeMs).toBe("number");
    expect(d.listening?.port).toBeGreaterThan(0);
  });

  test("POST /process/restart invokes the wired restart callback", async () => {
    let calls = 0;
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      requestSelfRestart: async () => {
        calls += 1;
        return { supported: true, accepted: true, message: "restart accepted" };
      },
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;
    const r = await http("POST", "/process/restart");
    expect(r.status).toBe(202);
    expect(calls).toBe(1);
    expect(r.data).toEqual({ supported: true, accepted: true, message: "restart accepted" });
  });

  test("unknown route returns 404", async () => {
    const r = await http("GET", "/no-such-thing");
    expect(r.status).toBe(404);
  });

  test("/status pairing field defaults to unpaired when no callback wired", async () => {
    const r = await http("GET", "/status");
    expect(r.status).toBe(200);
    const d = r.data as { pairing?: { state: string } };
    expect(d.pairing?.state).toBe("unpaired");
  });

  test("/status pairing field reflects getPairingStatus callback", async () => {
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      getPairingStatus: () => ({
        state: "revoked",
        deviceId: "dev_abc",
        lastError: "device unregistered",
      }),
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;
    const r = await http("GET", "/status");
    expect(r.status).toBe(200);
    const d = r.data as { pairing?: { state: string; deviceId?: string; lastError?: string } };
    expect(d.pairing?.state).toBe("revoked");
    expect(d.pairing?.deviceId).toBe("dev_abc");
    expect(d.pairing?.lastError).toBe("device unregistered");
  });

  test("GET /pairing/status exposes minimal current-PC pairing state without auth to local app origins", async () => {
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      getPairingStatus: () => ({
        state: "ok",
        deviceId: "dev_browser_pc",
      }),
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;

    const res = await fetch(`${baseUrl}/pairing/status`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const d = (await res.json()) as { ok: boolean; pairing?: { state: string; deviceId?: string } };
    expect(d.ok).toBe(true);
    expect(d.pairing?.state).toBe("ok");
    expect(d.pairing?.deviceId).toBe("dev_browser_pc");
  });

  test("OPTIONS /pairing/status allows browser private-network probes from local app origins", async () => {
    const res = await fetch(`${baseUrl}/pairing/status`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-private-network": "true",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-private-network")).toBe("true");
  });

  test("/pairing/status blocks arbitrary web origins", async () => {
    const res = await fetch(`${baseUrl}/pairing/status`, {
      headers: { origin: "https://example.com" },
    });
    expect(res.status).toBe(403);
  });

  test("POST /pairing/reload returns 503 when no reload callback wired", async () => {
    const r = await http("POST", "/pairing/reload");
    expect(r.status).toBe(503);
    const d = r.data as { reloaded: boolean };
    expect(d.reloaded).toBe(false);
  });

  test("POST /pairing/reload invokes the wired callback and surfaces its result", async () => {
    let calls = 0;
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      reloadSiteWsClient: async () => {
        calls += 1;
        return { reloaded: true };
      },
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;
    const r = await http("POST", "/pairing/reload");
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
    const d = r.data as { reloaded: boolean };
    expect(d.reloaded).toBe(true);
  });

  test("POST /pairing/reload requires Bearer auth", async () => {
    const r = await http("POST", "/pairing/reload", undefined, { token: null });
    expect(r.status).toBe(401);
  });

  test("POST /system/uninstall invokes the wired cleanup callback", async () => {
    let payload: { removeRepo?: boolean } | undefined;
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      requestSelfUninstall: async (options) => {
        payload = options;
        return { ok: true, cleaned: true };
      },
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;
    const r = await http("POST", "/system/uninstall", { removeRepo: true });
    expect(r.status).toBe(200);
    expect(payload).toEqual({ removeRepo: true });
    expect(r.data).toEqual({ ok: true, cleaned: true });
  });

  test("POST /system/uninstall requires Bearer auth", async () => {
    const r = await http("POST", "/system/uninstall", undefined, { token: null });
    expect(r.status).toBe(401);
  });

  test("POST /system/update invokes the wired update callback", async () => {
    let calls = 0;
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      requestSelfUpdate: async () => {
        calls += 1;
        return { ok: true, restartScheduled: true };
      },
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;
    const r = await http("POST", "/system/update");
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
    expect(r.data).toEqual({ ok: true, restartScheduled: true });
  });

  test("POST /system/update requires Bearer auth", async () => {
    const r = await http("POST", "/system/update", undefined, { token: null });
    expect(r.status).toBe(401);
  });

  test("POST /system/update surfaces update failures", async () => {
    await daemon.stop();
    daemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
      requestSelfUpdate: async () => {
        throw new Error("dirty checkout");
      },
    });
    const listening = daemon.start();
    baseUrl = `http://${listening.host}:${listening.port}`;
    const r = await http("POST", "/system/update");
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ ok: false, error: "dirty checkout" });
  });
});

describe("Daemon HTTP API — auth", () => {
  test("constructing without authToken throws", () => {
    expect(() => new Daemon({ port: 0, bunPath: process.execPath } as never)).toThrow(/authToken/);
  });

  test("missing Authorization header returns 401", async () => {
    const r = await http("GET", "/status", undefined, { token: null });
    expect(r.status).toBe(401);
    expect((r.data as { error: string }).error).toBe("missing token");
  });

  test("wrong token returns 401", async () => {
    const r = await http("GET", "/status", undefined, { token: "wrong-token" });
    expect(r.status).toBe(401);
    expect((r.data as { error: string }).error).toBe("invalid token");
  });

  test("auth gate runs before route dispatch — wrong token on unknown path is still 401", async () => {
    // The 401 doesn't reveal whether the route exists. Same wrong-token
    // request to a real route would 401 just the same.
    const r = await http("GET", "/no-such-thing", undefined, { token: null });
    expect(r.status).toBe(401);
  });

  test("correct token reaches the route handler", async () => {
    // Implicit: the basics tests above all use the correct token and
    // see real responses. This case repeats one explicitly so a
    // grep for "auth" finds the positive assertion too.
    const r = await http("GET", "/status");
    expect(r.status).toBe(200);
  });

  test("Bearer prefix is required (non-Bearer scheme rejected)", async () => {
    const init: RequestInit = {
      method: "GET",
      headers: { authorization: `Token ${TEST_AUTH_TOKEN}` },
    };
    const res = await fetch(`${baseUrl}/status`, init);
    expect(res.status).toBe(401);
  });
});

describe("Daemon HTTP API — load + request + unload", () => {
  test("load echo, request method, unload", async () => {
    const load = await http("POST", "/behaviors/load", {
      packageDir: ECHO_PKG_DIR,
      instanceId: "echo-test",
    });
    expect(load.status).toBe(200);
    expect((load.data as { instanceId: string }).instanceId).toBe("echo-test");

    const list = await http("GET", "/behaviors");
    const summaries = list.data as Array<{
      instanceId: string;
      permissions: string[];
      publisher: { id: string; name: string };
      license: string;
    }>;
    expect(summaries[0]?.instanceId).toBe("echo-test");
    // Phase 1 manifest-permissions surface: list response carries
    // permissions + publisher so the frontend can show them before the
    // user enables a behavior.
    expect(Array.isArray(summaries[0]?.permissions)).toBe(true);
    expect(typeof summaries[0]?.publisher.id).toBe("string");
    expect(typeof summaries[0]?.license).toBe("string");

    const call = await http("POST", "/behaviors/echo-test/request", {
      method: "echo",
      params: { message: "hi" },
    });
    expect(call.status).toBe(200);
    expect((call.data as { result: { ok: boolean; length: number } }).result).toEqual({
      ok: true,
      length: 2,
    });

    const unload = await http("DELETE", "/behaviors/echo-test");
    expect(unload.status).toBe(200);

    const listAfter = await http("GET", "/behaviors");
    expect(listAfter.data).toEqual([]);
  });

  test("loading the same instanceId twice returns 409", async () => {
    await http("POST", "/behaviors/load", {
      packageDir: ECHO_PKG_DIR,
      instanceId: "dup",
    });
    const second = await http("POST", "/behaviors/load", {
      packageDir: ECHO_PKG_DIR,
      instanceId: "dup",
    });
    expect(second.status).toBe(409);
  });

  test("loading from a non-existent dir returns 400 with error message", async () => {
    const r = await http("POST", "/behaviors/load", {
      packageDir: "/no/such/path/anywhere",
      instanceId: "missing",
    });
    expect(r.status).toBe(400);
    expect((r.data as { error: string }).error).toMatch(/manifest/);
  });

  test("requesting an unknown instance returns 404", async () => {
    const r = await http("POST", "/behaviors/never-loaded/request", {
      method: "echo",
      params: { message: "x" },
    });
    expect(r.status).toBe(404);
  });

  test("behavior throwing returns 200 with structured error", async () => {
    await http("POST", "/behaviors/load", {
      packageDir: ECHO_PKG_DIR,
      instanceId: "boom",
    });
    const r = await http("POST", "/behaviors/boom/request", {
      method: "explode",
    });
    expect(r.status).toBe(200);
    const err = (r.data as { error: { code: number; message: string } }).error;
    expect(err.code).toBe(-32000);
    expect(err.message).toMatch(/intentional failure/);
  });

  test("load with no instanceId defaults to manifest name", async () => {
    const r = await http("POST", "/behaviors/load", { packageDir: ECHO_PKG_DIR });
    expect(r.status).toBe(200);
    expect((r.data as { instanceId: string }).instanceId).toBe("echo");
  });
});

describe("Daemon HTTP API — body validation", () => {
  test("/behaviors/load requires packageDir", async () => {
    const r = await http("POST", "/behaviors/load", {});
    expect(r.status).toBe(400);
  });

  test("/behaviors/{id}/request requires method", async () => {
    await http("POST", "/behaviors/load", { packageDir: ECHO_PKG_DIR, instanceId: "v" });
    const r = await http("POST", "/behaviors/v/request", {});
    expect(r.status).toBe(400);
  });
});

describe("Daemon HTTP API — SSE events", () => {
  test("subscribing to a space receives events emitted by behavior", async () => {
    await http("POST", "/behaviors/load", {
      packageDir: ECHO_PKG_DIR,
      instanceId: "sse-test",
    });

    const spaceId = encodeURIComponent("echo.default:sse-test");
    const sseRes = await fetch(`${baseUrl}/events/spaces/${spaceId}/stream`, {
      headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
    });
    expect(sseRes.status).toBe(200);
    if (!sseRes.body) throw new Error("SSE response has no body");
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    // Trigger an event from the behavior.
    await http("POST", "/behaviors/sse-test/request", {
      method: "echo",
      params: { message: "via-sse" },
    });

    // Read until we see one full event frame, with a timeout.
    let buffer = "";
    const deadline = Date.now() + 4000;
    let dataLine: string | undefined;
    while (Date.now() < deadline && !dataLine) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500),
        ),
      ]);
      if (done) break;
      if (value) buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/^data: (.+)$/m);
      if (match) dataLine = match[1];
    }
    await reader.cancel().catch(() => {});

    expect(dataLine).toBeDefined();
    if (!dataLine) throw new Error("unreachable");
    const env = JSON.parse(dataLine);
    expect(env.kind).toBe("echoed");
    expect(env.content).toEqual({ message: "via-sse" });
    expect(env.spaceId).toBe("echo.default:sse-test");
  });

  test("initial SSE subscribe replays events emitted just before the stream attaches", async () => {
    await http("POST", "/behaviors/load", {
      packageDir: ECHO_PKG_DIR,
      instanceId: "sse-replay-test",
    });

    await http("POST", "/behaviors/sse-replay-test/request", {
      method: "echo",
      params: { message: "before-subscribe" },
    });

    const spaceId = encodeURIComponent("echo.default:sse-replay-test");
    const sseRes = await fetch(`${baseUrl}/events/spaces/${spaceId}/stream`, {
      headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
    });
    expect(sseRes.status).toBe(200);
    if (!sseRes.body) throw new Error("SSE response has no body");
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    const deadline = Date.now() + 4000;
    let dataLine: string | undefined;
    while (Date.now() < deadline && !dataLine) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500),
        ),
      ]);
      if (done) break;
      if (value) buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/^data: (.+)$/m);
      if (match) dataLine = match[1];
    }
    await reader.cancel().catch(() => {});

    expect(dataLine).toBeDefined();
    if (!dataLine) throw new Error("unreachable");
    const env = JSON.parse(dataLine);
    expect(env.kind).toBe("echoed");
    expect(env.content).toEqual({ message: "before-subscribe" });
    expect(env.spaceId).toBe("echo.default:sse-replay-test");
  });

  test("SSE sends heartbeat before Bun's default idle timeout", async () => {
    const spaceId = encodeURIComponent("echo.default:heartbeat-test");
    const sseRes = await fetch(`${baseUrl}/events/spaces/${spaceId}/stream`, {
      headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
    });
    expect(sseRes.status).toBe(200);
    if (!sseRes.body) throw new Error("SSE response has no body");
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    const deadline = Date.now() + 4500;
    let sawPing = false;
    while (Date.now() < deadline && !sawPing) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise<{ timeout: true }>((resolve) =>
          setTimeout(() => resolve({ timeout: true }), remainingMs),
        ),
      ]);
      if ("timeout" in result) break;
      const { value, done } = result;
      if (done) break;
      if (value) buffer += decoder.decode(value, { stream: true });
      sawPing = /^: ping \d+$/m.test(buffer);
    }
    await reader.cancel().catch(() => {});

    expect(sawPing).toBe(true);
  });

  test("SSE rejects malformed spaceId", async () => {
    const r = await fetch(`${baseUrl}/events/spaces/not-a-space/stream`, {
      headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
    });
    expect(r.status).toBe(400);
  });
});

describe("Daemon HTTP API — fetcher-resolved registry URLs", () => {
  let fetcherDaemon: Daemon;
  let fetcherBaseUrl: string;

  beforeEach(() => {
    const fetcher = new BehaviorFetcher({
      firstPartyDirs: new Map([["echo", ECHO_PKG_DIR]]),
    });
    fetcherDaemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      fetcher,
      authToken: TEST_AUTH_TOKEN,
    });
    const listening = fetcherDaemon.start();
    fetcherBaseUrl = `http://${listening.host}:${listening.port}`;
  });

  afterEach(async () => {
    await fetcherDaemon.stop();
  });

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const init: RequestInit = { method };
    const headers: Record<string, string> = { authorization: `Bearer ${TEST_AUTH_TOKEN}` };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    init.headers = headers;
    const res = await fetch(`${fetcherBaseUrl}${path}`, init);
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, data };
  }

  test("deskrelay:// URL resolves via firstPartyDirs", async () => {
    const r = await call("POST", "/behaviors/load", {
      packageDir: "deskrelay://behaviors/echo",
      instanceId: "echo-via-url",
    });
    expect(r.status).toBe(200);
    expect((r.data as { instanceId: string }).instanceId).toBe("echo-via-url");
    await call("DELETE", "/behaviors/echo-via-url");
  });

  test("dr:// alias also resolves", async () => {
    const r = await call("POST", "/behaviors/load", {
      packageDir: "dr://behaviors/echo",
      instanceId: "echo-alias",
    });
    expect(r.status).toBe(200);
    await call("DELETE", "/behaviors/echo-alias");
  });

  test("registry URL for unknown name → 400 with firstPartyDirs message", async () => {
    const r = await call("POST", "/behaviors/load", {
      packageDir: "deskrelay://behaviors/unknown",
    });
    expect(r.status).toBe(400);
    expect((r.data as { error: string }).error).toMatch(/not in firstPartyDirs/);
  });

  test("filesystem path still works alongside fetcher", async () => {
    const r = await call("POST", "/behaviors/load", {
      packageDir: ECHO_PKG_DIR,
      instanceId: "echo-path",
    });
    expect(r.status).toBe(200);
    await call("DELETE", "/behaviors/echo-path");
  });
});

describe("Daemon HTTP API — fs allowlist", () => {
  // Each test gets a fresh tmp tree so symlinks/mkdir don't bleed between
  // cases. The allowlist points at one of the two top-level dirs; the
  // other is the "outside" the picker must not be able to reach.
  let tmpRoot: string;
  let allowed: string;
  let outside: string;
  let restrictedDaemon: Daemon;
  let restrictedBaseUrl: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "cr-fs-allowlist-"));
    allowed = join(tmpRoot, "allowed");
    outside = join(tmpRoot, "outside");
    mkdirSync(allowed);
    mkdirSync(outside);
    mkdirSync(join(allowed, "child"));
    mkdirSync(join(outside, "secret"));

    restrictedDaemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      workspaceRoots: parseWorkspaceRoots(allowed),
      authToken: TEST_AUTH_TOKEN,
    });
    const listening = restrictedDaemon.start();
    restrictedBaseUrl = `http://${listening.host}:${listening.port}`;
  });

  afterEach(async () => {
    await restrictedDaemon.stop();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const init: RequestInit = { method };
    const headers: Record<string, string> = { authorization: `Bearer ${TEST_AUTH_TOKEN}` };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    init.headers = headers;
    const res = await fetch(`${restrictedBaseUrl}${path}`, init);
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, data };
  }

  test("GET /fs/roots returns the configured roots", async () => {
    const r = await call("GET", "/fs/roots");
    expect(r.status).toBe(200);
    const d = r.data as { mode: string; roots: string[] };
    expect(d.mode).toBe("restricted");
    expect(d.roots).toEqual([allowed]);
  });

  test("status payload includes workspaceRoots", async () => {
    const r = await call("GET", "/status");
    expect(r.status).toBe(200);
    const d = r.data as { workspaceRoots: { mode: string; roots: string[] } };
    expect(d.workspaceRoots.mode).toBe("restricted");
    expect(d.workspaceRoots.roots).toEqual([allowed]);
  });

  test("empty path returns synthetic listing of roots", async () => {
    const r = await call("GET", "/fs/list?path=");
    expect(r.status).toBe(200);
    const d = r.data as { entries: Array<{ fullPath: string }>; parent: null };
    expect(d.parent).toBeNull();
    expect(d.entries.map((e) => e.fullPath)).toEqual([allowed]);
  });

  test("listing inside an allowed root succeeds", async () => {
    const r = await call("GET", `/fs/list?path=${encodeURIComponent(allowed)}`);
    expect(r.status).toBe(200);
    const d = r.data as { entries: Array<{ name: string }> };
    expect(d.entries.map((e) => e.name)).toContain("child");
  });

  test("listing outside the allowed root returns 403", async () => {
    const r = await call("GET", `/fs/list?path=${encodeURIComponent(outside)}`);
    expect(r.status).toBe(403);
    expect((r.data as { error: string }).error).toMatch(/forbidden/);
  });

  test("unrestricted fs browse scope can list outside the configured root", async () => {
    const r = await call(
      "GET",
      `/fs/list?path=${encodeURIComponent(outside)}&workspaceScope=unrestricted`,
    );
    expect(r.status).toBe(200);
    const d = r.data as { entries: Array<{ name: string }> };
    expect(d.entries.map((e) => e.name)).toContain("secret");
  });

  test("mkdir inside an allowed root succeeds", async () => {
    const r = await call("POST", "/fs/mkdir", { parent: allowed, name: "fresh" });
    expect(r.status).toBe(200);
    const d = r.data as { path: string };
    expect(d.path).toBe(join(allowed, "fresh"));
  });

  test("mkdir outside the allowed root returns 403", async () => {
    const r = await call("POST", "/fs/mkdir", { parent: outside, name: "nope" });
    expect(r.status).toBe(403);
    expect((r.data as { error: string }).error).toMatch(/forbidden/);
  });

  test("unrestricted fs browse scope can create folders outside the configured root", async () => {
    const r = await call("POST", "/fs/mkdir", {
      parent: outside,
      name: "new-free-folder",
      workspaceScope: "unrestricted",
    });
    expect(r.status).toBe(200);
    const d = r.data as { path: string };
    expect(d.path).toBe(join(outside, "new-free-folder"));
  });

  test("mkdir name with path-separator is still rejected as 400", async () => {
    const r = await call("POST", "/fs/mkdir", { parent: allowed, name: "../escape" });
    expect(r.status).toBe(400);
  });

  test("symlink inside an allowed root pointing outside is hidden from listing", async () => {
    // mkdir /allowed/escape-hatch -> /outside  (symlink). On Windows
    // unprivileged users can't create directory symlinks; skip there.
    if (process.platform === "win32") return;
    symlinkSync(outside, join(allowed, "escape-hatch"), "dir");

    const r = await call("GET", `/fs/list?path=${encodeURIComponent(allowed)}`);
    expect(r.status).toBe(200);
    const names = (r.data as { entries: Array<{ name: string }> }).entries.map((e) => e.name);
    expect(names).toContain("child");
    expect(names).not.toContain("escape-hatch");
  });
});

describe("Daemon HTTP API — fs unrestricted (regression)", () => {
  // Default-constructed daemon must keep its pre-allowlist behaviour.
  let unrestrictedDaemon: Daemon;
  let unrestrictedBaseUrl: string;

  beforeEach(() => {
    unrestrictedDaemon = new Daemon({
      port: 0,
      bunPath: process.execPath,
      authToken: TEST_AUTH_TOKEN,
    });
    const listening = unrestrictedDaemon.start();
    unrestrictedBaseUrl = `http://${listening.host}:${listening.port}`;
  });

  afterEach(async () => {
    await unrestrictedDaemon.stop();
  });

  const authHeaders = { authorization: `Bearer ${TEST_AUTH_TOKEN}` };

  test("/fs/roots reports unrestricted mode", async () => {
    const res = await fetch(`${unrestrictedBaseUrl}/fs/roots`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const d = (await res.json()) as { mode: string; roots: string[] };
    expect(d.mode).toBe("unrestricted");
    expect(d.roots).toEqual([]);
  });

  test("listing an arbitrary tmp dir is permitted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cr-fs-unrestricted-"));
    try {
      const res = await fetch(`${unrestrictedBaseUrl}/fs/list?path=${encodeURIComponent(dir)}`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
