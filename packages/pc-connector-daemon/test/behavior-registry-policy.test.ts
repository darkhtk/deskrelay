// Phase-1 manifest-permission policy. Drives BehaviorRegistry against
// synthetic manifests so we can vary publisher.id and permissions
// without depending on shipped behaviors. Uses the registry's pure
// `checkPermissionPolicy` method (no subprocess spawn) so the tests are
// deterministic under workspace-parallel runs as well as in isolation.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBehaviorPackage } from "@deskrelay/behavior-sdk";
import { InProcessSubscriptionBroker } from "@deskrelay/core";
import { BehaviorRegistry, BehaviorRegistryError } from "../src/behavior-registry.ts";

interface ManifestOverrides {
  name?: string;
  publisherId?: string;
  permissions?: string[];
  license?: string;
}

/** Per-test temp dir so parallel tests across the workspace don't share
 *  state. Each test calls writePackage(perTestDir, ...). */
async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "registry-policy-"));
}

async function writePackage(dir: string, overrides: ManifestOverrides = {}): Promise<string> {
  const manifest = {
    name: overrides.name ?? "test-behavior",
    version: "0.0.1",
    runtime: "pc",
    entry: "./entry.js",
    permissions: overrides.permissions ?? [],
    ipc: "jsonrpc-2.0",
    minConnectorVersion: "0.0.0",
    license: overrides.license ?? "Apache-2.0",
    publisher: {
      id: overrides.publisherId ?? "deskrelay",
      name: "Test Publisher",
      key: "did:web:test.example",
    },
    displayName: "Test",
    description: "test",
    categories: ["test"],
  };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest), "utf8");
  // Empty entry — we never spawn the behavior in these tests; the
  // policy gate is exercised via BehaviorRegistry.checkPermissionPolicy
  // directly, which only inspects the manifest.
  await writeFile(join(dir, "entry.js"), "// test entry\n", "utf8");
  return dir;
}

let tmpDirs: string[] = [];

beforeEach(() => {
  tmpDirs = [];
});

afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

async function loadManifest(overrides: ManifestOverrides = {}) {
  const dir = await makeTempDir();
  tmpDirs.push(dir);
  await writePackage(dir, overrides);
  const pkg = await loadBehaviorPackage(dir);
  return pkg.manifest;
}

describe("BehaviorRegistry — phase-1 permission policy", () => {
  test("first-party publisher passes with broad permissions", async () => {
    const manifest = await loadManifest({
      publisherId: "deskrelay",
      permissions: ["shell:exec:*", "filesystem:write:user.home"],
    });
    const registry = new BehaviorRegistry({
      broker: new InProcessSubscriptionBroker(),
    });
    // Returns void on success.
    registry.checkPermissionPolicy(manifest);
  });

  test("third-party publisher with disallowed permissions throws BehaviorRegistryError", async () => {
    const manifest = await loadManifest({
      publisherId: "alice-dev",
      permissions: ["shell:exec:rm", "filesystem:write:*"],
    });
    const registry = new BehaviorRegistry({
      broker: new InProcessSubscriptionBroker(),
      // No allowedThirdPartyPermissions — every third-party perm is denied.
    });
    expect(() => registry.checkPermissionPolicy(manifest)).toThrow(
      /permissions not allowed by policy/,
    );
  });

  test("third-party publisher whose permissions are whitelisted passes", async () => {
    const manifest = await loadManifest({
      publisherId: "alice-dev",
      permissions: ["network:outbound:anthropic.com"],
    });
    const registry = new BehaviorRegistry({
      broker: new InProcessSubscriptionBroker(),
      allowedThirdPartyPermissions: ["network:outbound:anthropic.com"],
    });
    registry.checkPermissionPolicy(manifest);
  });

  test("third-party publisher with empty permissions list passes", async () => {
    const manifest = await loadManifest({ publisherId: "alice-dev", permissions: [] });
    const registry = new BehaviorRegistry({
      broker: new InProcessSubscriptionBroker(),
    });
    registry.checkPermissionPolicy(manifest);
  });

  test("custom firstPartyPublishers override honors operator config", async () => {
    const manifest = await loadManifest({
      publisherId: "alice-dev",
      permissions: ["shell:exec:claude"],
    });
    const registry = new BehaviorRegistry({
      broker: new InProcessSubscriptionBroker(),
      firstPartyPublishers: ["alice-dev"],
    });
    registry.checkPermissionPolicy(manifest);
  });

  test("third-party rejection lists only the offending permissions", async () => {
    const manifest = await loadManifest({
      publisherId: "alice-dev",
      permissions: ["network:outbound:anthropic.com", "shell:exec:rm"],
    });
    const registry = new BehaviorRegistry({
      broker: new InProcessSubscriptionBroker(),
      allowedThirdPartyPermissions: ["network:outbound:anthropic.com"],
    });
    let caught: Error | undefined;
    try {
      registry.checkPermissionPolicy(manifest);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(BehaviorRegistryError);
    expect(caught?.message).toMatch(/shell:exec:rm/);
    expect(caught?.message).not.toMatch(/network:outbound:anthropic\.com/);
  });
});
