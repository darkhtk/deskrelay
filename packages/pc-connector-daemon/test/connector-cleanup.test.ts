import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeConnectorLocalState } from "../src/connector-cleanup.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "cr-cleanup-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("removeConnectorLocalState", () => {
  test("removes local connector-owned state and cache paths", async () => {
    const authFilePath = join(tmp, "auth.json");
    const stateFilePath = join(tmp, "daemon.json");
    const identityDir = join(tmp, "identity");
    const behaviorsDir = join(tmp, "behaviors");
    await mkdir(join(identityDir, "keys"), { recursive: true });
    await mkdir(join(behaviorsDir, "echo"), { recursive: true });
    await writeFile(authFilePath, "{}");
    await writeFile(stateFilePath, "{}");
    await writeFile(join(identityDir, "identity.json"), "{}");
    await writeFile(join(identityDir, "keys", "key.bin"), "secret");
    await writeFile(join(behaviorsDir, "echo", "manifest.json"), "{}");

    const r = await removeConnectorLocalState({
      stateDir: tmp,
      authFilePath,
      stateFilePath,
      identityDir,
      behaviorsDir,
    });

    expect(r).toEqual({
      stateDir: tmp,
      authRemoved: true,
      daemonStateRemoved: true,
      identityDirRemoved: true,
      behaviorsDirRemoved: true,
      stateDirRemoved: true,
      removedAny: true,
    });
    await expectMissing(authFilePath);
    await expectMissing(stateFilePath);
    await expectMissing(identityDir);
    await expectMissing(behaviorsDir);
    await expectMissing(tmp);
  });

  test("is idempotent when state is already absent", async () => {
    const r = await removeConnectorLocalState({
      stateDir: join(tmp, "missing-state"),
      authFilePath: join(tmp, "missing-state", "auth.json"),
      stateFilePath: join(tmp, "missing-state", "daemon.json"),
      identityDir: join(tmp, "missing-state", "identity"),
      behaviorsDir: join(tmp, "missing-state", "behaviors"),
    });

    expect(r.removedAny).toBe(false);
  });

  test("leaves non-owned files in the state dir alone", async () => {
    await writeFile(join(tmp, "operator-note.txt"), "keep");

    const r = await removeConnectorLocalState({
      stateDir: tmp,
      authFilePath: join(tmp, "auth.json"),
      stateFilePath: join(tmp, "daemon.json"),
      identityDir: join(tmp, "identity"),
      behaviorsDir: join(tmp, "behaviors"),
    });

    expect(r.removedAny).toBe(false);
    expect(r.stateDirRemoved).toBe(false);
    const note = await stat(join(tmp, "operator-note.txt"));
    expect(note.isFile()).toBe(true);
  });
});

async function expectMissing(path: string): Promise<void> {
  try {
    await stat(path);
    throw new Error(`expected ${path} to be removed`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}
