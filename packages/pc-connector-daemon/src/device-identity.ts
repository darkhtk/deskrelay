// device-identity — persisted Ed25519 keypair + paired site/device id.
//
// Files (under defaultStateDir() / "identity"):
//   identity.json        { deviceId, siteUrl, publicKey, pairedAt, keyHandle }
//   keys/<keyHandle>.bin private key bytes (pkcs8) — chmod 600 best-effort
//
// The keyHandle indirection is here so M8 can swap the storage backend
// for an OS-secure store (TPM / Secure Enclave / keyring) without
// changing the identity file shape.

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  InMemorySoftwareKeyStorage,
  SoftwareKeyBackend,
  type SoftwareKeyStorage,
  base64UrlEncode,
} from "@claude-remote/shared/device-key";
import { chmod600Best } from "./chmod-best.ts";
import { defaultStateDir } from "./state-file.ts";

export interface DeviceIdentity {
  deviceId: string;
  siteUrl: string;
  /** base64url(32 bytes). */
  publicKey: string;
  /** Opaque key handle the SoftwareKeyBackend uses. */
  keyHandle: string;
  /** ISO 8601. */
  pairedAt: string;
  label?: string;
  os?: string;
  hostname?: string;
  /** Long-lived bearer the daemon sends in the WS hello frame to
   *  /api/connector/ws so the site DurableObject can authenticate the
   *  outbound connection. Issued by /api/pairing/complete. Older
   *  identity files written before Phase D omit this and need re-pair
   *  to enable a legacy outbound relay. */
  connectionToken?: string;
}

export function defaultIdentityDir(): string {
  if (process.env.CR_IDENTITY_DIR) return process.env.CR_IDENTITY_DIR;
  return join(defaultStateDir(), "identity");
}

export function defaultIdentityPath(): string {
  return join(defaultIdentityDir(), "identity.json");
}

export function defaultKeysDir(): string {
  return join(defaultIdentityDir(), "keys");
}

/** Disk-backed SoftwareKeyStorage. Each handle becomes one file under
 *  `keys/<handle>.bin`. We chmod 600 best-effort (POSIX only). */
export class DiskSoftwareKeyStorage implements SoftwareKeyStorage {
  constructor(private readonly dir: string = defaultKeysDir()) {}

  async put(keyHandle: string, key: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, `${keyHandle}.bin`);
    await writeFile(path, key);
    // Private key bytes — most sensitive thing the connector writes.
    // Warn loudly if the perm lock can't be applied (filesystem
    // limitation), but never crash pairing over it.
    await chmod600Best(path);
  }

  async get(keyHandle: string): Promise<Uint8Array | undefined> {
    const path = join(this.dir, `${keyHandle}.bin`);
    try {
      const buf = await readFile(path);
      return new Uint8Array(buf);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async remove(keyHandle: string): Promise<void> {
    const path = join(this.dir, `${keyHandle}.bin`);
    try {
      await (await import("node:fs/promises")).unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

/** Read the identity file (or undefined if not paired). */
export async function readDeviceIdentity(
  path = defaultIdentityPath(),
): Promise<DeviceIdentity | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as DeviceIdentity;
    if (
      typeof parsed.deviceId !== "string" ||
      typeof parsed.siteUrl !== "string" ||
      typeof parsed.publicKey !== "string" ||
      typeof parsed.keyHandle !== "string"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function writeDeviceIdentity(
  identity: DeviceIdentity,
  path = defaultIdentityPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  // identity.json holds the long-lived connectionToken used in the WS
  // hello handshake — perm-lock if we can.
  await chmod600Best(path);
}

/** Pairing flow: generate key, POST /api/pairing/complete with
 *  publicKey + code, persist identity + private key on success.
 *  Throws on any HTTP / validation failure (caller catches + reports). */
export interface PairOptions {
  siteUrl: string;
  code: string;
  label?: string;
  os?: string;
  hostname?: string;
  /** Override identity dir (tests). */
  identityDir?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

export interface PairResult {
  identity: DeviceIdentity;
  /** Server's response body verbatim (for diagnostics). */
  serverResponse: { deviceId: string; registeredAt: string; label?: string };
}

export async function pairWithSite(opts: PairOptions): Promise<PairResult> {
  const identityDir = opts.identityDir ?? defaultIdentityDir();
  const keysDir = join(identityDir, "keys");
  const identityPath = join(identityDir, "identity.json");

  const storage = new DiskSoftwareKeyStorage(keysDir);
  const backend = new SoftwareKeyBackend({ storage });
  const handle = await backend.generate();
  const publicKeyB64 = base64UrlEncode(handle.publicKey);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL("/api/pairing/complete", opts.siteUrl).toString();
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: opts.code,
      publicKey: publicKeyB64,
      ...(opts.label ? { label: opts.label } : {}),
      ...(opts.os ? { os: opts.os } : {}),
      ...(opts.hostname ? { hostname: opts.hostname } : {}),
    }),
  });
  const text = await res.text();
  let body: {
    deviceId?: string;
    registeredAt?: string;
    label?: string;
    connectionToken?: string;
    error?: string;
  } = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`pairing: site returned non-JSON (status ${res.status})`);
    }
  }
  if (!res.ok || !body.deviceId) {
    // Best-effort cleanup of the orphaned private key.
    await storage.remove(handle.keyHandle).catch(() => undefined);
    throw new Error(`pairing failed (${res.status}): ${body.error ?? "unknown error"}`);
  }

  const identity: DeviceIdentity = {
    deviceId: body.deviceId,
    siteUrl: opts.siteUrl,
    publicKey: publicKeyB64,
    keyHandle: handle.keyHandle,
    pairedAt: new Date().toISOString(),
    ...(body.label ? { label: body.label } : {}),
    ...(opts.os ? { os: opts.os } : {}),
    ...(opts.hostname ? { hostname: opts.hostname } : {}),
    ...(body.connectionToken ? { connectionToken: body.connectionToken } : {}),
  };
  await writeDeviceIdentity(identity, identityPath);
  return {
    identity,
    serverResponse: {
      deviceId: body.deviceId,
      registeredAt: body.registeredAt ?? "",
      ...(body.label ? { label: body.label } : {}),
    },
  };
}

/** Result of a local unpair: which artifacts were actually present
 *  before we removed them. Useful for human/JSON output so the operator
 *  knows whether they were "already unpaired" or genuinely cleaned up. */
export interface RemoveDeviceIdentityResult {
  /** identity.json existed and was removed. */
  identityRemoved: boolean;
  /** keys/<handle>.bin existed and was removed (always false when no
   *  identity was on disk to point at it). */
  keyRemoved: boolean;
  /** The deviceId that was paired before this call, or undefined if
   *  no identity was on disk to begin with. */
  previousDeviceId?: string;
}

/** Idempotently drop the local pairing artifacts:
 *    - keys/<handle>.bin (referenced by identity.json's keyHandle);
 *    - identity.json itself.
 *  Missing files are treated as success — re-running this command after
 *  a successful unpair must not error. The site-side row is NOT touched
 *  here; that's done by the operator/browser hitting DELETE /api/devices/:id
 *  (or, for self-unpair, an explicit device-authenticated endpoint —
 *  not exposed yet to avoid widening the auth surface). */
export async function removeDeviceIdentity(
  opts: {
    identityPath?: string;
    keysDir?: string;
  } = {},
): Promise<RemoveDeviceIdentityResult> {
  const identityPath = opts.identityPath ?? defaultIdentityPath();
  const keysDir = opts.keysDir ?? defaultKeysDir();
  const result: RemoveDeviceIdentityResult = {
    identityRemoved: false,
    keyRemoved: false,
  };
  // Read the identity first so we know which key file to drop. A
  // malformed identity.json still gets removed below; we just won't
  // know the keyHandle to wipe in that case (orphaned keys are harmless
  // — the user can `rm -rf` the identity dir if they care).
  const identity = await readDeviceIdentity(identityPath).catch(() => undefined);
  if (identity) {
    result.previousDeviceId = identity.deviceId;
    if (identity.keyHandle) {
      const storage = new DiskSoftwareKeyStorage(keysDir);
      const keyPath = join(keysDir, `${identity.keyHandle}.bin`);
      let keyExisted = false;
      try {
        await readFile(keyPath);
        keyExisted = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      await storage.remove(identity.keyHandle);
      result.keyRemoved = keyExisted;
    }
  }
  try {
    await unlink(identityPath);
    result.identityRemoved = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // identity.json already gone — idempotent success.
  }
  return result;
}

// Re-export for the CLI to load identity on startup.
export { InMemorySoftwareKeyStorage };
