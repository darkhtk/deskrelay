import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import {
  type DiagnosticSeverity,
  type DiagnosticSource,
  type DiagnosticStatus,
  normalizeDiagnosticStep,
} from "@deskrelay/shared";
import { loadOrCreateAuthToken } from "./auth-token.ts";
import { defaultLoginTaskLaunch, installLoginTask, removeLoginTask } from "./login-task.ts";
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
  removeTask?: typeof removeLoginTask;
  loadAuthToken?: typeof loadOrCreateAuthToken;
  stopRecordedDaemon?: (port: number) => Promise<void>;
  stopPortOwner?: (port: number) => Promise<boolean>;
}

export interface RegisterSelfResult {
  daemonUrl: string;
  label: string;
  listenHost: string;
  advertiseHost: string;
  port: number;
  taskName: string;
  scriptPath?: string;
  logPath?: string;
  report: RegisterSelfReport;
}

interface PublicDevice {
  id: string;
  daemonUrl: string;
}

export type RegisterSelfStepStatus = Extract<
  DiagnosticStatus,
  "ok" | "repaired" | "failed" | "skipped"
>;

export interface RegisterSelfStep {
  id: string;
  label: string;
  status: RegisterSelfStepStatus;
  severity: DiagnosticSeverity;
  summary: string;
  evidence?: string[];
  action?: string;
  hint?: string;
  retrySafe?: boolean;
  source: "register-self";
}

export interface RegisterSelfReport {
  status: "succeeded" | "failed";
  steps: RegisterSelfStep[];
}

export class RegisterSelfError extends Error {
  readonly report: RegisterSelfReport;
  readonly stepId: string;

  constructor(message: string, stepId: string, report: RegisterSelfReport) {
    super(message);
    this.name = "RegisterSelfError";
    this.stepId = stepId;
    this.report = report;
  }
}

interface ServerRegistrationResult {
  removedDeviceIds: string[];
  registeredDeviceId?: string;
}

type RegisterSelfStepInput = Omit<RegisterSelfStep, "severity" | "source"> & {
  severity?: DiagnosticSeverity;
  source?: DiagnosticSource;
};

export async function registerSelf(options: RegisterSelfOptions): Promise<RegisterSelfResult> {
  const report: RegisterSelfReport = { status: "failed", steps: [] };
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const siteToken = options.siteToken.trim();
  if (!siteToken) throw new Error("register-self requires --site-token");
  addStep(report, {
    id: "input",
    label: "입력값",
    status: "ok",
    summary: `server=${serverUrl}`,
  });

  const port = options.port ?? DEFAULT_SELF_REGISTER_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid connector port: ${port}`);
  }
  const listenHost = (options.listenHost ?? DEFAULT_SELF_REGISTER_LISTEN_HOST).trim();
  if (!listenHost) throw new Error("listen host must not be empty");

  const advertiseHost = (options.advertiseHost ?? detectAdvertiseHost())?.trim();
  if (!advertiseHost) {
    failStep(
      report,
      {
        id: "advertise-host",
        label: "외부 접근 주소",
        status: "failed",
        summary: "this PC has no usable Tailscale/LAN IPv4 address",
        hint: "Install/log in to Tailscale, connect to the same LAN, or pass --advertise-host <ip-or-hostname>.",
      },
      "could not detect this PC's Tailscale/LAN IP. Install Tailscale or pass --advertise-host <ip-or-hostname>.",
    );
  }

  const daemonUrl = `http://${formatHostForUrl(advertiseHost)}:${port}`;
  const label = options.label?.trim() || defaultDeviceLabel();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const loadAuth = options.loadAuthToken ?? loadOrCreateAuthToken;
  const auth = await loadAuth();
  addStep(report, {
    id: "daemon-token",
    label: "daemon token",
    status: auth.created ? "repaired" : "ok",
    summary: auth.created ? `created ${auth.path}` : `loaded ${auth.path}`,
  });

  process.env.CR_CONNECTOR_HOST = listenHost;
  process.env.CR_CONNECTOR_PORT = String(port);
  if (options.workspaceRoots !== undefined) {
    process.env.CR_CONNECTOR_WORKSPACE_ROOTS = options.workspaceRoots;
  }
  addStep(report, {
    id: "daemon-env",
    label: "connector env",
    status: "ok",
    summary: `${listenHost}:${port}, workspaceRoots=${options.workspaceRoots ?? "(unrestricted)"}`,
  });

  await (options.stopRecordedDaemon ?? stopRecordedDaemon)(port);
  addStep(report, {
    id: "recorded-daemon",
    label: "recorded daemon",
    status: "ok",
    summary: "old recorded daemon stop requested",
  });
  const cleanup = await withRegisterStep(
    report,
    "local-port-cleanup",
    () =>
      stopLocalConnectorPortIfPresent({
        fetchImpl,
        baseUrl: `http://127.0.0.1:${port}`,
        port,
        token: auth.token,
        stopPortOwner: options.stopPortOwner ?? stopListeningProcessOnPort,
        removeTask: options.removeTask ?? removeLoginTask,
      }),
    (err) => ({
      label: "local connector cleanup",
      summary: (err as Error).message,
      hint: `Close existing DeskRelay connector/bun/PowerShell processes or rerun PowerShell as Administrator, then retry. TCP port: ${port}.`,
    }),
  );
  addStep(report, {
    id: "local-port-cleanup",
    label: "local connector cleanup",
    status: cleanup.status,
    summary: cleanup.summary,
    ...(cleanup.hint ? { hint: cleanup.hint } : {}),
  });

  const baseLaunch = defaultLoginTaskLaunch();
  const env: Record<string, string | undefined> = {
    CR_CONNECTOR_HOST: listenHost,
    CR_CONNECTOR_PORT: String(port),
    CR_CONNECTOR_WORKSPACE_ROOTS: options.workspaceRoots,
  };
  const install = await withRegisterStep(
    report,
    "login-task",
    () =>
      (options.installTask ?? installLoginTask)({
        start: true,
        launch: { ...baseLaunch, env },
      }),
    (err) => ({
      label: "login task",
      summary: (err as Error).message,
      hint: "Check Windows Task Scheduler permissions and rerun the registration command.",
    }),
  );
  if (!install.supported) {
    failStep(
      report,
      {
        id: "login-task",
        label: "login task",
        status: "failed",
        summary: "Windows login-task support is required",
        hint: "Run registration on Windows or use a supported connector startup path.",
      },
      "register-self currently requires Windows login-task support",
    );
  }
  addStep(report, {
    id: "login-task",
    label: "login task",
    status: install.started ? "ok" : "repaired",
    summary: `${install.taskName} installed${install.started ? " and started" : ""}`,
  });

  const localUrl = `http://127.0.0.1:${port}`;
  await withRegisterStep(
    report,
    "local-daemon",
    () => waitForDaemonStatus(fetchImpl, localUrl, auth.token, timeoutMs, "local connector"),
    (err) => ({
      label: "local daemon",
      summary: (err as Error).message,
      hint: `The connector did not answer locally at ${localUrl}. Check the login task log or port ${port}.`,
    }),
  );
  addStep(report, {
    id: "local-daemon",
    label: "local daemon",
    status: "ok",
    summary: `local /status verified at ${localUrl}`,
  });

  const advertised = await probeDaemonStatus(fetchImpl, daemonUrl, auth.token, 5_000);
  if (!advertised.ok) {
    const state = await readStateFile().catch(() => undefined);
    if (
      state?.host &&
      isLocalOnlyHost(state.host) &&
      !areEquivalentListenHosts(state.host, listenHost)
    ) {
      failStep(
        report,
        {
          id: "advertised-daemon",
          label: "server-to-connector probe",
          status: "failed",
          summary: `connector is still bound to ${state.host}:${state.port}; expected ${listenHost}:${port}`,
          hint: "Reinstall the login task and retry.",
        },
        `connector is still bound to ${state.host}:${state.port}; expected ${listenHost}:${port}. Reinstall the login task and retry.`,
      );
    }
    const classified = classifyAdvertisedProbeFailure(advertised.error, daemonUrl, port);
    failStep(
      report,
      {
        id: "advertised-daemon",
        label: "server-to-connector probe",
        status: "failed",
        summary: classified.summary,
        evidence: classified.evidence,
        action: classified.action,
        hint: classified.hint,
      },
      classified.message,
    );
  }
  addStep(report, {
    id: "advertised-daemon",
    label: "server-to-connector probe",
    status: "ok",
    summary: `advertised /status verified at ${daemonUrl}`,
  });

  const registration = await withRegisterStep(
    report,
    "server-registration",
    () =>
      replaceServerRegistration(fetchImpl, serverUrl, siteToken, {
        daemonUrl,
        label,
        authToken: auth.token,
      }),
    (err) => ({
      label: "server registration",
      summary: (err as Error).message,
      hint: "Check the server URL, Site token, and that the DeskRelay server is reachable.",
    }),
  );
  addStep(report, {
    id: "server-registration",
    label: "server registration",
    status: registration.removedDeviceIds.length > 0 ? "repaired" : "ok",
    summary:
      registration.removedDeviceIds.length > 0
        ? `replaced ${registration.removedDeviceIds.length} stale device row(s); registered ${registration.registeredDeviceId ?? daemonUrl}`
        : `registered ${registration.registeredDeviceId ?? daemonUrl}`,
  });

  report.status = "succeeded";
  return {
    daemonUrl,
    label,
    listenHost,
    advertiseHost,
    port,
    taskName: install.taskName,
    ...(install.scriptPath ? { scriptPath: install.scriptPath } : {}),
    ...(install.logPath ? { logPath: install.logPath } : {}),
    report,
  };
}

function addStep(report: RegisterSelfReport, step: RegisterSelfStepInput): void {
  report.steps.push(
    normalizeDiagnosticStep({
      ...step,
      source: "register-self",
    }) as RegisterSelfStep,
  );
}

function failStep(report: RegisterSelfReport, step: RegisterSelfStepInput, message: string): never {
  addStep(report, step);
  report.status = "failed";
  throw new RegisterSelfError(message, step.id, report);
}

async function withRegisterStep<T>(
  report: RegisterSelfReport,
  stepId: string,
  fn: () => Promise<T>,
  explain: (err: unknown) => { label: string; summary: string; hint?: string },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const failure = explain(err);
    failStep(
      report,
      {
        id: stepId,
        label: failure.label,
        status: "failed",
        summary: failure.summary,
        ...(failure.hint ? { hint: failure.hint } : {}),
      },
      failure.summary,
    );
  }
}

export function formatRegisterSelfReport(report: RegisterSelfReport): string {
  const marker: Record<RegisterSelfStepStatus, string> = {
    ok: "  OK  ",
    repaired: "REPAIR",
    failed: "ERROR ",
    skipped: " skip ",
  };
  const lines = ["registration report:"];
  for (const step of report.steps) {
    lines.push(`${marker[step.status]} ${step.label}: ${step.summary}`);
    if (step.evidence?.length) {
      for (const item of step.evidence) lines.push(`       evidence: ${item}`);
    }
    if (step.action) lines.push(`       action: ${step.action}`);
    if (step.hint) lines.push(`       -> ${step.hint}`);
  }
  lines.push(`result: ${report.status}`);
  return lines.join("\n");
}

export function detectAdvertiseHost(): string | null {
  const candidates = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => !address.startsWith("169.254."));
  return candidates.find((address) => address.startsWith("100.")) ?? candidates[0] ?? null;
}

interface LocalConnectorCleanupResult {
  status: RegisterSelfStepStatus;
  summary: string;
  hint?: string;
}

function classifyAdvertisedProbeFailure(
  error: string,
  daemonUrl: string,
  port: number,
): { summary: string; hint: string; message: string; evidence: string[]; action: string } {
  const host = hostFromUrl(daemonUrl);
  const network = classifyAdvertisedNetwork(host);
  const baseEvidence = [
    `daemonUrl=${daemonUrl}`,
    `port=${port}`,
    `host=${host || "unknown"}`,
    `network=${network}`,
    `error=${error}`,
  ];
  if (error === "HTTP 401" || error === "HTTP 403") {
    return {
      summary: `server reached ${daemonUrl}, but daemon token was rejected (${error})`,
      hint: "Rerun the registration command so the server stores this PC's current daemon token.",
      action:
        "Rerun the same registration command so the server stores this PC's current daemon token.",
      evidence: [...baseEvidence, `status=${error}`],
      message: `daemon token rejected at ${daemonUrl}: ${error}`,
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|name not resolved/i.test(error)) {
    return {
      summary: `local daemon is ready, but ${daemonUrl} could not be resolved`,
      hint: "Use a Tailscale IPv4, LAN IPv4, or resolvable hostname for the advertised connector address.",
      action:
        "Rerun registration after Tailscale/LAN DNS is available, or pass a reachable --advertise-host value.",
      evidence: baseEvidence,
      message: `cannot resolve connector address ${daemonUrl}. Use a reachable Tailscale/LAN address.`,
    };
  }
  if (/ECONNREFUSED|connection refused/i.test(error)) {
    return {
      summary: `local daemon is ready, but ${daemonUrl} refused the advertised connection`,
      hint: `Confirm the connector login task is bound to 0.0.0.0 and nothing else owns TCP ${port}.`,
      action:
        "Rerun registration so the installer can replace the login task and stale connector process.",
      evidence: baseEvidence,
      message: `connector refused at ${daemonUrl}. Reinstall the login task and retry TCP ${port}.`,
    };
  }
  if (/timed|abort/i.test(error)) {
    const routeHint =
      network === "tailscale"
        ? "Tailscale must be logged in on both PCs and Windows Firewall must allow inbound connector traffic."
        : network === "lan"
          ? "Both PCs must be on the same LAN/VPN and Windows Firewall must allow inbound connector traffic."
          : "The advertised address must be routable from the server and protected by a private network.";
    return {
      summary: `local daemon is ready, but ${daemonUrl} timed out from the advertised address`,
      hint: `${routeHint} Check inbound TCP ${port}.`,
      action: `Allow inbound TCP ${port} for the connector, confirm Tailscale/LAN reachability, then rerun registration.`,
      evidence: baseEvidence,
      message: `cannot reach connector at ${daemonUrl}: timeout. Check Windows Firewall or Tailscale/LAN access for TCP ${port}.`,
    };
  }
  return {
    summary: `local daemon is ready, but ${daemonUrl} is not reachable (${error})`,
    hint: `Check Windows Firewall, Tailscale/LAN access, and whether this PC is advertising the correct IP for TCP ${port}.`,
    action: `Check the advertised connector address and inbound TCP ${port}, then rerun registration.`,
    evidence: baseEvidence,
    message: `cannot reach connector at ${daemonUrl}. Check Windows Firewall or Tailscale/LAN access for TCP ${port}.`,
  };
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

function classifyAdvertisedNetwork(
  host: string,
): "local" | "tailscale" | "lan" | "public" | "unknown" {
  if (!host) return "unknown";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local";
  if (host.startsWith("100.")) return "tailscale";
  if (
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return "lan";
  }
  return "public";
}

/*
 * Registration intentionally behaves like reconciliation:
 * detect existing state, repair what can be repaired, then prove both
 * local and advertised daemon URLs before touching the server registry.
 */
async function stopLocalConnectorPortIfPresent({
  fetchImpl,
  baseUrl,
  port,
  token,
  stopPortOwner,
  removeTask,
}: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  port: number;
  token: string;
  stopPortOwner: (port: number) => Promise<boolean>;
  removeTask: () => Promise<unknown>;
}): Promise<LocalConnectorCleanupResult> {
  const probe = await probeDaemonStatus(fetchImpl, baseUrl, token, 1_000);
  const staleAuth = isStaleAuthProbe(probe);
  if (!probe.ok && !staleAuth) {
    return {
      status: "skipped",
      summary: `no matching local connector was reachable on ${baseUrl}`,
    };
  }
  if (staleAuth) {
    await removeTask().catch(() => undefined);
  }
  const stopped = await stopPortOwner(port);
  if (!stopped) {
    if (staleAuth) await failIfStaleConnectorStillOwnsPort(fetchImpl, baseUrl, port, token);
    return {
      status: probe.ok ? "ok" : "skipped",
      summary: probe.ok
        ? `existing connector already accepts the current token on ${baseUrl}`
        : `no stale connector process could be stopped on TCP ${port}`,
    };
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await isPortFree("127.0.0.1", port)) {
      return {
        status: "repaired",
        summary: staleAuth
          ? `stopped stale connector and removed old login task on TCP ${port}`
          : `stopped previous connector on TCP ${port}`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (staleAuth) await failIfStaleConnectorStillOwnsPort(fetchImpl, baseUrl, port, token);
  return {
    status: "repaired",
    summary: `requested stop for previous connector on TCP ${port}; port state needs recheck`,
    hint: `If registration fails later, close processes that still hold TCP ${port}.`,
  };
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

function isStaleAuthProbe(probe: { ok: true } | { ok: false; error: string }): boolean {
  return !probe.ok && (probe.error === "HTTP 401" || probe.error === "HTTP 403");
}

async function failIfStaleConnectorStillOwnsPort(
  fetchImpl: typeof fetch,
  baseUrl: string,
  port: number,
  token: string,
): Promise<void> {
  const probe = await probeDaemonStatus(fetchImpl, baseUrl, token, 1_000);
  if (isStaleAuthProbe(probe)) {
    throw new Error(
      [
        `stale DeskRelay connector is already listening on ${baseUrl} with a different daemon token.`,
        "The installer stopped the login task but could not free the connector port automatically.",
        `Close existing DeskRelay connector/bun/PowerShell processes or rerun PowerShell as Administrator, then run the registration command again. TCP port: ${port}.`,
      ].join(" "),
    );
  }
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

async function stopListeningProcessOnPort(port: number): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const pids = await findWindowsListeningPids(port);
  const targets = pids.filter((pid) => pid > 0 && pid !== process.pid);
  if (targets.length === 0) return false;
  let attempted = false;
  for (const pid of targets) {
    const result = await runCommand("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).catch(
      () => ({
        code: 1,
        stdout: "",
        stderr: "",
      }),
    );
    if (result.code === 0) attempted = true;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const remaining = await findWindowsListeningPids(port);
  const targetSet = new Set(targets);
  return attempted && remaining.every((pid) => !targetSet.has(pid));
}

async function findWindowsListeningPids(port: number): Promise<number[]> {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Get-NetTCPConnection -LocalPort ${port} -State Listen |`,
    "  Select-Object -ExpandProperty OwningProcess -Unique",
  ].join("; ");
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function replaceServerRegistration(
  fetchImpl: typeof fetch,
  serverUrl: string,
  siteToken: string,
  input: { daemonUrl: string; label: string; authToken: string },
): Promise<ServerRegistrationResult> {
  const devicesUrl = `${serverUrl}/api/devices`;
  const existing = await fetchImpl(devicesUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${siteToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    throw new Error(`cannot reach DeskRelay server at ${serverUrl}: ${(err as Error).message}`);
  });
  if (!existing.ok) {
    const text = await existing.text().catch(() => "");
    throw new Error(
      `cannot list registered devices (${existing.status}): ${text || existing.statusText}`,
    );
  }

  let devices: PublicDevice[];
  try {
    const parsed = await existing.json();
    if (!Array.isArray(parsed)) throw new Error("response is not an array");
    devices = parsed as PublicDevice[];
  } catch (err) {
    throw new Error(`cannot parse registered devices response: ${(err as Error).message}`);
  }

  const removedDeviceIds: string[] = [];
  for (const device of devices) {
    if (device.daemonUrl !== input.daemonUrl) continue;
    if (!device.id) {
      throw new Error(`registered device for ${input.daemonUrl} is missing an id`);
    }
    const deleteUrl = `${devicesUrl}/${encodeURIComponent(device.id)}`;
    const deleted = await fetchImpl(deleteUrl, {
      method: "DELETE",
      headers: { authorization: `Bearer ${siteToken}` },
      signal: AbortSignal.timeout(10_000),
    }).catch((err) => {
      throw new Error(`cannot remove existing device ${device.id}: ${(err as Error).message}`);
    });
    if (!deleted.ok) {
      const text = await deleted.text().catch(() => "");
      throw new Error(
        `cannot remove existing device ${device.id} (${deleted.status}): ${text || deleted.statusText}`,
      );
    }
    removedDeviceIds.push(device.id);
  }

  const res = await fetchImpl(devicesUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${siteToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => {
    throw new Error(
      `cannot register with DeskRelay server at ${serverUrl}: ${(err as Error).message}`,
    );
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`server registration failed (${res.status}): ${text || res.statusText}`);
  }
  const created = await res.json().catch(() => undefined);
  const registeredDeviceId =
    created && typeof created === "object" && "id" in created && typeof created.id === "string"
      ? created.id
      : undefined;

  const confirmed = await fetchImpl(devicesUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${siteToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    throw new Error(`registered device, but cannot confirm device list: ${(err as Error).message}`);
  });
  if (!confirmed.ok) {
    const text = await confirmed.text().catch(() => "");
    throw new Error(
      `registered device, but confirmation list failed (${confirmed.status}): ${text || confirmed.statusText}`,
    );
  }
  const confirmedDevices = await readPublicDevices(confirmed, "confirmation devices response");
  if (!confirmedDevices.some((device) => device.daemonUrl === input.daemonUrl)) {
    throw new Error(
      `registered device, but ${input.daemonUrl} was not visible in the server device list`,
    );
  }
  return { removedDeviceIds, ...(registeredDeviceId ? { registeredDeviceId } : {}) };
}

async function readPublicDevices(response: Response, label: string): Promise<PublicDevice[]> {
  try {
    const parsed = await response.json();
    if (!Array.isArray(parsed)) throw new Error("response is not an array");
    return parsed as PublicDevice[];
  } catch (err) {
    throw new Error(`cannot parse ${label}: ${(err as Error).message}`);
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

function isLocalOnlyHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function areEquivalentListenHosts(left: string, right: string): boolean {
  const normalize = (host: string) => (host === "localhost" ? "127.0.0.1" : host);
  return normalize(left) === normalize(right);
}

function defaultDeviceLabel(): string {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || "DeskRelay PC";
}
