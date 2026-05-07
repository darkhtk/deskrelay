import { describe, expect, test } from "bun:test";
import type { InstallLoginTaskOptions } from "../src/login-task.ts";
import { registerSelf } from "../src/self-register.ts";

describe("registerSelf", () => {
  test("starts a wildcard-bound login task, verifies daemon URLs, and registers with the server", async () => {
    const port = 19091;
    let installOptions: InstallLoginTaskOptions | undefined;
    const calls: Array<{ method: string; url: string; body?: string; authorization?: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const call: { method: string; url: string; body?: string; authorization?: string } = {
        method: init?.method ?? "GET",
        url,
      };
      if (typeof init?.body === "string") call.body = init.body;
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (authorization) call.authorization = authorization;
      calls.push(call);
      if (url.endsWith("/status")) return Response.json({ ok: true });
      if (init?.method === "GET" && url.endsWith("/api/devices")) return Response.json([]);
      if (init?.method === "POST" && url.endsWith("/api/devices")) {
        return Response.json({ id: "dev_1" }, { status: 201 });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as typeof fetch;
    const installTask = async (options: InstallLoginTaskOptions = {}) => {
      installOptions = options;
      return {
        supported: true,
        installed: true,
        started: true,
        taskName: "DeskRelay Connector",
        scriptPath: "task.ps1",
        logPath: "connector.log",
      };
    };

    const result = await registerSelf({
      serverUrl: "http://deskrelay.test:18193/",
      siteToken: "site-token",
      port,
      advertiseHost: "100.64.1.2",
      workspaceRoots: "C:\\Users\\me\\Projects",
      label: "DESKTOP-1",
      fetchImpl,
      installTask,
      loadAuthToken: async () => ({ token: "daemon-token", path: "auth.json", created: false }),
      stopRecordedDaemon: async () => undefined,
      stopPortOwner: async () => false,
      timeoutMs: 10,
    });

    expect(result.daemonUrl).toBe(`http://100.64.1.2:${port}`);
    expect(installOptions?.start).toBe(true);
    expect(installOptions?.launch?.env).toMatchObject({
      CR_CONNECTOR_HOST: "0.0.0.0",
      CR_CONNECTOR_PORT: String(port),
      CR_CONNECTOR_WORKSPACE_ROOTS: "C:\\Users\\me\\Projects",
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
      `GET http://100.64.1.2:${port}/status`,
      "GET http://deskrelay.test:18193/api/devices",
      "POST http://deskrelay.test:18193/api/devices",
    ]);
    const post = calls.at(-1);
    expect(post?.authorization).toBe("Bearer site-token");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      daemonUrl: `http://100.64.1.2:${port}`,
      label: "DESKTOP-1",
      authToken: "daemon-token",
    });
  });

  test("stops a stale local connector before installing the login task", async () => {
    const port = 19092;
    let staleConnectorStopped = false;
    let installStartedAfterStop = false;
    const calls: Array<{ method: string; url: string; authorization?: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      calls.push({
        method: init?.method ?? "GET",
        url,
        ...(authorization ? { authorization } : {}),
      });
      if (url === `http://127.0.0.1:${port}/status` && !staleConnectorStopped) {
        return Response.json({ error: "wrong token" }, { status: 401 });
      }
      if (url.endsWith("/status")) return Response.json({ ok: true });
      if (init?.method === "GET" && url.endsWith("/api/devices")) return Response.json([]);
      if (init?.method === "POST" && url.endsWith("/api/devices")) {
        return Response.json({ id: "dev_1" }, { status: 201 });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as typeof fetch;

    await registerSelf({
      serverUrl: "http://deskrelay.test:18193/",
      siteToken: "site-token",
      port,
      advertiseHost: "100.64.1.2",
      fetchImpl,
      installTask: async () => {
        installStartedAfterStop = staleConnectorStopped;
        return {
          supported: true,
          installed: true,
          started: true,
          taskName: "DeskRelay Connector",
          scriptPath: "task.ps1",
          logPath: "connector.log",
        };
      },
      loadAuthToken: async () => ({ token: "daemon-token", path: "auth.json", created: false }),
      stopRecordedDaemon: async () => undefined,
      stopPortOwner: async (port) => {
        expect(port).toBe(19092);
        staleConnectorStopped = true;
        return true;
      },
      timeoutMs: 10,
    });

    expect(staleConnectorStopped).toBe(true);
    expect(installStartedAfterStop).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
      `GET http://100.64.1.2:${port}/status`,
      "GET http://deskrelay.test:18193/api/devices",
      "POST http://deskrelay.test:18193/api/devices",
    ]);
  });
});
