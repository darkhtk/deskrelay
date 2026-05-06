import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BehaviorContext, RequestHandler } from "@claude-remote/behavior-sdk/runtime";
import { behaviorDef } from "../src/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeCtx() {
  const handlers = new Map<string, RequestHandler>();
  const events: Array<{ kind: string; content: unknown; spaceId?: string }> = [];
  const ctx: BehaviorContext = {
    manifest: behaviorDef.manifest,
    settings: { instanceId: "remote-claude" },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    onRequest: (method, handler) => {
      handlers.set(method, handler as RequestHandler);
    },
    publish: (input) => {
      events.push({
        kind: input.kind,
        content: input.content,
        ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      });
    },
    emit: (kind, content) => {
      events.push({ kind, content });
    },
    makeSpace: (kind, id) => `remote-claude.${kind}:${id}` as never,
  };
  return { ctx, handlers, events };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for predicate");
}

describe("remote-claude behavior chat request", () => {
  test("accepts the run immediately and finishes through SSE events", async () => {
    const { ctx, handlers, events } = makeCtx();
    await behaviorDef.start(ctx);

    const chat = handlers.get("chat");
    const interrupt = handlers.get("interrupt");
    if (!chat || !interrupt) throw new Error("chat/interrupt handlers missing");

    const cwd = await mkdtemp(join(tmpdir(), "remote-claude-chat-"));
    tempDirs.push(cwd);
    const fixture = fileURLToPath(new URL("./fixtures/fake-claude-hang.ts", import.meta.url));
    const runId = "r_async_accept";

    const accepted = await Promise.race([
      chat({ cwd, message: "hello", runId, command: ["bun", fixture] }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("chat did not return promptly")), 250),
      ),
    ]);

    expect(accepted).toEqual({ ok: true, runId, accepted: true, eventCount: 0 });
    expect(events.some((event) => event.kind === "run.started")).toBe(true);

    await interrupt({ runId });
    await waitFor(() => events.some((event) => event.kind === "run.finished"));
  });
});
