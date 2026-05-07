// in-process-host — runs a behavior definition directly inside the
// daemon process, without spawning a subprocess and without going
// through JSONRPC stdio. The daemon's HTTP API (`/behaviors/:id/request`)
// and BehaviorRegistry interface stay identical: every consumer that
// holds a `BehaviorHost` reference (request, shutdown) treats the
// in-process flavor as a drop-in.
//
// Why this exists: every fragility we patched today (workspace-dep
// resolution in the bundle, behavior-host argv name detection, stdin
// pipe quirks in compiled-binary subprocesses, login-task elevation
// for the spawned child) lives on the subprocess path. First-party
// behaviors don't need the isolation that path was built for — they're
// shipped with the daemon, signed with the daemon, and crash with the
// daemon anyway. Loading them in-process eliminates the entire pipeline
// in one move.

import type { InProcessSubscriptionBroker } from "@deskrelay/core";
import type { Actor, EventInput } from "@deskrelay/shared/event";
import { type SpaceId, asSpaceId, makeSpaceId } from "@deskrelay/shared/space";
import { BehaviorHostError, type BehaviorHostLogRecord } from "./host.ts";
import type { LoadedBehaviorPackage } from "./manifest-loader.ts";
import type {
  BehaviorContext,
  BehaviorLogger,
  BehaviorPublishInput,
  RequestHandler,
  RuntimeContextSettings,
} from "./runtime.ts";

export interface InProcessBehaviorDefinition {
  /** Same shape as the manifest field on a `LoadedBehaviorPackage`. The
   *  in-process loader doesn't read it from disk; the behavior package
   *  exports its manifest as a value so we can build the context with
   *  the right name + permissions + publisher. */
  manifest: LoadedBehaviorPackage["manifest"];
  start(ctx: BehaviorContext): void | Promise<void>;
  stop?(ctx: BehaviorContext): void | Promise<void>;
}

export interface InProcessBehaviorHostOptions {
  def: InProcessBehaviorDefinition;
  broker: InProcessSubscriptionBroker;
  instanceId: string;
  /** Mirrors BehaviorHostOptions.onLog so the daemon can route in-process
   *  log records into the same per-instance log sink it uses for
   *  subprocess hosts. Without this, behaviors that call
   *  `ctx.logger.info(...)` would emit nowhere. */
  onLog?: (record: BehaviorHostLogRecord) => void;
}

/** Drop-in replacement for the subprocess-backed BehaviorHost. Holds the
 *  registered request handlers in a Map and dispatches them as direct
 *  async calls; publishes events straight to the broker; logs into the
 *  same onLog channel a subprocess host would use. The shape matches
 *  enough of `BehaviorHost` that BehaviorEntry consumers don't have to
 *  branch on flavor — they just hold the reference and call request /
 *  shutdown like before. */
export class InProcessBehaviorHost {
  readonly #handlers = new Map<string, RequestHandler>();
  readonly #def: InProcessBehaviorDefinition;
  readonly #broker: InProcessSubscriptionBroker;
  readonly #instanceId: string;
  readonly #onLog: ((record: BehaviorHostLogRecord) => void) | undefined;
  readonly #ctx: BehaviorContext;
  readonly #exited: Promise<number | null>;
  #resolveExited: ((code: number | null) => void) | undefined;
  #stopped = false;

  constructor(options: InProcessBehaviorHostOptions) {
    this.#def = options.def;
    this.#broker = options.broker;
    this.#instanceId = options.instanceId;
    this.#onLog = options.onLog;
    this.#ctx = this.#buildContext();
    // Mirrors the subprocess host's `exited` promise so BehaviorRegistry
    // can clean up entries the same way after both flavors finish.
    this.#exited = new Promise<number | null>((resolve) => {
      this.#resolveExited = resolve;
    });
  }

  /** Run the behavior's start() handler. Caller must await before
   *  routing requests so the handlers map is populated. Mirrors the
   *  __lifecycle.start round-trip the subprocess version awaits. */
  async start(): Promise<void> {
    await this.#def.start(this.#ctx);
  }

  /** Same shape as BehaviorHost.request — dispatches to the handler
   *  registered via ctx.onRequest. Throws BehaviorHostError on missing
   *  handler or thrown errors so the daemon's `/behaviors/:id/request`
   *  route surfaces a structured `{error: {code, message}}` body. */
  async request<R = unknown>(
    method: string,
    params?: unknown,
    _options?: { timeoutMs?: number },
  ): Promise<R> {
    if (this.#stopped) {
      throw new BehaviorHostError("BehaviorHost is shutting down");
    }
    if (method.startsWith("__lifecycle.")) {
      throw new BehaviorHostError(`reserved method: ${method}`);
    }
    const handler = this.#handlers.get(method);
    if (!handler) {
      throw new BehaviorHostError(`method not found: ${method}`, -32601);
    }
    try {
      return (await handler(params)) as R;
    } catch (err) {
      throw new BehaviorHostError(
        `handler "${method}" threw: ${(err as Error).message}`,
        -32000,
      );
    }
  }

  /** Same shape as BehaviorHost.shutdown — calls the behavior's stop()
   *  hook (if defined) and resolves the exited promise so the registry
   *  can prune the entry. Idempotent. */
  async shutdown(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    try {
      await this.#def.stop?.(this.#ctx);
    } catch (err) {
      this.#emitLog("warn", `stop hook threw: ${(err as Error).message}`);
    }
    this.#resolveExited?.(0);
  }

  /** Mirrors BehaviorHost.exited so BehaviorRegistry's load-time wiring
   *  ("delete entry when subprocess exits") works for in-process too. */
  get exited(): Promise<number | null> {
    return this.#exited;
  }

  // ---- internal -------------------------------------------------------

  #buildContext(): BehaviorContext {
    const settings: RuntimeContextSettings = { instanceId: this.#instanceId };
    const manifest = this.#def.manifest;
    const logger: BehaviorLogger = {
      debug: (msg, extras) => this.#emitLog("debug", msg, extras),
      info: (msg, extras) => this.#emitLog("info", msg, extras),
      warn: (msg, extras) => this.#emitLog("warn", msg, extras),
      error: (msg, extras) => this.#emitLog("error", msg, extras),
    };
    const publish = (input: BehaviorPublishInput): void => {
      const spaceId =
        input.spaceId ?? makeSpaceId(manifest.name, "default", settings.instanceId);
      this.#broker.publish({
        spaceId: asSpaceId(spaceId),
        kind: input.kind,
        content: input.content,
        ...(input.actor ? { actor: input.actor as Actor } : {}),
      } as EventInput);
    };
    return {
      manifest,
      settings,
      logger,
      onRequest: (method, handler) => {
        if (this.#handlers.has(method)) {
          throw new Error(`onRequest: handler already registered for "${method}"`);
        }
        if (method.startsWith("__lifecycle.")) {
          throw new Error(`onRequest: "${method}" is a reserved lifecycle method`);
        }
        this.#handlers.set(method, handler as RequestHandler);
      },
      publish,
      emit: (kind, content) => publish({ kind, content }),
      makeSpace: (kind, id): SpaceId => makeSpaceId(manifest.name, kind, id),
    };
  }

  #emitLog(
    level: BehaviorHostLogRecord["level"],
    msg: string,
    extras?: Record<string, unknown>,
  ): void {
    if (!this.#onLog) return;
    this.#onLog({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(extras ?? {}),
    });
  }
}
