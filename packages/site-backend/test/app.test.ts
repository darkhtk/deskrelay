import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { type SiteAppOptions, buildManagerAssistantPrompt, createSiteApp } from "../src/app.ts";
import { InMemoryDeviceRegistry } from "../src/device-registry.ts";
import type {
  DeviceUpdateEntryInput,
  DeviceUpdateQueueStore,
  StoredDeviceUpdateEntry,
} from "../src/device-update-queue-store.ts";
import { createInMemoryManagerOrchestrationStore } from "../src/manager-orchestration-store.ts";
import { createInMemoryManagerTaskStore } from "../src/manager-task-store.ts";

const TOKEN = "test-token";
const DAEMON_URL = "http://daemon.test:18091";

interface MockDaemonCall {
  method: string;
  url: string;
  body?: string;
  headers: Record<string, string>;
}

interface MockSetup {
  app: Hono;
  registry: InMemoryDeviceRegistry;
  calls: MockDaemonCall[];
  setMockResponse(handler: (req: Request) => Response | Promise<Response>): void;
}

function makeApp(
  options: Partial<Omit<SiteAppOptions, "registry" | "token" | "fetchImpl">> = {},
): MockSetup {
  const registry = new InMemoryDeviceRegistry();
  const calls: MockDaemonCall[] = [];
  let mockResponse: (req: Request) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    const call: MockDaemonCall = {
      method: init?.method ?? "GET",
      url,
      headers,
    };
    if (typeof init?.body === "string") call.body = init.body;
    calls.push(call);
    return mockResponse(new Request(url, init));
  }) as typeof fetch;

  const app = createSiteApp({ registry, token: TOKEN, fetchImpl, ...options });
  return {
    app,
    registry,
    calls,
    setMockResponse(h) {
      mockResponse = h;
    },
  };
}

function authedRequest(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${TOKEN}` },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  return new Request(`http://site.local${path}`, init);
}

function parseSseEvents(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n");
    if (!data) continue;
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object") events.push(parsed as Record<string, unknown>);
  }
  return events;
}

function findCheck<T extends { id: string }>(checks: T[], id: string): T | undefined {
  return checks.find((check) => check.id === id);
}

function siteAppRouteInventory(): string[] {
  const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const routePattern = /app\.(get|post|put|patch|delete)\("([^"]+)"/g;
  const routes = new Set<string>();
  for (const match of source.matchAll(routePattern)) {
    const method = match[1]?.toUpperCase();
    const path = match[2];
    if (method && path) routes.add(`${method} ${path}`);
  }
  return [...routes].sort();
}

function createMemoryUpdateQueueStore(): DeviceUpdateQueueStore {
  const entries = new Map<string, StoredDeviceUpdateEntry>();
  return {
    async list() {
      return [...entries.values()].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    },
    async get(deviceId) {
      return entries.get(deviceId);
    },
    async upsert(input: DeviceUpdateEntryInput) {
      const now = new Date().toISOString();
      const entry: StoredDeviceUpdateEntry = {
        ...input,
        updatedAt: input.updatedAt ?? now,
      };
      entries.set(entry.deviceId, entry);
      return entry;
    },
    async remove(deviceId) {
      entries.delete(deviceId);
    },
  };
}

function mockDaemonApiResponse(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname;
  const build = {
    version: "0.0.0",
    commit: "local",
    shortCommit: "local",
    dirty: false,
    source: "package",
  };
  if (path === "/status") {
    return Response.json({
      ok: true,
      version: "0.0.0",
      build,
      label: "Remote PC",
      workspaceRoots: ["C:\\Users\\darkh\\Projects"],
      diagnostics: {
        approvalsHookEnabled: true,
        pendingApprovals: 0,
      },
      behaviors: [{ instanceId: "remote-claude", packageName: "remote-claude", version: "0.0.1" }],
    });
  }
  if (path === "/network/status") {
    return Response.json({
      scope: "device",
      generatedAt: new Date(0).toISOString(),
      tailscale: {
        detected: true,
        addresses: [{ kind: "tailscale", address: "100.64.1.44", label: "tailscale" }],
        interfaceNames: ["Tailscale"],
      },
      addresses: [{ kind: "tailscale", address: "100.64.1.44", label: "tailscale" }],
      probes: [],
      summary: { severity: "ok", message: "network ready" },
    });
  }
  if (path === "/install/status") {
    return Response.json({
      scope: "device",
      build,
      installed: true,
      running: true,
      autostart: { supported: true, installed: true, taskName: "DeskRelay Connector" },
      summary: { severity: "ok", message: "installed" },
    });
  }
  if (path === "/security/boundary") {
    return Response.json({
      scope: "device",
      generatedAt: new Date(0).toISOString(),
      tokenBoundary: {
        daemonTokenAvailable: true,
        browserReceivesDaemonToken: false,
      },
      networkBoundary: {
        url: "http://daemon.test:18091",
        kind: "tailscale",
        publicExposure: false,
      },
      warnings: [],
      summary: { severity: "ok", message: "private" },
    });
  }
  if (path === "/process/status") {
    return Response.json({
      scope: "device",
      kind: "connector",
      build,
      pid: 4321,
      startedAt: new Date(0).toISOString(),
      uptimeMs: 1000,
      platform: process.platform,
      arch: process.arch,
    });
  }
  if (path === "/events/spaces/remote-claude.default/stream") {
    return new Response('id: 1\ndata: {"ok":true}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  if (path === "/files/preview") {
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "4" },
    });
  }
  if (path === "/behaviors") {
    return Response.json([
      { instanceId: "remote-claude", name: "remote-claude", version: "0.0.1", loadedAt: "x" },
    ]);
  }
  if (path === "/behaviors/remote-claude/request") {
    return Response.json({
      result: { sessionId: "smoke-session", cwd: "C:\\Users\\darkh\\Projects", events: [] },
    });
  }
  if (path === "/capabilities") {
    return Response.json({ apiVersion: "1", features: ["manager"] });
  }
  if (path === "/logs") {
    return Response.json({ scope: "device", source: "connector", lines: ["ready"] });
  }
  if (path === "/fs/list") {
    return Response.json({ path: url.searchParams.get("path") ?? "", entries: [] });
  }
  if (path === "/fs/roots") {
    return Response.json({ roots: ["C:\\Users\\darkh\\Projects"] });
  }
  if (path === "/git/status") {
    return Response.json({ cwd: url.searchParams.get("cwd") ?? "", branch: "main", dirty: false });
  }
  if (path === "/instructions") {
    return Response.json({ cwd: url.searchParams.get("cwd") ?? null, sources: [] });
  }
  if (path.startsWith("/instructions/")) {
    return Response.json({
      ok: true,
      scope: path.split("/").at(-1),
      exists: req.method !== "DELETE",
    });
  }
  if (path === "/system/update") {
    return Response.json({ ok: true, state: "running" });
  }
  if (path === "/system/uninstall") {
    return Response.json({ ok: true, removed: true });
  }
  return Response.json({ ok: true, path, method: req.method });
}

let setup: MockSetup;

beforeEach(() => {
  setup = makeApp();
});

describe("/healthz (unauth)", () => {
  test("reports ok + device count", async () => {
    const res = await setup.app.fetch(new Request("http://site.local/healthz"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      version: string;
      devices: number;
      build?: { version?: string; shortCommit?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.0.0");
    expect(body.devices).toBe(0);
    expect(body.build?.version).toBe("0.0.0");
    expect(typeof body.build?.shortCommit).toBe("string");
  });
});

describe("/api/* auth gate", () => {
  test("unauth /api/devices returns 401", async () => {
    const res = await setup.app.fetch(new Request("http://site.local/api/devices"));
    expect(res.status).toBe(401);
  });

  test("authed /api/devices succeeds", async () => {
    const res = await setup.app.fetch(authedRequest("GET", "/api/devices"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("authed /api/capabilities reports manager routes", async () => {
    const res = await setup.app.fetch(authedRequest("GET", "/api/capabilities"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scope?: string;
      features?: string[];
      routes?: Array<{ method: string; path: string }>;
    };
    expect(body.scope).toBe("server");
    expect(body.features).toContain("process.restart");
    expect(body.features).toContain("manager.system-summary");
    expect(body.routes?.some((route) => route.path === "/api/devices/:id/process/restart")).toBe(
      true,
    );
    expect(body.routes?.some((route) => route.path === "/api/manager/update/status")).toBe(true);
    const routeKeys = new Set(
      body.routes?.map((route) => `${route.method} ${route.path}`).sort() ?? [],
    );
    expect([...routeKeys].sort()).toEqual(siteAppRouteInventory());
  });
});

describe("API route inventory", () => {
  test("every declared site API route has smoke coverage", async () => {
    const registry = new InMemoryDeviceRegistry();
    const managerTaskStore = createInMemoryManagerTaskStore();
    const deviceUpdateQueue = createMemoryUpdateQueueStore();
    const logDir = mkdtempSync(join(tmpdir(), "deskrelay-api-smoke-"));
    const calls: MockDaemonCall[] = [];
    const installReports: unknown[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
          headers[key] = value;
        }
      }
      calls.push({
        method: init?.method ?? "GET",
        url,
        headers,
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      return mockDaemonApiResponse(new Request(url, init));
    }) as typeof fetch;

    writeFileSync(join(logDir, "site-backend.log"), "info: backend ready\n", "utf8");
    writeFileSync(join(logDir, "site-frontend.log"), "info: frontend ready\n", "utf8");
    writeFileSync(join(logDir, "daemon.log"), "info: daemon ready\n", "utf8");

    const app = createSiteApp({
      registry,
      token: TOKEN,
      fetchImpl,
      localDaemonToken: "daemon-token",
      selfHostUrl: "http://100.64.1.2:18193",
      logDir,
      managerTaskStore,
      deviceUpdateQueue,
      installReportStore: {
        async list(limit = 10) {
          return installReports.slice(0, limit) as never;
        },
        async add(input) {
          const report = {
            id: `install_${installReports.length + 1}`,
            receivedAt: new Date(0).toISOString(),
            status: "succeeded",
            label: "Remote PC",
            server: "http://100.64.1.2:18193",
            steps: [],
            input,
          };
          installReports.unshift(report);
          return report as never;
        },
      },
      selfServerAutostart: {
        async status() {
          return { supported: true, installed: false, taskName: "DeskRelay Self Server" };
        },
        async setEnabled(enabled) {
          return { supported: true, installed: enabled, taskName: "DeskRelay Self Server" };
        },
      },
      selfServerProcess: {
        async status() {
          return {
            scope: "server",
            kind: "site-server",
            build: {
              version: "0.0.0",
              commit: "local",
              shortCommit: "local",
              dirty: false,
              source: "package",
            },
            pid: 1234,
            startedAt: new Date(0).toISOString(),
            uptimeMs: 1000,
            platform: process.platform,
            arch: process.arch,
          };
        },
        async restart() {
          return { supported: true, accepted: true, message: "restart accepted", pid: 1235 };
        },
      },
      selfServerUpdater: {
        async status() {
          return { state: "idle", updateAvailable: false };
        },
        async update() {
          return { supported: true, started: true, pid: 1236, status: { state: "running" } };
        },
      },
      build: {
        version: "0.0.0",
        commit: "local",
        shortCommit: "local",
        dirty: false,
        source: "package",
      },
      managerAssistant: { cwd: logDir },
    });

    const coveredRoutes = new Set<string>();
    const failures: string[] = [];
    const assertRoute = async (
      key: string,
      request: Request,
      expectedStatuses: number[] = [200],
    ): Promise<Response> => {
      coveredRoutes.add(key);
      const res = await app.fetch(request);
      if (!expectedStatuses.includes(res.status)) {
        failures.push(`${key} returned ${res.status}: ${await res.clone().text()}`);
      }
      return res;
    };

    try {
      await assertRoute("GET /healthz", new Request("http://site.local/healthz"));
      await assertRoute("GET /api/announcement", new Request("http://site.local/api/announcement"));
      await assertRoute("GET /api/capabilities", authedRequest("GET", "/api/capabilities"));

      const registerRes = await assertRoute(
        "POST /api/devices",
        authedRequest("POST", "/api/devices", {
          daemonUrl: DAEMON_URL,
          authToken: "daemon-token",
          label: "Remote PC",
        }),
        [201],
      );
      const registered = (await registerRes.json()) as { id: string };
      const deviceId = registered.id;

      const pendingTask = await managerTaskStore.create({
        kind: "update-server",
        dryRun: true,
        requestedBy: "browser",
        steps: [],
      });
      const failedTask = await managerTaskStore.create({
        kind: "diagnose",
        dryRun: true,
        requestedBy: "browser",
        steps: [],
      });
      await managerTaskStore.update(failedTask.id, {
        state: "failed",
        error: "synthetic failure",
      });

      const smokeRoutes: Array<[string, Request, number[]?]> = [
        ["GET /api/manager/tasks", authedRequest("GET", "/api/manager/tasks?limit=5")],
        [
          "POST /api/manager/tasks",
          authedRequest("POST", "/api/manager/tasks", {
            kind: "diagnose",
            dryRun: true,
            requestedBy: "browser",
          }),
          [202],
        ],
        [
          "GET /api/manager/tasks/:id/logs",
          authedRequest("GET", `/api/manager/tasks/${pendingTask.id}/logs`),
        ],
        [
          "GET /api/manager/tasks/:id/observe",
          authedRequest("GET", `/api/manager/tasks/${pendingTask.id}/observe`),
        ],
        [
          "GET /api/manager/tasks/:id/stream",
          authedRequest("GET", `/api/manager/tasks/${failedTask.id}/stream`),
        ],
        [
          "POST /api/manager/tasks/:id/cancel",
          authedRequest("POST", `/api/manager/tasks/${pendingTask.id}/cancel`),
          [202],
        ],
        [
          "POST /api/manager/tasks/:id/retry",
          authedRequest("POST", `/api/manager/tasks/${failedTask.id}/retry`),
          [202],
        ],
        [
          "POST /api/manager/tasks/:id/acknowledge",
          authedRequest("POST", `/api/manager/tasks/${failedTask.id}/acknowledge`, {
            reason: "route inventory",
          }),
        ],
        [
          "GET /api/manager/tasks/:id",
          authedRequest("GET", `/api/manager/tasks/${pendingTask.id}`),
        ],
        ["GET /api/manager/audit-log", authedRequest("GET", "/api/manager/audit-log?limit=5")],
        ["GET /api/manager/system/summary", authedRequest("GET", "/api/manager/system/summary")],
        [
          "GET /api/manager/assistant/workspace",
          authedRequest("GET", "/api/manager/assistant/workspace"),
        ],
        [
          "GET /api/manager/assistant/conversation",
          authedRequest("GET", "/api/manager/assistant/conversation"),
        ],
        [
          "PUT /api/manager/assistant/conversation",
          authedRequest("PUT", "/api/manager/assistant/conversation", {
            sessionId: "smoke-manager-session",
            cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          }),
        ],
        [
          "GET /api/manager/assistant/status",
          authedRequest("GET", "/api/manager/assistant/status"),
        ],
        [
          "POST /api/manager/assistant/status",
          authedRequest("POST", "/api/manager/assistant/status", {
            message: "Inventory smoke report.",
          }),
          [201],
        ],
        ["GET /api/manager/state", authedRequest("GET", "/api/manager/state")],
        [
          "POST /api/manager/state/acknowledge",
          authedRequest("POST", "/api/manager/state/acknowledge", { reason: "route inventory" }),
        ],
        [
          "GET /api/manager/events/recent",
          authedRequest("GET", "/api/manager/events/recent?afterSeq=0"),
        ],
        [
          "POST /api/manager/sessions/read",
          authedRequest("POST", "/api/manager/sessions/read", {
            deviceId,
            sessionId: "smoke-session",
            cwd: "C:\\Users\\darkh\\Projects",
          }),
        ],
        [
          "GET /api/manager/sessions/hygiene",
          authedRequest("GET", "/api/manager/sessions/hygiene"),
        ],
        [
          "POST /api/manager/sessions/hygiene/cleanup",
          authedRequest("POST", "/api/manager/sessions/hygiene/cleanup", { dryRun: true }),
        ],
        [
          "POST /api/manager/assistant/chat",
          authedRequest("POST", "/api/manager/assistant/chat", {}),
          [400],
        ],
        [
          "POST /api/manager/assistant/chat/stream",
          authedRequest("POST", "/api/manager/assistant/chat/stream", {}),
          [400],
        ],
        ["GET /api/manager/workers", authedRequest("GET", "/api/manager/workers")],
        ["GET /api/manager/workers/:id", authedRequest("GET", "/api/manager/workers/claude-code")],
        [
          "POST /api/manager/workers/:id/check",
          authedRequest("POST", "/api/manager/workers/claude-code/check"),
        ],
        [
          "POST /api/manager/workers/run",
          authedRequest("POST", "/api/manager/workers/run", {
            profile: "claude-code",
            prompt: "Say hello.",
            dryRun: true,
            requestedBy: "browser",
          }),
          [202],
        ],
        ["GET /api/manager/agents", authedRequest("GET", "/api/manager/agents")],
        [
          "POST /api/manager/agents",
          authedRequest("POST", "/api/manager/agents", {
            role: "critic",
            profile: "claude-code",
          }),
          [201],
        ],
        ["GET /api/manager/agents/:id", authedRequest("GET", "/api/manager/agents/missing"), [404]],
        [
          "POST /api/manager/agents/:id/message",
          authedRequest("POST", "/api/manager/agents/missing/message", {
            prompt: "Say hello.",
          }),
          [404],
        ],
        [
          "POST /api/manager/agents/:id/stop",
          authedRequest("POST", "/api/manager/agents/missing/stop"),
          [404],
        ],
        [
          "POST /api/manager/agents/:id/acknowledge",
          authedRequest("POST", "/api/manager/agents/missing/acknowledge"),
          [404],
        ],
        ["GET /api/manager/rounds", authedRequest("GET", "/api/manager/rounds")],
        [
          "POST /api/manager/rounds",
          authedRequest("POST", "/api/manager/rounds", {
            objective: "Smoke orchestration route.",
          }),
          [201],
        ],
        [
          "POST /api/manager/rounds/:id/dispatch",
          authedRequest("POST", "/api/manager/rounds/missing/dispatch", {}),
          [404],
        ],
        [
          "GET /api/manager/rounds/:id/report",
          authedRequest("GET", "/api/manager/rounds/missing/report"),
          [404],
        ],
        [
          "POST /api/manager/rounds/:id/acknowledge",
          authedRequest("POST", "/api/manager/rounds/missing/acknowledge"),
          [404],
        ],
        [
          "GET /api/manager/devices/:id/actions",
          authedRequest("GET", `/api/manager/devices/${deviceId}/actions`),
        ],
        ["GET /api/manager/update/plan", authedRequest("GET", "/api/manager/update/plan")],
        ["GET /api/manager/update/status", authedRequest("GET", "/api/manager/update/status")],
        [
          "POST /api/manager/update/all",
          authedRequest("POST", "/api/manager/update/all", {
            dryRun: true,
            requestedBy: "browser",
          }),
          [202],
        ],
        [
          "GET /api/manager/registration/last-failure",
          authedRequest("GET", "/api/manager/registration/last-failure"),
        ],
        [
          "GET /api/manager/registration/diagnose",
          authedRequest("GET", "/api/manager/registration/diagnose"),
        ],
        [
          "POST /api/manager/registration/repair",
          authedRequest("POST", "/api/manager/registration/repair", {
            dryRun: true,
            requestedBy: "browser",
          }),
          [202, 409],
        ],
        [
          "GET /api/manager/security/boundary",
          authedRequest("GET", "/api/manager/security/boundary"),
        ],
        ["GET /api/devices", authedRequest("GET", "/api/devices")],
        ["GET /api/devices/update-queue", authedRequest("GET", "/api/devices/update-queue")],
        [
          "GET /api/self/register-other-pc-command",
          authedRequest("GET", "/api/self/register-other-pc-command"),
        ],
        [
          "GET /api/self/remove-other-pc-command",
          authedRequest("GET", "/api/self/remove-other-pc-command"),
        ],
        ["GET /api/self/doctor", authedRequest("GET", "/api/self/doctor")],
        ["GET /api/self/logs", authedRequest("GET", "/api/self/logs?source=server&tail=5")],
        ["GET /api/self/process/status", authedRequest("GET", "/api/self/process/status")],
        [
          "POST /api/self/process/restart",
          authedRequest("POST", "/api/self/process/restart"),
          [202],
        ],
        ["GET /api/self/network/status", authedRequest("GET", "/api/self/network/status")],
        ["GET /api/self/install/status", authedRequest("GET", "/api/self/install/status")],
        ["GET /api/self/security/boundary", authedRequest("GET", "/api/self/security/boundary")],
        ["GET /api/self/autostart", authedRequest("GET", "/api/self/autostart")],
        ["PUT /api/self/autostart", authedRequest("PUT", "/api/self/autostart", { enabled: true })],
        ["POST /api/self/update", authedRequest("POST", "/api/self/update"), [202]],
        ["GET /api/self/update/status", authedRequest("GET", "/api/self/update/status")],
        ["GET /api/self/install-reports", authedRequest("GET", "/api/self/install-reports")],
        [
          "POST /api/self/install-reports",
          authedRequest("POST", "/api/self/install-reports", {
            status: "succeeded",
            label: "Remote PC",
            steps: [],
          }),
          [201],
        ],
        [
          "PATCH /api/devices/:id",
          authedRequest("PATCH", `/api/devices/${deviceId}`, { label: "Renamed PC" }),
        ],
        [
          "GET /api/devices/:id/behaviors",
          authedRequest("GET", `/api/devices/${deviceId}/behaviors`),
        ],
        [
          "GET /api/devices/:id/capabilities",
          authedRequest("GET", `/api/devices/${deviceId}/capabilities`),
        ],
        [
          "GET /api/devices/:id/logs",
          authedRequest("GET", `/api/devices/${deviceId}/logs?source=connector&tail=5`),
        ],
        [
          "GET /api/devices/:id/process/status",
          authedRequest("GET", `/api/devices/${deviceId}/process/status`),
        ],
        [
          "POST /api/devices/:id/process/restart",
          authedRequest("POST", `/api/devices/${deviceId}/process/restart`, {}),
        ],
        [
          "GET /api/devices/:id/network/status",
          authedRequest("GET", `/api/devices/${deviceId}/network/status`),
        ],
        [
          "GET /api/devices/:id/install/status",
          authedRequest("GET", `/api/devices/${deviceId}/install/status`),
        ],
        [
          "GET /api/devices/:id/security/boundary",
          authedRequest("GET", `/api/devices/${deviceId}/security/boundary`),
        ],
        [
          "POST /api/devices/:id/behaviors/load",
          authedRequest("POST", `/api/devices/${deviceId}/behaviors/load`, {
            packageDir: "remote-claude",
          }),
        ],
        [
          "DELETE /api/devices/:id/behaviors/:instance",
          authedRequest("DELETE", `/api/devices/${deviceId}/behaviors/remote-claude`),
        ],
        [
          "POST /api/devices/:id/behaviors/:instance/request",
          authedRequest("POST", `/api/devices/${deviceId}/behaviors/remote-claude/request`, {
            method: "ping",
            params: {},
          }),
        ],
        [
          "GET /api/devices/:id/events/spaces/:spaceId/stream",
          authedRequest(
            "GET",
            `/api/devices/${deviceId}/events/spaces/${encodeURIComponent("remote-claude.default")}/stream`,
          ),
        ],
        [
          "GET /api/devices/:id/fs/list",
          authedRequest(
            "GET",
            `/api/devices/${deviceId}/fs/list?path=${encodeURIComponent("C:\\Users")}&workspaceScope=unrestricted`,
          ),
        ],
        [
          "POST /api/devices/:id/fs/mkdir",
          authedRequest("POST", `/api/devices/${deviceId}/fs/mkdir`, {
            path: "C:\\Users\\darkh\\Projects\\new",
          }),
        ],
        [
          "GET /api/devices/:id/fs/roots",
          authedRequest("GET", `/api/devices/${deviceId}/fs/roots`),
        ],
        [
          "GET /api/devices/:id/files/preview",
          authedRequest(
            "GET",
            `/api/devices/${deviceId}/files/preview?path=${encodeURIComponent("shot.png")}&cwd=${encodeURIComponent(
              "C:\\repo",
            )}`,
          ),
        ],
        [
          "GET /api/devices/:id/git/status",
          authedRequest(
            "GET",
            `/api/devices/${deviceId}/git/status?cwd=${encodeURIComponent("C:\\repo")}`,
          ),
        ],
        [
          "GET /api/devices/:id/instructions",
          authedRequest(
            "GET",
            `/api/devices/${deviceId}/instructions?cwd=${encodeURIComponent("C:\\repo")}`,
          ),
        ],
        [
          "PUT /api/devices/:id/instructions/:scope",
          authedRequest("PUT", `/api/devices/${deviceId}/instructions/project`, {
            cwd: "C:\\repo",
            content: "rules",
          }),
        ],
        [
          "DELETE /api/devices/:id/instructions/:scope",
          authedRequest("DELETE", `/api/devices/${deviceId}/instructions/local`, {
            cwd: "C:\\repo",
          }),
        ],
        [
          "GET /api/devices/:id/diagnostics",
          authedRequest("GET", `/api/devices/${deviceId}/diagnostics`),
        ],
        [
          "POST /api/devices/:id/system/update",
          authedRequest("POST", `/api/devices/${deviceId}/system/update`),
        ],
        ["GET /api/devices/:id/doctor", authedRequest("GET", `/api/devices/${deviceId}/doctor`)],
        [
          "POST /api/devices/:id/approvals/respond",
          authedRequest("POST", `/api/devices/${deviceId}/approvals/respond`, {
            decision: "allow",
          }),
        ],
        [
          "POST /api/devices/:id/approvals/simulate",
          authedRequest("POST", `/api/devices/${deviceId}/approvals/simulate`, {
            tool: "Read",
          }),
        ],
      ];

      for (const [key, request, statuses] of smokeRoutes) {
        await assertRoute(key, request, statuses);
      }
      const managerEventStream = await assertRoute(
        "GET /api/manager/events/stream",
        authedRequest("GET", "/api/manager/events/stream?afterSeq=0"),
      );
      await managerEventStream.body?.cancel();

      registry.register({
        daemonUrl: "http://daemon-2.test:18091",
        label: "Second PC",
        authToken: "daemon-token",
      });
      await assertRoute(
        "DELETE /api/devices/:id",
        authedRequest("DELETE", `/api/devices/${deviceId}`),
      );
      await assertRoute("DELETE /api/devices", authedRequest("DELETE", "/api/devices"));

      expect(failures).toEqual([]);
      expect([...coveredRoutes].sort()).toEqual(siteAppRouteInventory());
      expect(calls.some((call) => call.url.endsWith("/hooks/pretooluse/respond"))).toBe(true);
      expect(calls.some((call) => call.url.endsWith("/fs/mkdir"))).toBe(true);
      expect(calls.some((call) => call.url.endsWith("/git/status?cwd=C%3A%5Crepo"))).toBe(true);
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});

describe("manager logs and process APIs", () => {
  test("GET /api/self/logs tails server log files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deskrelay-site-log-"));
    writeFileSync(join(dir, "site-backend.log"), "one\ntwo\nthree\n", "utf8");
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      logDir: dir,
    });
    try {
      const res = await app.fetch(authedRequest("GET", "/api/self/logs?tail=2"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { exists?: boolean; lines?: string[] };
      expect(body.exists).toBe(true);
      expect(body.lines).toEqual(["two", "three"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("GET /api/self/process/status and POST /api/self/process/restart use controller", async () => {
    let restartCalls = 0;
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      selfServerProcess: {
        async status() {
          return {
            scope: "server",
            kind: "site-server",
            build: {
              version: "0.0.0",
              commit: "abc",
              shortCommit: "abc",
              dirty: false,
              source: "env",
            },
            pid: 123,
            startedAt: "2026-05-11T00:00:00.000Z",
            uptimeMs: 1000,
            platform: process.platform,
            arch: process.arch,
          };
        },
        async restart() {
          restartCalls += 1;
          return { supported: true, accepted: true, message: "restart accepted", pid: 456 };
        },
      },
    });

    const status = await app.fetch(authedRequest("GET", "/api/self/process/status"));
    expect(status.status).toBe(200);
    expect((await status.json()).pid).toBe(123);

    const restart = await app.fetch(authedRequest("POST", "/api/self/process/restart"));
    expect(restart.status).toBe(202);
    expect(restartCalls).toBe(1);
    expect(await restart.json()).toEqual({
      supported: true,
      accepted: true,
      message: "restart accepted",
      pid: 456,
    });
  });

  test("GET /api/self/network/status, install/status, and security/boundary expose manager summaries", async () => {
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      selfHostUrl: "http://100.64.0.10:18193",
      selfServerProcess: {
        async status() {
          return {
            scope: "server",
            kind: "site-server",
            build: {
              version: "0.0.0",
              commit: "abc",
              shortCommit: "abc",
              dirty: false,
              source: "env",
            },
            pid: 123,
            startedAt: "2026-05-11T00:00:00.000Z",
            uptimeMs: 1000,
            platform: process.platform,
            arch: process.arch,
          };
        },
        async restart() {
          return { supported: true, accepted: true, message: "restart accepted" };
        },
      },
    });

    const network = await app.fetch(authedRequest("GET", "/api/self/network/status"));
    expect(network.status).toBe(200);
    const networkBody = (await network.json()) as {
      scope?: string;
      preferredUrl?: string;
      tailscale?: { addresses?: string[] };
    };
    expect(networkBody.scope).toBe("server");
    expect(networkBody.preferredUrl).toBe("http://100.64.0.10:18193");
    expect(Array.isArray(networkBody.tailscale?.addresses)).toBe(true);

    const install = await app.fetch(authedRequest("GET", "/api/self/install/status"));
    expect(install.status).toBe(200);
    const installBody = (await install.json()) as { scope?: string; running?: boolean };
    expect(installBody.scope).toBe("server");
    expect(installBody.running).toBe(true);

    const security = await app.fetch(authedRequest("GET", "/api/self/security/boundary"));
    expect(security.status).toBe(200);
    const securityBody = (await security.json()) as {
      tokenBoundary?: { siteTokenConfigured?: boolean; browserReceivesDaemonToken?: boolean };
      networkBoundary?: { kind?: string };
    };
    expect(securityBody.tokenBoundary?.siteTokenConfigured).toBe(true);
    expect(securityBody.tokenBoundary?.browserReceivesDaemonToken).toBe(false);
    expect(securityBody.networkBoundary?.kind).toBe("tailscale");
  });

  test("device manager APIs proxy to the selected daemon", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "test",
    });
    setup.setMockResponse((req) => Response.json({ upstream: new URL(req.url).pathname }));

    const caps = await setup.app.fetch(
      authedRequest("GET", `/api/devices/${device.id}/capabilities`),
    );
    expect(caps.status).toBe(200);
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/capabilities`);
    expect(setup.calls.at(-1)?.headers.authorization).toBe("Bearer daemon-token");

    const logs = await setup.app.fetch(
      authedRequest("GET", `/api/devices/${device.id}/logs?tail=3&level=error`),
    );
    expect(logs.status).toBe(200);
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/logs?source=connector&tail=3&level=error`);

    const status = await setup.app.fetch(
      authedRequest("GET", `/api/devices/${device.id}/process/status`),
    );
    expect(status.status).toBe(200);
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/process/status`);

    const restart = await setup.app.fetch(
      authedRequest("POST", `/api/devices/${device.id}/process/restart`),
    );
    expect(restart.status).toBe(200);
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/process/restart`);
  });

  test("device network/install/security manager APIs enrich daemon responses", async () => {
    const device = setup.registry.register({
      daemonUrl: "http://100.64.0.50:18091",
      authToken: "daemon-token",
      label: "remote",
    });
    setup.setMockResponse((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/network/status") {
        return Response.json({
          scope: "device",
          generatedAt: "2026-05-11T00:00:00.000Z",
          tailscale: { detected: true, addresses: ["100.64.0.50"], interfaceNames: ["Tailscale"] },
          addresses: [],
          probes: [],
          summary: { severity: "ok", message: "ok" },
        });
      }
      if (path === "/install/status") {
        return Response.json({
          scope: "device",
          generatedAt: "2026-05-11T00:00:00.000Z",
          build: {
            version: "0.0.0",
            commit: "abc",
            shortCommit: "abc",
            dirty: false,
            source: "env",
          },
          installed: true,
          running: true,
          summary: { severity: "ok", message: "ok" },
        });
      }
      if (path === "/security/boundary") {
        return Response.json({
          scope: "device",
          generatedAt: "2026-05-11T00:00:00.000Z",
          tokenBoundary: { daemonTokenAvailable: true, browserReceivesDaemonToken: false },
          networkBoundary: { kind: "tailscale", publicExposure: false },
          workspaceBoundary: { mode: "restricted", roots: ["C:\\Projects"], unrestricted: false },
          warnings: [],
          summary: { severity: "ok", message: "ok" },
        });
      }
      return Response.json({ ok: true });
    });

    const network = await setup.app.fetch(
      authedRequest("GET", `/api/devices/${device.id}/network/status`),
    );
    expect(network.status).toBe(200);
    const networkBody = (await network.json()) as {
      targetId?: string;
      registeredUrl?: string;
      probes?: Array<{ id?: string }>;
    };
    expect(networkBody.targetId).toBe(device.id);
    expect(networkBody.registeredUrl).toBe("http://100.64.0.50:18091");
    expect(
      networkBody.probes?.some((probe) => probe.id === "server-to-device.network-status"),
    ).toBe(true);

    const install = await setup.app.fetch(
      authedRequest("GET", `/api/devices/${device.id}/install/status`),
    );
    expect(install.status).toBe(200);
    expect(((await install.json()) as { targetLabel?: string }).targetLabel).toBe("remote");

    const security = await setup.app.fetch(
      authedRequest("GET", `/api/devices/${device.id}/security/boundary`),
    );
    expect(security.status).toBe(200);
    const securityBody = (await security.json()) as {
      networkBoundary?: { kind?: string };
      tokenBoundary?: { browserReceivesDaemonToken?: boolean };
    };
    expect(securityBody.networkBoundary?.kind).toBe("tailscale");
    expect(securityBody.tokenBoundary?.browserReceivesDaemonToken).toBe(false);
  });
});

describe("manager task API", () => {
  test("dry-run update-device creates an auditable task without touching daemon", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "test",
    });
    const res = await setup.app.fetch(
      authedRequest("POST", "/api/manager/tasks", {
        kind: "update-device",
        targetId: device.id,
        requestedBy: "manager-assistant",
      }),
    );
    expect(res.status).toBe(202);
    const task = (await res.json()) as {
      id?: string;
      state?: string;
      dryRun?: boolean;
      targetLabel?: string;
    };
    expect(task.state).toBe("succeeded");
    expect(task.dryRun).toBe(true);
    expect(task.targetLabel).toBe("test");
    expect(setup.calls).toHaveLength(0);

    const listed = await setup.app.fetch(authedRequest("GET", "/api/manager/tasks"));
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { tasks?: unknown[] }).tasks).toHaveLength(1);

    const audit = await setup.app.fetch(authedRequest("GET", "/api/manager/audit-log"));
    expect(audit.status).toBe(200);
    expect(((await audit.json()) as { entries?: unknown[] }).entries).toHaveLength(1);
  });

  test("unknown target device blocks device tasks", async () => {
    const res = await setup.app.fetch(
      authedRequest("POST", "/api/manager/tasks", {
        kind: "restart-device",
        targetId: "missing-device",
        dryRun: false,
      }),
    );
    expect(res.status).toBe(409);
    const task = (await res.json()) as { state?: string; error?: string };
    expect(task.state).toBe("blocked");
    expect(task.error).toContain("unknown device");
  });

  test("manager assistant chat runs in the server repo folder", async () => {
    const cwd = join(tmpdir(), "deskrelay-assistant-test");
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: {
        cwd,
        runner: async (input) => ({
          command: "fake-claude -p",
          text: `cwd=${input.cwd}; message=${input.message}; history=${input.history.length}; context=${input.context?.sessionId ?? "none"}`,
        }),
      },
    });

    const res = await app.fetch(
      authedRequest("POST", "/api/manager/assistant/chat", {
        message: "상태 알려줘",
        context: {
          deviceId: "dev_1",
          deviceLabel: "HOMEDEV (Server)",
          deviceConnectionState: "online",
          sessionId: "session_1",
          sessionTitle: "선택된 대화",
          cwd: "C:\\repo",
        },
        history: [
          {
            id: "m1",
            role: "assistant",
            text: "준비됨",
            createdAt: "2026-05-11T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cwd?: string;
      command?: string;
      message?: { role?: string; text?: string };
    };
    expect(body.cwd).toBe(cwd);
    expect(body.command).toBe("fake-claude -p");
    expect(body.message?.role).toBe("assistant");
    expect(body.message?.text).toContain("cwd=");
    expect(body.message?.text).toContain("message=상태 알려줘");
    expect(body.message?.text).toContain("history=1");
    expect(body.message?.text).toContain("context=session_1");
  });

  test("manager assistant progress reports are stored for the UI", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-status-"));
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        managerAssistant: { cwd },
      });

      const write = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/status", {
          phase: "acting",
          level: "info",
          round: "R8",
          scope: "orchestration",
          message: "Worker fallback is running.",
          detail: "Next: verify note files.",
        }),
      );
      expect(write.status).toBe(201);
      const written = (await write.json()) as { latest?: { message?: string; round?: string } };
      expect(written.latest?.message).toBe("Worker fallback is running.");
      expect(written.latest?.round).toBe("R8");

      const read = await app.fetch(authedRequest("GET", "/api/manager/assistant/status"));
      expect(read.status).toBe(200);
      const body = (await read.json()) as { reports?: Array<{ message?: string }> };
      expect(body.reports?.[0]?.message).toBe("Worker fallback is running.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager state view surfaces stale worker tasks", async () => {
    const oldNow = () => new Date("2020-01-01T00:00:00.000Z");
    const managerTaskStore = createInMemoryManagerTaskStore({ now: oldNow });
    const managerOrchestrationStore = createInMemoryManagerOrchestrationStore({ now: oldNow });
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerTaskStore,
      managerOrchestrationStore,
      managerAssistant: { cwd: mkdtempSync(join(tmpdir(), "deskrelay-manager-state-")) },
    });

    expect((await app.fetch(authedRequest("GET", "/api/manager/tasks"))).status).toBe(200);

    const round = await managerOrchestrationStore.createRound({
      objective: "Verify stale worker visibility.",
      title: "R-stale",
    });
    const agent = await managerOrchestrationStore.createAgent({
      role: "verifier",
      label: "Verifier",
      roundId: round.id,
    });
    const task = await managerTaskStore.create({
      kind: "run-worker",
      dryRun: true,
      requestedBy: "manager-assistant",
      params: { timeoutMs: 600_000 },
      steps: [],
    });
    await managerTaskStore.update(task.id, {
      state: "running",
      startedAt: oldNow().toISOString(),
    });
    await managerOrchestrationStore.updateAgent(agent.id, {
      status: "running",
      taskId: task.id,
    });
    await managerOrchestrationStore.updateRound(round.id, {
      status: "running",
      agentIds: [agent.id],
      taskIds: [task.id],
    });

    const res = await app.fetch(authedRequest("GET", "/api/manager/state"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: { tone?: string; source?: string; message?: string };
      current?: { status?: string; actions?: string[]; taskId?: string };
      freshness?: { source?: string; stale?: boolean; lastSignalAt?: string };
      staleTasks?: Array<{ id?: string; stale?: boolean }>;
      activeRound?: { id?: string };
    };
    expect(body.status?.tone).toBe("warning");
    expect(body.status?.source).toBe("task");
    expect(body.status?.message).toContain("needs attention");
    expect(body.current?.status).toBe("stale");
    expect(body.current?.taskId).toBe(task.id);
    expect(body.current?.actions).toContain("refresh");
    expect(body.current?.actions).toContain("acknowledge");
    expect(body.freshness?.source).toBe("poll");
    expect(body.freshness?.stale).toBe(false);
    expect(body.freshness?.lastSignalAt).toBeTruthy();
    expect(body.staleTasks?.[0]?.id).toBe(task.id);
    expect(body.staleTasks?.[0]?.stale).toBe(true);
    expect(body.activeRound?.id).toBe(round.id);
  });

  test("manager state acknowledgement clears old failures without deleting history", async () => {
    const managerTaskStore = createInMemoryManagerTaskStore();
    const managerOrchestrationStore = createInMemoryManagerOrchestrationStore();
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerTaskStore,
      managerOrchestrationStore,
    });

    const round = await managerOrchestrationStore.createRound({
      title: "R-failed",
      objective: "Exercise acknowledgement hygiene.",
    });
    const agent = await managerOrchestrationStore.createAgent({
      role: "verifier",
      label: "Verifier",
      roundId: round.id,
    });
    const task = await managerTaskStore.create({
      kind: "run-worker",
      dryRun: true,
      requestedBy: "manager-assistant",
      params: { agentId: agent.id, roundId: round.id },
      steps: [],
    });
    await managerTaskStore.update(task.id, {
      state: "failed",
      error: "synthetic worker failure",
      completedAt: new Date(0).toISOString(),
    });
    await managerOrchestrationStore.updateAgent(agent.id, {
      status: "failed",
      taskId: task.id,
      lastError: "synthetic worker failure",
    });
    await managerOrchestrationStore.updateRound(round.id, {
      status: "failed",
      agentIds: [agent.id],
      taskIds: [task.id],
      error: "round failed",
    });

    const before = await app.fetch(authedRequest("GET", "/api/manager/state"));
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as {
      status?: { tone?: string };
      current?: { status?: string; actions?: string[]; taskId?: string };
      counts?: { blockers?: number; blockedAgents?: number; failedTasks?: number };
    };
    expect(beforeBody.status?.tone).toBe("error");
    expect(beforeBody.current?.status).toBe("failed");
    expect(beforeBody.current?.taskId).toBe(task.id);
    expect(beforeBody.current?.actions).toContain("retry");
    expect(beforeBody.current?.actions).toContain("acknowledge");
    expect(beforeBody.counts?.blockers).toBeGreaterThanOrEqual(3);
    expect(beforeBody.counts?.blockedAgents).toBe(1);
    expect(beforeBody.counts?.failedTasks).toBe(1);

    const ack = await app.fetch(
      authedRequest("POST", "/api/manager/state/acknowledge", {
        reason: "operator reviewed stale failure",
      }),
    );
    expect(ack.status).toBe(200);
    const ackBody = (await ack.json()) as {
      tasks?: Array<{ id?: string; acknowledgedAt?: string; acknowledgedReason?: string }>;
      agents?: Array<{ id?: string; acknowledgedAt?: string }>;
      rounds?: Array<{ id?: string; acknowledgedAt?: string }>;
    };
    expect(ackBody.tasks?.[0]?.id).toBe(task.id);
    expect(typeof ackBody.tasks?.[0]?.acknowledgedAt).toBe("string");
    expect(ackBody.tasks?.[0]?.acknowledgedReason).toBe("operator reviewed stale failure");
    expect(ackBody.agents?.[0]?.id).toBe(agent.id);
    expect(ackBody.rounds?.[0]?.id).toBe(round.id);

    const after = await app.fetch(authedRequest("GET", "/api/manager/state"));
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as {
      status?: { tone?: string; message?: string };
      current?: { status?: string; actionable?: boolean; actions?: string[] };
      counts?: { blockers?: number; blockedAgents?: number; failedTasks?: number };
      blockers?: unknown[];
      recentRounds?: Array<{ id?: string; acknowledgedAt?: string }>;
      staleTasks?: unknown[];
    };
    expect(afterBody.status?.tone).toBe("idle");
    expect(afterBody.status?.message).toBe("Manager is ready");
    expect(afterBody.current?.status).toBe("idle");
    expect(afterBody.current?.actionable).toBe(false);
    expect(afterBody.current?.actions).toEqual([]);
    expect(afterBody.counts?.blockers).toBe(0);
    expect(afterBody.counts?.blockedAgents).toBe(0);
    expect(afterBody.counts?.failedTasks).toBe(0);
    expect(afterBody.blockers).toEqual([]);
    expect(afterBody.staleTasks).toEqual([]);
    expect(typeof afterBody.recentRounds?.[0]?.acknowledgedAt).toBe("string");

    const storedTask = await managerTaskStore.get(task.id);
    expect(storedTask?.state).toBe("failed");
    expect(typeof storedTask?.acknowledgedAt).toBe("string");
  });

  test("manager acknowledgement rejects active work", async () => {
    const managerTaskStore = createInMemoryManagerTaskStore();
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerTaskStore,
    });
    const task = await managerTaskStore.create({
      kind: "diagnose",
      dryRun: true,
      requestedBy: "browser",
      steps: [],
    });

    const ack = await app.fetch(
      authedRequest("POST", `/api/manager/tasks/${task.id}/acknowledge`, {
        reason: "should not be accepted",
      }),
    );
    expect(ack.status).toBe(409);
    expect((await managerTaskStore.get(task.id))?.acknowledgedAt).toBeUndefined();
  });

  test("manager event APIs replay and stream status changes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-manager-events-"));
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        managerAssistant: { cwd },
      });

      const write = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/status", {
          phase: "observing",
          level: "info",
          message: "Watching manager state.",
        }),
      );
      expect(write.status).toBe(201);

      const recent = await app.fetch(authedRequest("GET", "/api/manager/events/recent"));
      expect(recent.status).toBe(200);
      const recentBody = (await recent.json()) as {
        lastSeq?: number;
        events?: Array<{ type?: string; seq?: number }>;
      };
      expect(recentBody.events?.map((event) => event.type)).toEqual(["assistant.status"]);
      expect(recentBody.lastSeq).toBe(1);

      const emptyReplay = await app.fetch(
        authedRequest("GET", `/api/manager/events/recent?afterSeq=${recentBody.lastSeq}`),
      );
      expect(emptyReplay.status).toBe(200);
      expect(((await emptyReplay.json()) as { events?: unknown[] }).events).toEqual([]);

      const stream = await app.fetch(authedRequest("GET", "/api/manager/events/stream?afterSeq=0"));
      expect(stream.status).toBe(200);
      const reader = stream.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      let text = "";
      for (let i = 0; i < 3 && !text.includes("event: assistant.status"); i += 1) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      await reader?.cancel();
      expect(text).toContain("id: 1");
      expect(text).toContain("event: assistant.status");
      expect(text).toContain("Watching manager state.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager assistant conversation state persists the active Claude session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-conversation-"));
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        managerAssistant: { cwd },
      });

      const initial = await app.fetch(authedRequest("GET", "/api/manager/assistant/conversation"));
      expect(initial.status).toBe(200);
      expect(await initial.json()).toMatchObject({
        conversationId: "deskrelay-manager-assistant",
      });

      const update = await app.fetch(
        authedRequest("PUT", "/api/manager/assistant/conversation", {
          sessionId: "manager-session-42",
          cwd: join(cwd, ".deskrelay", "manager-assistant"),
        }),
      );
      expect(update.status).toBe(200);
      expect(await update.json()).toMatchObject({
        conversationId: "deskrelay-manager-assistant",
        sessionId: "manager-session-42",
      });

      const restored = await app.fetch(authedRequest("GET", "/api/manager/assistant/conversation"));
      expect(await restored.json()).toMatchObject({
        sessionId: "manager-session-42",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager assistant preserves Korean prompt when invoking the CLI", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-stdin-"));
    const scriptPath = join(cwd, "fake-claude-stdin.js");
    writeFileSync(
      scriptPath,
      `
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  console.log(JSON.stringify({
    argv: process.argv.slice(2),
    stdin: Buffer.concat(chunks).toString("utf8")
  }));
});
`,
      "utf8",
    );
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        managerAssistant: {
          cwd,
          command: process.execPath,
          args: [scriptPath, "-p"],
          timeoutMs: 10_000,
        },
      });

      const res = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/chat", {
          message: "관리자 타이핑 인코딩 확인",
          history: [],
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { message?: { text?: string } };
      const observed = JSON.parse(body.message?.text ?? "{}") as {
        argv?: string[];
        stdin?: string;
      };
      expect(observed.argv).not.toContain("관리자 타이핑 인코딩 확인");
      expect(observed.argv).toContain("--input-format");
      expect(observed.argv).toContain("--output-format");
      expect(observed.argv).toContain("stream-json");
      expect(observed.stdin).toContain("관리자 타이핑 인코딩 확인");
      const payload = JSON.parse((observed.stdin ?? "").trim()) as {
        type?: string;
        message?: { content?: Array<{ text?: string }> };
      };
      expect(payload.type).toBe("user");
      expect(payload.message?.content?.[0]?.text).toContain("관리자 타이핑 인코딩 확인");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager assistant returns and resumes a persistent Claude session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-session-"));
    const scriptPath = join(cwd, "fake-claude-session.js");
    writeFileSync(
      scriptPath,
      `
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const observed = {
    argv: process.argv.slice(2),
    stdin: Buffer.concat(chunks).toString("utf8")
  };
  console.log(JSON.stringify({
    type: "result",
    session_id: "manager-session-1",
    result: JSON.stringify(observed)
  }));
});
`,
      "utf8",
    );
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        managerAssistant: {
          cwd,
          command: process.execPath,
          args: [scriptPath],
          timeoutMs: 10_000,
        },
      });

      const first = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/chat", {
          message: "remember-session-token",
          history: [
            {
              id: "old",
              role: "assistant",
              text: "old assistant text that must not be replayed",
              createdAt: "2026-05-12T00:00:00.000Z",
            },
          ],
        }),
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        sessionId?: string;
        message?: { text?: string };
      };
      expect(firstBody.sessionId).toBe("manager-session-1");
      const firstObserved = JSON.parse(firstBody.message?.text ?? "{}") as {
        argv?: string[];
        stdin?: string;
      };
      expect(firstObserved.argv).not.toContain("--resume");
      expect(firstObserved.stdin).toContain("remember-session-token");
      expect(firstObserved.stdin).not.toContain("old assistant text that must not be replayed");

      const second = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/chat", {
          message: "recall-session-token",
          assistantState: {
            sessionId: "manager-session-1",
            lastAssistantText: "large stale assistant text that must not be replayed",
          },
        }),
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as {
        sessionId?: string;
        message?: { text?: string };
      };
      expect(secondBody.sessionId).toBe("manager-session-1");
      const secondObserved = JSON.parse(secondBody.message?.text ?? "{}") as {
        argv?: string[];
        stdin?: string;
      };
      expect(secondObserved.argv).toContain("--resume");
      expect(secondObserved.argv).toContain("manager-session-1");
      expect(secondObserved.stdin).toContain("recall-session-token");
      expect(secondObserved.stdin).not.toContain(
        "large stale assistant text that must not be replayed",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager assistant stream reports status before final response", async () => {
    const cwd = join(tmpdir(), "deskrelay-assistant-stream-test");
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: {
        cwd,
        runner: async (input) => ({
          command: "fake-claude -p",
          text: `streamed ${input.message}`,
        }),
      },
    });

    const res = await app.fetch(
      authedRequest("POST", "/api/manager/assistant/chat/stream", {
        message: "업데이트 상태 확인",
        history: [],
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"type":"status"');
    expect(text).toContain('"main":"Assistant 실행 중"');
    expect(text).toContain('"type":"message"');
    expect(text).toContain("streamed 업데이트 상태 확인");
  });

  test("manager assistant stream tolerates client cancellation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-cancel-"));
    let runnerCompleted = false;
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: {
        cwd,
        runner: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          runnerCompleted = true;
          return {
            command: "fake-claude -p",
            text: `streamed ${input.message}`,
          };
        },
      },
    });

    const res = await app.fetch(
      authedRequest("POST", "/api/manager/assistant/chat/stream", {
        message: "업데이트 상태 확인",
        history: [],
      }),
    );

    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runnerCompleted).toBe(true);
  });

  test("manager assistant history drops synthetic tool transcript artifacts", async () => {
    const cwd = join(tmpdir(), "deskrelay-assistant-history-test");
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: {
        cwd,
        runner: async (input) => ({
          command: "fake-claude -p",
          text: `history=${input.history.length}`,
        }),
      },
    });

    const res = await app.fetch(
      authedRequest("POST", "/api/manager/assistant/chat", {
        message: "retry",
        history: [
          {
            id: "broken",
            role: "assistant",
            text: '[Calls Bash -> cmd /c "set DESKRELAY"]\nB:',
            createdAt: "2026-05-11T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { message?: { text?: string } };
    expect(body.message?.text).toContain("history=0");
  });

  test("manager assistant stream rejects incomplete tool transcript artifacts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-tool-artifact-"));
    const scriptPath = join(cwd, "fake-claude.js");
    writeFileSync(
      scriptPath,
      `
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "I will inspect the project." }] } }));
console.log(JSON.stringify({ type: "result", result: "I will inspect the project.\\n[Calls Bash -> cmd /c \\"set DESKRELAY\\"]\\nB:" }));
`,
      "utf8",
    );
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        managerAssistant: {
          cwd,
          command: process.execPath,
          args: [scriptPath],
          timeoutMs: 10_000,
        },
      });

      const res = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/chat/stream", {
          message: "analyze",
          history: [],
        }),
      );

      expect(res.status).toBe(200);
      const events = parseSseEvents(await res.text());
      expect(events.some((event) => event.type === "message")).toBe(false);
      const error = events.find((event) => event.type === "error");
      expect(error?.error).toContain("started a tool call");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager assistant stream keeps final text after a completed tool call", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-tool-complete-"));
    const scriptPath = join(cwd, "fake-claude.js");
    writeFileSync(
      scriptPath,
      `
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cmd /c ver" } }] } }));
console.log(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }));
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done after tool." }] } }));
console.log(JSON.stringify({ type: "result", result: "Done after tool." }));
`,
      "utf8",
    );
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        managerAssistant: {
          cwd,
          command: process.execPath,
          args: [scriptPath],
          timeoutMs: 10_000,
        },
      });

      const res = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/chat/stream", {
          message: "analyze",
          history: [],
        }),
      );

      expect(res.status).toBe(200);
      const events = parseSseEvents(await res.text());
      const message = events.find((event) => event.type === "message");
      expect(message).toBeTruthy();
      expect(JSON.stringify(message)).toContain("Done after tool.");
      expect(JSON.stringify(message)).not.toContain("Calls Bash");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager assistant chat creates managed Claude instructions outside user-editable scopes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-assistant-managed-"));
    let captured:
      | {
          cwd: string;
          repoRoot: string;
          instructionsPath: string;
          apiBaseUrl: string;
        }
      | undefined;
    try {
      const app = createSiteApp({
        registry: new InMemoryDeviceRegistry(),
        token: TOKEN,
        selfHostUrl: "http://deskrelay.test:18193",
        managerAssistant: {
          cwd,
          runner: async (input) => {
            captured = {
              cwd: input.cwd,
              repoRoot: input.repoRoot,
              instructionsPath: input.instructionsPath,
              apiBaseUrl: input.apiBaseUrl,
            };
            return {
              command: "fake-claude -p",
              text: "managed instructions loaded",
            };
          },
        },
      });

      const res = await app.fetch(
        authedRequest("POST", "/api/manager/assistant/chat", {
          message: "API 상태 확인",
          history: [],
        }),
      );

      expect(res.status).toBe(200);
      expect(captured?.cwd).toBe(cwd);
      expect(captured?.repoRoot).toBe(cwd);
      expect(captured?.apiBaseUrl).toBe("http://deskrelay.test:18193");
      expect(
        captured?.instructionsPath.endsWith(join(".deskrelay", "manager-assistant", "CLAUDE.md")),
      ).toBe(true);
      const instructions = readFileSync(captured?.instructionsPath ?? "", "utf8");
      expect(instructions).toContain("DeskRelay Manager Assistant");
      expect(instructions).toContain("administrator and supervisor");
      expect(instructions).toContain("## Supervisor Boundary");
      expect(instructions).toContain("not the primary implementer");
      expect(instructions).toContain("Do not write the main project artifacts yourself");
      expect(instructions).toContain("PowerShell is for inspection");
      expect(instructions).toContain("## Development Round Completion Gate");
      expect(instructions).toContain("At least one non-dry-run `claude-code` worker task");
      expect(instructions).toContain("If the work only used your own reasoning");
      expect(instructions).toContain("## Common Behavior Contract");
      expect(instructions).toContain("## Role Profiles");
      expect(instructions).toContain("### Status Reporter");
      expect(instructions).toContain("### Diagnostician");
      expect(instructions).toContain("### Operator");
      expect(instructions).toContain("### Developer Supervisor");
      expect(instructions).toContain("Do not directly implement the worker's assigned files");
      expect(instructions).toContain(
        "Do not close a development round without a non-dry-run `claude-code` worker result",
      );
      expect(instructions).toContain("### Session Analyst");
      expect(instructions).toContain("### Guide");
      expect(instructions).toContain("### Safety Steward");
      expect(instructions).toContain("## Intent First");
      expect(instructions).toContain("Understand Intent -> Choose Scope -> Read State");
      expect(instructions).toContain("Intent -> Scope -> Needed context");
      expect(instructions).toContain("browser context is only a reference snapshot");
      expect(instructions).toContain("Use lazy reads");
      expect(instructions).toContain("selected/current conversation");
      expect(instructions).toContain("sessions.read");
      expect(instructions).toContain("workspaceScope=unrestricted");
      expect(instructions).toContain("includeFiles=1");
      expect(instructions).toContain("UTF-8 text/Markdown previews");
      expect(instructions).toContain("## Autonomous Supervision Loop");
      expect(instructions).toContain("R<N>: classify intent");
      expect(instructions).toContain("Do not end with only a plan");
      expect(instructions).toContain("Do not pretend background supervision continues");
      expect(instructions).toContain("Do not ask again after a short reply");
      expect(instructions).toContain("ASCII-only operational prompts");
      expect(instructions).toContain("## Worker Delegation");
      expect(instructions).toContain("GET /api/manager/workers");
      expect(instructions).toContain("run-worker");
      expect(instructions).toContain("## Result Observation Policy");
      expect(instructions).toContain("GET /api/manager/tasks/:id/observe");
      expect(instructions).toContain("GET /api/manager/tasks/:id/stream");
      expect(instructions).toContain("## Failure Escalation Policy");
      expect(instructions).toContain("browser -> server -> registry -> connector");
      expect(instructions).toContain("bun run scripts/manager-api.ts");
      expect(instructions).toContain("batch-get");
      expect(instructions).toContain("batch --requests");
      expect(instructions).toContain("batch --file");
      expect(instructions).toContain("--body-file");
      expect(instructions).toContain("Prefer PowerShell");
      expect(instructions).toContain(
        "Do not use Bash for `scripts/manager-api.ts` calls on Windows",
      );
      expect(instructions).toContain("Do not use parallel tool calls for shell commands");
      expect(instructions).toContain("Do not put PowerShell syntax inside Bash");
      expect(instructions).toContain('"message": "..."');
      expect(instructions).not.toContain('"prompt": "..."');
      expect(instructions).toContain("GET /api/manager/system/summary");
      expect(instructions).toContain("POST /api/devices/:id/behaviors/:instance/request");
      expect(instructions).toContain("PUT /api/devices/:id/instructions/:scope");
      expect(instructions).toContain("Authorization: Bearer $DESKRELAY_SITE_TOKEN");
      expect(instructions).not.toContain(TOKEN);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager worker APIs expose profiles and run a worker task", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-worker-"));
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: { cwd },
      managerWorkers: [
        {
          id: "echo",
          label: "Echo worker",
          description: "Test worker",
          command: process.execPath,
          args: ["-e", "console.log(Bun.argv.at(-1))"],
          defaultTimeoutMs: 30_000,
        },
      ],
    });

    try {
      const list = await app.fetch(authedRequest("GET", "/api/manager/workers"));
      expect(list.status).toBe(200);
      const listBody = (await list.json()) as { profiles?: Array<{ id?: string }> };
      expect(listBody.profiles?.some((profile) => profile.id === "echo")).toBe(true);

      const profile = await app.fetch(authedRequest("GET", "/api/manager/workers/echo"));
      expect(profile.status).toBe(200);
      expect(((await profile.json()) as { id?: string; checkArgs?: string[] }).id).toBe("echo");

      const check = await app.fetch(authedRequest("POST", "/api/manager/workers/echo/check"));
      expect(check.status).toBe(200);
      const checkBody = (await check.json()) as { available?: boolean; command?: string };
      expect(checkBody.available).toBe(true);
      expect(checkBody.command).toBe(process.execPath);

      const dryRun = await app.fetch(
        authedRequest("POST", "/api/manager/workers/run", {
          profile: "echo",
          prompt: "hello worker",
          dryRun: true,
          requestedBy: "manager-assistant",
        }),
      );
      expect(dryRun.status).toBe(202);
      expect(((await dryRun.json()) as { state?: string; kind?: string }).state).toBe("succeeded");

      const run = await app.fetch(
        authedRequest("POST", "/api/manager/workers/run", {
          profile: "echo",
          prompt: "hello worker",
          dryRun: false,
          requestedBy: "manager-assistant",
        }),
      );
      expect(run.status).toBe(202);
      const body = (await run.json()) as {
        kind?: string;
        state?: string;
        result?: { stdout?: string; command?: string };
        params?: { prompt?: string };
      };
      expect(body.kind).toBe("run-worker");
      expect(body.state).toBe("succeeded");
      expect(body.params?.prompt).toBe("hello worker");
      expect(body.result?.stdout).toContain("hello worker");
      expect(body.result?.command).toContain("<prompt>");

      const unknown = await app.fetch(
        authedRequest("POST", "/api/manager/workers/run", {
          profile: "missing",
          prompt: "hello worker",
          dryRun: false,
          requestedBy: "manager-assistant",
        }),
      );
      expect(unknown.status).toBe(409);
      expect(((await unknown.json()) as { state?: string; error?: string }).state).toBe("blocked");

      const outside = await app.fetch(
        authedRequest("POST", "/api/manager/workers/run", {
          profile: "echo",
          prompt: "hello worker",
          cwd: dirname(cwd),
          dryRun: false,
          requestedBy: "manager-assistant",
        }),
      );
      expect(outside.status).toBe(409);
      expect(((await outside.json()) as { error?: string }).error).toContain(
        "worker cwd must stay inside",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager orchestration rounds dispatch multiple role agents", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-round-"));
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: { cwd },
      managerWorkers: [
        {
          id: "echo",
          label: "Echo worker",
          description: "Test worker",
          command: process.execPath,
          args: ["-e", "console.log(Bun.argv.at(-1))"],
          defaultTimeoutMs: 30_000,
        },
      ],
    });

    try {
      const create = await app.fetch(
        authedRequest("POST", "/api/manager/rounds", {
          title: "R1",
          objective: "Verify multi-agent orchestration.",
        }),
      );
      expect(create.status).toBe(201);
      const created = (await create.json()) as { round?: { id?: string } };
      expect(created.round?.id).toBeTruthy();

      const dispatch = await app.fetch(
        authedRequest("POST", `/api/manager/rounds/${created.round?.id}/dispatch`, {
          dryRun: false,
          assignments: [
            { role: "architect", profile: "echo", prompt: "architect report" },
            { role: "protocol", profile: "echo", prompt: "protocol report" },
            { role: "critic", profile: "echo", prompt: "critic report" },
          ],
        }),
      );
      expect(dispatch.status).toBe(202);
      const dispatched = (await dispatch.json()) as {
        round?: { status?: string; agentIds?: string[]; taskIds?: string[] };
        agents?: Array<{ role?: string; status?: string; taskId?: string }>;
        tasks?: Array<{
          state?: string;
          params?: { agentRole?: string };
          result?: { stdout?: string };
        }>;
      };
      expect(dispatched.round?.status).toBe("completed");
      expect(dispatched.agents?.map((agent) => agent.role).sort()).toEqual([
        "architect",
        "critic",
        "protocol",
      ]);
      expect(dispatched.agents?.every((agent) => agent.status === "completed")).toBe(true);
      expect(dispatched.tasks).toHaveLength(3);
      expect(dispatched.tasks?.every((task) => task.state === "succeeded")).toBe(true);
      expect(dispatched.tasks?.some((task) => task.params?.agentRole === "critic")).toBe(true);
      expect(
        dispatched.tasks?.some((task) => task.result?.stdout?.includes("protocol report")),
      ).toBe(true);

      const agents = await app.fetch(authedRequest("GET", "/api/manager/agents"));
      expect(agents.status).toBe(200);
      const agentList = (await agents.json()) as { agents?: Array<{ status?: string }> };
      expect(agentList.agents?.filter((agent) => agent.status === "completed")).toHaveLength(3);

      const report = await app.fetch(
        authedRequest("GET", `/api/manager/rounds/${created.round?.id}/report`),
      );
      expect(report.status).toBe(200);
      expect(((await report.json()) as { summary?: string }).summary).toContain("3 task");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager orchestration reuses role agents and resumes worker sessions across rounds", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-round-resume-"));
    const scriptPath = join(cwd, "fake-claude-worker.js");
    writeFileSync(
      scriptPath,
      `
const resumeIndex = process.argv.indexOf("--resume");
const resumed = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : "";
const sessionId = resumed || "worker-session-001";
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: sessionId }));
console.log(JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "resumed:" + (resumed || "none") }]
  }
}));
console.log(JSON.stringify({ type: "result", subtype: "success", duration_ms: 1, num_turns: 1 }));
`,
      "utf8",
    );
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: { cwd },
      managerWorkers: [
        {
          id: "fake-claude",
          label: "Fake Claude worker",
          description: "Structured test worker",
          command: process.execPath,
          args: [scriptPath, "-p", "--input-format", "stream-json"],
          runMode: "stdin",
          defaultTimeoutMs: 30_000,
        },
      ],
    });

    try {
      const createR1 = await app.fetch(
        authedRequest("POST", "/api/manager/rounds", {
          title: "R1",
          objective: "First worker round.",
        }),
      );
      const r1 = (await createR1.json()) as { round?: { id?: string } };
      const dispatchR1 = await app.fetch(
        authedRequest("POST", `/api/manager/rounds/${r1.round?.id}/dispatch`, {
          dryRun: false,
          assignments: [{ role: "architect", profile: "fake-claude", prompt: "round one" }],
        }),
      );
      expect(dispatchR1.status).toBe(202);
      const first = (await dispatchR1.json()) as {
        agents?: Array<{ id?: string; sessionId?: string }>;
        tasks?: Array<{ result?: { sessionId?: string; stdout?: string } }>;
      };
      const firstAgentId = first.agents?.[0]?.id;
      expect(firstAgentId).toBeTruthy();
      expect(first.agents?.[0]?.sessionId).toBe("worker-session-001");
      expect(first.tasks?.[0]?.result?.stdout).toContain("resumed:none");

      const createR2 = await app.fetch(
        authedRequest("POST", "/api/manager/rounds", {
          title: "R2",
          objective: "Second worker round.",
        }),
      );
      const r2 = (await createR2.json()) as { round?: { id?: string } };
      const dispatchR2 = await app.fetch(
        authedRequest("POST", `/api/manager/rounds/${r2.round?.id}/dispatch`, {
          dryRun: false,
          assignments: [{ role: "architect", profile: "fake-claude", prompt: "round two" }],
        }),
      );
      expect(dispatchR2.status).toBe(202);
      const second = (await dispatchR2.json()) as {
        agents?: Array<{ id?: string; sessionId?: string }>;
        tasks?: Array<{ result?: { sessionId?: string; stdout?: string } }>;
      };
      expect(second.agents?.[0]?.id).toBe(firstAgentId);
      expect(second.agents?.[0]?.sessionId).toBe("worker-session-001");
      expect(second.tasks?.[0]?.result?.sessionId).toBe("worker-session-001");
      expect(second.tasks?.[0]?.result?.stdout).toContain("resumed:worker-session-001");

      const agents = await app.fetch(authedRequest("GET", "/api/manager/agents"));
      const agentList = (await agents.json()) as { agents?: Array<{ role?: string }> };
      expect(agentList.agents?.filter((agent) => agent.role === "architect")).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager orchestration does not reuse stale role agents", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-round-stale-"));
    const scriptPath = join(cwd, "fake-stale-worker.js");
    writeFileSync(
      scriptPath,
      `
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "fresh-session" }));
console.log(JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text: "fresh worker" }] }
}));
console.log(JSON.stringify({ type: "result", subtype: "success", duration_ms: 1, num_turns: 1 }));
`,
      "utf8",
    );
    const managerOrchestrationStore = createInMemoryManagerOrchestrationStore();
    const staleAgent = await managerOrchestrationStore.createAgent({
      role: "architect",
      label: "Architect agent",
      profile: "fake-stale-worker",
      cwd,
      instruction: "previous prompt",
    });
    await managerOrchestrationStore.updateAgent(staleAgent.id, {
      status: "stale",
      sessionId: "stale-session",
      lastError: "previous server process",
    });
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: { cwd },
      managerOrchestrationStore,
      managerWorkers: [
        {
          id: "fake-stale-worker",
          label: "Fake stale worker",
          description: "Structured test worker",
          command: process.execPath,
          args: [scriptPath, "-p", "--input-format", "stream-json"],
          runMode: "stdin",
          defaultTimeoutMs: 30_000,
        },
      ],
    });

    try {
      const createRound = await app.fetch(
        authedRequest("POST", "/api/manager/rounds", {
          title: "R-stale-reuse",
          objective: "Do not reuse stale workers.",
        }),
      );
      const round = (await createRound.json()) as { round?: { id?: string } };
      const dispatch = await app.fetch(
        authedRequest("POST", `/api/manager/rounds/${round.round?.id}/dispatch`, {
          dryRun: false,
          assignments: [
            {
              role: "architect",
              label: "Architect agent",
              profile: "fake-stale-worker",
              cwd,
              prompt: "fresh prompt",
            },
          ],
        }),
      );
      expect(dispatch.status).toBe(202);
      const body = (await dispatch.json()) as {
        agents?: Array<{ id?: string; status?: string; sessionId?: string }>;
      };
      expect(body.agents?.[0]?.id).not.toBe(staleAgent.id);
      expect(body.agents?.[0]?.status).toBe("completed");
      expect(body.agents?.[0]?.sessionId).toBe("fresh-session");

      const agents = await app.fetch(authedRequest("GET", "/api/manager/agents"));
      expect(agents.status).toBe(200);
      const agentList = (await agents.json()) as {
        agents?: Array<{ id?: string; status?: string }>;
      };
      expect(agentList.agents?.find((agent) => agent.id === staleAgent.id)?.status).toBe("stale");
      expect(agentList.agents?.filter((agent) => agent.status === "completed")).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager worker stdin mode can use Claude structured input for Korean prompts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-worker-stdin-"));
    const scriptPath = join(cwd, "fake-worker-stdin.js");
    writeFileSync(
      scriptPath,
      `
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  console.log(JSON.stringify({
    argv: process.argv.slice(2),
    stdin: Buffer.concat(chunks).toString("utf8")
  }));
});
`,
      "utf8",
    );
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: { cwd },
      managerWorkers: [
        {
          id: "structured",
          label: "Structured worker",
          description: "Test structured stdin worker",
          command: process.execPath,
          args: [scriptPath, "-p", "--input-format", "stream-json"],
          runMode: "stdin",
          defaultTimeoutMs: 30_000,
        },
      ],
    });

    try {
      const run = await app.fetch(
        authedRequest("POST", "/api/manager/workers/run", {
          profile: "structured",
          prompt: "원격 작업자 한글 프롬프트",
          dryRun: false,
          requestedBy: "manager-assistant",
        }),
      );
      expect(run.status).toBe(202);
      const body = (await run.json()) as {
        state?: string;
        result?: { stdout?: string; command?: string };
      };
      expect(body.state).toBe("succeeded");
      expect(body.result?.command).toContain("<prompt via stdin>");
      const observed = JSON.parse(body.result?.stdout ?? "{}") as {
        argv?: string[];
        stdin?: string;
      };
      expect(observed.argv).not.toContain("원격 작업자 한글 프롬프트");
      expect(observed.stdin).toContain("원격 작업자 한글 프롬프트");
      const payload = JSON.parse((observed.stdin ?? "").trim()) as {
        message?: { content?: Array<{ text?: string }> };
      };
      expect(payload.message?.content?.[0]?.text).toBe("원격 작업자 한글 프롬프트");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager worker run blocks when the worker command is unavailable", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-worker-missing-"));
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerAssistant: { cwd },
      managerWorkers: [
        {
          id: "missing",
          label: "Missing worker",
          description: "Missing command",
          command: "deskrelay-definitely-missing-worker-command",
        },
      ],
    });

    try {
      const check = await app.fetch(authedRequest("POST", "/api/manager/workers/missing/check"));
      expect(check.status).toBe(200);
      expect(((await check.json()) as { available?: boolean }).available).toBe(false);

      const run = await app.fetch(
        authedRequest("POST", "/api/manager/workers/run", {
          profile: "missing",
          prompt: "hello worker",
          dryRun: false,
          requestedBy: "manager-assistant",
        }),
      );
      expect(run.status).toBe(409);
      const body = (await run.json()) as { state?: string; error?: string };
      expect(body.state).toBe("blocked");
      expect(body.error).toBeTruthy();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("update plan and last registration failure APIs expose structured manager data", async () => {
    const reports = [
      {
        id: "install_1",
        receivedAt: "2026-05-11T00:00:00.000Z",
        status: "failed" as const,
        label: "remote",
        steps: [
          {
            id: "advertised-daemon",
            label: "server-to-connector probe",
            status: "failed" as const,
            severity: "error" as const,
            summary: "timed out while checking Tailscale address",
            retrySafe: true,
          },
        ],
      },
    ];
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      installReportStore: {
        async list() {
          return reports;
        },
        async add() {
          return reports[0] as never;
        },
      },
    });

    const plan = await app.fetch(authedRequest("GET", "/api/manager/update/plan"));
    expect(plan.status).toBe(200);
    expect(((await plan.json()) as { items?: unknown[] }).items?.length).toBeGreaterThan(0);

    const failure = await app.fetch(authedRequest("GET", "/api/manager/registration/last-failure"));
    expect(failure.status).toBe(200);
    const body = (await failure.json()) as {
      found?: boolean;
      classification?: string;
      retrySafe?: boolean;
    };
    expect(body.found).toBe(true);
    expect(body.classification).toBe("firewall-or-route-timeout");
    expect(body.retrySafe).toBe(true);
  });

  test("manager-facing diagnostics redact token-bearing registration commands", async () => {
    const secret = "super-secret-site-token-123456789";
    const reports = [
      {
        id: "install_secret",
        receivedAt: "2026-05-11T00:00:00.000Z",
        status: "failed" as const,
        label: "Remote PC",
        steps: [
          {
            id: "installer-error",
            label: "installer",
            status: "failed" as const,
            severity: "error" as const,
            summary: `powershell -File install-connector.ps1 -SiteToken '${secret}' failed`,
            detail: `Authorization: Bearer ${secret}`,
            evidence: [`--site-token ${secret}`],
            action: `rerun with Site token: ${secret}`,
            retrySafe: true,
          },
        ],
      },
    ];
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      installReportStore: {
        async list() {
          return reports;
        },
        async add() {
          return reports[0] as never;
        },
      },
    });

    const failure = await app.fetch(authedRequest("GET", "/api/manager/registration/last-failure"));
    expect(failure.status).toBe(200);
    const failureText = JSON.stringify(await failure.json());
    expect(failureText).not.toContain(secret);
    expect(failureText).toContain("[redacted]");

    const summary = await app.fetch(authedRequest("GET", "/api/manager/system/summary"));
    expect(summary.status).toBe(200);
    const summaryText = JSON.stringify(await summary.json());
    expect(summaryText).not.toContain(secret);
    expect(summaryText).toContain("[redacted]");
  });

  test("server startup recovers stale running manager tasks without clearing queued device work", async () => {
    const managerTaskStore = createInMemoryManagerTaskStore();
    const managerOrchestrationStore = createInMemoryManagerOrchestrationStore();
    const running = await managerTaskStore.create({
      kind: "update-all",
      dryRun: false,
      requestedBy: "browser",
      steps: [],
    });
    await managerTaskStore.update(running.id, {
      state: "running",
      startedAt: "2026-05-11T00:00:00.000Z",
    });
    const waiting = await managerTaskStore.create({
      kind: "update-device",
      targetId: "dev_waiting",
      dryRun: false,
      requestedBy: "browser",
      steps: [],
    });
    await managerTaskStore.update(waiting.id, {
      state: "waiting_for_device",
      startedAt: "2026-05-11T00:00:00.000Z",
    });
    const round = await managerOrchestrationStore.createRound({
      title: "R-stale-startup",
      objective: "Recover stale runtime state.",
    });
    const linkedAgent = await managerOrchestrationStore.createAgent({
      role: "verifier",
      label: "Linked verifier",
      roundId: round.id,
      instruction: "Verify startup recovery.",
    });
    await managerOrchestrationStore.updateAgent(linkedAgent.id, {
      status: "running",
      taskId: running.id,
      lastHeartbeatAt: "2026-05-11T00:00:00.000Z",
    });
    const orphanAgent = await managerOrchestrationStore.createAgent({
      role: "critic",
      label: "Orphan critic",
      roundId: round.id,
      instruction: "Critique startup recovery.",
    });
    await managerOrchestrationStore.updateAgent(orphanAgent.id, {
      status: "running",
      lastHeartbeatAt: "2026-05-11T00:00:00.000Z",
    });
    const completedAgent = await managerOrchestrationStore.createAgent({
      role: "documenter",
      label: "Completed documenter",
      roundId: round.id,
      instruction: "Document startup recovery.",
    });
    await managerOrchestrationStore.updateAgent(completedAgent.id, {
      status: "completed",
      taskId: "already_done",
      lastHeartbeatAt: "2026-05-11T00:00:00.000Z",
    });
    await managerOrchestrationStore.updateRound(round.id, {
      status: "running",
      agentIds: [linkedAgent.id, orphanAgent.id, completedAgent.id],
      taskIds: [running.id],
    });

    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerTaskStore,
      managerOrchestrationStore,
      build: {
        version: "0.0.0",
        commit: "recovery-test",
        shortCommit: "recovery",
        dirty: false,
        source: "env",
      },
    });

    const res = await app.fetch(authedRequest("GET", "/api/manager/tasks?limit=10"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tasks?: Array<{
        id?: string;
        state?: string;
        completedAt?: string;
        error?: string;
        steps?: Array<{ id?: string; status?: string; retrySafe?: boolean }>;
      }>;
    };
    const recovered = body.tasks?.find((task) => task.id === running.id);
    expect(recovered?.state).toBe("cancelled");
    expect(recovered?.completedAt).toBeTruthy();
    expect(recovered?.error).toContain("previous server process");
    expect(
      recovered?.steps?.some(
        (step) =>
          step.id === "task.recovered-after-restart" &&
          step.status === "warn" &&
          step.retrySafe === true,
      ),
    ).toBe(true);
    const stillQueued = body.tasks?.find((task) => task.id === waiting.id);
    expect(stillQueued?.state).toBe("waiting_for_device");

    const agents = await app.fetch(authedRequest("GET", "/api/manager/agents"));
    expect(agents.status).toBe(200);
    const agentBody = (await agents.json()) as {
      agents?: Array<{ id?: string; status?: string; lastError?: string }>;
    };
    const recoveredLinkedAgent = agentBody.agents?.find((agent) => agent.id === linkedAgent.id);
    expect(recoveredLinkedAgent?.status).toBe("stale");
    expect(recoveredLinkedAgent?.lastError).toContain("previous server process");
    const recoveredOrphanAgent = agentBody.agents?.find((agent) => agent.id === orphanAgent.id);
    expect(recoveredOrphanAgent?.status).toBe("stale");
    expect(recoveredOrphanAgent?.lastError).toContain("previous server process");
    const untouchedCompletedAgent = agentBody.agents?.find(
      (agent) => agent.id === completedAgent.id,
    );
    expect(untouchedCompletedAgent?.status).toBe("completed");

    const state = await app.fetch(authedRequest("GET", "/api/manager/state"));
    expect(state.status).toBe(200);
    const stateBody = (await state.json()) as {
      counts?: { runningAgents?: number; blockedAgents?: number };
    };
    expect(stateBody.counts?.runningAgents).toBe(0);
    expect(stateBody.counts?.blockedAgents).toBe(2);
  });

  test("task logs, cancel, and retry APIs operate on stored manager tasks", async () => {
    const managerTaskStore = createInMemoryManagerTaskStore();
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      managerTaskStore,
    });
    const pending = await managerTaskStore.create({
      kind: "diagnose",
      dryRun: true,
      requestedBy: "browser",
      steps: [],
    });

    const cancel = await app.fetch(
      authedRequest("POST", `/api/manager/tasks/${pending.id}/cancel`),
    );
    expect(cancel.status).toBe(202);
    expect(((await cancel.json()) as { state?: string }).state).toBe("cancelled");

    const logs = await app.fetch(authedRequest("GET", `/api/manager/tasks/${pending.id}/logs`));
    expect(logs.status).toBe(200);
    const logBody = (await logs.json()) as { lines?: string[]; source?: string };
    expect(logBody.source).toBe("manager-task");
    expect(logBody.lines?.some((line) => line.includes("cancelled"))).toBe(true);

    const observe = await app.fetch(
      authedRequest("GET", `/api/manager/tasks/${pending.id}/observe`),
    );
    expect(observe.status).toBe(200);
    const observation = (await observe.json()) as {
      terminal?: boolean;
      summary?: string;
      nextRead?: string;
      task?: { state?: string };
      log?: { source?: string };
    };
    expect(observation.terminal).toBe(true);
    expect(observation.nextRead).toBe("none");
    expect(observation.task?.state).toBe("cancelled");
    expect(observation.log?.source).toBe("manager-task");
    expect(observation.summary).toContain("cancelled");

    const stream = await app.fetch(authedRequest("GET", `/api/manager/tasks/${pending.id}/stream`));
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const streamEvents = parseSseEvents(await stream.text());
    expect(streamEvents).toEqual([
      expect.objectContaining({
        type: "done",
        observation: expect.objectContaining({
          terminal: true,
          task: expect.objectContaining({ state: "cancelled" }),
        }),
      }),
    ]);

    const failed = await managerTaskStore.create({
      kind: "diagnose",
      dryRun: true,
      requestedBy: "browser",
      steps: [],
    });
    await managerTaskStore.update(failed.id, {
      state: "failed",
      error: "synthetic failure",
    });
    const retry = await app.fetch(authedRequest("POST", `/api/manager/tasks/${failed.id}/retry`));
    expect(retry.status).toBe(202);
    expect(((await retry.json()) as { state?: string }).state).toBe("succeeded");
    expect(((await managerTaskStore.list()) as unknown[]).length).toBe(3);
  });

  test("manager summary, action discovery, update status, registration diagnosis, and security summary APIs respond", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "remote",
    });
    setup.setMockResponse((req) => {
      if (req.url.endsWith("/install/status")) {
        return Response.json({
          scope: "device",
          generatedAt: "2026-05-11T00:00:00.000Z",
          build: {
            version: "0.0.0",
            commit: "abc",
            shortCommit: "abc",
            dirty: false,
            source: "git",
          },
          installed: true,
          running: true,
          update: { state: "idle", updateAvailable: false },
          summary: { severity: "ok", message: "device ok" },
        });
      }
      if (req.url.endsWith("/security/boundary")) {
        return Response.json({
          scope: "device",
          generatedAt: "2026-05-11T00:00:00.000Z",
          tokenBoundary: {
            daemonTokenAvailable: true,
            browserReceivesDaemonToken: false,
          },
          networkBoundary: {
            url: DAEMON_URL,
            kind: "tailscale",
            publicExposure: false,
          },
          warnings: [],
          summary: { severity: "ok", message: "secure" },
        });
      }
      return Response.json({ ok: true });
    });

    const summary = await setup.app.fetch(authedRequest("GET", "/api/manager/system/summary"));
    expect(summary.status).toBe(200);
    expect(((await summary.json()) as { devices?: unknown[] }).devices).toHaveLength(1);

    const actions = await setup.app.fetch(
      authedRequest("GET", `/api/manager/devices/${device.id}/actions`),
    );
    expect(actions.status).toBe(200);
    expect(
      ((await actions.json()) as { actions?: Array<{ id?: string }> }).actions?.some(
        (action) => action.id === "update",
      ),
    ).toBe(true);

    const updateStatus = await setup.app.fetch(authedRequest("GET", "/api/manager/update/status"));
    expect(updateStatus.status).toBe(200);
    expect(((await updateStatus.json()) as { devices?: unknown[] }).devices).toHaveLength(1);

    const registration = await setup.app.fetch(
      authedRequest("GET", "/api/manager/registration/diagnose"),
    );
    expect(registration.status).toBe(200);
    expect(
      ((await registration.json()) as { siteTokenConfigured?: boolean }).siteTokenConfigured,
    ).toBe(true);

    const security = await setup.app.fetch(authedRequest("GET", "/api/manager/security/boundary"));
    expect(security.status).toBe(200);
    expect(((await security.json()) as { devices?: unknown[] }).devices).toHaveLength(1);
  });

  test("manager system summary does not probe remote device install status", async () => {
    setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "slow-remote",
    });
    setup.setMockResponse((req) => {
      throw new Error(`system summary should not call ${req.url}`);
    });

    const summary = await setup.app.fetch(authedRequest("GET", "/api/manager/system/summary"));
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as {
      devices?: unknown[];
      update?: { items?: Array<{ scope?: string; state?: string; reason?: string }> };
    };
    expect(body.devices).toHaveLength(1);
    expect(setup.calls).toHaveLength(0);
    expect(body.update?.items?.find((item) => item.scope === "device")).toMatchObject({
      state: "not_checked",
    });
  });

  test("manager update status falls back to legacy daemon status when install status is missing", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "legacy",
    });
    setup.setMockResponse((req) => {
      if (req.url.endsWith("/install/status")) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      if (req.url.endsWith("/status")) {
        return Response.json({
          ok: true,
          build: {
            version: "0.0.0",
            commit: "abc",
            shortCommit: "abc",
            dirty: false,
            source: "git",
          },
        });
      }
      return Response.json({ ok: true });
    });

    const updateStatus = await setup.app.fetch(authedRequest("GET", "/api/manager/update/status"));
    expect(updateStatus.status).toBe(200);
    const body = (await updateStatus.json()) as {
      devices?: Array<{ targetId?: string; state?: string; summary?: { severity?: string } }>;
      summary?: { severity?: string };
    };
    expect(body.summary?.severity).toBe("warn");
    expect(body.devices?.[0]).toMatchObject({
      targetId: device.id,
      state: "running",
      summary: { severity: "warn" },
    });
  });

  test("manager assistant prompt is an instruction packet, not a transcript continuation", () => {
    const prompt = buildManagerAssistantPrompt({
      message: "deskrelay 에 대해 알려줘",
      history: [
        {
          id: "a0",
          role: "assistant",
          text: "DeskRelay 상태 점검, 업데이트, 복구를 도와드릴게요.",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
        {
          id: "u1",
          role: "user",
          text: "deskrelay 에 대해 조사해봐",
          createdAt: "2026-05-12T00:00:01.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          text: "조사해드릴게요.\n[server summary 조회]\nA:",
          createdAt: "2026-05-12T00:00:02.000Z",
        },
      ],
      context: {
        deviceId: "dev_test",
        deviceLabel: "test device",
        deviceConnectionState: "online",
        sessionId: "session_test",
        cwd: "C:\\work",
      },
      cwd: "C:\\repo\\.deskrelay\\manager-assistant",
      repoRoot: "C:\\repo",
      instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
      apiBaseUrl: "http://127.0.0.1:18193",
    });

    expect(prompt).toContain("## Current User Request");
    expect(prompt).toContain("deskrelay 에 대해 알려줘");
    expect(prompt).toContain("## Current Browser Context");
    expect(prompt).toContain("## Role Selection Reminder");
    expect(prompt).toContain("status reporter, diagnostician, operator");
    expect(prompt).toContain("do not become the implementer");
    expect(prompt).toContain("Supervise `claude-code` worker tasks");
    expect(prompt).toContain("## Autonomous Loop Reminder");
    expect(prompt).toContain("A loop is real only if you execute observable steps");
    expect(prompt).toContain("GET /api/manager/tasks/:id/observe");
    expect(prompt).not.toContain("## Recent Conversation Log");
    expect(prompt).not.toContain("## Structured Manager State");
    expect(prompt).not.toContain("## Last Assistant Reply");
    expect(prompt).not.toContain("history=1");
    expect(prompt).not.toContain("\nUser: deskrelay");
    expect(prompt).not.toContain("\nAssistant:");
    expect(prompt.trim().endsWith("Assistant:")).toBe(false);
  });

  test("manager assistant prompt includes an ASCII-safe copy of Korean requests", () => {
    const prompt = buildManagerAssistantPrompt({
      message: "모든 디바이스를 삭제하지 말고 상태만 확인해",
      history: [],
      context: undefined,
      cwd: "C:\\repo\\.deskrelay\\manager-assistant",
      repoRoot: "C:\\repo",
      instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
      apiBaseUrl: "http://127.0.0.1:18193",
    });

    expect(prompt).toContain("## Current User Request ASCII-Safe Copy");
    expect(prompt).toContain("\\ubaa8\\ub4e0");
    expect(prompt).toContain("decode this JSON string");
    expect(prompt).toContain("Do not use Bash for DeskRelay manager API calls");
    expect(prompt).toContain("batch-get");
  });

  test("manager assistant prompt preserves pending decisions for short replies", () => {
    const longLastReply = [
      "확인된 사실 보고합니다.",
      "",
      "다음 중 어느 쪽으로 가시겠어요?",
      "",
      "1. remote-claude chat을 1회 스캐폴딩 호출로 써서 8개 md를 셋업",
      "2. scope를 서버-로컬로 변경해서 서버 PC 폴더에 직접 작성",
      "3. 계획 수정",
      "",
      "이 선택지는 오래 유지되어야 합니다.",
    ].join("\n");
    const prompt = buildManagerAssistantPrompt({
      message: "1",
      history: [
        {
          id: "a1",
          role: "assistant",
          text: longLastReply,
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      assistantState: {
        lastAssistantText: longLastReply,
        pendingDecision: {
          id: "write-strategy",
          prompt: "다음 중 어느 쪽으로 가시겠어요?",
          options: [
            { key: "1", label: "remote-claude chat을 1회 스캐폴딩 호출" },
            { key: "2", label: "scope를 서버-로컬로 변경" },
            { key: "3", label: "계획 수정" },
          ],
        },
        task: { state: "waiting_user_choice", title: "orchestration bootstrap" },
        facts: ["원격 arbitrary file write API 없음"],
      },
      context: {
        deviceId: "dev_test",
        deviceLabel: "test device",
        deviceConnectionState: "online",
        sessionId: "session_test",
        cwd: "C:\\work",
      },
      cwd: "C:\\repo\\.deskrelay\\manager-assistant",
      repoRoot: "C:\\repo",
      instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
      apiBaseUrl: "http://127.0.0.1:18193",
    });

    expect(prompt).not.toContain("## Structured Manager State");
    expect(prompt).not.toContain("task state: waiting_user_choice");
    expect(prompt).toContain("1. remote-claude chat을 1회 스캐폴딩 호출");
    expect(prompt).not.toContain("## Last Assistant Reply");
    expect(prompt).toContain("## Short Reply Resolution");
    expect(prompt).toContain("Resolve it against the active Claude session first");
  });

  test("shortcut APIs create manager tasks", async () => {
    const update = await setup.app.fetch(
      authedRequest("POST", "/api/manager/update/all", { dryRun: true }),
    );
    expect(update.status).toBe(202);
    expect(((await update.json()) as { kind?: string; state?: string }).kind).toBe("update-all");

    const repair = await setup.app.fetch(
      authedRequest("POST", "/api/manager/registration/repair", { dryRun: true }),
    );
    expect(repair.status).toBe(409);
    expect(((await repair.json()) as { kind?: string; state?: string }).kind).toBe(
      "repair-registration",
    );
  });

  test("virtual self-host lifecycle covers command generation, remote registration, update, and removal", async () => {
    const registry = new InMemoryDeviceRegistry();
    const managerTaskStore = createInMemoryManagerTaskStore();
    const deviceUpdateQueue = createMemoryUpdateQueueStore();
    const calls: MockDaemonCall[] = [];
    const updateOrder: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
          headers[key] = value;
        }
      }
      calls.push({
        method: init?.method ?? "GET",
        url,
        headers,
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      const path = new URL(url).pathname;
      if (path === "/healthz") {
        return Response.json({ ok: true, version: "0.0.0" });
      }
      if (path === "/system/update") {
        updateOrder.push("device");
        return Response.json({ ok: true, state: "running", message: "update queued" });
      }
      if (path === "/system/uninstall") {
        return Response.json({ ok: true, removed: true });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const app = createSiteApp({
      registry,
      token: TOKEN,
      fetchImpl,
      managerTaskStore,
      deviceUpdateQueue,
      selfHostUrl: "http://server.local:18193",
      build: {
        version: "0.0.0",
        commit: "local",
        shortCommit: "local",
        dirty: false,
        source: "package",
      },
      selfServerUpdater: {
        async status() {
          return { state: "idle", updateAvailable: true };
        },
        async update() {
          updateOrder.push("server");
          return { supported: true, started: true, pid: 1234, status: { state: "running" } };
        },
      },
      selfServerProcess: {
        async status() {
          return {
            scope: "server",
            kind: "site-server",
            build: {
              version: "0.0.0",
              commit: "local",
              shortCommit: "local",
              dirty: false,
              source: "package",
            },
            pid: 1234,
            startedAt: new Date(0).toISOString(),
            uptimeMs: 1000,
            platform: process.platform,
            arch: process.arch,
          };
        },
        async restart() {
          return { supported: true, accepted: true, message: "restart accepted", pid: 1235 };
        },
      },
    });

    const commandRes = await app.fetch(authedRequest("GET", "/api/self/register-other-pc-command"));
    expect(commandRes.status).toBe(200);
    const command = (await commandRes.json()) as { command?: string; preferredUrl?: string };
    expect(command.command).toContain("install-connector.ps1");
    expect(command.command).toContain("-SiteToken");
    expect(command.preferredUrl).toContain(":18193");

    const registerRes = await app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        authToken: "daemon-token",
        label: "Remote PC",
      }),
    );
    expect(registerRes.status).toBe(201);
    const device = (await registerRes.json()) as { id: string; label: string };
    expect(device.label).toBe("Remote PC");

    const updateRes = await app.fetch(
      authedRequest("POST", "/api/manager/update/all", {
        dryRun: false,
        requestedBy: "manager-assistant",
      }),
    );
    expect(updateRes.status).toBe(202);
    const updateTask = (await updateRes.json()) as { kind?: string; state?: string };
    expect(updateTask.kind).toBe("update-all");
    expect(updateTask.state).toBe("running");
    expect(calls.some((call) => call.url === `${DAEMON_URL}/system/update`)).toBe(true);
    expect(updateOrder).toEqual(["device", "server"]);

    const restartRes = await app.fetch(
      authedRequest("POST", "/api/manager/tasks", {
        kind: "restart-server",
        dryRun: false,
        requestedBy: "manager-assistant",
      }),
    );
    expect(restartRes.status).toBe(202);
    expect(((await restartRes.json()) as { state?: string }).state).toBe("succeeded");

    const removeRes = await app.fetch(authedRequest("DELETE", `/api/devices/${device.id}`));
    expect(removeRes.status).toBe(200);
    expect(calls.some((call) => call.url === `${DAEMON_URL}/system/uninstall`)).toBe(true);

    const devicesRes = await app.fetch(authedRequest("GET", "/api/devices"));
    expect(await devicesRes.json()).toEqual([]);
    const tasksRes = await app.fetch(authedRequest("GET", "/api/manager/tasks"));
    expect(((await tasksRes.json()) as { tasks?: unknown[] }).tasks?.length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe("device filesystem proxy", () => {
  test("forwards unrestricted workspace browse scope to the daemon", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "test",
    });
    const res = await setup.app.fetch(
      authedRequest(
        "GET",
        `/api/devices/${device.id}/fs/list?path=${encodeURIComponent("C:\\Users")}&workspaceScope=unrestricted`,
      ),
    );
    expect(res.status).toBe(200);
    expect(setup.calls[0]?.url).toBe(
      `${DAEMON_URL}/fs/list?path=C%3A%5CUsers&workspaceScope=unrestricted`,
    );
    expect(setup.calls[0]?.headers.authorization).toBe("Bearer daemon-token");
  });

  test("forwards includeFiles only when requested for manager verification", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "test",
    });
    const res = await setup.app.fetch(
      authedRequest(
        "GET",
        `/api/devices/${device.id}/fs/list?path=${encodeURIComponent("C:\\repo")}&includeFiles=true`,
      ),
    );
    expect(res.status).toBe(200);
    expect(setup.calls[0]?.url).toBe(`${DAEMON_URL}/fs/list?path=C%3A%5Crepo&includeFiles=1`);
  });
});

describe("self-host command helper", () => {
  test("requires auth", async () => {
    const res = await setup.app.fetch(
      new Request("http://site.local/api/self/register-other-pc-command"),
    );
    expect(res.status).toBe(401);

    const removeRes = await setup.app.fetch(
      new Request("http://site.local/api/self/remove-other-pc-command"),
    );
    expect(removeRes.status).toBe(401);
  });

  test("returns a copy-paste command containing this server token", async () => {
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      selfHostUrl: "http://100.64.1.2:18193",
      updateBranch: "api-ai-assistant",
    });
    const res = await app.fetch(
      new Request("http://site.local/api/self/register-other-pc-command", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preferredUrl: string;
      serverPort: number;
      connectorPort: number;
      siteToken: string;
      urls: Array<{ kind: string; url: string }>;
      command: string;
    };
    expect(body.preferredUrl).toBe("http://100.64.1.2:18193");
    expect(body.serverPort).toBe(18193);
    expect(body.connectorPort).toBe(18091);
    expect(body.siteToken).toBe(TOKEN);
    expect(body.command).toContain(
      "https://raw.githubusercontent.com/darkhtk/deskrelay/api-ai-assistant/scripts/install-connector.ps1",
    );
    expect(body.command).toContain("deskrelay-install-connector.ps1");
    expect(body.command).toContain("-Branch 'api-ai-assistant'");
    expect(body.command).not.toMatch(/^\s*#/m);
    expect(body.command).toContain(`-Server '${body.preferredUrl}'`);
    expect(body.command).toContain(`-SiteToken '${TOKEN}'`);
    expect(body.command).toContain("-Port 18091");
    expect(body.command).toContain("-WorkspaceRoots $workspaceRoots");
    expect(body.command).toContain("Invoke-WebRequest");
    expect(body.command).not.toContain("Start-Process");
    expect(body.command).not.toContain("Invoke-RestMethod -Method Post");
    expect(body.preferredUrl).toMatch(/^http:\/\//);
    expect(body.urls.length).toBeGreaterThan(0);
  });

  test("returns a copy-paste command for removing another PC", async () => {
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      selfHostUrl: "http://127.0.0.1:18193",
    });
    const res = await app.fetch(
      new Request("http://site.local/api/self/remove-other-pc-command", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preferredUrl: string;
      serverPort: number;
      connectorPort: number;
      siteToken: string;
      urls: Array<{ kind: string; url: string }>;
      command: string;
    };
    expect(body.serverPort).toBe(18193);
    expect(body.connectorPort).toBe(18091);
    expect(body.siteToken).toBe(TOKEN);
    expect(body.command).toContain(
      "https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/remove-connector.ps1",
    );
    expect(body.command).toContain("deskrelay-remove-connector.ps1");
    expect(body.command).toContain(`# Server URL: ${body.preferredUrl}`);
    expect(body.command).toContain("# Server port: 18193");
    expect(body.command).toContain("# Connector port: 18091");
    expect(body.command).toContain(`# Site token: ${TOKEN}`);
    expect(body.command).toContain(`-Server '${body.preferredUrl}'`);
    expect(body.command).toContain(`-SiteToken '${TOKEN}'`);
    expect(body.command).toContain("-Port 18091");
    expect(body.preferredUrl).toMatch(/^http:\/\//);
    expect(body.urls.length).toBeGreaterThan(0);
  });

  test("server autostart status and updates are exposed through an authenticated endpoint", async () => {
    let installed = false;
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      selfServerAutostart: {
        async status() {
          return { supported: true, installed, taskName: "DeskRelay Self Server" };
        },
        async setEnabled(enabled) {
          installed = enabled;
          return { supported: true, installed, taskName: "DeskRelay Self Server" };
        },
      },
    });

    const unauth = await app.fetch(new Request("http://site.local/api/self/autostart"));
    expect(unauth.status).toBe(401);

    const initial = await app.fetch(
      new Request("http://site.local/api/self/autostart", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(initial.status).toBe(200);
    expect((await initial.json()).installed).toBe(false);

    const enabled = await app.fetch(
      new Request("http://site.local/api/self/autostart", {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).installed).toBe(true);
  });

  test("server update starts through an authenticated endpoint", async () => {
    let calls = 0;
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      selfServerUpdater: {
        async status() {
          return { state: "running", logPath: "update.log" } as const;
        },
        async update() {
          calls += 1;
          return {
            supported: true,
            started: true,
            logPath: "update.log",
            status: { state: "running", logPath: "update.log" } as const,
          };
        },
      },
    });

    const unauth = await app.fetch(new Request("http://site.local/api/self/update"));
    expect(unauth.status).toBe(401);

    const res = await app.fetch(
      new Request("http://site.local/api/self/update", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(res.status).toBe(202);
    expect(calls).toBe(1);
    expect(await res.json()).toEqual({
      supported: true,
      started: true,
      logPath: "update.log",
      status: { state: "running", logPath: "update.log" },
    });

    const status = await app.fetch(
      new Request("http://site.local/api/self/update/status", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ state: "running", logPath: "update.log" });
  });

  test("install reports are accepted and listed through authenticated endpoints", async () => {
    const reports: unknown[] = [];
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: TOKEN,
      installReportStore: {
        async list() {
          return reports as never;
        },
        async add(input) {
          const report = {
            id: "install_1",
            receivedAt: "2026-05-11T00:00:00.000Z",
            status: "failed",
            steps: (input as { steps?: unknown[] }).steps ?? [],
          };
          reports.unshift(report);
          return report as never;
        },
      },
    });

    const unauth = await app.fetch(new Request("http://site.local/api/self/install-reports"));
    expect(unauth.status).toBe(401);

    const posted = await app.fetch(
      new Request("http://site.local/api/self/install-reports", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          status: "failed",
          steps: [{ id: "firewall", label: "Firewall", status: "failed", summary: "blocked" }],
        }),
      }),
    );
    expect(posted.status).toBe(201);

    const listed = await app.fetch(
      new Request("http://site.local/api/self/install-reports", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).reports).toHaveLength(1);
  });
});

describe("device connector update queue", () => {
  test("queues connector update when a registered device is offline", async () => {
    const registry = new InMemoryDeviceRegistry();
    const queue = createMemoryUpdateQueueStore();
    const app = createSiteApp({
      registry,
      token: TOKEN,
      deviceUpdateQueue: queue,
      selfHostUrl: "http://100.64.1.2:18193",
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });
    const device = registry.register({
      daemonUrl: DAEMON_URL,
      label: "Office",
      authToken: "daemon-token",
    });

    const res = await app.fetch(
      new Request(`http://site.local/api/devices/${device.id}/system/update`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as { state?: string; fallbackCommand?: string };
    expect(body.state).toBe("pending_until_device_online");
    expect(body.fallbackCommand).toContain("-SiteToken");

    const listed = await app.fetch(
      new Request("http://site.local/api/devices/update-queue", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(listed.status).toBe(200);
    const payload = (await listed.json()) as { entries: StoredDeviceUpdateEntry[] };
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]?.deviceId).toBe(device.id);
    expect(payload.entries[0]?.state).toBe("pending_until_device_online");
  });

  test("retries a queued connector update when diagnostics can reach the daemon", async () => {
    const registry = new InMemoryDeviceRegistry();
    const queue = createMemoryUpdateQueueStore();
    let updateCalls = 0;
    const app = createSiteApp({
      registry,
      token: TOKEN,
      deviceUpdateQueue: queue,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/status")) {
          return Response.json({ ok: true, build: { shortCommit: "old" } });
        }
        if (url.endsWith("/system/update")) {
          updateCalls += 1;
          return Response.json({
            ok: true,
            state: "succeeded",
            changed: true,
            before: { shortCommit: "old" },
            after: { shortCommit: "new" },
          });
        }
        return Response.json({ ok: true });
      },
    });
    const device = registry.register({
      daemonUrl: DAEMON_URL,
      label: "Office",
      authToken: "daemon-token",
    });
    await queue.upsert({
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      state: "pending_until_device_online",
      requestedAt: "2026-05-11T00:00:00.000Z",
      error: "cannot reach daemon",
    });

    const res = await app.fetch(
      new Request(`http://site.local/api/devices/${device.id}/diagnostics`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updateCalls).toBe(1);
    expect((await queue.get(device.id))?.state).toBe("succeeded");
  });

  test("adds a fallback command to legacy branch-mismatch queue entries", async () => {
    const registry = new InMemoryDeviceRegistry();
    const queue = createMemoryUpdateQueueStore();
    const app = createSiteApp({
      registry,
      token: TOKEN,
      deviceUpdateQueue: queue,
      selfHostUrl: "http://100.64.1.2:18193",
    });
    const device = registry.register({
      daemonUrl: DAEMON_URL,
      label: "Office",
      authToken: "daemon-token",
    });
    await queue.upsert({
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      state: "failed",
      requestedAt: "2026-05-11T00:00:00.000Z",
      error:
        "connector updated main instead of api-ai-assistant. Re-run the registration command for this server branch.",
    });

    const res = await app.fetch(
      new Request("http://site.local/api/devices/update-queue", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { entries: StoredDeviceUpdateEntry[] };
    expect(payload.entries[0]?.fallbackCommand).toContain("deskrelay-install-connector.ps1");
    expect(payload.entries[0]?.fallbackCommand).toContain(`-SiteToken '${TOKEN}'`);
  });

  test("manager update plan does not let stale succeeded queue entries hide connector drift", async () => {
    const queue = createMemoryUpdateQueueStore();
    const setup = makeApp({
      deviceUpdateQueue: queue,
      build: {
        version: "0.0.0",
        commit: "server-commit",
        shortCommit: "server",
        dirty: false,
        source: "git",
      },
    });
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      label: "Office",
      authToken: "daemon-token",
    });
    await queue.upsert({
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      state: "succeeded",
      requestedAt: "2026-05-11T00:00:00.000Z",
    });
    setup.setMockResponse((req) => {
      if (req.url.endsWith("/install/status")) {
        return Response.json({
          scope: "device",
          targetId: device.id,
          targetLabel: device.label,
          generatedAt: "2026-05-11T00:00:00.000Z",
          build: {
            version: "0.0.0",
            commit: "old-connector-commit",
            shortCommit: "old",
            dirty: false,
            source: "git",
          },
          installed: true,
          running: true,
          update: { state: "succeeded", updateAvailable: false, changed: false },
          summary: { severity: "ok", message: "Connector is installed and running." },
        });
      }
      return Response.json({ ok: true });
    });

    const res = await setup.app.fetch(authedRequest("GET", "/api/manager/update/plan"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items?: Array<{ scope?: string; targetId?: string; action?: string; reason?: string }>;
    };
    const item = body.items?.find(
      (entry) => entry.scope === "device" && entry.targetId === device.id,
    );
    expect(item).toMatchObject({
      action: "update",
      reason: "Connector update is available.",
    });
  });
});

describe("doctor endpoints", () => {
  test("GET /api/self/doctor reports missing registered devices as a warning", async () => {
    const res = await setup.app.fetch(authedRequest("GET", "/api/self/doctor"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scope: string;
      checks: Array<{ id: string; severity: string; summary: string }>;
    };
    expect(body.scope).toBe("server");
    expect(findCheck(body.checks, "server.token")?.severity).toBe("ok");
    expect(findCheck(body.checks, "server.security-boundary")?.severity).toBe("ok");
    expect(findCheck(body.checks, "server.devices")?.severity).toBe("warn");
  });

  test("GET /api/devices/:id/doctor distinguishes saved daemon token mismatch", async () => {
    const regRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        label: "Office",
        authToken: "saved-token",
      }),
    );
    const device = (await regRes.json()) as { id: string };

    setup.setMockResponse(
      () =>
        new Response(JSON.stringify({ error: "bad token" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await setup.app.fetch(authedRequest("GET", `/api/devices/${device.id}/doctor`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scope: string;
      checks: Array<{ id: string; severity: string; summary: string }>;
    };
    expect(body.scope).toBe("device");
    expect(findCheck(body.checks, "device.daemon")?.severity).toBe("error");
    expect(findCheck(body.checks, "device.daemon")?.summary).toContain("rejected");
    expect(findCheck(body.checks, "device.claude")?.severity).toBe("unknown");
    expect(setup.calls.at(-1)?.headers.authorization).toBe("Bearer saved-token");
  });

  test("GET /api/devices/:id/doctor surfaces an unloaded Claude behavior", async () => {
    const regRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        label: "Office",
        authToken: "saved-token",
      }),
    );
    const device = (await regRes.json()) as { id: string };
    setup.setMockResponse(() =>
      Response.json({
        ok: true,
        startedAt: "2026-04-30T00:00:00.000Z",
        behaviors: [],
        workspaceRoots: { mode: "restricted", roots: ["C:\\Users\\me\\Projects"] },
        diagnostics: {
          remoteClaudeLoaded: false,
          approvalsHookEnabled: true,
          pendingApprovals: 0,
        },
      }),
    );

    const res = await setup.app.fetch(authedRequest("GET", `/api/devices/${device.id}/doctor`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      checks: Array<{ id: string; severity: string; summary: string }>;
    };
    expect(findCheck(body.checks, "device.daemon")?.severity).toBe("ok");
    expect(findCheck(body.checks, "device.claude")?.severity).toBe("error");
    expect(findCheck(body.checks, "device.workspace")?.severity).toBe("ok");
    expect(findCheck(body.checks, "device.security-boundary")?.summary).toContain(
      "restricted workspace access",
    );
    expect(findCheck(body.checks, "device.claude")?.summary).not.toContain("remote-claude");
  });

  test("GET /api/devices/:id/doctor flags a remote registration with a localhost-only connector", async () => {
    setup.setMockResponse(() =>
      Response.json({
        ok: true,
        startedAt: "2026-04-30T00:00:00.000Z",
        listening: { host: "127.0.0.1", port: 18091 },
        behaviors: [{ name: "remote-claude" }],
        workspaceRoots: { mode: "restricted", roots: ["C:\\Users\\me\\Projects"] },
        diagnostics: {
          remoteClaudeLoaded: true,
          approvalsHookEnabled: true,
          pendingApprovals: 0,
        },
      }),
    );

    const regRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: "http://100.64.0.5:18091",
        label: "Remote PC",
        authToken: "saved-token",
      }),
    );
    const device = (await regRes.json()) as { id: string };

    const res = await setup.app.fetch(authedRequest("GET", `/api/devices/${device.id}/doctor`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      checks: Array<{ id: string; severity: string; summary: string; userVisible?: boolean }>;
    };
    const check = findCheck(body.checks, "device.listen-bind");
    expect(check?.severity).toBe("error");
    expect(check?.summary).toContain("127.0.0.1");
    expect(check?.userVisible).toBe(true);
  });
});

describe("device CRUD", () => {
  test("POST /api/devices registers and returns 201", async () => {
    const res = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        label: "Office",
      }),
    );
    expect(res.status).toBe(201);
    const device = await res.json();
    expect(device.label).toBe("Office");
    expect(device.daemonUrl).toBe(DAEMON_URL);
  });

  test("POST /api/devices stores daemon token without exposing it", async () => {
    const res = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        label: "Office",
        authToken: "daemon-token",
      }),
    );
    expect(res.status).toBe(201);
    const device = await res.json();
    expect(device.authToken).toBeUndefined();
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/status`);
    expect(setup.calls.at(-1)?.headers.authorization).toBe("Bearer daemon-token");

    await setup.app.fetch(authedRequest("GET", `/api/devices/${device.id}/behaviors`));
    expect(setup.calls.at(-1)?.headers.authorization).toBe("Bearer daemon-token");
  });

  test("POST /api/devices rejects daemon token failures before saving", async () => {
    setup.setMockResponse(
      () =>
        new Response(JSON.stringify({ error: "invalid token" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        authToken: "wrong-token",
      }),
    );
    expect(res.status).toBe(400);
    expect(setup.registry.list()).toHaveLength(0);
  });

  test("POST without daemonUrl returns 400", async () => {
    const res = await setup.app.fetch(authedRequest("POST", "/api/devices", { label: "x" }));
    expect(res.status).toBe(400);
  });

  test("POST duplicate refreshes label and daemon token in place", async () => {
    const firstRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        label: "Old",
        authToken: "old-token",
      }),
    );
    const first = await firstRes.json();
    const dup = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: `${DAEMON_URL}/`,
        label: "New",
        authToken: "new-token",
      }),
    );
    expect(dup.status).toBe(201);
    const refreshed = await dup.json();
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.label).toBe("New");
    expect(setup.registry.list()).toHaveLength(1);

    await setup.app.fetch(authedRequest("GET", `/api/devices/${first.id}/behaviors`));
    expect(setup.calls.at(-1)?.headers.authorization).toBe("Bearer new-token");
  });

  test("POST duplicate daemon token refreshes a changed connector URL in place", async () => {
    const firstRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: "http://127.0.0.1:18291",
        label: "Local dev (HOMEDEV)",
        authToken: "same-token",
      }),
    );
    const first = await firstRes.json();
    const secondRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: "http://127.0.0.1:18191",
        label: "Local dev (HOMEDEV)",
        authToken: "same-token",
      }),
    );
    expect(secondRes.status).toBe(201);
    const second = await secondRes.json();
    expect(second.id).toBe(first.id);
    expect(second.daemonUrl).toBe("http://127.0.0.1:18191");

    const listRes = await setup.app.fetch(authedRequest("GET", "/api/devices"));
    const list = await listRes.json();
    expect(list).toHaveLength(1);
  });

  test("GET /api/devices lists registered", async () => {
    await setup.app.fetch(authedRequest("POST", "/api/devices", { daemonUrl: DAEMON_URL }));
    const listRes = await setup.app.fetch(authedRequest("GET", "/api/devices"));
    const list = await listRes.json();
    expect(list).toHaveLength(1);
  });

  test("DELETE /api/devices/:id unregisters", async () => {
    const regRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        authToken: "daemon-token",
      }),
    );
    const reg = await regRes.json();
    const del = await setup.app.fetch(authedRequest("DELETE", `/api/devices/${reg.id}`));
    expect(del.status).toBe(200);
    const deleted = (await del.json()) as {
      ok: boolean;
      cleanup: { attempted: boolean; ok: boolean; status: number };
    };
    expect(deleted.cleanup).toEqual({ attempted: true, ok: true, status: 200 });
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/system/uninstall`);
    expect(setup.calls.at(-1)?.method).toBe("POST");
    expect(setup.calls.at(-1)?.headers.authorization).toBe("Bearer daemon-token");
    expect(setup.calls.at(-1)?.body).toBe(JSON.stringify({ removeRepo: true }));
    const listRes = await setup.app.fetch(authedRequest("GET", "/api/devices"));
    const list = await listRes.json();
    expect(list).toEqual([]);
  });

  test("DELETE /api/devices/:id still unregisters when daemon cleanup fails", async () => {
    const regRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", { daemonUrl: DAEMON_URL }),
    );
    const reg = await regRes.json();
    setup.setMockResponse((req) => {
      if (req.url.endsWith("/system/uninstall")) {
        throw new Error("offline");
      }
      return Response.json({ ok: true });
    });
    const del = await setup.app.fetch(authedRequest("DELETE", `/api/devices/${reg.id}`));
    expect(del.status).toBe(200);
    const deleted = (await del.json()) as {
      ok: boolean;
      cleanup: { attempted: boolean; ok: boolean; error?: string };
    };
    expect(deleted.cleanup).toEqual({ attempted: true, ok: false, error: "offline" });
    expect(setup.registry.list()).toHaveLength(0);
  });

  test("DELETE /api/devices unregisters all devices and uninstalls remote PCs before the server PC", async () => {
    const serverRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: "http://127.0.0.1:18191",
        label: "Local dev (HOMEDEV)",
        authToken: "server-token",
      }),
    );
    const remoteRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", {
        daemonUrl: DAEMON_URL,
        label: "Remote PC",
        authToken: "remote-token",
      }),
    );
    const server = await serverRes.json();
    const remote = await remoteRes.json();

    const del = await setup.app.fetch(authedRequest("DELETE", "/api/devices"));
    expect(del.status).toBe(200);
    const deleted = (await del.json()) as {
      ok: boolean;
      cleanup: Array<{
        id: string;
        label: string;
        daemonUrl: string;
        cleanup: { attempted: boolean; ok: boolean; status: number };
      }>;
    };

    expect(deleted.ok).toBe(true);
    expect(deleted.cleanup.map((entry) => entry.id)).toEqual([remote.id, server.id]);
    expect(deleted.cleanup.every((entry) => entry.cleanup.ok)).toBe(true);

    const uninstallCalls = setup.calls.filter((call) => call.url.endsWith("/system/uninstall"));
    expect(uninstallCalls.map((call) => call.url)).toEqual([
      `${DAEMON_URL}/system/uninstall`,
      "http://127.0.0.1:18191/system/uninstall",
    ]);
    expect(uninstallCalls.map((call) => call.headers.authorization)).toEqual([
      "Bearer remote-token",
      "Bearer server-token",
    ]);
    expect(setup.registry.list()).toEqual([]);
  });

  test("DELETE unknown id returns 404", async () => {
    const res = await setup.app.fetch(authedRequest("DELETE", "/api/devices/nope"));
    expect(res.status).toBe(404);
  });
});

describe("device update proxy", () => {
  test("POST /api/devices/:id/system/update forwards to daemon with saved token", async () => {
    const branchSetup = makeApp({ updateBranch: "api-ai-assistant" });
    const device = branchSetup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "Office",
    });
    branchSetup.setMockResponse(() =>
      Response.json({ ok: true, restartScheduled: true, changed: true }),
    );

    const res = await branchSetup.app.fetch(
      authedRequest("POST", `/api/devices/${device.id}/system/update`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, restartScheduled: true, changed: true });
    expect(branchSetup.calls.at(-1)?.method).toBe("POST");
    expect(branchSetup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/system/update`);
    expect(branchSetup.calls.at(-1)?.headers.authorization).toBe("Bearer daemon-token");
    expect(JSON.parse(branchSetup.calls.at(-1)?.body ?? "{}")).toEqual({
      branch: "api-ai-assistant",
    });
  });

  test("old daemon update route returns a registration fallback command", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "Office",
    });
    setup.setMockResponse(() => Response.json({ error: "not found" }, { status: 404 }));

    const res = await setup.app.fetch(
      authedRequest("POST", `/api/devices/${device.id}/system/update`),
    );
    expect(res.status).toBe(424);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      daemonStatus: number;
      recoveryKind: string;
      retryable: boolean;
      fallbackCommand: string;
    };
    expect(body.ok).toBe(false);
    expect(body.daemonStatus).toBe(404);
    expect(body.recoveryKind).toBe("registration_required");
    expect(body.retryable).toBe(false);
    expect(body.error).toContain("registration command");
    expect(body.fallbackCommand).toContain("deskrelay-install-connector.ps1");
    expect(body.fallbackCommand).toContain(`-SiteToken '${TOKEN}'`);
  });

  test("branch-mismatched connector update is reported as failed with fallback command", async () => {
    const branchSetup = makeApp({ updateBranch: "api-ai-assistant" });
    const device = branchSetup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "Office",
    });
    branchSetup.setMockResponse(() =>
      Response.json({
        ok: true,
        state: "succeeded",
        branch: "main",
        changed: false,
      }),
    );

    const res = await branchSetup.app.fetch(
      authedRequest("POST", `/api/devices/${device.id}/system/update`),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      ok: boolean;
      state: string;
      expectedBranch: string;
      actualBranch: string;
      recoveryKind: string;
      retryable: boolean;
      error: string;
      fallbackCommand: string;
    };
    expect(body.ok).toBe(false);
    expect(body.state).toBe("failed");
    expect(body.expectedBranch).toBe("api-ai-assistant");
    expect(body.actualBranch).toBe("main");
    expect(body.recoveryKind).toBe("branch_mismatch");
    expect(body.retryable).toBe(false);
    expect(body.error).toContain("branch switch required");
    expect(body.fallbackCommand).toContain("-Branch 'api-ai-assistant'");
  });
});

describe("manager session transcript API", () => {
  test("POST /api/manager/sessions/read reads a known device and cwd", async () => {
    const device = setup.registry.register({
      daemonUrl: DAEMON_URL,
      authToken: "daemon-token",
      label: "Remote PC",
    });
    const behaviorBodies: Array<{ method?: string; params?: Record<string, unknown> }> = [];
    setup.setMockResponse(async (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/behaviors") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "x",
          },
        ]);
      }
      if (path === "/behaviors/remote-claude/request") {
        const body = (await req.json()) as { method?: string; params?: Record<string, unknown> };
        behaviorBodies.push(body);
        return Response.json({
          result: {
            sessionId: "session_1",
            cwd: "C:\\repo",
            events: [{ type: "user", message: { content: "hello" } }],
          },
        });
      }
      return Response.json({ ok: true });
    });

    const res = await setup.app.fetch(
      authedRequest("POST", "/api/manager/sessions/read", {
        deviceId: device.id,
        sessionId: "session_1",
        cwd: "C:\\repo",
        maxBytes: 1024,
        eventLimit: 20,
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      device: { id: string };
      behavior: { instanceId: string };
      resolvedCwd: string;
      transcript: { sessionId: string; events: unknown[] };
    };
    expect(body.device.id).toBe(device.id);
    expect(body.behavior.instanceId).toBe("remote-claude");
    expect(body.resolvedCwd).toBe("C:\\repo");
    expect(body.transcript.sessionId).toBe("session_1");
    expect(body.transcript.events).toHaveLength(1);
    expect(behaviorBodies).toEqual([
      {
        method: "sessions.read",
        params: {
          cwd: "C:\\repo",
          sessionId: "session_1",
          maxBytes: 1024,
          eventLimit: 20,
        },
      },
    ]);
    expect(setup.calls.at(-1)?.headers.authorization).toBe("Bearer daemon-token");
  });

  test("POST /api/manager/sessions/read discovers cwd and device from session id", async () => {
    const first = setup.registry.register({
      daemonUrl: "http://daemon-one.test:18091",
      authToken: "token-one",
      label: "First PC",
    });
    const second = setup.registry.register({
      daemonUrl: "http://daemon-two.test:18091",
      authToken: "token-two",
      label: "Second PC",
    });
    const behaviorBodies: Array<{
      host: string;
      method?: string;
      params?: Record<string, unknown>;
    }> = [];
    setup.setMockResponse(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/behaviors") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "x",
          },
        ]);
      }
      if (url.pathname === "/behaviors/remote-claude/request") {
        const body = (await req.json()) as { method?: string; params?: Record<string, unknown> };
        behaviorBodies.push({ host: url.hostname, ...body });
        if (body.method === "sessions.list") {
          return Response.json({
            result:
              url.hostname === "daemon-one.test"
                ? [{ sessionId: "other", cwd: "C:\\one", modifiedAt: "2026-05-12T00:00:00.000Z" }]
                : [
                    {
                      sessionId: "target",
                      cwd: "C:\\two",
                      title: "Target session",
                      modifiedAt: "2026-05-13T00:00:00.000Z",
                    },
                  ],
          });
        }
        return Response.json({
          result: {
            sessionId: "target",
            cwd: "C:\\two",
            events: [{ type: "assistant", message: { content: "found" } }],
          },
        });
      }
      return Response.json({ ok: true });
    });

    const res = await setup.app.fetch(
      authedRequest("POST", "/api/manager/sessions/read", { sessionId: "target" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      device: { id: string };
      resolvedCwd: string;
      session?: { title?: string };
      transcript: { sessionId: string };
      attempts: Array<{ deviceId: string; stage: string }>;
    };
    expect(first.id).not.toBe(second.id);
    expect(body.device.id).toBe(second.id);
    expect(body.resolvedCwd).toBe("C:\\two");
    expect(body.session?.title).toBe("Target session");
    expect(body.transcript.sessionId).toBe("target");
    expect(body.attempts).toEqual([
      expect.objectContaining({ deviceId: first.id, stage: "sessions.list" }),
    ]);
    expect(behaviorBodies.map((entry) => `${entry.host}:${entry.method}`)).toEqual([
      "daemon-one.test:sessions.list",
      "daemon-two.test:sessions.list",
      "daemon-two.test:sessions.read",
    ]);
  });
});

describe("daemon proxy", () => {
  async function registeredDeviceId(): Promise<string> {
    const regRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", { daemonUrl: DAEMON_URL }),
    );
    const reg = await regRes.json();
    return reg.id as string;
  }

  test("GET /api/devices/:id/behaviors → daemon /behaviors", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() =>
      Response.json([{ instanceId: "echo", name: "echo", version: "0.0.1", loadedAt: "x" }]),
    );
    const res = await setup.app.fetch(authedRequest("GET", `/api/devices/${id}/behaviors`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/behaviors`);
  });

  test("POST .../behaviors/load forwards body to daemon", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() =>
      Response.json({ instanceId: "echo", manifest: {}, loadedAt: "x" }, { status: 200 }),
    );
    const res = await setup.app.fetch(
      authedRequest("POST", `/api/devices/${id}/behaviors/load`, {
        packageDir: "/some/dir",
        instanceId: "echo",
      }),
    );
    expect(res.status).toBe(200);
    const last = setup.calls.at(-1);
    expect(last?.method).toBe("POST");
    expect(last?.url).toBe(`${DAEMON_URL}/behaviors/load`);
    expect(JSON.parse(last?.body ?? "{}")).toEqual({
      packageDir: "/some/dir",
      instanceId: "echo",
    });
  });

  test("POST .../request forwards body and returns daemon's response", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() =>
      Response.json({ result: { ok: true, length: 2 } }, { status: 200 }),
    );
    const res = await setup.app.fetch(
      authedRequest("POST", `/api/devices/${id}/behaviors/echo/request`, {
        method: "echo",
        params: { message: "hi" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { ok: true, length: 2 } });
  });

  test("manager-mode behavior requests are forced onto the server connector workspace", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-manager-behavior-"));
    try {
      const serverSetup = makeApp({ managerAssistant: { cwd } });
      const device = serverSetup.registry.register({
        daemonUrl: "http://127.0.0.1:18191",
        authToken: "daemon-token",
        label: "Local dev (HOMEDEV)",
      });
      serverSetup.setMockResponse(() => Response.json({ result: { ok: true } }, { status: 200 }));

      const res = await serverSetup.app.fetch(
        authedRequest("POST", `/api/devices/${device.id}/behaviors/remote-claude/request`, {
          method: "chat",
          params: {
            cwd: "C:\\wrong",
            message: "관리자 작업",
            managerMode: true,
            permissionMode: "default",
            conversationId: "browser-value",
          },
        }),
      );

      expect(res.status).toBe(200);
      const forwarded = JSON.parse(serverSetup.calls.at(-1)?.body ?? "{}") as {
        method?: string;
        params?: Record<string, unknown>;
      };
      expect(forwarded.method).toBe("chat");
      expect(forwarded.params?.cwd).toBe(join(cwd, ".deskrelay", "manager-assistant"));
      expect(forwarded.params?.permissionMode).toBe("bypassPermissions");
      expect(forwarded.params?.securityProfile).toBe("relaxed");
      expect(forwarded.params?.managerSiteToken).toBe(TOKEN);
      expect(forwarded.params?.managerApiBaseUrl).toBe("http://site.local");
      expect(forwarded.params?.managerRepoRoot).toBe(cwd);
      expect(forwarded.params?.managerWorkspaceScope).toBe("unrestricted");
      expect(forwarded.params?.managerInstructionsPath).toBe(
        join(cwd, ".deskrelay", "manager-assistant", "CLAUDE.md"),
      );
      expect(forwarded.params?.conversationId).toBe("browser-value");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager-mode behavior requests resume the persisted manager conversation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-manager-behavior-session-"));
    try {
      const serverSetup = makeApp({ managerAssistant: { cwd } });
      const device = serverSetup.registry.register({
        daemonUrl: "http://127.0.0.1:18191",
        authToken: "daemon-token",
        label: "Local dev (HOMEDEV)",
      });
      await serverSetup.app.fetch(
        authedRequest("PUT", "/api/manager/assistant/conversation", {
          sessionId: "persisted-manager-session",
          cwd: join(cwd, ".deskrelay", "manager-assistant"),
        }),
      );
      serverSetup.setMockResponse(() => Response.json({ result: { ok: true } }, { status: 200 }));

      const res = await serverSetup.app.fetch(
        authedRequest("POST", `/api/devices/${device.id}/behaviors/remote-claude/request`, {
          method: "chat",
          params: {
            cwd: "C:\\wrong",
            message: "manager follow-up",
            managerMode: true,
          },
        }),
      );

      expect(res.status).toBe(200);
      const forwarded = JSON.parse(serverSetup.calls.at(-1)?.body ?? "{}") as {
        params?: Record<string, unknown>;
      };
      expect(forwarded.params?.sessionId).toBe("persisted-manager-session");
      expect(forwarded.params?.conversationId).toBe("deskrelay-manager-assistant");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("manager-mode behavior requests are rejected for non-server devices", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "deskrelay-manager-behavior-block-"));
    try {
      const serverSetup = makeApp({ managerAssistant: { cwd } });
      const device = serverSetup.registry.register({
        daemonUrl: "http://100.64.1.44:18091",
        authToken: "daemon-token",
        label: "Remote PC",
      });
      const res = await serverSetup.app.fetch(
        authedRequest("POST", `/api/devices/${device.id}/behaviors/remote-claude/request`, {
          method: "chat",
          params: { cwd: "C:\\repo", message: "x", managerMode: true },
        }),
      );

      expect(res.status).toBe(400);
      expect(serverSetup.calls).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("DELETE .../behaviors/:instance proxies", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() => Response.json({ ok: true }, { status: 200 }));
    const res = await setup.app.fetch(authedRequest("DELETE", `/api/devices/${id}/behaviors/echo`));
    expect(res.status).toBe(200);
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/behaviors/echo`);
    expect(setup.calls.at(-1)?.method).toBe("DELETE");
  });

  test("GET .../instructions proxies cwd to daemon", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() => Response.json({ cwd: "C:\\repo", sources: [] }, { status: 200 }));
    const res = await setup.app.fetch(
      authedRequest("GET", `/api/devices/${id}/instructions?cwd=${encodeURIComponent("C:\\repo")}`),
    );
    expect(res.status).toBe(200);
    expect(setup.calls.at(-1)?.url).toBe(
      `${DAEMON_URL}/instructions?cwd=${encodeURIComponent("C:\\repo")}`,
    );
  });

  test("PUT .../instructions/:scope forwards instruction edits", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() =>
      Response.json({ scope: "project", content: "rules", exists: true }, { status: 200 }),
    );
    const res = await setup.app.fetch(
      authedRequest("PUT", `/api/devices/${id}/instructions/project`, {
        cwd: "C:\\repo",
        content: "rules",
        expectedHash: "missing",
      }),
    );
    expect(res.status).toBe(200);
    const last = setup.calls.at(-1);
    expect(last?.method).toBe("PUT");
    expect(last?.url).toBe(`${DAEMON_URL}/instructions/project`);
    expect(JSON.parse(last?.body ?? "{}")).toEqual({
      cwd: "C:\\repo",
      content: "rules",
      expectedHash: "missing",
    });
  });

  test("DELETE .../instructions/:scope forwards instruction deletion", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() =>
      Response.json({ scope: "local", content: "", exists: false }, { status: 200 }),
    );
    const res = await setup.app.fetch(
      authedRequest("DELETE", `/api/devices/${id}/instructions/local`, {
        cwd: "C:\\repo",
        expectedHash: "abc",
      }),
    );
    expect(res.status).toBe(200);
    const last = setup.calls.at(-1);
    expect(last?.method).toBe("DELETE");
    expect(last?.url).toBe(`${DAEMON_URL}/instructions/local`);
    expect(JSON.parse(last?.body ?? "{}")).toEqual({ cwd: "C:\\repo", expectedHash: "abc" });
  });

  test("GET .../files/preview proxies image bytes without JSON decoding", async () => {
    const id = await registeredDeviceId();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    setup.setMockResponse((req) => {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/files/preview");
      expect(url.searchParams.get("path")).toBe("shot.png");
      expect(url.searchParams.get("cwd")).toBe("C:\\repo");
      expect(url.searchParams.get("workspaceScope")).toBe("unrestricted");
      return new Response(png, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(png.byteLength),
          "set-cookie": "should-not-forward=1",
        },
      });
    });

    const res = await setup.app.fetch(
      authedRequest(
        "GET",
        `/api/devices/${id}/files/preview?path=${encodeURIComponent(
          "shot.png",
        )}&cwd=${encodeURIComponent("C:\\repo")}&workspaceScope=unrestricted`,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });

  test("daemon unreachable returns 502", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() => {
      throw new Error("ECONNREFUSED");
    });
    const res = await setup.app.fetch(authedRequest("GET", `/api/devices/${id}/behaviors`));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/cannot reach daemon/);
  });

  test("proxying to unknown device returns 404", async () => {
    const res = await setup.app.fetch(authedRequest("GET", "/api/devices/missing/behaviors"));
    expect(res.status).toBe(404);
  });
});

describe("SSE proxy", () => {
  test("forwards Last-Event-ID header to daemon", async () => {
    const regRes = await setup.app.fetch(
      authedRequest("POST", "/api/devices", { daemonUrl: DAEMON_URL }),
    );
    const reg = await regRes.json();
    setup.setMockResponse(
      () =>
        new Response("data: hello\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const req = authedRequest(
      "GET",
      `/api/devices/${reg.id}/events/spaces/${encodeURIComponent("echo.default:e")}/stream`,
    );
    req.headers.set("Last-Event-ID", "42");
    const res = await setup.app.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(setup.calls.at(-1)?.headers["Last-Event-ID"]).toBe("42");
  });
});
