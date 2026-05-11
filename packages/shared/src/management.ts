import type { DeskRelayBuildInfo } from "./version.ts";

export const MANAGER_API_VERSION = "2026-05-11";

export type ManagerScope = "server" | "device";
export type ManagerNetworkKind = "local" | "tailscale" | "lan" | "public" | "unknown";

export interface ManagerRouteCapability {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  destructive?: boolean;
}

export interface ManagerCapabilities {
  scope: ManagerScope;
  apiVersion: string;
  build: DeskRelayBuildInfo;
  platform: NodeJS.Platform;
  arch: string;
  features: string[];
  routes: ManagerRouteCapability[];
  behaviorMethods?: string[];
}

export interface ManagerLogResponse {
  scope: ManagerScope;
  source: string;
  path: string;
  exists: boolean;
  tail: number;
  lines: string[];
  truncated: boolean;
  readAt: string;
  error?: string;
}

export interface ManagerProcessComponent {
  name: string;
  pid?: number;
  alive: boolean;
  logPath?: string;
  detail?: string;
}

export interface ManagerProcessStatus {
  scope: ManagerScope;
  kind: "site-server" | "connector-daemon";
  build: DeskRelayBuildInfo;
  pid: number;
  startedAt: string;
  uptimeMs: number;
  platform: NodeJS.Platform;
  arch: string;
  listening?: { host: string; port: number };
  components?: ManagerProcessComponent[];
  autostart?: {
    supported: boolean;
    installed: boolean;
    taskName: string;
    error?: string;
  };
}

export interface ManagerRestartResult {
  supported: boolean;
  accepted: boolean;
  message: string;
  logPath?: string;
  pid?: number;
  error?: string;
}

export interface ManagerNetworkAddress {
  address: string;
  interfaceName?: string;
  family: "IPv4" | "IPv6";
  kind: ManagerNetworkKind;
  internal: boolean;
  url?: string;
}

export interface ManagerNetworkProbe {
  id: string;
  label: string;
  url: string;
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  hint?: string;
}

export interface ManagerNetworkStatus {
  scope: ManagerScope;
  targetId?: string;
  targetLabel?: string;
  generatedAt: string;
  preferredUrl?: string;
  registeredUrl?: string;
  listening?: { host: string; port: number; kind: ManagerNetworkKind };
  tailscale: {
    detected: boolean;
    addresses: string[];
    interfaceNames: string[];
  };
  addresses: ManagerNetworkAddress[];
  probes: ManagerNetworkProbe[];
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}

export interface ManagerInstallStatus {
  scope: ManagerScope;
  targetId?: string;
  targetLabel?: string;
  generatedAt: string;
  build: DeskRelayBuildInfo;
  installed: boolean;
  running: boolean;
  autostart?: {
    supported: boolean;
    installed: boolean;
    taskName: string;
    error?: string;
  };
  update?: {
    state: string;
    updateAvailable?: boolean;
    changed?: boolean;
    error?: string;
  };
  queue?: {
    state: string;
    updatedAt?: string;
    error?: string;
  };
  reports?: Array<{
    id: string;
    receivedAt: string;
    status: string;
    label?: string;
  }>;
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}

export interface ManagerSecurityBoundary {
  scope: ManagerScope;
  targetId?: string;
  targetLabel?: string;
  generatedAt: string;
  tokenBoundary: {
    siteTokenConfigured?: boolean;
    daemonTokenAvailable?: boolean;
    browserReceivesDaemonToken: boolean;
  };
  networkBoundary: {
    url?: string;
    kind: ManagerNetworkKind;
    publicExposure: boolean;
  };
  workspaceBoundary?: {
    mode: string;
    roots: string[];
    unrestricted: boolean;
  };
  warnings: string[];
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}
