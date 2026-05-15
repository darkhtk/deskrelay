import type {
  DiagnosticReport,
  DiagnosticStep,
  ManagerAcknowledgeResponse,
  ManagerAgent,
  ManagerAgentCreateRequest,
  ManagerAgentListResponse,
  ManagerAgentMessageRequest,
  ManagerAgentMessageResponse,
  ManagerAssistantChatRequest,
  ManagerAssistantChatResponse,
  ManagerAssistantConversationState,
  ManagerAssistantConversationStateInput,
  ManagerAssistantStatusReport,
  ManagerAssistantStatusReportInput,
  ManagerAssistantStatusReportResponse,
  ManagerAssistantStreamEvent,
  ManagerCapabilities,
  ManagerDeviceActions,
  ManagerEvent,
  ManagerEventListResponse,
  ManagerInstallStatus,
  ManagerLogResponse,
  ManagerNetworkStatus,
  ManagerProcessStatus,
  ManagerRegistrationDiagnosis,
  ManagerRegistrationFailureAnalysis,
  ManagerRestartResult,
  ManagerRound,
  ManagerRoundCreateRequest,
  ManagerRoundDispatchRequest,
  ManagerRoundDispatchResponse,
  ManagerRoundHealthGateResponse,
  ManagerRoundListResponse,
  ManagerRoundRepairResponse,
  ManagerRoundReportResponse,
  ManagerSecurityBoundary,
  ManagerSecurityBoundarySummary,
  ManagerSessionHygieneCleanupRequest,
  ManagerSessionHygieneCleanupResponse,
  ManagerSessionHygieneReport,
  ManagerStateViewResponse,
  ManagerSystemSummary,
  ManagerTask,
  ManagerTaskLogResponse,
  ManagerTaskObservationResponse,
  ManagerTaskRequest,
  ManagerTaskStreamEvent,
  ManagerUpdatePlan,
  ManagerUpdateStatus,
  ManagerWorkerCheckResult,
  ManagerWorkerListResponse,
  ManagerWorkerProfile,
  ManagerWorkerRunLedgerResponse,
  UpdateState,
} from "@deskrelay/shared";

const LEGACY_TOKEN_KEY = "cr.site-token";
const TOKEN_KEY_PREFIX = "cr.site-token:";
const BASE_URL_KEY = "cr.site-base-url";

function resolveBaseUrl(): string {
  try {
    const runtime = localStorage.getItem(BASE_URL_KEY);
    if (runtime) return runtime.replace(/\/+$/, "");
  } catch {
    // fall through
  }
  const buildTime = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env
    ?.VITE_API_BASE_URL;
  if (buildTime) return String(buildTime).replace(/\/+$/, "");
  return "";
}

export function getBaseUrl(): string {
  return resolveBaseUrl();
}

export function setBaseUrl(value: string): void {
  try {
    localStorage.setItem(BASE_URL_KEY, value);
  } catch {
    // ignore
  }
}

export function clearBaseUrl(): void {
  try {
    localStorage.removeItem(BASE_URL_KEY);
  } catch {
    // ignore
  }
}

function currentTokenKey(): string {
  const baseUrl = resolveBaseUrl();
  const scope =
    baseUrl ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "local");
  return `${TOKEN_KEY_PREFIX}${scope}`;
}

export function getToken(): string | null {
  try {
    const key = currentTokenKey();
    const scoped = localStorage.getItem(key);
    if (scoped) return scoped;
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacy) return null;
    localStorage.setItem(key, legacy);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return legacy;
  } catch {
    return null;
  }
}

export function setToken(value: string): void {
  try {
    localStorage.setItem(currentTokenKey(), value);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(currentTokenKey());
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export interface Device {
  id: string;
  label: string;
  daemonUrl: string;
  registeredAt: string;
  lastSeenAt?: string;
  os?: string;
  hostname?: string;
  connectionState?: "online" | "offline";
}

export interface ManagerAssistantWorkspaceInfo {
  cwd: string;
  instructionsPath: string;
  repoRoot: string;
  deviceId?: string;
  deviceLabel?: string;
}

export interface BehaviorSummary {
  instanceId: string;
  name: string;
  version: string;
  loadedAt: string;
}

export interface BehaviorRequestResult<R = unknown> {
  result?: R;
  error?: { code: number; message: string; data?: unknown };
}

export interface ClaudeSessionSummary {
  sessionId: string;
  cwd: string;
  title: string;
  fullTitle?: string;
  modifiedAt: string;
  fileSize: number;
}

export interface ClaudeSessionTranscript {
  sessionId: string;
  cwd: string;
  permissionMode?: string;
  events: ClaudeStreamEvent[];
  truncated?: boolean;
  totalBytes?: number;
  returnedBytes?: number;
  maxBytes?: number;
  totalEvents?: number;
  returnedEvents?: number;
  eventLimit?: number;
  eventsTruncated?: boolean;
}

export interface ManagerSessionReadRequest {
  deviceId?: string;
  behaviorInstanceId?: string;
  sessionId: string;
  cwd?: string;
  projectsDir?: string;
  maxBytes?: number;
  eventLimit?: number;
  listLimit?: number;
}

export interface ManagerSessionReadAttempt {
  deviceId: string;
  label: string;
  daemonUrl: string;
  stage: string;
  error: string;
  status?: number;
}

export interface ManagerSessionReadResponse {
  device: { id: string; label: string; daemonUrl: string };
  behavior: {
    instanceId: string;
    name?: string;
    packageName?: string;
    version?: string;
    loadedAt?: string;
  };
  resolvedCwd: string;
  session?: ClaudeSessionSummary;
  transcript: ClaudeSessionTranscript;
  attempts: ManagerSessionReadAttempt[];
}

export interface ClaudeStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface FsEntry {
  name: string;
  fullPath: string;
  isDir: true;
}

export interface FsListResponse {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface FsMkdirResponse {
  path: string;
  parent: string;
  name: string;
}

export interface FsRootsResponse {
  mode: "unrestricted" | "restricted";
  roots: string[];
}

export type WorkspaceBrowseScope = "configured" | "unrestricted";

export interface FsBrowseOptions {
  workspaceScope?: WorkspaceBrowseScope;
}

export type ClaudeInstructionScope = "user" | "project" | "projectClaude" | "local" | "managed";

export interface ClaudeInstructionSource {
  scope: ClaudeInstructionScope;
  label: string;
  path: string;
  readonly: boolean;
  exists: boolean;
  content: string;
  hash?: string;
  mtimeMs?: number;
  error?: string;
}

export interface ClaudeInstructionsSnapshot {
  cwd: string | null;
  sources: ClaudeInstructionSource[];
  error?: string;
}

export interface RegisterOtherPcCommandResponse {
  preferredUrl: string;
  serverPort: number;
  connectorPort: number;
  siteToken: string;
  urls: Array<{ kind: string; url: string }>;
  command: string;
}

export interface DeviceCleanupResult {
  attempted: boolean;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface DeviceCleanupEntry {
  id: string;
  label: string;
  daemonUrl: string;
  cleanup: DeviceCleanupResult;
}

export interface UnregisterDeviceResponse {
  ok: true;
  cleanup?: DeviceCleanupResult;
}

export interface UnregisterAllDevicesResponse {
  ok: true;
  cleanup: DeviceCleanupEntry[];
}

export interface RemoveOtherPcCommandResponse {
  preferredUrl: string;
  serverPort: number;
  connectorPort: number;
  siteToken: string;
  urls: Array<{ kind: string; url: string }>;
  command: string;
}

export interface SelfServerAutostartStatus {
  supported: boolean;
  installed: boolean;
  taskName: string;
  error?: string;
}

export interface SelfServerUpdateResponse {
  supported: boolean;
  started: boolean;
  logPath?: string;
  pid?: number;
  error?: string;
  status?: SelfServerUpdateStatus;
}

export interface SelfServerUpdateStatus {
  state: "idle" | "running" | "succeeded" | "failed";
  startedAt?: string;
  completedAt?: string;
  logPath?: string;
  before?: string;
  after?: string;
  changed?: boolean;
  updateAvailable?: boolean;
  localCommit?: string;
  remoteCommit?: string;
  error?: string;
}

export interface InstallReportRecord {
  id: string;
  receivedAt: string;
  generatedAt?: string;
  status: "succeeded" | "failed" | "unknown";
  server?: string;
  label?: string;
  reportPath?: string;
  steps: DiagnosticStep[];
}

export interface DeviceUpdateResponse {
  ok?: boolean;
  state?: UpdateState;
  changed?: boolean;
  restartScheduled?: boolean;
  restartRequested?: boolean;
  restartRequestError?: string;
  warning?: string;
  error?: string;
  fallbackCommand?: string;
  recoveryKind?: "branch_mismatch" | "registration_required";
  retryable?: boolean;
  expectedBranch?: string;
  actualBranch?: string;
  daemonStatus?: number;
  steps?: DiagnosticStep[];
  before?: { shortCommit?: string };
  after?: { shortCommit?: string };
}

export interface DeviceUpdateQueueEntry {
  deviceId: string;
  label?: string;
  daemonUrl?: string;
  state: UpdateState;
  requestedAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  warning?: string;
  fallbackCommand?: string;
  recoveryKind?: "branch_mismatch" | "registration_required";
  retryable?: boolean;
  expectedBranch?: string;
  actualBranch?: string;
  daemonStatus?: number;
  before?: { shortCommit?: string };
  after?: { shortCommit?: string };
  changed?: boolean;
  restartScheduled?: boolean;
  restartRequested?: boolean;
  restartRequestError?: string;
}

export interface BrowserClientContext {
  address: string;
  isLocal: boolean;
}

export type { DiagnosticCheck, DiagnosticReport, DiagnosticSeverity } from "@deskrelay/shared";
export type {
  ManagerAcknowledgeResponse,
  ManagerAssistantStatusReport,
  ManagerAssistantStatusReportInput,
  ManagerAssistantStatusReportResponse,
  ManagerStateViewResponse,
  ManagerTaskObservationResponse,
  ManagerWorkerCheckResult,
  ManagerRoundHealthGateResponse,
  ManagerRoundRepairResponse,
  ManagerWorkerRunLedgerResponse,
  ManagerWorkerProfile,
};

export interface DeskRelayBuildInfo {
  version: string;
  commit: string;
  shortCommit: string;
  dirty: boolean;
  source: "env" | "git" | "package" | "unknown";
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<R = unknown>(method: string, path: string, body?: unknown): Promise<R> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${resolveBaseUrl()}${path}`, init);
  const parsed = await readResponse(res);
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, parsed);
  }
  return parsed as R;
}

async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${resolveBaseUrl()}${path}`, { method: "GET", headers });
  if (!res.ok) {
    const parsed = await readResponse(res);
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, parsed);
  }
  return await res.blob();
}

async function requestEventStream<E>(
  path: string,
  body: unknown,
  onEvent: (event: E) => void,
  options: { method?: "GET" | "POST" } = {},
): Promise<void> {
  const method = options.method ?? "POST";
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["content-type"] = "application/json";
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${resolveBaseUrl()}${path}`, {
    method,
    headers,
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const parsed = await readResponse(res);
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, parsed);
  }
  if (!res.body) throw new ApiError("stream response had no body", res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (chunk: string) => {
    buffer += chunk;
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as E);
      separator = buffer.indexOf("\n\n");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    flush(decoder.decode(value, { stream: true }));
  }
  flush(decoder.decode());
}

async function readLocalSiteToken(): Promise<string | null> {
  try {
    const res = await fetch(`${resolveBaseUrl()}/__deskrelay/local-site-token`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const parsed = await readResponse(res);
    if (parsed && typeof parsed === "object" && "token" in parsed) {
      const token = (parsed as { token?: unknown }).token;
      return typeof token === "string" && token.trim() ? token.trim() : null;
    }
  } catch {
    // Non-local access, static builds, or older dev servers simply fall back to manual entry.
  }
  return null;
}

async function readBrowserClientContext(): Promise<BrowserClientContext | null> {
  try {
    const res = await fetch(`${resolveBaseUrl()}/__deskrelay/client-context`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const parsed = await readResponse(res);
    if (!parsed || typeof parsed !== "object") return null;
    const raw = parsed as { address?: unknown; isLocal?: unknown };
    return {
      address: typeof raw.address === "string" ? raw.address : "",
      isLocal: raw.isLocal === true,
    };
  } catch {
    return null;
  }
}

async function readResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  health: () =>
    request<{ ok: true; version: string; devices: number; build?: DeskRelayBuildInfo }>(
      "GET",
      "/healthz",
    ),
  localSiteToken: () => readLocalSiteToken(),
  browserClientContext: () => readBrowserClientContext(),

  capabilities: () => request<ManagerCapabilities>("GET", "/api/capabilities"),
  selfDoctor: () => request<DiagnosticReport>("GET", "/api/self/doctor"),
  deviceDoctor: (deviceId: string) =>
    request<DiagnosticReport>("GET", `/api/devices/${deviceId}/doctor`),
  selfLogs: (options?: { source?: string; tail?: number; level?: string }) => {
    const qs = new URLSearchParams();
    if (options?.source) qs.set("source", options.source);
    if (typeof options?.tail === "number") qs.set("tail", String(options.tail));
    if (options?.level) qs.set("level", options.level);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<ManagerLogResponse>("GET", `/api/self/logs${suffix}`);
  },
  selfProcessStatus: () => request<ManagerProcessStatus>("GET", "/api/self/process/status"),
  restartSelfProcess: () => request<ManagerRestartResult>("POST", "/api/self/process/restart"),
  selfNetworkStatus: () => request<ManagerNetworkStatus>("GET", "/api/self/network/status"),
  selfInstallStatus: () => request<ManagerInstallStatus>("GET", "/api/self/install/status"),
  selfSecurityBoundary: () =>
    request<ManagerSecurityBoundary>("GET", "/api/self/security/boundary"),
  managerTasks: (limit?: number) =>
    request<{ tasks: ManagerTask[] }>(
      "GET",
      `/api/manager/tasks${typeof limit === "number" ? `?limit=${limit}` : ""}`,
    ),
  managerTask: (id: string) => request<ManagerTask>("GET", `/api/manager/tasks/${id}`),
  managerTaskLogs: (id: string) =>
    request<ManagerTaskLogResponse>("GET", `/api/manager/tasks/${id}/logs`),
  managerTaskObservation: (id: string) =>
    request<ManagerTaskObservationResponse>("GET", `/api/manager/tasks/${id}/observe`),
  managerTaskStream: (id: string, onEvent: (event: ManagerTaskStreamEvent) => void) =>
    requestEventStream<ManagerTaskStreamEvent>(`/api/manager/tasks/${id}/stream`, {}, onEvent, {
      method: "GET",
    }),
  managerAssistantWorkspace: () =>
    request<ManagerAssistantWorkspaceInfo>("GET", "/api/manager/assistant/workspace"),
  managerAssistantConversation: () =>
    request<ManagerAssistantConversationState>("GET", "/api/manager/assistant/conversation"),
  updateManagerAssistantConversation: (input: ManagerAssistantConversationStateInput) =>
    request<ManagerAssistantConversationState>("PUT", "/api/manager/assistant/conversation", input),
  managerAssistantStatus: (limit?: number) =>
    request<ManagerAssistantStatusReportResponse>(
      "GET",
      `/api/manager/assistant/status${typeof limit === "number" ? `?limit=${limit}` : ""}`,
    ),
  postManagerAssistantStatus: (input: ManagerAssistantStatusReportInput) =>
    request<ManagerAssistantStatusReportResponse>("POST", "/api/manager/assistant/status", input),
  managerState: () => request<ManagerStateViewResponse>("GET", "/api/manager/state"),
  acknowledgeManagerState: (reason?: string) =>
    request<ManagerAcknowledgeResponse>("POST", "/api/manager/state/acknowledge", {
      acknowledgedBy: "browser",
      ...(reason ? { reason } : {}),
    }),
  managerWorkerRuns: (limit?: number) =>
    request<ManagerWorkerRunLedgerResponse>(
      "GET",
      `/api/manager/worker-runs${typeof limit === "number" ? `?limit=${limit}` : ""}`,
    ),
  managerEventsRecent: (afterSeq?: number) =>
    request<ManagerEventListResponse>(
      "GET",
      `/api/manager/events/recent${typeof afterSeq === "number" ? `?afterSeq=${afterSeq}` : ""}`,
    ),
  managerSessionRead: (input: ManagerSessionReadRequest) =>
    request<ManagerSessionReadResponse>("POST", "/api/manager/sessions/read", input),
  managerSessionHygiene: () =>
    request<ManagerSessionHygieneReport>("GET", "/api/manager/sessions/hygiene"),
  cleanupManagerSessionHygiene: (input?: ManagerSessionHygieneCleanupRequest) =>
    request<ManagerSessionHygieneCleanupResponse>(
      "POST",
      "/api/manager/sessions/hygiene/cleanup",
      input ?? {},
    ),
  managerAssistantChat: (input: ManagerAssistantChatRequest) =>
    request<ManagerAssistantChatResponse>("POST", "/api/manager/assistant/chat", input),
  managerAssistantChatStream: (
    input: ManagerAssistantChatRequest,
    onEvent: (event: ManagerAssistantStreamEvent) => void,
  ) =>
    requestEventStream<ManagerAssistantStreamEvent>(
      "/api/manager/assistant/chat/stream",
      input,
      onEvent,
    ),
  cancelManagerTask: (id: string) =>
    request<ManagerTask>("POST", `/api/manager/tasks/${id}/cancel`),
  retryManagerTask: (id: string) => request<ManagerTask>("POST", `/api/manager/tasks/${id}/retry`),
  acknowledgeManagerTask: (id: string, reason?: string) =>
    request<ManagerTask>("POST", `/api/manager/tasks/${id}/acknowledge`, {
      acknowledgedBy: "browser",
      ...(reason ? { reason } : {}),
    }),
  createManagerTask: (input: ManagerTaskRequest) =>
    request<ManagerTask>("POST", "/api/manager/tasks", input),
  managerWorkers: () => request<ManagerWorkerListResponse>("GET", "/api/manager/workers"),
  managerWorker: (id: string) =>
    request<ManagerWorkerProfile>("GET", `/api/manager/workers/${encodeURIComponent(id)}`),
  checkManagerWorker: (id: string) =>
    request<ManagerWorkerCheckResult>(
      "POST",
      `/api/manager/workers/${encodeURIComponent(id)}/check`,
    ),
  runManagerWorker: (input: {
    profile?: string;
    prompt: string;
    cwd?: string;
    timeoutMs?: number;
    dryRun?: boolean;
    requestedBy?: ManagerTaskRequest["requestedBy"];
  }) => request<ManagerTask>("POST", "/api/manager/workers/run", input),
  managerAgents: () => request<ManagerAgentListResponse>("GET", "/api/manager/agents"),
  managerAgent: (id: string) =>
    request<ManagerAgent>("GET", `/api/manager/agents/${encodeURIComponent(id)}`),
  createManagerAgent: (input: ManagerAgentCreateRequest) =>
    request<ManagerAgent>("POST", "/api/manager/agents", input),
  messageManagerAgent: (id: string, input: ManagerAgentMessageRequest) =>
    request<ManagerAgentMessageResponse>(
      "POST",
      `/api/manager/agents/${encodeURIComponent(id)}/message`,
      input,
    ),
  stopManagerAgent: (id: string) =>
    request<{ agent: ManagerAgent; task?: ManagerTask }>(
      "POST",
      `/api/manager/agents/${encodeURIComponent(id)}/stop`,
    ),
  acknowledgeManagerAgent: (id: string, reason?: string) =>
    request<ManagerAgent>("POST", `/api/manager/agents/${encodeURIComponent(id)}/acknowledge`, {
      acknowledgedBy: "browser",
      ...(reason ? { reason } : {}),
    }),
  managerRounds: () => request<ManagerRoundListResponse>("GET", "/api/manager/rounds"),
  createManagerRound: (input: ManagerRoundCreateRequest) =>
    request<{ round: ManagerRound; agents: ManagerAgent[] }>("POST", "/api/manager/rounds", input),
  dispatchManagerRound: (id: string, input: ManagerRoundDispatchRequest) =>
    request<ManagerRoundDispatchResponse>(
      "POST",
      `/api/manager/rounds/${encodeURIComponent(id)}/dispatch`,
      input,
    ),
  managerRoundReport: (id: string) =>
    request<ManagerRoundReportResponse>(
      "GET",
      `/api/manager/rounds/${encodeURIComponent(id)}/report`,
    ),
  managerRoundWorkerRuns: (id: string, limit?: number) =>
    request<ManagerWorkerRunLedgerResponse>(
      "GET",
      `/api/manager/rounds/${encodeURIComponent(id)}/worker-runs${
        typeof limit === "number" ? `?limit=${limit}` : ""
      }`,
    ),
  managerRoundHealth: (id: string) =>
    request<ManagerRoundHealthGateResponse>(
      "GET",
      `/api/manager/rounds/${encodeURIComponent(id)}/health`,
    ),
  repairManagerRound: (id: string) =>
    request<ManagerRoundRepairResponse>(
      "POST",
      `/api/manager/rounds/${encodeURIComponent(id)}/repair`,
    ),
  acknowledgeManagerRound: (id: string, reason?: string) =>
    request<ManagerRound>("POST", `/api/manager/rounds/${encodeURIComponent(id)}/acknowledge`, {
      acknowledgedBy: "browser",
      ...(reason ? { reason } : {}),
    }),
  managerAuditLog: (limit?: number) =>
    request<{ entries: ManagerTask[] }>(
      "GET",
      `/api/manager/audit-log${typeof limit === "number" ? `?limit=${limit}` : ""}`,
    ),
  managerSystemSummary: () => request<ManagerSystemSummary>("GET", "/api/manager/system/summary"),
  managerDeviceActions: (id: string) =>
    request<ManagerDeviceActions>("GET", `/api/manager/devices/${id}/actions`),
  managerUpdatePlan: () => request<ManagerUpdatePlan>("GET", "/api/manager/update/plan"),
  managerUpdateStatus: () => request<ManagerUpdateStatus>("GET", "/api/manager/update/status"),
  managerUpdateAll: (input?: Pick<ManagerTaskRequest, "dryRun" | "requestedBy">) =>
    request<ManagerTask>("POST", "/api/manager/update/all", input ?? {}),
  managerRegistrationLastFailure: () =>
    request<ManagerRegistrationFailureAnalysis>("GET", "/api/manager/registration/last-failure"),
  managerRegistrationDiagnosis: () =>
    request<ManagerRegistrationDiagnosis>("GET", "/api/manager/registration/diagnose"),
  managerRegistrationRepair: (input?: Pick<ManagerTaskRequest, "dryRun" | "requestedBy">) =>
    request<ManagerTask>("POST", "/api/manager/registration/repair", input ?? {}),
  managerSecurityBoundary: () =>
    request<ManagerSecurityBoundarySummary>("GET", "/api/manager/security/boundary"),
  listDevices: () => request<Device[]>("GET", "/api/devices"),
  registerOtherPcCommand: () =>
    request<RegisterOtherPcCommandResponse>("GET", "/api/self/register-other-pc-command"),
  removeOtherPcCommand: () =>
    request<RemoveOtherPcCommandResponse>("GET", "/api/self/remove-other-pc-command"),
  selfServerAutostart: () => request<SelfServerAutostartStatus>("GET", "/api/self/autostart"),
  setSelfServerAutostart: (enabled: boolean) =>
    request<SelfServerAutostartStatus>("PUT", "/api/self/autostart", { enabled }),
  selfUpdate: () => request<SelfServerUpdateResponse>("POST", "/api/self/update"),
  selfUpdateStatus: () => request<SelfServerUpdateStatus>("GET", "/api/self/update/status"),
  installReports: () =>
    request<{ reports: InstallReportRecord[] }>("GET", "/api/self/install-reports?limit=5"),
  deviceUpdateQueue: () =>
    request<{ entries: DeviceUpdateQueueEntry[] }>("GET", "/api/devices/update-queue"),
  updateDevice: (id: string) =>
    request<DeviceUpdateResponse>("POST", `/api/devices/${id}/system/update`),
  registerDevice: (daemonUrl: string, label?: string, authToken?: string) =>
    request<Device>("POST", "/api/devices", {
      daemonUrl,
      ...(label ? { label } : {}),
      ...(authToken ? { authToken } : {}),
    }),
  unregisterDevice: (id: string) =>
    request<UnregisterDeviceResponse>("DELETE", `/api/devices/${id}`),
  unregisterAllDevices: () => request<UnregisterAllDevicesResponse>("DELETE", "/api/devices"),
  renameDevice: (id: string, label: string) =>
    request<Device>("PATCH", `/api/devices/${id}`, { label }),

  deviceCapabilities: (deviceId: string) =>
    request<ManagerCapabilities>("GET", `/api/devices/${deviceId}/capabilities`),
  deviceLogs: (deviceId: string, options?: { source?: string; tail?: number; level?: string }) => {
    const qs = new URLSearchParams();
    if (options?.source) qs.set("source", options.source);
    if (typeof options?.tail === "number") qs.set("tail", String(options.tail));
    if (options?.level) qs.set("level", options.level);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<ManagerLogResponse>("GET", `/api/devices/${deviceId}/logs${suffix}`);
  },
  deviceProcessStatus: (deviceId: string) =>
    request<ManagerProcessStatus>("GET", `/api/devices/${deviceId}/process/status`),
  restartDeviceProcess: (deviceId: string) =>
    request<ManagerRestartResult>("POST", `/api/devices/${deviceId}/process/restart`),
  deviceNetworkStatus: (deviceId: string) =>
    request<ManagerNetworkStatus>("GET", `/api/devices/${deviceId}/network/status`),
  deviceInstallStatus: (deviceId: string) =>
    request<ManagerInstallStatus>("GET", `/api/devices/${deviceId}/install/status`),
  deviceSecurityBoundary: (deviceId: string) =>
    request<ManagerSecurityBoundary>("GET", `/api/devices/${deviceId}/security/boundary`),

  listBehaviors: (deviceId: string) =>
    request<BehaviorSummary[]>("GET", `/api/devices/${deviceId}/behaviors`),
  loadBehavior: (deviceId: string, packageDir: string, instanceId?: string) =>
    request<{ instanceId: string; loadedAt: string }>(
      "POST",
      `/api/devices/${deviceId}/behaviors/load`,
      instanceId ? { packageDir, instanceId } : { packageDir },
    ),
  unloadBehavior: (deviceId: string, instanceId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/api/devices/${deviceId}/behaviors/${encodeURIComponent(instanceId)}`,
    ),
  callBehavior: <R = unknown>(
    deviceId: string,
    instanceId: string,
    method: string,
    params?: unknown,
  ) =>
    request<BehaviorRequestResult<R>>(
      "POST",
      `/api/devices/${deviceId}/behaviors/${encodeURIComponent(instanceId)}/request`,
      params !== undefined ? { method, params } : { method },
    ),

  fsList: (deviceId: string, path: string, options?: FsBrowseOptions) => {
    const qs = new URLSearchParams();
    qs.set("path", path);
    if (options?.workspaceScope === "unrestricted") {
      qs.set("workspaceScope", "unrestricted");
    }
    return request<FsListResponse>("GET", `/api/devices/${deviceId}/fs/list?${qs.toString()}`);
  },
  fsMkdir: (deviceId: string, parent: string, name: string, options?: FsBrowseOptions) =>
    request<FsMkdirResponse>("POST", `/api/devices/${deviceId}/fs/mkdir`, {
      parent,
      name,
      ...(options?.workspaceScope === "unrestricted" ? { workspaceScope: "unrestricted" } : {}),
    }),
  fsRoots: (deviceId: string) =>
    request<FsRootsResponse>("GET", `/api/devices/${deviceId}/fs/roots`),
  filePreview: (deviceId: string, path: string, cwd: string) => {
    const qs = new URLSearchParams();
    qs.set("path", path);
    if (cwd) qs.set("cwd", cwd);
    return requestBlob(`/api/devices/${deviceId}/files/preview?${qs.toString()}`);
  },

  gitStatus: (deviceId: string, cwd: string) =>
    request<{
      isRepo: boolean;
      branch?: string;
      dirty?: boolean;
      modifiedCount?: number;
      stagedCount?: number;
      ahead?: number;
      behind?: number;
      error?: string;
    }>("GET", `/api/devices/${deviceId}/git/status?cwd=${encodeURIComponent(cwd)}`),

  instructions: (deviceId: string, cwd: string) =>
    request<ClaudeInstructionsSnapshot>(
      "GET",
      `/api/devices/${deviceId}/instructions?cwd=${encodeURIComponent(cwd)}`,
    ),
  writeInstruction: (
    deviceId: string,
    scope: ClaudeInstructionScope,
    input: { cwd?: string; content: string; expectedHash?: string },
  ) =>
    request<ClaudeInstructionSource>(
      "PUT",
      `/api/devices/${deviceId}/instructions/${encodeURIComponent(scope)}`,
      input,
    ),
  deleteInstruction: (
    deviceId: string,
    scope: ClaudeInstructionScope,
    input: { cwd?: string; expectedHash?: string },
  ) =>
    request<ClaudeInstructionSource>(
      "DELETE",
      `/api/devices/${deviceId}/instructions/${encodeURIComponent(scope)}`,
      input,
    ),

  diagnostics: (deviceId: string) =>
    request<{
      ok: boolean;
      startedAt: string;
      build?: DeskRelayBuildInfo;
      listening?: { host: string; port: number };
      behaviors?: Array<{
        name: string;
        instanceId: string;
        version: string;
        permissions?: string[];
      }>;
      workspaceRoots?: { mode: "unrestricted" | "restricted"; roots: string[] };
      diagnostics?: {
        remoteClaudeLoaded: boolean;
        approvalsHookEnabled: boolean;
        pendingApprovals: number;
      };
    }>("GET", `/api/devices/${deviceId}/diagnostics`),

  respondApproval: (deviceId: string, id: string, decision: "allow" | "deny", reason?: string) =>
    request<{ ok: true } | { error: string }>(
      "POST",
      `/api/devices/${deviceId}/approvals/respond`,
      reason ? { id, decision, reason } : { id, decision },
    ),
  simulateApproval: (
    deviceId: string,
    payload: { tool_name: string; tool_input?: unknown; session_id?: string },
  ) =>
    request<{ continue: boolean; decision?: string; reason?: string }>(
      "POST",
      `/api/devices/${deviceId}/approvals/simulate`,
      payload,
    ),

  async *streamEvents(
    deviceId: string,
    spaceId: string,
    options: { signal?: AbortSignal; lastEventId?: string; onOpen?: () => void } = {},
  ): AsyncGenerator<unknown, void, void> {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.lastEventId) headers["last-event-id"] = options.lastEventId;
    const url = `${resolveBaseUrl()}/api/devices/${deviceId}/events/spaces/${encodeURIComponent(spaceId)}/stream`;
    const init: RequestInit = { headers };
    if (options.signal) init.signal = options.signal;
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new ApiError(`SSE failed (${res.status})`, res.status);
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    let opened = false;
    const markOpen = () => {
      if (opened) return;
      opened = true;
      options.onOpen?.();
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const normalized = buffer.replace(/\r\n/g, "\n");
        const blank = normalized.indexOf("\n\n");
        if (blank === -1) break;
        const block = normalized.slice(0, blank);
        buffer = normalized.slice(blank + 2);
        markOpen();
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).replace(/^ /, ""))
          .join("\n");
        if (data) {
          try {
            yield JSON.parse(data);
          } catch {
            // skip malformed frames
          }
        }
      }
    }
  },

  async *streamManagerEvents(
    options: {
      signal?: AbortSignal;
      afterSeq?: number;
      lastEventId?: string;
      onOpen?: () => void;
    } = {},
  ): AsyncGenerator<ManagerEvent, void, void> {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.lastEventId) headers["last-event-id"] = options.lastEventId;
    const qs = new URLSearchParams();
    if (typeof options.afterSeq === "number") qs.set("afterSeq", String(options.afterSeq));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const init: RequestInit = { headers };
    if (options.signal) init.signal = options.signal;
    const res = await fetch(`${resolveBaseUrl()}/api/manager/events/stream${suffix}`, init);
    if (!res.ok) {
      throw new ApiError(`Manager event stream failed (${res.status})`, res.status);
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    let opened = false;
    const markOpen = () => {
      if (opened) return;
      opened = true;
      options.onOpen?.();
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const normalized = buffer.replace(/\r\n/g, "\n");
        const blank = normalized.indexOf("\n\n");
        if (blank === -1) break;
        const block = normalized.slice(0, blank);
        buffer = normalized.slice(blank + 2);
        markOpen();
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).replace(/^ /, ""))
          .join("\n");
        if (data) {
          try {
            const parsed = JSON.parse(data) as ManagerEvent;
            if (typeof parsed.seq === "number" && typeof parsed.type === "string") {
              yield parsed;
            }
          } catch {
            // skip malformed frames
          }
        }
      }
    }
  },
};
