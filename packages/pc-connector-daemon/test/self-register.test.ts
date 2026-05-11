import { describe, expect, test } from "bun:test";
import type { InstallLoginTaskOptions } from "../src/login-task.ts";
import { RegisterSelfError, registerSelf } from "../src/self-register.ts";

describe("registerSelf", () => {
  test("starts a wildcard-bound login task, verifies daemon URLs, and registers with the server", async () => {
    const port = 19091;
    let installOptions: InstallLoginTaskOptions | undefined;
    let registered = false;
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
      if (init?.method === "GET" && url.endsWith("/api/devices")) {
        return Response.json(
          registered ? [{ id: "dev_1", daemonUrl: `http://100.64.1.2:${port}` }] : [],
        );
      }
      if (init?.method === "POST" && url.endsWith("/api/devices")) {
        registered = true;
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
    expect(result.report.status).toBe("succeeded");
    expect(result.report.steps.map((step) => step.id)).toContain("server-registration");
    expect(result.report.steps.every((step) => step.source === "register-self")).toBe(true);
    expect(result.report.steps.every((step) => typeof step.severity === "string")).toBe(true);
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
      "GET http://deskrelay.test:18193/api/devices",
    ]);
    const post = calls.find(
      (call) => call.method === "POST" && call.url === "http://deskrelay.test:18193/api/devices",
    );
    expect(post?.authorization).toBe("Bearer site-token");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      daemonUrl: `http://100.64.1.2:${port}`,
      label: "DESKTOP-1",
      authToken: "daemon-token",
    });
  });

  test("stops a stale local connector before installing the login task", async () => {
    const port = 19092;
    let staleTaskRemoved = false;
    let staleConnectorStopped = false;
    let installStartedAfterStop = false;
    let registered = false;
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
      if (init?.method === "GET" && url.endsWith("/api/devices")) {
        return Response.json(
          registered ? [{ id: "dev_1", daemonUrl: `http://100.64.1.2:${port}` }] : [],
        );
      }
      if (init?.method === "POST" && url.endsWith("/api/devices")) {
        registered = true;
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
      removeTask: async () => {
        staleTaskRemoved = true;
        return { supported: true, removed: true, taskName: "DeskRelay Connector" };
      },
      stopPortOwner: async (port) => {
        expect(port).toBe(19092);
        expect(staleTaskRemoved).toBe(true);
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
      "GET http://deskrelay.test:18193/api/devices",
    ]);
  });

  test("fails with a stale-connector hint when a wrong-token local daemon cannot be stopped", async () => {
    const port = 19097;
    let staleTaskRemoved = false;
    let installAttempted = false;
    const calls: Array<{ method: string; url: string; authorization?: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      calls.push({
        method: init?.method ?? "GET",
        url,
        ...(authorization ? { authorization } : {}),
      });
      if (url === `http://127.0.0.1:${port}/status`) {
        return Response.json({ error: "wrong token" }, { status: 401 });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as typeof fetch;

    await expect(
      registerSelf({
        serverUrl: "http://deskrelay.test:18193/",
        siteToken: "site-token",
        port,
        advertiseHost: "100.64.1.2",
        fetchImpl,
        installTask: async () => {
          installAttempted = true;
          return {
            supported: true,
            installed: true,
            started: true,
            taskName: "DeskRelay Connector",
          };
        },
        loadAuthToken: async () => ({ token: "daemon-token", path: "auth.json", created: false }),
        stopRecordedDaemon: async () => undefined,
        removeTask: async () => {
          staleTaskRemoved = true;
          return { supported: true, removed: true, taskName: "DeskRelay Connector" };
        },
        stopPortOwner: async () => false,
        timeoutMs: 10,
      }),
    ).rejects.toThrow("stale DeskRelay connector is already listening");

    expect(staleTaskRemoved).toBe(true);
    expect(installAttempted).toBe(false);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
    ]);
  });

  test("removes all existing registrations for the same daemon URL before posting a replacement", async () => {
    const port = 19093;
    const calls: Array<{ method: string; url: string; body?: string; authorization?: string }> = [];
    const devices = [
      {
        id: "dev_old_1",
        daemonUrl: `http://100.64.1.2:${port}`,
      },
      {
        id: "dev_old_2",
        daemonUrl: `http://100.64.1.2:${port}`,
      },
      {
        id: "dev_other",
        daemonUrl: "http://100.64.1.3:18091",
      },
    ];
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
      if (init?.method === "GET" && url.endsWith("/api/devices")) {
        return Response.json(devices);
      }
      if (
        init?.method === "DELETE" &&
        (url.endsWith("/api/devices/dev_old_1") || url.endsWith("/api/devices/dev_old_2"))
      ) {
        const id = url.endsWith("/dev_old_1") ? "dev_old_1" : "dev_old_2";
        const index = devices.findIndex((device) => device.id === id);
        if (index >= 0) devices.splice(index, 1);
        return Response.json({ ok: true });
      }
      if (init?.method === "POST" && url.endsWith("/api/devices")) {
        devices.push({ id: "dev_new", daemonUrl: `http://100.64.1.2:${port}` });
        return Response.json({ id: "dev_new" }, { status: 201 });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }) as typeof fetch;

    await registerSelf({
      serverUrl: "http://deskrelay.test:18193/",
      siteToken: "site-token",
      port,
      advertiseHost: "100.64.1.2",
      label: "Replacement",
      fetchImpl,
      installTask: async () => ({
        supported: true,
        installed: true,
        started: true,
        taskName: "DeskRelay Connector",
      }),
      loadAuthToken: async () => ({ token: "daemon-token", path: "auth.json", created: false }),
      stopRecordedDaemon: async () => undefined,
      stopPortOwner: async () => false,
      timeoutMs: 10,
    });

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
      `GET http://100.64.1.2:${port}/status`,
      "GET http://deskrelay.test:18193/api/devices",
      "DELETE http://deskrelay.test:18193/api/devices/dev_old_1",
      "DELETE http://deskrelay.test:18193/api/devices/dev_old_2",
      "POST http://deskrelay.test:18193/api/devices",
      "GET http://deskrelay.test:18193/api/devices",
    ]);
    const post = calls.find(
      (call) => call.method === "POST" && call.url === "http://deskrelay.test:18193/api/devices",
    );
    expect(post?.body).toBe(
      JSON.stringify({
        daemonUrl: `http://100.64.1.2:${port}`,
        label: "Replacement",
        authToken: "daemon-token",
      }),
    );
  });

  test("fails before posting when registered devices cannot be listed", async () => {
    const port = 19094;
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl = makeRegisterFetch(calls, {
      listDevices: () => Response.json({ error: "server down" }, { status: 500 }),
      postDevice: () => {
        throw new Error("POST should not be reached");
      },
    });

    await expect(registerSelfForTest({ port, fetchImpl })).rejects.toThrow(
      "cannot list registered devices (500)",
    );
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
      `GET http://100.64.1.2:${port}/status`,
      "GET http://deskrelay.test:18193/api/devices",
    ]);
  });

  test("adds action and evidence when the advertised daemon cannot be reached", async () => {
    const port = 19099;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `http://127.0.0.1:${port}/status`) return Response.json({ ok: true });
      if (url === `http://100.64.1.2:${port}/status`) throw new Error("The operation timed out");
      throw new Error(`unexpected fetch: GET ${url}`);
    }) as typeof fetch;

    try {
      await registerSelfForTest({ port, fetchImpl });
      throw new Error("expected registerSelf to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(RegisterSelfError);
      const failure = err as RegisterSelfError;
      const step = failure.report.steps.find((step) => step.id === "advertised-daemon");
      expect(step).toMatchObject({
        status: "failed",
        severity: "error",
        source: "register-self",
      });
      expect(step?.evidence).toContain(`daemonUrl=http://100.64.1.2:${port}`);
      expect(step?.evidence).toContain("network=tailscale");
      expect(step?.action).toMatch(/inbound TCP/);
    }
  });

  test("classifies daemon token rejection as a retry-safe registration mismatch", async () => {
    const port = 19100;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `http://127.0.0.1:${port}/status`) return Response.json({ ok: true });
      if (url === `http://100.64.1.2:${port}/status`) {
        return Response.json({ error: "bad token" }, { status: 401 });
      }
      throw new Error(`unexpected fetch: GET ${url}`);
    }) as typeof fetch;

    try {
      await registerSelfForTest({ port, fetchImpl });
      throw new Error("expected registerSelf to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(RegisterSelfError);
      const step = (err as RegisterSelfError).report.steps.find(
        (step) => step.id === "advertised-daemon",
      );
      expect(step).toMatchObject({
        status: "failed",
        severity: "error",
        source: "register-self",
      });
      expect(step?.summary).toContain("daemon token was rejected");
      expect(step?.action).toMatch(/Rerun/);
      expect(step?.evidence).toContain("status=HTTP 401");
    }
  });

  test("classifies advertised DNS failures separately from firewall timeouts", async () => {
    const port = 19101;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `http://127.0.0.1:${port}/status`) return Response.json({ ok: true });
      if (url === `http://deskrelay-missing.test:${port}/status`) {
        throw new Error("getaddrinfo ENOTFOUND deskrelay-missing.test");
      }
      throw new Error(`unexpected fetch: GET ${url}`);
    }) as typeof fetch;

    try {
      await registerSelfForTest({ port, fetchImpl, advertiseHost: "deskrelay-missing.test" });
      throw new Error("expected registerSelf to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(RegisterSelfError);
      const step = (err as RegisterSelfError).report.steps.find(
        (step) => step.id === "advertised-daemon",
      );
      expect(step?.summary).toContain("could not be resolved");
      expect(step?.evidence).toContain("network=public");
      expect(step?.action).toMatch(/advertise-host/);
    }
  });

  test("fails before posting when registered devices response is invalid", async () => {
    const port = 19095;
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl = makeRegisterFetch(calls, {
      listDevices: () => new Response("{not-json", { status: 200 }),
      postDevice: () => {
        throw new Error("POST should not be reached");
      },
    });

    await expect(registerSelfForTest({ port, fetchImpl })).rejects.toThrow(
      "cannot parse registered devices response",
    );
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
      `GET http://100.64.1.2:${port}/status`,
      "GET http://deskrelay.test:18193/api/devices",
    ]);
  });

  test("fails before posting when an existing registration cannot be deleted", async () => {
    const port = 19096;
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl = makeRegisterFetch(calls, {
      listDevices: () => Response.json([{ id: "dev_old", daemonUrl: `http://100.64.1.2:${port}` }]),
      deleteDevice: () => Response.json({ error: "locked" }, { status: 409 }),
      postDevice: () => {
        throw new Error("POST should not be reached");
      },
    });

    await expect(registerSelfForTest({ port, fetchImpl })).rejects.toThrow(
      "cannot remove existing device dev_old (409)",
    );
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
      `GET http://100.64.1.2:${port}/status`,
      "GET http://deskrelay.test:18193/api/devices",
      "DELETE http://deskrelay.test:18193/api/devices/dev_old",
    ]);
  });

  test("fails after posting when server confirmation does not show the registered daemon", async () => {
    const port = 19098;
    const calls: Array<{ method: string; url: string }> = [];
    let listed = false;
    const fetchImpl = makeRegisterFetch(calls, {
      listDevices: () => {
        if (!listed) {
          listed = true;
          return Response.json([]);
        }
        return Response.json([]);
      },
      postDevice: () => Response.json({ id: "dev_new" }, { status: 201 }),
    });

    await expect(registerSelfForTest({ port, fetchImpl })).rejects.toThrow(
      `registered device, but http://100.64.1.2:${port} was not visible in the server device list`,
    );
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET http://127.0.0.1:${port}/status`,
      `GET http://127.0.0.1:${port}/status`,
      `GET http://100.64.1.2:${port}/status`,
      "GET http://deskrelay.test:18193/api/devices",
      "POST http://deskrelay.test:18193/api/devices",
      "GET http://deskrelay.test:18193/api/devices",
    ]);
  });
});

function makeRegisterFetch(
  calls: Array<{ method: string; url: string }>,
  handlers: {
    listDevices: () => Response;
    deleteDevice?: (url: string) => Response;
    postDevice: () => Response;
  },
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.endsWith("/status")) return Response.json({ ok: true });
    if (method === "GET" && url.endsWith("/api/devices")) return handlers.listDevices();
    if (method === "DELETE" && url.includes("/api/devices/")) {
      return handlers.deleteDevice?.(url) ?? Response.json({ ok: true });
    }
    if (method === "POST" && url.endsWith("/api/devices")) return handlers.postDevice();
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;
}

async function registerSelfForTest(options: {
  port: number;
  fetchImpl: typeof fetch;
  advertiseHost?: string;
}) {
  return await registerSelf({
    serverUrl: "http://deskrelay.test:18193/",
    siteToken: "site-token",
    port: options.port,
    advertiseHost: options.advertiseHost ?? "100.64.1.2",
    label: "Replacement",
    fetchImpl: options.fetchImpl,
    installTask: async () => ({
      supported: true,
      installed: true,
      started: true,
      taskName: "DeskRelay Connector",
    }),
    loadAuthToken: async () => ({ token: "daemon-token", path: "auth.json", created: false }),
    stopRecordedDaemon: async () => undefined,
    stopPortOwner: async () => false,
    timeoutMs: 10,
  });
}
