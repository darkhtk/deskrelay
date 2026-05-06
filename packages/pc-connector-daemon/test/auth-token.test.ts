import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateAuthToken, readAuthFile, readAuthToken } from "../src/auth-token.ts";

let tmp: string;
let path: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "auth-token-"));
  path = join(tmp, "auth.json");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("loadOrCreateAuthToken", () => {
  test("first call generates a 64-char hex token and marks created=true", async () => {
    const r = await loadOrCreateAuthToken(path);
    expect(r.created).toBe(true);
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.path).toBe(path);
  });

  test("second call reads the existing token and marks created=false", async () => {
    const first = await loadOrCreateAuthToken(path);
    const second = await loadOrCreateAuthToken(path);
    expect(second.created).toBe(false);
    expect(second.token).toBe(first.token);
  });

  test("file content is valid JSON with createdAt ISO timestamp", async () => {
    await loadOrCreateAuthToken(path);
    const file = await readAuthFile(path);
    expect(file).toBeDefined();
    expect(file?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(() => new Date(file?.createdAt ?? "").toISOString()).not.toThrow();
  });

  test("file mode is 600 on POSIX", async () => {
    if (process.platform === "win32") return;
    await loadOrCreateAuthToken(path);
    const s = await stat(path);
    // mask off the file-type bits and just check user/group/other perms
    expect(s.mode & 0o777).toBe(0o600);
  });

  test("nested parent dirs are created on first write", async () => {
    const nested = join(tmp, "a", "b", "c", "auth.json");
    const r = await loadOrCreateAuthToken(nested);
    expect(r.created).toBe(true);
    const reread = await readAuthFile(nested);
    expect(reread?.token).toBe(r.token);
  });
});

describe("readAuthFile / readAuthToken", () => {
  test("returns undefined when file missing", async () => {
    expect(await readAuthFile(path)).toBeUndefined();
    expect(await readAuthToken(path)).toBeUndefined();
  });

  test("returns undefined for malformed JSON", async () => {
    await Bun.write(path, "{not json");
    expect(await readAuthFile(path)).toBeUndefined();
    expect(await readAuthToken(path)).toBeUndefined();
  });

  test("returns undefined when token field missing", async () => {
    await Bun.write(path, JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z" }));
    expect(await readAuthFile(path)).toBeUndefined();
  });

  test("returns undefined when token is empty string", async () => {
    await Bun.write(path, JSON.stringify({ token: "", createdAt: "x" }));
    expect(await readAuthFile(path)).toBeUndefined();
  });

  test("readAuthToken extracts the token string", async () => {
    const r = await loadOrCreateAuthToken(path);
    expect(await readAuthToken(path)).toBe(r.token);
  });
});
