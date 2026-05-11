// doctor.ts — `cr-connector doctor` runs a battery of read-only checks
// against the local state + the site so an alpha tester (or operator
// helping one) can see in 5 seconds where their pairing/install path
// went wrong. Every check produces an actionable hint, not a raw
// dump — most support cases over the past month traced back to one of
// these checks failing silently.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { dirname, join } from "node:path";
import {
  type DiagnosticSeverity,
  type DiagnosticStatus,
  normalizeDiagnosticStep,
} from "@deskrelay/shared";
import { defaultAuthFilePath } from "./auth-token.ts";
import { type DeviceIdentity, defaultIdentityPath } from "./device-identity.ts";
import { queryLoginTask } from "./login-task.ts";
import { explainUpgradeStatus } from "./site-ws-client.ts";

/** State dir = the directory holding `auth.json` (and identity/ + logs/).
 *  Derive from defaultAuthFilePath so we don't drift if the layout
 *  changes — the auth-token module is the canonical owner of the path. */
function defaultStateDir(): string {
  return dirname(defaultAuthFilePath());
}

export type CheckStatus = "ok" | "warn" | "error" | "skip";

export interface CheckResult {
  /** Short identifier (e.g. "identity", "site-reachable"). */
  id: string;
  /** Human-readable label shown to the operator. */
  label: string;
  status: CheckStatus;
  severity: DiagnosticSeverity;
  /** One-line summary. */
  summary: string;
  /** Optional follow-up action the user should take. */
  hint?: string | undefined;
  action?: string | undefined;
  evidence?: string[] | undefined;
  retrySafe?: boolean | undefined;
  source: "doctor";
}

export interface DoctorOptions {
  /** Override fetch for tests. */
  fetchImpl?: (
    input: string | URL,
    init?: { method?: string; headers?: HeadersInit; signal?: AbortSignal },
  ) => Promise<{ status: number; ok?: boolean }>;
  /** Override the platform check (tests). */
  platform?: NodeJS.Platform;
  /** Override the state-dir path (tests). */
  stateDir?: string;
  /** Override the identity-file path (tests). */
  identityPath?: string;
  /** Override the daemon's local HTTP base (tests). Default 18091. */
  daemonBase?: string;
  /** Network timeout per probe. Default 4000 ms. */
  timeoutMs?: number;
}

type FetchImpl = NonNullable<DoctorOptions["fetchImpl"]>;
type CheckResultInput = Omit<CheckResult, "severity" | "source"> & {
  severity?: DiagnosticSeverity;
};

export async function runDoctor(opts: DoctorOptions = {}): Promise<CheckResult[]> {
  const fetchImpl: FetchImpl = opts.fetchImpl ?? defaultFetch;
  const platform = opts.platform ?? process.platform;
  const stateDir = opts.stateDir ?? defaultStateDir();
  const identityPath = opts.identityPath ?? defaultIdentityPath();
  const daemonBase = opts.daemonBase ?? "http://127.0.0.1:18091";
  const timeoutMs = opts.timeoutMs ?? 4000;

  const out: CheckResultInput[] = [];

  // 1. identity.json — the device's site-issued credentials.
  const identity = await readIdentitySafe(identityPath);
  if (!identity) {
    out.push({
      id: "identity",
      label: "device identity",
      status: "error",
      summary: `not found at ${identityPath}`,
      hint: "run `cr-connector pair ABC123` (replace with a fresh pairing code from Settings → Devices on the site)",
    });
    // Without identity, the rest of the network checks would all be
    // misleading — return early.
    return out.map(check);
  }
  out.push({
    id: "identity",
    label: "device identity",
    status: identity.connectionToken ? "ok" : "warn",
    summary: identity.connectionToken
      ? `paired as ${identity.deviceId} (${identity.label ?? "unlabeled"})`
      : `${identity.deviceId} but missing connectionToken (legacy pairing)`,
    hint: identity.connectionToken
      ? undefined
      : "re-pair to get a current connectionToken: `cr-connector pair NEWCODE`",
  });

  // 2. auth.json — the daemon's local HTTP API bearer.
  const authPath = join(stateDir, "auth.json");
  if (!existsSync(authPath)) {
    out.push({
      id: "auth-token",
      label: "daemon auth token",
      status: "warn",
      summary: `not found at ${authPath}`,
      hint: "this is fine if you've never started the daemon yet — it'll be generated on first start",
    });
  } else {
    try {
      const raw = JSON.parse(await readFile(authPath, "utf8")) as { token?: unknown };
      const tokLen = typeof raw.token === "string" ? raw.token.length : 0;
      out.push({
        id: "auth-token",
        label: "daemon auth token",
        status: tokLen >= 32 ? "ok" : "warn",
        summary:
          tokLen >= 32
            ? `${tokLen}-char token present`
            : `token shorter than expected (${tokLen} chars)`,
      });
    } catch {
      out.push({
        id: "auth-token",
        label: "daemon auth token",
        status: "error",
        summary: "auth.json present but unparseable",
        hint: "delete auth.json and restart the daemon — it'll regenerate",
      });
    }
  }

  // 3. Login task (Windows only).
  if (platform === "win32") {
    try {
      const q = await queryLoginTask({ platform: "win32" });
      if (q.installed) {
        out.push({
          id: "login-task",
          label: "Windows login task",
          status: "ok",
          summary: `installed (${q.taskName})`,
        });
      } else {
        out.push({
          id: "login-task",
          label: "Windows login task",
          status: "warn",
          summary: "not installed — daemon won't auto-start on next logon",
          hint: "run `cr-connector login-task install --start` (no admin needed since v0.1.8)",
        });
      }
    } catch (err) {
      out.push({
        id: "login-task",
        label: "Windows login task",
        status: "warn",
        summary: `query failed: ${(err as Error).message}`,
      });
    }
  } else {
    out.push({
      id: "login-task",
      label: "Windows login task",
      status: "skip",
      summary: `non-Windows platform (${platform})`,
    });
  }

  // 4. Daemon listening locally.
  const daemonAlive = await probe(fetchImpl, `${daemonBase}/healthz`, timeoutMs);
  if (daemonAlive.status === 200 || daemonAlive.status === 401) {
    // 401 = daemon is up but our probe didn't include the auth token.
    // That's expected and a clean "yes it's up" signal.
    out.push({
      id: "daemon-local",
      label: "local daemon HTTP",
      status: "ok",
      summary: `responding on ${daemonBase} (status=${daemonAlive.status})`,
    });
  } else if (daemonAlive.status === 0) {
    out.push({
      id: "daemon-local",
      label: "local daemon HTTP",
      status: "error",
      summary: `nothing listening on ${daemonBase}`,
      hint:
        platform === "win32"
          ? "start the daemon manually for now: open a new shell and run `cr-connector` (or just reboot if the login task is installed)"
          : "run `cr-connector` in another shell to start the daemon",
    });
  } else {
    out.push({
      id: "daemon-local",
      label: "local daemon HTTP",
      status: "warn",
      summary: `unexpected response on ${daemonBase} (status=${daemonAlive.status})`,
    });
  }

  // 5. Site reachable.
  const siteHealth = await probe(
    fetchImpl,
    `${identity.siteUrl.replace(/\/+$/, "")}/healthz`,
    timeoutMs,
  );
  if (siteHealth.status === 200) {
    out.push({
      id: "site-reachable",
      label: "site reachable",
      status: "ok",
      summary: `${identity.siteUrl} → 200`,
    });
  } else if (siteHealth.status === 0) {
    out.push({
      id: "site-reachable",
      label: "site reachable",
      status: "error",
      summary: `cannot reach ${identity.siteUrl}`,
      hint: "check your network / DNS / firewall",
    });
  } else {
    out.push({
      id: "site-reachable",
      label: "site reachable",
      status: "warn",
      summary: `${identity.siteUrl} returned ${siteHealth.status}`,
      hint: "site may be deploying or having an outage",
    });
  }

  // 6. Device known to site (= /api/connector/ws lookup). Token deliberately
  //    NOT sent — the route's pre-DO check answers the "is this deviceId in
  //    the devices table" question with status alone, and a token in the URL
  //    would leak.
  const wsProbeUrl = `${identity.siteUrl.replace(/\/+$/, "")}/api/connector/ws?deviceId=${encodeURIComponent(identity.deviceId)}`;
  const wsProbe = await probe(
    fetchImpl,
    wsProbeUrl,
    timeoutMs,
    new Headers({
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    }),
  );
  // 101 means the upgrade succeeded; 400 is suspicious but not fatal because
  // some intermediate proxies normalize the response. 404 is the case we
  // really want to flag.
  if (wsProbe.status === 0) {
    out.push({
      id: "site-recognizes-device",
      label: "site recognizes device",
      status: "warn",
      summary: "could not probe /api/connector/ws (network)",
    });
  } else if (wsProbe.status === 404) {
    out.push({
      id: "site-recognizes-device",
      label: "site recognizes device",
      status: "error",
      summary: `site returned 404 — your deviceId (${identity.deviceId}) is not in the devices table`,
      hint:
        "your local pairing is stale (likely the device was removed in the UI). Re-pair: " +
        "`cr-connector pair NEWCODE`",
    });
  } else if (wsProbe.status === 101 || wsProbe.status === 400) {
    out.push({
      id: "site-recognizes-device",
      label: "site recognizes device",
      status: "ok",
      summary: `site recognizes ${identity.deviceId} (probe status=${wsProbe.status})`,
    });
  } else {
    const explained = explainUpgradeStatus(wsProbe.status);
    out.push({
      id: "site-recognizes-device",
      label: "site recognizes device",
      status: explained.level === "error" ? "error" : "warn",
      summary: `probe returned ${wsProbe.status}`,
      hint: explained.message,
    });
  }

  // 7. host quirks — useful when collecting a support snapshot.
  out.push({
    id: "host",
    label: "host info",
    status: "ok",
    summary: `${osHostname()} (${platform})`,
  });

  return out.map(check);
}

function check(input: CheckResultInput): CheckResult {
  const statusMap: Record<CheckStatus, DiagnosticStatus> = {
    ok: "ok",
    warn: "warn",
    error: "failed",
    skip: "skipped",
  };
  const normalized = normalizeDiagnosticStep({
    id: input.id,
    label: input.label,
    status: statusMap[input.status],
    ...(input.severity ? { severity: input.severity } : {}),
    summary: input.summary,
    ...(input.hint ? { action: input.hint } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(input.retrySafe !== undefined ? { retrySafe: input.retrySafe } : {}),
    source: "doctor",
  });
  return {
    id: input.id,
    label: input.label,
    status: input.status,
    severity: normalized.severity,
    summary: input.summary,
    source: "doctor",
    ...(input.hint ? { hint: input.hint } : {}),
    ...(typeof normalized.action === "string" ? { action: normalized.action } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(input.retrySafe !== undefined ? { retrySafe: input.retrySafe } : {}),
  };
}

export function formatDoctorOutput(results: Array<CheckResult | CheckResultInput>): string {
  const marker: Record<CheckStatus, string> = {
    ok: "  OK  ",
    warn: " WARN ",
    error: "ERROR ",
    skip: " skip ",
  };
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${marker[r.status]} ${r.label}: ${r.summary}`);
    if (r.hint) lines.push(`         → ${r.hint}`);
  }
  const errors = results.filter((r) => r.status === "error").length;
  const warns = results.filter((r) => r.status === "warn").length;
  lines.push("");
  if (errors > 0) {
    lines.push(`${errors} error(s) found — fix the items marked ERROR above.`);
  } else if (warns > 0) {
    lines.push(`${warns} warning(s) — daemon should still work but address these when convenient.`);
  } else {
    lines.push("everything looks healthy.");
  }
  return lines.join("\n");
}

async function readIdentitySafe(path: string): Promise<DeviceIdentity | undefined> {
  try {
    if (!existsSync(path)) return undefined;
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as DeviceIdentity;
  } catch {
    return undefined;
  }
}

async function probe(
  fetchImpl: FetchImpl,
  url: string,
  timeoutMs: number,
  headers?: Headers,
): Promise<{ status: number }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const init: { method?: string; headers?: HeadersInit; signal?: AbortSignal } = {
      method: "GET",
      signal: ctl.signal,
    };
    if (headers) init.headers = headers;
    const res = await fetchImpl(url, init);
    return { status: res.status };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(t);
  }
}

const defaultFetch = async (
  input: string | URL,
  init?: { method?: string; headers?: HeadersInit; signal?: AbortSignal },
) => {
  const r = await fetch(input as string, init);
  return { status: r.status, ok: r.ok };
};
