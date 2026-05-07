// Daemon — composes broker + registry + HTTP API into one runnable.
//
// Local HTTP API (binds 127.0.0.1 only):
//   GET    /pairing/status                      public, minimal pairing state
//   GET    /status                              service health + behavior list
//   GET    /behaviors                           list loaded behaviors
//   POST   /behaviors/load                      { packageDir, instanceId? }
//   DELETE /behaviors/{instanceId}              graceful unload
//   POST   /behaviors/{instanceId}/request      { method, params?, timeoutMs? }
//   GET    /events/spaces/{spaceId}/stream      SSE; supports Last-Event-ID
//   GET    /files/preview                       guarded image blob preview
//
// Auth: every route except /pairing/status requires
// `Authorization: Bearer <token>` where the token is the value loaded
// from the per-machine auth.json file
// (see auth-token.ts). The CLI, the site-ws-client, and any self-host
// site backend running on the same machine read that file. Browsers never see this token. A constructor without an authToken is rejected so we do not accidentally expose an unauthenticated daemon.

import { BehaviorHostError, type BehaviorHostLogRecord } from "@deskrelay/behavior-sdk";
import { InProcessSubscriptionBroker } from "@deskrelay/core";
import type { EventEnvelope } from "@deskrelay/shared/event";
import { type SpaceId, isSpaceId } from "@deskrelay/shared/space";
import { ApprovalQueue } from "./approvals.ts";
import { BehaviorFetcher, BehaviorFetcherError } from "./behavior-fetcher.ts";
import { BehaviorRegistry, BehaviorRegistryError } from "./behavior-registry.ts";
import { filePreviewErrorStatus, previewFile, safePreviewFilename } from "./file-preview.ts";
import { FsError, listDir, makeDir } from "./fs.ts";
import { gitStatus } from "./git.ts";
import type { WorkspaceRoots } from "./workspaces.ts";

/** Top-level pairing status surfaced via /status. Mirrors the
 *  SiteWsClient diagnostics ("ok"|"revoked") plus the cases the WS
 *  client never reaches because identity is incomplete: missing the
 *  identity file entirely ("unpaired") or missing the connectionToken
 *  field on a pre-Phase-D identity ("missing-token"). */
export type DaemonPairingState = "ok" | "revoked" | "missing-token" | "unpaired";

export interface DaemonPairingStatus {
  state: DaemonPairingState;
  deviceId?: string;
  /** Last revocation/deny reason. Populated for "revoked"; absent otherwise. */
  lastError?: string;
}

export interface DaemonReloadResult {
  /** True when we successfully started a fresh SiteWsClient with new
   *  credentials. False when the host hasn't wired a reload (no-op
   *  reload defaults to false). */
  reloaded: boolean;
  /** Error surfaced to the caller — usually because the new identity
   *  file couldn't be read or constructed a SiteWsClient that failed
   *  immediately. */
  error?: string;
}

export interface DaemonOptions {
  /** Bind host. Defaults to "127.0.0.1" — never expose to LAN by default. */
  host?: string;
  /** Port. Defaults to 0 (OS-chosen, useful for tests). */
  port?: number;
  /** Bun path forwarded to BehaviorHost subprocess spawn. */
  bunPath?: string;
  /** Log sink for behavior stderr lines + daemon-side messages. */
  onLog?: (record: BehaviorHostLogRecord & { instanceId?: string }) => void;
  /** Notified when a behavior subprocess exits unexpectedly. */
  onUnexpectedExit?: (info: { instanceId: string; code: number | null }) => void;
  /** License gate forwarded to the BehaviorRegistry — wired to
   *  LicenseCache.hasGrant() when operators opt into external behavior licensing. */
  checkLicense?: (manifest: { name: string; license: string }) => Promise<boolean>;
  /** Optional: resolves URL-style packageDir inputs to local package
   *  directories. When omitted, only filesystem paths are accepted by
   *  POST /behaviors/load. bin.ts wires a fetcher with firstPartyDirs
   *  derived from the bundled monorepo or env config. */
  fetcher?: BehaviorFetcher;
  /** Workspace allowlist for /fs/list + /fs/mkdir. Defaults to
   *  unrestricted; remote deployments should
   *  pass restricted roots from CR_CONNECTOR_WORKSPACE_ROOTS. */
  workspaceRoots?: WorkspaceRoots;
  /** Per-machine shared secret. All HTTP routes require
   *  `Authorization: Bearer <authToken>`. bin.ts wires it from
   *  loadOrCreateAuthToken(); tests pass a fixed string. */
  authToken: string;
  /** Snapshot of pairing materials used by the SiteWsClient. Returns
   *  "unpaired" / "missing-token" when bin.ts couldn't even construct
   *  the WS client; otherwise reflects SiteWsClient.getDiagnostics().
   *  Surfaced via GET /status for diagnostics. Optional for tests; defaults to "unpaired". */
  getPairingStatus?: () => DaemonPairingStatus;
  /** Replace the live SiteWsClient with one constructed from a
   *  freshly-written identity.json. Wired by bin.ts after a successful
   *  legacy relay reload.
   *  Returning { reloaded: false } is the no-op default for tests. */
  reloadSiteWsClient?: () => Promise<DaemonReloadResult>;
}

interface ResolvedListen {
  host: string;
  port: number;
}

// Bun's HTTP server defaults to a short idle timeout (10s in the
// Windows alpha). The daemon's SSE endpoint must emit comments more
// frequently than that, otherwise quiet Claude turns close the browser
// live stream and the transcript only catches up after refresh.
const SSE_HEARTBEAT_MS = 3_000;
const HTTP_IDLE_TIMEOUT_SECONDS = 255;
const PUBLIC_PAIRING_STATUS_PATH = "/pairing/status";

export class Daemon {
  readonly broker: InProcessSubscriptionBroker;
  readonly registry: BehaviorRegistry;
  readonly approvals: ApprovalQueue;
  readonly #options: DaemonOptions;
  readonly #startedAt = new Date().toISOString();
  readonly #workspaceRoots: WorkspaceRoots;
  readonly #authToken: string;

  #server: ReturnType<typeof Bun.serve> | undefined;
  #listening: ResolvedListen | undefined;

  constructor(options: DaemonOptions) {
    if (typeof options.authToken !== "string" || options.authToken.length === 0) {
      throw new Error("Daemon requires authToken — load via loadOrCreateAuthToken()");
    }
    this.#options = options;
    this.#authToken = options.authToken;
    this.#workspaceRoots = options.workspaceRoots ?? { mode: "unrestricted", roots: [] };
    this.broker = new InProcessSubscriptionBroker();
    const registryOptions: ConstructorParameters<typeof BehaviorRegistry>[0] = {
      broker: this.broker,
    };
    if (options.bunPath !== undefined) registryOptions.bunPath = options.bunPath;
    if (options.onLog !== undefined) registryOptions.onLog = options.onLog;
    if (options.onUnexpectedExit !== undefined) {
      registryOptions.onUnexpectedExit = options.onUnexpectedExit;
    }
    if (options.checkLicense !== undefined) {
      registryOptions.checkLicense = options.checkLicense;
    }
    this.registry = new BehaviorRegistry(registryOptions);
    this.approvals = new ApprovalQueue(this.broker);
  }

  /** Start the HTTP server. Resolves once the socket is bound. */
  start(): ResolvedListen {
    if (this.#listening) return this.#listening;
    const host = this.#options.host ?? "127.0.0.1";
    const port = this.#options.port ?? 0;
    this.#server = Bun.serve({
      hostname: host,
      port,
      idleTimeout: HTTP_IDLE_TIMEOUT_SECONDS,
      fetch: (req) => this.#handle(req),
    });
    // Bun.serve types hostname/port as possibly-undefined to cover the
    // unix-socket case; for our TCP bind they're always set once start()
    // returns. Fall back to the requested values if Bun returns undefined.
    const listening: ResolvedListen = {
      host: this.#server.hostname ?? host,
      port: this.#server.port ?? port,
    };
    this.#listening = listening;
    return listening;
  }

  /** Shut down: stop accepting connections, gracefully unload all
   *  behaviors, then close the HTTP socket. Idempotent. */
  async stop(): Promise<void> {
    if (!this.#server) return;
    // Stop accepting new requests immediately; let in-flight finish briefly.
    this.#server.stop();
    await this.registry.shutdownAll();
    this.#server = undefined;
    this.#listening = undefined;
  }

  get listening(): ResolvedListen | undefined {
    return this.#listening;
  }

  // ---- HTTP routing -----------------------------------------------------

  async #handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === PUBLIC_PAIRING_STATUS_PATH) {
      if (req.method === "OPTIONS") return this.#handlePublicPairingStatusOptions(req);
      if (req.method === "GET") return this.#handlePublicPairingStatus(req);
    }

    // Auth gate. Bearer token check before any route handler runs so a
    // malformed token doesn't accidentally trigger expensive work
    // (behavior load, fs walk, etc.). A 401 doesn't reveal whether the
    // route exists.
    const authError = this.#authError(req);
    if (authError) return authError;

    try {
      if (req.method === "GET" && path === "/status") {
        return this.#handleStatus();
      }
      if (req.method === "GET" && path === "/behaviors") {
        return this.#handleListBehaviors();
      }
      if (req.method === "POST" && path === "/behaviors/load") {
        return await this.#handleLoadBehavior(req);
      }
      const matchInstanceCall = path.match(/^\/behaviors\/([^/]+)\/request$/);
      if (matchInstanceCall && req.method === "POST") {
        return await this.#handleRequestBehavior(matchInstanceCall[1] ?? "", req);
      }
      const matchInstance = path.match(/^\/behaviors\/([^/]+)$/);
      if (matchInstance && req.method === "DELETE") {
        return await this.#handleUnloadBehavior(matchInstance[1] ?? "");
      }
      const matchEvents = path.match(/^\/events\/spaces\/([^/]+)\/stream$/);
      if (matchEvents && req.method === "GET") {
        return this.#handleEventsStream(matchEvents[1] ?? "", req);
      }
      if (req.method === "GET" && path === "/fs/list") {
        return await this.#handleFsList(url);
      }
      if (req.method === "GET" && path === "/fs/roots") {
        return jsonResponse(200, this.#workspaceRoots);
      }
      if (req.method === "POST" && path === "/fs/mkdir") {
        return await this.#handleFsMkdir(req);
      }
      if (req.method === "GET" && path === "/files/preview") {
        return await this.#handleFilePreview(url);
      }
      if (req.method === "GET" && path === "/git/status") {
        const cwd = url.searchParams.get("cwd") ?? "";
        if (!cwd) return jsonResponse(400, { error: "cwd query param is required" });
        const result = await gitStatus(cwd, this.#workspaceRoots);
        return jsonResponse(200, result);
      }
      if (req.method === "POST" && path === "/pairing/reload") {
        return await this.#handlePairingReload();
      }
      if (req.method === "POST" && path === "/hooks/pretooluse") {
        return await this.#handleApprovalRequest(req);
      }
      if (req.method === "POST" && path === "/hooks/pretooluse/respond") {
        return await this.#handleApprovalRespond(req);
      }
      if (req.method === "POST" && path === "/hooks/pretooluse/simulate") {
        return await this.#handleApprovalSimulate(req);
      }
      return jsonResponse(404, { error: "not found" });
    } catch (err) {
      this.#options.onLog?.({
        ts: new Date().toISOString(),
        level: "error",
        msg: `internal error handling ${req.method} ${path}: ${(err as Error).message}`,
      });
      return jsonResponse(500, { error: "internal error" });
    }
  }

  #handleStatus(): Response {
    const summaries = this.#summarizeBehaviors();
    const pairing = this.#options.getPairingStatus?.() ?? { state: "unpaired" as const };
    return jsonResponse(200, {
      ok: true,
      startedAt: this.#startedAt,
      listening: this.#listening,
      behaviors: summaries,
      brokerStats: this.broker.stats(),
      workspaceRoots: this.#workspaceRoots,
      // Steady-state pairing diagnostic. "revoked" tells the browser UI to
      // surface a Re-pair affordance instead of a generic "offline" hint.
      pairing,
      // Diagnostic flags — drive the DeviceSettingsDialog "Why is chat
      // not working?" section. Cheap to compute on each /status call.
      diagnostics: {
        remoteClaudeLoaded: summaries.some((b) => b.name === "remote-claude"),
        approvalsHookEnabled: process.env.CR_CONNECTOR_APPROVALS === "1",
        pendingApprovals: this.approvals.pendingCount(),
      },
    });
  }

  #handlePublicPairingStatusOptions(req: Request): Response {
    const cors = publicPairingStatusCorsHeaders(req);
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }

  #handlePublicPairingStatus(req: Request): Response {
    const cors = publicPairingStatusCorsHeaders(req);
    if (!cors) return jsonResponse(403, { error: "origin not allowed" });
    const pairing = this.#options.getPairingStatus?.() ?? { state: "unpaired" as const };
    return jsonResponse(200, { ok: true, pairing }, cors);
  }

  /** Reject the request when the Authorization header doesn't carry a
   *  matching Bearer token. Returns undefined to mean "let the route
   *  run". Constant-time-ish comparison via length check + char-by-char
   *  inequality accumulator so timing doesn't leak the prefix. */
  #authError(req: Request): Response | undefined {
    const header = req.headers.get("authorization") ?? "";
    const prefix = "Bearer ";
    if (!header.startsWith(prefix)) {
      return jsonResponse(401, { error: "missing token" });
    }
    const presented = header.slice(prefix.length).trim();
    if (presented.length !== this.#authToken.length) {
      return jsonResponse(401, { error: "invalid token" });
    }
    let mismatch = 0;
    for (let i = 0; i < presented.length; i++) {
      mismatch |= presented.charCodeAt(i) ^ this.#authToken.charCodeAt(i);
    }
    if (mismatch !== 0) {
      return jsonResponse(401, { error: "invalid token" });
    }
    return undefined;
  }

  #handleListBehaviors(): Response {
    return jsonResponse(200, this.#summarizeBehaviors());
  }

  async #handleLoadBehavior(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid JSON body" });
    }
    if (typeof body !== "object" || body === null) {
      return jsonResponse(400, { error: "body must be an object" });
    }
    const b = body as Record<string, unknown>;
    if (typeof b.packageDir !== "string") {
      return jsonResponse(400, { error: "packageDir is required" });
    }
    if (b.instanceId !== undefined && typeof b.instanceId !== "string") {
      return jsonResponse(400, { error: "instanceId must be a string" });
    }
    let resolvedPackageDir = b.packageDir;
    // URL-style inputs (deskrelay://, npm://, github://)
    // need fetcher resolution before BehaviorRegistry.load can read the
    // manifest. Filesystem paths bypass the fetcher to keep the
    // path-only daemon construction working as before.
    if (this.#options.fetcher && b.packageDir.includes("://")) {
      try {
        const fetched = await this.#options.fetcher.fetchSource(
          BehaviorFetcher.parseSourceUrl(b.packageDir),
        );
        resolvedPackageDir = fetched.packageDir;
      } catch (err) {
        if (err instanceof BehaviorFetcherError) {
          return jsonResponse(400, { error: err.message });
        }
        throw err;
      }
    }
    try {
      const entry = await this.registry.load({
        packageDir: resolvedPackageDir,
        ...(typeof b.instanceId === "string" ? { instanceId: b.instanceId } : {}),
      });
      return jsonResponse(200, {
        instanceId: entry.instanceId,
        manifest: entry.pkg.manifest,
        loadedAt: entry.loadedAt,
      });
    } catch (err) {
      const status = err instanceof BehaviorRegistryError ? 409 : 400;
      return jsonResponse(status, { error: (err as Error).message });
    }
  }

  async #handleRequestBehavior(instanceId: string, req: Request): Promise<Response> {
    const entry = this.registry.get(instanceId);
    if (!entry) return jsonResponse(404, { error: `unknown instanceId: ${instanceId}` });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid JSON body" });
    }
    if (typeof body !== "object" || body === null) {
      return jsonResponse(400, { error: "body must be an object" });
    }
    const b = body as Record<string, unknown>;
    if (typeof b.method !== "string") {
      return jsonResponse(400, { error: "method is required" });
    }
    const requestOptions: { timeoutMs?: number } = {};
    if (typeof b.timeoutMs === "number") requestOptions.timeoutMs = b.timeoutMs;
    try {
      const result = await entry.host.request(b.method, b.params, requestOptions);
      return jsonResponse(200, { result });
    } catch (err) {
      if (err instanceof BehaviorHostError) {
        return jsonResponse(200, {
          error: { code: err.code ?? -32603, message: err.message, data: err.data },
        });
      }
      return jsonResponse(500, { error: (err as Error).message });
    }
  }

  async #handleUnloadBehavior(instanceId: string): Promise<Response> {
    if (!this.registry.get(instanceId)) {
      return jsonResponse(404, { error: `unknown instanceId: ${instanceId}` });
    }
    await this.registry.unload(instanceId);
    return jsonResponse(200, { ok: true });
  }

  #handleEventsStream(spaceIdRaw: string, req: Request): Response {
    const spaceId = decodeURIComponent(spaceIdRaw);
    if (!isSpaceId(spaceId)) {
      return jsonResponse(400, { error: `invalid spaceId: ${spaceId}` });
    }
    const since =
      req.headers.get("Last-Event-ID") ??
      new URL(req.url).searchParams.get("lastEventId") ??
      undefined;

    const broker = this.broker;
    const target = spaceId as SpaceId;
    let unsubscribe: (() => void) | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // controller closed (client gone) — ignore
          }
        };
        send(": connected\n\n");
        const sub = broker.subscribe(
          target,
          (env: EventEnvelope) => {
            const payload = JSON.stringify(env);
            send(`id: ${env.cursor}\nevent: event\ndata: ${payload}\n\n`);
          },
          since !== undefined ? { since } : { replayBacklog: true },
        );
        unsubscribe = sub.unsubscribe;
        heartbeatTimer = setInterval(() => send(`: ping ${Date.now()}\n\n`), SSE_HEARTBEAT_MS);
      },
      cancel() {
        unsubscribe?.();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  #summarizeBehaviors(): Array<{
    instanceId: string;
    name: string;
    version: string;
    loadedAt: string;
    publisher: { id: string; name: string };
    permissions: string[];
    license: string;
    metered?: { kind: string };
  }> {
    return this.registry.list().map((e) => {
      const m = e.pkg.manifest;
      return {
        instanceId: e.instanceId,
        name: m.name,
        version: m.version,
        loadedAt: e.loadedAt,
        publisher: { id: m.publisher.id, name: m.publisher.name },
        permissions: m.permissions,
        license: m.license,
        ...(m.metered ? { metered: { kind: m.metered.kind } } : {}),
      };
    });
  }

  async #handleFsList(url: URL): Promise<Response> {
    const path = url.searchParams.get("path") ?? "";
    try {
      const result = await listDir(path, this.#workspaceRoots);
      return jsonResponse(200, result);
    } catch (err) {
      return jsonResponse(fsErrorStatus(err), { error: (err as Error).message });
    }
  }

  async #handleFsMkdir(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid JSON body" });
    }
    if (typeof body !== "object" || body === null) {
      return jsonResponse(400, { error: "body must be an object" });
    }
    const b = body as Record<string, unknown>;
    if (typeof b.parent !== "string" || typeof b.name !== "string") {
      return jsonResponse(400, { error: "parent and name are required strings" });
    }
    try {
      const result = await makeDir({ parent: b.parent, name: b.name }, this.#workspaceRoots);
      return jsonResponse(200, result);
    } catch (err) {
      return jsonResponse(fsErrorStatus(err), { error: (err as Error).message });
    }
  }

  async #handleFilePreview(url: URL): Promise<Response> {
    const path = url.searchParams.get("path") ?? "";
    const cwd = url.searchParams.get("cwd") ?? "";
    try {
      const result = await previewFile({ path, cwd }, this.#workspaceRoots);
      return new Response(bytesToArrayBuffer(result.bytes), {
        status: 200,
        headers: {
          "content-type": result.contentType,
          "content-length": String(result.size),
          "cache-control": "private, max-age=60",
          "content-disposition": `inline; filename="${safePreviewFilename(result.filename)}"`,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (err) {
      return jsonResponse(filePreviewErrorStatus(err), {
        error: (err as Error).message,
        code: (err as { code?: unknown }).code,
      });
    }
  }

  /** POST /pairing/reload — invoked by `cr-connector pair NEWCODE` from a
   *  separate process after it has written the new identity.json to disk.
   *  Asks the host (bin.ts) to tear down the old SiteWsClient and start a
   *  fresh one with the new credentials. Returning {reloaded:false}
   *  means the host didn't wire reload (test harness, or the daemon was
   *  already running without site-ws enabled). */
  async #handlePairingReload(): Promise<Response> {
    const reload = this.#options.reloadSiteWsClient;
    if (!reload) {
      return jsonResponse(503, {
        reloaded: false,
        error: "reload not wired (no site-ws client)",
      });
    }
    const result = await reload().catch(
      (err): DaemonReloadResult => ({
        reloaded: false,
        error: (err as Error).message,
      }),
    );
    return jsonResponse(result.reloaded ? 200 : 500, result);
  }

  async #handleApprovalRequest(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid JSON body" });
    }
    if (typeof body !== "object" || body === null) {
      return jsonResponse(400, { error: "body must be an object" });
    }
    const decision = await this.approvals.request(body as Record<string, unknown>);
    return jsonResponse(200, decision);
  }

  async #handleApprovalRespond(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid JSON body" });
    }
    if (typeof body !== "object" || body === null) {
      return jsonResponse(400, { error: "body must be an object" });
    }
    const b = body as Record<string, unknown>;
    if (typeof b.id !== "string" || typeof b.decision !== "string") {
      return jsonResponse(400, { error: "id (string) and decision (string) required" });
    }
    if (b.decision !== "allow" && b.decision !== "deny") {
      return jsonResponse(400, { error: "decision must be 'allow' or 'deny'" });
    }
    const ok = this.approvals.resolve(b.id, {
      decision: b.decision,
      ...(typeof b.reason === "string" ? { reason: b.reason } : {}),
    });
    if (!ok) return jsonResponse(404, { error: "no pending approval with that id" });
    return jsonResponse(200, { ok: true });
  }

  async #handleApprovalSimulate(req: Request): Promise<Response> {
    // Drives the queue from outside the claude CLI hook path. Lets us
    // verify the approval modal end-to-end before the real
    // claude-runner --settings hook config wiring lands.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid JSON body" });
    }
    if (typeof body !== "object" || body === null) {
      return jsonResponse(400, { error: "body must be an object" });
    }
    const decision = await this.approvals.request(body as Record<string, unknown>);
    return jsonResponse(200, decision);
  }
}

/** Map FsError codes to HTTP status. Anything else (raw Node fs error, our
 *  own bug) falls through to 500 — the route handler will surface the
 *  message so the user can tell something went wrong. */
function fsErrorStatus(err: unknown): number {
  if (!(err instanceof FsError)) return 500;
  switch (err.code) {
    case "ENOENT":
      return 404;
    case "ENOTDIR":
    case "EINVAL":
      return 400;
    case "EPERM":
    case "EFORBIDDEN":
      return 403;
    case "EEXIST":
      return 409;
    default:
      return 500;
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function publicPairingStatusCorsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  if (!isTrustedPublicPairingStatusOrigin(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    vary: "Origin, Access-Control-Request-Private-Network",
  };
}

function isTrustedPublicPairingStatusOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    (parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "[::1]")
  ) {
    return true;
  }
  return false;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
