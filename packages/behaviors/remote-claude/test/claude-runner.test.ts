import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ClaudeRunError, probeClaudeSlashCommands, runClaude } from "../src/claude-runner.ts";
import type { ClaudeStreamEvent } from "../src/stream-json.ts";

const FIX_OK = join(import.meta.dir, "fixtures", "fake-claude-ok.ts");
const FIX_FAIL = join(import.meta.dir, "fixtures", "fake-claude-fail.ts");
const FIX_HANG = join(import.meta.dir, "fixtures", "fake-claude-hang.ts");
const FIX_STDIN = join(import.meta.dir, "fixtures", "fake-claude-stdin.ts");
const FIX_SLASH = join(import.meta.dir, "fixtures", "fake-claude-slash.ts");

function bunCmd(file: string): readonly string[] {
  return [process.execPath, "run", file];
}

describe("runClaude — happy path with fake claude", () => {
  test("emits the canned events in order, returns count + exit 0", async () => {
    const events: ClaudeStreamEvent[] = [];
    const result = await runClaude({
      cwd: process.cwd(),
      message: "hello",
      command: bunCmd(FIX_OK),
      onEvent: (e) => events.push(e),
    });
    expect(result.exitCode).toBe(0);
    expect(result.eventCount).toBe(3);
    expect(events.map((e) => e.type)).toEqual(["system", "assistant", "result"]);
    const assistant = events[1] as unknown as {
      message: { content: { text: string }[] };
    };
    expect(assistant.message.content[0]?.text).toBe("echo: hello");
  });

  test("passes the message as the last positional arg", async () => {
    const events: ClaudeStreamEvent[] = [];
    await runClaude({
      cwd: process.cwd(),
      message: "this exact message",
      command: bunCmd(FIX_OK),
      onEvent: (e) => events.push(e),
    });
    const assistant = events.find((e) => e.type === "assistant") as unknown as
      | { message: { content: { text: string }[] } }
      | undefined;
    expect(assistant?.message.content[0]?.text).toContain("this exact message");
  });

  test("passes image attachments through stream-json stdin", async () => {
    const events: ClaudeStreamEvent[] = [];
    await runClaude({
      cwd: process.cwd(),
      message: "look at this",
      attachments: [
        {
          name: "dog.png",
          mimeType: "image/png",
          size: 4,
          dataBase64: "iVBORw0KGgo=",
        },
      ],
      command: bunCmd(FIX_STDIN),
      onEvent: (e) => events.push(e),
    });
    const assistant = events.find((e) => e.type === "assistant") as unknown as
      | { message: { content: { text: string }[] } }
      | undefined;
    expect(assistant?.message.content[0]?.text).toBe("text:look at this|image:image/png");
  });

  test("materializes image attachments as temporary local files for tool access", async () => {
    const events: ClaudeStreamEvent[] = [];
    await runClaude({
      cwd: process.cwd(),
      message: "save this image",
      attachments: [
        {
          name: "dog.png",
          mimeType: "image/png",
          size: 8,
          dataBase64: "iVBORw0KGgo=",
        },
      ],
      command: bunCmd(FIX_STDIN),
      env: { CR_FAKE_CLAUDE_ECHO_ARGS: "1" },
      onEvent: (e) => events.push(e),
    });
    const assistant = events.find((e) => e.type === "assistant") as unknown as
      | { message: { content: { text: string }[] } }
      | undefined;
    const text = assistant?.message.content[0]?.text ?? "";
    expect(text).toContain("text:save this image|image:image/png");
    expect(text).toContain("addDir:yes");
    expect(text).toContain("fileCount:1");
    expect(text).toContain("firstFileBytes:8");
    expect(text).toContain("promptHasDog:yes");
  });
});

describe("runClaude — error path", () => {
  test("non-zero exit throws ClaudeRunError with stderr captured", async () => {
    let caught: unknown;
    try {
      await runClaude({
        cwd: process.cwd(),
        message: "x",
        command: bunCmd(FIX_FAIL),
        onEvent: () => {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ClaudeRunError);
    const e = caught as ClaudeRunError;
    expect(e.exitCode).toBe(1);
    expect(e.stderr).toMatch(/api key missing/);
  });

  test("nonexistent command surfaces as a thrown error (not silent)", async () => {
    let caught: unknown;
    try {
      await runClaude({
        cwd: process.cwd(),
        message: "x",
        command: ["this-command-does-not-exist-on-any-system-7894"],
        onEvent: () => {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });
});

describe("runClaude — abort", () => {
  test("AbortSignal kills the subprocess and resolves with exitCode null", async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 30);
    const result = await runClaude({
      cwd: process.cwd(),
      message: "x",
      command: bunCmd(FIX_HANG),
      onEvent: () => {},
      signal: ctl.signal,
    });
    expect(result.exitCode).toBeNull();
  });
});

describe("runClaude — stderr capture", () => {
  test("onStderrLine fires for each non-empty line", async () => {
    const lines: string[] = [];
    let caught: unknown;
    try {
      await runClaude({
        cwd: process.cwd(),
        message: "x",
        command: bunCmd(FIX_FAIL),
        onEvent: () => {},
        onStderrLine: (l) => lines.push(l),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ClaudeRunError);
    expect(lines).toContain("fake claude error: api key missing");
  });
});

describe("probeClaudeSlashCommands", () => {
  test("captures slash_commands, skills, version, and model from system init", async () => {
    const result = await probeClaudeSlashCommands({
      cwd: process.cwd(),
      command: bunCmd(FIX_SLASH),
    });
    expect(result.slashCommands).toEqual(["clear", "model", "status", "deep-fix", "usage"]);
    expect(result.skills).toEqual(["deep-fix", "protocol-rubric"]);
    expect(result.claudeVersion).toBe("9.9.9-test");
    expect(result.model).toBe("claude-test-model");
  });
});
