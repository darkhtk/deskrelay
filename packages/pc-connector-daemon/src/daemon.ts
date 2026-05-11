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
//   POST   /system/uninstall                    remove local connector install
//   POST   /system/update                       update local source checkout
//
// Auth: every route except /pairing/status requires
// `Authorization: Bearer <token>` where the token is the value loaded
// from the per-machine auth.json file
// (see auth-token.ts). The CLI, the site-ws-client, and any self-host
// site backend running on the same machine read that file. Browsers never see this token. A constructor without an authToken is rejected so we do not accidentally expose an unauthenticated daemon.

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { BehaviorHostError, type BehaviorHostLogRecord } from "@deskrelay/behavior-sdk";
import { InProcessSubscriptionBroker } from "@deskrelay/core";
import {
  MANAGER_API_VERSION,
  type ManagerCapabilities,
  type ManagerInstallStatus,
  type ManagerLogResponse,
  type ManagerNetworkAddress,
  type ManagerNetworkKind,
  type ManagerNetworkStatus,
  type ManagerProcessStatus,
  type ManagerRestartResult,
  type ManagerSecurityBoundary,
} from "@deskrelay/shared";
import type { EventEnvelope } from "@deskrelay/shared/event";
import { type SpaceId, isSpaceId } from "@deskrelay/shared/space";
import { getDeskRelayBuildInfo } from "@deskrelay/shared/version";
import { ApprovalQueue } from "./approvals.ts";
import { defaultAuthFilePath } from "./auth-token.ts";
import { BehaviorFetcher, BehaviorFetcherError } from "./behavior-fetcher.ts";
import { BehaviorRegistry, BehaviorRegistryError } from "./behavior-registry.ts";
import { filePreviewErrorStatus, previewFile, safePreviewFilename } from "./file-preview.ts";
import { FsError, listDir, makeDir } from "./fs.ts";
import { gitStatus } from "./git.ts";
import {
  type ClaudeInstructionScope,
  InstructionError,
  deleteClaudeInstruction,
  readClaudeInstructions,
  writeClaudeInstruction,
} from "./instructions.ts";
import { WINDOWS_LOGIN_TASK_LOG_NAME, queryLoginTask } from "./login-task.ts";
import { defaultStateDir } from "./state-file.ts";
import type { WorkspaceRoots } from "./workspaces.ts";

const UNRESTRICTED_WORKSPACE_ROOTS: WorkspaceRoots = { mode: "unrestricted", roots: [] };

function fsWorkspaceRootsForScope(
  configured: WorkspaceRoots,
  scope: string | null | undefined,
): WorkspaceRoots {
  return scope === "unrestricted" ? UNRESTRICTED_WORKSPACE_ROOTS : configured;
}

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
  /** Remove local connector state/login task after a site-side device removal.
   *  Wired by bin.ts for the real daemon; tests may provide a stub. */
  requestSelfUninstall?: (options: { removeRepo?: boolean }) => Promise<unknown>;
  /** Pull the local source checkout and restart through the login task when
   *  available. Wired by bin.ts for the real daemon; tests may provide a stub. */
  requestSelfUpdate?: () => Promise<unknown>;
  /** Restart the connector without pulling source. Wired by bin.ts for the
   *  real daemon; tests may provide a stub. */
  requestSelfRestart?: () => Promise<ManagerRestartResult>;
  /** Preferred connector log path. Defaults to the login-task connector log. */
  logPath?: string;
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
      if (req.method === "GET" && path === "/capabilities") {
        return this.#handleCapabilities();
      }
      if (req.method === "GET" && path === "/logs") {
        return await this.#handleLogs(url);
      }
      if (req.method === "GET" && path === "/process/status") {
        return await this.#handleProcessStatus();
      }
      if (req.method === "POST" && path === "/process/restart") {
        return await this.#handleProcessRestart();
      }
      if (req.method === "GET" && path === "/network/status") {
        return this.#handleNetworkStatus();
      }
      if (req.method === "GET" && path === "/install/status") {
        return await this.#handleInstallStatus();
      }
      if (req.method === "GET" && path === "/security/boundary") {
        return this.#handleSecurityBoundary();
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
      if (req.method === "GET" && path === "/instructions") {
        return await this.#handleInstructionsRead(url);
      }
      const matchInstruction = path.match(/^\/instructions\/([^/]+)$/);
      if (matchInstruction && req.method === "PUT") {
        return await this.#handleInstructionWrite(matchInstruction[1] ?? "", req);
      }
      if (matchInstruction && req.method === "DELETE") {
        return await this.#handleInstructionDelete(matchInstruction[1] ?? "", req);
      }
      if (req.method === "POST" && path === "/pairing/reload") {
        return await this.#handlePairingReload();
      }
      if (req.method === "POST" && path === "/system/uninstall") {
        return await this.#handleSystemUninstall(req);
      }
      if (req.method === "POST" && path === "/system/update") {
        return await this.#handleSystemUpdate();
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
      build: getDeskRelayBuildInfo(),
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

  #handleCapabilities(): Response {
    return jsonResponse(200, this.#capabilities());
  }

  async #handleLogs(url: URL): Promise<Response> {
    const source = normalizeLogSource(url.searchParams.get("source"), ["connector", "daemon"]);
    if (!source) {
      return jsonResponse(400, { error: "unsupported log source" });
    }
    const tail = clampTail(url.searchParams.get("tail"));
    const level = normalizeLogLevel(url.searchParams.get("level"));
    return jsonResponse(
      200,
      await readLogResponse({
        scope: "device",
        source,
        path: this.#options.logPath ?? defaultConnectorLogPath(),
        tail,
        ...(level ? { level } : {}),
      }),
    );
  }

  async #handleProcessStatus(): Promise<Response> {
    return jsonResponse(200, await this.#processStatus());
  }

  async #handleProcessRestart(): Promise<Response> {
    const restart = this.#options.requestSelfRestart;
    if (!restart) {
      return jsonResponse(501, {
        supported: false,
        accepted: false,
        message: "connector restart is not wired",
        error: "connector restart is not wired",
      } satisfies ManagerRestartResult);
    }
    try {
      const result = await restart();
      return jsonResponse(result.accepted ? 202 : 409, result);
    } catch (err) {
      return jsonResponse(500, {
        supported: true,
        accepted: false,
        message: "connector restart failed",
        error: (err as Error).message,
      } satisfies ManagerRestartResult);
    }
  }

  #handleNetworkStatus(): Response {
    return jsonResponse(200, this.#networkStatus());
  }

  async #handleInstallStatus(): Promise<Response> {
    return jsonResponse(200, await this.#installStatus());
  }

  #handleSecurityBoundary(): Response {
    return jsonResponse(200, this.#securityBoundary());
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

  #capabilities(): ManagerCapabilities {
    return {
      scope: "device",
      apiVersion: MANAGER_API_VERSION,
      build: getDeskRelayBuildInfo(),
      platform: process.platform,
      arch: process.arch,
      features: [
        "capabilities",
        "logs",
        "process.status",
        "process.restart",
        "network.status",
        "install.status",
        "security.boundary",
        "behaviors",
        "events",
        "filesystem",
        "file.preview",
        "git.status",
        "instructions",
        "approvals",
        "system.update",
        "system.uninstall",
      ],
      routes: [
        { method: "GET", path: "/capabilities", description: "List daemon API capabilities." },
        { method: "GET", path: "/logs", description: "Read connector logs." },
        { method: "GET", path: "/process/status", description: "Read connector process status." },
        {
          method: "POST",
          path: "/process/restart",
          description: "Restart the connector process.",
        },
        { method: "GET", path: "/network/status", description: "Read connector network status." },
        { method: "GET", path: "/install/status", description: "Read connector install status." },
        {
          method: "GET",
          path: "/security/boundary",
          description: "Read connector token, network, and workspace boundary summary.",
        },
        { method: "GET", path: "/status", description: "Read daemon health." },
        { method: "GET", path: "/behaviors", description: "List loaded behaviors." },
        { method: "POST", path: "/behaviors/load", description: "Load a behavior package." },
        {
          method: "POST",
          path: "/behaviors/:instanceId/request",
          description: "Call a behavior method.",
        },
        {
          method: "DELETE",
          path: "/behaviors/:instanceId",
          description: "Unload a behavior.",
          destructive: true,
        },
        {
          method: "GET",
          path: "/events/spaces/:spaceId/stream",
          description: "Stream behavior events over SSE.",
        },
        { method: "GET", path: "/fs/list", description: "List files and directories." },
        { method: "GET", path: "/fs/roots", description: "Read workspace root policy." },
        { method: "POST", path: "/fs/mkdir", description: "Create a directory." },
        { method: "GET", path: "/files/preview", description: "Preview a guarded local file." },
        { method: "GET", path: "/git/status", description: "Read Git status for a cwd." },
        { method: "GET", path: "/instructions", description: "Read Claude instructions." },
        { method: "PUT", path: "/instructions/:scope", description: "Write Claude instruction." },
        {
          method: "DELETE",
          path: "/instructions/:scope",
          description: "Delete Claude instruction.",
          destructive: true,
        },
        {
          method: "POST",
          path: "/system/uninstall",
          description: "Uninstall local connector.",
          destructive: true,
        },
        { method: "POST", path: "/system/update", description: "Update local connector." },
        {
          method: "POST",
          path: "/hooks/pretooluse/respond",
          description: "Resolve pending tool approval.",
        },
      ],
      behaviorMethods: [
        "account.info",
        "chat",
        "context.usage",
        "diagnostics",
        "interrupt",
        "permissions.inspect",
        "permissions.update",
        "sessions.delete",
        "sessions.deleteByCwd",
        "sessions.deleteBySessionId",
        "sessions.list",
        "sessions.read",
        "skills.delete",
        "skills.inspect",
        "slashCommands",
        "usage.limits",
      ],
    };
  }

  async #processStatus(): Promise<ManagerProcessStatus> {
    const loginTask = await queryLoginTask().catch((err) => ({
      supported: process.platform === "win32",
      installed: false,
      taskName: "DeskRelay Connector",
      error: (err as Error).message,
    }));
    return {
      scope: "device",
      kind: "connector-daemon",
      build: getDeskRelayBuildInfo(),
      pid: process.pid,
      startedAt: this.#startedAt,
      uptimeMs: Math.max(0, Date.now() - Date.parse(this.#startedAt)),
      platform: process.platform,
      arch: process.arch,
      ...(this.#listening ? { listening: this.#listening } : {}),
      autostart: {
        supported: loginTask.supported,
        installed: loginTask.installed,
        taskName: loginTask.taskName,
        ...("error" in loginTask && typeof loginTask.error === "string"
          ? { error: loginTask.error }
          : {}),
      },
    };
  }

  #networkStatus(): ManagerNetworkStatus {
    const generatedAt = new Date().toISOString();
    const addresses = collectNetworkAddresses(this.#listening?.port);
    const tailscaleAddresses = addresses.filter((address) => address.kind === "tailscale");
    const listening = this.#listening
      ? {
          host: this.#listening.host,
          port: this.#listening.port,
          kind: classifyNetworkHost(this.#listening.host),
        }
      : undefined;
    const probes = this.#listening
      ? [
          {
            id: "daemon.local-http",
            label: "Local connector HTTP",
            url: `http://127.0.0.1:${this.#listening.port}/status`,
            ok: true,
            status: 200,
          },
        ]
      : [];
    const summary =
      listening && listening.kind === "local" && tailscaleAddresses.length > 0
        ? {
            severity: "warn" as const,
            message:
              "Connector is running local-only even though a Tailscale address is available.",
          }
        : {
            severity: "ok" as const,
            message: listening
              ? `Connector is listening on ${listening.host}:${listening.port}.`
              : "Connector network listener has not reported a bind address.",
          };
    return {
      scope: "device",
      generatedAt,
      ...(listening ? { listening } : {}),
      tailscale: {
        detected: tailscaleAddresses.length > 0,
        addresses: tailscaleAddresses.map((address) => address.address),
        interfaceNames: [
          ...new Set(
            tailscaleAddresses
              .map((address) => address.interfaceName)
              .filter((name): name is string => Boolean(name)),
          ),
        ],
      },
      addresses,
      probes,
      summary,
    };
  }

  async #installStatus(): Promise<ManagerInstallStatus> {
    const generatedAt = new Date().toISOString();
    const loginTask = await queryLoginTask().catch((err) => ({
      supported: process.platform === "win32",
      installed: false,
      taskName: "DeskRelay Connector",
      error: (err as Error).message,
    }));
    const authExists = existsSync(defaultAuthFilePath());
    const warnAutostart = loginTask.supported && !loginTask.installed;
    return {
      scope: "device",
      generatedAt,
      build: getDeskRelayBuildInfo(),
      installed: authExists,
      running: true,
      autostart: {
        supported: loginTask.supported,
        installed: loginTask.installed,
        taskName: loginTask.taskName,
        ...("error" in loginTask && typeof loginTask.error === "string"
          ? { error: loginTask.error }
          : {}),
      },
      summary: {
        severity: warnAutostart ? "warn" : "ok",
        message: warnAutostart
          ? "Connector is running, but Windows login autostart is not installed."
          : "Connector is installed and running.",
      },
    };
  }

  #securityBoundary(): ManagerSecurityBoundary {
    const generatedAt = new Date().toISOString();
    const networkUrl = this.#listening
      ? `http://${formatHostForUrl(this.#listening.host)}:${this.#listening.port}`
      : undefined;
    const networkKind = this.#listening ? classifyNetworkHost(this.#listening.host) : "unknown";
    const unrestricted = this.#workspaceRoots.mode === "unrestricted";
    const warnings: string[] = [];
    if (networkKind === "public") warnings.push("Connector is bound to a public-looking address.");
    if (unrestricted) warnings.push("Workspace browsing is unrestricted for this connector.");
    if (networkKind === "public" && unrestricted) {
      warnings.push("Public network exposure and unrestricted workspace access are both enabled.");
    }
    return {
      scope: "device",
      generatedAt,
      tokenBoundary: {
        daemonTokenAvailable: true,
        browserReceivesDaemonToken: false,
      },
      networkBoundary: {
        ...(networkUrl ? { url: networkUrl } : {}),
        kind: networkKind,
        publicExposure: networkKind === "public",
      },
      workspaceBoundary: {
        mode: this.#workspaceRoots.mode,
        roots: this.#workspaceRoots.roots,
        unrestricted,
      },
      warnings,
      summary: {
        severity: warnings.length > 0 ? "warn" : "ok",
        message:
          warnings.length > 0
            ? `${warnings.length} security boundary warning(s).`
            : "Connector security boundary is constrained.",
      },
    };
  }

  async #handleFsList(url: URL): Promise<Response> {
    const path = url.searchParams.get("path") ?? "";
    const roots = fsWorkspaceRootsForScope(
      this.#workspaceRoots,
      url.searchParams.get("workspaceScope"),
    );
    try {
      const result = await listDir(path, roots);
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
      const result = await makeDir(
        { parent: b.parent, name: b.name },
        fsWorkspaceRootsForScope(
          this.#workspaceRoots,
          typeof b.workspaceScope === "string" ? b.workspaceScope : undefined,
        ),
      );
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

  /** GET /instructions exposes the Claude Code instruction files used by this device. */
  async #handleInstructionsRead(url: URL): Promise<Response> {
    const cwd = url.searchParams.get("cwd") ?? undefined;
    const snapshot = await readClaudeInstructions(cwd, this.#workspaceRoots);
    return jsonResponse(200, snapshot);
  }

  async #handleInstructionWrite(scope: string, req: Request): Promise<Response> {
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
    if (typeof b.content !== "string") {
      return jsonResponse(400, { error: "content is required" });
    }
    try {
      const source = await writeClaudeInstruction(
        {
          scope: scope as ClaudeInstructionScope,
          content: b.content,
          ...(typeof b.cwd === "string" ? { cwd: b.cwd } : {}),
          ...(typeof b.expectedHash === "string" ? { expectedHash: b.expectedHash } : {}),
        },
        this.#workspaceRoots,
      );
      return jsonResponse(200, source);
    } catch (err) {
      if (err instanceof InstructionError) {
        return jsonResponse(err.status, { error: err.message });
      }
      throw err;
    }
  }

  async #handleInstructionDelete(scope: string, req: Request): Promise<Response> {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    try {
      const source = await deleteClaudeInstruction(
        {
          scope: scope as ClaudeInstructionScope,
          ...(typeof b.cwd === "string" ? { cwd: b.cwd } : {}),
          ...(typeof b.expectedHash === "string" ? { expectedHash: b.expectedHash } : {}),
        },
        this.#workspaceRoots,
      );
      return jsonResponse(200, source);
    } catch (err) {
      if (err instanceof InstructionError) {
        return jsonResponse(err.status, { error: err.message });
      }
      throw err;
    }
  }

  /** Reloads the SiteWsClient after a separate `cr-connector pair NEWCODE` process
   *  writes fresh identity material to disk. */
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

  async #handleSystemUninstall(req: Request): Promise<Response> {
    const uninstall = this.#options.requestSelfUninstall;
    if (!uninstall) {
      return jsonResponse(501, { ok: false, error: "self uninstall is not wired" });
    }
    let removeRepo = false;
    try {
      const body = await req.json();
      if (typeof body === "object" && body !== null) {
        removeRepo = (body as { removeRepo?: unknown }).removeRepo === true;
      }
    } catch {
      // Body is optional.
    }
    const result = await uninstall({ removeRepo });
    return jsonResponse(200, result ?? { ok: true });
  }

  async #handleSystemUpdate(): Promise<Response> {
    const update = this.#options.requestSelfUpdate;
    if (!update) {
      return jsonResponse(501, { ok: false, error: "self update is not wired" });
    }
    try {
      const result = await update();
      return jsonResponse(200, result ?? { ok: true });
    } catch (err) {
      return jsonResponse(500, { ok: false, error: (err as Error).message });
    }
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

function defaultConnectorLogPath(): string {
  return join(defaultStateDir(), "logs", WINDOWS_LOGIN_TASK_LOG_NAME);
}

function collectNetworkAddresses(port?: number): ManagerNetworkAddress[] {
  const rows: ManagerNetworkAddress[] = [];
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" && entry.family !== "IPv6") continue;
      if (entry.address.startsWith("169.254.")) continue;
      const kind = classifyNetworkHost(entry.address);
      rows.push({
        address: entry.address,
        interfaceName,
        family: entry.family,
        kind,
        internal: entry.internal,
        ...(port && entry.family === "IPv4" ? { url: `http://${entry.address}:${port}` } : {}),
      });
    }
  }
  return rows.sort((left, right) => networkKindRank(left.kind) - networkKindRank(right.kind));
}

function classifyNetworkHost(host: string): ManagerNetworkKind {
  const normalized = host.replace(/^\[|\]$/g, "");
  if (normalized === "0.0.0.0") return "unknown";
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
    return "local";
  }
  if (normalized.startsWith("100.")) return "tailscale";
  if (
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  ) {
    return "lan";
  }
  return "public";
}

function networkKindRank(kind: ManagerNetworkKind): number {
  const ranks: Record<ManagerNetworkKind, number> = {
    tailscale: 0,
    lan: 1,
    local: 2,
    public: 3,
    unknown: 4,
  };
  return ranks[kind];
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function normalizeLogSource(value: string | null, allowed: string[]): string | undefined {
  const raw = (value ?? allowed[0] ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "daemon") return allowed.includes("connector") ? "connector" : undefined;
  return allowed.includes(raw) ? raw : undefined;
}

function clampTail(value: string | null): number {
  const n = Number(value ?? "200");
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

function normalizeLogLevel(value: string | null): string | undefined {
  const level = (value ?? "").trim().toLowerCase();
  return level ? level : undefined;
}

async function readLogResponse(input: {
  scope: "device";
  source: string;
  path: string;
  tail: number;
  level?: string;
}): Promise<ManagerLogResponse> {
  const readAt = new Date().toISOString();
  try {
    await stat(input.path);
    const raw = await readFile(input.path, "utf8");
    const allLines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const nonEmptyLines = allLines.at(-1) === "" ? allLines.slice(0, -1) : allLines;
    const filtered = input.level
      ? nonEmptyLines.filter((line) => logLineMatchesLevel(line, input.level ?? ""))
      : nonEmptyLines;
    const lines = filtered.slice(-input.tail);
    return {
      scope: input.scope,
      source: input.source,
      path: input.path,
      exists: true,
      tail: input.tail,
      lines,
      truncated: filtered.length > lines.length,
      readAt,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      scope: input.scope,
      source: input.source,
      path: input.path,
      exists: false,
      tail: input.tail,
      lines: [],
      truncated: false,
      readAt,
      error: code === "ENOENT" ? "log file not found" : (err as Error).message,
    };
  }
}

function logLineMatchesLevel(line: string, level: string): boolean {
  try {
    const parsed = JSON.parse(line) as { level?: unknown };
    return typeof parsed.level === "string" && parsed.level.toLowerCase() === level;
  } catch {
    return line.toLowerCase().includes(level);
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
