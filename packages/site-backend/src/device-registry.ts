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

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Device {
  id: string;
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
    for (const device of initialDevices) {
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
    for (const existing of this.#devices.values()) {
      if (existing.daemonUrl === url) {
        throw new DeviceRegistryError(`device already registered: ${url}`, 409);
      }
    }
    const device: Device = {
      id: randomDeviceId(),
      label: input.label?.trim() || hostFromUrl(url),
      daemonUrl: url,
      ...(input.authToken?.trim() ? { authToken: input.authToken.trim() } : {}),
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
  return items.filter(isDeviceRecord).map((device) => ({
    id: device.id,
    label: device.label,
    daemonUrl: normalizeDaemonUrl(device.daemonUrl),
    ...(device.authToken ? { authToken: device.authToken } : {}),
    registeredAt: device.registeredAt,
  }));
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
    (device.authToken === undefined || typeof device.authToken === "string")
  );
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
