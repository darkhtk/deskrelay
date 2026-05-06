// JSONRPC 2.0 over NDJSON — the wire protocol between the connector
// (host) and behavior subprocesses.
//
// Frames are JSON objects, one per line, terminated by `\n`. We picked
// NDJSON over Content-Length-prefixed framing (LSP-style) because:
//   - stdio is line-oriented, every modern shell respects line buffering
//   - debugging is trivial (just `cat` the stream)
//   - frames stay small (no megabyte transcripts on this channel)
//
// Three frame types:
//   request:      { jsonrpc, id, method, params }
//   response:     { jsonrpc, id, result } | { jsonrpc, id, error }
//   notification: { jsonrpc, method, params }   ← no id; one-way (events)
//
// The host issues requests to the behavior; the behavior responds.
// The behavior emits notifications (events); the host forwards them
// to the kernel broker.
//
// Errors follow JSONRPC 2.0 standard codes:
//   -32700 Parse error
//   -32600 Invalid Request
//   -32601 Method not found
//   -32602 Invalid params
//   -32603 Internal error
//   -32000..-32099 reserved for application errors

export const JSONRPC_VERSION = "2.0" as const;

export type JsonRpcId = number | string;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcError {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse<TResult = unknown> = JsonRpcSuccess<TResult> | JsonRpcError;

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: TParams;
}

export type JsonRpcFrame = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// -------- frame builders -------------------------------------------------

export function makeRequest<P>(id: JsonRpcId, method: string, params?: P): JsonRpcRequest<P> {
  if (params === undefined) {
    return { jsonrpc: JSONRPC_VERSION, id, method };
  }
  return { jsonrpc: JSONRPC_VERSION, id, method, params };
}

export function makeSuccess<R>(id: JsonRpcId, result: R): JsonRpcSuccess<R> {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function makeError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  const error: JsonRpcError["error"] =
    data === undefined ? { code, message } : { code, message, data };
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

export function makeNotification<P>(method: string, params?: P): JsonRpcNotification<P> {
  if (params === undefined) {
    return { jsonrpc: JSONRPC_VERSION, method };
  }
  return { jsonrpc: JSONRPC_VERSION, method, params };
}

// -------- frame guards ---------------------------------------------------

function hasJsonRpcVersion(value: unknown): value is { jsonrpc: typeof JSONRPC_VERSION } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).jsonrpc === JSONRPC_VERSION
  );
}

export function isRequest(value: unknown): value is JsonRpcRequest {
  if (!hasJsonRpcVersion(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    "id" in v &&
    (typeof v.id === "string" || typeof v.id === "number") &&
    typeof v.method === "string"
  );
}

export function isNotification(value: unknown): value is JsonRpcNotification {
  if (!hasJsonRpcVersion(value)) return false;
  const v = value as Record<string, unknown>;
  return !("id" in v) && typeof v.method === "string";
}

export function isResponse(value: unknown): value is JsonRpcResponse {
  if (!hasJsonRpcVersion(value)) return false;
  const v = value as Record<string, unknown>;
  if (!("id" in v)) return false;
  return "result" in v || "error" in v;
}

// -------- NDJSON encoder/decoder ----------------------------------------

/** Encode a frame as a single NDJSON line ending in `\n`. */
export function encodeFrame(frame: JsonRpcFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/** Streaming line-buffered decoder. Feed bytes/strings; receive frames. */
export class NdjsonDecoder {
  #buffer = "";

  /** Append a chunk and return any complete frames it produced.
   *  Bytes are decoded as UTF-8. Malformed JSON lines throw with the
   *  raw line in the error message — callers should treat this as a
   *  protocol violation (kill the subprocess). */
  push(chunk: string | Uint8Array): JsonRpcFrame[] {
    this.#buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const frames: JsonRpcFrame[] = [];
    let newlineIdx = this.#buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.#buffer.slice(0, newlineIdx).trimEnd(); // tolerate \r\n
      this.#buffer = this.#buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          throw new Error(
            `NdjsonDecoder: malformed JSON line (${(err as Error).message}): ${JSON.stringify(line)}`,
          );
        }
        // We don't validate here — the caller (host or runtime) does
        // shape-checking with isRequest/isResponse/isNotification and
        // can reply with -32600 Invalid Request as appropriate.
        frames.push(parsed as JsonRpcFrame);
      }
      newlineIdx = this.#buffer.indexOf("\n");
    }
    return frames;
  }

  /** Drop any partial frame in the buffer (e.g. on subprocess exit). */
  reset(): void {
    this.#buffer = "";
  }
}
