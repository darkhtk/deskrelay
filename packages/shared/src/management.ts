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
  | "repair-registration"
  | "run-worker";
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
  params?: Record<string, unknown>;
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
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedReason?: string;
}

export interface ManagerTaskListResponse {
  tasks: ManagerTask[];
}

export type ManagerWorkerRunStatus = ManagerTaskState | "missing";

export type ManagerWorkerRunIntegrity =
  | "ok"
  | "missing-task"
  | "missing-agent"
  | "orphan-task"
  | "stale-agent"
  | "synthetic-failure"
  | "missing-session";

export interface ManagerWorkerRun {
  id: string;
  status: ManagerWorkerRunStatus;
  integrity: ManagerWorkerRunIntegrity[];
  dryRun: boolean;
  requestedBy?: ManagerTaskRequestedBy;
  taskId?: string;
  roundId?: string;
  agentId?: string;
  agentRole?: string;
  agentLabel?: string;
  profile?: string;
  cwd?: string;
  sessionId?: string;
  command?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  timedOut?: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  outputPreview?: string;
  error?: string;
}

export interface ManagerWorkerRunLedgerSummary {
  total: number;
  running: number;
  succeeded: number;
  failed: number;
  blocked: number;
  stale: number;
  missing: number;
  withSession: number;
  withoutSession: number;
  integrityIssues: number;
}

export interface ManagerWorkerRunLedgerResponse {
  generatedAt: string;
  roundId?: string;
  runs: ManagerWorkerRun[];
  summary: ManagerWorkerRunLedgerSummary;
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

export interface ManagerTaskObservationResponse {
  task: ManagerTask;
  log: ManagerTaskLogResponse;
  terminal: boolean;
  summary: string;
  nextRead: "none" | "task" | "task-log" | "task-stream" | "session-transcript";
}

export type ManagerTaskStreamEvent =
  | { type: "snapshot"; observation: ManagerTaskObservationResponse }
  | { type: "done"; observation: ManagerTaskObservationResponse }
  | { type: "error"; error: string };

export interface ManagerWorkerProfile {
  id: string;
  label: string;
  description: string;
  command: string;
  args: string[];
  checkCommand: string;
  checkArgs: string[];
  available: boolean;
  destructive: boolean;
  defaultTimeoutMs: number;
  runMode: "argument" | "stdin";
  roles: string[];
  risk: "read" | "write" | "destructive" | "system";
}

export interface ManagerWorkerCheckResult {
  profile: string;
  command: string;
  args: string[];
  available: boolean;
  exitCode?: number;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error?: string;
}

export interface ManagerWorkerListResponse {
  generatedAt: string;
  profiles: ManagerWorkerProfile[];
}

export type ManagerAgentRole =
  | "architect"
  | "implementer"
  | "verifier"
  | "critic"
  | "protocol"
  | "documenter"
  | "operator"
  | (string & {});

export type ManagerAgentStatus =
  | "idle"
  | "assigned"
  | "running"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale";

export type ManagerRoundStatus =
  | "planned"
  | "dispatching"
  | "running"
  | "collecting"
  | "reviewing"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface ManagerAgent {
  id: string;
  role: ManagerAgentRole;
  label: string;
  profile: string;
  status: ManagerAgentStatus;
  cwd?: string;
  roundId?: string;
  taskId?: string;
  sessionId?: string;
  lastInstruction?: string;
  lastOutput?: string;
  lastError?: string;
  lastHeartbeatAt?: string;
  lastOutputAt?: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedReason?: string;
}

export interface ManagerAgentCreateRequest {
  role: ManagerAgentRole;
  label?: string;
  profile?: string;
  cwd?: string;
  roundId?: string;
  instruction?: string;
}

export interface ManagerAgentMessageRequest {
  prompt: string;
  profile?: string;
  cwd?: string;
  roundId?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}

export interface ManagerAgentMessageResponse {
  agent: ManagerAgent;
  task: ManagerTask;
}

export interface ManagerAgentListResponse {
  generatedAt: string;
  agents: ManagerAgent[];
}

export interface ManagerRoundAgentAssignment {
  agentId?: string;
  role: ManagerAgentRole;
  label?: string;
  profile?: string;
  cwd?: string;
  prompt: string;
  timeoutMs?: number;
}

export interface ManagerRound {
  id: string;
  title: string;
  objective: string;
  status: ManagerRoundStatus;
  agentIds: string[];
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  error?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedReason?: string;
}

export interface ManagerRoundCreateRequest {
  title?: string;
  objective: string;
  agents?: Array<Omit<ManagerRoundAgentAssignment, "prompt"> & { prompt?: string }>;
}

export interface ManagerRoundDispatchRequest {
  assignments?: ManagerRoundAgentAssignment[];
  dryRun?: boolean;
}

export interface ManagerRoundDispatchResponse {
  round: ManagerRound;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
}

export interface ManagerRoundListResponse {
  generatedAt: string;
  rounds: ManagerRound[];
}

export interface ManagerRoundReportResponse {
  round: ManagerRound;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  summary: string;
}

export type ManagerStateViewTone = "idle" | "running" | "warning" | "error";
export type ManagerStateViewSource = "round" | "task" | "agent" | "status" | "system";
export type ManagerStateCurrentKind = "idle" | "manager" | "worker" | "round" | "task" | "agent";
export type ManagerStateCurrentStatus =
  | "idle"
  | "running"
  | "waiting"
  | "blocked"
  | "failed"
  | "stale"
  | "acknowledged";
export type ManagerStateCurrentAction = "details" | "acknowledge" | "retry" | "cancel" | "refresh";

export interface ManagerStateFreshness {
  source: "poll" | "event" | "cache";
  lastRefreshAt: string;
  lastSignalAt?: string;
  ageMs?: number;
  stale: boolean;
}

export interface ManagerStateCurrent {
  kind: ManagerStateCurrentKind;
  status: ManagerStateCurrentStatus;
  tone: ManagerStateViewTone;
  source: ManagerStateViewSource;
  title: string;
  detail?: string;
  startedAt?: string;
  updatedAt?: string;
  taskId?: string;
  agentId?: string;
  roundId?: string;
  actionable: boolean;
  actions: ManagerStateCurrentAction[];
}

export interface ManagerStateRoundSummary {
  id: string;
  title: string;
  objective: string;
  status: ManagerRoundStatus;
  updatedAt: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  error?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedReason?: string;
  counts: {
    agents: number;
    completedAgents: number;
    runningAgents: number;
    blockedAgents: number;
    tasks: number;
    completedTasks: number;
    runningTasks: number;
    blockedTasks: number;
    failedTasks: number;
  };
}

export interface ManagerStateTaskSummary {
  id: string;
  kind: ManagerTaskKind;
  state: ManagerTaskState;
  requestedBy: ManagerTaskRequestedBy;
  updatedAt: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  targetId?: string;
  targetLabel?: string;
  roundId?: string;
  agentId?: string;
  agentRole?: string;
  stale: boolean;
  staleReason?: string;
  error?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedReason?: string;
}

export interface ManagerStateBlocker {
  id: string;
  kind: "task" | "round" | "agent";
  severity: "warning" | "error";
  message: string;
  detail?: string;
  taskId?: string;
  roundId?: string;
  agentId?: string;
  acknowledgedAt?: string;
}

export interface ManagerAcknowledgeResponse {
  generatedAt: string;
  tasks: ManagerTask[];
  agents: ManagerAgent[];
  rounds: ManagerRound[];
}

export interface ManagerStateViewResponse {
  generatedAt: string;
  freshness: ManagerStateFreshness;
  current: ManagerStateCurrent;
  status: {
    tone: ManagerStateViewTone;
    source: ManagerStateViewSource;
    message: string;
    detail?: string;
  };
  counts: {
    rounds: number;
    activeRounds: number;
    agents: number;
    runningAgents: number;
    blockedAgents: number;
    tasks: number;
    runningTasks: number;
    blockedTasks: number;
    failedTasks: number;
    staleTasks: number;
    blockers: number;
  };
  activeRound?: ManagerStateRoundSummary;
  recentRounds: ManagerStateRoundSummary[];
  runningTasks: ManagerStateTaskSummary[];
  staleTasks: ManagerStateTaskSummary[];
  blockers: ManagerStateBlocker[];
  latestStatus?: ManagerAssistantStatusReport;
}

export interface ManagerAssistantConversationState {
  generatedAt: string;
  conversationId: string;
  sessionId?: string;
  cwd?: string;
  updatedAt?: string;
}

export interface ManagerAssistantConversationStateInput {
  sessionId?: string | null;
  cwd?: string | null;
  reset?: boolean;
}

export type ManagerSessionHygieneCategory =
  | "current_manager"
  | "manager_history"
  | "internal_only"
  | "worker_session"
  | "orphan"
  | "unreadable"
  | "unknown";

export type ManagerSessionHygieneAction = "preserve" | "cleanup";

export interface ManagerSessionHygieneItem {
  deviceId: string;
  deviceLabel: string;
  behaviorInstanceId: string;
  sessionId: string;
  cwd: string;
  title?: string;
  fullTitle?: string;
  modifiedAt?: string;
  fileSize?: number;
  category: ManagerSessionHygieneCategory;
  action: ManagerSessionHygieneAction;
  reason: string;
}

export interface ManagerSessionHygieneSummary {
  total: number;
  preserved: number;
  cleanupCandidates: number;
  currentManagerSession?: string;
  categories: Record<ManagerSessionHygieneCategory, number>;
}

export interface ManagerSessionHygieneReport {
  generatedAt: string;
  managerCwd: string;
  managerSessionId?: string;
  summary: ManagerSessionHygieneSummary;
  items: ManagerSessionHygieneItem[];
  errors: Array<{
    deviceId?: string;
    deviceLabel?: string;
    stage: string;
    error: string;
  }>;
}

export interface ManagerSessionHygieneCleanupRequest {
  dryRun?: boolean;
  categories?: ManagerSessionHygieneCategory[];
}

export interface ManagerSessionHygieneCleanupResponse {
  generatedAt: string;
  dryRun: boolean;
  deleted: Array<{
    deviceId: string;
    deviceLabel: string;
    sessionId: string;
    category: ManagerSessionHygieneCategory;
    result?: unknown;
  }>;
  skipped: ManagerSessionHygieneItem[];
  failures: Array<{
    deviceId: string;
    deviceLabel: string;
    sessionId: string;
    category: ManagerSessionHygieneCategory;
    error: string;
  }>;
  report: ManagerSessionHygieneReport;
}

export interface ManagerAssistantChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}

export interface ManagerAssistantChatContext {
  deviceId?: string;
  deviceLabel?: string;
  deviceConnectionState?: "online" | "offline";
  sessionId?: string;
  sessionTitle?: string;
  cwd?: string;
}

export interface ManagerAssistantDecisionOption {
  key: string;
  label: string;
  detail?: string;
}

export interface ManagerAssistantPendingDecision {
  id: string;
  prompt?: string;
  options: ManagerAssistantDecisionOption[];
  createdAt?: string;
}

export interface ManagerAssistantTaskMemory {
  state:
    | "idle"
    | "planning"
    | "waiting_user_choice"
    | "executing"
    | "verifying"
    | "blocked"
    | "done";
  title?: string;
  updatedAt?: string;
}

export interface ManagerAssistantStructuredState {
  sessionId?: string;
  lastAssistantText?: string;
  pendingDecision?: ManagerAssistantPendingDecision;
  task?: ManagerAssistantTaskMemory;
  facts?: string[];
  decisions?: string[];
  openQuestions?: string[];
}

export interface ManagerAssistantChatRequest {
  message: string;
  history?: ManagerAssistantChatMessage[];
  context?: ManagerAssistantChatContext;
  assistantState?: ManagerAssistantStructuredState;
}

export interface ManagerAssistantChatResponse {
  message: ManagerAssistantChatMessage;
  cwd: string;
  command: string;
  durationMs: number;
  sessionId?: string;
}

export type ManagerAssistantStreamTone = "context" | "thinking" | "warning";

export type ManagerAssistantStreamPhase =
  | "preparing"
  | "running"
  | "tool"
  | "api"
  | "finalizing"
  | "error";

export interface ManagerAssistantStreamStatus {
  phase: ManagerAssistantStreamPhase;
  tone: ManagerAssistantStreamTone;
  main: string;
  detail?: string;
}

export type ManagerAssistantStreamEvent =
  | { type: "status"; status: ManagerAssistantStreamStatus }
  | { type: "claude_event"; event: unknown }
  | {
      type: "message";
      message: ManagerAssistantChatMessage;
      cwd: string;
      command: string;
      durationMs: number;
      sessionId?: string;
    }
  | { type: "error"; error: string };

export type ManagerAssistantStatusReportPhase =
  | "observing"
  | "deciding"
  | "acting"
  | "verifying"
  | "blocked"
  | "reporting"
  | "done";

export type ManagerAssistantStatusReportLevel = "info" | "success" | "warning" | "error";

export interface ManagerAssistantStatusReportInput {
  message: string;
  phase?: ManagerAssistantStatusReportPhase;
  level?: ManagerAssistantStatusReportLevel;
  detail?: string;
  round?: string;
  scope?: string;
}

export interface ManagerAssistantStatusReport extends ManagerAssistantStatusReportInput {
  id: string;
  createdAt: string;
  phase: ManagerAssistantStatusReportPhase;
  level: ManagerAssistantStatusReportLevel;
}

export interface ManagerAssistantStatusReportResponse {
  generatedAt: string;
  reports: ManagerAssistantStatusReport[];
  latest?: ManagerAssistantStatusReport;
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

export interface ManagerEventSnapshot {
  rounds: ManagerRound[];
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  status?: ManagerAssistantStatusReportResponse;
  hygiene?: ManagerSessionHygieneReport;
}

export type ManagerEventInput =
  | { type: "snapshot"; snapshot: ManagerEventSnapshot }
  | { type: "round.created"; round: ManagerRound }
  | { type: "round.updated"; round: ManagerRound }
  | { type: "agent.created"; agent: ManagerAgent }
  | { type: "agent.updated"; agent: ManagerAgent }
  | { type: "task.created"; task: ManagerTask }
  | { type: "task.updated"; task: ManagerTask }
  | { type: "assistant.status"; report: ManagerAssistantStatusReport }
  | { type: "hygiene.updated"; report: ManagerSessionHygieneReport }
  | { type: "heartbeat" };

export type ManagerEvent = ManagerEventInput & {
  id: string;
  seq: number;
  generatedAt: string;
};

export interface ManagerEventListResponse {
  generatedAt: string;
  lastSeq: number;
  events: ManagerEvent[];
}
