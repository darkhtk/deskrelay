// runtime.ts — what behavior authors import.
//
// A behavior package's entry file calls `runBehavior({ ... })` once, which:
//   1. Reads JSONRPC frames from process.stdin (NDJSON)
//   2. Dispatches request methods to the author's onRequest handlers
//   3. Lets the author publish() events as JSONRPC notifications on stdout
//   4. Awaits a graceful shutdown signal from the host
//
// IMPORTANT for behavior authors:
//   - Do NOT use console.log — it pollutes the JSONRPC stdout stream.
//     Use ctx.logger (writes to stderr, the host treats it as logs).
//   - Errors thrown from request handlers become JSONRPC error responses
//     with code -32000 (application error).
//   - The "lifecycle" methods are well-known internal request methods:
//       __lifecycle.start  — first request after spawn; await before serving others
//       __lifecycle.stop   — last request before subprocess exits
//
// Example:
//
//   import { runBehavior } from "@claude-remote/behavior-sdk/runtime";
//   await runBehavior({
//     manifest: { ...manifestInline },
//     async start(ctx) {
//       ctx.onRequest("echo", async (params) => {
//         ctx.publish({ kind: "echoed", content: params });
//         return { ok: true };
//       });
//     },
//   });

import type { EventInput } from "@claude-remote/shared/event";
import type { BehaviorManifest } from "@claude-remote/shared/manifest";
import { type SpaceId, makeSpaceId } from "@claude-remote/shared/space";
import {
  JsonRpcErrorCode,
  type JsonRpcRequest,
  NdjsonDecoder,
  encodeFrame,
  isRequest,
  makeError,
  makeNotification,
  makeSuccess,
} from "./ipc.ts";

const LIFECYCLE_START = "__lifecycle.start";
const LIFECYCLE_STOP = "__lifecycle.stop";

export interface RuntimeContextSettings {
  /** The instance id passed by the host (chosen at spawn time). */
  instanceId: string;
}

export interface BehaviorPublishInput {
  kind: string;
  content: unknown;
  /** Defaults to `{behaviorName}.default:{instanceId}`. */
  spaceId?: SpaceId;
  /** Optional actor — host may inject one based on the originating user. */
  actor?: EventInput["actor"];
}

export interface BehaviorLogger {
  debug(msg: string, extras?: Record<string, unknown>): void;
  info(msg: string, extras?: Record<string, unknown>): void;
  warn(msg: string, extras?: Record<string, unknown>): void;
  error(msg: string, extras?: Record<string, unknown>): void;
}

export type RequestHandler<P = unknown, R = unknown> = (params: P) => R | Promise<R>;

export interface BehaviorContext {
  manifest: BehaviorManifest;
  settings: RuntimeContextSettings;
  logger: BehaviorLogger;
  /** Register a handler for a JSONRPC method name. Throws if already registered. */
  onRequest<P = unknown, R = unknown>(method: string, handler: RequestHandler<P, R>): void;
  /** Publish an event to this behavior's default space. Equivalent to
   *  `publish({kind, content})`. Use this for the common "emit one event"
   *  case; reach for `publish` when you need a custom spaceId or actor. */
  emit(kind: string, content: unknown): void;
  /** Publish an event upstream. Host forwards to kernel broker. */
  publish(input: BehaviorPublishInput): void;
  /** Build a SpaceId rooted in this behavior's namespace. */
  makeSpace(kind: string, id: string): SpaceId;
}

export interface RunBehaviorOptions {
  manifest: BehaviorManifest;
  start(ctx: BehaviorContext): void | Promise<void>;
  stop?(ctx: BehaviorContext): void | Promise<void>;
}

export interface RuntimeIO {
  stdin: AsyncIterable<Uint8Array>;
  stdout(line: string): void;
  stderr(line: string): void;
  /** Resolves when the host signals graceful shutdown (or the IO closes). */
  exit?(code: number): void;
}

/** Default IO bridges to the current Bun/Node process. */
function defaultIO(): RuntimeIO {
  // Use Bun.write() / process.stdin async iteration for cross-runtime safety.
  return {
    stdin: Bun.stdin.stream() as unknown as AsyncIterable<Uint8Array>,
    stdout(line) {
      Bun.write(Bun.stdout, line);
    },
    stderr(line) {
      Bun.write(Bun.stderr, line);
    },
    exit(code) {
      process.exit(code);
    },
  };
}

export async function runBehavior(
  options: RunBehaviorOptions,
  io: RuntimeIO = defaultIO(),
): Promise<void> {
  const handlers = new Map<string, RequestHandler>();

  // settings populated by the __lifecycle.start request from the host
  let settings: RuntimeContextSettings | undefined;
  let started = false;
  let stopped = false;

  const writeFrame = (frame: object) => io.stdout(encodeFrame(frame as never));

  const logger: BehaviorLogger = {
    debug: (msg, extras) => writeLog(io, "debug", msg, extras),
    info: (msg, extras) => writeLog(io, "info", msg, extras),
    warn: (msg, extras) => writeLog(io, "warn", msg, extras),
    error: (msg, extras) => writeLog(io, "error", msg, extras),
  };

  const ctx: BehaviorContext = {
    manifest: options.manifest,
    get settings() {
      if (!settings) {
        throw new Error("BehaviorContext.settings unavailable before __lifecycle.start completes");
      }
      return settings;
    },
    logger,
    onRequest(method, handler) {
      if (handlers.has(method)) {
        throw new Error(`onRequest: handler already registered for "${method}"`);
      }
      if (method.startsWith("__lifecycle.")) {
        throw new Error(`onRequest: "${method}" is a reserved lifecycle method`);
      }
      handlers.set(method, handler as RequestHandler);
    },
    publish(input) {
      const spaceId =
        input.spaceId ?? makeSpaceId(options.manifest.name, "default", needSettings().instanceId);
      const note = makeNotification("event", {
        spaceId,
        kind: input.kind,
        content: input.content,
        actor: input.actor,
      });
      writeFrame(note);
    },
    emit(kind, content) {
      ctx.publish({ kind, content });
    },
    makeSpace(kind, id) {
      return makeSpaceId(options.manifest.name, kind, id);
    },
  };

  function needSettings(): RuntimeContextSettings {
    if (!settings) {
      throw new Error("BehaviorContext.publish unavailable before __lifecycle.start completes");
    }
    return settings;
  }

  async function dispatchRequest(req: JsonRpcRequest): Promise<void> {
    if (req.method === LIFECYCLE_START) {
      if (started) {
        writeFrame(makeError(req.id, JsonRpcErrorCode.InvalidRequest, "already started"));
        return;
      }
      const params = req.params as RuntimeContextSettings | undefined;
      if (!params || typeof params.instanceId !== "string") {
        writeFrame(makeError(req.id, JsonRpcErrorCode.InvalidParams, "missing instanceId"));
        return;
      }
      settings = { instanceId: params.instanceId };
      try {
        await options.start(ctx);
      } catch (err) {
        writeFrame(
          makeError(
            req.id,
            JsonRpcErrorCode.InternalError,
            `start failed: ${(err as Error).message}`,
          ),
        );
        return;
      }
      started = true;
      writeFrame(makeSuccess(req.id, { ok: true }));
      return;
    }

    if (req.method === LIFECYCLE_STOP) {
      if (!started) {
        writeFrame(makeError(req.id, JsonRpcErrorCode.InvalidRequest, "not started"));
        return;
      }
      if (stopped) {
        writeFrame(makeError(req.id, JsonRpcErrorCode.InvalidRequest, "already stopped"));
        return;
      }
      try {
        if (options.stop) await options.stop(ctx);
      } catch (err) {
        writeFrame(
          makeError(
            req.id,
            JsonRpcErrorCode.InternalError,
            `stop failed: ${(err as Error).message}`,
          ),
        );
        return;
      }
      stopped = true;
      writeFrame(makeSuccess(req.id, { ok: true }));
      // Host should close stdin shortly; runtime exits when stdin EOF.
      return;
    }

    if (!started) {
      writeFrame(makeError(req.id, JsonRpcErrorCode.InvalidRequest, "behavior not yet started"));
      return;
    }

    const handler = handlers.get(req.method);
    if (!handler) {
      writeFrame(makeError(req.id, JsonRpcErrorCode.MethodNotFound, req.method));
      return;
    }
    try {
      const result = await handler(req.params);
      writeFrame(makeSuccess(req.id, result));
    } catch (err) {
      writeFrame(
        makeError(req.id, -32000, `handler "${req.method}" threw: ${(err as Error).message}`),
      );
    }
  }

  const decoder = new NdjsonDecoder();

  for await (const chunk of io.stdin) {
    let frames: unknown[];
    try {
      frames = decoder.push(chunk);
    } catch (err) {
      logger.error(`ipc decode error: ${(err as Error).message}`);
      io.exit?.(1);
      return;
    }
    for (const frame of frames) {
      if (isRequest(frame)) {
        await dispatchRequest(frame);
      } else {
        // Notifications and responses are unexpected coming from host →
        // behavior. Reply with InvalidRequest (id-less since not a request).
        writeFrame(
          makeError(
            null,
            JsonRpcErrorCode.InvalidRequest,
            "behavior runtime expects only requests from host",
          ),
        );
      }
    }
  }
}

function writeLog(
  io: RuntimeIO,
  level: string,
  msg: string,
  extras: Record<string, unknown> | undefined,
): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (extras) Object.assign(record, extras);
  io.stderr(`${JSON.stringify(record)}\n`);
}
