import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeDirNameAsCwd, encodeCwdAsDirName } from "../src/session-paths.ts";
import {
  deleteSessionsForCwd,
  deleteSessionsForSessionId,
  listSessions,
  readSession,
} from "../src/sessions-store.ts";

let tmp: string;
let projectsDir: string;

async function writeJsonl(path: string, lines: object[]): Promise<void> {
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sess-"));
  projectsDir = join(tmp, "projects");
  await mkdir(projectsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("encodeCwdAsDirName / decodeDirNameAsCwd", () => {
  test("Windows path round-trip (Windows-style decode)", () => {
    const cwd = String.raw`C:\Users\me\Projects\foo`;
    const enc = encodeCwdAsDirName(cwd);
    expect(enc).toBe("C--Users-me-Projects-foo");
    // Decode is OS-aware (uses path.sep). Verify the leading "C:..." shape.
    const dec = decodeDirNameAsCwd(enc);
    expect(dec.startsWith("C:")).toBe(true);
  });

  test("POSIX path round-trip", () => {
    expect(encodeCwdAsDirName("/Users/me/proj")).toBe("-Users-me-proj");
    // POSIX decode replaces "-" with "/"
    expect(decodeDirNameAsCwd("-Users-me-proj")).toBe("/Users/me/proj");
  });

  test("decode of unknown shape returns input", () => {
    expect(decodeDirNameAsCwd("weird-name")).toBe("weird-name");
  });

  test("decode empty returns empty", () => {
    expect(decodeDirNameAsCwd("")).toBe("");
  });
});

describe("listSessions", () => {
  test("returns empty when projects dir doesn't exist", async () => {
    const result = await listSessions({ projectsDir: join(tmp, "nope") });
    expect(result).toEqual([]);
  });

  test("returns empty when no sessions yet", async () => {
    const result = await listSessions({ projectsDir });
    expect(result).toEqual([]);
  });

  test("discovers sessions across multiple project dirs", async () => {
    await mkdir(join(projectsDir, "C--Users-me-foo"));
    await mkdir(join(projectsDir, "C--Users-me-bar"));
    await writeJsonl(join(projectsDir, "C--Users-me-foo", "abc-1.jsonl"), [
      { type: "user", message: { role: "user", content: "hello foo" } },
    ]);
    await writeJsonl(join(projectsDir, "C--Users-me-bar", "xyz-2.jsonl"), [
      { type: "user", message: { role: "user", content: "hi bar" } },
    ]);
    const result = await listSessions({ projectsDir });
    expect(result).toHaveLength(2);
    const ids = result.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["abc-1", "xyz-2"]);
  });

  test("uses exact cwd recorded in jsonl instead of lossy hyphen decode", async () => {
    const exactCwd = String.raw`C:\Users\darkh\Projects\ops-cure`;
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-ops-cure"));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-ops-cure", "hyphen.jsonl"), [
      { type: "user", cwd: exactCwd, message: { role: "user", content: "hyphen cwd" } },
    ]);

    const [session] = await listSessions({ projectsDir });
    expect(session?.cwd).toBe(exactCwd);
    expect(session?.cwd).not.toContain(String.raw`ops\cure`);

    const transcript = await readSession({
      projectsDir,
      cwd: session?.cwd ?? "",
      sessionId: "hyphen",
    });
    expect(transcript.cwd).toBe(exactCwd);
    expect(transcript.events).toHaveLength(1);
  });

  test("skips sessions whose final read path no longer exists", async () => {
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-stale"));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-stale", "gone.jsonl"), [
      {
        type: "user",
        cwd: String.raw`C:\Users\darkh\Projects\missing`,
        message: { role: "user", content: "stale row" },
      },
    ]);

    const result = await listSessions({ projectsDir });
    expect(result.map((s) => s.sessionId)).not.toContain("gone");
  });

  test("skips stale rows that point at a different final read path", async () => {
    const goodCwd = String.raw`C:\Users\darkh\Projects\good`;
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-good"));
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-stale"));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-good", "same-id.jsonl"), [
      { type: "user", cwd: goodCwd, message: { role: "user", content: "real row" } },
    ]);
    await new Promise((r) => setTimeout(r, 20));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-stale", "same-id.jsonl"), [
      {
        type: "user",
        cwd: goodCwd,
        message: { role: "user", content: "stale alias row" },
      },
    ]);

    const result = await listSessions({ projectsDir });
    expect(result.map((s) => s.title)).toEqual(["real row"]);
  });

  test("can deduplicate readable rows with the same sessionId", async () => {
    const firstCwd = String.raw`C:\Users\darkh\Projects\one`;
    const secondCwd = String.raw`C:\Users\darkh\Projects\two`;
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-one"));
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-two"));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-one", "same-id.jsonl"), [
      { type: "user", cwd: firstCwd, message: { role: "user", content: "older copy" } },
    ]);
    await new Promise((r) => setTimeout(r, 20));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-two", "same-id.jsonl"), [
      { type: "user", cwd: secondCwd, message: { role: "user", content: "newer copy" } },
    ]);

    const raw = await listSessions({ projectsDir });
    expect(raw.map((s) => s.title)).toEqual(["newer copy", "older copy"]);

    const deduped = await listSessions({ projectsDir, dedupeSessionIds: true });
    expect(deduped.map((s) => s.sessionId)).toEqual(["same-id"]);
    expect(deduped[0]?.title).toBe("newer copy");
    expect(deduped[0]?.cwd).toBe(secondCwd);
  });

  test("limit counts readable sessions after stale rows are skipped", async () => {
    const goodCwd = String.raw`C:\Users\darkh\Projects\good`;
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-good"));
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-stale"));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-good", "good.jsonl"), [
      { type: "user", cwd: goodCwd, message: { role: "user", content: "good row" } },
    ]);
    await new Promise((r) => setTimeout(r, 20));
    await writeJsonl(join(projectsDir, "C--Users-darkh-Projects-stale", "gone.jsonl"), [
      {
        type: "user",
        cwd: String.raw`C:\Users\darkh\Projects\missing`,
        message: { role: "user", content: "newer stale row" },
      },
    ]);

    const result = await listSessions({ projectsDir, limit: 1 });
    expect(result.map((s) => s.sessionId)).toEqual(["good"]);
  });

  test("skips Claude subagent transcripts from the user session list", async () => {
    const exactCwd = String.raw`C:\Users\darkh\Projects\ops-cure`;
    const parentSessionId = "012b19c7-9d57-4eef-b055-062423fadd1a";
    await mkdir(join(projectsDir, "C--Users-darkh-Projects-ops-cure"));
    await mkdir(join(projectsDir, "subagents"));
    await writeJsonl(
      join(projectsDir, "C--Users-darkh-Projects-ops-cure", `${parentSessionId}.jsonl`),
      [
        {
          type: "user",
          cwd: exactCwd,
          sessionId: parentSessionId,
          message: { role: "user", content: "main conversation" },
        },
      ],
    );
    await writeJsonl(join(projectsDir, "subagents", "agent-a672b29908f32caf1.jsonl"), [
      {
        type: "user",
        cwd: exactCwd,
        sessionId: parentSessionId,
        message: { role: "user", content: "subagent branch" },
      },
    ]);

    const result = await listSessions({ projectsDir });
    expect(result.map((s) => s.sessionId)).toEqual([parentSessionId]);
    expect(result[0]?.title).toBe("main conversation");
  });

  test("title comes from first user message (truncated)", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    await writeJsonl(join(projectsDir, "C--proj", "s1.jsonl"), [
      { type: "system", subtype: "init" },
      { type: "user", message: { role: "user", content: "this is the first user message" } },
    ]);
    const [s] = await listSessions({ projectsDir });
    expect(s?.title).toBe("this is the first user message");
  });

  test("title handles content as array of blocks", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    await writeJsonl(join(projectsDir, "C--proj", "s1.jsonl"), [
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "structured content" }],
        },
      },
    ]);
    const [s] = await listSessions({ projectsDir });
    expect(s?.title).toBe("structured content");
  });

  test("title truncates with ellipsis past 80 chars", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    const long = "x".repeat(120);
    await writeJsonl(join(projectsDir, "C--proj", "s1.jsonl"), [
      { type: "user", message: { role: "user", content: long } },
    ]);
    const [s] = await listSessions({ projectsDir });
    expect(s?.title.length).toBeLessThanOrEqual(80);
    expect(s?.title.endsWith("...")).toBe(true);
    expect(s?.fullTitle).toBe(long);
  });

  test("sorts newest first", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    const a = join(projectsDir, "C--proj", "older.jsonl");
    const b = join(projectsDir, "C--proj", "newer.jsonl");
    await writeJsonl(a, [{ type: "user", message: { content: "a" } }]);
    await new Promise((r) => setTimeout(r, 20));
    await writeJsonl(b, [{ type: "user", message: { content: "b" } }]);
    const result = await listSessions({ projectsDir });
    expect(result[0]?.sessionId).toBe("newer");
    expect(result[1]?.sessionId).toBe("older");
  });

  test("limit caps the result", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    for (let i = 0; i < 5; i++) {
      await writeJsonl(join(projectsDir, "C--proj", `s${i}.jsonl`), [
        { type: "user", message: { content: String(i) } },
      ]);
    }
    const result = await listSessions({ projectsDir, limit: 2 });
    expect(result).toHaveLength(2);
  });

  test("cwd filter only includes matching project", async () => {
    await mkdir(join(projectsDir, "C--proj-a"));
    await mkdir(join(projectsDir, "C--proj-b"));
    await writeJsonl(join(projectsDir, "C--proj-a", "s.jsonl"), [
      { type: "user", message: { content: "a" } },
    ]);
    await writeJsonl(join(projectsDir, "C--proj-b", "s.jsonl"), [
      { type: "user", message: { content: "b" } },
    ]);
    const decodedA = decodeDirNameAsCwd("C--proj-a");
    const result = await listSessions({ projectsDir, cwd: decodedA });
    expect(result).toHaveLength(1);
    expect(result[0]?.cwd).toBe(decodedA);
  });

  test("skips non-jsonl files in project dirs", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    await writeFile(join(projectsDir, "C--proj", "notes.md"), "ignored", "utf8");
    await writeJsonl(join(projectsDir, "C--proj", "real.jsonl"), [
      { type: "user", message: { content: "real" } },
    ]);
    const result = await listSessions({ projectsDir });
    expect(result.map((s) => s.sessionId)).toEqual(["real"]);
  });
});

describe("deleteSessionsForCwd", () => {
  test("deletes every listable session for a cwd and leaves other folders alone", async () => {
    const targetCwd = String.raw`C:\Users\me\Projects\target`;
    const otherCwd = String.raw`C:\Users\me\Projects\other`;
    await mkdir(join(projectsDir, "C--Users-me-Projects-target"));
    await mkdir(join(projectsDir, "C--Users-me-Projects-other"));
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-target", "a.jsonl"), [
      { type: "user", cwd: targetCwd, message: { role: "user", content: "target a" } },
    ]);
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-target", "b.jsonl"), [
      { type: "user", cwd: targetCwd, message: { role: "user", content: "target b" } },
    ]);
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-other", "c.jsonl"), [
      { type: "user", cwd: otherCwd, message: { role: "user", content: "other c" } },
    ]);

    const result = await deleteSessionsForCwd({ projectsDir, cwd: targetCwd });
    expect(result.total).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.missing).toBe(0);

    const remaining = await listSessions({ projectsDir });
    expect(remaining.map((s) => s.sessionId)).toEqual(["c"]);
  });
});

describe("deleteSessionsForSessionId", () => {
  test("deletes every physical copy of the same sessionId across project dirs", async () => {
    const firstCwd = String.raw`C:\Users\me\Projects\one`;
    const secondCwd = String.raw`C:\Users\me\Projects\two`;
    await mkdir(join(projectsDir, "C--Users-me-Projects-one"));
    await mkdir(join(projectsDir, "C--Users-me-Projects-two"));
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-one", "same-id.jsonl"), [
      { type: "user", cwd: firstCwd, message: { role: "user", content: "first copy" } },
    ]);
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-two", "same-id.jsonl"), [
      { type: "user", cwd: secondCwd, message: { role: "user", content: "second copy" } },
    ]);
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-two", "other.jsonl"), [
      { type: "user", cwd: secondCwd, message: { role: "user", content: "keep me" } },
    ]);

    const result = await deleteSessionsForSessionId({ projectsDir, sessionId: "same-id" });
    expect(result.total).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.missing).toBe(0);
    expect(result.paths).toHaveLength(2);

    const remaining = await listSessions({ projectsDir });
    expect(remaining.map((s) => s.sessionId)).toEqual(["other"]);
  });

  test("also removes stale aliases hidden from the user-facing list", async () => {
    const canonicalCwd = String.raw`C:\Users\me\Projects\canonical`;
    await mkdir(join(projectsDir, "C--Users-me-Projects-canonical"));
    await mkdir(join(projectsDir, "C--Users-me-Projects-stale"));
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-canonical", "same-id.jsonl"), [
      { type: "user", cwd: canonicalCwd, message: { role: "user", content: "real row" } },
    ]);
    await writeJsonl(join(projectsDir, "C--Users-me-Projects-stale", "same-id.jsonl"), [
      {
        type: "user",
        cwd: canonicalCwd,
        message: { role: "user", content: "stale alias" },
      },
    ]);

    const visibleBefore = await listSessions({ projectsDir });
    expect(visibleBefore.map((s) => s.title)).toEqual(["real row"]);

    const result = await deleteSessionsForSessionId({ projectsDir, sessionId: "same-id" });
    expect(result.total).toBe(2);
    expect(result.deleted).toBe(2);
    expect(await listSessions({ projectsDir })).toEqual([]);
  });

  test("returns an empty result when the projects dir is missing", async () => {
    const result = await deleteSessionsForSessionId({
      projectsDir: join(tmp, "missing-projects"),
      sessionId: "anything",
    });
    expect(result).toEqual({
      sessionId: "anything",
      total: 0,
      deleted: 0,
      missing: 0,
      paths: [],
    });
  });
});

describe("readSession", () => {
  test("returns parsed events for a known session", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    const events = [
      { type: "system", subtype: "init" },
      { type: "user", message: { content: "hi" } },
      { type: "assistant", message: { content: "hello back" } },
      { type: "result", success: true },
    ];
    await writeJsonl(join(projectsDir, "C--proj", "s1.jsonl"), events);
    const cwd = decodeDirNameAsCwd("C--proj");
    const transcript = await readSession({
      projectsDir,
      cwd,
      sessionId: "s1",
    });
    expect(transcript.sessionId).toBe("s1");
    expect(transcript.cwd).toBe(cwd);
    expect(transcript.events).toEqual(events);
  });

  test("skips malformed lines without throwing", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    await writeFile(
      join(projectsDir, "C--proj", "s1.jsonl"),
      `${JSON.stringify({ type: "user", x: 1 })}\nnot json\n${JSON.stringify({ type: "result" })}\n`,
      "utf8",
    );
    const transcript = await readSession({
      projectsDir,
      cwd: decodeDirNameAsCwd("C--proj"),
      sessionId: "s1",
    });
    expect(transcript.events).toHaveLength(2);
  });

  test("tails large session files instead of returning the whole transcript", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    const lines = [
      { type: "user", message: { content: "older" } },
      { type: "assistant", message: { content: "middle" } },
      { type: "assistant", message: { content: "newest" } },
    ];
    const raw = lines.map((l) => JSON.stringify(l)).join("\n");
    await writeFile(join(projectsDir, "C--proj", "big.jsonl"), raw, "utf8");

    const newestLineBytes = Buffer.byteLength(JSON.stringify(lines[2]), "utf8");
    const transcript = await readSession({
      projectsDir,
      cwd: decodeDirNameAsCwd("C--proj"),
      sessionId: "big",
      maxBytes: newestLineBytes + 1,
    });

    expect(transcript.truncated).toBe(true);
    expect(transcript.events).toEqual([lines[2]]);
    expect(transcript.totalBytes).toBe(Buffer.byteLength(raw, "utf8"));
  });

  test("eventLimit returns the newest parsed events", async () => {
    await mkdir(join(projectsDir, "C--proj"));
    const events = Array.from({ length: 105 }, (_, i) => ({
      type: "assistant",
      index: i,
    }));
    await writeJsonl(join(projectsDir, "C--proj", "many.jsonl"), events);

    const transcript = await readSession({
      projectsDir,
      cwd: decodeDirNameAsCwd("C--proj"),
      sessionId: "many",
      eventLimit: 100,
    });

    expect(transcript.events).toHaveLength(100);
    expect(transcript.events[0]).toEqual({ type: "assistant", index: 5 });
    expect(transcript.events.at(-1)).toEqual({ type: "assistant", index: 104 });
    expect(transcript.totalEvents).toBe(105);
    expect(transcript.returnedEvents).toBe(100);
    expect(transcript.eventLimit).toBe(100);
    expect(transcript.eventsTruncated).toBe(true);
  });

  test("missing file rejects with ENOENT-class error", async () => {
    const cwd = decodeDirNameAsCwd("C--proj");
    let caught: unknown;
    try {
      await readSession({ projectsDir, cwd, sessionId: "missing" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });
});

describe("listSessions — search + modifiedSince filters", () => {
  beforeEach(async () => {
    await mkdir(join(projectsDir, "C--proj-alpha"));
    await mkdir(join(projectsDir, "C--proj-beta"));
    await writeJsonl(join(projectsDir, "C--proj-alpha", "s1.jsonl"), [
      { type: "user", message: { role: "user", content: "explore the database schema" } },
    ]);
    await writeJsonl(join(projectsDir, "C--proj-alpha", "s2.jsonl"), [
      { type: "user", message: { role: "user", content: "add auth middleware" } },
    ]);
    await writeJsonl(join(projectsDir, "C--proj-beta", "s3.jsonl"), [
      { type: "user", message: { role: "user", content: "rewrite the database connection pool" } },
    ]);
  });

  test("searchQuery matches against title (case-insensitive)", async () => {
    const r = await listSessions({ projectsDir, searchQuery: "auth" });
    expect(r.map((s) => s.sessionId)).toEqual(["s2"]);
  });

  test("searchQuery matches against cwd", async () => {
    const r = await listSessions({ projectsDir, searchQuery: "alpha" });
    const ids = r.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });

  test("searchQuery substring matches multiple titles", async () => {
    const r = await listSessions({ projectsDir, searchQuery: "DATABASE" });
    const ids = r.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["s1", "s3"]);
  });

  test("limit respected after search", async () => {
    const r = await listSessions({ projectsDir, searchQuery: "database", limit: 1 });
    expect(r).toHaveLength(1);
  });

  test("modifiedSince filters out older entries", async () => {
    // Use a far-future ISO; nothing should match.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const r = await listSessions({ projectsDir, modifiedSince: future });
    expect(r).toEqual([]);
  });

  test("modifiedSince=epoch keeps everything", async () => {
    const r = await listSessions({ projectsDir, modifiedSince: "1970-01-01T00:00:00.000Z" });
    expect(r.length).toBe(3);
  });

  test("empty searchQuery is a no-op (returns all)", async () => {
    const r = await listSessions({ projectsDir, searchQuery: "  " });
    expect(r.length).toBe(3);
  });
});
