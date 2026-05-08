// DeviceRegistry — the site's authoritative list of "devices" the user
// owns. Self-host can persist this list to disk so registered PCs survive
// backend restarts.
//
// A "device" in M2 = a daemon URL the site can reach via HTTP. It carries
// a stable id (random UUID-like) the browser uses for routing, plus a
// human label.
//
// In M5 (WebRTC P2P) "device" gains an Ed25519 public key + last-seen
// timestamp; the daemon URL goes away because the site never connects to
// the daemon directly anymore.

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Device {
  id: string;
  /** Stable internal identity for de-duplicating the same connector across URL/port changes. */
  deviceKey?: string;
  /** Human label, defaults to the host portion of the URL. */
  label: string;
  /** Daemon URL, e.g. "http://127.0.0.1:18091". No trailing slash. */
  daemonUrl: string;
  /** Bearer token used by the site backend when proxying to this daemon. */
  authToken?: string;
  registeredAt: string;
}

export interface RegisterDeviceInput {
  daemonUrl: string;
  label?: string;
  authToken?: string;
  deviceKey?: string;
}

export class DeviceRegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DeviceRegistryError";
  }
}

export interface DeviceRegistry {
  list(): Device[];
  get(id: string): Device | undefined;
  register(input: RegisterDeviceInput): Device;
  unregister(id: string): boolean;
  /** Update the human label. Returns the updated device or undefined if the
   *  id is unknown. Throws DeviceRegistryError for invalid labels. */
  rename(id: string, label: string): Device | undefined;
}

export class InMemoryDeviceRegistry implements DeviceRegistry {
  readonly #devices = new Map<string, Device>();

  constructor(initialDevices: Device[] = []) {
    for (const device of normalizeDeviceList(initialDevices)) {
      this.#devices.set(device.id, device);
    }
  }

  list(): Device[] {
    return [...this.#devices.values()];
  }

  get(id: string): Device | undefined {
    return this.#devices.get(id);
  }

  register(input: RegisterDeviceInput): Device {
    const url = normalizeDaemonUrl(input.daemonUrl);
    const authToken = input.authToken?.trim();
    const deviceKey = normalizeDeviceKey(input.deviceKey) ?? deriveDeviceKey(url, authToken);
    for (const existing of this.#devices.values()) {
      if (existing.deviceKey === deviceKey || existing.daemonUrl === url) {
        const updated: Device = {
          ...existing,
          deviceKey,
          label: input.label?.trim() || existing.label,
          daemonUrl: url,
          ...(authToken ? { authToken } : {}),
          registeredAt: new Date().toISOString(),
        };
        this.#devices.set(existing.id, updated);
        return updated;
      }
    }
    const device: Device = {
      id: randomDeviceId(),
      deviceKey,
      label: input.label?.trim() || hostFromUrl(url),
      daemonUrl: url,
      ...(authToken ? { authToken } : {}),
      registeredAt: new Date().toISOString(),
    };
    this.#devices.set(device.id, device);
    return device;
  }

  unregister(id: string): boolean {
    return this.#devices.delete(id);
  }

  rename(id: string, label: string): Device | undefined {
    const trimmed = label.trim();
    if (!trimmed) {
      throw new DeviceRegistryError("label must not be empty", 400);
    }
    if (trimmed.length > 80) {
      throw new DeviceRegistryError("label is too long (max 80 chars)", 400);
    }
    const device = this.#devices.get(id);
    if (!device) return undefined;
    const updated: Device = { ...device, label: trimmed };
    this.#devices.set(id, updated);
    return updated;
  }
}

export class JsonFileDeviceRegistry extends InMemoryDeviceRegistry {
  constructor(readonly filePath: string) {
    super(readDevicesFile(filePath));
  }

  register(input: RegisterDeviceInput): Device {
    const device = super.register(input);
    this.#save();
    return device;
  }

  unregister(id: string): boolean {
    const removed = super.unregister(id);
    if (removed) this.#save();
    return removed;
  }

  rename(id: string, label: string): Device | undefined {
    const updated = super.rename(id, label);
    if (updated) this.#save();
    return updated;
  }

  #save(): void {
    writeDevicesFile(this.filePath, this.list());
  }
}

export function normalizeDaemonUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DeviceRegistryError(`invalid daemonUrl: ${raw}`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DeviceRegistryError(
      `daemonUrl must be http:// or https:// (got ${url.protocol})`,
      400,
    );
  }
  // Drop trailing slash and any query/hash so the registry's uniqueness
  // check works on canonical form.
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

function readDevicesFile(path: string): Device[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(raw) as unknown;
  const items = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { devices?: unknown }).devices)
      ? (parsed as { devices: unknown[] }).devices
      : [];
  return normalizeDeviceList(items.filter(isDeviceRecord));
}

function writeDevicesFile(path: string, devices: Device[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ devices }, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function isDeviceRecord(value: unknown): value is Device {
  if (typeof value !== "object" || value === null) return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device.id === "string" &&
    typeof device.label === "string" &&
    typeof device.daemonUrl === "string" &&
    typeof device.registeredAt === "string" &&
    (device.deviceKey === undefined || typeof device.deviceKey === "string") &&
    (device.authToken === undefined || typeof device.authToken === "string")
  );
}

function normalizeDeviceList(devices: Device[]): Device[] {
  const deduped: Device[] = [];
  for (const input of devices) {
    const normalized = normalizeDeviceRecord(input);
    const existingIndex = deduped.findIndex(
      (device) =>
        device.deviceKey === normalized.deviceKey || device.daemonUrl === normalized.daemonUrl,
    );
    if (existingIndex === -1) {
      deduped.push(normalized);
      continue;
    }
    deduped[existingIndex] = mergeDevices(deduped[existingIndex]!, normalized);
  }
  return deduped;
}

function normalizeDeviceRecord(device: Device): Device {
  const daemonUrl = normalizeDaemonUrl(device.daemonUrl);
  const authToken = device.authToken?.trim();
  const deviceKey = normalizeDeviceKey(device.deviceKey) ?? deriveDeviceKey(daemonUrl, authToken);
  return {
    id: device.id,
    deviceKey,
    label: device.label,
    daemonUrl,
    ...(authToken ? { authToken } : {}),
    registeredAt: device.registeredAt,
  };
}

function mergeDevices(existing: Device, incoming: Device): Device {
  const newer = isNewerDevice(incoming, existing) ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  return {
    ...older,
    ...newer,
    deviceKey: newer.deviceKey ?? older.deviceKey ?? deriveDeviceKey(newer.daemonUrl, newer.authToken),
    daemonUrl: newer.daemonUrl,
    ...(newer.authToken ? { authToken: newer.authToken } : {}),
  };
}

function isNewerDevice(left: Device, right: Device): boolean {
  const leftTime = Date.parse(left.registeredAt);
  const rightTime = Date.parse(right.registeredAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime >= rightTime;
  if (Number.isFinite(leftTime)) return true;
  if (Number.isFinite(rightTime)) return false;
  return true;
}

function normalizeDeviceKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function deriveDeviceKey(daemonUrl: string, authToken: string | undefined): string {
  if (authToken) return `auth:${sha256(authToken)}`;
  return `url:${daemonUrl}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function randomDeviceId(): string {
  return `dev_${randomBytes(8).toString("hex")}`;
}
