import { networkInterfaces } from "node:os";
import { loadOrCreateAuthToken } from "./auth-token.ts";
import { defaultLoginTaskLaunch, installLoginTask } from "./login-task.ts";
import { readStateFile } from "./state-file.ts";

export const DEFAULT_SELF_REGISTER_PORT = 18091;
export const DEFAULT_SELF_REGISTER_LISTEN_HOST = "0.0.0.0";

export interface RegisterSelfOptions {
  serverUrl: string;
  siteToken: string;
  port?: number;
  listenHost?: string;
  advertiseHost?: string;
  workspaceRoots?: string;
  label?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  installTask?: typeof installLoginTask;
  loadAuthToken?: typeof loadOrCreateAuthToken;
  stopRecordedDaemon?: (port: number) => Promise<void>;
}

export interface RegisterSelfResult {
  daemonUrl: string;
  label: string;
  taskName: string;
  scriptPath?: string;
  logPath?: string;
}

interface PublicDevice {
  id: string;
  daemonUrl: string;
}

export async function registerSelf(options: RegisterSelfOptions): Promise<RegisterSelfResult> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const siteToken = options.siteToken.trim();
  if (!siteToken) throw new Error("register-self requires --site-token");

  const port = options.port ?? DEFAULT_SELF_REGISTER_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid connector port: ${port}`);
  }
  const listenHost = (options.listenHost ?? DEFAULT_SELF_REGISTER_LISTEN_HOST).trim();
  if (!listenHost) throw new Error("listen host must not be empty");

  const advertiseHost = (options.advertiseHost ?? detectAdvertiseHost())?.trim();
  if (!advertiseHost) {
    throw new Error(
      "could not detect this PC's Tailscale/LAN IP. Install Tailscale or pass --advertise-host <ip-or-hostname>.",
    );
  }

  const daemonUrl = `http://${formatHostForUrl(advertiseHost)}:${port}`;
  const label = options.label?.trim() || defaultDeviceLabel();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const loadAuth = options.loadAuthToken ?? loadOrCreateAuthToken;
  const auth = await loadAuth();

  process.env.CR_CONNECTOR_HOST = listenHost;
  process.env.CR_CONNECTOR_PORT = String(port);
  if (options.workspaceRoots !== undefined) {
    process.env.CR_CONNECTOR_WORKSPACE_ROOTS = options.workspaceRoots;
  }

  await (options.stopRecordedDaemon ?? stopRecordedDaemon)(port);

  const baseLaunch = defaultLoginTaskLaunch();
  const env: Record<string, string | undefined> = {
    CR_CONNECTOR_HOST: listenHost,
    CR_CONNECTOR_PORT: String(port),
    CR_CONNECTOR_WORKSPACE_ROOTS: options.workspaceRoots,
  };
  const install = await (options.installTask ?? installLoginTask)({
    start: true,
    launch: { ...baseLaunch, env },
  });
  if (!install.supported) {
    throw new Error("register-self currently requires Windows login-task support");
  }

  const localUrl = `http://127.0.0.1:${port}`;
  await waitForDaemonStatus(fetchImpl, localUrl, auth.token, timeoutMs, "local connector");
  const advertised = await probeDaemonStatus(fetchImpl, daemonUrl, auth.token, 5_000);
  if (!advertised.ok) {
    const state = await readStateFile().catch(() => undefined);
    if (state?.host === "127.0.0.1" || state?.host === "localhost") {
      throw new Error(
        `connector is still bound to ${state.host}:${state.port}; expected ${listenHost}:${port}. Reinstall the login task and retry.`,
      );
    }
    throw new Error(
      `cannot reach connector at ${daemonUrl}. Check Windows Firewall or Tailscale/LAN access for TCP ${port}.`,
    );
  }

  await replaceServerRegistration(fetchImpl, serverUrl, siteToken, {
    daemonUrl,
    label,
    authToken: auth.token,
  });

  return {
    daemonUrl,
    label,
    taskName: install.taskName,
    ...(install.scriptPath ? { scriptPath: install.scriptPath } : {}),
    ...(install.logPath ? { logPath: install.logPath } : {}),
  };
}

export function detectAdvertiseHost(): string | null {
  const candidates = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => !address.startsWith("169.254."));
  return candidates.find((address) => address.startsWith("100.")) ?? candidates[0] ?? null;
}

async function waitForDaemonStatus(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() <= deadline) {
    const probe = await probeDaemonStatus(fetchImpl, baseUrl, token, 2_000);
    if (probe.ok) return;
    lastError = probe.error;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready at ${baseUrl}: ${lastError || "timed out"}`);
}

async function probeDaemonStatus(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(`${baseUrl}/status`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function replaceServerRegistration(
  fetchImpl: typeof fetch,
  serverUrl: string,
  siteToken: string,
  input: { daemonUrl: string; label: string; authToken: string },
): Promise<void> {
  const devicesUrl = `${serverUrl}/api/devices`;
  const existing = await fetchImpl(devicesUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${siteToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  if (existing?.ok) {
    const devices = (await existing.json().catch(() => [])) as PublicDevice[];
    for (const device of devices) {
      if (device.daemonUrl !== input.daemonUrl) continue;
      await fetchImpl(`${devicesUrl}/${encodeURIComponent(device.id)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${siteToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    }
  }

  const res = await fetchImpl(devicesUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${siteToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`server registration failed (${res.status}): ${text || res.statusText}`);
  }
}

async function stopRecordedDaemon(port: number): Promise<void> {
  const state = await readStateFile().catch(() => undefined);
  if (!state?.pid) return;
  if (state.pid === process.pid) return;
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (await isPortFree("127.0.0.1", port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  try {
    process.kill(state.pid, "SIGKILL");
  } catch {
    // best effort
  }
}

async function isPortFree(host: string, port: number): Promise<boolean> {
  try {
    const sock = await Bun.connect({
      hostname: host,
      port,
      socket: { open: () => undefined, data: () => undefined, close: () => undefined },
    });
    sock.end();
    return false;
  } catch {
    return true;
  }
}

function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("register-self requires --server");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`invalid --server URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--server must be http:// or https://");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function defaultDeviceLabel(): string {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || "DeskRelay PC";
}
