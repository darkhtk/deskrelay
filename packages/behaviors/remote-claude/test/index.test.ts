import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BehaviorContext, RequestHandler } from "@deskrelay/behavior-sdk/runtime";
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

  test("inspects and deletes project skills from the active cwd", async () => {
    const { ctx, handlers } = makeCtx();
    await behaviorDef.start(ctx);

    const inspect = handlers.get("skills.inspect");
    const remove = handlers.get("skills.delete");
    if (!inspect || !remove) throw new Error("skills handlers missing");

    const cwd = await mkdtemp(join(tmpdir(), "remote-claude-skills-"));
    tempDirs.push(cwd);
    const skillDir = join(cwd, ".claude", "skills", "local-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: local-skill",
        "description: Local project helper",
        "---",
        "",
        "# Local project helper",
      ].join("\n"),
    );

    const inspected = (await inspect({ cwd, skills: ["local-skill", "runtime-only"] })) as {
      skills: Array<{ name: string; description?: string; removable: boolean; path?: string }>;
    };
    const localSkill = inspected.skills.find((skill) => skill.name === "local-skill");
    expect(localSkill?.description).toBe("Local project helper");
    expect(localSkill?.removable).toBe(true);
    expect(localSkill?.path).toBe(skillDir);
    expect(inspected.skills.find((skill) => skill.name === "runtime-only")?.removable).toBe(false);

    const deleted = (await remove({ cwd, name: "local-skill", path: skillDir })) as {
      deleted: boolean;
      skill: { name: string };
    };
    expect(deleted.deleted).toBe(true);
    expect(deleted.skill.name).toBe("local-skill");

    const after = (await inspect({ cwd, skills: ["runtime-only"] })) as {
      skills: Array<{ name: string }>;
    };
    expect(after.skills.some((skill) => skill.name === "local-skill")).toBe(false);
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

  test("context.usage returns global rate limit reset metadata for session and week scopes", async () => {
    const { ctx, handlers } = makeCtx();
    await behaviorDef.start(ctx);

    const contextUsage = handlers.get("context.usage");
    if (!contextUsage) throw new Error("context.usage handler missing");

    const cwd = await mkdtemp(join(tmpdir(), "remote-claude-rate-limit-"));
    tempDirs.push(cwd);
    const fixture = fileURLToPath(new URL("./fixtures/fake-claude-rate-limit.ts", import.meta.url));

    const session = (await contextUsage({
      cwd,
      scope: "session",
      command: ["bun", fixture],
    })) as {
      usage: {
        remainingPercent: number | null;
        usedPercent: number | null;
        resetAt?: string;
        rateLimitType?: string;
        status?: string;
      } | null;
    };
    const week = (await contextUsage({
      cwd,
      scope: "week",
      command: ["bun", fixture],
    })) as typeof session;

    expect(session.usage).toMatchObject({
      remainingPercent: null,
      usedPercent: null,
      resetAt: "2026-05-07T06:20:00.000Z",
      rateLimitType: "five_hour",
      status: "allowed",
    });
    expect(week.usage).toMatchObject({
      remainingPercent: null,
      usedPercent: null,
      resetAt: "2026-05-14T06:20:00.000Z",
      rateLimitType: "weekly",
      status: "allowed",
    });
  });

  test("usage.limits reads Claude subscription usage through local OAuth", async () => {
    const { ctx, handlers } = makeCtx();
    await behaviorDef.start(ctx);

    const usageLimits = handlers.get("usage.limits");
    if (!usageLimits) throw new Error("usage.limits handler missing");

    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-oauth-token";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.anthropic.com/api/oauth/usage");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer test-oauth-token");
      return new Response(
        JSON.stringify({
          five_hour: {
            utilization: 2,
            resets_at: "2026-05-07T06:20:00.810233+00:00",
          },
          seven_day: {
            utilization: 29,
            resets_at: "2026-05-10T10:59:59.810260+00:00",
          },
          seven_day_sonnet: {
            utilization: 1,
            resets_at: "2026-05-10T11:00:00.810270+00:00",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const result = (await usageLimits({})) as {
        session: { remainingPercent: number; usedPercent: number; resetAt?: string } | null;
        week: { remainingPercent: number; usedPercent: number; resetAt?: string } | null;
        sonnetWeek: { remainingPercent: number; usedPercent: number; resetAt?: string } | null;
        checkedAt: string;
      };

      expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.session).toMatchObject({
        remainingPercent: 98,
        usedPercent: 2,
        resetAt: "2026-05-07T06:20:00.810Z",
      });
      expect(result.week).toMatchObject({
        remainingPercent: 71,
        usedPercent: 29,
        resetAt: "2026-05-10T10:59:59.810Z",
      });
      expect(result.sonnetWeek).toMatchObject({
        remainingPercent: 99,
        usedPercent: 1,
        resetAt: "2026-05-10T11:00:00.810Z",
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = undefined;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = originalToken;
      }
    }
  });

  test("account.info summarizes the local Claude OAuth login without exposing tokens", async () => {
    const { ctx, handlers } = makeCtx();
    await behaviorDef.start(ctx);

    const accountInfo = handlers.get("account.info");
    if (!accountInfo) throw new Error("account.info handler missing");

    const configDir = await mkdtemp(join(tmpdir(), "remote-claude-account-"));
    tempDirs.push(configDir);
    await writeFile(
      join(configDir, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "secret-access-token",
          refreshToken: "secret-refresh-token",
          email: "dev@example.test",
          subscriptionType: "max",
          rateLimitTier: "tier_2",
        },
      }),
      "utf8",
    );

    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const originalToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    try {
      const result = (await accountInfo({})) as {
        status: string;
        source: string;
        email?: string;
        subscriptionType?: string;
        accessToken?: string;
        refreshToken?: string;
      };

      expect(result.status).toBe("logged_in");
      expect(result.source).toBe("oauth");
      expect(result.email).toBe("dev@example.test");
      expect(result.subscriptionType).toBe("max");
      expect("rateLimitTier" in result).toBe(false);
      expect(result.accessToken).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
      }
      if (originalToken === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = originalToken;
      }
    }
  });
});
