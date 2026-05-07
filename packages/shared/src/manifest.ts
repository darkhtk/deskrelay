// BehaviorManifest — the contract between a published behavior package and
// the PC connector that loads it. Every behavior ships a `manifest.json`
// (or exports one inline) matching this shape; the connector validates it
// before spawning the behavior subprocess.
//
// The manifest is also surfaced in the marketplace UI (displayName,
// description, screenshots, i18n).

/** Where the behavior code executes. Default is "pc". */
export type BehaviorRuntime = "pc" | "browser" | "server";

/** Coarse-grained capability buckets. The connector prompts the user
 * the first time a behavior requests a permission it doesn't already have.
 * Format: "{capability}:{action}:{scope}".
 *
 *   filesystem:read:user.home
 *   filesystem:write:user.home
 *   shell:exec:claude
 *   shell:exec:*
 *   network:outbound:anthropic.com
 *   network:outbound:*
 *   secrets:read:claude.api-key
 */
export type Permission = string;

export type IpcProtocol = "jsonrpc-2.0";

export interface BehaviorPublisher {
  /** Stable slug, e.g. "deskrelay", "alice-dev". */
  id: string;
  /** Human display label. */
  name: string;
  /** DID (e.g. did:web:example.com) used to verify the manifest signature. */
  key: string;
}

export interface BehaviorI18nEntry {
  displayName?: string;
  description?: string;
}

/** Metering class — drives the site's free-tier quota gate.
 *  Absent / unset means "free" (the call doesn't consume a quota slot).
 *  "compose" means "this is a paid AI/agent invocation" — free users
 *  burn one of their monthly composer quota; subscribers are unlimited. */
export type MeteredKind = "free" | "compose";

export interface BehaviorMetered {
  kind: MeteredKind;
}

export interface BehaviorManifest {
  /** Reverse-DNS-style slug, unique within the registry. */
  name: string;
  /** Semver. */
  version: string;
  /** Where the code runs. Default "pc" if omitted. */
  runtime?: BehaviorRuntime;
  /** Path to the entry module (relative to the package root). */
  entry: string;
  /** Coarse-grained capabilities the behavior needs. */
  permissions: Permission[];
  /** IPC protocol between connector and behavior subprocess. */
  ipc: IpcProtocol;
  /** Minimum connector version that can host this behavior. */
  minConnectorVersion: string;
  /** SPDX-style license identifier. */
  license: string;
  publisher: BehaviorPublisher;
  /** Sigstore-style signature over the manifest + package contents. */
  signature?: string;
  homepage?: string;
  /** Default-language display name (English). */
  displayName: string;
  /** Default-language description (English). */
  description: string;
  /** Marketplace categories, e.g. ["coding-agent", "claude"]. */
  categories: string[];
  screenshots?: string[];
  /** Locale-specific overrides. Keys are BCP-47 tags, e.g. "ko", "ja". */
  i18n?: Record<string, BehaviorI18nEntry>;
  /** Free-tier quota class. Absent ⇒ "free" (no quota cost). */
  metered?: BehaviorMetered;
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const NAME_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const PERMISSION_PATTERN = /^[a-z]+:[a-z*]+:[A-Za-z0-9._*-]+$/;

export class ManifestValidationError extends Error {
  constructor(
    /** Dotted JSON-pointer-style path to the offending field, e.g. "permissions[2]". */
    readonly fieldPath: string,
    /** Human reason — keep it short, the path carries the location. */
    reason: string,
    /** The value at that path (best-effort), included in the message for context. */
    readonly badValue?: unknown,
  ) {
    const valueDisplay = badValue === undefined ? "" : ` (got ${truncatedJson(badValue)})`;
    super(`manifest.${fieldPath}: ${reason}${valueDisplay}`);
    this.name = "ManifestValidationError";
  }
}

function truncatedJson(value: unknown): string {
  let out: string;
  try {
    out = JSON.stringify(value);
  } catch {
    out = String(value);
  }
  return out.length > 80 ? `${out.slice(0, 77)}...` : out;
}

function fail(path: string, reason: string, badValue?: unknown): never {
  throw new ManifestValidationError(path, reason, badValue);
}

export function validateManifest(value: unknown): BehaviorManifest {
  if (typeof value !== "object" || value === null) {
    throw new ManifestValidationError("", "must be an object", value);
  }
  const m = value as Record<string, unknown>;

  if (typeof m.name !== "string" || !NAME_PATTERN.test(m.name)) {
    fail("name", "must match /^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$/", m.name);
  }
  if (typeof m.version !== "string" || !SEMVER_PATTERN.test(m.version)) {
    fail("version", "must be semver (X.Y.Z[-prerelease][+build])", m.version);
  }
  if (m.runtime !== undefined && !["pc", "browser", "server"].includes(m.runtime as string)) {
    fail("runtime", 'must be one of "pc" | "browser" | "server"', m.runtime);
  }
  if (typeof m.entry !== "string" || m.entry.length === 0) {
    fail("entry", "must be a non-empty string", m.entry);
  }
  if (!Array.isArray(m.permissions)) {
    fail("permissions", "must be an array", m.permissions);
  }
  (m.permissions as unknown[]).forEach((p, i) => {
    if (typeof p !== "string" || !PERMISSION_PATTERN.test(p)) {
      fail(
        `permissions[${i}]`,
        'must match /^{capability}:{action}:{scope}/ (e.g. "filesystem:read:user.home")',
        p,
      );
    }
  });
  if (m.ipc !== "jsonrpc-2.0") {
    fail("ipc", 'must be "jsonrpc-2.0" (only supported protocol)', m.ipc);
  }
  if (typeof m.minConnectorVersion !== "string" || !SEMVER_PATTERN.test(m.minConnectorVersion)) {
    fail("minConnectorVersion", "must be semver", m.minConnectorVersion);
  }
  if (typeof m.license !== "string" || m.license.length === 0) {
    fail("license", "must be a non-empty SPDX identifier", m.license);
  }
  if (typeof m.publisher !== "object" || m.publisher === null) {
    fail("publisher", "must be an object with id, name, key", m.publisher);
  }
  const pub = m.publisher as Record<string, unknown>;
  if (typeof pub.id !== "string") fail("publisher.id", "must be a string", pub.id);
  if (typeof pub.name !== "string") fail("publisher.name", "must be a string", pub.name);
  if (typeof pub.key !== "string") fail("publisher.key", "must be a string", pub.key);
  if (typeof m.displayName !== "string" || m.displayName.length === 0) {
    fail("displayName", "must be a non-empty string", m.displayName);
  }
  if (typeof m.description !== "string") {
    fail("description", "must be a string", m.description);
  }
  if (!Array.isArray(m.categories)) {
    fail("categories", "must be an array of strings", m.categories);
  }
  (m.categories as unknown[]).forEach((c, i) => {
    if (typeof c !== "string") fail(`categories[${i}]`, "must be a string", c);
  });

  if (m.metered !== undefined) {
    if (typeof m.metered !== "object" || m.metered === null) {
      fail("metered", "must be an object with `kind`", m.metered);
    }
    const met = m.metered as Record<string, unknown>;
    if (met.kind !== "free" && met.kind !== "compose") {
      fail("metered.kind", 'must be one of "free" | "compose"', met.kind);
    }
  }

  return value as BehaviorManifest;
}
