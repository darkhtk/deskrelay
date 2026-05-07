import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  test("updates a known Claude settings allow list without dropping other fields", async () => {
    const { ctx, handlers } = makeCtx();
    await behaviorDef.start(ctx);

    const update = handlers.get("permissions.update");
    if (!update) throw new Error("permissions.update handler missing");

    const cwd = await mkdtemp(join(tmpdir(), "remote-claude-permissions-"));
    tempDirs.push(cwd);
    const settingsDir = join(cwd, ".claude");
    const settingsPath = join(settingsDir, "settings.local.json");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          model: "claude-opus",
          permissions: {
            allow: ["Bash(git status:*)"],
            deny: ["WebFetch(*)"],
            ask: ["Edit(*)"],
            defaultMode: "default",
          },
        },
        null,
        2,
      ),
    );

    const result = (await update({
      cwd,
      path: settingsPath,
      allow: ["Bash(*)", "Grep(*)", "Bash(*)"],
    })) as {
      source: { allow: string[]; deny: string[]; ask: string[]; defaultMode?: string };
    };

    expect(result.source.allow).toEqual(["Bash(*)", "Grep(*)"]);
    expect(result.source.deny).toEqual(["WebFetch(*)"]);
    expect(result.source.ask).toEqual(["Edit(*)"]);
    expect(result.source.defaultMode).toBe("default");

    const saved = JSON.parse(await readFile(settingsPath, "utf8")) as {
      model?: string;
      permissions?: { allow?: string[]; deny?: string[]; ask?: string[]; defaultMode?: string };
    };
    expect(saved.model).toBe("claude-opus");
    expect(saved.permissions?.allow).toEqual(["Bash(*)", "Grep(*)"]);
    expect(saved.permissions?.deny).toEqual(["WebFetch(*)"]);
    expect(saved.permissions?.ask).toEqual(["Edit(*)"]);
    expect(saved.permissions?.defaultMode).toBe("default");
  });

  test("context.usage returns a compact snapshot from Claude /context output", async () => {
    const { ctx, handlers } = makeCtx();
    await behaviorDef.start(ctx);

    const contextUsage = handlers.get("context.usage");
    if (!contextUsage) throw new Error("context.usage handler missing");

    const cwd = await mkdtemp(join(tmpdir(), "remote-claude-context-"));
    tempDirs.push(cwd);
    const fixture = fileURLToPath(new URL("./fixtures/fake-claude-context.ts", import.meta.url));

    const result = (await contextUsage({
      cwd,
      sessionId: "sess_context",
      command: ["bun", fixture],
    })) as {
      usage: { remainingPercent: number; usedPercent: number; source: string } | null;
      eventCount: number;
      checkedAt: string;
    };

    expect(result.eventCount).toBe(3);
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.usage?.remainingPercent).toBeCloseTo(94.1);
    expect(result.usage?.usedPercent).toBeCloseTo(5.9);
    expect(result.usage?.source).toBe("text");
  });
});
