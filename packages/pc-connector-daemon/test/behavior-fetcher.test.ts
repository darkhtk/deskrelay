import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BehaviorFetcher, BehaviorFetcherError } from "../src/behavior-fetcher.ts";

let tmp: string;

async function setupBehaviorPkg(parentDir: string, name: string): Promise<string> {
  const dir = join(parentDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({
      name,
      version: "0.0.1",
      runtime: "pc",
      entry: "./entry.ts",
      permissions: [],
      ipc: "jsonrpc-2.0",
      minConnectorVersion: "0.0.0",
      license: "Apache-2.0",
      publisher: { id: "test", name: "Test", key: "did:web:test" },
      displayName: name,
      description: "test",
      categories: ["test"],
    }),
    "utf8",
  );
  await writeFile(join(dir, "entry.ts"), "// test", "utf8");
  return dir;
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "cr-fetcher-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("BehaviorFetcher.parseSourceUrl", () => {
  test("deskrelay://behaviors/<name> → registry (canonical)", () => {
    const s = BehaviorFetcher.parseSourceUrl("deskrelay://behaviors/echo");
    expect(s).toEqual({
      kind: "registry",
      url: "deskrelay://behaviors/echo",
    });
  });

  test("dr://behaviors/<name> → registry (back-compat alias)", () => {
    const s = BehaviorFetcher.parseSourceUrl("dr://behaviors/echo");
    expect(s).toEqual({ kind: "registry", url: "dr://behaviors/echo" });
  });

  test("npm://<package> → npm without version", () => {
    expect(BehaviorFetcher.parseSourceUrl("npm://@scope/foo")).toEqual({
      kind: "npm",
      package: "@scope/foo",
    });
  });

  test("npm://<package>@<version> → npm with version", () => {
    expect(BehaviorFetcher.parseSourceUrl("npm://foo@1.2.3")).toEqual({
      kind: "npm",
      package: "foo",
      version: "1.2.3",
    });
  });

  test("github://<repo>@<ref> → github with ref", () => {
    expect(BehaviorFetcher.parseSourceUrl("github://owner/repo@v1.0.0")).toEqual({
      kind: "github",
      repo: "owner/repo",
      ref: "v1.0.0",
    });
  });

  test("absolute POSIX path → local", () => {
    expect(BehaviorFetcher.parseSourceUrl("/abs/path")).toEqual({
      kind: "local",
      packageDir: "/abs/path",
    });
  });

  test("absolute Windows path → local", () => {
    expect(BehaviorFetcher.parseSourceUrl("C:\\Users\\me\\foo")).toEqual({
      kind: "local",
      packageDir: "C:\\Users\\me\\foo",
    });
  });

  test("empty / unknown URL throws", () => {
    expect(() => BehaviorFetcher.parseSourceUrl("")).toThrow(BehaviorFetcherError);
    expect(() => BehaviorFetcher.parseSourceUrl("ftp://x")).toThrow(BehaviorFetcherError);
  });
});

describe("BehaviorFetcher.fetchSource", () => {
  test("local source returns the absolute path", async () => {
    const pkgDir = await setupBehaviorPkg(tmp, "echo");
    const f = new BehaviorFetcher();
    const result = await f.fetchSource({ kind: "local", packageDir: pkgDir });
    expect(result.packageDir).toBe(pkgDir);
    expect(result.resolved.kind).toBe("local");
  });

  test("local source rejects when manifest.json is missing", async () => {
    const dir = join(tmp, "no-manifest");
    await mkdir(dir, { recursive: true });
    const f = new BehaviorFetcher();
    await expect(f.fetchSource({ kind: "local", packageDir: dir })).rejects.toThrow(
      /manifest\.json/,
    );
  });

  test("registry source resolves via firstPartyDirs map (canonical scheme)", async () => {
    const pkgDir = await setupBehaviorPkg(tmp, "echo");
    const f = new BehaviorFetcher({
      firstPartyDirs: new Map([["echo", pkgDir]]),
    });
    const result = await f.fetchSource({
      kind: "registry",
      url: "deskrelay://behaviors/echo",
    });
    expect(result.packageDir).toBe(pkgDir);
  });

  test("registry source resolves via firstPartyDirs map (dr alias)", async () => {
    const pkgDir = await setupBehaviorPkg(tmp, "echo");
    const f = new BehaviorFetcher({
      firstPartyDirs: new Map([["echo", pkgDir]]),
    });
    const result = await f.fetchSource({
      kind: "registry",
      url: "dr://behaviors/echo",
    });
    expect(result.packageDir).toBe(pkgDir);
  });

  test("registry source rejects when name not in firstPartyDirs (no fallback yet)", async () => {
    const f = new BehaviorFetcher();
    await expect(
      f.fetchSource({
        kind: "registry",
        url: "deskrelay://behaviors/missing",
      }),
    ).rejects.toThrow(/not in firstPartyDirs/);
  });

  test("malformed registry URL → error", async () => {
    const f = new BehaviorFetcher();
    await expect(
      f.fetchSource({ kind: "registry", url: "deskrelay://wrong/path" }),
    ).rejects.toThrow(/invalid registry URL/);
  });

  test("npm + github source kinds throw 'not implemented'", async () => {
    const f = new BehaviorFetcher();
    await expect(f.fetchSource({ kind: "npm", package: "foo" })).rejects.toThrow(/not implemented/);
    await expect(f.fetchSource({ kind: "github", repo: "x/y" })).rejects.toThrow(/not implemented/);
  });

  test("readRawManifest returns the parsed JSON", async () => {
    const pkgDir = await setupBehaviorPkg(tmp, "echo");
    const f = new BehaviorFetcher();
    const m = await f.readRawManifest(pkgDir);
    expect(m.name).toBe("echo");
    expect(m.license).toBe("Apache-2.0");
  });
});

describe("BehaviorRegistry license gate (M7.5.4)", () => {
  test("free behavior (Apache-2.0) bypasses checkLicense", async () => {
    // Reuse the existing daemon e2e infra by importing BehaviorRegistry
    // and verifying the gate. We stub spawnBehaviorHost via the real
    // SDK fixture (echo behavior) to keep this an integration test.
    const { InProcessSubscriptionBroker } = await import("@deskrelay/core");
    const { BehaviorRegistry } = await import("../src/behavior-registry.ts");
    const broker = new InProcessSubscriptionBroker();
    let checked = false;
    const reg = new BehaviorRegistry({
      broker,
      checkLicense: async () => {
        checked = true;
        return true;
      },
    });
    // Use the bundled echo (Apache-2.0) — should NOT call checkLicense.
    const echoDir = join(import.meta.dir, "..", "..", "behaviors", "echo");
    const entry = await reg
      .load({ packageDir: echoDir, instanceId: "echo-free", bunPath: process.execPath })
      .catch((e) => {
        throw e;
      });
    expect(checked).toBe(false);
    await reg.unload(entry.instanceId);
  });

  test("non-free behavior with checkLicense=false rejects", async () => {
    const { InProcessSubscriptionBroker } = await import("@deskrelay/core");
    const { BehaviorRegistry, BehaviorRegistryError } = await import("../src/behavior-registry.ts");
    const broker = new InProcessSubscriptionBroker();
    const reg = new BehaviorRegistry({
      broker,
      // Treat Apache-2.0 as "needs license" so we can test the negative path.
      freeLicenses: [],
      checkLicense: async () => false,
    });
    const echoDir = join(import.meta.dir, "..", "..", "behaviors", "echo");
    let caught: unknown;
    try {
      await reg.load({
        packageDir: echoDir,
        instanceId: "echo-paid",
        bunPath: process.execPath,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BehaviorRegistryError);
    expect((caught as Error).message).toMatch(/license/);
  });

  test("non-free behavior with checkLicense=true allows", async () => {
    const { InProcessSubscriptionBroker } = await import("@deskrelay/core");
    const { BehaviorRegistry } = await import("../src/behavior-registry.ts");
    const broker = new InProcessSubscriptionBroker();
    const reg = new BehaviorRegistry({
      broker,
      freeLicenses: [],
      checkLicense: async () => true,
    });
    const echoDir = join(import.meta.dir, "..", "..", "behaviors", "echo");
    const entry = await reg.load({
      packageDir: echoDir,
      instanceId: "echo-licensed",
      bunPath: process.execPath,
    });
    expect(entry.instanceId).toBe("echo-licensed");
    await reg.unload(entry.instanceId);
  });
});
