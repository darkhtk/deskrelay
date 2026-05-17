#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createSiteApp } from "./app.ts";
import { InMemoryDeviceRegistry, JsonFileDeviceRegistry } from "./device-registry.ts";
import { createJsonDeviceUpdateQueueStore } from "./device-update-queue-store.ts";
import { createJsonInstallReportStore } from "./install-report-store.ts";
import { createJsonManagerTaskStore } from "./manager-task-store.ts";
import { createPowerShellSelfServerAutostartController } from "./self-server-autostart.ts";
import { createPowerShellSelfServerProcessController } from "./self-server-process.ts";
import { createPowerShellSelfServerUpdater } from "./self-server-update.ts";
import { createGitUpdateNoticeSource } from "./update-notice.ts";

const execFileAsync = promisify(execFile);
const port = process.env.CR_SITE_PORT ? Number(process.env.CR_SITE_PORT) : 18092;
const host = process.env.CR_SITE_HOST ?? "127.0.0.1";
const idleTimeoutSeconds = positiveNumber(process.env.CR_SITE_IDLE_TIMEOUT_SECONDS, 255);

let token = process.env.CR_SITE_TOKEN ?? "";
let tokenGenerated = false;
if (!token && process.env.CR_SITE_AUTH_OPTIONAL !== "1") {
  token = randomBytes(24).toString("base64url");
  tokenGenerated = true;
}

const localDaemonToken = process.env.CR_CONNECTOR_DAEMON_TOKEN ?? (await readLocalDaemonToken());
const announcementUrl = resolveAnnouncementUrl();
const updateBranch =
  process.env.DESKRELAY_UPDATE_BRANCH ?? (await readCurrentGitBranch(process.cwd())) ?? "main";
const updateNotice =
  process.env.DESKRELAY_UPDATE_NOTICE === "0"
    ? undefined
    : createGitUpdateNoticeSource({
        repoRoot: process.cwd(),
        branch: updateBranch,
        ...(process.env.DESKRELAY_NEXT_VERSION
          ? { nextVersion: process.env.DESKRELAY_NEXT_VERSION }
          : {}),
        ...(process.env.SITE_ANNOUNCEMENT_POLL_MS
          ? { pollMs: Number(process.env.SITE_ANNOUNCEMENT_POLL_MS) }
          : {}),
      });
const deviceRegistryFile = process.env.CR_SITE_DEVICE_REGISTRY_FILE ?? defaultDeviceRegistryFile();
const selfServerRoot = process.env.CR_NAS_DEV_ROOT ?? join(process.cwd(), ".self-server");
const logDir = process.env.CR_DEV_LOG_DIR ?? join(selfServerRoot, "logs");
const processFile =
  process.env.CR_DEV_PROCESS_FILE ?? join(selfServerRoot, "state", "dev-processes.json");
const managerAssistantCwd =
  cleanEnv(process.env.DESKRELAY_MANAGER_CWD) ?? cleanEnv(process.env.DESKRELAY_MANAGER_REPO_ROOT);
const registry = deviceRegistryFile
  ? new JsonFileDeviceRegistry(deviceRegistryFile)
  : new InMemoryDeviceRegistry();
const selfServerAutostart = createPowerShellSelfServerAutostartController({
  repoRoot: process.cwd(),
  root: selfServerRoot,
});

const app = createSiteApp({
  registry,
  ...(token ? { token } : {}),
  ...(process.env.SITE_ANNOUNCEMENT ? { announcement: process.env.SITE_ANNOUNCEMENT } : {}),
  ...(announcementUrl ? { announcementUrl } : {}),
  ...(process.env.SITE_ANNOUNCEMENT_POLL_MS
    ? { announcementPollMs: Number(process.env.SITE_ANNOUNCEMENT_POLL_MS) }
    : {}),
  ...(updateNotice ? { updateNotice } : {}),
  ...(localDaemonToken ? { localDaemonToken } : {}),
  ...(process.env.CR_DEV_FRONTEND_URL ? { selfHostUrl: process.env.CR_DEV_FRONTEND_URL } : {}),
  ...(managerAssistantCwd ? { managerAssistant: { cwd: managerAssistantCwd } } : {}),
  selfServerAutostart,
  selfServerProcess: createPowerShellSelfServerProcessController({
    repoRoot: process.cwd(),
    root: selfServerRoot,
    processFile,
    logDir,
    autostartStatus: () => selfServerAutostart.status(),
  }),
  selfServerUpdater: createPowerShellSelfServerUpdater({
    repoRoot: process.cwd(),
    root: selfServerRoot,
    branch: updateBranch,
  }),
  installReportStore: createJsonInstallReportStore(
    join(selfServerRoot, "state", "install-reports.json"),
  ),
  deviceUpdateQueue: createJsonDeviceUpdateQueueStore(
    join(selfServerRoot, "state", "device-update-queue.json"),
  ),
  managerTaskStore: createJsonManagerTaskStore(join(selfServerRoot, "state", "manager-tasks.json")),
  logDir,
});

const server = Bun.serve({
  hostname: host,
  port,
  idleTimeout: idleTimeoutSeconds,
  fetch: app.fetch,
});

const listening = { host: server.hostname ?? host, port: server.port ?? port };
console.log(JSON.stringify({ event: "listening", ...listening }));
if (tokenGenerated) {
  console.log(
    JSON.stringify({
      event: "auth-token-generated",
      hint: "set CR_SITE_TOKEN to keep this token stable between restarts",
      token,
    }),
  );
}
console.log(
  JSON.stringify({
    event: "features",
    mode: "self-host",
    tokenAuth: Boolean(token),
    directDeviceUrls: true,
  }),
);

const shutdown = async (signal: string) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: `received ${signal}, shutting down`,
    })}\n`,
  );
  server.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function readLocalDaemonToken(): Promise<string | undefined> {
  const path = process.env.CR_CONNECTOR_AUTH_FILE ?? defaultAuthFilePath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

async function readCurrentGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 2_000,
    });
    const branch = stdout.trim();
    if (branch) return branch;
  } catch {
    // Fall back below.
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 2_000,
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

function resolveAnnouncementUrl(): string | undefined {
  const raw = process.env.SITE_ANNOUNCEMENT_URL;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "0" || trimmed.toLowerCase() === "false") return undefined;
  return trimmed;
}

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function defaultDeviceRegistryFile(): string | undefined {
  if (process.env.CR_SITE_TOKEN_FILE) {
    return join(dirname(process.env.CR_SITE_TOKEN_FILE), "state", "site-devices.json");
  }
  if (process.env.CR_NAS_DEV_ROOT) {
    return join(process.env.CR_NAS_DEV_ROOT, "state", "site-devices.json");
  }
  return undefined;
}

function defaultAuthFilePath(): string {
  if (process.platform === "win32") {
    const appData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(appData, "DeskRelay", "site-auth.json");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "DeskRelay", "site-auth.json");
  }
  const xdg = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(xdg, "deskrelay", "site-auth.json");
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
