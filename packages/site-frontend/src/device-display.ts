import type { Device } from "./api.ts";

export type DeviceDisplayRole = "Server" | "Tailscale" | "LAN" | "Local" | "Remote";

export function deviceDisplayRole(device: Pick<Device, "label" | "daemonUrl">): DeviceDisplayRole {
  const url = parseUrl(device.daemonUrl);
  const host = url?.hostname.replace(/^\[|\]$/g, "").toLowerCase() ?? "";
  const port = url?.port ? Number(url.port) : null;
  const label = device.label.toLowerCase();

  if (port === 18191 || label.startsWith("local dev")) return "Server";
  if (host.startsWith("100.")) return "Tailscale";
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return "Local";
  if (isPrivateIpv4(host)) return "LAN";
  return "Remote";
}

export function deviceDisplayName(device: Pick<Device, "label" | "daemonUrl">): string {
  const role = deviceDisplayRole(device);
  const suffix = ` (${role})`;
  const baseLabel = normalizedBaseLabel(device.label, role);
  return baseLabel.endsWith(suffix) ? baseLabel : `${baseLabel}${suffix}`;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function normalizedBaseLabel(label: string, role: DeviceDisplayRole): string {
  if (role !== "Server") return label;
  const match = label.match(/^Local dev \((.+)\)$/i);
  return match?.[1]?.trim() || label;
}
