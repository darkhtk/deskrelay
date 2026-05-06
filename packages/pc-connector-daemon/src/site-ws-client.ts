// SiteWsClient — keeps a long-lived outbound WebSocket from the PC daemon
// to a legacy outbound relay. The self-host path does not require this client.
//
// Wire protocol (JSON over WS, one message per frame):
//
//   daemon → site (first frame):
//     { "type": "hello", "deviceId": "...", "token": "..." }
//   site → daemon:
//     { "type": "hello-ok" }            // accepted
//     { "type": "hello-deny", "reason": "..." }   // rejected → daemon backs off
//
//   site → daemon (any time after hello-ok):
//     { "type": "request", "id": "<corr>", "method": "GET",
//       "path": "/behaviors", "headers": {...}, "body": "<base64?>" }
//   daemon → site:
//     { "type": "response", "id": "<corr>", "status": 200,
//       "headers": {...}, "body": "<base64?>" }
//
//   either side (heartbeat, optional):
//     { "type": "ping" }  →  { "type": "pong" }
//
// SSE / streaming (C4):
//   site → daemon:   { "type": "sse-subscribe", "id": "<corr>",
//                      "path": "/events/...", "headers": {...} }
//   site → daemon:   { "type": "sse-cancel", "id": "<corr>" }
//   daemon → site:   { "type": "sse-event", "id": "<corr>", "frame": "data: ...\n\n" }
//   daemon → site:   { "type": "sse-end", "id": "<corr>", "reason": "ok" | "error" }
//
// Auth happens in the first frame, not via Authorization header, because
// The first frame carries auth material because browser-like WebSocket upgrades do not reliably expose custom headers. The site validates (deviceId,
// token) against its device store before replying hello-ok.
//
// The client owns reconnect: on close, it waits with exponential backoff
// (capped) and tries again. stop() cancels reconnect and closes the
// socket. The daemon process holds a single instance for its lifetime.

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type FetchLike = (
  input: string | URL,
  init?: { method?: string; headers?: HeadersInit; body?: BodyInit | null },
) => Promise<{
  status: number;
  headers: Headers;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface LogRecord {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

export interface SiteWsClientOptions {
  /** ws:// or wss:// URL on the site that accepts daemon connections.
   *  Typically `wss://<site>/api/connector/ws`. */
  siteUrl: string;
  /** Stable device identifier the site already knows about. */
  deviceId: string;
  /** Bearer token issued by the site at pairing time. The site uses it
   *  to authenticate the WS connection in the hello frame. */
  token: string;
  /** Local URL the daemon is listening on (e.g. http://127.0.0.1:18091).
   *  Incoming relayed requests are forwarded here via fetch. */
  relayTo: string;
  /** Per-machine shared secret the local daemon's HTTP API requires.
   *  When set, this client adds `Authorization: Bearer <localToken>`
   *  to every relay fetch + SSE subscribe on `relayTo`. The token
   *  never leaves the daemon process — it isn't echoed back to the
   *  site, the browser, or any log line. Optional only for tests; the
   *  daemon now refuses to construct without one, so production paths
   *  always set this. */
  localToken?: string;
  /** Override for tests. */
  wsFactory?: WebSocketFactory;
  /** Override for tests. */
  fetchImpl?: FetchLike;
  /** Initial reconnect delay (ms). Doubles up to maxReconnectMs. */
  initialReconnectMs?: number;
  /** Cap for exponential backoff. */
  maxReconnectMs?: number;
  /** Heartbeat interval. 0 disables. */
  heartbeatMs?: number;
  /** Notification hook for state transitions + protocol errors. */
  onLog?: (record: LogRecord) => void;
  /** Setter for delayed callbacks; tests inject a fake timer. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type ConnectionState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "stopped";

/** Steady-state diagnostic for the WS pairing material. Distinct from
 *  ConnectionState (which is transient/in-flight): "ok" means the site
 *  still recognizes our deviceId+token, "revoked" means the site closed
 *  us with a terminal code (4003 / hello-deny matching unknown-device).
 *  Surface this via Daemon /status so the browser UI can tell users they
 *  need to re-pair instead of just "your daemon is offline". */
export type PairingState = "ok" | "revoked";

export interface PairingDiagnostics {
  state: PairingState;
  /** ConnectionState at the moment of the snapshot. */
  connection: ConnectionState;
  /** Last close/deny reason that matters for the user (empty when ok). */
  lastError?: string;
}

const READY_OPEN = 1;
const READY_CLOSING = 2;

export class SiteWsClient {
  readonly #opts: Required<
    Pick<
      SiteWsClientOptions,
      | "siteUrl"
      | "deviceId"
      | "token"
      | "relayTo"
      | "initialReconnectMs"
      | "maxReconnectMs"
      | "heartbeatMs"
    >
  > & {
    wsFactory: WebSocketFactory;
    fetchImpl: FetchLike;
    onLog: (record: LogRecord) => void;
    setTimer: (cb: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    localToken: string | undefined;
  };

  #state: ConnectionState = "idle";
  #pairingState: PairingState = "ok";
  #lastError: string | undefined;
  #ws: WebSocketLike | undefined;
  #reconnectAttempt = 0;
  #reconnectHandle: unknown;
  #heartbeatHandle: unknown;
  #stopRequested = false;
  /** Active SSE relays — id → AbortController so sse-cancel + close
   *  can tear them down cleanly. */
  readonly #sseStreams = new Map<string, AbortController>();
  /** True once we've fired the HTTP fallback probe for the current
   *  reconnect cycle. WS libraries surface a generic
   *  `code=1002 reason="Expected 101 status code"` when the upgrade
   *  fails — that buries the actual HTTP status (404 / 401 / 426 / 5xx)
   *  the operator needs to act on. We probe once per cycle to surface
   *  it; the flag clears on a successful hello-ok. */
  #diagnosedThisCycle = false;

  constructor(options: SiteWsClientOptions) {
    this.#opts = {
      siteUrl: options.siteUrl,
      deviceId: options.deviceId,
      token: options.token,
      relayTo: options.relayTo.replace(/\/+$/, ""),
      initialReconnectMs: options.initialReconnectMs ?? 1000,
      maxReconnectMs: options.maxReconnectMs ?? 30_000,
      heartbeatMs: options.heartbeatMs ?? 30_000,
      wsFactory: options.wsFactory ?? defaultWsFactory,
      fetchImpl: options.fetchImpl ?? defaultFetch,
      onLog: options.onLog ?? (() => undefined),
      setTimer: options.setTimer ?? ((cb, ms) => setTimeout(cb, ms) as unknown),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      localToken: options.localToken,
    };
  }

  get state(): ConnectionState {
    return this.#state;
  }

  /** Snapshot the diagnostics surfaced via Daemon /status. The pairing
   *  state is sticky once we observe a terminal revocation — the only
   *  way back to "ok" is constructing a new SiteWsClient with fresh
   *  credentials (which bin.ts does on /pairing/reload). */
  getDiagnostics(): PairingDiagnostics {
    return {
      state: this.#pairingState,
      connection: this.#state,
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
    };
  }

  start(): void {
    if (this.#state === "connecting" || this.#state === "connected") return;
    this.#stopRequested = false;
    this.#openSocket();
  }

  stop(): void {
    this.#stopRequested = true;
    this.#state = "stopped";
    this.#cancelReconnect();
    this.#cancelHeartbeat();
    this.#abortAllSseStreams();
    if (this.#ws && this.#ws.readyState !== READY_CLOSING) {
      try {
        this.#ws.close(1000, "client stop");
      } catch {
        // ignore — socket may already be closed
      }
    }
    this.#ws = undefined;
  }

  #abortAllSseStreams(): void {
    for (const ctl of this.#sseStreams.values()) {
      try {
        ctl.abort();
      } catch {
        // ignore
      }
    }
    this.#sseStreams.clear();
  }

  // ---- internal -------------------------------------------------------

  #openSocket(): void {
    this.#state = "connecting";
    // The Worker's /api/connector/ws route validates the deviceId
    // query param BEFORE forwarding the upgrade to the per-device DO,
    // so always pass it. If the operator already set ?deviceId=...
    // in the env URL we leave it; otherwise we append.
    const url = appendDeviceIdQuery(this.#opts.siteUrl, this.#opts.deviceId);
    const ws = this.#opts.wsFactory(url);
    this.#ws = ws;

    ws.onopen = () => {
      this.#state = "authenticating";
      this.#log("debug", `WS open → sending hello for ${this.#opts.deviceId}`);
      this.#sendJson({
        type: "hello",
        deviceId: this.#opts.deviceId,
        token: this.#opts.token,
      });
    };

    ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        this.#log("warn", `non-JSON frame: ${raw.slice(0, 200)}`);
        return;
      }
      void this.#handleMessage(msg);
    };

    ws.onclose = (event) => {
      this.#cancelHeartbeat();
      this.#abortAllSseStreams();
      this.#log(
        "info",
        `WS closed (code=${event.code}${event.reason ? ` reason="${event.reason}"` : ""})`,
      );
      // close=1002 with the canonical "Expected 101" reason means the
      // site rejected the WebSocket upgrade with a non-101 HTTP response.
      // The WS lib hides the real status — fire one HTTP probe to
      // surface it so the operator gets a "re-pair" / "site unreachable"
      // hint instead of a cryptic protocol error.
      if (event.code === 1002 && !this.#diagnosedThisCycle && !this.#stopRequested) {
        this.#diagnosedThisCycle = true;
        void this.#diagnoseUpgradeFailure();
      }
      if (this.#stopRequested) return;
      if (isTerminalRevocation(event.code, event.reason)) {
        this.#stopRequested = true;
        this.#state = "stopped";
        this.#pairingState = "revoked";
        this.#lastError = event.reason || `WS close ${event.code}`;
        this.#cancelReconnect();
        this.#log(
          "warn",
          "site revoked this device; reconnect stopped. Re-pair from the site (Settings → Devices → Re-pair) and run `cr-connector pair NEWCODE`.",
        );
        return;
      }
      this.#scheduleReconnect();
    };

    ws.onerror = () => {
      // The close handler will run too — backoff lives there. Just log.
      this.#log("warn", "WS error");
    };
  }

  /** When a WS upgrade fails with close=1002 ("Expected 101 status code"),
   *  the WS lib hides the real HTTP status. Fire one HTTP probe to the
   *  same URL and translate the status into an actionable hint.
   *  Token is intentionally NOT sent — we only need the route's existence
   *  / auth check verdict, and putting the bearer in a query string would
   *  leak it to logs. */
  async #diagnoseUpgradeFailure(): Promise<void> {
    const wsUrl = appendDeviceIdQuery(this.#opts.siteUrl, this.#opts.deviceId);
    const httpUrl = wsUrl.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    const headers = new Headers({
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    });
    let status = 0;
    try {
      const res = await this.#opts.fetchImpl(httpUrl, { method: "GET", headers });
      status = res.status;
    } catch (err) {
      this.#log(
        "warn",
        `upgrade-failure probe failed: ${(err as Error).message} — site may be unreachable (DNS, network, or worker outage)`,
      );
      return;
    }
    const hint = explainUpgradeStatus(status);
    this.#log(hint.level, `upgrade rejected: HTTP ${status} — ${hint.message}`);
  }

  async #handleMessage(msg: unknown): Promise<void> {
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as Record<string, unknown>;
    const type = typeof m.type === "string" ? m.type : "";

    if (type === "hello-ok") {
      this.#state = "connected";
      this.#pairingState = "ok";
      this.#lastError = undefined;
      this.#reconnectAttempt = 0;
      this.#diagnosedThisCycle = false;
      this.#scheduleHeartbeat();
      this.#log("info", "site connection authenticated");
      return;
    }
    if (type === "hello-deny") {
      const reason = typeof m.reason === "string" ? m.reason : "unspecified";
      this.#log("error", `site rejected hello: ${reason}`);
      if (isTerminalHelloDeny(reason)) {
        this.#stopRequested = true;
        this.#state = "stopped";
        this.#pairingState = "revoked";
        this.#lastError = reason;
        this.#cancelReconnect();
        this.#log(
          "warn",
          "site no longer recognizes this device identity; reconnect stopped. Re-pair from the site (Settings → Devices → Re-pair) and run `cr-connector pair NEWCODE`.",
        );
      }
      // No point hammering. Close + back off the long way.
      try {
        this.#ws?.close(4001, reason);
      } catch {
        // ignore
      }
      return;
    }
    if (type === "ping") {
      this.#sendJson({ type: "pong" });
      return;
    }
    if (type === "pong") {
      // heartbeat ack; no-op
      return;
    }
    if (type === "request") {
      await this.#handleRequest(m);
      return;
    }
    if (type === "sse-subscribe") {
      this.#handleSseSubscribe(m);
      return;
    }
    if (type === "sse-cancel") {
      this.#handleSseCancel(m);
      return;
    }
    this.#log("warn", `unknown message type: ${type}`);
  }

  async #handleRequest(m: Record<string, unknown>): Promise<void> {
    const id = typeof m.id === "string" ? m.id : "";
    if (!id) {
      this.#log("warn", "request without id, dropping");
      return;
    }
    const method = typeof m.method === "string" ? m.method : "GET";
    const path = typeof m.path === "string" ? m.path : "/";
    const headersRaw = (m.headers && typeof m.headers === "object" ? m.headers : {}) as Record<
      string,
      unknown
    >;
    const headers = new Headers();
    for (const [k, v] of Object.entries(headersRaw)) {
      if (typeof v === "string") headers.set(k, v);
    }
    // Inject local daemon auth. Always overrides whatever the site
    // forwarded — the browser never knows this token, and we don't
    // want a forwarded site-side Authorization header to leak through
    // to a daemon route that expects ours.
    if (this.#opts.localToken) {
      headers.set("authorization", `Bearer ${this.#opts.localToken}`);
    }
    const bodyB64 = typeof m.body === "string" ? m.body : "";
    const body = bodyB64 ? base64Decode(bodyB64) : null;

    const url = `${this.#opts.relayTo}${path.startsWith("/") ? path : `/${path}`}`;

    let status = 502;
    let respHeaders = new Headers();
    let respBody: ArrayBuffer = new ArrayBuffer(0);
    try {
      const init: { method: string; headers: Headers; body?: BodyInit | null } = {
        method,
        headers,
      };
      if (body && method !== "GET" && method !== "HEAD") init.body = body;
      const res = await this.#opts.fetchImpl(url, init);
      status = res.status;
      respHeaders = res.headers;
      respBody = await res.arrayBuffer();
    } catch (err) {
      respHeaders.set("content-type", "application/json");
      respBody = new TextEncoder().encode(
        JSON.stringify({ error: `relay fetch failed: ${(err as Error).message}` }),
      ).buffer as ArrayBuffer;
    }

    const headerObj: Record<string, string> = {};
    respHeaders.forEach((value, key) => {
      headerObj[key] = value;
    });
    this.#sendJson({
      type: "response",
      id,
      status,
      headers: headerObj,
      body: respBody.byteLength > 0 ? base64Encode(respBody) : "",
    });
  }

  #handleSseSubscribe(m: Record<string, unknown>): void {
    const id = typeof m.id === "string" ? m.id : "";
    if (!id) return;
    if (this.#sseStreams.has(id)) {
      // Duplicate id — close the prior stream first.
      this.#sseStreams.get(id)?.abort();
      this.#sseStreams.delete(id);
    }
    const path = typeof m.path === "string" ? m.path : "/";
    const headersRaw = (m.headers && typeof m.headers === "object" ? m.headers : {}) as Record<
      string,
      unknown
    >;
    const headers = new Headers();
    for (const [k, v] of Object.entries(headersRaw)) {
      if (typeof v === "string") headers.set(k, v);
    }
    if (this.#opts.localToken) {
      headers.set("authorization", `Bearer ${this.#opts.localToken}`);
    }
    const url = `${this.#opts.relayTo}${path.startsWith("/") ? path : `/${path}`}`;

    const controller = new AbortController();
    this.#sseStreams.set(id, controller);

    void this.#runSseStream(id, url, headers, controller);
  }

  #handleSseCancel(m: Record<string, unknown>): void {
    const id = typeof m.id === "string" ? m.id : "";
    if (!id) return;
    const ctl = this.#sseStreams.get(id);
    if (!ctl) return;
    ctl.abort();
    this.#sseStreams.delete(id);
  }

  async #runSseStream(
    id: string,
    url: string,
    headers: Headers,
    controller: AbortController,
  ): Promise<void> {
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        this.#sendJson({
          type: "sse-end",
          id,
          reason: `daemon SSE returned ${res.status}`,
        });
        this.#sseStreams.delete(id);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          this.#sendJson({ type: "sse-event", id, frame: chunk });
        }
      }
      this.#sendJson({ type: "sse-end", id, reason: "ok" });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Site cancelled; no end frame needed (it already knows).
        return;
      }
      this.#sendJson({
        type: "sse-end",
        id,
        reason: `relay error: ${(err as Error).message}`,
      });
    } finally {
      this.#sseStreams.delete(id);
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopRequested) return;
    this.#state = "reconnecting";
    const delay = Math.min(
      this.#opts.maxReconnectMs,
      this.#opts.initialReconnectMs * 2 ** this.#reconnectAttempt,
    );
    this.#reconnectAttempt += 1;
    this.#log("debug", `reconnect in ${delay}ms (attempt ${this.#reconnectAttempt})`);
    this.#reconnectHandle = this.#opts.setTimer(() => {
      if (this.#stopRequested) return;
      this.#openSocket();
    }, delay);
  }

  #cancelReconnect(): void {
    if (this.#reconnectHandle !== undefined) {
      this.#opts.clearTimer(this.#reconnectHandle);
      this.#reconnectHandle = undefined;
    }
  }

  #scheduleHeartbeat(): void {
    if (this.#opts.heartbeatMs <= 0) return;
    const tick = () => {
      if (this.#state !== "connected") return;
      this.#sendJson({ type: "ping" });
      this.#heartbeatHandle = this.#opts.setTimer(tick, this.#opts.heartbeatMs);
    };
    this.#heartbeatHandle = this.#opts.setTimer(tick, this.#opts.heartbeatMs);
  }

  #cancelHeartbeat(): void {
    if (this.#heartbeatHandle !== undefined) {
      this.#opts.clearTimer(this.#heartbeatHandle);
      this.#heartbeatHandle = undefined;
    }
  }

  #sendJson(value: unknown): void {
    if (!this.#ws || this.#ws.readyState !== READY_OPEN) return;
    try {
      this.#ws.send(JSON.stringify(value));
    } catch (err) {
      this.#log("warn", `send failed: ${(err as Error).message}`);
    }
  }

  #log(level: LogRecord["level"], msg: string): void {
    this.#opts.onLog({ ts: new Date().toISOString(), level, msg });
  }
}

function isTerminalRevocation(code: number, reason: string): boolean {
  if (code === 4003) return true;
  return /device unregistered|unknown device|invalid token/i.test(reason);
}

function isTerminalHelloDeny(reason: string): boolean {
  return /unknown device|invalid token/i.test(reason);
}

/** Translate the HTTP status from a WS upgrade probe into an action hint
 *  the operator can read in the daemon log without grepping source code.
 *  Exported for unit tests. */
export function explainUpgradeStatus(status: number): {
  level: LogRecord["level"];
  message: string;
} {
  if (status === 0) {
    return {
      level: "warn",
      message: "no HTTP status returned (network unreachable?)",
    };
  }
  if (status === 101) {
    return {
      level: "info",
      message: "site accepted upgrade (transient failure during handshake — retrying)",
    };
  }
  if (status === 401) {
    return {
      level: "error",
      message:
        "site rejected the connection token — re-pair from Settings → Devices → Re-pair, then run `cr-connector pair NEWCODE`",
    };
  }
  if (status === 403) {
    return {
      level: "error",
      message:
        "site forbids this device (revoked?) — re-pair from Settings → Devices → Re-pair, then `cr-connector pair NEWCODE`",
    };
  }
  if (status === 404) {
    return {
      level: "error",
      message:
        "site does not recognize this deviceId — your local pairing is stale (likely the device was removed in the UI). Re-pair: `cr-connector pair NEWCODE`",
    };
  }
  if (status === 426) {
    return {
      level: "warn",
      message:
        "site requires an upgraded protocol — your daemon may be older than what the site expects; pull / re-install cr-connector",
    };
  }
  if (status === 429) {
    return {
      level: "info",
      message: "site rate-limited the upgrade — backing off",
    };
  }
  if (status >= 500 && status < 600) {
    return {
      level: "warn",
      message: "site error; reconnect will retry shortly",
    };
  }
  if (status >= 400 && status < 500) {
    return {
      level: "warn",
      message:
        "site rejected the upgrade with a client error — check daemon version + site URL in identity.json",
    };
  }
  return {
    level: "warn",
    message: "unexpected non-101 response — check site URL + daemon version",
  };
}

function appendDeviceIdQuery(rawUrl: string, deviceId: string): string {
  // Pure string manipulation so we don't pull URL polyfills into the
  // daemon's small surface; works for ws:// + wss://.
  if (!deviceId) return rawUrl;
  const sep = rawUrl.includes("?") ? "&" : "?";
  if (/(^|[?&])deviceId=/.test(rawUrl)) return rawUrl;
  return `${rawUrl}${sep}deviceId=${encodeURIComponent(deviceId)}`;
}

function defaultWsFactory(url: string): WebSocketLike {
  const ws = new WebSocket(url);
  return ws as unknown as WebSocketLike;
}

const defaultFetch: FetchLike = async (input, init) => {
  const r = await fetch(input as string, init);
  return {
    status: r.status,
    headers: r.headers,
    arrayBuffer: () => r.arrayBuffer(),
  };
};

function base64Encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

function base64Decode(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
