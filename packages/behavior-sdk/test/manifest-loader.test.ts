import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestLoadError, loadBehaviorPackage } from "../src/manifest-loader.ts";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "echo-behavior");

describe("loadBehaviorPackage — happy path", () => {
  test("loads + validates the echo fixture", async () => {
    const pkg = await loadBehaviorPackage(FIXTURE_DIR);
    expect(pkg.manifest.name).toBe("echo");
    expect(pkg.manifest.runtime).toBe("pc");
    expect(pkg.entryPath.endsWith("entry.ts")).toBe(true);
    expect(pkg.packageDir.endsWith("echo-behavior")).toBe(true);
  });
});

describe("loadBehaviorPackage — error paths", () => {
  let tmp: string;

  async function setup(files: Record<string, string>): Promise<string> {
    tmp = await mkdtemp(join(tmpdir(), "manifest-loader-test-"));
    for (const [path, content] of Object.entries(files)) {
      const full = join(tmp, path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content, "utf8");
    }
    return tmp;
  }

  async function cleanup(): Promise<void> {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }

  test("missing manifest.json", async () => {
    const dir = await setup({});
    try {
      await expect(loadBehaviorPackage(dir)).rejects.toThrow(ManifestLoadError);
    } finally {
      await cleanup();
    }
  });

  test("manifest is not valid JSON", async () => {
    const dir = await setup({ "manifest.json": "{not json" });
    try {
      await expect(loadBehaviorPackage(dir)).rejects.toThrow(/valid JSON/);
    } finally {
      await cleanup();
    }
  });

  test("manifest validation fails", async () => {
    const dir = await setup({
      "manifest.json": JSON.stringify({ name: "BadName" }),
    });
    try {
      await expect(loadBehaviorPackage(dir)).rejects.toThrow(/manifest validation failed/);
    } finally {
      await cleanup();
    }
  });

  test("entry escapes package directory", async () => {
    const dir = await setup({
      "manifest.json": JSON.stringify({
        name: "x",
        version: "0.0.1",
        entry: "../escape.js",
        permissions: [],
        ipc: "jsonrpc-2.0",
        minConnectorVersion: "0.0.0",
        license: "Apache-2.0",
        publisher: { id: "x", name: "X", key: "did:web:x" },
        displayName: "X",
        description: "",
        categories: [],
      }),
    });
    try {
      await expect(loadBehaviorPackage(dir)).rejects.toThrow(/escapes package directory/);
    } finally {
      await cleanup();
    }
  });

  test("entry file does not exist", async () => {
    const dir = await setup({
      "manifest.json": JSON.stringify({
        name: "x",
        version: "0.0.1",
        entry: "./missing.js",
        permissions: [],
        ipc: "jsonrpc-2.0",
        minConnectorVersion: "0.0.0",
        license: "Apache-2.0",
        publisher: { id: "x", name: "X", key: "did:web:x" },
        displayName: "X",
        description: "",
        categories: [],
      }),
    });
    try {
      await expect(loadBehaviorPackage(dir)).rejects.toThrow(/cannot stat entry/);
    } finally {
      await cleanup();
    }
  });
});
