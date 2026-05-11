import type { DeskRelayBuildInfo } from "./version.ts";

export const MANAGER_API_VERSION = "2026-05-11";

export type ManagerScope = "server" | "device";

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
