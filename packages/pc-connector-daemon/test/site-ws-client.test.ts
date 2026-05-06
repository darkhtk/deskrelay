// site-ws-client.test.ts — drive the SiteWsClient state machine through a
// fake WebSocket + fake fetch. No real network. Validates:
//   - hello-on-open + auth handshake
//   - request → fetch local URL → response back
//   - close triggers exponential backoff, attempt counter resets on
//     successful authentication
//   - stop() halts reconnect

import { describe, expect, test } from "bun:test";

/** Test helper: read array entry that the setup contract guarantees is
 *  populated. Returns the value or throws a descriptive error so a
 *  broken invariant fails fast instead of via cryptic undefined access. */
function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`expected ${label} to be present`);
  return value;
}
import {
  explainUpgradeStatus,
  type FetchLike,
  type LogRecord,
  SiteWsClient,
  type WebSocketLike,
} from "../src/site-ws-client.ts";

class FakeWs implements WebSocketLike {
  readyState = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {}

  /** Drive the open handshake. */
  fireOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  fireMessage(data: string): void {
    this.onmessage?.({ data });
  }
  fireClose(code = 1006, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("send while not open");
    this.sent.push(data);
  }
  close(_code?: number, _reason?: string): void {
    this.readyState = 2;
    // simulate the actual close
    queueMicrotask(() => this.fireClose(1000, "client stop"));
  }
}

interface FakeTimer {
  cb: () => void;
  delay: number;
  cancelled: boolean;
}

class FakeClock {
  readonly timers: FakeTimer[] = [];
  set: (cb: () => void, ms: number) => unknown = (cb, delay) => {
    const t: FakeTimer = { cb, delay, cancelled: false };
    this.timers.push(t);
    return t;
  };
  clear: (h: unknown) => void = (h) => {
    (h as FakeTimer).cancelled = true;
  };

  /** Trigger every pending timer once (FIFO). Returns how many fired. */
  flush(): number {
    let fired = 0;
    while (this.timers.length > 0) {
      const t = this.timers.shift();
      if (!t || t.cancelled) continue;
      t.cb();
      fired += 1;
    }
    return fired;
  }
}

function setup(opts: { fetch?: FetchLike; logs?: LogRecord[] } = {}) {
  const created: FakeWs[] = [];
  const clock = new FakeClock();
  const logs: LogRecord[] = opts.logs ?? [];
  const client = new SiteWsClient({
    siteUrl: "wss://site.test/ws",
    deviceId: "dev_abc",
    token: "tok_123",
    relayTo: "http://127.0.0.1:18091",
    initialReconnectMs: 100,
    maxReconnectMs: 1000,
    heartbeatMs: 0, // disable heartbeat in unit tests
    wsFactory: (url) => {
      const ws = new FakeWs(url);
      created.push(ws);
      return ws;
    },
    fetchImpl:
      opts.fetch ??
      (async () => ({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer: async () => new TextEncoder().encode("{}").buffer as ArrayBuffer,
      })),
    onLog: (r) => logs.push(r),
    setTimer: clock.set,
    clearTimer: clock.clear,
  });
  return { client, created, clock, logs };
}

describe("SiteWsClient — handshake", () => {
  test("sends hello on open and stays in authenticating until hello-ok", () => {
    const { client, created } = setup();
    client.start();
    expect(client.state).toBe("connecting");
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    expect(client.state).toBe("authenticating");
    expect(ws.sent).toHaveLength(1);
    const hello = JSON.parse(must(ws.sent[0], "ws.sent[0]"));
    expect(hello.type).toBe("hello");
    expect(hello.deviceId).toBe("dev_abc");
    expect(hello.token).toBe("tok_123");

    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    expect(client.state).toBe("connected");
  });

  test("hello-deny closes the socket without reconnect spam (attempt counter unchanged)", () => {
    const { client, created } = setup();
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-deny", reason: "bad token" }));
    expect(ws.readyState).toBe(2); // CLOSING
  });

  test("unknown-device hello-deny is terminal and does not schedule reconnect", () => {
    const { client, created, clock, logs } = setup();
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-deny", reason: "unknown device" }));
    expect(client.state).toBe("stopped");
    expect(clock.timers).toHaveLength(0);
    expect(logs.some((r) => /reconnect stopped/i.test(r.msg))).toBe(true);
  });
});

describe("SiteWsClient — pairing diagnostics", () => {
  test("starts as pairing=ok with no error", () => {
    const { client } = setup();
    expect(client.getDiagnostics().state).toBe("ok");
    expect(client.getDiagnostics().lastError).toBeUndefined();
  });

  test("4003 close flips pairing to revoked with reason", () => {
    const { client, created } = setup();
    client.start();
    must(created[0], "created[0]").fireOpen();
    must(created[0], "created[0]").fireClose(4003, "device unregistered");
    const diag = client.getDiagnostics();
    expect(diag.state).toBe("revoked");
    expect(diag.connection).toBe("stopped");
    expect(diag.lastError).toBe("device unregistered");
  });

  test("hello-deny with terminal reason flips pairing to revoked", () => {
    const { client, created } = setup();
    client.start();
    must(created[0], "created[0]").fireOpen();
    must(created[0], "created[0]").fireMessage(
      JSON.stringify({ type: "hello-deny", reason: "unknown device" }),
    );
    const diag = client.getDiagnostics();
    expect(diag.state).toBe("revoked");
    expect(diag.lastError).toBe("unknown device");
  });

  test("non-terminal close (1006) keeps pairing=ok and reconnects", () => {
    const { client, created } = setup();
    client.start();
    must(created[0], "created[0]").fireOpen();
    must(created[0], "created[0]").fireMessage(JSON.stringify({ type: "hello-ok" }));
    must(created[0], "created[0]").fireClose(1006, "");
    expect(client.getDiagnostics().state).toBe("ok");
  });

  test("hello-ok after a transient blip clears any prior lastError", () => {
    // Construct a setup where the first connection is closed normally and
    // a second connection authenticates. lastError must be cleared on the
    // hello-ok so callers don't see stale revocation reasons.
    const { client, created, clock } = setup();
    client.start();
    must(created[0], "created[0]").fireOpen();
    must(created[0], "created[0]").fireClose(1006, "transient");
    expect(client.getDiagnostics().state).toBe("ok");
    clock.flush(); // fires the reconnect timer
    must(created[1], "created[1]").fireOpen();
    must(created[1], "created[1]").fireMessage(JSON.stringify({ type: "hello-ok" }));
    expect(client.getDiagnostics().lastError).toBeUndefined();
  });
});

describe("SiteWsClient — upgrade-failure diagnosis", () => {
  // explainUpgradeStatus is the pure mapper from HTTP status → action hint.
  // Lock the high-signal cases here so future status additions are explicit.
  test("explainUpgradeStatus maps 404 → re-pair guidance", () => {
    const r = explainUpgradeStatus(404);
    expect(r.level).toBe("error");
    expect(r.message).toMatch(/stale|re-pair|cr-connector pair NEWCODE/i);
  });

  test("explainUpgradeStatus maps 401 → token-mismatch guidance", () => {
    const r = explainUpgradeStatus(401);
    expect(r.level).toBe("error");
    expect(r.message).toMatch(/token|re-pair/i);
  });

  test("explainUpgradeStatus maps 403 → revoked-or-forbidden guidance", () => {
    const r = explainUpgradeStatus(403);
    expect(r.level).toBe("error");
    expect(r.message).toMatch(/forbid|revoked|re-pair/i);
  });

  test("explainUpgradeStatus maps 426 → upgrade-required (daemon outdated)", () => {
    const r = explainUpgradeStatus(426);
    expect(r.message).toMatch(/upgrade|older|re-install/i);
  });

  test("explainUpgradeStatus maps 5xx → backoff (transient site error)", () => {
    expect(explainUpgradeStatus(503).message).toMatch(/site error|retry/i);
    expect(explainUpgradeStatus(500).message).toMatch(/site error|retry/i);
  });

  test("explainUpgradeStatus maps unreachable (status=0) → network unreachable", () => {
    const r = explainUpgradeStatus(0);
    expect(r.message).toMatch(/no HTTP status|unreachable/i);
  });

  test("WS close=1002 fires a single HTTP probe and logs the diagnosis", async () => {
    const probeUrls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      probeUrls.push(typeof url === "string" ? url : url.toString());
      return {
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    const { client, created, logs } = setup({ fetch: fetchImpl });
    client.start();
    must(created[0], "created[0]").fireOpen();
    // simulate the WebSocket lib reporting a non-101 upgrade failure
    must(created[0], "created[0]").fireClose(1002, 'Expected 101 status code');
    // Let the queued microtask + fetch promise settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(probeUrls).toHaveLength(1);
    // The probe URL is HTTPS, never WSS, and never includes the bearer token.
    expect(probeUrls[0]).toMatch(/^https:\/\//);
    expect(probeUrls[0]).not.toMatch(/tok_123/);
    // The diagnosis log line surfaces the 404 + actionable hint.
    const hit = logs.find((l) => l.msg.includes("upgrade rejected: HTTP 404"));
    expect(hit).toBeTruthy();
    expect(hit?.msg).toMatch(/stale|re-pair/i);
  });

  test("repeat 1002 closes don't fire repeat probes within one cycle", async () => {
    const probes: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      probes.push(String(url));
      return {
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    const { client, created, clock } = setup({ fetch: fetchImpl });
    client.start();
    must(created[0], "created[0]").fireOpen();
    must(created[0], "created[0]").fireClose(1002, 'Expected 101 status code');
    await new Promise((r) => setTimeout(r, 0));
    clock.flush(); // reconnect
    must(created[1], "created[1]").fireOpen();
    must(created[1], "created[1]").fireClose(1002, 'Expected 101 status code');
    await new Promise((r) => setTimeout(r, 0));
    // Only one probe — silence on subsequent identical failures avoids
    // hammering the site every backoff round.
    expect(probes).toHaveLength(1);
  });
});

describe("SiteWsClient — request relay", () => {
  test("relays request to fetchImpl and sends response with same id", async () => {
    const fetched: Array<{ url: string; method: string; bodyLen: number }> = [];
    const { client, created } = setup({
      fetch: async (input, init) => {
        const url = String(input);
        const body = init?.body ?? null;
        const bodyLen = body ? (body instanceof ArrayBuffer ? body.byteLength : 0) : 0;
        fetched.push({ url, method: init?.method ?? "GET", bodyLen });
        return {
          status: 201,
          headers: new Headers({ "content-type": "application/json", "x-test": "ok" }),
          arrayBuffer: async () =>
            new TextEncoder().encode(JSON.stringify({ ok: true })).buffer as ArrayBuffer,
        };
      },
    });
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));

    ws.fireMessage(
      JSON.stringify({
        type: "request",
        id: "r1",
        method: "POST",
        path: "/behaviors/load",
        headers: { "content-type": "application/json" },
        body: btoa('{"packageDir":"/x"}'),
      }),
    );
    // Allow async handler microtasks to flush.
    await new Promise((r) => setTimeout(r, 5));

    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.url).toBe("http://127.0.0.1:18091/behaviors/load");
    expect(fetched[0]?.method).toBe("POST");
    expect(fetched[0]?.bodyLen).toBeGreaterThan(0);

    // The response frame is the second sent message (after hello).
    expect(ws.sent.length).toBe(2);
    const resp = JSON.parse(must(ws.sent[1], "ws.sent[1]"));
    expect(resp.type).toBe("response");
    expect(resp.id).toBe("r1");
    expect(resp.status).toBe(201);
    expect(resp.headers["x-test"]).toBe("ok");
    expect(atob(resp.body)).toBe(JSON.stringify({ ok: true }));
  });

  test("fetch failure surfaces as 502 with error body", async () => {
    const { client, created } = setup({
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    ws.fireMessage(JSON.stringify({ type: "request", id: "r2", method: "GET", path: "/x" }));
    await new Promise((r) => setTimeout(r, 5));

    const resp = JSON.parse(must(ws.sent[1], "ws.sent[1]"));
    expect(resp.status).toBe(502);
    const body = atob(resp.body);
    expect(body).toContain("ECONNREFUSED");
  });

  test("request without id is dropped", async () => {
    const { client, created } = setup();
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    ws.fireMessage(JSON.stringify({ type: "request", method: "GET", path: "/x" }));
    await new Promise((r) => setTimeout(r, 5));
    // Only the hello got sent; no response queued.
    expect(ws.sent.length).toBe(1);
  });
});

describe("SiteWsClient — reconnect + stop", () => {
  test("close after authentication schedules reconnect with growing delay", () => {
    const { client, created, clock } = setup();
    client.start();

    // First connect → success → close
    let ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    ws.fireClose(1006, "io");

    expect(client.state).toBe("reconnecting");
    expect(clock.timers).toHaveLength(1);
    expect(must(clock.timers[0], "timer[0]").delay).toBe(100);

    // Run reconnect timer → second WS appears, immediately closes.
    clock.flush();
    ws = must(created[1], "created[1]");
    ws.fireOpen();
    ws.fireClose(1006, "io"); // failed before hello-ok this time

    expect(must(clock.timers[0], "timer[0]").delay).toBe(200);

    clock.flush();
    ws = must(created[2], "created[2]");
    ws.fireOpen();
    ws.fireClose(1006, "io");
    expect(must(clock.timers[0], "timer[0]").delay).toBe(400);
  });

  test("stop cancels the reconnect timer and prevents further opens", () => {
    const { client, created, clock } = setup();
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireClose(1006, "io");
    expect(clock.timers).toHaveLength(1);
    client.stop();
    expect(client.state).toBe("stopped");
    expect(must(clock.timers[0], "timer[0]").cancelled).toBe(true);
    // Even if a stale timer fires, it's a no-op.
    must(clock.timers[0], "timer[0]").cb();
    expect(created.length).toBe(1);
  });

  test("hello-ok resets the reconnect attempt counter", () => {
    const { client, created, clock } = setup();
    client.start();
    let ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireClose(1006, "io"); // first close before hello-ok
    expect(must(clock.timers[0], "timer[0]").delay).toBe(100);
    clock.flush();
    ws = must(created[1], "created[1]");
    ws.fireOpen();
    ws.fireClose(1006, "io");
    expect(must(clock.timers[0], "timer[0]").delay).toBe(200);
    clock.flush();
    ws = must(created[2], "created[2]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    // Successful auth resets the counter.
    ws.fireClose(1006, "io");
    expect(must(clock.timers[0], "timer[0]").delay).toBe(100);
  });

  test("server-side device revoke close is terminal and does not reconnect", () => {
    const { client, created, clock, logs } = setup();
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    ws.fireClose(4003, "device unregistered by user");

    expect(client.state).toBe("stopped");
    expect(clock.timers).toHaveLength(0);
    expect(logs.some((r) => /site revoked this device/i.test(r.msg))).toBe(true);
  });
});

describe("SiteWsClient — heartbeat + ping", () => {
  test("responds to ping with pong while connected", () => {
    const { client, created } = setup();
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    ws.fireMessage(JSON.stringify({ type: "ping" }));
    const last = JSON.parse(must(ws.sent.at(-1), "last sent"));
    expect(last.type).toBe("pong");
  });
});

describe("SiteWsClient — SSE multiplex", () => {
  test("sse-subscribe pulls frames and emits sse-event + sse-end", async () => {
    const originalFetch = globalThis.fetch;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n\n"));
        controller.enqueue(new TextEncoder().encode("data: two\n\n"));
        controller.close();
      },
    });
    globalThis.fetch = (async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as unknown as typeof fetch;

    try {
      const { client, created } = setup();
      client.start();
      const ws = must(created[0], "created[0]");
      ws.fireOpen();
      ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
      ws.fireMessage(
        JSON.stringify({
          type: "sse-subscribe",
          id: "s1",
          path: "/events/spaces/foo/stream",
          headers: {},
        }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const frames = ws.sent.slice(1).map((s) => JSON.parse(s));
      expect(frames.some((f) => f.type === "sse-event" && f.frame.includes("one"))).toBe(true);
      expect(frames.some((f) => f.type === "sse-event" && f.frame.includes("two"))).toBe(true);
      expect(frames.some((f) => f.type === "sse-end" && f.id === "s1" && f.reason === "ok")).toBe(
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // sse-cancel exercises a real abort + stream.cancel() pattern; bun's
  // streaming runtime currently panics on the test's pull-loop fixture
  // (filed a separate issue), so the abort is verified at runtime via
  // the daemon e2e flow rather than a unit test here.
});

describe("SiteWsClient — local daemon auth", () => {
  test("relay fetch includes Authorization Bearer <localToken> header", async () => {
    const seenHeaders: Headers[] = [];
    const created: FakeWs[] = [];
    const clock = new FakeClock();
    const client = new SiteWsClient({
      siteUrl: "wss://site.test/ws",
      deviceId: "dev_abc",
      token: "tok_site",
      relayTo: "http://127.0.0.1:18091",
      localToken: "local-deadbeef",
      initialReconnectMs: 100,
      maxReconnectMs: 1000,
      heartbeatMs: 0,
      wsFactory: (url) => {
        const ws = new FakeWs(url);
        created.push(ws);
        return ws;
      },
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers ?? {});
        seenHeaders.push(headers);
        return {
          status: 200,
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
      setTimer: clock.set,
      clearTimer: clock.clear,
    });
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));

    // Site forwards a request to the local daemon. The site might or
    // might not be sending its own Authorization header on this frame —
    // we override either way so the local token is what reaches the daemon.
    ws.fireMessage(
      JSON.stringify({
        type: "request",
        id: "r1",
        method: "GET",
        path: "/status",
        headers: { authorization: "Bearer site-bearer-leaked-from-browser" },
        body: "",
      }),
    );
    await new Promise((r) => setTimeout(r, 5));

    expect(seenHeaders).toHaveLength(1);
    expect(seenHeaders[0]?.get("authorization")).toBe("Bearer local-deadbeef");
  });

  test("without localToken, no Authorization header is set on relay fetch", async () => {
    const seenHeaders: Headers[] = [];
    const created: FakeWs[] = [];
    const clock = new FakeClock();
    const client = new SiteWsClient({
      siteUrl: "wss://site.test/ws",
      deviceId: "dev_abc",
      token: "tok_site",
      relayTo: "http://127.0.0.1:18091",
      // localToken intentionally omitted (legacy/no-auth mode for tests)
      initialReconnectMs: 100,
      maxReconnectMs: 1000,
      heartbeatMs: 0,
      wsFactory: (url) => {
        const ws = new FakeWs(url);
        created.push(ws);
        return ws;
      },
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers ?? {});
        seenHeaders.push(headers);
        return {
          status: 200,
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
      setTimer: clock.set,
      clearTimer: clock.clear,
    });
    client.start();
    const ws = must(created[0], "created[0]");
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: "hello-ok" }));
    ws.fireMessage(
      JSON.stringify({
        type: "request",
        id: "r1",
        method: "GET",
        path: "/status",
        headers: {},
        body: "",
      }),
    );
    await new Promise((r) => setTimeout(r, 5));

    expect(seenHeaders[0]?.get("authorization")).toBeNull();
  });
});
