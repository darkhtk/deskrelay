// host.ts — what the PC connector imports.
//
// `spawnBehaviorHost(...)` launches a behavior subprocess (Bun running the
// behavior's entry file), establishes JSONRPC over its stdio, and:
//   - Sends __lifecycle.start once stdin is open
//   - Forwards behavior's `event` notifications into a kernel broker
//   - Lets the connector send arbitrary requests via host.request(method, params)
//   - Captures stderr line-by-line as structured logs
//   - Sends __lifecycle.stop and waits for graceful exit on host.shutdown()
//
// One BehaviorHost per behavior instance. The connector creates many
// hosts and lets the broker route between them.

import { basename } from "node:path";
import type { InProcessSubscriptionBroker } from "@claude-remote/core";
import type { Actor, EventInput } from "@claude-remote/shared/event";
import { type Subprocess, spawn } from "bun";
import {
  JsonRpcErrorCode,
  type JsonRpcId,
  NdjsonDecoder,
  encodeFrame,
  isNotification,
  isResponse,
  makeRequest,
} from "./ipc.ts";
import type { LoadedBehaviorPackage } from "./manifest-loader.ts";

export interface BehaviorHostLogRecord {
  ts: string;
  level: string;
  msg: string;
  /** anything else the behavior put in its log line */
  [key: string]: unknown;
}

export interface BehaviorHostOptions {
  pkg: LoadedBehaviorPackage;
  broker: InProcessSubscriptionBroker;
  /** Identifier of this behavior's instance — feeds into the SpaceId
   *  the behavior publishes to by default. Different instances of the
   *  same behavior get different ids. */
  instanceId: string;
  /** Path to the Bun executable. Defaults to "bun" on PATH. */
  bunPath?: string;
  /** Optional handler for stderr-side log records. */
  onLog?: (record: BehaviorHostLogRecord) => void;
  /** Optional handler for unexpected exit (non-zero or before shutdown). */
  onUnexpectedExit?: (info: { code: number | null; signal?: string }) => void;
  /** Default request timeout in ms. */
  requestTimeoutMs?: number;
}

export interface BehaviorHostRequestOptions {
  timeoutMs?: number;
  /** Set on the published events that this request causes the behavior to emit.
   *  (Behavior author can override per-publish.) */
  actor?: Actor;
}

export class BehaviorHostError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "BehaviorHostError";
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

export class BehaviorHost {
  readonly pkg: LoadedBehaviorPackage;
  readonly instanceId: string;

  readonly #broker: InProcessSubscriptionBroker;
  readonly #subprocess: Subprocess<"pipe", "pipe", "pipe">;
  readonly #decoder = new NdjsonDecoder();
  readonly #stderrDecoder = new NdjsonDecoder();
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  readonly #onLog: ((r: BehaviorHostLogRecord) => void) | undefined;
  readonly #onUnexpectedExit:
    | ((info: { code: number | null; signal?: string }) => void)
    | undefined;
  readonly #requestTimeoutMs: number;

  #nextRequestId = 1;
  #shuttingDown = false;
  #shutdownComplete = false;
  #readLoopPromise: Promise<void>;
  #stderrReadLoopPromise: Promise<void>;

  constructor(options: BehaviorHostOptions, subprocess: Subprocess<"pipe", "pipe", "pipe">) {
    this.pkg = options.pkg;
    this.instanceId = options.instanceId;
    this.#broker = options.broker;
    this.#subprocess = subprocess;
    this.#onLog = options.onLog;
    this.#onUnexpectedExit = options.onUnexpectedExit;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#readLoopPromise = this.#runStdoutLoop();
    this.#stderrReadLoopPromise = this.#runStderrLoop();
  }

  /** Send a request and await the typed response. */
  async request<R = unknown>(
    method: string,
    params?: unknown,
    options: BehaviorHostRequestOptions = {},
  ): Promise<R> {
    if (this.#shuttingDown) {
      throw new BehaviorHostError("BehaviorHost is shutting down");
    }
    if (
      method.startsWith("__lifecycle.") &&
      method !== "__lifecycle.start" &&
      method !== "__lifecycle.stop"
    ) {
      throw new BehaviorHostError(`reserved method: ${method}`);
    }
    const id = this.#nextRequestId++;
    return await this.#sendAndAwait<R>(id, method, params, options.timeoutMs);
  }

  /** Send __lifecycle.start. Call once after the subprocess spawns and
   *  before any other request. */
  async start(): Promise<void> {
    await this.#sendAndAwait<{ ok: true }>(
      this.#nextRequestId++,
      "__lifecycle.start",
      { instanceId: this.instanceId },
      this.#requestTimeoutMs,
    );
  }

  /** Send __lifecycle.stop, then close stdin and wait for the process to
   *  exit. Idempotent. */
  async shutdown(): Promise<void> {
    if (this.#shutdownComplete) return;
    if (!this.#shuttingDown) {
      this.#shuttingDown = true;
      try {
        await this.#sendAndAwait<{ ok: true }>(
          this.#nextRequestId++,
          "__lifecycle.stop",
          undefined,
          STOP_TIMEOUT_MS,
        );
      } catch {
        // best-effort; we'll still close stdin and wait for exit
      }
      // Closing stdin signals EOF to the runtime's `for await` loop.
      try {
        const stdin = this.#subprocess.stdin;
        if (stdin && typeof (stdin as { end?: () => void }).end === "function") {
          (stdin as { end: () => void }).end();
        }
      } catch {
        // ignore
      }
      // Wait up to STOP_TIMEOUT_MS for exit.
      const exitRace = await Promise.race([
        this.#subprocess.exited.then((code) => ({ code, timedOut: false })),
        new Promise<{ code: null; timedOut: true }>((resolve) =>
          setTimeout(() => resolve({ code: null, timedOut: true }), STOP_TIMEOUT_MS),
        ),
      ]);
      if (exitRace.timedOut) {
        this.#subprocess.kill();
      }
      // Wait for read loops to finish so callers can safely await shutdown().
      await Promise.allSettled([this.#readLoopPromise, this.#stderrReadLoopPromise]);
      this.#shutdownComplete = true;
      // Reject any still-pending requests.
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new BehaviorHostError("BehaviorHost shut down"));
      }
      this.#pending.clear();
    }
  }

  // ---- internal -----------------------------------------------------

  async #sendAndAwait<R>(
    id: JsonRpcId,
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<R> {
    const promise = new Promise<R>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BehaviorHostError(`request "${method}" timed out`));
      }, timeoutMs ?? this.#requestTimeoutMs);
      this.#pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeout,
      });
    });
    const frame = makeRequest(id, method, params);
    this.#writeStdin(encodeFrame(frame));
    return await promise;
  }

  #writeStdin(text: string): void {
    const stdin = this.#subprocess.stdin;
    if (stdin && typeof (stdin as { write?: (s: string) => void }).write === "function") {
      (stdin as { write: (s: string) => void }).write(text);
    } else {
      throw new BehaviorHostError("subprocess stdin not writable");
    }
  }

  async #runStdoutLoop(): Promise<void> {
    const stdout = this.#subprocess.stdout;
    if (
      !stdout ||
      typeof (stdout as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function"
    ) {
      return;
    }
    try {
      for await (const chunk of stdout as unknown as AsyncIterable<Uint8Array>) {
        let frames: unknown[];
        try {
          frames = this.#decoder.push(chunk);
        } catch (err) {
          this.#emitLog("error", `host: stdout decode error: ${(err as Error).message}`);
          continue;
        }
        for (const frame of frames) {
          this.#dispatchFrame(frame);
        }
      }
    } finally {
      const code = await this.#subprocess.exited;
      if (!this.#shuttingDown) {
        this.#onUnexpectedExit?.({ code });
      }
    }
  }

  async #runStderrLoop(): Promise<void> {
    const stderr = this.#subprocess.stderr;
    if (
      !stderr ||
      typeof (stderr as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function"
    ) {
      return;
    }
    for await (const chunk of stderr as unknown as AsyncIterable<Uint8Array>) {
      let frames: unknown[];
      try {
        frames = this.#stderrDecoder.push(chunk);
      } catch {
        // stderr may contain non-JSON noise (e.g., Bun runtime errors).
        // Forward as a synthetic log line so it's not silently dropped.
        const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        this.#emitLog("warn", `non-ndjson stderr chunk: ${text.trim()}`);
        continue;
      }
      for (const frame of frames) {
        if (
          frame &&
          typeof frame === "object" &&
          typeof (frame as Record<string, unknown>).level === "string" &&
          typeof (frame as Record<string, unknown>).msg === "string"
        ) {
          const r = frame as BehaviorHostLogRecord;
          this.#onLog?.(r);
        }
      }
    }
  }

  #emitLog(level: string, msg: string): void {
    this.#onLog?.({
      ts: new Date().toISOString(),
      level,
      msg,
      source: "behavior-host",
    });
  }

  #dispatchFrame(frame: unknown): void {
    if (isResponse(frame)) {
      if (frame.id === null) {
        this.#emitLog(
          "warn",
          `response with null id (parse error from runtime): ${JSON.stringify(frame)}`,
        );
        return;
      }
      const pending = this.#pending.get(frame.id);
      if (!pending) {
        this.#emitLog("warn", `response for unknown id ${String(frame.id)}`);
        return;
      }
      this.#pending.delete(frame.id);
      clearTimeout(pending.timeout);
      if ("error" in frame) {
        pending.reject(
          new BehaviorHostError(frame.error.message, frame.error.code, frame.error.data),
        );
      } else {
        pending.resolve(frame.result);
      }
      return;
    }
    if (isNotification(frame)) {
      if (frame.method === "event") {
        this.#handleEvent(frame.params);
        return;
      }
      this.#emitLog("warn", `unknown notification method: ${frame.method}`);
      return;
    }
    this.#emitLog(
      "warn",
      `unexpected frame from runtime (not request/response/notification): ${JSON.stringify(frame)}`,
    );
  }

  #handleEvent(params: unknown): void {
    if (typeof params !== "object" || params === null) {
      this.#emitLog("warn", "event notification missing params");
      return;
    }
    const p = params as Record<string, unknown>;
    if (typeof p.spaceId !== "string" || typeof p.kind !== "string") {
      this.#emitLog("warn", "event notification missing spaceId/kind");
      return;
    }
    const publishInput: EventInput = {
      spaceId: p.spaceId as never,
      kind: p.kind,
      content: p.content,
    };
    if (p.actor !== undefined) {
      publishInput.actor = p.actor as Actor;
    }
    try {
      this.#broker.publish(publishInput);
    } catch (err) {
      this.#emitLog("error", `broker.publish failed: ${(err as Error).message}`);
    }
  }
}

export interface SpawnBehaviorHostResult {
  host: BehaviorHost;
  /** Resolves when the subprocess fully exits. Use to detect crashes. */
  exited: Promise<number | null>;
}

/** Build the spawn argv for a behavior host.
 *
 *  Two flavors:
 *    - Real Bun CLI (`bun run <entry>`): used when the daemon is run via
 *      `bun run …/bin.ts` (dev / monorepo) or when the operator points
 *      `CR_CONNECTOR_BUN_PATH` at a system bun.
 *    - Compiled cr-connector single-file binary (`cr-connector
 *      behavior-host <entry>`): used when the daemon ships as a
 *      Bun-compiled binary (direct zip / Homebrew / future installer). The compiled
 *      binary is NOT the bun CLI — it has no `run` subcommand — so we
 *      use the binary's hidden `behavior-host` entry, which import()s
 *      the file inside the same Bun runtime.
 *
 *  Detection by basename: matches the bare `cr-connector(.exe)?` plus
 *  the GitHub release artifact filenames `cr-connector-<platform>-<arch>(.exe)?`
 *  (e.g. `cr-connector-windows-x64.exe`, `cr-connector-darwin-arm64`).
 *  Restricting the suffix to a known platform/arch list keeps lookalike
 *  binaries (`cr-connector-cli`, `cr-connector-helper`) on the bun-CLI
 *  path — operators shipping wrappers under those names rely on `bun
 *  run` semantics. Operators who rename outside this pattern should set
 *  `CR_CONNECTOR_BUN_PATH` to a real `bun`. Exported for unit testing. */
const CR_CONNECTOR_BIN_NAME =
  /^cr[-_]connector(?:[-_](?:windows|win32|darwin|macos|linux)[-_](?:x64|arm64|x86_64|aarch64))?(?:\.exe)?$/;

export function spawnArgvForBehaviorHost(bunPath: string, entryPath: string): string[] {
  const base = basename(bunPath).toLowerCase();
  if (CR_CONNECTOR_BIN_NAME.test(base)) {
    return [bunPath, "behavior-host", entryPath];
  }
  return [bunPath, "run", entryPath];
}

export async function spawnBehaviorHost(
  options: BehaviorHostOptions,
): Promise<SpawnBehaviorHostResult> {
  const bunPath = options.bunPath ?? "bun";
  const subprocess = spawn({
    cmd: spawnArgvForBehaviorHost(bunPath, options.pkg.entryPath),
    cwd: options.pkg.packageDir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CLAUDE_REMOTE_BEHAVIOR_INSTANCE: options.instanceId,
    },
  });
  const host = new BehaviorHost(options, subprocess);
  await host.start();
  return {
    host,
    exited: subprocess.exited.then((code) => code ?? null),
  };
}

// JsonRpcErrorCode re-exported for convenience.
export { JsonRpcErrorCode };
