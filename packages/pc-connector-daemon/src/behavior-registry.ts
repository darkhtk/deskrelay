// BehaviorRegistry — owns the set of currently-loaded BehaviorHosts on
// this PC connector. The registry is the daemon's single source of truth
// for "which behaviors are running, and how do I talk to them".
//
// Lookup is by `instanceId` (chosen at load time). The same behavior
// package can be loaded multiple times under different instanceIds
// (e.g., a remote_claude bound to two different user-claude profiles).

import {
  type BehaviorHost,
  type BehaviorHostLogRecord,
  InProcessBehaviorHost,
  type InProcessBehaviorDefinition,
  type LoadedBehaviorPackage,
  loadBehaviorPackage,
  spawnBehaviorHost,
} from "@deskrelay/behavior-sdk";
import type { InProcessSubscriptionBroker } from "@deskrelay/core";

export interface BehaviorEntry {
  instanceId: string;
  pkg: LoadedBehaviorPackage;
  host: BehaviorHost;
  loadedAt: string;
  /** Resolved when the subprocess exits (clean or crash). */
  exited: Promise<number | null>;
}

export interface LoadBehaviorOptions {
  packageDir: string;
  /** If omitted, defaults to the manifest name. */
  instanceId?: string;
  bunPath?: string;
  /** Per-host log sink, in addition to the registry-wide sink. */
  onLog?: (record: BehaviorHostLogRecord) => void;
}

export interface BehaviorRegistryOptions {
  broker: InProcessSubscriptionBroker;
  /** Receives every behavior's log records (annotated with instanceId). */
  onLog?: (record: BehaviorHostLogRecord & { instanceId: string }) => void;
  /** Receives unexpected exits (annotated with instanceId). */
  onUnexpectedExit?: (info: {
    instanceId: string;
    code: number | null;
    signal?: string;
  }) => void;
  bunPath?: string;
  /** Optional license check called before spawning. Receives the loaded
   *  manifest and decides whether to allow. Free behaviors (manifest
   *  license = OSI permissive identifier in `freeLicenses`) bypass the
   *  check. M7.5.4: caller wires this to LicenseCache.hasGrant(). */
  checkLicense?: (manifest: LoadedBehaviorPackage["manifest"]) => Promise<boolean>;
  /** SPDX identifiers treated as "no license check needed". Default
   *  ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"]. */
  freeLicenses?: readonly string[];
  /** Phase 1 manifest-permission policy: publisher IDs trusted to
   *  declare any permission. Defaults to ["deskrelay"] — the only
   *  publisher that ships behaviors with this repo. Third-party
   *  publishers fall through to allowedThirdPartyPermissions. */
  firstPartyPublishers?: readonly string[];
  /** Phase 1 manifest-permission policy: permission strings allowed for
   *  third-party publishers (anything not in firstPartyPublishers).
   *  Default empty = block every third-party load until the operator
   *  opts in by listing safe permissions here. Each entry matches a
   *  permission verbatim (no glob expansion in this phase). */
  allowedThirdPartyPermissions?: readonly string[];
}

export class BehaviorRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BehaviorRegistryError";
  }
}

const DEFAULT_FREE_LICENSES: readonly string[] = [
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
];

const DEFAULT_FIRST_PARTY_PUBLISHERS: readonly string[] = ["deskrelay"];

export class BehaviorRegistry {
  readonly #broker: InProcessSubscriptionBroker;
  readonly #entries = new Map<string, BehaviorEntry>();
  readonly #onLog: BehaviorRegistryOptions["onLog"];
  readonly #onUnexpectedExit: BehaviorRegistryOptions["onUnexpectedExit"];
  readonly #bunPath: string | undefined;
  readonly #checkLicense: BehaviorRegistryOptions["checkLicense"];
  readonly #freeLicenses: readonly string[];
  readonly #firstPartyPublishers: readonly string[];
  readonly #allowedThirdPartyPermissions: readonly string[];

  constructor(options: BehaviorRegistryOptions) {
    this.#broker = options.broker;
    this.#onLog = options.onLog;
    this.#onUnexpectedExit = options.onUnexpectedExit;
    this.#bunPath = options.bunPath;
    this.#checkLicense = options.checkLicense;
    this.#freeLicenses = options.freeLicenses ?? DEFAULT_FREE_LICENSES;
    this.#firstPartyPublishers = options.firstPartyPublishers ?? DEFAULT_FIRST_PARTY_PUBLISHERS;
    this.#allowedThirdPartyPermissions = options.allowedThirdPartyPermissions ?? [];
  }

  /** Load a behavior package and start its subprocess. */
  async load(options: LoadBehaviorOptions): Promise<BehaviorEntry> {
    const pkg = await loadBehaviorPackage(options.packageDir);
    const instanceId = options.instanceId ?? pkg.manifest.name;
    if (this.#entries.has(instanceId)) {
      throw new BehaviorRegistryError(`instanceId already loaded: ${instanceId}`);
    }

    // Phase 1 manifest-permission policy. validateManifest has already
    // ensured permissions is an array of well-formed strings; we only
    // decide whether *this* publisher is trusted with *these* perms.
    // First-party publisher → free pass. Otherwise every permission must
    // be in the operator-curated allowlist. Extracted as a separate
    // method so tests can assert the policy without paying the cost of
    // a real subprocess spawn.
    this.checkPermissionPolicy(pkg.manifest);

    // License gate. Free behaviors (OSI permissive) bypass; everything
    // else needs a positive answer from checkLicense.
    if (!this.#freeLicenses.includes(pkg.manifest.license) && this.#checkLicense) {
      const allowed = await this.#checkLicense(pkg.manifest);
      if (!allowed) {
        throw new BehaviorRegistryError(
          `behavior "${pkg.manifest.name}" (${pkg.manifest.license}) requires a license — none granted`,
        );
      }
    }

    const bunPath = options.bunPath ?? this.#bunPath;
    const result = await spawnBehaviorHost({
      pkg,
      broker: this.#broker,
      instanceId,
      ...(bunPath !== undefined ? { bunPath } : {}),
      onLog: (r) => {
        options.onLog?.(r);
        this.#onLog?.({ ...r, instanceId });
      },
      onUnexpectedExit: (info) => {
        this.#onUnexpectedExit?.({ instanceId, ...info });
        // Auto-prune the entry on unexpected exit so it doesn't linger.
        this.#entries.delete(instanceId);
      },
    });
    const entry: BehaviorEntry = {
      instanceId,
      pkg,
      host: result.host,
      loadedAt: new Date().toISOString(),
      exited: result.exited.then((code) => {
        // Always remove from the map once the subprocess truly exits.
        this.#entries.delete(instanceId);
        return code;
      }),
    };
    this.#entries.set(instanceId, entry);
    return entry;
  }

  /** Throws BehaviorRegistryError when the manifest's publisher +
   *  permission combination violates the configured policy. Pure: no
   *  side effects, no spawn. Exposed so callers (and tests) can
   *  validate manifests up-front. */
  checkPermissionPolicy(manifest: LoadedBehaviorPackage["manifest"]): void {
    const publisherId = manifest.publisher.id;
    if (this.#firstPartyPublishers.includes(publisherId)) return;
    const denied = manifest.permissions.filter(
      (p) => !this.#allowedThirdPartyPermissions.includes(p),
    );
    if (denied.length > 0) {
      throw new BehaviorRegistryError(
        `behavior "${manifest.name}" from publisher "${publisherId}" requests permissions not allowed by policy: ${denied.join(", ")}`,
      );
    }
  }

  get(instanceId: string): BehaviorEntry | undefined {
    return this.#entries.get(instanceId);
  }

  list(): BehaviorEntry[] {
    return [...this.#entries.values()];
  }

  /** Load a first-party behavior in-process (no subprocess, no JSONRPC).
   *  Used for behaviors that ship with the daemon binary — they don't
   *  need the isolation the spawn pipeline was built for, and skipping
   *  it eliminates every "behavior won't load" failure mode that
   *  depended on bundle resolution / spawn argv / stdin pipes /
   *  login-task elevation. The returned BehaviorEntry shape matches the
   *  subprocess flavor exactly so HTTP routes (`/behaviors/:id/request`)
   *  and shutdown plumbing don't have to branch. */
  async loadInProcess(
    def: InProcessBehaviorDefinition,
    options: { instanceId?: string; onLog?: (record: BehaviorHostLogRecord) => void } = {},
  ): Promise<BehaviorEntry> {
    const instanceId = options.instanceId ?? def.manifest.name;
    if (this.#entries.has(instanceId)) {
      throw new BehaviorRegistryError(`instanceId already loaded: ${instanceId}`);
    }
    // Reuse the same permission policy + license gate as the subprocess
    // path. First-party publishers (the only ones we ever route here)
    // pass instantly, but keeping the check makes it impossible for a
    // future caller to sneak an unverified behavior in via this entry.
    this.checkPermissionPolicy(def.manifest);
    if (!this.#freeLicenses.includes(def.manifest.license) && this.#checkLicense) {
      const allowed = await this.#checkLicense(def.manifest);
      if (!allowed) {
        throw new BehaviorRegistryError(
          `behavior "${def.manifest.name}" (${def.manifest.license}) requires a license — none granted`,
        );
      }
    }
    const host = new InProcessBehaviorHost({
      def,
      broker: this.#broker,
      instanceId,
      onLog: (r) => {
        options.onLog?.(r);
        this.#onLog?.({ ...r, instanceId });
      },
    });
    await host.start();
    // Project the in-process host into the same package shape the
    // subprocess flavor produces (manifest is the only field
    // BehaviorEntry consumers read from `pkg`).
    const pkg = {
      manifest: def.manifest,
      // Subprocess pkg fields the in-process flavor doesn't have. Set
      // to placeholders only the manifest reader would notice — none
      // of the daemon's HTTP routes touch these.
      packageDir: "<in-process>",
      entryPath: "<in-process>",
    } as unknown as LoadedBehaviorPackage;
    const entry: BehaviorEntry = {
      instanceId,
      pkg,
      host: host as unknown as BehaviorHost,
      loadedAt: new Date().toISOString(),
      exited: host.exited.then((code) => {
        this.#entries.delete(instanceId);
        return code;
      }),
    };
    this.#entries.set(instanceId, entry);
    return entry;
  }

  /** Gracefully unload a single behavior by instanceId. Idempotent. */
  async unload(instanceId: string): Promise<void> {
    const entry = this.#entries.get(instanceId);
    if (!entry) return;
    await entry.host.shutdown();
    this.#entries.delete(instanceId);
  }

  /** Shut down every behavior. Returns a promise that resolves once all
   *  hosts have exited. */
  async shutdownAll(): Promise<void> {
    const all = [...this.#entries.values()];
    await Promise.allSettled(all.map((e) => e.host.shutdown()));
    this.#entries.clear();
  }
}
