import { describe, expect, test } from "bun:test";
import {
  JsonRpcErrorCode,
  NdjsonDecoder,
  encodeFrame,
  isNotification,
  isRequest,
  isResponse,
  makeError,
  makeNotification,
  makeRequest,
  makeSuccess,
} from "../src/ipc.ts";

describe("frame builders", () => {
  test("makeRequest with params", () => {
    const r = makeRequest(1, "echo", { msg: "hi" });
    expect(r).toEqual({ jsonrpc: "2.0", id: 1, method: "echo", params: { msg: "hi" } });
  });

  test("makeRequest without params omits the field", () => {
    const r = makeRequest("uuid", "ping");
    expect(r).toEqual({ jsonrpc: "2.0", id: "uuid", method: "ping" });
    expect("params" in r).toBe(false);
  });

  test("makeSuccess wraps result", () => {
    expect(makeSuccess(2, { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  test("makeError with and without data", () => {
    expect(makeError(3, JsonRpcErrorCode.MethodNotFound, "no such method")).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601, message: "no such method" },
    });
    expect(makeError(null, -32700, "parse error", { line: 1 })).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "parse error", data: { line: 1 } },
    });
  });

  test("makeNotification with and without params", () => {
    expect(makeNotification("event", { kind: "x" })).toEqual({
      jsonrpc: "2.0",
      method: "event",
      params: { kind: "x" },
    });
    const n = makeNotification("ping");
    expect(n).toEqual({ jsonrpc: "2.0", method: "ping" });
    expect("params" in n).toBe(false);
  });
});

describe("frame guards", () => {
  test("isRequest", () => {
    expect(isRequest({ jsonrpc: "2.0", id: 1, method: "x" })).toBe(true);
    expect(isRequest({ jsonrpc: "2.0", id: "u", method: "x" })).toBe(true);
    expect(isRequest({ jsonrpc: "2.0", method: "x" })).toBe(false); // missing id
    expect(isRequest({ jsonrpc: "1.0", id: 1, method: "x" })).toBe(false); // wrong version
    expect(isRequest({ jsonrpc: "2.0", id: 1 })).toBe(false); // missing method
    expect(isRequest(null)).toBe(false);
  });

  test("isNotification", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "event" })).toBe(true);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "event" })).toBe(false); // has id
    expect(isNotification({ jsonrpc: "2.0" })).toBe(false); // no method
  });

  test("isResponse", () => {
    expect(isResponse({ jsonrpc: "2.0", id: 1, result: 1 })).toBe(true);
    expect(isResponse({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "x" } })).toBe(true);
    expect(isResponse({ jsonrpc: "2.0", id: 1 })).toBe(false); // neither result nor error
    expect(isResponse({ jsonrpc: "2.0", result: 1 })).toBe(false); // no id
  });
});

describe("encodeFrame + NdjsonDecoder round-trip", () => {
  test("encodeFrame appends a single newline", () => {
    const line = encodeFrame(makeRequest(1, "x"));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
  });

  test("decoder reassembles split chunks", () => {
    const dec = new NdjsonDecoder();
    const a = encodeFrame(makeRequest(1, "x"));
    const b = encodeFrame(makeRequest(2, "y", { v: 9 }));
    const combined = a + b;
    // split mid-frame to exercise buffering
    const split1 = combined.slice(0, 10);
    const split2 = combined.slice(10);
    const f1 = dec.push(split1);
    expect(f1).toEqual([]); // first chunk has no full line yet
    const f2 = dec.push(split2);
    expect(f2).toHaveLength(2);
    expect(f2[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "x" });
    expect(f2[1]).toEqual({ jsonrpc: "2.0", id: 2, method: "y", params: { v: 9 } });
  });

  test("decoder accepts Uint8Array chunks", () => {
    const dec = new NdjsonDecoder();
    const bytes = new TextEncoder().encode(encodeFrame(makeRequest(1, "x")));
    const frames = dec.push(bytes);
    expect(frames).toHaveLength(1);
  });

  test("decoder tolerates \\r\\n line endings", () => {
    const dec = new NdjsonDecoder();
    const line = `${JSON.stringify(makeRequest(1, "x"))}\r\n`;
    const frames = dec.push(line);
    expect(frames).toHaveLength(1);
    expect((frames[0] as { method: string }).method).toBe("x");
  });

  test("decoder ignores blank lines between frames", () => {
    const dec = new NdjsonDecoder();
    const a = encodeFrame(makeRequest(1, "x"));
    const b = encodeFrame(makeRequest(2, "y"));
    const frames = dec.push(`${a}\n\n${b}`);
    expect(frames).toHaveLength(2);
  });

  test("decoder throws on malformed JSON", () => {
    const dec = new NdjsonDecoder();
    expect(() => dec.push("not json\n")).toThrow(/malformed JSON/);
  });

  test("reset clears partial buffer", () => {
    const dec = new NdjsonDecoder();
    dec.push("{partial");
    dec.reset();
    const a = encodeFrame(makeRequest(1, "ok"));
    expect(dec.push(a)).toHaveLength(1);
  });
});
