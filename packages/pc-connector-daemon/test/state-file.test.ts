import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearStateFile,
  defaultStateDir,
  readStateFile,
  stateFileToBaseUrl,
  writeStateFile,
} from "../src/state-file.ts";

let tmp: string;
let path: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "state-file-"));
  path = join(tmp, "daemon.json");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("state-file round-trip", () => {
  test("default state dir is DeskRelay-specific", () => {
    const previous = process.env.CR_CONNECTOR_STATE_DIR;
    Reflect.deleteProperty(process.env, "CR_CONNECTOR_STATE_DIR");
    try {
      const dir = defaultStateDir().replaceAll("\\", "/").toLowerCase();
      expect(dir).toContain("deskrelay");
      expect(dir).not.toContain("claude-remote");
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "CR_CONNECTOR_STATE_DIR");
      else process.env.CR_CONNECTOR_STATE_DIR = previous;
    }
  });

  test("write then read returns the same shape", async () => {
    const state = {
      pid: 4242,
      host: "127.0.0.1",
      port: 18091,
      startedAt: "2026-04-28T00:00:00.000Z",
    };
    await writeStateFile(state, path);
    const read = await readStateFile(path);
    expect(read).toEqual(state);
  });

  test("readStateFile returns undefined when file missing", async () => {
    const read = await readStateFile(join(tmp, "nope.json"));
    expect(read).toBeUndefined();
  });

  test("readStateFile returns undefined for malformed JSON", async () => {
    await Bun.write(path, "{not json");
    const read = await readStateFile(path);
    expect(read).toBeUndefined();
  });

  test("readStateFile returns undefined when required fields missing", async () => {
    await Bun.write(path, JSON.stringify({ host: "x" }));
    const read = await readStateFile(path);
    expect(read).toBeUndefined();
  });

  test("clearStateFile removes the file", async () => {
    await writeStateFile({ pid: 1, host: "127.0.0.1", port: 1, startedAt: "x" }, path);
    await clearStateFile(path);
    expect(await readStateFile(path)).toBeUndefined();
  });

  test("clearStateFile is idempotent on missing file", async () => {
    await clearStateFile(path); // should not throw
    await clearStateFile(path);
  });

  test("writeStateFile creates parent dirs", async () => {
    const nested = join(tmp, "a", "b", "c", "daemon.json");
    await writeStateFile({ pid: 1, host: "127.0.0.1", port: 1, startedAt: "x" }, nested);
    const read = await readStateFile(nested);
    expect(read?.pid).toBe(1);
  });
});

describe("stateFileToBaseUrl", () => {
  test("composes http URL", () => {
    const url = stateFileToBaseUrl({
      pid: 1,
      host: "127.0.0.1",
      port: 18091,
      startedAt: "x",
    });
    expect(url).toBe("http://127.0.0.1:18091");
  });
});
