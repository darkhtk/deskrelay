// M2.3 — full chain: spawn the daemon binary, spawn the site-backend
// binary, drive both via fetch (simulating the browser). Verifies that
// the site successfully proxies device CRUD, behavior CRUD, behavior
// requests, and SSE event streaming end-to-end.
//
// We don't use a real browser (no Playwright yet — that's M8 polish).
// fetch + ReadableStream simulates everything the browser does.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Subprocess, spawn } from "bun";

const ROOT = join(import.meta.dir, "..", "..", "..");
const DAEMON_BIN = join(ROOT, "packages", "pc-connector-daemon", "src", "bin.ts");
const SITE_BIN = join(ROOT, "packages", "site-backend", "src", "bin.ts");
const ECHO_PKG = join(ROOT, "packages", "behaviors", "echo");

const TOKEN = "test-token-m2";
const E2E_TEST_TIMEOUT_MS = 30000;

interface RunningProc {
  proc: Subprocess<"ignore", "pipe", "pipe">;
  baseUrl: string;
}

let stateDir: string;
let stateFile: string;
let authFile: string;
let daemon: RunningProc | undefined;
let site: RunningProc | undefined;

async function waitForListening(
  proc: Subprocess<"ignore", "pipe", "pipe">,
  timeoutMs = 15000,
): Promise<{ host: string; port: number }> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: false }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: false }), 500),
        ),
      ]);
      if (done) break;
      if (value) buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/"event":"listening","host":"([^"]+)","port":(\d+)/);
      if (match) {
        const [, host, port] = match;
        return { host: host as string, port: Number(port) };
      }
    }
    throw new Error(`process did not emit "listening" within ${timeoutMs}ms. Buffer: ${buffer}`);
  } finally {
    reader.releaseLock();
  }
}

async function spawnDaemon(): Promise<RunningProc> {
  const port = 18200 + Math.floor(Math.random() * 400);
  const proc = spawn({
    cmd: [process.execPath, "run", DAEMON_BIN],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CR_CONNECTOR_PORT: String(port),
      CR_CONNECTOR_HOST: "127.0.0.1",
      CR_CONNECTOR_STATE_FILE: stateFile,
      CR_CONNECTOR_AUTH_FILE: authFile,
    },
  });
  const listening = await waitForListening(proc);
  return { proc, baseUrl: `http://${listening.host}:${listening.port}` };
}

async function spawnSite(): Promise<RunningProc> {
  const port = 18600 + Math.floor(Math.random() * 400);
  const proc = spawn({
    cmd: [process.execPath, "run", SITE_BIN],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CR_SITE_PORT: String(port),
      CR_SITE_HOST: "127.0.0.1",
      CR_SITE_TOKEN: TOKEN,
      // Point the site at the same auth.json the spawned daemon wrote
      // so its direct-fetch daemon-proxy path passes the matching
      // Bearer token.
      CR_CONNECTOR_AUTH_FILE: authFile,
    },
  });
  const listening = await waitForListening(proc);
  return { proc, baseUrl: `http://${listening.host}:${listening.port}` };
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!site) throw new Error("site not running");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  return await fetch(`${site.baseUrl}${path}`, { ...init, headers });
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "m2-e2e-"));
  stateFile = join(stateDir, "daemon.json");
  authFile = join(stateDir, "auth.json");
  daemon = await spawnDaemon();
  site = await spawnSite();
});

afterEach(async () => {
  for (const p of [daemon, site]) {
    if (p) {
      p.proc.kill();
      await p.proc.exited.catch(() => undefined);
    }
  }
  daemon = undefined;
  site = undefined;
  await rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("M2.3 browser → site → daemon → echo (full chain)", () => {
  test(
    "healthz is unauth and reports site is up",
    async () => {
      if (!site) throw new Error("site missing");
      const res = await fetch(`${site.baseUrl}/healthz`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    },
    E2E_TEST_TIMEOUT_MS,
  );

  test(
    "register device, load echo, call echo, observe event via SSE",
    async () => {
      if (!daemon) throw new Error("daemon missing");

      // Register the running daemon as a device on the site.
      const reg = await authedFetch("/api/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ daemonUrl: daemon.baseUrl, label: "local" }),
      });
      expect(reg.status).toBe(201);
      const device = await reg.json();
      expect(device.daemonUrl).toBe(daemon.baseUrl);

      // Load the echo behavior via the site (which proxies to the daemon).
      const load = await authedFetch(`/api/devices/${device.id}/behaviors/load`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageDir: ECHO_PKG, instanceId: "browser-e2e" }),
      });
      expect(load.status).toBe(200);

      // Subscribe to events BEFORE making the call so we don't miss the
      // event the call publishes.
      const space = "echo.default:browser-e2e";
      const sseRes = await authedFetch(
        `/api/devices/${device.id}/events/spaces/${encodeURIComponent(space)}/stream`,
      );
      expect(sseRes.status).toBe(200);
      if (!sseRes.body) throw new Error("SSE missing body");
      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();

      // Trigger the behavior.
      const call = await authedFetch(`/api/devices/${device.id}/behaviors/browser-e2e/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "echo", params: { message: "from-browser" } }),
      });
      expect(call.status).toBe(200);
      const callBody = await call.json();
      expect(callBody.result).toEqual({ ok: true, length: 12 });

      // Read the SSE stream until we get one event frame, with a timeout.
      let buffer = "";
      let dataLine: string | undefined;
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && !dataLine) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: false }>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: false }), 500),
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
      expect(env.content).toEqual({ message: "from-browser" });
      expect(env.spaceId).toBe(space);
    },
    E2E_TEST_TIMEOUT_MS,
  );

  test(
    "unauth /api request is rejected",
    async () => {
      if (!site) throw new Error("site missing");
      const res = await fetch(`${site.baseUrl}/api/devices`);
      expect(res.status).toBe(401);
    },
    E2E_TEST_TIMEOUT_MS,
  );

  test(
    "registering an unreachable daemon URL is rejected before it reaches the list",
    async () => {
      const reg = await authedFetch("/api/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ daemonUrl: "http://127.0.0.1:1" }),
      });
      expect(reg.status).toBe(502);
    },
    E2E_TEST_TIMEOUT_MS,
  );
});
