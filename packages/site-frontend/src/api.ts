const TOKEN_KEY = "cr.site-token";
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

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(value: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch {
    // ignore
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
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
  health: () => request<{ ok: true; version: string; devices: number }>("GET", "/healthz"),

  listDevices: () => request<Device[]>("GET", "/api/devices"),
  registerDevice: (daemonUrl: string, label?: string, authToken?: string) =>
    request<Device>("POST", "/api/devices", {
      daemonUrl,
      ...(label ? { label } : {}),
      ...(authToken ? { authToken } : {}),
    }),
  unregisterDevice: (id: string) => request<{ ok: true }>("DELETE", `/api/devices/${id}`),
  renameDevice: (id: string, label: string) =>
    request<Device>("PATCH", `/api/devices/${id}`, { label }),

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

  fsList: (deviceId: string, path: string) =>
    request<FsListResponse>(
      "GET",
      `/api/devices/${deviceId}/fs/list?path=${encodeURIComponent(path)}`,
    ),
  fsMkdir: (deviceId: string, parent: string, name: string) =>
    request<FsMkdirResponse>("POST", `/api/devices/${deviceId}/fs/mkdir`, { parent, name }),
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

  diagnostics: (deviceId: string) =>
    request<{
      ok: boolean;
      startedAt: string;
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
};
