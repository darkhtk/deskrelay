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
  state?: "ok" | "warn" | "error" | "skipped" | "unknown";
  classification?: string;
  status?: number;
  latencyMs?: number;
  error?: string;
  hint?: string;
  retrySafe?: boolean;
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
  projectId?: string;
  dryRun?: boolean;
  requestedBy?: ManagerTaskRequestedBy;
  params?: Record<string, unknown>;
}

export interface ManagerTask {
  id: string;
  kind: ManagerTaskKind;
  projectId?: string;
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
  projectId?: string;
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

export type ManagerRoundHealthStatus = "healthy" | "warning" | "blocked" | "unknown";
export type ManagerRoundHealthIssueSeverity = "warning" | "blocked";
export type ManagerRoundHealthIssueCode =
  | "no-round"
  | "no-agents"
  | "missing-agent"
  | "agent-without-task"
  | "task-without-agent"
  | "worker-running"
  | "worker-failed"
  | "worker-blocked"
  | "worker-missing"
  | "worker-timeout"
  | "worker-integrity"
  | "missing-session"
  | "round-failed"
  | "round-completed-incomplete";

export interface ManagerRoundHealthIssue {
  code: ManagerRoundHealthIssueCode;
  severity: ManagerRoundHealthIssueSeverity;
  message: string;
  detail?: string;
  agentId?: string;
  taskId?: string;
  role?: string;
  action?: "wait" | "retry-worker" | "inspect-worker" | "repair-round" | "acknowledge";
}

export interface ManagerRoundHealthGate {
  generatedAt: string;
  roundId: string;
  status: ManagerRoundHealthStatus;
  title: string;
  summary: string;
  expectedAgents: number;
  expectedTasks: number;
  actualRuns: number;
  completedRuns: number;
  runningRuns: number;
  blockedRuns: number;
  missingRuns: number;
  issues: ManagerRoundHealthIssue[];
}

export interface ManagerRoundHealthGateResponse {
  gate: ManagerRoundHealthGate;
}

export interface ManagerRoundRepairResponse {
  round: ManagerRound;
  gate: ManagerRoundHealthGate;
  changed: boolean;
  changes: string[];
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

export type ManagerProjectStatus =
  | "planning"
  | "running"
  | "blocked"
  | "reviewing"
  | "completed"
  | "archived";

export type ManagerCommandFlowStage =
  | "draft"
  | "protocol_ready"
  | "ready_to_start"
  | "running"
  | "review"
  | "replanning"
  | "completed"
  | "archived";

export type ManagerRoundPhase =
  | "design"
  | "implementation"
  | "feedback"
  | "verification"
  | "replan";

export type ManagerProjectRecordAuthor = "browser" | "manager" | "system";

export interface ManagerProjectCharter {
  goal: string;
  scope: string;
  nonGoals: string;
  constraints: string;
  successCriteria: string;
  preferredApproach: string;
  verificationPlan: string;
  userCheckpoints: string;
  finalDeliverables: string;
  updatedAt?: string;
  updatedBy?: ManagerProjectRecordAuthor;
}

export interface ManagerProjectDirectionChange {
  previousDirection: string;
  requestedChange: string;
  impact: string;
  affectedProtocol: string;
  affectedArtifacts: string;
  decisionId?: string;
  nextRoundId?: string;
  changedAt: string;
  changedBy: ManagerProjectRecordAuthor;
}

export interface ManagerProjectFinalReview {
  summary: string;
  goalMatched: boolean;
  acceptedByUser: boolean;
  remainingRisks: string;
  verificationEvidence: string;
  artifacts: string[];
  completedAt: string;
  completedBy: ManagerProjectRecordAuthor;
}

export interface ManagerProject {
  id: string;
  name: string;
  cwd: string;
  goal: string;
  status: ManagerProjectStatus;
  flowStage?: ManagerCommandFlowStage;
  charter?: ManagerProjectCharter;
  wizardEvents?: ManagerWizardIntentEvent[];
  lastDirectionChange?: ManagerProjectDirectionChange;
  finalReview?: ManagerProjectFinalReview;
  createdAt: string;
  updatedAt: string;
  activeRoundId?: string;
  summary?: string;
  archivedAt?: string;
  error?: string;
}

export type ManagerProjectProtocolSource = "base-copy" | "blank";

export type ManagerWizardIntentEventKind =
  | "charter-applied"
  | "direction-change-requested"
  | "checkpoint-requested"
  | "protocol-source-changed"
  | "readiness-refresh-requested";

export type ManagerWizardIntentImpact = "low" | "medium" | "high" | "unknown";

export type ManagerWizardIntentAction =
  | "record"
  | "refresh-readiness"
  | "continue"
  | "replan"
  | "pause"
  | "ask-human";

export interface ManagerWizardIntentFieldChange {
  field: string;
  before?: string;
  after: string;
}

export interface ManagerWizardIntentEvent {
  id: string;
  projectId: string;
  roundId?: string;
  source: "wizard";
  changedBy: "human";
  kind: ManagerWizardIntentEventKind;
  fields: ManagerWizardIntentFieldChange[];
  impact: ManagerWizardIntentImpact;
  managerAction: ManagerWizardIntentAction;
  note?: string;
  createdAt: string;
  acknowledgedAt?: string;
}

export interface ManagerWizardIntentEventInput {
  kind: ManagerWizardIntentEventKind;
  fields: ManagerWizardIntentFieldChange[];
  impact?: ManagerWizardIntentImpact;
  managerAction?: ManagerWizardIntentAction;
  note?: string;
  roundId?: string;
}

export interface ManagerProjectCreateRequest {
  cwd: string;
  name?: string;
  goal?: string;
  status?: ManagerProjectStatus;
  activeRoundId?: string;
  protocolSource?: ManagerProjectProtocolSource;
  charter?: Partial<ManagerProjectCharter>;
  flowStage?: ManagerCommandFlowStage;
  wizardEvent?: ManagerWizardIntentEventInput;
}

export interface ManagerProjectUpdateRequest {
  cwd?: string;
  name?: string;
  goal?: string;
  status?: ManagerProjectStatus;
  flowStage?: ManagerCommandFlowStage;
  charter?: Partial<ManagerProjectCharter> | null;
  lastDirectionChange?: ManagerProjectDirectionChange | null;
  finalReview?: ManagerProjectFinalReview | null;
  activeRoundId?: string | null;
  summary?: string | null;
  error?: string | null;
  wizardEvent?: ManagerWizardIntentEventInput;
}

export interface ManagerProjectCorruptRecord {
  id: string;
  path: string;
  error: string;
}

export interface ManagerProjectListResponse {
  generatedAt: string;
  projects: ManagerProject[];
  archived: ManagerProject[];
  corrupt: ManagerProjectCorruptRecord[];
}

export interface ManagerProjectResponse {
  generatedAt: string;
  project: ManagerProject;
}

export interface ManagerProjectOpenFolderResponse {
  generatedAt: string;
  projectId: string;
  cwd: string;
  command: string;
  args: string[];
  dryRun?: boolean;
}

export interface ManagerProjectCharterUpdateRequest {
  goal?: string;
  scope?: string;
  nonGoals?: string;
  constraints?: string;
  successCriteria?: string;
  preferredApproach?: string;
  verificationPlan?: string;
  userCheckpoints?: string;
  finalDeliverables?: string;
  updatedBy?: ManagerProjectRecordAuthor;
  wizardEvent?: ManagerWizardIntentEventInput;
}

export interface ManagerProjectCharterResponse {
  generatedAt: string;
  projectId: string;
  charter: ManagerProjectCharter;
  project: ManagerProject;
}

export type ManagerDecisionStatus = "active" | "superseded" | "archived";

export type ManagerDecisionAuthor = "manager" | "browser" | "system";

export interface ManagerDecisionRevision {
  id: string;
  title: string;
  detail: string;
  rationale?: string | undefined;
  status: ManagerDecisionStatus;
  tags: string[];
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  createdAt: string;
  createdBy: ManagerDecisionAuthor;
}

export interface ManagerDecision {
  id: string;
  projectId: string;
  title: string;
  detail: string;
  rationale?: string | undefined;
  status: ManagerDecisionStatus;
  tags: string[];
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  createdAt: string;
  updatedAt: string;
  createdBy: ManagerDecisionAuthor;
  revisions: ManagerDecisionRevision[];
}

export interface ManagerDecisionCreateRequest {
  title: string;
  detail: string;
  rationale?: string;
  status?: ManagerDecisionStatus;
  tags?: string[];
  roundId?: string;
  agentId?: string;
  taskId?: string;
  createdBy?: ManagerDecisionAuthor;
}

export interface ManagerDecisionUpdateRequest {
  title?: string;
  detail?: string;
  rationale?: string | null;
  status?: ManagerDecisionStatus;
  tags?: string[];
  roundId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
}

export interface ManagerDecisionListResponse {
  generatedAt: string;
  projectId: string;
  decisions: ManagerDecision[];
  archived: ManagerDecision[];
}

export interface ManagerDecisionResponse {
  generatedAt: string;
  decision: ManagerDecision;
}

export type ManagerBlockerSeverity = "info" | "warning" | "error";

export type ManagerBlockerRequiredAction = "user" | "manager" | "worker" | "none";

export type ManagerBlockerStatus = "open" | "resolved" | "dismissed";

export type ManagerBlockerSource = "manager" | "browser" | "worker" | "system";

export interface ManagerBlocker {
  id: string;
  projectId: string;
  title: string;
  detail?: string | undefined;
  severity: ManagerBlockerSeverity;
  owner: string;
  requiredAction: ManagerBlockerRequiredAction;
  status: ManagerBlockerStatus;
  source: ManagerBlockerSource;
  dedupeKey?: string | undefined;
  resolution?: string | undefined;
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | undefined;
}

export interface ManagerBlockerCreateRequest {
  title: string;
  detail?: string;
  severity?: ManagerBlockerSeverity;
  owner?: string;
  requiredAction?: ManagerBlockerRequiredAction;
  source?: ManagerBlockerSource;
  dedupeKey?: string;
  roundId?: string;
  agentId?: string;
  taskId?: string;
}

export interface ManagerBlockerResolveRequest {
  resolution?: string;
  status?: "resolved" | "dismissed";
}

export interface ManagerBlockerListResponse {
  generatedAt: string;
  projectId: string;
  blockers: ManagerBlocker[];
  resolved: ManagerBlocker[];
}

export interface ManagerBlockerResponse {
  generatedAt: string;
  blocker: ManagerBlocker;
  created?: boolean;
}

export type ManagerArtifactStatus = "active" | "draft" | "obsolete" | "failed" | "missing";

export type ManagerArtifactKind =
  | "protocol"
  | "report"
  | "code"
  | "config"
  | "log"
  | "document"
  | "unknown";

export type ManagerArtifactSource = "manager" | "browser" | "worker" | "system" | "scan";

export interface ManagerArtifact {
  id: string;
  projectId: string;
  path: string;
  kind: ManagerArtifactKind;
  status: ManagerArtifactStatus;
  owner: string;
  source: ManagerArtifactSource;
  note?: string | undefined;
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  discoveredAt: string;
  updatedAt: string;
}

export interface ManagerArtifactUpsertInput {
  path: string;
  kind?: ManagerArtifactKind;
  status?: ManagerArtifactStatus;
  owner?: string;
  source?: ManagerArtifactSource;
  note?: string;
  roundId?: string;
  agentId?: string;
  taskId?: string;
}

export interface ManagerArtifactScanRequest {
  limit?: number;
}

export interface ManagerArtifactUpdateRequest {
  kind?: ManagerArtifactKind;
  status?: ManagerArtifactStatus;
  owner?: string;
  note?: string | null;
}

export interface ManagerArtifactListResponse {
  generatedAt: string;
  projectId: string;
  artifacts: ManagerArtifact[];
  inactive: ManagerArtifact[];
}

export interface ManagerArtifactScanResponse {
  generatedAt: string;
  projectId: string;
  artifacts: ManagerArtifact[];
  inactive: ManagerArtifact[];
  created: number;
  updated: number;
  unchanged: number;
}

export interface ManagerArtifactResponse {
  generatedAt: string;
  artifact: ManagerArtifact;
}

export type ManagerProtocolFileStatus = "present" | "missing" | "too_large" | "error";

export type ManagerProtocolFileRole =
  | "orchestration"
  | "agents"
  | "protocol"
  | "review"
  | "tasks"
  | "state"
  | "failures"
  | "project"
  | "other";

export interface ManagerProtocolFile {
  path: string;
  role: ManagerProtocolFileRole;
  status: ManagerProtocolFileStatus;
  sizeBytes?: number;
  modifiedAt?: string;
  excerpt?: string;
  error?: string;
}

export interface ManagerProtocolChange {
  summary: string;
  decisionId?: string;
  roundId?: string;
  changedAt: string;
}

export interface ManagerProtocolState {
  projectId: string;
  version: string;
  activeRules: string[];
  files: ManagerProtocolFile[];
  latestChange?: ManagerProtocolChange;
  scannedAt: string;
  warnings: string[];
}

export interface ManagerProtocolMetadata {
  projectId: string;
  version: string;
  activeRules: string[];
  latestChange?: ManagerProtocolChange;
  updatedAt: string;
}

export interface ManagerProtocolScanRequest {
  includeExcerpt?: boolean;
  limit?: number;
}

export interface ManagerProtocolUpdateRequest {
  version?: string;
  activeRules?: string[];
  latestChange?: {
    summary: string;
    decisionId?: string;
    roundId?: string;
  } | null;
}

export interface ManagerProtocolResponse {
  generatedAt: string;
  projectId: string;
  protocol: ManagerProtocolState;
}

export type ManagerProjectOverviewTone = "idle" | "running" | "success" | "warning" | "error";

export type ManagerProjectNextActionKind =
  | "create-round"
  | "dispatch"
  | "wait"
  | "inspect"
  | "repair"
  | "review"
  | "summarize";

export interface ManagerProjectOverviewSignal {
  tone: ManagerProjectOverviewTone;
  title: string;
  detail?: string | undefined;
  updatedAt?: string | undefined;
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
}

export interface ManagerProjectOverviewAction {
  kind: ManagerProjectNextActionKind;
  label: string;
  detail?: string | undefined;
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
}

export interface ManagerProjectOverviewCounts {
  rounds: number;
  agents: number;
  runningAgents: number;
  completedAgents: number;
  blockedAgents: number;
  tasks: number;
  runningTasks: number;
  failedTasks: number;
  workerRuns: number;
  artifacts: number;
}

export interface ManagerProjectOverviewResponse {
  generatedAt: string;
  project: ManagerProject;
  counts: ManagerProjectOverviewCounts;
  currentSignal: ManagerProjectOverviewSignal;
  nextAction: ManagerProjectOverviewAction;
  recentSignals: ManagerProjectOverviewSignal[];
  activeRound?: ManagerRound | undefined;
  lastUpdateAt?: string | undefined;
}

export type ManagerProjectHygieneIssueKind =
  | "missing-task"
  | "missing-agent"
  | "orphan-task"
  | "stale-agent"
  | "synthetic-failure"
  | "missing-session"
  | "missing-active-round"
  | "archived-active-state";

export type ManagerProjectHygieneCleanupAction = "none" | "create-blocker";

export interface ManagerProjectHygieneIssue {
  id: string;
  projectId: string;
  kind: ManagerProjectHygieneIssueKind;
  severity: ManagerBlockerSeverity;
  title: string;
  detail?: string | undefined;
  cleanupAction: ManagerProjectHygieneCleanupAction;
  cleanupEligible: boolean;
  protected: boolean;
  dedupeKey?: string | undefined;
  blockerId?: string | undefined;
  runId?: string | undefined;
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  updatedAt?: string | undefined;
}

export interface ManagerProjectHygieneSummary {
  total: number;
  warnings: number;
  errors: number;
  cleanupCandidates: number;
  protected: number;
  recordedBlockers: number;
  categories: Record<ManagerProjectHygieneIssueKind, number>;
}

export interface ManagerProjectHygieneReport {
  generatedAt: string;
  projectId: string;
  project: ManagerProject;
  summary: ManagerProjectHygieneSummary;
  issues: ManagerProjectHygieneIssue[];
  workerRuns: ManagerWorkerRunLedgerSummary;
}

export interface ManagerProjectHygieneCleanupRequest {
  dryRun?: boolean;
  createBlockers?: boolean;
  issueIds?: string[];
}

export interface ManagerProjectHygieneCleanupResponse {
  generatedAt: string;
  projectId: string;
  dryRun: boolean;
  created: ManagerBlocker[];
  existing: ManagerBlocker[];
  skipped: ManagerProjectHygieneIssue[];
  failures: Array<{
    issueId: string;
    error: string;
  }>;
  report: ManagerProjectHygieneReport;
}

export interface ManagerAgent {
  id: string;
  projectId?: string;
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
  projectId?: string;
  role: ManagerAgentRole;
  label?: string;
  profile?: string;
  cwd?: string;
  roundId?: string;
  instruction?: string;
}

export interface ManagerAgentMessageRequest {
  prompt: string;
  projectId?: string;
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
  projectId?: string;
  title: string;
  objective: string;
  phase?: ManagerRoundPhase;
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
  projectId?: string;
  title?: string;
  objective: string;
  phase?: ManagerRoundPhase;
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

export type ManagerEvidenceType =
  | "worker-run"
  | "agent-output"
  | "artifact"
  | "protocol"
  | "decision"
  | "blocker"
  | "log"
  | "user-check";

export type ManagerEvidenceStatus = "valid" | "stale" | "failed" | "missing";

export interface ManagerEvidenceItem {
  id: string;
  projectId: string;
  roundId?: string;
  agentId?: string;
  taskId?: string;
  type: ManagerEvidenceType;
  label: string;
  detail: string;
  ref?: string;
  excerpt?: string;
  status: ManagerEvidenceStatus;
  createdAt: string;
  updatedAt?: string;
}

export type ManagerAgentResultVerdict = "pass" | "caution" | "fail" | "needs_user_check";

export interface ManagerAgentResult {
  id: string;
  projectId: string;
  roundId?: string;
  agentId?: string;
  taskId?: string;
  role: ManagerAgentRole;
  assignment: string;
  summary: string;
  findings: string[];
  changedFiles: string[];
  risks: string[];
  blockers: string[];
  evidenceIds: string[];
  nextRequest: string;
  confidence: "low" | "medium" | "high";
  verdict: ManagerAgentResultVerdict;
  createdAt: string;
  updatedAt: string;
}

export type ManagerProtocolTraceResult = "applied" | "skipped" | "violated" | "unclear";

export interface ManagerProtocolTrace {
  id: string;
  projectId: string;
  roundId?: string;
  ruleId: string;
  sourceFile: string;
  appliedByAgentId?: string;
  evidenceIds: string[];
  result: ManagerProtocolTraceResult;
  detail: string;
}

export type ManagerJudgmentVerdict =
  | "continue"
  | "retry"
  | "direction_change"
  | "user_check"
  | "complete"
  | "blocked"
  | "wait";

export type ManagerJudgmentPriority = "silent" | "notice" | "approval";

export type ManagerProposedActionType =
  | "wait"
  | "prepare_project"
  | "scan_protocol"
  | "inspect_task"
  | "retry_task"
  | "repair_round"
  | "review_round"
  | "start_next_round"
  | "start_toolchain_setup"
  | "direction_change"
  | "request_user_check"
  | "complete_project";

export type ManagerProposedActionRisk = "low" | "medium" | "high";

export interface ManagerProposedAction {
  id: string;
  projectId: string;
  roundId?: string;
  agentId?: string;
  taskId?: string;
  type: ManagerProposedActionType;
  risk: ManagerProposedActionRisk;
  requiresApproval: boolean;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  evidenceIds: string[];
  agentResultIds: string[];
  protocolTraceIds: string[];
}

export interface ManagerJudgmentPacket {
  id: string;
  projectId: string;
  roundId?: string;
  verdict: ManagerJudgmentVerdict;
  priority: ManagerJudgmentPriority;
  confidence: "low" | "medium" | "high";
  summary: string;
  reason: string;
  evidenceIds: string[];
  agentResultIds: string[];
  protocolTraceIds: string[];
  proposedActions: ManagerProposedAction[];
  createdAt: string;
  expiresAt?: string;
}

export interface ManagerEvidenceListResponse {
  generatedAt: string;
  projectId: string;
  evidence: ManagerEvidenceItem[];
}

export interface ManagerAgentResultListResponse {
  generatedAt: string;
  projectId?: string;
  roundId: string;
  results: ManagerAgentResult[];
  evidence: ManagerEvidenceItem[];
}

export interface ManagerProtocolTraceResponse {
  generatedAt: string;
  projectId: string;
  trace: ManagerProtocolTrace[];
  evidence: ManagerEvidenceItem[];
}

export interface ManagerJudgmentListResponse {
  generatedAt: string;
  projectId: string;
  judgments: ManagerJudgmentPacket[];
  evidence: ManagerEvidenceItem[];
  agentResults: ManagerAgentResult[];
  protocolTrace: ManagerProtocolTrace[];
}

export interface ManagerCommandFlowReadiness {
  ready: boolean;
  stage: ManagerCommandFlowStage;
  missingProtocolFiles: string[];
  warnings: string[];
  userCheckRequired: boolean;
}

export interface ManagerCommandFlowResponse {
  generatedAt: string;
  project: ManagerProject;
  charter: ManagerProjectCharter;
  wizardEvents: ManagerWizardIntentEvent[];
  protocol: ManagerProtocolState;
  overview: ManagerProjectOverviewResponse;
  decisions: ManagerDecision[];
  blockers: ManagerBlocker[];
  artifacts: ManagerArtifact[];
  rounds: ManagerRound[];
  activeRound?: ManagerRound;
  workerRuns: ManagerWorkerRun[];
  evidence: ManagerEvidenceItem[];
  agentResults: ManagerAgentResult[];
  protocolTrace: ManagerProtocolTrace[];
  judgments: ManagerJudgmentPacket[];
  readiness: ManagerCommandFlowReadiness;
  nextAction: ManagerProjectOverviewAction;
}

export interface ManagerProjectStartRequest {
  title?: string;
  objective?: string;
  phase?: ManagerRoundPhase;
  dryRun?: boolean;
  assignments?: ManagerRoundAgentAssignment[];
}

export interface ManagerProjectStartResponse {
  generatedAt: string;
  project: ManagerProject;
  round: ManagerRound;
  dispatch: ManagerRoundDispatchResponse;
  commandFlow: ManagerCommandFlowResponse;
}

export type ManagerRoundReviewAction =
  | "accept"
  | "request_changes"
  | "user_check_required"
  | "replan"
  | "stop";

export interface ManagerRoundReviewRequest {
  action: ManagerRoundReviewAction;
  summary?: string;
  nextObjective?: string;
  createNextRound?: boolean;
}

export interface ManagerRoundReviewResponse {
  generatedAt: string;
  project: ManagerProject;
  decision?: ManagerDecision;
  blocker?: ManagerBlocker;
  nextRound?: ManagerRound;
  commandFlow: ManagerCommandFlowResponse;
}

export type ManagerDirectionChangeRoundAction = "keep" | "cancel" | "supersede";

export interface ManagerDirectionChangeRequest {
  requestedChange: string;
  impact?: string;
  affectedProtocol?: string;
  affectedArtifacts?: string;
  currentRoundAction?: ManagerDirectionChangeRoundAction;
  nextObjective?: string;
}

export interface ManagerDirectionChangeResponse {
  generatedAt: string;
  project: ManagerProject;
  decision: ManagerDecision;
  nextRound?: ManagerRound;
  commandFlow: ManagerCommandFlowResponse;
}

export interface ManagerProjectCompleteRequest {
  summary?: string;
  goalMatched?: boolean;
  acceptedByUser?: boolean;
  remainingRisks?: string;
  verificationEvidence?: string;
  artifacts?: string[];
}

export interface ManagerProjectCompleteResponse {
  generatedAt: string;
  project: ManagerProject;
  decision: ManagerDecision;
  commandFlow: ManagerCommandFlowResponse;
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
export type ManagerStateRecoveryActionId = "update-all" | "repair-registration";

export interface ManagerStateRecoveryAction {
  id: ManagerStateRecoveryActionId;
  label: string;
  reason: string;
  taskKind: ManagerTaskKind;
  enabled: boolean;
}

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
  recoveryActions: ManagerStateRecoveryAction[];
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
  projectId?: string;
  projectName?: string;
  projectStatus?: ManagerProjectStatus;
  projectCwd?: string;
  projectGoal?: string;
  activeRoundId?: string;
  activeRoundTitle?: string;
  activeRoundStatus?: ManagerRoundStatus;
  projectDecisions?: string[];
  projectBlockers?: string[];
  projectArtifacts?: string[];
  projectCommandFlow?: string[];
  projectProtocol?: string[];
  projectWarnings?: string[];
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
  projects?: ManagerProject[];
  decisions?: ManagerDecision[];
  blockers?: ManagerBlocker[];
  artifacts?: ManagerArtifact[];
  rounds: ManagerRound[];
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  status?: ManagerAssistantStatusReportResponse;
  hygiene?: ManagerSessionHygieneReport;
}

export type ManagerEventInput =
  | { type: "snapshot"; snapshot: ManagerEventSnapshot }
  | { type: "project.created"; project: ManagerProject }
  | { type: "project.updated"; project: ManagerProject }
  | { type: "wizard.intent"; event: ManagerWizardIntentEvent }
  | { type: "decision.created"; decision: ManagerDecision }
  | { type: "decision.updated"; decision: ManagerDecision }
  | { type: "blocker.created"; blocker: ManagerBlocker }
  | { type: "blocker.updated"; blocker: ManagerBlocker }
  | { type: "artifact.created"; artifact: ManagerArtifact }
  | { type: "artifact.updated"; artifact: ManagerArtifact }
  | { type: "protocol.updated"; protocol: ManagerProtocolMetadata }
  | { type: "round.created"; round: ManagerRound }
  | { type: "round.updated"; round: ManagerRound }
  | { type: "agent.created"; agent: ManagerAgent }
  | { type: "agent.updated"; agent: ManagerAgent }
  | { type: "task.created"; task: ManagerTask }
  | { type: "task.updated"; task: ManagerTask }
  | { type: "assistant.status"; report: ManagerAssistantStatusReport }
  | { type: "hygiene.updated"; report: ManagerSessionHygieneReport }
  | { type: "browser.refresh"; activeClients: number }
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
