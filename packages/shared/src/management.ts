import type { DiagnosticStep } from "./diagnostics.ts";
import type { DeskRelayBuildInfo } from "./version.ts";

export const MANAGER_API_VERSION = "2026-05-11";

export type ManagerScope = "server" | "device";
export type ManagerNetworkKind = "local" | "tailscale" | "lan" | "public" | "unknown";
export type ManagerTaskKind =
  | "diagnose"
  | "update-server"
  | "update-device"
  | "update-all"
  | "restart-server"
  | "restart-device"
  | "repair-registration";
export type ManagerTaskState =
  | "pending"
  | "running"
  | "blocked"
  | "waiting_for_device"
  | "restart_required"
  | "succeeded"
  | "failed"
  | "cancelled";
export type ManagerTaskRequestedBy = "browser" | "manager-assistant" | "system";

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

export interface ManagerTaskRequest {
  kind: ManagerTaskKind;
  targetId?: string;
  dryRun?: boolean;
  requestedBy?: ManagerTaskRequestedBy;
  params?: Record<string, unknown>;
}

export interface ManagerTask {
  id: string;
  kind: ManagerTaskKind;
  targetId?: string;
  targetLabel?: string;
  state: ManagerTaskState;
  dryRun: boolean;
  requestedBy: ManagerTaskRequestedBy;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  steps: DiagnosticStep[];
  result?: unknown;
  error?: string;
}

export interface ManagerTaskListResponse {
  tasks: ManagerTask[];
}

export interface ManagerAuditLogResponse {
  entries: ManagerTask[];
}

export interface ManagerTaskLogResponse {
  taskId: string;
  source: "manager-task";
  readAt: string;
  lines: string[];
  steps: DiagnosticStep[];
  result?: unknown;
  error?: string;
}

export interface ManagerActionDescriptor {
  id: string;
  label: string;
  enabled: boolean;
  method?: ManagerRouteCapability["method"];
  path?: string;
  taskKind?: ManagerTaskKind;
  destructive?: boolean;
  reason?: string;
}

export interface ManagerDeviceActions {
  generatedAt: string;
  deviceId: string;
  label: string;
  actions: ManagerActionDescriptor[];
}

export interface ManagerUpdatePlanItem {
  scope: ManagerScope;
  targetId?: string;
  targetLabel?: string;
  action: "none" | "update" | "queue" | "restart" | "blocked" | "unknown";
  state?: string;
  reason: string;
}

export interface ManagerUpdatePlan {
  generatedAt: string;
  items: ManagerUpdatePlanItem[];
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}

export interface ManagerUpdateTargetStatus {
  scope: ManagerScope;
  targetId?: string;
  targetLabel?: string;
  state: string;
  updateAvailable?: boolean;
  changed?: boolean;
  error?: string;
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}

export interface ManagerUpdateStatus {
  generatedAt: string;
  server: ManagerUpdateTargetStatus;
  devices: ManagerUpdateTargetStatus[];
  plan: ManagerUpdatePlan;
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}

export interface ManagerRegistrationFailureAnalysis {
  generatedAt: string;
  found: boolean;
  reportId?: string;
  receivedAt?: string;
  status?: string;
  label?: string;
  failureStep?: DiagnosticStep;
  classification?: string;
  retrySafe?: boolean;
  action?: string;
}

export interface ManagerRegistrationDiagnosis {
  generatedAt: string;
  serverUrl?: string;
  siteTokenConfigured: boolean;
  tailscaleDetected: boolean;
  steps: DiagnosticStep[];
  lastFailure: ManagerRegistrationFailureAnalysis;
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}

export interface ManagerSecurityBoundarySummary {
  generatedAt: string;
  server: ManagerSecurityBoundary;
  devices: ManagerSecurityBoundary[];
  warnings: string[];
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}

export interface ManagerDeviceSummary {
  id: string;
  label: string;
  daemonUrl: string;
  registeredAt: string;
  lastSeenAt?: string;
  os?: string;
  hostname?: string;
  connectionState?: "online" | "offline";
}

export interface ManagerSystemSummary {
  generatedAt: string;
  build: DeskRelayBuildInfo;
  devices: ManagerDeviceSummary[];
  server: {
    install: ManagerInstallStatus;
    network: ManagerNetworkStatus;
    security: ManagerSecurityBoundary;
  };
  update: ManagerUpdatePlan;
  registration: ManagerRegistrationFailureAnalysis;
  recentTasks: ManagerTask[];
  summary: {
    severity: "ok" | "warn" | "error" | "unknown";
    message: string;
  };
}
