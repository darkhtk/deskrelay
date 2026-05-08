import { beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { createSiteApp } from "../src/app.ts";
import { InMemoryDeviceRegistry } from "../src/device-registry.ts";

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

function makeApp(): MockSetup {
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

  const app = createSiteApp({ registry, token: TOKEN, fetchImpl });
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

let setup: MockSetup;

beforeEach(() => {
  setup = makeApp();
});

describe("/healthz (unauth)", () => {
  test("reports ok + device count", async () => {
    const res = await setup.app.fetch(new Request("http://site.local/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "0.0.0", devices: 0 });
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
      "https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/install-connector.ps1",
    );
    expect(body.command).toContain("deskrelay-install-connector.ps1");
    expect(body.command).toContain(`# Server URL: ${body.preferredUrl}`);
    expect(body.command).toContain("# Server port: 18193");
    expect(body.command).toContain("# Connector port: 18091");
    expect(body.command).toContain(`# Site token: ${TOKEN}`);
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

  test("POST duplicate returns 409", async () => {
    await setup.app.fetch(authedRequest("POST", "/api/devices", { daemonUrl: DAEMON_URL }));
    const dup = await setup.app.fetch(
      authedRequest("POST", "/api/devices", { daemonUrl: DAEMON_URL }),
    );
    expect(dup.status).toBe(409);
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

  test("DELETE unknown id returns 404", async () => {
    const res = await setup.app.fetch(authedRequest("DELETE", "/api/devices/nope"));
    expect(res.status).toBe(404);
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

  test("DELETE .../behaviors/:instance proxies", async () => {
    const id = await registeredDeviceId();
    setup.setMockResponse(() => Response.json({ ok: true }, { status: 200 }));
    const res = await setup.app.fetch(authedRequest("DELETE", `/api/devices/${id}/behaviors/echo`));
    expect(res.status).toBe(200);
    expect(setup.calls.at(-1)?.url).toBe(`${DAEMON_URL}/behaviors/echo`);
    expect(setup.calls.at(-1)?.method).toBe("DELETE");
  });

  test("GET .../files/preview proxies image bytes without JSON decoding", async () => {
    const id = await registeredDeviceId();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    setup.setMockResponse((req) => {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/files/preview");
      expect(url.searchParams.get("path")).toBe("shot.png");
      expect(url.searchParams.get("cwd")).toBe("C:\\repo");
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
        )}&cwd=${encodeURIComponent("C:\\repo")}`,
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
