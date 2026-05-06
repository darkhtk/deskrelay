// DeviceRegistry — the site's authoritative list of "devices" the user
// owns. The self-host backend stores them in process memory.
//
// A "device" in M2 = a daemon URL the site can reach via HTTP. It carries
// a stable id (random UUID-like) the browser uses for routing, plus a
// human label.
//
// In M5 (WebRTC P2P) "device" gains an Ed25519 public key + last-seen
// timestamp; the daemon URL goes away because the site never connects to
// the daemon directly anymore.

import { randomBytes } from "node:crypto";

export interface Device {
  id: string;
  /** Human label, defaults to the host portion of the URL. */
  label: string;
  /** Daemon URL, e.g. "http://127.0.0.1:18091". No trailing slash. */
  daemonUrl: string;
  registeredAt: string;
}

export interface RegisterDeviceInput {
  daemonUrl: string;
  label?: string;
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

function normalizeDaemonUrl(raw: string): string {
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
