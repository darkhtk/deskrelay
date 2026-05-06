import { describe, expect, test } from "bun:test";
import { StreamJsonParser } from "../src/stream-json.ts";

describe("StreamJsonParser", () => {
  test("parses one event per line", () => {
    const p = new StreamJsonParser();
    const chunk =
      `${JSON.stringify({ type: "system", subtype: "init" })}\n` +
      `${JSON.stringify({ type: "assistant", text: "hi" })}\n`;
    const events = p.push(chunk);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("system");
    expect(events[1]?.type).toBe("assistant");
  });

  test("buffers across split chunks", () => {
    const p = new StreamJsonParser();
    const full = `${JSON.stringify({ type: "result", success: true })}\n`;
    const a = p.push(full.slice(0, 12));
    expect(a).toEqual([]);
    const b = p.push(full.slice(12));
    expect(b).toHaveLength(1);
    expect(b[0]?.type).toBe("result");
  });

  test("tolerates \\r\\n line endings", () => {
    const p = new StreamJsonParser();
    const events = p.push(`${JSON.stringify({ type: "assistant" })}\r\n`);
    expect(events).toHaveLength(1);
  });

  test("ignores blank lines between events", () => {
    const p = new StreamJsonParser();
    const events = p.push(`${JSON.stringify({ type: "a" })}\n\n${JSON.stringify({ type: "b" })}\n`);
    expect(events).toHaveLength(2);
  });

  test("malformed lines invoke onMalformed and skip", () => {
    const p = new StreamJsonParser();
    const malformed: Array<{ line: string; msg: string }> = [];
    const events = p.push(`not json\n${JSON.stringify({ type: "ok" })}\n`, (line, err) =>
      malformed.push({ line, msg: err.message }),
    );
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.line).toBe("not json");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("ok");
  });

  test("rejects JSON values that aren't objects with a string `type`", () => {
    const p = new StreamJsonParser();
    const malformed: string[] = [];
    const events = p.push(
      `[1,2,3]\n42\n"string"\n${JSON.stringify({ noType: true })}\n${JSON.stringify({ type: "ok" })}\n`,
      (line) => malformed.push(line),
    );
    expect(malformed).toHaveLength(4);
    expect(events).toHaveLength(1);
  });

  test("preserves arbitrary fields on the event", () => {
    const p = new StreamJsonParser();
    const events = p.push(
      `${JSON.stringify({ type: "assistant", message: { content: "hi" }, usage: { tokens: 5 } })}\n`,
    );
    expect(events[0]).toEqual({
      type: "assistant",
      message: { content: "hi" },
      usage: { tokens: 5 },
    });
  });

  test("flush handles partial trailing line as malformed", () => {
    const p = new StreamJsonParser();
    p.push("{partial");
    const malformed: string[] = [];
    p.flush((line) => malformed.push(line));
    expect(malformed).toHaveLength(1);
  });
});
