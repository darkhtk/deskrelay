import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  type DiagnosticCheck,
  type DiagnosticReport,
  type DiagnosticSeverity,
  type DiagnosticStep,
  MANAGER_API_VERSION,
  type ManagerAssistantChatContext,
  type ManagerAssistantChatMessage,
  type ManagerAssistantChatRequest,
  type ManagerAssistantChatResponse,
  type ManagerAssistantDecisionOption,
  type ManagerAssistantStatusReport,
  type ManagerAssistantStatusReportInput,
  type ManagerAssistantStatusReportLevel,
  type ManagerAssistantStatusReportPhase,
  type ManagerAssistantStatusReportResponse,
  type ManagerAssistantStreamEvent,
  type ManagerAssistantStreamStatus,
  type ManagerAssistantStructuredState,
  type ManagerCapabilities,
  type ManagerDeviceActions,
  type ManagerInstallStatus,
  type ManagerLogResponse,
  type ManagerNetworkAddress,
  type ManagerNetworkKind,
  type ManagerNetworkStatus,
  type ManagerRegistrationDiagnosis,
  type ManagerRouteCapability,
  type ManagerSecurityBoundary,
  type ManagerSecurityBoundarySummary,
  type ManagerSystemSummary,
  type ManagerTask,
  type ManagerTaskKind,
  type ManagerTaskLogResponse,
  type ManagerTaskObservationResponse,
  type ManagerTaskRequest,
  type ManagerTaskState,
  type ManagerTaskStreamEvent,
  type ManagerUpdatePlan,
  type ManagerUpdateStatus,
  type ManagerUpdateTargetStatus,
  type ManagerWorkerCheckResult,
  type ManagerWorkerListResponse,
  type ManagerWorkerProfile,
  type UpdateState,
  diagnosticStepFromCheck,
  normalizeDiagnosticStep,
} from "@deskrelay/shared";
import { type DeskRelayBuildInfo, getDeskRelayBuildInfo } from "@deskrelay/shared/version";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import {
  type Device,
  type DeviceRegistry,
  DeviceRegistryError,
  normalizeDaemonUrl,
} from "./device-registry.ts";
import type {
  DeviceUpdateQueueStore,
  StoredDeviceUpdateEntry,
} from "./device-update-queue-store.ts";
import { loc } from "./i18n.ts";
import type { InstallReportStore } from "./install-report-store.ts";
import { type ManagerTaskStore, createInMemoryManagerTaskStore } from "./manager-task-store.ts";
import type {
  SelfServerAutostartController,
  SelfServerAutostartStatus,
} from "./self-server-autostart.ts";
import type { SelfServerProcessController } from "./self-server-process.ts";
import type { SelfServerUpdater } from "./self-server-update.ts";
import type { UpdateNoticeSource } from "./update-notice.ts";

export interface SiteAppOptions {
  registry: DeviceRegistry;
  token?: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  version?: string;
  build?: DeskRelayBuildInfo;
  announcement?: string;
  announcementUrl?: string;
  announcementPollMs?: number;
  updateNotice?: UpdateNoticeSource;
  localDaemonToken?: string;
  selfHostUrl?: string;
  selfServerAutostart?: SelfServerAutostartController;
  selfServerProcess?: SelfServerProcessController;
  selfServerUpdater?: SelfServerUpdater;
  updateBranch?: string;
  installReportStore?: InstallReportStore;
  deviceUpdateQueue?: DeviceUpdateQueueStore;
  managerTaskStore?: ManagerTaskStore;
  managerAssistant?: ManagerAssistantOptions;
  managerWorkers?: ManagerWorkerProfileConfig[];
  logDir?: string;
}

export interface ManagerAssistantRunInput {
  message: string;
  history: ManagerAssistantChatMessage[];
  context: ManagerAssistantChatContext | undefined;
  assistantState?: ManagerAssistantStructuredState;
  managerSessionId?: string;
  cwd: string;
  repoRoot: string;
  instructionsPath: string;
  apiBaseUrl: string;
}

export interface ManagerAssistantRunResult {
  text: string;
  command: string;
  sessionId?: string;
}

export interface ManagerAssistantOptions {
  cwd?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  runner?: (input: ManagerAssistantRunInput) => Promise<ManagerAssistantRunResult>;
}

export interface ManagerAssistantWorkspaceResponse {
  cwd: string;
  instructionsPath: string;
  repoRoot: string;
  deviceId?: string;
  deviceLabel?: string;
}

export interface ManagerWorkerProfileConfig {
  id: string;
  label: string;
  description: string;
  command: string;
  args?: string[];
  checkCommand?: string;
  checkArgs?: string[];
  destructive?: boolean;
  defaultTimeoutMs?: number;
  available?: boolean;
  runMode?: "argument" | "stdin";
  roles?: string[];
  risk?: ManagerWorkerProfile["risk"];
}

const DEFAULT_CONNECTOR_PORT = 18091;
const CONNECTOR_CLEANUP_TIMEOUT_MS = 5_000;
const DEFAULT_MANAGER_ASSISTANT_TIMEOUT_MS = 600_000;
const MAX_MANAGER_ASSISTANT_TIMEOUT_MS = 1_800_000;
const MANAGER_ASSISTANT_DIR = ".deskrelay/manager-assistant";
const MANAGER_ASSISTANT_INSTRUCTIONS_FILE = "CLAUDE.md";
const MANAGER_ASSISTANT_STATUS_FILE = "status-reports.json";
const MANAGER_ASSISTANT_STATUS_LIMIT = 50;

export function createSiteApp(options: SiteAppOptions): Hono {
  const app = new Hono();
  const fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]> =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const registry = options.registry;
  const localToken = options.localDaemonToken;
  const announcements = createAnnouncementSource(options, fetchImpl);
  const build = options.build ?? getDeskRelayBuildInfo();
  const managerTaskStore = options.managerTaskStore ?? createInMemoryManagerTaskStore();
  const managerTaskStoreRecovery = recoverStaleManagerTasks(managerTaskStore, build).catch(
    () => undefined,
  );

  async function ensureManagerTaskStoreRecovered(): Promise<void> {
    await managerTaskStoreRecovery;
  }

  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      version: options.version ?? build.version,
      build,
      devices: registry.list().length,
    }),
  );

  app.get("/api/announcement", async (c) => {
    const updatePayload = await readUpdateNotice(options.updateNotice);
    const operatorPayload = announcementPayload(await announcements.read());
    return c.json(combineAnnouncementPayloads(updatePayload, operatorPayload));
  });

  if (options.token) {
    app.use("/api/*", async (c, next) => {
      const path = new URL(c.req.url).pathname;
      if (path === "/api/announcement") return await next();
      return await bearerAuth({ token: options.token ?? "" })(c, next);
    });
  }

  app.get("/api/capabilities", (c) => c.json(serverCapabilities(options)));

  app.use("/api/manager/*", async (_c, next) => {
    await ensureManagerTaskStoreRecovered();
    await next();
  });

  app.get("/api/manager/assistant/workspace", async (c) => {
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const apiBaseUrl = managerAssistantApiBaseUrl(options, c.req.url);
      const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
      const device = registry.list().find(isServerDevice);
      const response: ManagerAssistantWorkspaceResponse = {
        cwd: workspace.cwd,
        instructionsPath: workspace.instructionsPath,
        repoRoot,
        ...(device ? { deviceId: device.id, deviceLabel: device.label } : {}),
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/manager/assistant/status", async (c) => {
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const limit = clampListLimit(c.req.query("limit"));
      return c.json(await readManagerAssistantStatusReports(repoRoot, limit));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/manager/assistant/status", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerAssistantStatusReportInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      return c.json(await appendManagerAssistantStatusReport(repoRoot, parsed.value), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/manager/sessions/read", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerSessionReadRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = await readManagerSessionTranscript(fetchImpl, registry, localToken, parsed.value);
    if (!result.ok) {
      return c.json(
        { error: result.error, attempts: result.attempts },
        result.status as never,
      );
    }
    return c.json(result.value);
  });

  app.get("/api/manager/tasks", async (c) => {
    return c.json({
      tasks: (await managerTaskStore.list(clampListLimit(c.req.query("limit")))).map(
        sanitizeManagerTaskForAssistant,
      ),
    });
  });

  app.post("/api/manager/tasks", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const request = parseManagerTaskRequest(body);
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/tasks/:id/logs", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(sanitizeManagerTaskLogForAssistant(buildManagerTaskLogResponse(task)));
  });

  app.get("/api/manager/tasks/:id/observe", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(buildManagerTaskObservation(task));
  });

  app.get("/api/manager/tasks/:id/stream", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return streamManagerTaskObservation(managerTaskStore, task.id);
  });

  app.post("/api/manager/tasks/:id/cancel", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    const cancelled = await cancelManagerTask(task, managerTaskStore, options.deviceUpdateQueue);
    if (!cancelled.ok) {
      return c.json(
        {
          error: cancelled.error ?? "task cannot be cancelled",
          task: sanitizeManagerTaskForAssistant(task),
        },
        409,
      );
    }
    return c.json(sanitizeManagerTaskForAssistant(cancelled.task), 202);
  });

  app.post("/api/manager/tasks/:id/retry", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    const retry = buildRetryManagerTaskRequest(task);
    if (!retry.ok) {
      return c.json({ error: retry.error, task: sanitizeManagerTaskForAssistant(task) }, 409);
    }
    const completed = await createAndRunManagerTask({
      request: retry.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/tasks/:id", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(sanitizeManagerTaskForAssistant(task));
  });

  app.post("/api/manager/assistant/chat", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const request = parseManagerAssistantChatRequest(body);
    if (!request.ok) return c.json({ error: request.error }, 400);
    try {
      return c.json(await runManagerAssistantChat(request.value, options, c.req.url));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/manager/assistant/chat/stream", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const request = parseManagerAssistantChatRequest(body);
    if (!request.ok) return c.json({ error: request.error }, 400);
    return streamManagerAssistantChat(request.value, options, c.req.url);
  });

  app.get("/api/manager/workers", (c) => {
    return c.json(buildManagerWorkerList(options));
  });

  app.get("/api/manager/workers/:id", (c) => {
    const profile = findManagerWorkerProfile(options, c.req.param("id"));
    if (!profile) return c.json({ error: "unknown worker profile" }, 404);
    return c.json(profile);
  });

  app.post("/api/manager/workers/:id/check", async (c) => {
    const profile = findManagerWorkerProfile(options, c.req.param("id"));
    if (!profile) return c.json({ error: "unknown worker profile" }, 404);
    return c.json(await checkManagerWorkerProfile(profile));
  });

  app.post("/api/manager/workers/run", async (c) => {
    const request = await parseManagerWorkerRunRequest(c.req);
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken: options.localDaemonToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/audit-log", async (c) => {
    return c.json({
      entries: (await managerTaskStore.list(clampListLimit(c.req.query("limit")))).map(
        sanitizeManagerTaskForAssistant,
      ),
    });
  });

  app.get("/api/manager/system/summary", async (c) => {
    return c.json(
      await buildManagerSystemSummary({
        options,
        fetchImpl,
        registry,
        localToken,
        build,
        requestUrl: c.req.url,
        store: managerTaskStore,
      }),
    );
  });

  app.get("/api/manager/devices/:id/actions", (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(buildManagerDeviceActions(device));
  });

  app.get("/api/manager/update/plan", async (c) => {
    return c.json(
      await buildManagerUpdatePlan({ options, registry, build, fetchImpl, localToken }),
    );
  });

  app.get("/api/manager/update/status", async (c) => {
    return c.json(
      await buildManagerUpdateStatus({
        options,
        fetchImpl,
        registry,
        localToken,
        build,
      }),
    );
  });

  app.post("/api/manager/update/all", async (c) => {
    const request = await parseManagerShortcutRequest(c.req, "update-all");
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/registration/last-failure", async (c) => {
    return c.json(await analyzeLastRegistrationFailure(options.installReportStore));
  });

  app.get("/api/manager/registration/diagnose", async (c) => {
    return c.json(
      await buildManagerRegistrationDiagnosis({
        options,
        requestUrl: c.req.url,
      }),
    );
  });

  app.post("/api/manager/registration/repair", async (c) => {
    const request = await parseManagerShortcutRequest(c.req, "repair-registration");
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/security/boundary", async (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(
      await buildManagerSecurityBoundarySummary({
        options,
        fetchImpl,
        registry,
        localToken,
        urls,
      }),
    );
  });

  app.get("/api/devices", (c) => c.json(registry.list().map(toPublicDevice)));

  app.get("/api/devices/update-queue", async (c) => {
    const entries = options.deviceUpdateQueue ? await options.deviceUpdateQueue.list() : [];
    const fallbackCommand = buildFallbackRegisterCommandForRequest(options, c.req.url);
    return c.json({
      entries: entries.map((entry) => enrichDeviceUpdateQueueEntry(entry, fallbackCommand)),
    });
  });

  app.get("/api/self/register-other-pc-command", (c) => {
    if (!options.token) {
      return c.json({ error: "Site token is not configured" }, 404);
    }
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    const preferredUrl = pickRemoteAccessUrl(urls);
    return c.json({
      preferredUrl,
      serverPort: getUrlPort(preferredUrl),
      connectorPort: DEFAULT_CONNECTOR_PORT,
      siteToken: options.token,
      urls,
      command: buildRegisterOtherPcCommand({
        siteUrl: preferredUrl,
        siteToken: options.token,
        branch: resolveServerUpdateBranch(options),
      }),
    });
  });

  app.get("/api/self/remove-other-pc-command", (c) => {
    if (!options.token) {
      return c.json({ error: "Site token is not configured" }, 404);
    }
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    const preferredUrl = pickRemoteAccessUrl(urls);
    return c.json({
      preferredUrl,
      serverPort: getUrlPort(preferredUrl),
      connectorPort: DEFAULT_CONNECTOR_PORT,
      siteToken: options.token,
      urls,
      command: buildRemoveOtherPcCommand({
        siteUrl: preferredUrl,
        siteToken: options.token,
      }),
    });
  });

  app.get("/api/self/doctor", async (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(
      await buildServerDiagnosticReport({
        fetchImpl,
        registry,
        token: options.token,
        localToken,
        build,
        urls,
      }),
    );
  });

  app.get("/api/self/logs", async (c) => {
    const source = normalizeSelfLogSource(c.req.query("source"));
    if (!source) return c.json({ error: "unsupported log source" }, 400);
    const level = normalizeLogLevel(c.req.query("level"));
    return c.json(
      await readLogResponse({
        scope: "server",
        source,
        path: selfLogPath(options, source),
        tail: clampTail(c.req.query("tail")),
        ...(level ? { level } : {}),
      }),
    );
  });

  app.get("/api/self/process/status", async (c) => {
    if (!options.selfServerProcess) {
      return c.json(defaultSelfProcessStatus(build));
    }
    try {
      return c.json(await options.selfServerProcess.status());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/self/process/restart", async (c) => {
    if (!options.selfServerProcess) {
      return c.json(
        {
          supported: false,
          accepted: false,
          message: "self-server restart is not configured",
          error: "self-server restart is not configured",
        },
        501,
      );
    }
    try {
      const result = await options.selfServerProcess.restart();
      return c.json(result, result.accepted ? 202 : 409);
    } catch (err) {
      return c.json(
        {
          supported: true,
          accepted: false,
          message: "self-server restart failed",
          error: (err as Error).message,
        },
        500,
      );
    }
  });

  app.get("/api/self/network/status", async (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(buildSelfNetworkStatus(urls));
  });

  app.get("/api/self/install/status", async (c) => {
    return c.json(await buildSelfInstallStatus(options, build));
  });

  app.get("/api/self/security/boundary", (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(buildSelfSecurityBoundary(options, urls));
  });

  app.get("/api/self/autostart", async (c) => {
    return c.json(await readSelfServerAutostartStatus(options.selfServerAutostart));
  });

  app.put("/api/self/autostart", async (c) => {
    if (!options.selfServerAutostart) {
      return c.json(
        {
          supported: false,
          installed: false,
          taskName: "DeskRelay Self Server",
          error: "self server autostart is not configured",
        },
        501,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const enabled =
      typeof body === "object" && body ? (body as { enabled?: unknown }).enabled : null;
    if (typeof enabled !== "boolean") {
      return c.json({ error: "enabled boolean is required" }, 400);
    }
    try {
      return c.json(await options.selfServerAutostart.setEnabled(enabled));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/self/update", async (c) => {
    if (!options.selfServerUpdater) {
      return c.json(
        {
          supported: false,
          started: false,
          error: "self server updater is not configured",
        },
        501,
      );
    }
    try {
      const result = await options.selfServerUpdater.update();
      if (result.started) return c.json(result, 202);
      if (!result.supported) return c.json(result, 501);
      if (result.status?.state === "running") return c.json(result, 409);
      return c.json(result, 500);
    } catch (err) {
      return c.json({ supported: true, started: false, error: (err as Error).message }, 500);
    }
  });

  app.get("/api/self/update/status", async (c) => {
    if (!options.selfServerUpdater) {
      return c.json({ state: "idle" });
    }
    try {
      return c.json(await options.selfServerUpdater.status());
    } catch (err) {
      return c.json({ state: "failed", error: (err as Error).message }, 500);
    }
  });

  app.get("/api/self/install-reports", async (c) => {
    if (!options.installReportStore) return c.json({ reports: [] });
    const limit = Number(new URL(c.req.url).searchParams.get("limit") ?? "10");
    return c.json({ reports: await options.installReportStore.list(limit) });
  });

  app.post("/api/self/install-reports", async (c) => {
    if (!options.installReportStore) {
      return c.json({ error: "install report store is not configured" }, 501);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    return c.json(await options.installReportStore.add(body), 201);
  });

  app.post("/api/devices", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "body must be an object" }, 400);
    }
    const input = body as Record<string, unknown>;
    if (typeof input.daemonUrl !== "string") {
      return c.json({ error: "daemonUrl is required" }, 400);
    }
    try {
      const daemonUrl = normalizeDaemonUrl(input.daemonUrl);
      const authToken =
        typeof input.authToken === "string" && input.authToken.trim()
          ? input.authToken.trim()
          : localToken;
      const probe = await probeDaemonStatus(fetchImpl, daemonUrl, authToken);
      if (!probe.ok) {
        return c.json({ error: probe.error }, probe.status as never);
      }
      const device = registry.register({
        daemonUrl,
        ...(typeof input.label === "string" ? { label: input.label } : {}),
        ...(authToken ? { authToken } : {}),
        ...(typeof input.deviceKey === "string" ? { deviceKey: input.deviceKey } : {}),
      });
      await options.deviceUpdateQueue?.remove(device.id).catch(() => undefined);
      return c.json(toPublicDevice(device), 201);
    } catch (err) {
      if (err instanceof DeviceRegistryError) {
        return c.json({ error: err.message }, err.status as never);
      }
      throw err;
    }
  });

  app.patch("/api/devices/:id", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const label = typeof body === "object" && body ? (body as { label?: unknown }).label : null;
    if (typeof label !== "string") return c.json({ error: "label is required" }, 400);
    try {
      const updated = registry.rename(id, label);
      if (!updated) return c.json({ error: `unknown device: ${id}` }, 404);
      return c.json(toPublicDevice(updated));
    } catch (err) {
      if (err instanceof DeviceRegistryError) {
        return c.json({ error: err.message }, err.status as never);
      }
      throw err;
    }
  });

  app.delete("/api/devices", async (c) => {
    const devices = orderDevicesForRemoval(registry.list());
    const cleanup = [];
    for (const device of devices) {
      cleanup.push(await unregisterDeviceWithCleanup(fetchImpl, registry, device, localToken));
      await options.deviceUpdateQueue?.remove(device.id);
    }
    return c.json({ ok: true, cleanup });
  });

  app.delete("/api/devices/:id", async (c) => {
    const id = c.req.param("id");
    const device = registry.get(id);
    if (!device) return c.json({ error: `unknown device: ${id}` }, 404);
    const result = await unregisterDeviceWithCleanup(fetchImpl, registry, device, localToken);
    await options.deviceUpdateQueue?.remove(device.id);
    return c.json({ ok: true, cleanup: result.cleanup });
  });

  app.get("/api/devices/:id/behaviors", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/behaviors`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/capabilities", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/capabilities`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/logs", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const qs = new URLSearchParams();
    qs.set("source", c.req.query("source") ?? "connector");
    qs.set("tail", String(clampTail(c.req.query("tail"))));
    const level = normalizeLogLevel(c.req.query("level"));
    if (level) qs.set("level", level);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/logs?${qs.toString()}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/process/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/process/status`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/process/restart", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/process/restart`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/network/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceNetworkStatus(fetchImpl, device, daemonToken(device, localToken)),
    );
  });

  app.get("/api/devices/:id/install/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceInstallStatus(
        fetchImpl,
        device,
        daemonToken(device, localToken),
        options.deviceUpdateQueue,
      ),
    );
  });

  app.get("/api/devices/:id/security/boundary", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceSecurityBoundary(fetchImpl, device, daemonToken(device, localToken)),
    );
  });

  app.post("/api/devices/:id/behaviors/load", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/behaviors/load`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.delete("/api/devices/:id/behaviors/:instance", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "DELETE",
      `${device.daemonUrl}/behaviors/${encodeURIComponent(c.req.param("instance"))}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/behaviors/:instance/request", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const body = await c.req.text();
    const prepared = await prepareBehaviorRequestBodyForProxy(body, {
      device,
      options,
      requestUrl: c.req.url,
    });
    if (!prepared.ok) return c.json({ error: prepared.error }, prepared.status as never);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/behaviors/${encodeURIComponent(c.req.param("instance"))}/request`,
      prepared.body,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/events/spaces/:spaceId/stream", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const headers: Record<string, string> = {};
    const lastEventId = c.req.header("Last-Event-ID");
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;
    const authToken = daemonToken(device, localToken);
    if (authToken) headers.authorization = `Bearer ${authToken}`;

    let upstream: Response;
    try {
      upstream = await fetchImpl(
        `${device.daemonUrl}/events/spaces/${encodeURIComponent(c.req.param("spaceId"))}/stream`,
        { headers },
      );
    } catch (err) {
      return c.json({ error: `cannot reach daemon: ${(err as Error).message}` }, 502);
    }
    if (!upstream.ok || !upstream.body) {
      return c.json(
        {
          error:
            upstream.status === 503
              ? loc(c.req.header("accept-language"), "be.daemon.offline")
              : `upstream daemon returned ${upstream.status}`,
        },
        upstream.status as never,
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.get("/api/devices/:id/fs/list", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const qs = new URLSearchParams();
    qs.set("path", c.req.query("path") ?? "");
    if (c.req.query("workspaceScope") === "unrestricted") {
      qs.set("workspaceScope", "unrestricted");
    }
    if (parseQueryBoolean(c.req.query("includeFiles") ?? "")) {
      qs.set("includeFiles", "1");
    }
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/fs/list?${qs.toString()}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/fs/mkdir", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/fs/mkdir`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/fs/roots", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/fs/roots`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/files/preview", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const qs = new URLSearchParams();
    qs.set("path", c.req.query("path") ?? "");
    const cwd = c.req.query("cwd") ?? "";
    if (cwd) qs.set("cwd", cwd);
    return proxyBinary(
      fetchImpl,
      `${device.daemonUrl}/files/preview?${qs.toString()}`,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/git/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/git/status?cwd=${encodeURIComponent(c.req.query("cwd") ?? "")}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/instructions", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/instructions?cwd=${encodeURIComponent(c.req.query("cwd") ?? "")}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.put("/api/devices/:id/instructions/:scope", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "PUT",
      `${device.daemonUrl}/instructions/${encodeURIComponent(c.req.param("scope"))}`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.delete("/api/devices/:id/instructions/:scope", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "DELETE",
      `${device.daemonUrl}/instructions/${encodeURIComponent(c.req.param("scope"))}`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/diagnostics", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const token = daemonToken(device, localToken);
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let upstream: Response;
    try {
      upstream = await fetchImpl(`${device.daemonUrl}/status`, { method: "GET", headers });
    } catch (err) {
      return c.json({ error: `cannot reach daemon: ${(err as Error).message}` }, 502);
    }
    const text = await upstream.text();
    if (upstream.ok && options.deviceUpdateQueue) {
      const fallbackCommand = buildFallbackRegisterCommandForRequest(options, c.req.url);
      void retryQueuedDeviceSystemUpdate(
        fetchImpl,
        device,
        token,
        fallbackCommand,
        options.deviceUpdateQueue,
        resolveServerUpdateBranch(options),
      ).catch(() => undefined);
    }
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  });

  app.post("/api/devices/:id/system/update", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const fallbackCommand = buildFallbackRegisterCommandForRequest(options, c.req.url);
    return await requestDaemonSystemUpdate(
      fetchImpl,
      device,
      daemonToken(device, localToken),
      fallbackCommand,
      options.deviceUpdateQueue,
      resolveServerUpdateBranch(options),
    );
  });

  app.get("/api/devices/:id/doctor", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceDiagnosticReport({
        fetchImpl,
        registry,
        device,
        localToken,
        serverBuild: build,
      }),
    );
  });

  app.post("/api/devices/:id/approvals/respond", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/hooks/pretooluse/respond`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/approvals/simulate", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/hooks/pretooluse/simulate`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  return app;
}

interface AnnouncementPayload {
  message: string;
  level?: "info" | "warning";
  until?: string;
}

interface AnnouncementSource {
  read: () => Promise<string>;
}

const DEFAULT_ANNOUNCEMENT_POLL_MS = 5 * 60 * 1000;
const MAX_ANNOUNCEMENT_CHARS = 2000;

function createAnnouncementSource(
  options: SiteAppOptions,
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
): AnnouncementSource {
  const inlineAnnouncement = (options.announcement ?? "").trim();
  const url = (options.announcementUrl ?? "").trim();
  const pollMs =
    typeof options.announcementPollMs === "number" && options.announcementPollMs > 0
      ? options.announcementPollMs
      : DEFAULT_ANNOUNCEMENT_POLL_MS;
  let cachedRemoteAnnouncement = "";
  let inflight: Promise<void> | null = null;

  async function refreshRemoteAnnouncement(): Promise<void> {
    if (!url) return;
    if (inflight) return await inflight;
    inflight = (async () => {
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json, text/plain, */*" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const text = (await res.text()).trim();
        cachedRemoteAnnouncement = text.slice(0, MAX_ANNOUNCEMENT_CHARS);
      } catch {
        // Keep the last successful announcement. A failed poll should not
        // blank the banner while the user's self-host server is offline.
      } finally {
        inflight = null;
      }
    })();
    return await inflight;
  }

  if (url) {
    void refreshRemoteAnnouncement();
    const timer = setInterval(() => void refreshRemoteAnnouncement(), pollMs);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    read: async () => {
      if (inlineAnnouncement) return inlineAnnouncement;
      if (url && !cachedRemoteAnnouncement) await refreshRemoteAnnouncement();
      return cachedRemoteAnnouncement;
    },
  };
}

function announcementPayload(rawInput: string): AnnouncementPayload {
  const empty = { message: "" };
  const raw = rawInput.trim();
  if (!raw) return empty;

  let parsed: { message?: unknown; until?: unknown; level?: unknown } | null = null;
  if (raw.startsWith("{")) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const message = parsed && typeof parsed.message === "string" ? parsed.message.trim() : raw;
  if (!message) return empty;
  const level =
    parsed && (parsed.level === "info" || parsed.level === "warning") ? parsed.level : "info";

  if (parsed && typeof parsed.until === "string") {
    const expiry = Date.parse(parsed.until);
    if (Number.isFinite(expiry) && expiry <= Date.now()) return empty;
    return { message, level, until: parsed.until };
  }
  return { message, level };
}

async function readUpdateNotice(
  source: UpdateNoticeSource | undefined,
): Promise<AnnouncementPayload | null> {
  if (!source) return null;
  try {
    const payload = await source.read();
    if (!payload?.message.trim()) return null;
    return {
      message: payload.message.trim(),
      level: payload.level === "warning" ? "warning" : "info",
    };
  } catch {
    return {
      message: "현재 버젼 확인 실패",
      level: "warning",
    };
  }
}

function combineAnnouncementPayloads(
  updatePayload: AnnouncementPayload | null,
  operatorPayload: AnnouncementPayload,
): AnnouncementPayload {
  if (!updatePayload?.message.trim()) return operatorPayload;
  if (!operatorPayload.message.trim()) return updatePayload;
  const messages = [updatePayload?.message, operatorPayload.message].filter(
    (message): message is string => Boolean(message?.trim()),
  );
  if (messages.length === 0) return { message: "" };
  return {
    message: messages.join(" · "),
    level:
      updatePayload?.level === "warning" || operatorPayload.level === "warning"
        ? "warning"
        : "info",
  };
}

async function readSelfServerAutostartStatus(
  controller: SelfServerAutostartController | undefined,
): Promise<SelfServerAutostartStatus> {
  if (!controller) {
    return {
      supported: false,
      installed: false,
      taskName: "DeskRelay Self Server",
      error: "self server autostart is not configured",
    };
  }
  try {
    return await controller.status();
  } catch (err) {
    return {
      supported: false,
      installed: false,
      taskName: "DeskRelay Self Server",
      error: (err as Error).message,
    };
  }
}

const SERVER_STARTED_AT = new Date().toISOString();

const SITE_ROUTE_CAPABILITIES = [
  { method: "GET", path: "/healthz", description: "Read server version and basic health." },
  { method: "GET", path: "/api/announcement", description: "Read the public update notice." },
  { method: "GET", path: "/api/capabilities", description: "List server API capabilities." },
  { method: "GET", path: "/api/manager/tasks", description: "List manager tasks." },
  { method: "POST", path: "/api/manager/tasks", description: "Create a manager task." },
  { method: "GET", path: "/api/manager/tasks/:id", description: "Read one manager task." },
  {
    method: "GET",
    path: "/api/manager/tasks/:id/logs",
    description: "Read task execution log lines.",
  },
  {
    method: "GET",
    path: "/api/manager/tasks/:id/observe",
    description: "Read one manager task with its concise observation summary and log.",
  },
  {
    method: "GET",
    path: "/api/manager/tasks/:id/stream",
    description: "Stream one manager task observation until it reaches a terminal state.",
  },
  {
    method: "POST",
    path: "/api/manager/tasks/:id/cancel",
    description: "Cancel a cancellable manager task.",
  },
  {
    method: "POST",
    path: "/api/manager/tasks/:id/retry",
    description: "Retry a failed, blocked, cancelled, or waiting manager task.",
  },
  {
    method: "POST",
    path: "/api/manager/assistant/chat",
    description: "Send a message to the server-local DeskRelay assistant CLI.",
  },
  {
    method: "POST",
    path: "/api/manager/assistant/chat/stream",
    description: "Stream server-local DeskRelay assistant CLI status and final response.",
  },
  {
    method: "GET",
    path: "/api/manager/assistant/workspace",
    description:
      "Prepare and return the managed server-local Claude workspace used by the DeskRelay assistant.",
  },
  {
    method: "GET",
    path: "/api/manager/assistant/status",
    description: "Read recent manager assistant progress reports.",
  },
  {
    method: "POST",
    path: "/api/manager/assistant/status",
    description: "Write a concise manager assistant progress report for the UI.",
  },
  {
    method: "POST",
    path: "/api/manager/sessions/read",
    description:
      "Read a Claude session transcript by session id, optionally searching registered devices and cwd values.",
  },
  {
    method: "GET",
    path: "/api/manager/workers",
    description: "List server-local worker CLI profiles available to the manager assistant.",
  },
  {
    method: "GET",
    path: "/api/manager/workers/:id",
    description: "Read one server-local worker CLI profile.",
  },
  {
    method: "POST",
    path: "/api/manager/workers/:id/check",
    description: "Check whether a server-local worker CLI profile can start.",
  },
  {
    method: "POST",
    path: "/api/manager/workers/run",
    description: "Create a worker CLI manager task.",
  },
  {
    method: "GET",
    path: "/api/manager/audit-log",
    description: "Read manager task audit log.",
  },
  {
    method: "GET",
    path: "/api/manager/system/summary",
    description: "Read assistant-oriented system summary.",
  },
  {
    method: "GET",
    path: "/api/manager/devices/:id/actions",
    description: "Read safe actions available for a device.",
  },
  {
    method: "GET",
    path: "/api/manager/update/plan",
    description: "Read a server and device update plan.",
  },
  {
    method: "GET",
    path: "/api/manager/update/status",
    description: "Read server and device update status.",
  },
  {
    method: "POST",
    path: "/api/manager/update/all",
    description: "Create an update-all manager task.",
  },
  {
    method: "GET",
    path: "/api/manager/registration/last-failure",
    description: "Analyze the last failed connector registration report.",
  },
  {
    method: "GET",
    path: "/api/manager/registration/diagnose",
    description: "Diagnose current registration prerequisites and the latest failure.",
  },
  {
    method: "POST",
    path: "/api/manager/registration/repair",
    description: "Create a registration repair manager task.",
  },
  {
    method: "GET",
    path: "/api/manager/security/boundary",
    description: "Read server and device security boundary summary.",
  },
  { method: "GET", path: "/api/devices", description: "List registered devices." },
  { method: "POST", path: "/api/devices", description: "Register a device." },
  {
    method: "DELETE",
    path: "/api/devices",
    description: "Remove all registered devices.",
    destructive: true,
  },
  { method: "GET", path: "/api/devices/update-queue", description: "List queued device updates." },
  {
    method: "GET",
    path: "/api/self/register-other-pc-command",
    description: "Generate the other-PC registration command.",
  },
  {
    method: "GET",
    path: "/api/self/remove-other-pc-command",
    description: "Generate the other-PC cleanup command.",
  },
  { method: "GET", path: "/api/self/doctor", description: "Run server diagnostics." },
  { method: "GET", path: "/api/self/logs", description: "Read server stack logs." },
  {
    method: "GET",
    path: "/api/self/process/status",
    description: "Read server process status.",
  },
  {
    method: "POST",
    path: "/api/self/process/restart",
    description: "Restart the self-host server stack.",
  },
  {
    method: "GET",
    path: "/api/self/network/status",
    description: "Read server network status.",
  },
  {
    method: "GET",
    path: "/api/self/install/status",
    description: "Read server install status.",
  },
  {
    method: "GET",
    path: "/api/self/security/boundary",
    description: "Read server token and network boundary summary.",
  },
  { method: "GET", path: "/api/self/autostart", description: "Read server autostart state." },
  {
    method: "PUT",
    path: "/api/self/autostart",
    description: "Enable or disable server autostart.",
  },
  { method: "POST", path: "/api/self/update", description: "Update self-host server." },
  {
    method: "GET",
    path: "/api/self/update/status",
    description: "Read self-host server update status.",
  },
  {
    method: "GET",
    path: "/api/self/install-reports",
    description: "List connector install reports.",
  },
  {
    method: "POST",
    path: "/api/self/install-reports",
    description: "Record a connector install report.",
  },
  { method: "PATCH", path: "/api/devices/:id", description: "Rename one registered device." },
  {
    method: "DELETE",
    path: "/api/devices/:id",
    description: "Remove one registered device.",
    destructive: true,
  },
  {
    method: "GET",
    path: "/api/devices/:id/behaviors",
    description: "List loaded device behaviors.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/capabilities",
    description: "Read device API capabilities.",
  },
  { method: "GET", path: "/api/devices/:id/logs", description: "Read device logs." },
  {
    method: "GET",
    path: "/api/devices/:id/process/status",
    description: "Read device process status.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/process/restart",
    description: "Restart the device connector.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/network/status",
    description: "Read device network status.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/install/status",
    description: "Read device install status.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/security/boundary",
    description: "Read device token, network, and workspace boundary summary.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/behaviors/load",
    description: "Load a device behavior package.",
  },
  {
    method: "DELETE",
    path: "/api/devices/:id/behaviors/:instance",
    description: "Unload a device behavior.",
    destructive: true,
  },
  {
    method: "POST",
    path: "/api/devices/:id/behaviors/:instance/request",
    description: "Call a device behavior method.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/events/spaces/:spaceId/stream",
    description: "Stream behavior events over SSE.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/fs/list",
    description: "List directories. Add includeFiles=1 to include files for verification.",
  },
  { method: "POST", path: "/api/devices/:id/fs/mkdir", description: "Create a directory." },
  { method: "GET", path: "/api/devices/:id/fs/roots", description: "Read workspace root policy." },
  {
    method: "GET",
    path: "/api/devices/:id/files/preview",
    description: "Preview a guarded local file.",
  },
  { method: "GET", path: "/api/devices/:id/git/status", description: "Read Git status for a cwd." },
  {
    method: "GET",
    path: "/api/devices/:id/instructions",
    description: "Read Claude instructions for a cwd.",
  },
  {
    method: "PUT",
    path: "/api/devices/:id/instructions/:scope",
    description: "Write a Claude instruction file.",
  },
  {
    method: "DELETE",
    path: "/api/devices/:id/instructions/:scope",
    description: "Delete a Claude instruction file.",
    destructive: true,
  },
  {
    method: "GET",
    path: "/api/devices/:id/diagnostics",
    description: "Read device diagnostics used by the app.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/system/update",
    description: "Update a device connector.",
  },
  { method: "GET", path: "/api/devices/:id/doctor", description: "Run device diagnostics." },
  {
    method: "POST",
    path: "/api/devices/:id/approvals/respond",
    description: "Resolve a pending Claude tool approval.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/approvals/simulate",
    description: "Create a simulated approval for diagnostics.",
  },
] satisfies ManagerRouteCapability[];

const DESKRELAY_BEHAVIOR_METHODS = [
  "account.info",
  "chat",
  "context.usage",
  "diagnostics",
  "interrupt",
  "permissions.inspect",
  "permissions.update",
  "sessions.delete",
  "sessions.deleteByCwd",
  "sessions.deleteBySessionId",
  "sessions.list",
  "sessions.read",
  "skills.delete",
  "skills.inspect",
  "slashCommands",
  "usage.limits",
];

function serverCapabilities(options: SiteAppOptions): ManagerCapabilities {
  const build = options.build ?? getDeskRelayBuildInfo();
  return {
    scope: "server",
    apiVersion: MANAGER_API_VERSION,
    build,
    platform: process.platform,
    arch: process.arch,
    features: [
      "capabilities",
      "logs",
      "process.status",
      "process.restart",
      "network.status",
      "install.status",
      "security.boundary",
      "manager.tasks",
      "manager.update-plan",
      "manager.update-status",
      "manager.registration-analysis",
      "manager.system-summary",
      "manager.task-control",
      "manager.action-discovery",
      "manager.security-summary",
      "manager.assistant-chat",
      "devices",
      "device.proxy",
      "diagnostics",
      "install.reports",
      "self.update",
      "device.update",
      "autostart",
    ],
    routes: SITE_ROUTE_CAPABILITIES,
    behaviorMethods: DESKRELAY_BEHAVIOR_METHODS,
  };
}

function defaultSelfProcessStatus(build: DeskRelayBuildInfo) {
  return {
    scope: "server",
    kind: "site-server",
    build,
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    uptimeMs: Math.max(0, Date.now() - Date.parse(SERVER_STARTED_AT)),
    platform: process.platform,
    arch: process.arch,
  };
}

interface ManagerTaskRunInput {
  task: ManagerTask;
  request: ManagerTaskRequest;
  store: ManagerTaskStore;
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  requestUrl: string;
}

interface ManagerTaskExecutionResult {
  state: ManagerTaskState;
  steps: ManagerTask["steps"];
  result?: unknown;
  targetLabel?: string;
  error?: string;
}

type ManagerTaskCreateRunInput = Omit<ManagerTaskRunInput, "task">;

async function recoverStaleManagerTasks(
  store: ManagerTaskStore,
  build: DeskRelayBuildInfo,
): Promise<number> {
  const tasks = await store.list(500);
  const stale = tasks.filter((task) => task.state === "pending" || task.state === "running");
  if (stale.length === 0) return 0;
  let recovered = 0;
  for (const task of stale) {
    const summary = `Task was left ${task.state} by a previous server process and cannot be resumed.`;
    const updated = await store.update(task.id, {
      state: "cancelled",
      completedAt: new Date().toISOString(),
      error: `${summary} Retry the task if it is still needed.`,
      steps: [
        ...task.steps,
        taskStep({
          id: "task.recovered-after-restart",
          label: "Task recovered after restart",
          status: "warn",
          summary,
          detail: `Recovered when server ${build.shortCommit} started at ${SERVER_STARTED_AT}.`,
          retrySafe: true,
        }),
      ],
    });
    if (updated) recovered += 1;
  }
  return recovered;
}

async function createAndRunManagerTask(input: ManagerTaskCreateRunInput): Promise<ManagerTask> {
  const task = await input.store.create({
    kind: input.request.kind,
    ...(input.request.targetId ? { targetId: input.request.targetId } : {}),
    ...(input.request.params ? { params: input.request.params } : {}),
    dryRun: input.request.dryRun ?? true,
    requestedBy: input.request.requestedBy ?? "browser",
    steps: [
      taskStep({
        id: "task.created",
        label: "Task accepted",
        status: "pending",
        summary: `${input.request.kind} task accepted`,
      }),
    ],
  });
  return await runManagerTask({ ...input, task });
}

function buildManagerTaskLogResponse(task: ManagerTask): ManagerTaskLogResponse {
  const lines = [
    `[${task.createdAt}] ${task.kind} created by ${task.requestedBy}`,
    ...(task.startedAt ? [`[${task.startedAt}] started`] : []),
    ...task.steps.map(
      (step) =>
        `[${step.lastCheckedAt ?? task.updatedAt}] ${step.status} ${step.id}: ${step.summary}`,
    ),
    ...(task.completedAt ? [`[${task.completedAt}] completed: ${task.state}`] : []),
    ...(task.error ? [`error: ${task.error}`] : []),
  ];
  return {
    taskId: task.id,
    source: "manager-task",
    readAt: new Date().toISOString(),
    lines,
    steps: task.steps,
    ...(task.result !== undefined ? { result: task.result } : {}),
    ...(task.error ? { error: task.error } : {}),
  };
}

function buildManagerTaskObservation(task: ManagerTask): ManagerTaskObservationResponse {
  const log = sanitizeManagerTaskLogForAssistant(buildManagerTaskLogResponse(task));
  const sanitizedTask = sanitizeManagerTaskForAssistant(task);
  const terminal = isManagerTaskTerminalState(sanitizedTask.state);
  return {
    task: sanitizedTask,
    log,
    terminal,
    summary: managerTaskObservationSummary(sanitizedTask),
    nextRead: managerTaskNextRead(sanitizedTask, terminal),
  };
}

function isManagerTaskTerminalState(state: ManagerTaskState): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "blocked" ||
    state === "cancelled" ||
    state === "restart_required"
  );
}

function managerTaskObservationSummary(task: ManagerTask): string {
  const target = task.targetLabel ?? task.targetId ?? "server";
  if (task.state === "succeeded") return `${task.kind} completed for ${target}.`;
  if (task.state === "failed") return `${task.kind} failed for ${target}.`;
  if (task.state === "blocked") return `${task.kind} is blocked for ${target}.`;
  if (task.state === "cancelled") return `${task.kind} was cancelled for ${target}.`;
  if (task.state === "restart_required") return `${task.kind} requires restart for ${target}.`;
  if (task.state === "waiting_for_device") return `${task.kind} is waiting for ${target}.`;
  if (task.state === "running") return `${task.kind} is running for ${target}.`;
  return `${task.kind} is pending for ${target}.`;
}

function managerTaskNextRead(
  task: ManagerTask,
  terminal: boolean,
): ManagerTaskObservationResponse["nextRead"] {
  if (!terminal) return "task-stream";
  if (task.state === "failed" || task.state === "blocked") return "task-log";
  return "none";
}

function streamManagerTaskObservation(store: ManagerTaskStore, taskId: string): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const started = Date.now();
  const maxDurationMs = 120_000;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ManagerTaskStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Client disconnects are fine; this stream is best-effort observation.
        }
      };
      let lastFingerprint = "";
      const poll = async () => {
        try {
          const task = await store.get(taskId);
          if (!task) {
            emit({ type: "error", error: "unknown task" });
            close();
            return;
          }
          const observation = buildManagerTaskObservation(task);
          const fingerprint = managerTaskObservationFingerprint(observation);
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            emit({
              type: observation.terminal ? "done" : "snapshot",
              observation,
            });
          }
          if (observation.terminal || Date.now() - started > maxDurationMs) close();
        } catch (error) {
          emit({ type: "error", error: errorMessage(error) });
          close();
        }
      };
      void poll();
      timer = setInterval(() => {
        void poll();
      }, 1_000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

function managerTaskObservationFingerprint(observation: ManagerTaskObservationResponse): string {
  return [
    observation.task.id,
    observation.task.state,
    observation.task.updatedAt,
    observation.task.steps.length,
    observation.terminal ? "terminal" : "active",
  ].join("|");
}

function sanitizeManagerTaskForAssistant(task: ManagerTask): ManagerTask {
  return redactManagerSensitiveValue(task);
}

function sanitizeManagerTaskLogForAssistant(log: ManagerTaskLogResponse): ManagerTaskLogResponse {
  return redactManagerSensitiveValue(log);
}

function sanitizeDiagnosticStepForAssistant(step: DiagnosticStep): DiagnosticStep {
  return redactManagerSensitiveValue(step);
}

function redactManagerSensitiveValue<T>(value: T): T {
  if (typeof value === "string") return redactManagerSensitiveText(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => redactManagerSensitiveValue(item)) as T;
  }
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactManagerSensitiveValue(item);
  }
  return out as T;
}

function redactManagerSensitiveText(value: string): string {
  return value
    .replace(/(-SiteToken\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
    .replace(/(--site-token(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
    .replace(/(\bSite token:\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
    .replace(/(\bAuthorization\s*[:=]\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(
      /(["']?(?:siteToken|authToken|daemonToken|token)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{16,}(["']?)/gi,
      "$1[redacted]$2",
    );
}

async function runManagerAssistantChat(
  request: ManagerAssistantChatRequest,
  options: SiteAppOptions,
  requestUrl: string,
): Promise<ManagerAssistantChatResponse> {
  const started = Date.now();
  const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
  const apiBaseUrl = managerAssistantApiBaseUrl(options, requestUrl);
  const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
  const cwd = options.managerAssistant?.runner ? repoRoot : workspace.cwd;
  const history = normalizeAssistantHistory(request.history);
  const runner =
    options.managerAssistant?.runner ??
    ((input: ManagerAssistantRunInput) => runDefaultManagerAssistantCli(input, options));
  const input: ManagerAssistantRunInput = {
    message: request.message.trim(),
    history,
    context: request.context,
    cwd,
    repoRoot,
    instructionsPath: workspace.instructionsPath,
    apiBaseUrl,
  };
  if (request.assistantState?.sessionId) input.managerSessionId = request.assistantState.sessionId;
  if (request.assistantState) input.assistantState = request.assistantState;
  const result = await runner(input);
  return {
    cwd,
    command: result.command,
    durationMs: Date.now() - started,
    message: {
      id: `assistant_${randomBytes(10).toString("base64url")}`,
      role: "assistant",
      text: result.text,
      createdAt: new Date().toISOString(),
    },
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
  };
}

function streamManagerAssistantChat(
  request: ManagerAssistantChatRequest,
  options: SiteAppOptions,
  requestUrl: string,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ManagerAssistantStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      void (async () => {
        const started = Date.now();
        try {
          emit(
            managerAssistantStatusEvent({
              phase: "preparing",
              tone: "thinking",
              main: "요청 준비 중",
              detail: "선택 컨텍스트 확인",
            }),
          );
          const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
          const apiBaseUrl = managerAssistantApiBaseUrl(options, requestUrl);
          const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
          const cwd = options.managerAssistant?.runner ? repoRoot : workspace.cwd;
          const history = normalizeAssistantHistory(request.history);
          const input: ManagerAssistantRunInput = {
            message: request.message.trim(),
            history,
            context: request.context,
            cwd,
            repoRoot,
            instructionsPath: workspace.instructionsPath,
            apiBaseUrl,
          };
          if (request.assistantState?.sessionId) {
            input.managerSessionId = request.assistantState.sessionId;
          }
          if (request.assistantState) input.assistantState = request.assistantState;
          const runner = options.managerAssistant?.runner;
          const result = runner
            ? await runCustomManagerAssistantRunner(input, runner, emit)
            : await runDefaultManagerAssistantCliStream(input, options, emit);
          emit({
            type: "message",
            cwd,
            command: result.command,
            durationMs: Date.now() - started,
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
            message: {
              id: `assistant_${randomBytes(10).toString("base64url")}`,
              role: "assistant",
              text: result.text,
              createdAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          emit({ type: "error", error: errorMessage(error) });
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // The client may already have closed the SSE connection.
            }
          }
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

async function runCustomManagerAssistantRunner(
  input: ManagerAssistantRunInput,
  runner: (input: ManagerAssistantRunInput) => Promise<ManagerAssistantRunResult>,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<ManagerAssistantRunResult> {
  emit(
    managerAssistantStatusEvent({
      phase: "running",
      tone: "thinking",
      main: "Assistant 실행 중",
      detail: "테스트 runner",
    }),
  );
  const result = await runner(input);
  emit(
    managerAssistantStatusEvent({
      phase: "finalizing",
      tone: "thinking",
      main: "결과 정리 중",
    }),
  );
  return result;
}

async function runDefaultManagerAssistantCli(
  input: ManagerAssistantRunInput,
  options: SiteAppOptions,
): Promise<ManagerAssistantRunResult> {
  const assistantOptions = options.managerAssistant;
  const command =
    assistantOptions?.command ?? process.env.DESKRELAY_MANAGER_ASSISTANT_CLI ?? "claude";
  const args = managerAssistantSessionArgs(
    managerAssistantStreamArgs(
      command,
      assistantOptions?.args ??
        parseManagerAssistantArgs(process.env.DESKRELAY_MANAGER_ASSISTANT_ARGS),
    ),
    input.managerSessionId,
  );
  const timeoutMs = managerAssistantTimeoutMs(assistantOptions);
  const prompt = buildManagerAssistantPrompt(input);
  const invocation = await prepareManagerAssistantInvocation(command, args, prompt);
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([invocation.command, ...invocation.argv], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: invocation.stdin,
      env: {
        ...process.env,
        ...(options.token ? { DESKRELAY_SITE_TOKEN: options.token } : {}),
        DESKRELAY_MANAGER_API_BASE: input.apiBaseUrl,
        DESKRELAY_MANAGER_ASSISTANT: "1",
        DESKRELAY_MANAGER_ASSISTANT_INSTRUCTIONS: input.instructionsPath,
        DESKRELAY_REPOSITORY_ROOT: input.repoRoot,
      },
    });
  } catch (error) {
    throw new Error(`Could not start manager assistant CLI (${command}): ${errorMessage(error)}`);
  }

  try {
    invocation.writeInput?.(proc);
    const stdout = readManagerAssistantStdout(proc.stdout, () => undefined);
    const stderr = readManagerAssistantStderr(proc.stderr, () => undefined);
    const exitCode = await withTimeout(proc.exited, timeoutMs, () => {
      proc.kill();
    });
    const [stdoutResult, err] = await Promise.all([stdout, stderr]);
    if (exitCode !== 0) {
      throw new Error(
        `Manager assistant CLI exited with code ${exitCode}${err.trim() ? `: ${err.trim()}` : ""}`,
      );
    }
    const finalText = chooseManagerAssistantFinalText(stdoutResult, err);
    if (!finalText.ok) throw new Error(finalText.error);
    return {
      text: finalText.text,
      command: invocation.displayCommand,
      ...(stdoutResult.sessionId ? { sessionId: stdoutResult.sessionId } : {}),
    };
  } finally {
    await invocation.cleanup?.();
  }
}

async function runDefaultManagerAssistantCliStream(
  input: ManagerAssistantRunInput,
  options: SiteAppOptions,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<ManagerAssistantRunResult> {
  const assistantOptions = options.managerAssistant;
  const command =
    assistantOptions?.command ?? process.env.DESKRELAY_MANAGER_ASSISTANT_CLI ?? "claude";
  const baseArgs =
    assistantOptions?.args ??
    parseManagerAssistantArgs(process.env.DESKRELAY_MANAGER_ASSISTANT_ARGS);
  const args = managerAssistantSessionArgs(
    managerAssistantStreamArgs(command, baseArgs),
    input.managerSessionId,
  );
  const timeoutMs = managerAssistantTimeoutMs(assistantOptions);
  const prompt = buildManagerAssistantPrompt(input);
  const invocation = await prepareManagerAssistantInvocation(command, args, prompt);
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  emit(
    managerAssistantStatusEvent({
      phase: "running",
      tone: "thinking",
      main: "Claude CLI 시작 중",
      detail: "관리 assistant",
    }),
  );
  try {
    proc = Bun.spawn([invocation.command, ...invocation.argv], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: invocation.stdin,
      env: {
        ...process.env,
        ...(options.token ? { DESKRELAY_SITE_TOKEN: options.token } : {}),
        DESKRELAY_MANAGER_API_BASE: input.apiBaseUrl,
        DESKRELAY_MANAGER_ASSISTANT: "1",
        DESKRELAY_MANAGER_ASSISTANT_INSTRUCTIONS: input.instructionsPath,
        DESKRELAY_REPOSITORY_ROOT: input.repoRoot,
      },
    });
  } catch (error) {
    throw new Error(`Could not start manager assistant CLI (${command}): ${errorMessage(error)}`);
  }

  try {
    invocation.writeInput?.(proc);
    const stdout = readManagerAssistantStdout(proc.stdout, emit);
    const stderr = readManagerAssistantStderr(proc.stderr, emit);
    const exitCode = await withTimeout(proc.exited, timeoutMs, () => {
      proc.kill();
    });
    const [stdoutResult, stderrText] = await Promise.all([stdout, stderr]);
    if (exitCode !== 0) {
      throw new Error(
        `Manager assistant CLI exited with code ${exitCode}${
          stderrText.trim() ? `: ${stderrText.trim()}` : ""
        }`,
      );
    }
    const finalText = chooseManagerAssistantFinalText(stdoutResult, stderrText);
    if (!finalText.ok) throw new Error(finalText.error);
    emit(
      managerAssistantStatusEvent({
        phase: "finalizing",
        tone: "thinking",
        main: "결과 정리 중",
      }),
    );
    return {
      text: finalText.text,
      command: invocation.displayCommand,
      ...(stdoutResult.sessionId ? { sessionId: stdoutResult.sessionId } : {}),
    };
  } finally {
    await invocation.cleanup?.();
  }
}

interface ManagerAssistantCliInvocation {
  command: string;
  argv: string[];
  stdin: "pipe" | "ignore";
  displayCommand: string;
  writeInput?: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => void;
  cleanup?: () => Promise<void>;
}

async function prepareManagerAssistantInvocation(
  command: string,
  args: string[],
  prompt: string,
): Promise<ManagerAssistantCliInvocation> {
  if (process.platform === "win32" && isDefaultClaudeCommand(command)) {
    const payloadPath = join(
      tmpdir(),
      `deskrelay-manager-payload-${Date.now()}-${randomBytes(6).toString("hex")}.jsonl`,
    );
    const cmdPath = join(
      tmpdir(),
      `deskrelay-manager-${Date.now()}-${randomBytes(6).toString("hex")}.cmd`,
    );
    const argv = managerAssistantStructuredInputArgs(args);
    await writeFile(payloadPath, `${claudeStructuredPromptPayload(prompt)}\n`, "utf8");
    await writeFile(
      cmdPath,
      [
        "@echo off",
        "chcp 65001 >NUL",
        `${[command, ...argv].map(cmdQuote).join(" ")} < ${cmdQuote(payloadPath)}`,
        "exit /b %ERRORLEVEL%",
        "",
      ].join("\r\n"),
      "utf8",
    );
    return {
      command: "cmd.exe",
      argv: ["/d", "/s", "/c", cmdPath],
      stdin: "ignore",
      displayCommand: `${command} ${args.join(" ")}`.trim(),
      cleanup: async () => {
        await Promise.all([
          removeManagerAssistantTempFileBestEffort(payloadPath),
          removeManagerAssistantTempFileBestEffort(cmdPath),
        ]);
      },
    };
  }

  const argv = managerAssistantStructuredInputArgs(args);
  return {
    command,
    argv,
    stdin: "pipe",
    displayCommand: `${command} ${args.join(" ")}`.trim(),
    writeInput: (proc) => writeClaudeStructuredPrompt(proc, prompt),
  };
}

async function removeManagerAssistantTempFileBestEffort(path: string): Promise<void> {
  const retryDelaysMs = [0, 100, 500, 1_500];
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      await rm(path, { force: true });
      return;
    } catch (error) {
      if (!isRetryableTempCleanupError(error)) break;
    }
  }

  const timer = setTimeout(() => {
    void rm(path, { force: true }).catch(() => undefined);
  }, 5_000);
  timer.unref?.();
}

function isRetryableTempCleanupError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDefaultClaudeCommand(command: string): boolean {
  const normalized = command.trim().replaceAll("\\", "/").toLowerCase();
  return (
    normalized === "claude" || normalized.endsWith("/claude") || normalized.endsWith("/claude.cmd")
  );
}

function managerAssistantSessionArgs(args: string[], sessionId: string | undefined): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--resume" || arg === "-r" || arg === "--session-id") {
      index += 1;
      continue;
    }
    if (arg === "--continue" || arg === "-c" || arg === "--fork-session") continue;
    if (arg.startsWith("--resume=") || arg.startsWith("--session-id=") || arg.startsWith("-r=")) {
      continue;
    }
    normalized.push(arg);
  }
  if (sessionId?.trim()) normalized.push("--resume", sessionId.trim());
  return normalized;
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function managerAssistantStreamArgs(command: string, args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--output-format") {
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output-format=")) continue;
    normalized.push(arg);
  }
  if (!normalized.includes("--verbose")) normalized.push("--verbose");
  normalized.push("--output-format", "stream-json");
  return managerAssistantPermissionArgs(managerAssistantWindowsToolSafetyArgs(command, normalized));
}

function managerAssistantWindowsToolSafetyArgs(command: string, args: string[]): string[] {
  if (process.platform !== "win32" || !isDefaultClaudeCommand(command)) return args;
  const normalized: string[] = [];
  let hasBashDisallow = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    normalized.push(arg);
    if (arg === "--disallowedTools" || arg === "--disallowed-tools") {
      const next = args[index + 1];
      if (typeof next === "string" && /\bBash\b/i.test(next)) hasBashDisallow = true;
      continue;
    }
    if (
      (arg.startsWith("--disallowedTools=") || arg.startsWith("--disallowed-tools=")) &&
      /\bBash\b/i.test(arg)
    ) {
      hasBashDisallow = true;
    }
  }
  return hasBashDisallow ? normalized : [...normalized, "--disallowedTools", "Bash"];
}

function managerAssistantStructuredInputArgs(args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--input-format") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--input-format=")) continue;
    normalized.push(arg);
  }
  normalized.push("--input-format", "stream-json");
  return normalized;
}

function writeClaudeStructuredPrompt(
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
  prompt: string,
): void {
  proc.stdin.write(`${claudeStructuredPromptPayload(prompt)}\n`);
  proc.stdin.end();
}

function claudeStructuredPromptPayload(prompt: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  });
}

function managerAssistantPermissionArgs(args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--permission-mode") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--permission-mode=")) continue;
    normalized.push(arg);
  }
  normalized.push("--permission-mode", "bypassPermissions");
  return normalized;
}

function managerAssistantTimeoutMs(options: ManagerAssistantOptions | undefined): number {
  const configured =
    options?.timeoutMs ??
    Number(
      process.env.DESKRELAY_MANAGER_ASSISTANT_TIMEOUT_MS ?? DEFAULT_MANAGER_ASSISTANT_TIMEOUT_MS,
    );
  if (!Number.isFinite(configured)) return DEFAULT_MANAGER_ASSISTANT_TIMEOUT_MS;
  return Math.max(5_000, Math.min(MAX_MANAGER_ASSISTANT_TIMEOUT_MS, Math.floor(configured)));
}

interface ManagerAssistantStdoutResult {
  resultText: string;
  assistantText: string;
  assistantTextAfterToolResult: string;
  rawText: string;
  sessionId: string;
  sawToolUse: boolean;
  sawToolResult: boolean;
  sawSyntheticToolArtifact: boolean;
}

async function readManagerAssistantStdout(
  stream: ReadableStream<Uint8Array>,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<ManagerAssistantStdoutResult> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  let resultText = "";
  let assistantText = "";
  let assistantTextAfterToolResult = "";
  let rawText = "";
  let sessionId = "";
  let sawToolUse = false;
  let sawToolResult = false;
  let sawSyntheticToolArtifact = false;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      rawText += `${trimmed}\n`;
      if (containsManagerAssistantToolTranscriptArtifact(trimmed)) {
        sawSyntheticToolArtifact = true;
      }
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      rawText += `${trimmed}\n`;
      if (containsManagerAssistantToolTranscriptArtifact(trimmed)) {
        sawSyntheticToolArtifact = true;
      }
      return;
    }
    if (typeof parsed.session_id === "string" && parsed.session_id.trim()) {
      sessionId = parsed.session_id.trim();
    }
    emit({ type: "claude_event", event: parsed });
    const status = managerAssistantStatusFromClaudeEvent(parsed);
    if (status) emit(managerAssistantStatusEvent(status));
    const blocks = managerAssistantMessageBlocks(parsed);
    if (blocks.some((block) => block.type === "tool_use")) {
      sawToolUse = true;
    }
    if (parsed.type === "user" && blocks.some((block) => block.type === "tool_result")) {
      sawToolResult = true;
    }
    const result = managerAssistantResultTextFromEvent(parsed);
    if (result) {
      resultText = result;
      if (containsManagerAssistantToolTranscriptArtifact(result)) {
        sawSyntheticToolArtifact = true;
      }
    }
    const text = managerAssistantAssistantTextFromEvent(parsed);
    if (text) {
      assistantText += `${text}\n`;
      if (sawToolResult) assistantTextAfterToolResult += `${text}\n`;
      if (containsManagerAssistantToolTranscriptArtifact(text)) {
        sawSyntheticToolArtifact = true;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      consumeLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  const trailing = `${buffer}${decoder.decode()}`.trim();
  if (trailing) consumeLine(trailing);
  return {
    resultText,
    assistantText,
    assistantTextAfterToolResult,
    rawText,
    sessionId,
    sawToolUse,
    sawToolResult,
    sawSyntheticToolArtifact,
  };
}

async function readManagerAssistantStderr(
  stream: ReadableStream<Uint8Array>,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<string> {
  const text = await new Response(stream).text();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) {
    emit(
      managerAssistantStatusEvent({
        phase: "running",
        tone: "warning",
        main: "CLI 메시지 수신",
        detail: truncateForStatus(firstLine),
      }),
    );
  }
  return text;
}

function chooseManagerAssistantFinalText(
  stdoutResult: ManagerAssistantStdoutResult,
  stderrText: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const resultText = sanitizeManagerAssistantText(stdoutResult.resultText);
  const assistantAfterTool = sanitizeManagerAssistantText(
    stdoutResult.assistantTextAfterToolResult,
  );
  const assistantText = sanitizeManagerAssistantText(stdoutResult.assistantText);
  const rawText = sanitizeManagerAssistantText(stdoutResult.rawText);
  const stderr = sanitizeManagerAssistantText(stderrText);
  const incompleteToolTranscript =
    stdoutResult.sawSyntheticToolArtifact && !stdoutResult.sawToolResult && !assistantAfterTool;

  if (incompleteToolTranscript) {
    return {
      ok: false,
      error:
        "Manager assistant started a tool call but did not complete a final response. Retry the request.",
    };
  }

  if (resultText) return { ok: true, text: resultText };
  if (assistantAfterTool) return { ok: true, text: assistantAfterTool };
  if (!stdoutResult.sawToolUse && assistantText) return { ok: true, text: assistantText };
  if (rawText) return { ok: true, text: rawText };
  if (stderr) return { ok: true, text: stderr };
  return { ok: false, error: "Manager assistant CLI returned no output." };
}

function sanitizeManagerAssistantText(value: string): string {
  const lines = value.replace(/\0/g, "").split(/\r?\n/);
  const sanitized: string[] = [];
  let removedToolTranscriptLine = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (isManagerAssistantToolTranscriptLine(trimmed)) {
      removedToolTranscriptLine = true;
      continue;
    }
    if (removedToolTranscriptLine && /^[A-Z][A-Za-z0-9_-]{0,20}:\s*$/.test(trimmed)) {
      continue;
    }
    sanitized.push(line);
    removedToolTranscriptLine = false;
  }
  return sanitized
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function containsManagerAssistantToolTranscriptArtifact(value: string): boolean {
  return value.split(/\r?\n/).some((line) => isManagerAssistantToolTranscriptLine(line.trim()));
}

function isManagerAssistantToolTranscriptLine(line: string): boolean {
  if (!line.startsWith("[") || !line.endsWith("]")) return false;
  if (!/\b(?:Call|Calls|Calling|Use|Uses|Using)\b/i.test(line)) return false;
  return /(?:->|→)/.test(line) || /\b(?:Bash|Read|Grep|Glob|Edit|Write|Task)\b/i.test(line);
}

function managerAssistantStatusEvent(
  status: ManagerAssistantStreamStatus,
): ManagerAssistantStreamEvent {
  return { type: "status", status };
}

function managerAssistantStatusFromClaudeEvent(
  event: Record<string, unknown>,
): ManagerAssistantStreamStatus | null {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "system") {
    return { phase: "running", tone: "thinking", main: "CLI 초기화 중" };
  }
  if (type === "result") {
    return { phase: "finalizing", tone: "thinking", main: "결과 정리 중" };
  }
  if (type === "assistant") {
    const tool = managerAssistantToolUseFromEvent(event);
    if (tool) {
      return {
        phase: tool.detail?.startsWith("DeskRelay API") ? "api" : "tool",
        tone: "thinking",
        main: tool.detail?.startsWith("DeskRelay API")
          ? "DeskRelay API 호출 중"
          : `도구 실행 중: ${tool.name}`,
        ...(tool.detail ? { detail: tool.detail } : {}),
      };
    }
    const blocks = managerAssistantMessageBlocks(event);
    if (blocks.some((block) => block.type === "thinking")) {
      return { phase: "running", tone: "thinking", main: "판단 중" };
    }
    if (blocks.some((block) => block.type === "text")) {
      return { phase: "running", tone: "thinking", main: "응답 작성 중" };
    }
  }
  if (
    type === "user" &&
    managerAssistantMessageBlocks(event).some((block) => block.type === "tool_result")
  ) {
    return { phase: "running", tone: "thinking", main: "도구 결과 확인 중" };
  }
  return null;
}

function managerAssistantToolUseFromEvent(
  event: Record<string, unknown>,
): { name: string; detail?: string } | null {
  for (const block of managerAssistantMessageBlocks(event)) {
    if (block.type !== "tool_use") continue;
    const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : "tool";
    const detail = managerAssistantToolDetail(name, block.input);
    return detail ? { name, detail } : { name };
  }
  return null;
}

function managerAssistantMessageBlocks(
  event: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const message = isRecord(event.message) ? event.message : null;
  const content = message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

function managerAssistantToolDetail(name: string, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const command = typeof input.command === "string" ? input.command : "";
  if (!command) return undefined;
  const apiMatch = command.match(/\/api\/[A-Za-z0-9_./:-]+/);
  if (apiMatch) return `DeskRelay API ${apiMatch[0]}`;
  if (name.toLowerCase() === "bash") return "명령 실행";
  return undefined;
}

function managerAssistantResultTextFromEvent(event: Record<string, unknown>): string {
  if (event.type !== "result") return "";
  return typeof event.result === "string" ? event.result : "";
}

function managerAssistantAssistantTextFromEvent(event: Record<string, unknown>): string {
  if (event.type !== "assistant") return "";
  const parts: string[] = [];
  for (const block of managerAssistantMessageBlocks(event)) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function truncateForStatus(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

export function buildManagerAssistantPrompt(input: ManagerAssistantRunInput): string {
  const browserContext = formatManagerAssistantBrowserContext(input.context);
  const asciiSafeRequest = asciiSafeJsonString(input.message);
  const pendingDecision = isShortManagerAssistantReply(input.message)
    ? formatManagerAssistantPendingDecision(input.assistantState?.pendingDecision)
    : "";
  const shortReplyHint = pendingDecision
    ? [
        "## Short Reply Resolution",
        "The current user request is short or ambiguous. Resolve it against the active Claude session first.",
        pendingDecision,
        "Accept numeric, lettered, ordinal, and affirmative replies when they clearly map to the pending decision or the last assistant reply.",
      ].join("\n")
    : "";
  return [
    browserContext ? `## Current Browser Context\n${browserContext}` : "",
    shortReplyHint,
    `## Current User Request\n${input.message}`,
    [
      "## Current User Request ASCII-Safe Copy",
      asciiSafeRequest,
      "If the raw request above appears as question marks, mojibake, or otherwise corrupted, decode this JSON string and use it as the source of truth for intent.",
    ].join("\n"),
    "## Response Requirements\nAnswer only the current user request. Use the active Claude session for conversation memory. Use observed facts for operational claims.",
    [
      "## Role Selection Reminder",
      "- First classify the request intent, then choose the matching role profile from the managed instructions.",
      "- Possible role profiles include status reporter, diagnostician, operator, developer supervisor, session analyst, guide, and safety steward.",
      "- Keep the role internal unless naming it helps the user understand the result.",
      "- If the request blends roles, start with the least risky read-only role, then escalate only when the user's intent requires action.",
      "- For development or orchestration work, do not become the implementer. Supervise `claude-code` worker tasks and verify their outputs.",
    ].join("\n"),
    [
      "## Per-Turn Tool Constraints",
      "- This server is Windows.",
      "- Do not use Bash for DeskRelay manager API calls.",
      "- For simple read-only GET observations, prefer `Set-Location $env:DESKRELAY_REPOSITORY_ROOT; bun run scripts/manager-api.ts batch-get name=/api/path`.",
      "- For JSON mutation or dry-run bodies, prefer `--body-file` to avoid shell quoting failures.",
    ].join("\n"),
    [
      "## Progress Reporting",
      "- For multi-step or multi-round work, write short progress reports with `POST /api/manager/assistant/status`.",
      "- Report at round start, round completion, blocker discovery, and before switching strategy.",
      "- Keep each report short: one current state sentence plus the next action.",
      '- Body shape: `{ "phase": "observing|deciding|acting|verifying|blocked|reporting|done", "level": "info|success|warning|error", "round": "R8", "scope": "orchestration", "message": "...", "detail": "..." }`.',
      "- Use `bun run scripts/manager-api.ts POST /api/manager/assistant/status --body-file <json-file>` from the repository root.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function asciiSafeJsonString(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (char) =>
    char
      .split("")
      .map((part) => `\\u${part.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join(""),
  );
}

function isShortManagerAssistantReply(value: string): boolean {
  const compact = value.trim();
  if (!compact) return false;
  if (compact.length <= 12) return true;
  return /^(응|네|그래|좋아|진행|그걸로|첫|두|세|1번|2번|3번|a|b|c)$/i.test(compact);
}

function formatManagerAssistantPendingDecision(
  pendingDecision: ManagerAssistantStructuredState["pendingDecision"] | undefined,
): string {
  if (!pendingDecision?.options.length) return "";
  const lines: string[] = [];
  lines.push("- pending decision:");
  if (pendingDecision.prompt) lines.push(`  prompt: ${pendingDecision.prompt}`);
  for (const option of pendingDecision.options) {
    lines.push(`  ${option.key}. ${option.label}${option.detail ? ` - ${option.detail}` : ""}`);
  }
  return lines.join("\n");
}

interface ManagerAssistantWorkspace {
  cwd: string;
  instructionsPath: string;
}

async function ensureManagerAssistantWorkspace(
  repoRoot: string,
  apiBaseUrl: string,
): Promise<ManagerAssistantWorkspace> {
  const cwd = join(repoRoot, MANAGER_ASSISTANT_DIR);
  const instructionsPath = join(cwd, MANAGER_ASSISTANT_INSTRUCTIONS_FILE);
  await mkdir(cwd, { recursive: true });
  await chmod(instructionsPath, 0o600).catch(() => undefined);
  await writeFile(
    instructionsPath,
    buildManagedManagerAssistantInstructions({ repoRoot, apiBaseUrl }),
    "utf8",
  );
  await chmod(instructionsPath, 0o444).catch(() => undefined);
  return { cwd, instructionsPath };
}

async function readManagerAssistantStatusReports(
  repoRoot: string,
  limit = MANAGER_ASSISTANT_STATUS_LIMIT,
): Promise<ManagerAssistantStatusReportResponse> {
  const filePath = join(repoRoot, MANAGER_ASSISTANT_DIR, MANAGER_ASSISTANT_STATUS_FILE);
  const reports = await readStoredManagerAssistantStatusReports(filePath);
  const clipped = reports.slice(0, Math.max(1, Math.min(MANAGER_ASSISTANT_STATUS_LIMIT, limit)));
  return {
    generatedAt: new Date().toISOString(),
    reports: clipped,
    ...(clipped[0] ? { latest: clipped[0] } : {}),
  };
}

async function appendManagerAssistantStatusReport(
  repoRoot: string,
  input: ManagerAssistantStatusReportInput,
): Promise<ManagerAssistantStatusReportResponse> {
  const dir = join(repoRoot, MANAGER_ASSISTANT_DIR);
  const filePath = join(dir, MANAGER_ASSISTANT_STATUS_FILE);
  await mkdir(dir, { recursive: true });
  const reports = await readStoredManagerAssistantStatusReports(filePath);
  const now = new Date().toISOString();
  const report: ManagerAssistantStatusReport = {
    id: `report_${randomBytes(10).toString("base64url")}`,
    createdAt: now,
    phase: input.phase ?? "reporting",
    level: input.level ?? "info",
    message: input.message.trim().slice(0, 500),
    ...(input.detail?.trim() ? { detail: input.detail.trim().slice(0, 1_000) } : {}),
    ...(input.round?.trim() ? { round: input.round.trim().slice(0, 40) } : {}),
    ...(input.scope?.trim() ? { scope: input.scope.trim().slice(0, 80) } : {}),
  };
  const next = [report, ...reports].slice(0, MANAGER_ASSISTANT_STATUS_LIMIT);
  await writeFile(filePath, `${JSON.stringify({ reports: next }, null, 2)}\n`, "utf8");
  return {
    generatedAt: now,
    reports: next,
    latest: report,
  };
}

async function readStoredManagerAssistantStatusReports(
  filePath: string,
): Promise<ManagerAssistantStatusReport[]> {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text) as { reports?: unknown } | unknown[];
    const raw = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { reports?: unknown }).reports)
        ? (parsed as { reports: unknown[] }).reports
        : [];
    return raw.filter(isManagerAssistantStatusReport);
  } catch {
    return [];
  }
}

function isManagerAssistantStatusReport(value: unknown): value is ManagerAssistantStatusReport {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    isManagerAssistantStatusPhase(value.phase) &&
    isManagerAssistantStatusLevel(value.level) &&
    typeof value.message === "string"
  );
}

function parseManagerAssistantStatusReportInput(
  value: unknown,
): { ok: true; value: ManagerAssistantStatusReportInput } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message) return { ok: false, error: "message is required" };
  const phase = typeof value.phase === "string" ? value.phase : undefined;
  if (phase !== undefined && !isManagerAssistantStatusPhase(phase)) {
    return { ok: false, error: "invalid phase" };
  }
  const level = typeof value.level === "string" ? value.level : undefined;
  if (level !== undefined && !isManagerAssistantStatusLevel(level)) {
    return { ok: false, error: "invalid level" };
  }
  const input: ManagerAssistantStatusReportInput = { message };
  if (phase) input.phase = phase;
  if (level) input.level = level;
  if (typeof value.detail === "string" && value.detail.trim()) input.detail = value.detail.trim();
  if (typeof value.round === "string" && value.round.trim()) input.round = value.round.trim();
  if (typeof value.scope === "string" && value.scope.trim()) input.scope = value.scope.trim();
  return { ok: true, value: input };
}

function isManagerAssistantStatusPhase(value: unknown): value is ManagerAssistantStatusReportPhase {
  return (
    value === "observing" ||
    value === "deciding" ||
    value === "acting" ||
    value === "verifying" ||
    value === "blocked" ||
    value === "reporting" ||
    value === "done"
  );
}

function isManagerAssistantStatusLevel(value: unknown): value is ManagerAssistantStatusReportLevel {
  return value === "info" || value === "success" || value === "warning" || value === "error";
}

function buildManagerWorkerList(options: SiteAppOptions): ManagerWorkerListResponse {
  return {
    generatedAt: new Date().toISOString(),
    profiles: buildManagerWorkerProfiles(options),
  };
}

function buildManagerWorkerProfiles(options: SiteAppOptions): ManagerWorkerProfile[] {
  const configured = options.managerWorkers?.length ? options.managerWorkers : undefined;
  const profiles: ManagerWorkerProfileConfig[] = configured ?? [
    {
      id: "claude-code",
      label: "Claude Code worker",
      description:
        "Runs a separate Claude CLI process for implementation, verification, and repo work.",
      command: process.env.DESKRELAY_MANAGER_WORKER_CLAUDE_CLI ?? "claude",
      args: managerAssistantStructuredInputArgs(
        managerAssistantPermissionArgs(
          parseManagerAssistantArgs(process.env.DESKRELAY_MANAGER_WORKER_CLAUDE_ARGS),
        ),
      ),
      checkArgs: ["--version"],
      destructive: true,
      defaultTimeoutMs: 600_000,
      available: true,
      runMode: "stdin" as const,
      roles: ["implementation", "verification", "repo"],
      risk: "destructive" as const,
    },
    {
      id: "powershell",
      label: "PowerShell worker",
      description:
        "Runs server-local PowerShell commands for inspection, repair scripts, and maintenance.",
      command: process.env.DESKRELAY_MANAGER_WORKER_POWERSHELL_CLI ?? "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"],
      checkArgs: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      destructive: true,
      defaultTimeoutMs: 300_000,
      available: true,
      runMode: "argument" as const,
      roles: ["inspection", "maintenance", "scripts"],
      risk: "system" as const,
    },
  ];
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    description: profile.description,
    command: profile.command,
    args: profile.args ?? [],
    checkCommand: profile.checkCommand ?? profile.command,
    checkArgs: profile.checkArgs ?? defaultManagerWorkerCheckArgs(profile.command),
    available: profile.available !== false,
    destructive: profile.destructive !== false,
    defaultTimeoutMs: clampWorkerTimeoutMs(profile.defaultTimeoutMs ?? 600_000),
    runMode: profile.runMode ?? "argument",
    roles: profile.roles ?? [],
    risk: profile.risk ?? (profile.destructive === false ? "read" : "destructive"),
  }));
}

function findManagerWorkerProfile(
  options: SiteAppOptions,
  id: string,
): ManagerWorkerProfile | undefined {
  return buildManagerWorkerProfiles(options).find((profile) => profile.id === id);
}

function defaultManagerWorkerCheckArgs(command: string): string[] {
  const lower = command.toLowerCase();
  if (lower.endsWith("powershell") || lower.endsWith("powershell.exe") || lower.endsWith("pwsh")) {
    return ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"];
  }
  return ["--version"];
}

interface ManagerWorkerParams {
  profile: string;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
}

function parseManagerWorkerParams(
  input: unknown,
): { ok: true; value: ManagerWorkerParams } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "worker params must be an object" };
  const profile =
    typeof input.profile === "string" && input.profile.trim()
      ? input.profile.trim()
      : "claude-code";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "worker prompt is required" };
  if (prompt.length > 40_000) return { ok: false, error: "worker prompt is too long" };
  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;
  const timeoutMs = Number(input.timeoutMs);
  return {
    ok: true,
    value: {
      profile,
      prompt,
      ...(cwd ? { cwd } : {}),
      ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
    },
  };
}

function resolveManagerWorkerCwd(
  repoRoot: string,
  cwd: string | undefined,
): { ok: true; value: string } | { ok: false; error: string } {
  const root = resolve(repoRoot);
  const candidate = cwd ? (isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd)) : root;
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: `worker cwd must stay inside the server repository: ${root}` };
  }
  return { ok: true, value: candidate };
}

interface ManagerWorkerCliRunInput {
  profile: ManagerWorkerProfile;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  apiBaseUrl: string;
  repoRoot: string;
  token: string | undefined;
}

interface ManagerWorkerCliRunResult {
  profile: string;
  command: string;
  cwd: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

async function runManagerWorkerCli(
  input: ManagerWorkerCliRunInput,
): Promise<ManagerWorkerCliRunResult> {
  const started = Date.now();
  const argv =
    input.profile.runMode === "stdin"
      ? [...input.profile.args]
      : [...input.profile.args, input.prompt];
  const proc = Bun.spawn([input.profile.command, ...argv], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: {
      ...process.env,
      ...(input.token ? { DESKRELAY_SITE_TOKEN: input.token } : {}),
      DESKRELAY_MANAGER_API_BASE: input.apiBaseUrl,
      DESKRELAY_MANAGER_WORKER: "1",
      DESKRELAY_REPOSITORY_ROOT: input.repoRoot,
    },
  });
  if (input.profile.runMode === "stdin") {
    proc.stdin.write(managerWorkerStdinPayload(input.profile, input.prompt));
  }
  proc.stdin.end();
  const stdout = readLimitedText(proc.stdout, 2_000_000);
  const stderr = readLimitedText(proc.stderr, 500_000);
  let timedOut = false;
  const exitCode = await withTimeout(proc.exited, input.timeoutMs, () => {
    timedOut = true;
    proc.kill();
  });
  const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
  return {
    profile: input.profile.id,
    command: managerWorkerCommandPreview(input.profile),
    cwd: input.cwd,
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    stdout: sanitizeManagerAssistantText(stdoutResult.text),
    stderr: sanitizeManagerAssistantText(stderrResult.text),
    stdoutTruncated: stdoutResult.truncated,
    stderrTruncated: stderrResult.truncated,
  };
}

async function checkManagerWorkerProfile(
  profile: ManagerWorkerProfile,
): Promise<ManagerWorkerCheckResult> {
  const started = Date.now();
  const command = profile.checkCommand || profile.command;
  const args = profile.checkArgs.length
    ? profile.checkArgs
    : defaultManagerWorkerCheckArgs(command);
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: process.env,
    });
    const stdout = readLimitedText(proc.stdout, 100_000);
    const stderr = readLimitedText(proc.stderr, 100_000);
    let timedOut = false;
    const exitCode = await withTimeout(proc.exited, 5_000, () => {
      timedOut = true;
      proc.kill();
    });
    const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
    return {
      profile: profile.id,
      command,
      args,
      available: exitCode === 0 && !timedOut,
      exitCode,
      timedOut,
      durationMs: Date.now() - started,
      stdout: sanitizeManagerAssistantText(stdoutResult.text),
      stderr: sanitizeManagerAssistantText(stderrResult.text),
      stdoutTruncated: stdoutResult.truncated,
      stderrTruncated: stderrResult.truncated,
    };
  } catch (error) {
    return {
      profile: profile.id,
      command,
      args,
      available: false,
      timedOut: false,
      durationMs: Date.now() - started,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function managerWorkerCommandPreview(profile: ManagerWorkerProfile): string {
  const promptMarker = profile.runMode === "stdin" ? "<prompt via stdin>" : "<prompt>";
  return `${profile.command} ${[...profile.args, promptMarker].join(" ")}`.trim();
}

function managerWorkerStdinPayload(profile: ManagerWorkerProfile, prompt: string): string {
  return profileUsesClaudeStructuredInput(profile)
    ? `${claudeStructuredPromptPayload(prompt)}\n`
    : prompt;
}

function profileUsesClaudeStructuredInput(profile: Pick<ManagerWorkerProfile, "args">): boolean {
  for (let index = 0; index < profile.args.length; index += 1) {
    const arg = profile.args[index];
    if (arg === "--input-format" && profile.args[index + 1] === "stream-json") return true;
    if (arg === "--input-format=stream-json") return true;
  }
  return false;
}

async function readLimitedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      continue;
    }
    const next = value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(next);
    total += next.byteLength;
    if (next.byteLength < value.byteLength) truncated = true;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const suffix = truncated ? "\n[output truncated]\n" : "";
  return { text: `${new TextDecoder().decode(bytes)}${suffix}`, truncated };
}

function clampWorkerTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) return 600_000;
  return Math.max(5_000, Math.min(1_800_000, Math.floor(value)));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function managerAssistantApiBaseUrl(options: SiteAppOptions, requestUrl: string): string {
  return new URL(options.selfHostUrl ?? requestUrl).origin;
}

function formatRouteCapabilitiesForInstructions(routes: ManagerRouteCapability[]): string[] {
  return routes.map((route) => {
    const destructive = route.destructive ? " destructive" : "";
    return `- \`${route.method} ${route.path}\`${destructive} - ${route.description}`;
  });
}

function buildManagedManagerAssistantInstructions(input: {
  repoRoot: string;
  apiBaseUrl: string;
}): string {
  const routeLines = formatRouteCapabilitiesForInstructions(SITE_ROUTE_CAPABILITIES);
  const behaviorMethodLines = DESKRELAY_BEHAVIOR_METHODS.map((method) => `- \`${method}\``);
  return [
    "# DeskRelay Manager Assistant",
    "",
    "This is a managed instruction file generated by the DeskRelay server.",
    "Do not ask the user to edit this file. The browser instruction editor must not expose it.",
    "",
    "## Role",
    "",
    "- You are the DeskRelay administrator and supervisor assistant.",
    "- You help the user inspect, diagnose, update, repair, and operate this self-host DeskRelay instance.",
    "- You should not merely explain when the user asks for operational help. Understand the intent, inspect the system, act when appropriate, verify the result, and report observed facts.",
    "- Operate generically. Do not rely on hard-coded phrases; classify intent, scope, required context, and available capabilities before choosing a tool.",
    "- You run on the server PC. Treat this as a local developer tool, not a hosted SaaS product.",
    "- Answer in Korean unless the user explicitly asks for another language.",
    "- Do not claim that you ran an API call, command, update, restart, or repair unless you actually did.",
    "- Treat browser-provided history as memory only, not as a transcript to continue.",
    "- Do not output artificial conversation labels such as `User:`, `Assistant:`, `A:`, or `B:` unless the user explicitly asks for that format.",
    "- Separate planned checks from observed facts. A bracketed checklist is not evidence that the check ran.",
    "",
    "## Supervisor Boundary",
    "",
    "- You are a supervisor, not the primary implementer.",
    "- For development, refactor, documentation, protocol, test, or orchestration-framework work, your job is to define the objective, delegate to workers, inspect results, verify evidence, and update the user.",
    "- Do not write the main project artifacts yourself. Do not use PowerShell as your primary authoring tool for implementation or protocol work.",
    "- PowerShell is for inspection, diagnostics, small mechanical checks, fixture setup, and independent verification. It is not a substitute for a worker agent.",
    "- If no suitable worker is available, report the task as blocked instead of silently doing the worker's job yourself.",
    "- If you must make a tiny emergency bookkeeping edit yourself, label it as manager bookkeeping, keep it minimal, and do not count that as worker execution.",
    "",
    "## Development Round Completion Gate",
    "",
    "A development or orchestration round is not complete unless all of these are true:",
    "",
    "1. At least one non-dry-run `claude-code` worker task was launched for the substantive development, documentation, protocol, or test work.",
    "2. The worker prompt contained role, objective, allowed paths, forbidden actions, expected artifacts, and verification criteria.",
    "3. You read the worker task result or logs after completion.",
    "4. You independently verified the resulting files, tests, protocol state, or failure classification.",
    "5. You reported the worker task id(s), observed result, verification evidence, and remaining risk.",
    "",
    "If the work only used your own reasoning, direct file edits, or PowerShell scripts, describe it as supervisor inspection or mechanical verification, not as orchestration success.",
    "",
    "## Common Behavior Contract",
    "",
    "- Always infer intent before choosing tools. The user may ask for status, diagnosis, development, operation, planning, explanation, or cleanup.",
    "- Prefer the smallest useful observation first. Do not read session transcripts, logs, files, or large payloads unless the role and intent need them.",
    "- Treat all operational claims as evidence-backed. State what you observed, where it came from, and what remains uncertain.",
    "- When action is required, act through the narrowest DeskRelay API or worker task that matches the scope.",
    "- Verify every mutation. A successful API response is not enough if a follow-up status read can confirm the visible result.",
    "- Keep the user informed through progress reports during multi-step work, but keep the final answer concise.",
    "- Avoid asking the user to provide IDs, logs, or copied text when selected browser context or manager APIs can retrieve them.",
    "- Ask one concise clarification question only when the missing detail changes the target, safety boundary, or destructive scope.",
    "",
    "## Role Profiles",
    "",
    "Use exactly one primary profile at a time. You may switch profiles as the task evolves, but report the switch when it matters.",
    "",
    "### Status Reporter",
    "",
    "- Use for: `status`, `what is happening`, `is it connected`, `what changed`, update progress, worker progress.",
    "- Use read-only APIs first: system summary, update status, device list, diagnostics, task list/logs, assistant status reports.",
    "- Do not mutate state. Do not read full session transcripts unless the user asks about a specific conversation.",
    "- Answer with: current state, evidence source, user-visible next action if any.",
    "",
    "### Diagnostician",
    "",
    "- Use for: errors, timeouts, missing devices, stale state, failed registration, failed update, strange assistant behavior.",
    "- Reproduce through APIs where possible. Classify the failure layer: browser, server, connector, daemon, Claude CLI, workspace, network, permission, or repository.",
    "- Prefer structured diagnostics and recent logs over speculation.",
    "- End with a ranked cause list and the smallest safe repair path.",
    "",
    "### Operator",
    "",
    "- Use for: restart, update, repair, re-register, clear cache, remove a device, run a command, apply a known fix.",
    "- Diagnose before mutation unless the user explicitly requests a direct operation and the target is unambiguous.",
    "- Use dry-run where available for broad operations. For destructive operations, require explicit target confirmation unless already provided.",
    "- Verify after action and report success, partial success, or failure with the next safe step.",
    "",
    "### Developer Supervisor",
    "",
    "- Use for: implementation, refactor, tests, documentation, orchestration framework work, multi-agent coordination.",
    "- Create or inspect the plan, define scope, choose worker profiles, delegate substantial execution to `claude-code` workers, then verify outputs yourself.",
    "- Worker prompts must include objective, allowed paths, forbidden actions, expected artifacts, and verification commands.",
    "- Do not directly implement the worker's assigned files. Do not use PowerShell as the main author of implementation, protocol, or documentation artifacts.",
    "- Use PowerShell only to inspect state, run quick checks, create temporary fixtures, or verify worker output.",
    "- Do not close a development round without a non-dry-run `claude-code` worker result unless you explicitly report the round as blocked.",
    "- Maintain project protocols and Markdown coordination files only inside the user's requested workspace, never inside the manager-assistant system folder.",
    "",
    "### Session Analyst",
    "",
    "- Use for: summarize selected conversation, analyze a transcript, inspect an image/session issue, compare messages, continue a selected session.",
    "- Resolve selected device/session/cwd from browser context first. Then read only the needed session content with `POST /api/manager/sessions/read`.",
    "- Do not claim selected context is missing until you checked the browser context and available manager/session APIs.",
    "- Summaries and analysis must be based on retrieved transcript data, not memory guesses.",
    "",
    "### Guide",
    "",
    "- Use for: architecture questions, how-to, planning, tradeoff discussion, manual instructions.",
    "- Do not mutate state. Use APIs only if current state would materially change the answer.",
    "- Prefer practical, command-ready guidance. Mention risks and verification steps when relevant.",
    "",
    "### Safety Steward",
    "",
    "- Use whenever a request touches deletion, uninstall, token reset, public exposure, workspace root broadening, security policy, or all-device operations.",
    "- Surface the boundary and blast radius clearly.",
    "- Confirm destructive scope unless the user already named the exact destructive action and target.",
    "- Prefer reversible operations and backup/rollback instructions when available.",
    "",
    "## Intent First",
    "",
    "Before using any DeskRelay API or local command, infer the user's intent clearly.",
    "Classify the request into one of these categories:",
    "",
    "1. Status inquiry - the user wants to know current state. Use read-only APIs only.",
    "2. Diagnosis - the user reports something broken or suspicious. Use read-only status, diagnostics, logs, and failure analysis APIs first.",
    "3. Repair - the user wants a broken state fixed. Diagnose first, then use the smallest matching repair/update/restart API. Verify after action.",
    "4. Configuration change - the user wants settings, permissions, instructions, workspace roots, cache, or behavior changed. Read current config first, change only the requested scope, then verify.",
    "5. Destructive operation - deletion, uninstall, token reset, broad cleanup, or removal. Ask for confirmation unless the user explicitly requested that exact destructive action.",
    "6. Explanation or planning only - the user asks how, why, what should we do, or asks for a plan. Do not mutate state. Use APIs only if current factual state is needed.",
    "",
    "Use this operating loop:",
    "",
    "```text",
    "Understand Intent -> Choose Scope -> Read State -> Decide -> Act If Needed -> Verify -> Report",
    "```",
    "",
    "Affected scopes are: server, current device, selected device, selected session, browser, repository, or all devices.",
    "",
    "For every request, follow this internal action contract:",
    "",
    "```text",
    "Intent -> Scope -> Needed context -> Read APIs -> Mutation API if any -> Verification -> User-facing result",
    "```",
    "",
    "The browser context is only a reference snapshot. It may contain selected device/session/cwd ids, but it does not contain full session text, logs, files, or command output.",
    "Use lazy reads: read large data only when the user's intent requires that data.",
    "If the user refers to the selected/current conversation, chat, or session, use the browser-provided selected device/session/cwd first. Do not ask the user to paste text or provide IDs when selected context is available.",
    "Read the selected session only for requests that require session content, such as summarize, analyze this conversation, inspect this error, continue this session, or compare messages.",
    "To inspect a selected Claude session, call `POST /api/manager/sessions/read` with the selected `deviceId`, `sessionId`, and `cwd` when present. If `cwd` is absent, the API searches session lists to resolve it.",
    "For device/server/update/registration/security questions, do not read session content unless the user specifically asks about the selected session.",
    "If the intent or scope is ambiguous, ask one concise clarification question before mutating anything.",
    "",
    "## Generic Decision Rules",
    "",
    "- Status inquiry: use summary/status/diagnostic read APIs and avoid session reads.",
    "- Selected session work: use `POST /api/manager/sessions/read` with the selected device/session/cwd when available; summarize or analyze from observed events.",
    "- Remote Claude work: inspect target device state and cwd; call the `chat` behavior with `message`, `cwd`, and optional `sessionId` only when the user asked to send work.",
    "- For remote worker prompts where exact generated filenames or commands matter, prefer ASCII-only operational prompts. Answer the DeskRelay user in Korean afterward.",
    "- Configuration change: read current config first, mutate only the requested scope, then re-read.",
    "- Repair/update/restart: diagnose first, run the smallest matching task/API, then verify task and resulting state.",
    "- Non-destructive scaffolding, file listing, file preview, status reads, and creation of requested project files inside the selected allowed workspace do not need another confirmation after the user says to proceed.",
    "- Destructive work: ask for confirmation unless the user explicitly requested the exact deletion/removal target.",
    "- Planning/explanation: do not mutate state unless the user clearly asks you to proceed.",
    "",
    "## Worker Delegation",
    "",
    "- You are the supervisor. Answer questions, choose scope, inspect state, decide whether work is needed, and verify results yourself.",
    "- Delegate substantial implementation, repo edits, test runs, documentation edits, and multi-step repair work to a worker CLI instead of pretending you performed the work inline.",
    "- Use `GET /api/manager/workers` to discover worker profiles.",
    "- Use `POST /api/manager/workers/:id/check` before non-dry-run delegation unless that worker was checked recently in the same task.",
    '- Use `POST /api/manager/workers/run` or `POST /api/manager/tasks` with `kind: "run-worker"` to launch a worker task.',
    "- Worker prompts must include the exact objective, allowed scope, files/modules to touch, forbidden actions, verification commands, and the expected final report.",
    "- Use `dryRun: true` first when you are deciding whether delegation is appropriate. Use `dryRun: false` only after the user asked to proceed or the requested operation clearly implies execution.",
    "- After worker completion, read the task result/logs, verify the changed state yourself, and report observed facts. Do not blindly trust the worker's conclusion.",
    "",
    "## Result Observation Policy",
    "",
    "- Default to the narrowest observation source that matches the thing you just caused.",
    "- If you just answered directly as the manager assistant, use your current response. Do not read any Claude session transcript.",
    "- If you created a manager task or worker task, observe that task by id with `GET /api/manager/tasks/:id/observe`.",
    "- If the task is still running or waiting, use `GET /api/manager/tasks/:id/stream` to follow that task until it changes or completes.",
    "- Use `GET /api/manager/tasks/:id/logs` only when the observation summary is insufficient, failed, or blocked.",
    "- Use `POST /api/manager/sessions/read` only when the user asks about a selected/explicit Claude conversation, transcript, message history, image in a conversation, or when debugging session storage itself.",
    "- Do not read broad conversation transcripts to find the answer to your own manager task. Task observation is the primary source for work you launched.",
    "",
    "## Progress Reports",
    "",
    "- For long-running, multi-step, or multi-round work, post concise progress reports so the browser can show the user what is happening.",
    "- Use `POST /api/manager/assistant/status` at round start, round completion, blocker discovery, and before changing strategy.",
    "- Keep reports short: one current state sentence and, when useful, one next action.",
    "- Valid phases: observing, deciding, acting, verifying, blocked, reporting, done.",
    "- Valid levels: info, success, warning, error.",
    "- Example body:",
    "",
    "```json",
    '{ "phase": "acting", "level": "info", "round": "R3", "scope": "orchestration", "message": "Worker A is writing the protocol draft.", "detail": "Next: verify output and update FAILURES.md." }',
    "```",
    "",
    "## Local Context",
    "",
    `- Repository root: ${input.repoRoot}`,
    `- Manager API base URL: ${input.apiBaseUrl}`,
    "- Site token is available only as the `DESKRELAY_SITE_TOKEN` environment variable.",
    "- Manager API base URL is also available as `DESKRELAY_MANAGER_API_BASE`.",
    "- Repository root is also available as `DESKRELAY_REPOSITORY_ROOT`.",
    "",
    "## API Usage",
    "",
    "Do not call APIs reflexively. Use an API only when it helps satisfy the identified intent.",
    "For every API call, know what question it answers, whether it is read-only or mutating, which scope it affects, and what result would change the next action.",
    "Use the DeskRelay HTTP API for operational facts instead of guessing.",
    "For authenticated `/api/*` calls, send `Authorization: Bearer $DESKRELAY_SITE_TOKEN` when the token exists.",
    "`GET /api/capabilities` is the live source of truth for route and behavior-method discovery.",
    "When behavior methods or route shapes are uncertain, discover capabilities before calling them.",
    "- Prefer the repository helper for DeskRelay API calls: `bun run scripts/manager-api.ts GET /api/manager/system/summary` from the repository root.",
    "- For multiple simple read-only GET checks, do not launch parallel shell tool calls. Use `bun run scripts/manager-api.ts batch-get summary=/api/manager/system/summary workers=/api/manager/workers` so one failed request is returned as a structured result instead of cancelling the whole observation.",
    "- For complex batches that need methods, bodies, or query strings, use `bun run scripts/manager-api.ts batch --file <requests.json>` or `bun run scripts/manager-api.ts batch --requests '<json-array>'`.",
    "- For POST, PUT, PATCH, or DELETE calls with JSON bodies, prefer `--body-file <request.json>` over inline shell JSON when quoting is not trivial.",
    "- The manager API helper reads `DESKRELAY_MANAGER_API_BASE` and `DESKRELAY_SITE_TOKEN` from the environment. Do not manually assemble Authorization headers in Bash or PowerShell unless the helper cannot satisfy the task.",
    "- Do not treat a device registry `connectionState: online` value as proof that the server can reach that connector. For operational decisions, confirm with `/api/devices/:id/doctor`, `/process/status`, or the specific API needed for the task.",
    "When verifying generated files, call `/api/devices/:id/fs/list?includeFiles=1` for the target directory. The default list is directory-only for the cwd picker.",
    "Use `/api/devices/:id/files/preview` for guarded image or UTF-8 text/Markdown previews. If a file type is unsupported, report that limitation rather than claiming the file was read.",
    "Avoid calling `POST /api/manager/assistant/chat` or `POST /api/manager/assistant/chat/stream` from inside the assistant unless you are deliberately testing the assistant endpoint.",
    "",
    "## Tool and Shell Policy",
    "",
    "- The server PC is Windows. Prefer PowerShell for local commands and HTTP calls.",
    "- For DeskRelay API calls, use `bun run scripts/manager-api.ts ...` before considering raw shell HTTP commands.",
    "- Do not use Bash for `scripts/manager-api.ts` calls on Windows. Run the helper from the repository root with PowerShell semantics.",
    "- Do not use parallel tool calls for shell commands that call DeskRelay APIs, build auth headers, create temp files, mutate state, or depend on shared process state.",
    "- Parallel observation is allowed only through a helper or API that preserves each result independently, such as `manager-api.ts batch`.",
    "- Do not put PowerShell syntax inside Bash. If a command uses `$env:`, hashtables, `Invoke-RestMethod`, or `ConvertTo-Json`, it must run in PowerShell.",
    "- Use Bash only when the command is explicitly shell-portable or a Unix shell is actually required.",
    "- For code/text search in this project, use PowerShell `Select-String` or targeted file reads. Do not rely on `rg`.",
    "- Prefer `Invoke-RestMethod` for JSON APIs and `Invoke-WebRequest` for previews or non-JSON responses.",
    "- If a command fails, do not blindly retry in another shell. Classify the failure first and report the command, endpoint, status, and likely cause.",
    "",
    "PowerShell example:",
    "",
    "```powershell",
    "$headers = @{}",
    'if ($env:DESKRELAY_SITE_TOKEN) { $headers.Authorization = "Bearer $env:DESKRELAY_SITE_TOKEN" }',
    'Invoke-RestMethod -Headers $headers "$env:DESKRELAY_MANAGER_API_BASE/api/manager/system/summary"',
    "```",
    "",
    "## Full HTTP API Surface",
    "",
    ...routeLines,
    "",
    "## Device Behavior Methods",
    "",
    "Call these through `POST /api/devices/:id/behaviors/:instance/request` with `{ method, params }`.",
    "The standard Claude behavior instance is usually `remote-claude`, but inspect `/api/devices/:id/behaviors` first.",
    "",
    ...behaviorMethodLines,
    "",
    "Common payload examples:",
    "",
    "```json",
    '{ "method": "sessions.list", "params": {} }',
    '{ "method": "sessions.read", "params": { "sessionId": "..." } }',
    '{ "method": "chat", "params": { "message": "...", "cwd": "..." } }',
    '{ "method": "chat", "params": { "message": "...", "cwd": "...", "sessionId": "..." } }',
    '{ "method": "interrupt", "params": {} }',
    '{ "method": "permissions.inspect", "params": { "cwd": "..." } }',
    '{ "method": "permissions.update", "params": { "mode": "auto" } }',
    "```",
    "",
    "## Write/Task APIs",
    "",
    "- Prefer `dryRun: true` first for manager task shortcuts when available.",
    "- Ask the user before destructive or disruptive actions unless the user already gave explicit instruction.",
    "- Do not ask again after a short reply that clearly resolves a pending decision, such as `go`, `진행`, `해`, `1`, `A`, or a named option.",
    "- If the user explicitly requested the exact mutating action, perform the smallest matching API call and verify afterward.",
    '- Manager task body: `{ "kind": "diagnose|update-server|update-device|update-all|restart-server|restart-device|repair-registration|run-worker", "targetId": "optional-device-id", "dryRun": true, "requestedBy": "manager-assistant", "params": {} }`.',
    '- Shortcut task bodies accept `{ "dryRun": true, "requestedBy": "manager-assistant" }` when supported.',
    '- Worker run body: `{ "profile": "claude-code", "prompt": "objective/scope/verification", "cwd": ".", "timeoutMs": 600000, "dryRun": false, "requestedBy": "manager-assistant" }`.',
    "",
    "## Safety Rules",
    "",
    "- Never print full Site tokens or daemon tokens in the answer.",
    "- If an API response contains a token-bearing registration or cleanup command, do not paste that command back into chat. Say that the command is available in the UI or command file, and redact token values as `[redacted]` in any diagnostic summary.",
    "- Do not expose connector daemon tokens; `/api/devices` intentionally omits them.",
    "- Summarize large logs; quote only the relevant lines.",
    "- If a command or API call fails, report the failing endpoint/command and the exact status or error.",
    "- When the user asks for status, use read APIs first and answer from observed data.",
    "- When the user asks for a repair/update, inspect current state, explain the intended action, then run the smallest matching API.",
    "- For destructive actions, report the exact target before acting and never broaden the target on your own.",
    "- After any mutation, re-read the relevant state and report whether the system actually changed.",
    "",
  ].join("\n");
}

function parseManagerAssistantArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return ["-p"];
  return raw
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(`Manager assistant CLI timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cancelManagerTask(
  task: ManagerTask,
  store: ManagerTaskStore,
  queue: DeviceUpdateQueueStore | undefined,
): Promise<{ ok: true; task: ManagerTask } | { ok: false; task: ManagerTask; error: string }> {
  const cancellable =
    task.state === "pending" ||
    task.state === "running" ||
    (task.state === "waiting_for_device" &&
      task.kind === "update-device" &&
      Boolean(task.targetId));
  if (!cancellable) {
    return {
      ok: false,
      task,
      error: `Task is already ${task.state}.`,
    };
  }
  if (task.state === "waiting_for_device" && task.targetId) {
    await queue?.remove(task.targetId).catch(() => undefined);
  }
  const updated =
    (await store.update(task.id, {
      state: "cancelled",
      completedAt: new Date().toISOString(),
      steps: [
        ...task.steps,
        taskStep({
          id: "task.cancelled",
          label: "Task cancelled",
          status: "skipped",
          summary: "Task was cancelled by request.",
        }),
      ],
    })) ?? task;
  return { ok: true, task: updated };
}

function buildRetryManagerTaskRequest(
  task: ManagerTask,
): { ok: true; value: ManagerTaskRequest } | { ok: false; error: string } {
  if (task.state === "pending" || task.state === "running") {
    return { ok: false, error: `cannot retry a ${task.state} task` };
  }
  if (task.state === "succeeded") {
    return { ok: false, error: "cannot retry a succeeded task" };
  }
  return {
    ok: true,
    value: {
      kind: task.kind,
      ...(task.targetId ? { targetId: task.targetId } : {}),
      ...(task.params ? { params: task.params } : {}),
      dryRun: task.dryRun,
      requestedBy: "manager-assistant",
    },
  };
}

async function runManagerTask(input: ManagerTaskRunInput): Promise<ManagerTask> {
  const startedAt = new Date().toISOString();
  const started = await input.store.update(input.task.id, {
    state: "running",
    startedAt,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "task.running",
        label: "Task running",
        status: "running",
        summary: "Task execution started.",
      }),
    ],
  });
  const task = started ?? input.task;
  try {
    const execution = await executeManagerTask({ ...input, task });
    return (
      (await input.store.update(task.id, {
        state: execution.state,
        ...(execution.targetLabel ? { targetLabel: execution.targetLabel } : {}),
        ...(execution.state !== "running" ? { completedAt: new Date().toISOString() } : {}),
        steps: execution.steps,
        ...(execution.result !== undefined ? { result: execution.result } : {}),
        ...(execution.error ? { error: execution.error } : {}),
      })) ?? task
    );
  } catch (err) {
    return (
      (await input.store.update(task.id, {
        state: "failed",
        completedAt: new Date().toISOString(),
        error: (err as Error).message,
        steps: [
          ...task.steps,
          taskStep({
            id: "task.failed",
            label: "Task failed",
            status: "failed",
            summary: (err as Error).message,
          }),
        ],
      })) ?? task
    );
  }
}

async function executeManagerTask(input: ManagerTaskRunInput): Promise<ManagerTaskExecutionResult> {
  switch (input.request.kind) {
    case "diagnose":
      return await executeDiagnoseTask(input);
    case "update-server":
      return await executeUpdateServerTask(input);
    case "update-device":
      return await executeUpdateDeviceTask(input);
    case "update-all":
      return await executeUpdateAllTask(input);
    case "restart-server":
      return await executeRestartServerTask(input);
    case "restart-device":
      return await executeRestartDeviceTask(input);
    case "repair-registration":
      return await executeRepairRegistrationTask(input);
    case "run-worker":
      return await executeRunWorkerTask(input);
  }
}

async function executeDiagnoseTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const urls = getAccessUrls(input.options.selfHostUrl ?? input.requestUrl);
  const reports = [
    await buildServerDiagnosticReport({
      fetchImpl: input.fetchImpl,
      registry: input.registry,
      token: input.options.token,
      localToken: input.localToken,
      build: input.build,
      urls,
    }),
  ];
  for (const device of input.registry.list()) {
    reports.push(
      await buildDeviceDiagnosticReport({
        fetchImpl: input.fetchImpl,
        registry: input.registry,
        device,
        localToken: input.localToken,
        serverBuild: input.build,
      }),
    );
  }
  const diagnosticSteps = reports.flatMap((report) => report.steps ?? []);
  return {
    state: "succeeded",
    steps: [
      ...input.task.steps,
      taskStep({
        id: "diagnose.completed",
        label: "Diagnostics completed",
        status: "ok",
        summary: `Collected diagnostics for server and ${Math.max(0, reports.length - 1)} device(s).`,
      }),
      ...diagnosticSteps,
    ],
    result: { reports },
  };
}

async function executeUpdateServerTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  if (input.request.dryRun !== false) {
    return dryRunTask(input, "server.update.plan", "Server update would be requested.");
  }
  if (!input.options.selfServerUpdater) {
    return blockedTask(
      input,
      "server.update.unconfigured",
      "Self server updater is not configured.",
    );
  }
  const status = await input.options.selfServerUpdater.status().catch((err) => ({
    state: "failed",
    error: (err as Error).message,
  }));
  if (status.state === "running") {
    return blockedTask(input, "server.update.already-running", "Server update is already running.");
  }
  const result = await input.options.selfServerUpdater.update();
  const state = result.started
    ? "running"
    : result.status?.state === "failed"
      ? "failed"
      : result.supported
        ? "failed"
        : "blocked";
  return {
    state,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "server.update.requested",
        label: "Server update",
        status: result.started ? "running" : result.supported ? "failed" : "failed",
        summary: result.started
          ? "Server update process started."
          : result.error || "Server update could not be started.",
      }),
    ],
    result,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function executeUpdateDeviceTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const device = resolveManagerTargetDevice(input);
  if (!device.ok) return device.result;
  if (input.request.dryRun !== false) {
    return dryRunTask(
      input,
      "device.update.plan",
      `Connector update would be requested for ${device.value.label}.`,
      device.value.label,
    );
  }
  const response = await requestDaemonSystemUpdate(
    input.fetchImpl,
    device.value,
    daemonToken(device.value, input.localToken),
    buildFallbackRegisterCommandForRequest(input.options, input.requestUrl),
    input.options.deviceUpdateQueue,
    resolveServerUpdateBranch(input.options),
  );
  const payload = await readJsonResponse(response);
  const state = stateFromDeviceUpdateResponse(response.status, payload);
  const summary =
    updateSummaryFromPayload(payload) ?? `Device update returned HTTP ${response.status}.`;
  return {
    state,
    targetLabel: device.value.label,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "device.update.requested",
        label: "Device update",
        status:
          state === "failed"
            ? "failed"
            : state === "waiting_for_device"
              ? "pending"
              : state === "running"
                ? "running"
                : "ok",
        summary,
      }),
    ],
    result: payload,
    ...(state === "failed" ? { error: summary } : {}),
  };
}

async function executeUpdateAllTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  if (input.request.dryRun !== false) {
    const plan = await buildManagerUpdatePlan({
      options: input.options,
      registry: input.registry,
      build: input.build,
      fetchImpl: input.fetchImpl,
      localToken: input.localToken,
    });
    return {
      state: "succeeded",
      steps: [
        ...input.task.steps,
        taskStep({
          id: "update-all.plan",
          label: "Update plan",
          status: "ok",
          summary: `Update plan contains ${plan.items.length} item(s).`,
        }),
      ],
      result: plan,
    };
  }

  const results: unknown[] = [];
  const steps = [...input.task.steps];
  for (const device of input.registry.list()) {
    const deviceResult = await executeUpdateDeviceTask({
      ...input,
      request: { ...input.request, kind: "update-device", targetId: device.id, dryRun: false },
    });
    results.push(deviceResult.result);
    steps.push(...deviceResult.steps.slice(input.task.steps.length));
  }

  const serverResult = await executeUpdateServerTask({
    ...input,
    request: { ...input.request, kind: "update-server", dryRun: false },
  });
  results.push(serverResult.result);
  steps.push(...serverResult.steps.slice(input.task.steps.length));

  const states = steps.filter((step) => step.id !== "task.created").map((step) => step.status);
  const state: ManagerTaskState = states.includes("failed")
    ? "failed"
    : states.includes("pending")
      ? "waiting_for_device"
      : states.includes("running")
        ? "running"
        : "succeeded";
  return {
    state,
    steps,
    result: { results },
    ...(state === "failed" ? { error: "One or more update steps failed." } : {}),
  };
}

async function executeRestartServerTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  if (input.request.dryRun !== false) {
    return dryRunTask(input, "server.restart.plan", "Server restart would be requested.");
  }
  if (!input.options.selfServerProcess) {
    return blockedTask(
      input,
      "server.restart.unconfigured",
      "Self server restart is not configured.",
    );
  }
  const result = await input.options.selfServerProcess.restart();
  return {
    state: result.accepted ? "succeeded" : "blocked",
    steps: [
      ...input.task.steps,
      taskStep({
        id: "server.restart.requested",
        label: "Server restart",
        status: result.accepted ? "ok" : "failed",
        summary: result.message,
      }),
    ],
    result,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function executeRestartDeviceTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const device = resolveManagerTargetDevice(input);
  if (!device.ok) return device.result;
  if (input.request.dryRun !== false) {
    return dryRunTask(
      input,
      "device.restart.plan",
      `Connector restart would be requested for ${device.value.label}.`,
      device.value.label,
    );
  }
  const response = await proxyJson(
    input.fetchImpl,
    "POST",
    `${device.value.daemonUrl}/process/restart`,
    undefined,
    daemonToken(device.value, input.localToken),
  );
  const payload = await readJsonResponse(response);
  const accepted = response.status === 202 || (isRecord(payload) && payload.accepted === true);
  const summary =
    isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `Restart returned HTTP ${response.status}.`;
  return {
    state: accepted ? "succeeded" : response.ok ? "blocked" : "failed",
    targetLabel: device.value.label,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "device.restart.requested",
        label: "Device restart",
        status: accepted ? "ok" : "failed",
        summary,
      }),
    ],
    result: payload,
    ...(!accepted ? { error: summary } : {}),
  };
}

async function executeRepairRegistrationTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const analysis = await analyzeLastRegistrationFailure(input.options.installReportStore);
  if (!analysis.found) {
    return blockedTask(
      input,
      "registration.no-failure",
      "No failed registration report was found.",
    );
  }
  if (input.request.dryRun !== false) {
    return {
      state: "succeeded",
      steps: [
        ...input.task.steps,
        taskStep({
          id: "registration.analysis",
          label: "Registration failure analysis",
          status: analysis.retrySafe ? "warn" : "failed",
          summary: analysis.classification ?? "Registration failure classified.",
          ...(analysis.action ? { action: analysis.action } : {}),
        }),
      ],
      result: analysis,
    };
  }
  return {
    state: "blocked",
    steps: [
      ...input.task.steps,
      taskStep({
        id: "registration.repair.blocked",
        label: "Registration repair",
        status: "failed",
        summary:
          "Automatic registration repair is not enabled yet. Use the suggested action from the analysis.",
        ...(analysis.action ? { action: analysis.action } : {}),
      }),
    ],
    result: analysis,
    error: "automatic registration repair is not implemented",
  };
}

async function executeRunWorkerTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const params = parseManagerWorkerParams(input.request.params);
  if (!params.ok) return blockedTask(input, "worker.params.invalid", params.error);

  const profiles = buildManagerWorkerProfiles(input.options);
  const profile = profiles.find((item) => item.id === params.value.profile);
  if (!profile) {
    return blockedTask(
      input,
      "worker.profile.unknown",
      `Unknown worker profile: ${params.value.profile}.`,
    );
  }
  if (!profile.available) {
    return blockedTask(
      input,
      "worker.profile.unavailable",
      `Worker profile is unavailable: ${profile.id}.`,
    );
  }

  const cwd = resolveManagerWorkerCwd(
    input.options.managerAssistant?.cwd ?? process.cwd(),
    params.value.cwd,
  );
  if (!cwd.ok) return blockedTask(input, "worker.cwd.invalid", cwd.error);

  const commandPreview = managerWorkerCommandPreview(profile);
  if (input.request.dryRun !== false) {
    return {
      state: "succeeded",
      targetLabel: profile.label,
      steps: [
        ...input.task.steps,
        taskStep({
          id: "worker.plan",
          label: "Worker planned",
          status: "ok",
          summary: `${profile.label} would run in ${cwd.value}.`,
          evidence: [commandPreview],
        }),
      ],
      result: {
        dryRun: true,
        profile: profile.id,
        cwd: cwd.value,
        command: commandPreview,
        promptPreview: truncateText(params.value.prompt, 500),
      },
    };
  }

  const check = await checkManagerWorkerProfile(profile);
  if (!check.available) {
    return {
      state: "blocked",
      targetLabel: profile.label,
      steps: [
        ...input.task.steps,
        taskStep({
          id: "worker.check.failed",
          label: "Worker unavailable",
          status: "failed",
          summary:
            check.error ??
            (check.timedOut
              ? `${profile.label} did not respond to its check command.`
              : `${profile.label} check exited with code ${check.exitCode ?? "unknown"}.`),
          evidence: [
            `${check.command} ${check.args.join(" ")}`.trim(),
            ...(check.stderr ? [truncateText(check.stderr, 500)] : []),
          ],
        }),
      ],
      result: check,
      error:
        check.error ??
        (check.timedOut
          ? `${profile.label} check timed out.`
          : `${profile.label} is not available.`),
    };
  }

  const timeoutMs = clampWorkerTimeoutMs(params.value.timeoutMs ?? profile.defaultTimeoutMs);
  const started = Date.now();
  const result = await runManagerWorkerCli({
    profile,
    prompt: params.value.prompt,
    cwd: cwd.value,
    timeoutMs,
    apiBaseUrl: managerAssistantApiBaseUrl(input.options, input.requestUrl),
    repoRoot: input.options.managerAssistant?.cwd ?? process.cwd(),
    token: input.options.token,
  });
  const succeeded = result.exitCode === 0 && !result.timedOut;
  const summary = result.timedOut
    ? `${profile.label} timed out after ${timeoutMs}ms.`
    : succeeded
      ? `${profile.label} completed in ${Date.now() - started}ms.`
      : `${profile.label} exited with code ${result.exitCode}.`;
  return {
    state: succeeded ? "succeeded" : "failed",
    targetLabel: profile.label,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "worker.completed",
        label: "Worker CLI",
        status: succeeded ? "ok" : "failed",
        summary,
        evidence: [commandPreview, `cwd: ${cwd.value}`],
      }),
    ],
    result,
    ...(!succeeded ? { error: summary } : {}),
  };
}

function dryRunTask(
  input: ManagerTaskRunInput,
  id: string,
  summary: string,
  targetLabel?: string,
): ManagerTaskExecutionResult {
  return {
    state: "succeeded",
    ...(targetLabel ? { targetLabel } : {}),
    steps: [
      ...input.task.steps,
      taskStep({
        id,
        label: "Dry run",
        status: "ok",
        summary,
      }),
    ],
    result: { dryRun: true },
  };
}

function blockedTask(
  input: ManagerTaskRunInput,
  id: string,
  summary: string,
): ManagerTaskExecutionResult {
  return {
    state: "blocked",
    steps: [
      ...input.task.steps,
      taskStep({
        id,
        label: "Blocked",
        status: "failed",
        summary,
      }),
    ],
    error: summary,
  };
}

function resolveManagerTargetDevice(
  input: ManagerTaskRunInput,
): { ok: true; value: Device } | { ok: false; result: ManagerTaskExecutionResult } {
  const targetId = input.request.targetId;
  if (!targetId) {
    return {
      ok: false,
      result: blockedTask(input, "device.target.missing", "targetId is required for this task."),
    };
  }
  const device = input.registry.get(targetId);
  if (!device) {
    return {
      ok: false,
      result: blockedTask(input, "device.target.unknown", `unknown device: ${targetId}`),
    };
  }
  return { ok: true, value: device };
}

async function buildManagerUpdatePlan(input: {
  options: SiteAppOptions;
  registry: DeviceRegistry;
  build: DeskRelayBuildInfo;
  fetchImpl?: NonNullable<SiteAppOptions["fetchImpl"]>;
  localToken?: string | undefined;
}): Promise<ManagerUpdatePlan> {
  const generatedAt = new Date().toISOString();
  const items: ManagerUpdatePlan["items"] = [];
  const serverUpdate = input.options.selfServerUpdater
    ? await input.options.selfServerUpdater.status().catch((err) => ({
        state: "failed",
        error: (err as Error).message,
      }))
    : undefined;
  const serverUpdateAvailable =
    isRecord(serverUpdate) &&
    "updateAvailable" in serverUpdate &&
    serverUpdate.updateAvailable === true;
  const serverUpdateState =
    isRecord(serverUpdate) && typeof serverUpdate.state === "string"
      ? serverUpdate.state
      : undefined;
  items.push({
    scope: "server",
    targetLabel: "DeskRelay server",
    action: serverUpdate
      ? serverUpdateState === "running"
        ? "blocked"
        : serverUpdateAvailable
          ? "update"
          : "none"
      : "unknown",
    ...(serverUpdateState ? { state: serverUpdateState } : {}),
    reason: serverUpdate
      ? serverUpdateState === "running"
        ? "Server update is already running."
        : serverUpdateAvailable
          ? "Remote update is available."
          : "No server update is currently reported."
      : "Server updater is not configured.",
  });

  const queueEntries = input.options.deviceUpdateQueue
    ? await input.options.deviceUpdateQueue.list().catch(() => [])
    : [];
  for (const device of input.registry.list()) {
    const queued = queueEntries.find((entry) => entry.deviceId === device.id);
    const installStatus = input.fetchImpl
      ? await buildDeviceInstallStatus(
          input.fetchImpl,
          device,
          daemonToken(device, input.localToken),
          input.options.deviceUpdateQueue,
        ).catch(() => null)
      : null;
    const deviceMatchesServer = installStatus ? sameBuild(input.build, installStatus.build) : null;
    const queuedState = queued?.state;
    const queueIsActive =
      queuedState === "pending_until_device_online" ||
      queuedState === "queued" ||
      queuedState === "running";
    let action: ManagerUpdatePlan["items"][number]["action"];
    let state: string | undefined;
    let reason: string;
    if (queueIsActive && queued) {
      state = queuedState;
      action =
        queuedState === "pending_until_device_online" || queuedState === "queued"
          ? "queue"
          : "blocked";
      reason =
        queued.warning ||
        queued.error ||
        (queuedState === "running"
          ? "Connector update is already running."
          : `Queued update state: ${queuedState}.`);
    } else if (installStatus) {
      state =
        installStatus.update?.state ||
        queuedState ||
        (installStatus.running ? "running" : undefined);
      if (deviceMatchesServer === false) {
        action = queuedState === "restart_required" ? "restart" : "update";
        reason =
          queuedState === "restart_required"
            ? "Connector restart is required to activate the updated build."
            : "Connector update is available.";
      } else if (deviceMatchesServer === true) {
        action = "none";
        reason = "Connector build matches the server.";
      } else {
        action = "unknown";
        reason = installStatus.summary.message;
      }
    } else if (queued) {
      state = queuedState;
      action =
        queuedState === "restart_required"
          ? "restart"
          : queuedState === "failed"
            ? "update"
            : "none";
      reason = queued.warning || queued.error || `Queued update state: ${queuedState}.`;
    } else {
      action = "unknown";
      reason = "Device install status is unavailable.";
    }
    items.push({
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      action,
      ...(state ? { state } : {}),
      reason,
    });
  }

  const severity = items.some((item) => item.action === "blocked")
    ? "warn"
    : items.some((item) => item.action === "update" || item.action === "queue")
      ? "warn"
      : "ok";
  return {
    generatedAt,
    items,
    summary: {
      severity,
      message: `${items.length} update target(s) inspected.`,
    },
  };
}

async function buildManagerUpdateStatus(input: {
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
}): Promise<ManagerUpdateStatus> {
  const generatedAt = new Date().toISOString();
  const [serverUpdate, plan] = await Promise.all([
    input.options.selfServerUpdater
      ? input.options.selfServerUpdater.status().catch((err) => ({
          state: "failed",
          error: (err as Error).message,
        }))
      : Promise.resolve({ state: "unconfigured" }),
    buildManagerUpdatePlan({
      options: input.options,
      registry: input.registry,
      build: input.build,
      fetchImpl: input.fetchImpl,
      localToken: input.localToken,
    }),
  ]);
  const server = updateTargetFromRaw({
    scope: "server",
    targetLabel: "DeskRelay server",
    raw: serverUpdate,
  });
  const devices: ManagerUpdateTargetStatus[] = [];
  for (const device of input.registry.list()) {
    const status = await buildDeviceInstallStatus(
      input.fetchImpl,
      device,
      daemonToken(device, input.localToken),
      input.options.deviceUpdateQueue,
    );
    devices.push(updateTargetFromInstallStatus(status));
  }
  const severity = maxManagerSeverity([
    server.summary.severity,
    ...devices.map((device) => device.summary.severity),
    plan.summary.severity,
  ]);
  return {
    generatedAt,
    server,
    devices,
    plan,
    summary: {
      severity,
      message: `Update status inspected for ${devices.length + 1} target(s).`,
    },
  };
}

function updateTargetFromRaw(input: {
  scope: "server" | "device";
  targetId?: string;
  targetLabel: string;
  raw: unknown;
}): ManagerUpdateTargetStatus {
  const state =
    isRecord(input.raw) && typeof input.raw.state === "string" ? input.raw.state : "unknown";
  const error = isRecord(input.raw) && typeof input.raw.error === "string" ? input.raw.error : "";
  const updateAvailable =
    isRecord(input.raw) && typeof input.raw.updateAvailable === "boolean"
      ? input.raw.updateAvailable
      : undefined;
  const changed =
    isRecord(input.raw) && typeof input.raw.changed === "boolean" ? input.raw.changed : undefined;
  const severity =
    state === "failed" || error ? "error" : updateAvailable || state === "running" ? "warn" : "ok";
  return {
    scope: input.scope,
    ...(input.targetId ? { targetId: input.targetId } : {}),
    targetLabel: input.targetLabel,
    state,
    ...(updateAvailable !== undefined ? { updateAvailable } : {}),
    ...(changed !== undefined ? { changed } : {}),
    ...(error ? { error } : {}),
    summary: {
      severity,
      message: error || `Update state: ${state}.`,
    },
  };
}

function updateTargetFromInstallStatus(status: ManagerInstallStatus): ManagerUpdateTargetStatus {
  const queueState = status.queue?.state;
  const updateState = status.update?.state;
  const state = queueState ?? updateState ?? (status.running ? "running" : "offline");
  const updateAvailable = status.update?.updateAvailable;
  const changed = status.update?.changed;
  const error = status.queue?.error ?? status.update?.error;
  const severity =
    status.summary.severity === "error" || error
      ? "error"
      : status.summary.severity === "warn" || updateAvailable || Boolean(queueState)
        ? "warn"
        : "ok";
  return {
    scope: "device",
    ...(status.targetId ? { targetId: status.targetId } : {}),
    ...(status.targetLabel ? { targetLabel: status.targetLabel } : {}),
    state,
    ...(updateAvailable !== undefined ? { updateAvailable } : {}),
    ...(changed !== undefined ? { changed } : {}),
    ...(error ? { error } : {}),
    summary: {
      severity,
      message: error || status.summary.message,
    },
  };
}

async function buildManagerSystemSummary(input: {
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  requestUrl: string;
  store: ManagerTaskStore;
}): Promise<ManagerSystemSummary> {
  const generatedAt = new Date().toISOString();
  const urls = getAccessUrls(input.options.selfHostUrl ?? input.requestUrl);
  const [install, update, registration, recentTasks] = await Promise.all([
    buildSelfInstallStatus(input.options, input.build),
    buildManagerUpdatePlan({
      options: input.options,
      registry: input.registry,
      build: input.build,
      fetchImpl: input.fetchImpl,
      localToken: input.localToken,
    }),
    analyzeLastRegistrationFailure(input.options.installReportStore),
    input.store.list(5),
  ]);
  const network = buildSelfNetworkStatus(urls);
  const security = buildSelfSecurityBoundary(input.options, urls);
  const severity = maxManagerSeverity([
    install.summary.severity,
    network.summary.severity,
    security.summary.severity,
    update.summary.severity,
    registration.found ? "warn" : "ok",
  ]);
  return {
    generatedAt,
    build: input.build,
    devices: input.registry.list().map(toPublicDevice),
    server: {
      install,
      network,
      security,
    },
    update,
    registration,
    recentTasks: recentTasks.map(sanitizeManagerTaskForAssistant),
    summary: {
      severity,
      message: `Server and ${input.registry.list().length} device(s) summarized.`,
    },
  };
}

function buildManagerDeviceActions(device: Device): ManagerDeviceActions {
  return {
    generatedAt: new Date().toISOString(),
    deviceId: device.id,
    label: device.label,
    actions: [
      {
        id: "diagnose",
        label: "Run device diagnostics",
        enabled: true,
        method: "GET",
        path: `/api/devices/${device.id}/doctor`,
      },
      {
        id: "update",
        label: "Update connector",
        enabled: true,
        method: "POST",
        path: "/api/manager/tasks",
        taskKind: "update-device",
      },
      {
        id: "restart",
        label: "Restart connector",
        enabled: true,
        method: "POST",
        path: "/api/manager/tasks",
        taskKind: "restart-device",
      },
      {
        id: "logs",
        label: "Read connector logs",
        enabled: true,
        method: "GET",
        path: `/api/devices/${device.id}/logs`,
      },
      {
        id: "remove",
        label: "Remove device",
        enabled: true,
        method: "DELETE",
        path: `/api/devices/${device.id}`,
        destructive: true,
      },
    ],
  };
}

async function buildManagerRegistrationDiagnosis(input: {
  options: SiteAppOptions;
  requestUrl: string;
}): Promise<ManagerRegistrationDiagnosis> {
  const generatedAt = new Date().toISOString();
  const urls = getAccessUrls(input.options.selfHostUrl ?? input.requestUrl);
  const network = buildSelfNetworkStatus(urls);
  const lastFailure = await analyzeLastRegistrationFailure(input.options.installReportStore);
  const preferredUrl = pickRemoteAccessUrl(urls);
  const steps = [
    taskStep({
      id: "registration.site-token",
      label: "Site token",
      status: input.options.token ? "ok" : "failed",
      summary: input.options.token ? "Site token is configured." : "Site token is not configured.",
      retrySafe: false,
    }),
    taskStep({
      id: "registration.server-url",
      label: "Server URL",
      status: network.summary.severity === "ok" ? "ok" : "warn",
      summary: network.summary.message,
      retrySafe: true,
    }),
    taskStep({
      id: "registration.tailscale",
      label: "Tailscale",
      status: network.tailscale.detected ? "ok" : "warn",
      summary: network.tailscale.detected
        ? "Tailscale address is available."
        : "No Tailscale address is currently detected on the server.",
      retrySafe: true,
    }),
    ...(lastFailure.failureStep
      ? [
          taskStep({
            id: "registration.last-failure",
            label: "Last registration failure",
            status: lastFailure.retrySafe ? "warn" : "failed",
            summary: lastFailure.classification ?? lastFailure.failureStep.summary,
            ...(lastFailure.action ? { action: lastFailure.action } : {}),
            ...(lastFailure.retrySafe !== undefined ? { retrySafe: lastFailure.retrySafe } : {}),
          }),
        ]
      : []),
  ];
  const severity = maxManagerSeverity([
    ...steps.map((step) => step.severity),
    lastFailure.found ? "warn" : "ok",
  ]);
  return {
    generatedAt,
    serverUrl: preferredUrl,
    siteTokenConfigured: Boolean(input.options.token),
    tailscaleDetected: network.tailscale.detected,
    steps,
    lastFailure,
    summary: {
      severity,
      message: lastFailure.found
        ? "Registration diagnosis includes the latest failed install report."
        : "Registration prerequisites were inspected.",
    },
  };
}

async function buildManagerSecurityBoundarySummary(input: {
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  urls: AccessUrl[];
}): Promise<ManagerSecurityBoundarySummary> {
  const generatedAt = new Date().toISOString();
  const server = buildSelfSecurityBoundary(input.options, input.urls);
  const devices: ManagerSecurityBoundary[] = [];
  for (const device of input.registry.list()) {
    devices.push(
      await buildDeviceSecurityBoundary(
        input.fetchImpl,
        device,
        daemonToken(device, input.localToken),
      ),
    );
  }
  const warnings = [...server.warnings, ...devices.flatMap((device) => device.warnings)];
  return {
    generatedAt,
    server,
    devices,
    warnings,
    summary: {
      severity: warnings.length > 0 ? "warn" : "ok",
      message:
        warnings.length > 0
          ? `${warnings.length} security boundary warning(s).`
          : "Server and device security boundaries are constrained.",
    },
  };
}

async function analyzeLastRegistrationFailure(store: InstallReportStore | undefined): Promise<{
  generatedAt: string;
  found: boolean;
  reportId?: string;
  receivedAt?: string;
  status?: string;
  label?: string;
  failureStep?: ManagerTask["steps"][number];
  classification?: string;
  retrySafe?: boolean;
  action?: string;
}> {
  const generatedAt = new Date().toISOString();
  if (!store) return { generatedAt, found: false };
  const reports = await store.list(20).catch(() => []);
  const report = reports.find((item) => item.status === "failed");
  if (!report) return { generatedAt, found: false };
  const failureStep =
    report.steps.find((step) => step.severity === "error") ??
    report.steps.find((step) => step.status !== "ok");
  const classification = classifyRegistrationFailure(failureStep);
  const action = redactManagerSensitiveText(
    actionFromRegistrationFailure(failureStep, classification) ?? "",
  );
  const safeFailureStep = failureStep ? sanitizeDiagnosticStepForAssistant(failureStep) : undefined;
  return {
    generatedAt,
    found: true,
    reportId: report.id,
    receivedAt: report.receivedAt,
    status: report.status,
    ...(report.label ? { label: report.label } : {}),
    ...(safeFailureStep ? { failureStep: safeFailureStep } : {}),
    classification,
    retrySafe: failureStep?.retrySafe ?? isRetrySafeRegistrationClassification(classification),
    ...(action ? { action } : {}),
  };
}

function parseManagerTaskRequest(
  input: unknown,
): { ok: true; value: ManagerTaskRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "body must be an object" };
  if (!isManagerTaskKind(input.kind)) return { ok: false, error: "unsupported task kind" };
  const requestedBy =
    input.requestedBy === "manager-assistant" || input.requestedBy === "system"
      ? input.requestedBy
      : "browser";
  return {
    ok: true,
    value: {
      kind: input.kind,
      ...(typeof input.targetId === "string" && input.targetId.trim()
        ? { targetId: input.targetId.trim() }
        : {}),
      dryRun: input.dryRun !== false,
      requestedBy,
      ...(isRecord(input.params) ? { params: input.params } : {}),
    },
  };
}

function parseManagerAssistantChatRequest(
  input: unknown,
): { ok: true; value: ManagerAssistantChatRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "body must be an object" };
  if (typeof input.message !== "string" || !input.message.trim()) {
    return { ok: false, error: "message is required" };
  }
  if (input.message.length > 20_000) return { ok: false, error: "message is too long" };
  const context = normalizeAssistantContext(input.context);
  const assistantState = normalizeAssistantState(input.assistantState);
  return {
    ok: true,
    value: {
      message: input.message.trim(),
      history: normalizeAssistantHistory(input.history),
      ...(context ? { context } : {}),
      ...(assistantState ? { assistantState } : {}),
    },
  };
}

function normalizeAssistantContext(input: unknown): ManagerAssistantChatContext | undefined {
  if (!isRecord(input)) return undefined;
  const context: ManagerAssistantChatContext = {};
  if (typeof input.deviceId === "string" && input.deviceId.trim()) {
    context.deviceId = input.deviceId.trim().slice(0, 200);
  }
  if (typeof input.deviceLabel === "string" && input.deviceLabel.trim()) {
    context.deviceLabel = input.deviceLabel.trim().slice(0, 500);
  }
  if (input.deviceConnectionState === "online" || input.deviceConnectionState === "offline") {
    context.deviceConnectionState = input.deviceConnectionState;
  }
  if (typeof input.sessionId === "string" && input.sessionId.trim()) {
    context.sessionId = input.sessionId.trim().slice(0, 500);
  }
  if (typeof input.sessionTitle === "string" && input.sessionTitle.trim()) {
    context.sessionTitle = input.sessionTitle.trim().slice(0, 1_000);
  }
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    context.cwd = input.cwd.trim().slice(0, 2_000);
  }
  return Object.keys(context).length ? context : undefined;
}

function formatManagerAssistantBrowserContext(
  context: ManagerAssistantChatContext | undefined,
): string {
  if (!context) return "";
  const lines: string[] = [];
  if (context.deviceId) lines.push(`- selected device id: ${context.deviceId}`);
  if (context.deviceLabel) lines.push(`- selected device label: ${context.deviceLabel}`);
  if (context.deviceConnectionState) {
    lines.push(`- selected device connection: ${context.deviceConnectionState}`);
  }
  if (context.sessionId) lines.push(`- selected session id: ${context.sessionId}`);
  if (context.sessionTitle) lines.push(`- selected session title: ${context.sessionTitle}`);
  if (context.cwd) lines.push(`- selected/current cwd: ${context.cwd}`);
  return lines.join("\n");
}

function normalizeAssistantState(input: unknown): ManagerAssistantStructuredState | undefined {
  if (!isRecord(input)) return undefined;
  const state: ManagerAssistantStructuredState = {};
  if (typeof input.sessionId === "string" && input.sessionId.trim()) {
    state.sessionId = input.sessionId.trim().slice(0, 500);
  }
  if (typeof input.lastAssistantText === "string" && input.lastAssistantText.trim()) {
    state.lastAssistantText = sanitizeManagerAssistantText(input.lastAssistantText).slice(0, 8_000);
  }
  if (isRecord(input.pendingDecision)) {
    const decision = input.pendingDecision;
    const options = Array.isArray(decision.options)
      ? decision.options
          .filter(isManagerAssistantDecisionOption)
          .map((option) => ({
            key: option.key.trim().slice(0, 24),
            label: sanitizeManagerAssistantText(option.label).replace(/\s+/g, " ").slice(0, 400),
            ...(option.detail
              ? {
                  detail: sanitizeManagerAssistantText(option.detail)
                    .replace(/\s+/g, " ")
                    .slice(0, 400),
                }
              : {}),
          }))
          .slice(0, 12)
      : [];
    if (options.length) {
      state.pendingDecision = {
        id:
          typeof decision.id === "string" && decision.id.trim()
            ? decision.id.trim().slice(0, 120)
            : "pending-decision",
        ...(typeof decision.prompt === "string" && decision.prompt.trim()
          ? { prompt: decision.prompt.trim().slice(0, 1_000) }
          : {}),
        options,
        ...(typeof decision.createdAt === "string" && decision.createdAt.trim()
          ? { createdAt: decision.createdAt.trim().slice(0, 120) }
          : {}),
      };
    }
  }
  if (isRecord(input.task)) {
    const task = input.task;
    const taskState =
      typeof task.state === "string" && isManagerAssistantTaskState(task.state)
        ? task.state
        : "idle";
    state.task = {
      state: taskState,
      ...(typeof task.title === "string" && task.title.trim()
        ? { title: task.title.trim().slice(0, 240) }
        : {}),
      ...(typeof task.updatedAt === "string" && task.updatedAt.trim()
        ? { updatedAt: task.updatedAt.trim().slice(0, 120) }
        : {}),
    };
  }
  const facts = normalizeManagerAssistantStringList(input.facts);
  const decisions = normalizeManagerAssistantStringList(input.decisions);
  const openQuestions = normalizeManagerAssistantStringList(input.openQuestions);
  if (facts.length) state.facts = facts;
  if (decisions.length) state.decisions = decisions;
  if (openQuestions.length) state.openQuestions = openQuestions;
  return Object.keys(state).length ? state : undefined;
}

function isManagerAssistantDecisionOption(input: unknown): input is ManagerAssistantDecisionOption {
  if (!isRecord(input)) return false;
  return (
    typeof input.key === "string" &&
    input.key.trim() !== "" &&
    typeof input.label === "string" &&
    input.label.trim() !== ""
  );
}

function isManagerAssistantTaskState(
  value: string,
): value is NonNullable<ManagerAssistantStructuredState["task"]>["state"] {
  return [
    "idle",
    "planning",
    "waiting_user_choice",
    "executing",
    "verifying",
    "blocked",
    "done",
  ].includes(value);
}

function normalizeManagerAssistantStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => sanitizeManagerAssistantText(value).replace(/\s+/g, " ").trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeAssistantHistory(input: unknown): ManagerAssistantChatMessage[] {
  if (!Array.isArray(input)) return [];
  const history: ManagerAssistantChatMessage[] = [];
  for (const item of input) {
    if (!isRecord(item)) continue;
    if (item.role !== "user" && item.role !== "assistant" && item.role !== "system") continue;
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    const text = sanitizeManagerAssistantText(item.text);
    if (!text) continue;
    history.push({
      id: typeof item.id === "string" && item.id.trim() ? item.id : `history_${history.length}`,
      role: item.role,
      text: text.slice(0, 20_000),
      createdAt:
        typeof item.createdAt === "string" && item.createdAt.trim()
          ? item.createdAt
          : new Date(0).toISOString(),
    });
  }
  return history.slice(-20);
}

async function parseManagerShortcutRequest(
  req: { json(): Promise<unknown> },
  kind: ManagerTaskKind,
): Promise<{ ok: true; value: ManagerTaskRequest } | { ok: false; error: string }> {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  return parseManagerTaskRequest({ ...body, kind });
}

async function parseManagerWorkerRunRequest(req: { json(): Promise<unknown> }): Promise<
  { ok: true; value: ManagerTaskRequest } | { ok: false; error: string }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "body must be valid JSON" };
  }
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  const params = parseManagerWorkerParams(body);
  if (!params.ok) return { ok: false, error: params.error };
  return parseManagerTaskRequest({
    kind: "run-worker",
    dryRun: body.dryRun,
    requestedBy: body.requestedBy,
    params: params.value,
  });
}

function isManagerTaskKind(value: unknown): value is ManagerTaskKind {
  return (
    value === "diagnose" ||
    value === "update-server" ||
    value === "update-device" ||
    value === "update-all" ||
    value === "restart-server" ||
    value === "restart-device" ||
    value === "repair-registration" ||
    value === "run-worker"
  );
}

function maxManagerSeverity(
  values: Array<DiagnosticSeverity | undefined>,
): "ok" | "warn" | "error" | "unknown" {
  if (values.includes("error")) return "error";
  if (values.includes("warn")) return "warn";
  if (values.includes("unknown")) return "unknown";
  return "ok";
}

function taskStep(input: Omit<ManagerTask["steps"][number], "severity" | "source">) {
  return normalizeDiagnosticStep({
    ...input,
    source: "server",
    lastCheckedAt: input.lastCheckedAt ?? new Date().toISOString(),
  });
}

function clampListLimit(value: string | undefined): number {
  const n = Number(value ?? "50");
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface ManagerSessionReadRequest {
  deviceId?: string;
  behaviorInstanceId?: string;
  sessionId: string;
  cwd?: string;
  projectsDir?: string;
  maxBytes?: number;
  eventLimit?: number;
  listLimit: number;
}

interface ManagerSessionReadAttempt {
  deviceId: string;
  label: string;
  daemonUrl: string;
  stage: string;
  error: string;
  status?: number;
}

interface ManagerBehaviorDescriptor {
  instanceId: string;
  name?: string;
  packageName?: string;
  version?: string;
  loadedAt?: string;
}

interface ManagerSessionCandidate {
  sessionId: string;
  cwd: string;
  title?: string;
  fullTitle?: string;
  modifiedAt?: string;
  fileSize?: number;
}

class ManagerSessionReadError extends Error {
  constructor(
    readonly stage: string,
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ManagerSessionReadError";
  }
}

function parseManagerSessionReadRequest(
  value: unknown,
): { ok: true; value: ManagerSessionReadRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "JSON object body is required" };
  const sessionId = parseRequiredStringField(value, "sessionId");
  if (!sessionId.ok) return sessionId;
  const deviceId = parseOptionalStringField(value, "deviceId");
  if (!deviceId.ok) return deviceId;
  const behaviorInstanceId = parseOptionalStringField(value, "behaviorInstanceId");
  if (!behaviorInstanceId.ok) return behaviorInstanceId;
  const cwd = parseOptionalStringField(value, "cwd");
  if (!cwd.ok) return cwd;
  const projectsDir = parseOptionalStringField(value, "projectsDir");
  if (!projectsDir.ok) return projectsDir;
  const maxBytes = parseOptionalPositiveIntegerField(value, "maxBytes", 64 * 1024 * 1024);
  if (!maxBytes.ok) return maxBytes;
  const eventLimit = parseOptionalPositiveIntegerField(value, "eventLimit", 10_000);
  if (!eventLimit.ok) return eventLimit;
  const listLimit = parseOptionalPositiveIntegerField(value, "listLimit", 5_000);
  if (!listLimit.ok) return listLimit;
  return {
    ok: true,
    value: {
      sessionId: sessionId.value,
      listLimit: listLimit.value ?? 1_000,
      ...(deviceId.value ? { deviceId: deviceId.value } : {}),
      ...(behaviorInstanceId.value ? { behaviorInstanceId: behaviorInstanceId.value } : {}),
      ...(cwd.value ? { cwd: cwd.value } : {}),
      ...(projectsDir.value ? { projectsDir: projectsDir.value } : {}),
      ...(maxBytes.value !== undefined ? { maxBytes: maxBytes.value } : {}),
      ...(eventLimit.value !== undefined ? { eventLimit: eventLimit.value } : {}),
    },
  };
}

function parseRequiredStringField(
  record: Record<string, unknown>,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = record[field];
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: `${field} is required` };
  }
  return { ok: true, value: raw.trim() };
}

function parseOptionalStringField(
  record: Record<string, unknown>,
  field: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  const raw = record[field];
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = raw.trim();
  return trimmed ? { ok: true, value: trimmed } : { ok: true };
}

function parseOptionalPositiveIntegerField(
  record: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value?: number } | { ok: false; error: string } {
  const raw = record[field];
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: `${field} must be a positive integer` };
  }
  return { ok: true, value: Math.max(1, Math.min(max, Math.floor(n))) };
}

async function readManagerSessionTranscript(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  registry: DeviceRegistry,
  localToken: string | undefined,
  request: ManagerSessionReadRequest,
): Promise<
  | {
      ok: true;
      value: {
        device: { id: string; label: string; daemonUrl: string };
        behavior: ManagerBehaviorDescriptor;
        resolvedCwd: string;
        session?: ManagerSessionCandidate;
        transcript: unknown;
        attempts: ManagerSessionReadAttempt[];
      };
    }
  | { ok: false; status: number; error: string; attempts: ManagerSessionReadAttempt[] }
> {
  const attempts: ManagerSessionReadAttempt[] = [];
  const devices = request.deviceId ? [registry.get(request.deviceId)].filter(Boolean) : registry.list();
  if (request.deviceId && devices.length === 0) {
    return { ok: false, status: 404, error: `unknown device: ${request.deviceId}`, attempts };
  }
  if (devices.length === 0) {
    return { ok: false, status: 404, error: "no registered devices", attempts };
  }

  for (const device of devices as Device[]) {
    try {
      const behaviors = await readDeviceBehaviors(fetchImpl, device, daemonToken(device, localToken));
      const behavior = selectClaudeBehavior(behaviors, request.behaviorInstanceId);
      if (!behavior) {
        throw new ManagerSessionReadError(
          "behaviors",
          404,
          request.behaviorInstanceId
            ? `behavior not found: ${request.behaviorInstanceId}`
            : "remote-claude behavior is not loaded",
        );
      }

      let resolvedCwd = request.cwd;
      let session: ManagerSessionCandidate | undefined;
      if (!resolvedCwd) {
        const sessions = await listDeviceSessions(fetchImpl, device, behavior, localToken, request);
        session = selectSessionCandidate(sessions, request.sessionId);
        if (!session) {
          throw new ManagerSessionReadError(
            "sessions.list",
            404,
            `session not found in listed sessions: ${request.sessionId}`,
          );
        }
        resolvedCwd = session.cwd;
      }

      const transcript = await callDeviceBehavior(fetchImpl, device, behavior, localToken, {
        method: "sessions.read",
        params: buildSessionReadParams(request, resolvedCwd),
      });
      return {
        ok: true,
        value: {
          device: publicManagerDevice(device),
          behavior,
          resolvedCwd,
          ...(session ? { session } : {}),
          transcript,
          attempts,
        },
      };
    } catch (error) {
      attempts.push(managerSessionReadAttempt(device, error));
      if (request.deviceId) break;
    }
  }

  return {
    ok: false,
    status: managerSessionReadFailureStatus(attempts),
    error: `session transcript not found: ${request.sessionId}`,
    attempts,
  };
}

function publicManagerDevice(device: Device): { id: string; label: string; daemonUrl: string } {
  return { id: device.id, label: device.label, daemonUrl: device.daemonUrl };
}

async function readDeviceBehaviors(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
): Promise<ManagerBehaviorDescriptor[]> {
  const payload = await fetchDeviceJson(fetchImpl, device, `${device.daemonUrl}/behaviors`, {
    method: "GET",
    stage: "behaviors",
    ...(token ? { token } : {}),
  });
  return normalizeBehaviorDescriptors(payload);
}

async function listDeviceSessions(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  behavior: ManagerBehaviorDescriptor,
  localToken: string | undefined,
  request: ManagerSessionReadRequest,
): Promise<ManagerSessionCandidate[]> {
  const payload = await callDeviceBehavior(fetchImpl, device, behavior, localToken, {
    method: "sessions.list",
    params: {
      limit: request.listLimit,
      dedupeSessionIds: false,
      ...(request.projectsDir ? { projectsDir: request.projectsDir } : {}),
    },
  });
  return normalizeSessionCandidates(payload);
}

function buildSessionReadParams(request: ManagerSessionReadRequest, cwd: string): Record<string, unknown> {
  return {
    cwd,
    sessionId: request.sessionId,
    ...(request.projectsDir ? { projectsDir: request.projectsDir } : {}),
    ...(request.maxBytes !== undefined ? { maxBytes: request.maxBytes } : {}),
    ...(request.eventLimit !== undefined ? { eventLimit: request.eventLimit } : {}),
  };
}

async function callDeviceBehavior(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  behavior: ManagerBehaviorDescriptor,
  localToken: string | undefined,
  input: { method: string; params?: unknown },
): Promise<unknown> {
  const token = daemonToken(device, localToken);
  const payload = await fetchDeviceJson(
    fetchImpl,
    device,
    `${device.daemonUrl}/behaviors/${encodeURIComponent(behavior.instanceId)}/request`,
    {
      method: "POST",
      stage: input.method,
      body: JSON.stringify(input.params !== undefined ? input : { method: input.method }),
      ...(token ? { token } : {}),
    },
  );
  if (isRecord(payload) && isRecord(payload.error)) {
    throw new ManagerSessionReadError(
      input.method,
      behaviorErrorStatus(payload.error),
      payloadErrorMessage(payload) ?? `behavior method failed: ${input.method}`,
    );
  }
  return isRecord(payload) && "result" in payload ? payload.result : payload;
}

async function fetchDeviceJson(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  url: string,
  input: { method: string; token?: string; stage: string; body?: string },
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (input.body !== undefined) headers["content-type"] = "application/json";
  if (input.token) headers.authorization = `Bearer ${input.token}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: input.method,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  } catch (error) {
    throw new ManagerSessionReadError(
      input.stage,
      502,
      `cannot reach daemon ${device.label}: ${errorMessage(error)}`,
    );
  }
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new ManagerSessionReadError(
      input.stage,
      response.status,
      payloadErrorMessage(payload) ?? `daemon returned HTTP ${response.status}`,
    );
  }
  return payload;
}

function normalizeBehaviorDescriptors(value: unknown): ManagerBehaviorDescriptor[] {
  if (!Array.isArray(value)) return [];
  const result: ManagerBehaviorDescriptor[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.instanceId !== "string" || !item.instanceId.trim()) {
      continue;
    }
    result.push({
      instanceId: item.instanceId,
      ...(typeof item.name === "string" ? { name: item.name } : {}),
      ...(typeof item.packageName === "string" ? { packageName: item.packageName } : {}),
      ...(typeof item.version === "string" ? { version: item.version } : {}),
      ...(typeof item.loadedAt === "string" ? { loadedAt: item.loadedAt } : {}),
    });
  }
  return result;
}

function selectClaudeBehavior(
  behaviors: ManagerBehaviorDescriptor[],
  preferredInstanceId: string | undefined,
): ManagerBehaviorDescriptor | undefined {
  if (preferredInstanceId) {
    return behaviors.find((behavior) => behavior.instanceId === preferredInstanceId);
  }
  return (
    behaviors.find((behavior) => behavior.instanceId === "remote-claude") ??
    behaviors.find((behavior) => behavior.name === "remote-claude") ??
    behaviors.find((behavior) => behavior.packageName === "remote-claude")
  );
}

function normalizeSessionCandidates(value: unknown): ManagerSessionCandidate[] {
  if (!Array.isArray(value)) return [];
  const result: ManagerSessionCandidate[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.sessionId !== "string" ||
      !item.sessionId.trim() ||
      typeof item.cwd !== "string" ||
      !item.cwd.trim()
    ) {
      continue;
    }
    result.push({
      sessionId: item.sessionId,
      cwd: item.cwd,
      ...(typeof item.title === "string" ? { title: item.title } : {}),
      ...(typeof item.fullTitle === "string" ? { fullTitle: item.fullTitle } : {}),
      ...(typeof item.modifiedAt === "string" ? { modifiedAt: item.modifiedAt } : {}),
      ...(typeof item.fileSize === "number" ? { fileSize: item.fileSize } : {}),
    });
  }
  return result;
}

function selectSessionCandidate(
  sessions: ManagerSessionCandidate[],
  sessionId: string,
): ManagerSessionCandidate | undefined {
  return sessions
    .filter((session) => session.sessionId === sessionId)
    .sort((left, right) => Date.parse(right.modifiedAt ?? "") - Date.parse(left.modifiedAt ?? ""))[0];
}

function managerSessionReadAttempt(device: Device, error: unknown): ManagerSessionReadAttempt {
  if (error instanceof ManagerSessionReadError) {
    return {
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      stage: error.stage,
      error: error.message,
      ...(error.status ? { status: error.status } : {}),
    };
  }
  return {
    deviceId: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    stage: "unknown",
    error: errorMessage(error),
  };
}

function managerSessionReadFailureStatus(attempts: ManagerSessionReadAttempt[]): number {
  if (attempts.some((attempt) => (attempt.status ?? 0) >= 500)) {
    return 502;
  }
  return 404;
}

function behaviorErrorStatus(error: Record<string, unknown>): number {
  if (typeof error.code === "number" && error.code >= 400 && error.code < 600) {
    return error.code;
  }
  const message = typeof error.message === "string" ? error.message : "";
  return /enoent|not found|missing/i.test(message) ? 404 : 502;
}

function payloadErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return typeof payload === "string" && payload.trim() ? payload : undefined;
  }
  if (typeof payload.error === "string") return payload.error;
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  if (typeof payload.message === "string") return payload.message;
  return undefined;
}

function stateFromDeviceUpdateResponse(status: number, payload: unknown): ManagerTaskState {
  if (isRecord(payload)) {
    if (payload.state === "pending_until_device_online" || payload.state === "queued") {
      return "waiting_for_device";
    }
    if (payload.state === "running") return "running";
    if (payload.state === "restart_required") return "restart_required";
    if (payload.state === "failed" || typeof payload.error === "string") return "failed";
    if (payload.ok === true || payload.state === "succeeded") return "succeeded";
  }
  if (status >= 500) return "failed";
  if (status === 202) return "waiting_for_device";
  if (status >= 400) return "failed";
  return "succeeded";
}

function updateSummaryFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.warning === "string") return payload.warning;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.state === "string") return `Device update state: ${payload.state}.`;
  if (payload.ok === true) return "Device update request completed.";
  return undefined;
}

function classifyRegistrationFailure(step: ManagerTask["steps"][number] | undefined): string {
  const text = `${step?.id ?? ""} ${step?.summary ?? ""} ${step?.detail ?? ""}`.toLowerCase();
  if (!step) return "unknown";
  if (text.includes("site token") || text.includes("401") || text.includes("unauthorized")) {
    return "site-token-rejected";
  }
  if (text.includes("firewall") || text.includes("timed out") || text.includes("timeout")) {
    return "firewall-or-route-timeout";
  }
  if (text.includes("tailscale")) return "tailscale-unavailable";
  if (text.includes("stale") || text.includes("different daemon token")) {
    return "stale-connector-token";
  }
  if (text.includes("localhost") || text.includes("127.0.0.1")) return "localhost-registration";
  if (text.includes("git") || text.includes("bun")) return "installer-dependency";
  return step.id || "unknown";
}

function actionFromRegistrationFailure(
  step: ManagerTask["steps"][number] | undefined,
  classification: string,
): string | undefined {
  if (typeof step?.action === "string") return step.action;
  if (typeof step?.action === "object" && step.action.detail) return step.action.detail;
  if (classification === "site-token-rejected") {
    return "Copy the current Site token from the server page and rerun the registration command.";
  }
  if (classification === "firewall-or-route-timeout") {
    return "Allow the connector port through Windows Firewall or use Tailscale, then rerun registration.";
  }
  if (classification === "stale-connector-token") {
    return "Stop the stale connector process or rerun PowerShell as Administrator, then rerun registration.";
  }
  return undefined;
}

function isRetrySafeRegistrationClassification(classification: string): boolean {
  return (
    classification === "site-token-rejected" ||
    classification === "firewall-or-route-timeout" ||
    classification === "tailscale-unavailable" ||
    classification === "stale-connector-token" ||
    classification === "localhost-registration"
  );
}

function buildSelfNetworkStatus(urls: AccessUrl[]): ManagerNetworkStatus {
  const generatedAt = new Date().toISOString();
  const preferredUrl = pickRemoteAccessUrl(urls);
  const port = getUrlPort(preferredUrl);
  const addresses = collectServerNetworkAddresses(port);
  const tailscaleAddresses = addresses.filter((address) => address.kind === "tailscale");
  const remoteUrls = urls.filter((row) => row.kind !== "This PC");
  const summary =
    remoteUrls.length === 0
      ? {
          severity: "warn" as const,
          message: "Only local server access is available.",
        }
      : {
          severity: "ok" as const,
          message: `Preferred server URL is ${preferredUrl}.`,
        };
  return {
    scope: "server",
    generatedAt,
    preferredUrl,
    tailscale: {
      detected: tailscaleAddresses.length > 0,
      addresses: tailscaleAddresses.map((address) => address.address),
      interfaceNames: [
        ...new Set(
          tailscaleAddresses
            .map((address) => address.interfaceName)
            .filter((name): name is string => Boolean(name)),
        ),
      ],
    },
    addresses,
    probes: urls.map((row) => ({
      id: `server.url.${row.kind.toLowerCase().replace(/\s+/g, "-")}`,
      label: row.kind,
      url: row.url,
      ok: true,
      hint:
        row.kind === "This PC"
          ? "Only this PC can use this URL."
          : "Use this URL from another PC on the same LAN or Tailscale network.",
    })),
    summary,
  };
}

async function buildSelfInstallStatus(
  options: SiteAppOptions,
  build: DeskRelayBuildInfo,
): Promise<ManagerInstallStatus> {
  const generatedAt = new Date().toISOString();
  const processStatus = options.selfServerProcess
    ? await options.selfServerProcess.status().catch(() => defaultSelfProcessStatus(build))
    : defaultSelfProcessStatus(build);
  const autostart = await readSelfServerAutostartStatus(options.selfServerAutostart);
  const update = options.selfServerUpdater
    ? await options.selfServerUpdater.status().catch((err) => ({
        state: "failed",
        error: (err as Error).message,
      }))
    : undefined;
  const reports = options.installReportStore
    ? await options.installReportStore.list(3).catch(() => [])
    : [];
  const updateSummary = update ? normalizeManagerUpdate(update) : undefined;
  const warn = autostart.supported && !autostart.installed;
  return {
    scope: "server",
    generatedAt,
    build,
    installed: true,
    running: processStatus.pid > 0,
    autostart,
    ...(updateSummary ? { update: updateSummary } : {}),
    ...(reports.length > 0
      ? {
          reports: reports.map((report) => ({
            id: report.id,
            receivedAt: report.receivedAt,
            status: report.status,
            ...(report.label ? { label: report.label } : {}),
          })),
        }
      : {}),
    summary: {
      severity: warn ? "warn" : "ok",
      message: warn
        ? "Server is running, but login autostart is not installed."
        : "Server is installed and running.",
    },
  };
}

function buildSelfSecurityBoundary(
  options: SiteAppOptions,
  urls: AccessUrl[],
): ManagerSecurityBoundary {
  const generatedAt = new Date().toISOString();
  const preferredUrl = pickRemoteAccessUrl(urls);
  const networkKind = daemonNetworkKind(preferredUrl);
  const warnings: string[] = [];
  if (!options.token) warnings.push("Site token is not configured.");
  if (networkKind === "public") warnings.push("Server URL appears to be public.");
  return {
    scope: "server",
    generatedAt,
    tokenBoundary: {
      siteTokenConfigured: Boolean(options.token),
      daemonTokenAvailable: Boolean(options.localDaemonToken),
      browserReceivesDaemonToken: false,
    },
    networkBoundary: {
      url: preferredUrl,
      kind: networkKind,
      publicExposure: networkKind === "public",
    },
    warnings,
    summary: {
      severity: warnings.length > 0 ? "warn" : "ok",
      message:
        warnings.length > 0
          ? `${warnings.length} security boundary warning(s).`
          : "Server security boundary is constrained.",
    },
  };
}

async function buildDeviceNetworkStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  authToken?: string,
): Promise<ManagerNetworkStatus> {
  const generatedAt = new Date().toISOString();
  const started = Date.now();
  const result = await fetchManagerJson<ManagerNetworkStatus>(
    fetchImpl,
    `${device.daemonUrl}/network/status`,
    authToken,
  );
  if (!result.ok) {
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      generatedAt,
      registeredUrl: device.daemonUrl,
      tailscale: { detected: false, addresses: [], interfaceNames: [] },
      addresses: [],
      probes: [
        {
          id: "device.network-status",
          label: "Device network status",
          url: `${device.daemonUrl}/network/status`,
          ok: false,
          error: result.error,
          hint: classifyReachabilityHint(device.daemonUrl),
        },
      ],
      summary: {
        severity: "error",
        message: `Cannot read network status from ${device.label}.`,
      },
    };
  }
  return {
    ...result.value,
    targetId: device.id,
    targetLabel: device.label,
    registeredUrl: device.daemonUrl,
    probes: [
      ...result.value.probes,
      {
        id: "server-to-device.network-status",
        label: "Server to connector API",
        url: `${device.daemonUrl}/network/status`,
        ok: true,
        status: 200,
        latencyMs: Date.now() - started,
      },
    ],
  };
}

async function buildDeviceInstallStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  authToken: string | undefined,
  queue: DeviceUpdateQueueStore | undefined,
): Promise<ManagerInstallStatus> {
  const generatedAt = new Date().toISOString();
  const [result, queueEntry] = await Promise.all([
    fetchManagerJson<ManagerInstallStatus>(
      fetchImpl,
      `${device.daemonUrl}/install/status`,
      authToken,
    ),
    queue?.get(device.id).catch(() => undefined),
  ]);
  if (!result.ok) {
    const legacyStatus = await fetchManagerJson<DaemonStatusPayload>(
      fetchImpl,
      `${device.daemonUrl}/status`,
      authToken,
    );
    if (legacyStatus.ok) {
      return {
        scope: "device",
        targetId: device.id,
        targetLabel: device.label,
        generatedAt,
        build: legacyStatus.value.build ?? getDeskRelayBuildInfo(),
        installed: true,
        running: true,
        ...(queueEntry
          ? {
              queue: {
                state: queueEntry.state,
                updatedAt: queueEntry.updatedAt,
                ...(queueEntry.error ? { error: queueEntry.error } : {}),
              },
            }
          : {}),
        summary: {
          severity: "warn",
          message:
            "Connector is running, but its install status API is unavailable. Update the connector if this device looks stale.",
        },
      };
    }
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      generatedAt,
      build: getDeskRelayBuildInfo(),
      installed: false,
      running: false,
      ...(queueEntry
        ? {
            queue: {
              state: queueEntry.state,
              updatedAt: queueEntry.updatedAt,
              ...(queueEntry.error ? { error: queueEntry.error } : {}),
            },
          }
        : {}),
      summary: {
        severity: "error",
        message: `Cannot read install status from ${device.label}: ${result.error}`,
      },
    };
  }
  return {
    ...result.value,
    targetId: device.id,
    targetLabel: device.label,
    ...(queueEntry
      ? {
          queue: {
            state: queueEntry.state,
            updatedAt: queueEntry.updatedAt,
            ...(queueEntry.error ? { error: queueEntry.error } : {}),
          },
        }
      : {}),
  };
}

async function buildDeviceSecurityBoundary(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  authToken?: string,
): Promise<ManagerSecurityBoundary> {
  const generatedAt = new Date().toISOString();
  const result = await fetchManagerJson<ManagerSecurityBoundary>(
    fetchImpl,
    `${device.daemonUrl}/security/boundary`,
    authToken,
  );
  const registeredKind = daemonNetworkKind(device.daemonUrl);
  if (!result.ok) {
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      generatedAt,
      tokenBoundary: {
        daemonTokenAvailable: Boolean(authToken),
        browserReceivesDaemonToken: false,
      },
      networkBoundary: {
        url: device.daemonUrl,
        kind: registeredKind,
        publicExposure: registeredKind === "public",
      },
      warnings: [result.error],
      summary: {
        severity: "error",
        message: `Cannot read security boundary from ${device.label}.`,
      },
    };
  }
  const warnings = [...result.value.warnings];
  if (registeredKind === "public" && !warnings.some((item) => item.includes("public"))) {
    warnings.push("Registered connector URL appears to be public.");
  }
  return {
    ...result.value,
    targetId: device.id,
    targetLabel: device.label,
    tokenBoundary: {
      ...result.value.tokenBoundary,
      daemonTokenAvailable: Boolean(authToken),
      browserReceivesDaemonToken: false,
    },
    networkBoundary: {
      ...result.value.networkBoundary,
      url: device.daemonUrl,
      kind: registeredKind,
      publicExposure: registeredKind === "public",
    },
    warnings,
    summary: {
      severity: warnings.length > 0 ? "warn" : result.value.summary.severity,
      message:
        warnings.length > 0
          ? `${warnings.length} security boundary warning(s).`
          : result.value.summary.message,
    },
  };
}

function normalizeSelfLogSource(value: string | undefined): string | undefined {
  const raw = (value ?? "server").trim().toLowerCase();
  if (raw === "server" || raw === "site-backend" || raw === "backend") return "site-backend";
  if (raw === "frontend" || raw === "site-frontend") return "site-frontend";
  if (raw === "daemon" || raw === "connector") return "daemon";
  return undefined;
}

function selfLogPath(options: SiteAppOptions, source: string): string {
  const logDir =
    options.logDir ?? process.env.CR_DEV_LOG_DIR ?? join(process.cwd(), ".self-server", "logs");
  if (source === "site-frontend") return join(logDir, "site-frontend.log");
  if (source === "daemon") return join(logDir, "daemon.log");
  return join(logDir, "site-backend.log");
}

function clampTail(value: string | undefined): number {
  const n = Number(value ?? "200");
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

function normalizeLogLevel(value: string | undefined): string | undefined {
  const level = (value ?? "").trim().toLowerCase();
  return level ? level : undefined;
}

function parseQueryBoolean(value: string | undefined): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveServerUpdateBranch(options: SiteAppOptions): string | undefined {
  const explicit = normalizeOptionalUpdateBranch(
    options.updateBranch ?? process.env.DESKRELAY_UPDATE_BRANCH,
  );
  if (explicit) return explicit;
  return normalizeOptionalUpdateBranch(readCurrentServerGitBranch());
}

function readCurrentServerGitBranch(): string | undefined {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    if (branch) return branch;
  } catch {
    // Branch forwarding is best-effort; connector can fall back to its current branch.
  }
  return undefined;
}

function normalizeOptionalUpdateBranch(value: string | undefined): string | undefined {
  const branch = String(value ?? "").trim();
  if (
    !branch ||
    branch.length > 200 ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    return undefined;
  }
  return branch;
}

async function readLogResponse(input: {
  scope: "server";
  source: string;
  path: string;
  tail: number;
  level?: string;
}): Promise<ManagerLogResponse> {
  const readAt = new Date().toISOString();
  try {
    await stat(input.path);
    const raw = await readFile(input.path, "utf8");
    const allLines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const nonEmptyLines = allLines.at(-1) === "" ? allLines.slice(0, -1) : allLines;
    const filtered = input.level
      ? nonEmptyLines.filter((line) => logLineMatchesLevel(line, input.level ?? ""))
      : nonEmptyLines;
    const lines = filtered.slice(-input.tail);
    return {
      scope: input.scope,
      source: input.source,
      path: input.path,
      exists: true,
      tail: input.tail,
      lines,
      truncated: filtered.length > lines.length,
      readAt,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      scope: input.scope,
      source: input.source,
      path: input.path,
      exists: false,
      tail: input.tail,
      lines: [],
      truncated: false,
      readAt,
      error: code === "ENOENT" ? "log file not found" : (err as Error).message,
    };
  }
}

function logLineMatchesLevel(line: string, level: string): boolean {
  try {
    const parsed = JSON.parse(line) as { level?: unknown };
    return typeof parsed.level === "string" && parsed.level.toLowerCase() === level;
  } catch {
    return line.toLowerCase().includes(level);
  }
}

function resolveDevice(id: string, registry: DeviceRegistry): Device | undefined {
  return registry.get(id);
}

function daemonToken(device: Device, fallback?: string): string | undefined {
  return device.authToken ?? fallback;
}

interface DeviceCleanupResult {
  attempted: boolean;
  ok: boolean;
  status?: number;
  error?: string;
}

interface DeviceCleanupEntry {
  id: string;
  label: string;
  daemonUrl: string;
  cleanup: DeviceCleanupResult;
}

async function unregisterDeviceWithCleanup(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  registry: DeviceRegistry,
  device: Device,
  localToken?: string,
): Promise<DeviceCleanupEntry> {
  const cleanup = await requestDaemonUninstall(fetchImpl, device, daemonToken(device, localToken));
  registry.unregister(device.id);
  return {
    id: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    cleanup,
  };
}

async function requestDaemonUninstall(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token?: string,
): Promise<DeviceCleanupResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetchImpl(`${device.daemonUrl}/system/uninstall`, {
      method: "POST",
      headers,
      body: JSON.stringify({ removeRepo: true }),
      signal: AbortSignal.timeout(CONNECTOR_CLEANUP_TIMEOUT_MS),
    });
    if (res.ok) return { attempted: true, ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    return {
      attempted: true,
      ok: false,
      status: res.status,
      ...(text ? { error: text.slice(0, 500) } : {}),
    };
  } catch (err) {
    return { attempted: true, ok: false, error: (err as Error).message };
  }
}

function enrichDeviceUpdateQueueEntry(
  entry: StoredDeviceUpdateEntry,
  fallbackCommand: string,
): StoredDeviceUpdateEntry {
  if (!fallbackCommand || entry.fallbackCommand || !requiresRegistrationRecovery(entry)) {
    return entry;
  }
  return { ...entry, fallbackCommand };
}

function requiresRegistrationRecovery(entry: StoredDeviceUpdateEntry): boolean {
  if (entry.recoveryKind === "branch_mismatch" || entry.recoveryKind === "registration_required") {
    return true;
  }
  const error = entry.error?.toLowerCase() ?? "";
  return (
    error.includes("re-run the registration command") ||
    error.includes("registration command") ||
    error.includes("branch switch required")
  );
}

async function requestDaemonSystemUpdate(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
  fallbackCommand: string,
  queue?: DeviceUpdateQueueStore,
  branch?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const now = new Date().toISOString();
  const existing = await queue?.get(device.id);
  const requestedAt =
    existing?.state === "pending_until_device_online" ? existing.requestedAt : now;
  await queue?.upsert({
    deviceId: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    state: "running",
    requestedAt,
    startedAt: now,
  });
  let res: Response;
  try {
    res = await fetchImpl(`${device.daemonUrl}/system/update`, {
      method: "POST",
      headers,
      body: JSON.stringify(branch ? { branch } : {}),
    });
  } catch (err) {
    const error = `cannot reach daemon: ${(err as Error).message}`;
    await queue?.upsert({
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      state: "pending_until_device_online",
      requestedAt,
      error,
      fallbackCommand,
    });
    return Response.json(
      {
        ok: true,
        state: "pending_until_device_online",
        warning: "connector is offline. Update will run automatically when this device is online.",
        error,
        fallbackCommand,
      },
      { status: 202 },
    );
  }

  const text = await res.text();
  const payload = parseJsonPayload(text);
  if (!res.ok) {
    const unavailable = res.status === 404 || res.status === 405 || res.status === 501;
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `daemon update failed with HTTP ${res.status}`;
    const finalError = unavailable
      ? "connector update API is unavailable on this device. Re-run the registration command."
      : error;
    await queue?.upsert({
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      state: "failed",
      requestedAt,
      completedAt: new Date().toISOString(),
      error: finalError,
      ...(unavailable ? { recoveryKind: "registration_required" as const, retryable: false } : {}),
      daemonStatus: res.status,
      fallbackCommand,
    });
    return Response.json(
      {
        ok: false,
        state: "failed",
        error: finalError,
        daemonStatus: res.status,
        ...(unavailable
          ? { recoveryKind: "registration_required" as const, retryable: false }
          : {}),
        fallbackCommand,
      },
      { status: unavailable ? 424 : res.status },
    );
  }

  const rawResponsePayload = isRecord(payload) ? payload : { ok: true };
  const actualBranch =
    typeof rawResponsePayload.branch === "string" ? rawResponsePayload.branch : undefined;
  const branchMismatch = Boolean(branch && actualBranch && actualBranch !== branch);
  const branchMismatchError =
    branchMismatch && branch
      ? `connector branch switch required: this legacy connector updated ${actualBranch} instead of ${branch}. Run the registration command shown below on that PC.`
      : undefined;
  const responsePayload = branchMismatch
    ? {
        ...rawResponsePayload,
        ok: false,
        state: "failed",
        expectedBranch: branch,
        actualBranch,
        recoveryKind: "branch_mismatch",
        retryable: false,
        error: branchMismatchError,
        fallbackCommand,
      }
    : rawResponsePayload;
  const finalState =
    normalizeUpdateState(responsePayload.state) ??
    (typeof responsePayload.restartRequestError === "string" ? "restart_required" : "succeeded");
  await queue?.upsert({
    deviceId: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    state: finalState,
    requestedAt,
    completedAt: new Date().toISOString(),
    ...(typeof responsePayload.error === "string" ? { error: responsePayload.error } : {}),
    ...(typeof responsePayload.warning === "string" ? { warning: responsePayload.warning } : {}),
    ...(responsePayload.recoveryKind === "branch_mismatch" ||
    responsePayload.recoveryKind === "registration_required"
      ? { recoveryKind: responsePayload.recoveryKind }
      : {}),
    ...(typeof responsePayload.retryable === "boolean"
      ? { retryable: responsePayload.retryable }
      : {}),
    ...(typeof responsePayload.expectedBranch === "string"
      ? { expectedBranch: responsePayload.expectedBranch }
      : {}),
    ...(typeof responsePayload.actualBranch === "string"
      ? { actualBranch: responsePayload.actualBranch }
      : {}),
    ...(isRecord(responsePayload.before)
      ? { before: responsePayload.before as Partial<DeskRelayBuildInfo> }
      : {}),
    ...(isRecord(responsePayload.after)
      ? { after: responsePayload.after as Partial<DeskRelayBuildInfo> }
      : {}),
    ...(typeof responsePayload.changed === "boolean" ? { changed: responsePayload.changed } : {}),
    ...(typeof responsePayload.restartScheduled === "boolean"
      ? { restartScheduled: responsePayload.restartScheduled }
      : {}),
    ...(typeof responsePayload.restartRequested === "boolean"
      ? { restartRequested: responsePayload.restartRequested }
      : {}),
    ...(typeof responsePayload.restartRequestError === "string"
      ? { restartRequestError: responsePayload.restartRequestError }
      : {}),
  });

  return Response.json(responsePayload, { status: branchMismatch ? 409 : 200 });
}

async function retryQueuedDeviceSystemUpdate(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
  fallbackCommand: string,
  queue: DeviceUpdateQueueStore,
  branch?: string,
): Promise<void> {
  const entry = await queue.get(device.id);
  if (entry?.state !== "pending_until_device_online") return;
  await requestDaemonSystemUpdate(fetchImpl, device, token, fallbackCommand, queue, branch);
}

function buildFallbackRegisterCommandForRequest(
  options: SiteAppOptions,
  requestUrl: string,
): string {
  if (!options.token) return "";
  const urls = getAccessUrls(options.selfHostUrl ?? requestUrl);
  const preferredUrl = pickRemoteAccessUrl(urls);
  return buildRegisterOtherPcCommand({
    siteUrl: preferredUrl,
    siteToken: options.token,
    branch: resolveServerUpdateBranch(options),
  });
}

function normalizeUpdateState(value: unknown): UpdateState | undefined {
  if (
    value === "not_started" ||
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "restart_required" ||
    value === "pending_until_device_online"
  ) {
    return value;
  }
  return undefined;
}

function parseJsonPayload(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function orderDevicesForRemoval(devices: Device[]): Device[] {
  return [...devices].sort((left, right) => {
    return Number(isServerDevice(left)) - Number(isServerDevice(right));
  });
}

function isServerDevice(device: Device): boolean {
  const label = device.label.toLowerCase();
  if (label.startsWith("local dev")) return true;
  try {
    const url = new URL(device.daemonUrl);
    const port = url.port ? Number(url.port) : null;
    return port === 18191;
  } catch {
    return false;
  }
}

async function prepareBehaviorRequestBodyForProxy(
  body: string,
  input: { device: Device; options: SiteAppOptions; requestUrl: string },
): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
  if (!body.trim()) return { ok: true, body };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: true, body };
  }
  if (!isRecord(parsed) || parsed.method !== "chat" || !isRecord(parsed.params)) {
    return { ok: true, body };
  }
  if (parsed.params.managerMode !== true) return { ok: true, body };
  if (!isServerDevice(input.device)) {
    return {
      ok: false,
      status: 400,
      error: "manager assistant chat must run on the server PC connector",
    };
  }
  const repoRoot = input.options.managerAssistant?.cwd ?? process.cwd();
  const apiBaseUrl = managerAssistantApiBaseUrl(input.options, input.requestUrl);
  const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
  const params = {
    ...parsed.params,
    cwd: workspace.cwd,
    managerMode: true,
    managerApiBaseUrl: apiBaseUrl,
    managerRepoRoot: repoRoot,
    managerInstructionsPath: workspace.instructionsPath,
    managerSiteToken: input.options.token ?? "",
    permissionMode: "bypassPermissions",
    securityProfile: "relaxed",
    conversationId:
      typeof parsed.params.conversationId === "string" && parsed.params.conversationId.trim()
        ? parsed.params.conversationId
        : "deskrelay-manager-assistant",
  };
  return { ok: true, body: JSON.stringify({ ...parsed, params }) };
}

function toPublicDevice(
  device: Device,
): Omit<Device, "authToken" | "deviceKey"> & { connectionState: "online" } {
  return {
    id: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    registeredAt: device.registeredAt,
    connectionState: "online" as const,
  };
}

type AccessUrl = {
  kind: "This PC" | "Current URL" | "Tailscale" | "LAN";
  url: string;
};

function getAccessUrls(baseUrl: string): AccessUrl[] {
  const base = new URL(baseUrl);
  const port = explicitPort(base);
  const rows: AccessUrl[] = [{ kind: "This PC", url: `http://127.0.0.1:${port}` }];
  const currentHost = base.hostname.replace(/^\[|\]$/g, "");
  if (!isLocalHost(currentHost) && currentHost !== "0.0.0.0") {
    rows.push({ kind: classifyRemoteHost(currentHost), url: base.origin });
  }
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4") continue;
      if (entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      const kind = entry.address.startsWith("100.") ? "Tailscale" : "LAN";
      rows.push({ kind, url: `http://${entry.address}:${port}` });
    }
  }
  return dedupeUrls(rows);
}

function explicitPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function classifyRemoteHost(host: string): AccessUrl["kind"] {
  if (host.startsWith("100.")) return "Tailscale";
  if (
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return "LAN";
  }
  return "Current URL";
}

function daemonNetworkKind(rawUrl: string): "local" | "tailscale" | "lan" | "public" | "unknown" {
  try {
    const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
    if (isLocalHost(host)) return "local";
    const kind = classifyRemoteHost(host);
    if (kind === "Tailscale") return "tailscale";
    if (kind === "LAN") return "lan";
    return "public";
  } catch {
    return "unknown";
  }
}

function collectServerNetworkAddresses(port: number): ManagerNetworkAddress[] {
  const rows: ManagerNetworkAddress[] = [];
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" && entry.family !== "IPv6") continue;
      if (entry.address.startsWith("169.254.")) continue;
      const kind = classifyNetworkAddress(entry.address);
      rows.push({
        address: entry.address,
        interfaceName,
        family: entry.family,
        kind,
        internal: entry.internal,
        ...(entry.family === "IPv4" ? { url: `http://${entry.address}:${port}` } : {}),
      });
    }
  }
  return rows.sort((left, right) => networkKindRank(left.kind) - networkKindRank(right.kind));
}

function classifyNetworkAddress(address: string): ManagerNetworkKind {
  if (address === "localhost" || address === "127.0.0.1" || address === "::1") return "local";
  if (address.startsWith("100.")) return "tailscale";
  if (
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  ) {
    return "lan";
  }
  return "public";
}

function networkKindRank(kind: ManagerNetworkKind): number {
  const ranks: Record<ManagerNetworkKind, number> = {
    tailscale: 0,
    lan: 1,
    local: 2,
    public: 3,
    unknown: 4,
  };
  return ranks[kind];
}

function normalizeManagerUpdate(value: unknown): ManagerInstallStatus["update"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const state = typeof raw.state === "string" ? raw.state : "unknown";
  return {
    state,
    ...(typeof raw.updateAvailable === "boolean" ? { updateAvailable: raw.updateAvailable } : {}),
    ...(typeof raw.changed === "boolean" ? { changed: raw.changed } : {}),
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
  };
}

async function fetchManagerJson<T>(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  url: string,
  authToken?: string,
): Promise<{ ok: true; value: T } | { ok: false; status: number; error: string }> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: (err as Error).message };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text ? `HTTP ${res.status}: ${text.slice(0, 300)}` : `HTTP ${res.status}`,
    };
  }
  try {
    return { ok: true, value: (await res.json()) as T };
  } catch (err) {
    return { ok: false, status: 502, error: `non-JSON response: ${(err as Error).message}` };
  }
}

function classifyReachabilityHint(daemonUrl: string): string {
  const kind = daemonNetworkKind(daemonUrl);
  if (kind === "tailscale") {
    return "Check that Tailscale is running on both PCs and Windows Firewall allows the connector port.";
  }
  if (kind === "lan") {
    return "Check that both PCs are on the same LAN/VPN and Windows Firewall allows the connector port.";
  }
  if (kind === "local") {
    return "Localhost connector URLs only work from the same PC as the server.";
  }
  if (kind === "public") {
    return "Avoid public connector exposure; prefer Tailscale or LAN and check inbound firewall policy.";
  }
  return "Check the connector URL, network route, and inbound firewall policy.";
}

function dedupeUrls(rows: AccessUrl[]): AccessUrl[] {
  const seen = new Set<string>();
  const out: AccessUrl[] = [];
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    out.push(row);
  }
  return out;
}

function pickRemoteAccessUrl(rows: AccessUrl[]): string {
  return (
    rows.find((row) => row.kind === "Tailscale") ??
    rows.find((row) => isTailscaleUrl(row.url)) ??
    rows.find((row) => row.kind === "LAN") ??
    rows.find((row) => row.kind === "Current URL") ??
    rows[0] ?? { kind: "This PC", url: "http://127.0.0.1:18193" }
  ).url;
}

function isTailscaleUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
    return host.startsWith("100.");
  } catch {
    return false;
  }
}

function buildRegisterOtherPcCommand(input: {
  siteUrl: string;
  siteToken: string;
  branch?: string | undefined;
}): string {
  const siteUrl = input.siteUrl.replace(/\/+$/, "");
  const branch = input.branch ?? "main";
  const installerUrl = `https://raw.githubusercontent.com/darkhtk/deskrelay/${branch}/scripts/install-connector.ps1`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "$installer = Join-Path $env:TEMP 'deskrelay-install-connector.ps1'",
    `Invoke-WebRequest -UseBasicParsing -Uri ${quotePs(installerUrl)} -OutFile $installer`,
    "",
    "$workspaceRoots = Join-Path $HOME 'Projects'",
    `powershell -ExecutionPolicy Bypass -File $installer -Server ${quotePs(siteUrl)} -SiteToken ${quotePs(input.siteToken)} -WorkspaceRoots $workspaceRoots -Label $env:COMPUTERNAME -Port ${DEFAULT_CONNECTOR_PORT} -Branch ${quotePs(branch)}`,
  ].join("\n");
}

function buildRemoveOtherPcCommand(input: { siteUrl: string; siteToken: string }): string {
  const siteUrl = input.siteUrl.replace(/\/+$/, "");
  const serverPort = getUrlPort(siteUrl);
  return [
    "# DeskRelay - remove this PC from a self-host server",
    "# Paste this whole block into PowerShell on the PC you want to remove.",
    "# The remover downloaded from GitHub does the rest: finds this PC's",
    "# Tailscale/LAN daemon URL, unregisters matching server device rows,",
    "# removes the connector login task, clears local connector state, and",
    "# stops any connector still listening on the default port.",
    `# Server URL: ${siteUrl}`,
    `# Server port: ${serverPort}`,
    `# Connector port: ${DEFAULT_CONNECTOR_PORT}`,
    `# Site token: ${input.siteToken}`,
    "",
    "$ErrorActionPreference = 'Stop'",
    "$remover = Join-Path $env:TEMP 'deskrelay-remove-connector.ps1'",
    "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/remove-connector.ps1' -OutFile $remover",
    "",
    `powershell -ExecutionPolicy Bypass -File $remover -Server ${quotePs(siteUrl)} -SiteToken ${quotePs(input.siteToken)} -Port ${DEFAULT_CONNECTOR_PORT}`,
  ].join("\n");
}

function quotePs(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getUrlPort(value: string): number {
  try {
    const url = new URL(value);
    if (url.port) return Number(url.port);
    if (url.protocol === "https:") return 443;
    if (url.protocol === "http:") return 80;
  } catch {
    // The downstream install/remove scripts still validate the URL before use.
  }
  return 0;
}

interface ServerDiagnosticInput {
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  token: string | undefined;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  urls: AccessUrl[];
}

interface DeviceDiagnosticInput {
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  device: Device;
  localToken: string | undefined;
  serverBuild: DeskRelayBuildInfo;
}

interface DaemonStatusPayload {
  ok?: boolean;
  startedAt?: string;
  build?: DeskRelayBuildInfo;
  listening?: { host?: string; port?: number };
  behaviors?: Array<{ name?: string; instanceId?: string; version?: string }>;
  workspaceRoots?: { mode?: string; roots?: string[] };
  diagnostics?: {
    remoteClaudeLoaded?: boolean;
    approvalsHookEnabled?: boolean;
    pendingApprovals?: number;
  };
}

async function buildServerDiagnosticReport(
  input: ServerDiagnosticInput,
): Promise<DiagnosticReport> {
  const generatedAt = new Date().toISOString();
  const checks: DiagnosticCheck[] = [];
  const preferredUrl = pickRemoteAccessUrl(input.urls);
  const remoteUrls = input.urls.filter((row) => row.kind !== "This PC");

  checks.push(
    diagnosticCheck({
      id: "server.api",
      label: "Server API",
      severity: "ok",
      summary: "site backend is responding",
      detail: `version ${input.build.version}`,
      generatedAt,
      userVisible: false,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.token",
      label: "Site token",
      severity: input.token ? "ok" : "error",
      summary: input.token ? "site token is configured" : "site token is missing",
      detail: input.token
        ? "Browsers and connector registration commands can authenticate."
        : "Restart the server with a CR_SITE_TOKEN value.",
      generatedAt,
      userVisible: !input.token,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.security-boundary",
      label: "Security boundary",
      severity: input.token ? "ok" : "error",
      summary: input.token
        ? "site token protects browser and registration APIs"
        : "site token protection is unavailable",
      detail:
        "Connector daemon tokens are stored by the server and are not returned by public device APIs.",
      generatedAt,
      userVisible: !input.token,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.remote-url",
      label: "Remote URL",
      severity:
        remoteUrls.length > 0 && !isLocalHost(new URL(preferredUrl).hostname) ? "ok" : "warn",
      summary:
        remoteUrls.length > 0
          ? `preferred access URL: ${preferredUrl}`
          : "only a local URL is available",
      detail:
        remoteUrls.length > 0
          ? "Use this URL from another PC on the same LAN/VPN."
          : "Install Tailscale or use a LAN address before registering another PC.",
      generatedAt,
      userVisible: remoteUrls.length === 0 || isLocalHost(new URL(preferredUrl).hostname),
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.devices",
      label: "Device registry",
      severity: input.registry.list().length > 0 ? "ok" : "warn",
      summary: `${input.registry.list().length} device(s) registered`,
      detail:
        input.registry.list().length > 0
          ? "Registered devices are available to the browser."
          : "Run the generated registration command on at least one PC.",
      generatedAt,
      userVisible: input.registry.list().length === 0,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.build",
      label: "Git/build",
      severity: input.build.dirty ? "warn" : "ok",
      summary: buildSummary(input.build),
      detail: input.build.dirty
        ? "The server was started from a dirty working tree. Restart after committing or pulling."
        : "The server build metadata is stable.",
      generatedAt,
      userVisible: input.build.dirty,
    }),
  );

  if (!input.localToken) {
    checks.push(
      diagnosticCheck({
        id: "server.local-connector",
        label: "Server PC connector",
        severity: "unknown",
        summary: "local daemon token is not available to the site backend",
        detail: "This is acceptable if this PC is only acting as a server.",
        generatedAt,
        userVisible: false,
      }),
    );
  } else {
    const localUrl = localServerDaemonUrl();
    const status = await fetchDaemonStatus(input.fetchImpl, localUrl, input.localToken);
    checks.push(
      diagnosticCheck({
        id: "server.local-connector",
        label: "Server PC connector",
        severity: status.ok ? "ok" : status.severity,
        summary: status.ok ? `local connector responding at ${localUrl}` : status.summary,
        detail: status.ok
          ? "This server PC can also be used as a controlled device."
          : status.detail,
        generatedAt,
        userVisible: !status.ok,
      }),
    );
  }

  return {
    scope: "server",
    generatedAt,
    checks,
    steps: checks.map((check) => diagnosticStepFromCheck(check, "server")),
  };
}

async function buildDeviceDiagnosticReport(
  input: DeviceDiagnosticInput,
): Promise<DiagnosticReport> {
  const generatedAt = new Date().toISOString();
  const checks: DiagnosticCheck[] = [];
  const devices = input.registry.list();
  const token = daemonToken(input.device, input.localToken);
  const duplicateUrls = devices.filter(
    (candidate) =>
      candidate.id !== input.device.id && candidate.daemonUrl === input.device.daemonUrl,
  );
  const duplicateLabels = devices.filter(
    (candidate) =>
      candidate.id !== input.device.id &&
      candidate.label.trim().toLowerCase() === input.device.label.trim().toLowerCase(),
  );

  checks.push(
    diagnosticCheck({
      id: "device.registry",
      label: "Registry row",
      severity: "ok",
      summary: `${input.device.label} is registered`,
      detail: input.device.daemonUrl,
      generatedAt,
      userVisible: false,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "device.duplicates",
      label: "Duplicate detection",
      severity: duplicateUrls.length > 0 || duplicateLabels.length > 0 ? "warn" : "ok",
      summary:
        duplicateUrls.length > 0 || duplicateLabels.length > 0
          ? "similar device rows exist"
          : "no duplicate URL or label detected",
      detail:
        duplicateUrls.length > 0
          ? `Same daemon URL appears ${duplicateUrls.length + 1} times.`
          : duplicateLabels.length > 0
            ? `Same label appears ${duplicateLabels.length + 1} times.`
            : "Registration dedupe is currently clean.",
      generatedAt,
      userVisible: duplicateUrls.length > 0 || duplicateLabels.length > 0,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "device.token",
      label: "Daemon token",
      severity: token ? "ok" : "error",
      summary: token ? "daemon token is available" : "daemon token is missing",
      detail: token
        ? "The site backend can authenticate to this connector."
        : "Re-register this device so its connector token is saved.",
      generatedAt,
      userVisible: !token,
    }),
  );

  const status = await fetchDaemonStatus(input.fetchImpl, input.device.daemonUrl, token);
  checks.push(
    diagnosticCheck({
      id: "device.daemon",
      label: "Local daemon",
      severity: status.ok ? "ok" : status.severity,
      summary: status.ok ? `responding at ${input.device.daemonUrl}` : status.summary,
      detail: status.ok
        ? status.payload.startedAt
          ? `started ${status.payload.startedAt}`
          : "status endpoint is reachable"
        : status.detail,
      generatedAt,
      userVisible: !status.ok,
    }),
  );

  if (!status.ok) {
    checks.push(
      diagnosticCheck({
        id: "device.claude",
        label: "Claude command bridge",
        severity: "unknown",
        summary: "not checked because daemon status failed",
        generatedAt,
        userVisible: false,
      }),
      diagnosticCheck({
        id: "device.workspace",
        label: "Workspace roots",
        severity: "unknown",
        summary: "not checked because daemon status failed",
        generatedAt,
        userVisible: false,
      }),
      diagnosticCheck({
        id: "device.version",
        label: "Server/connector version",
        severity: "unknown",
        summary: "not checked because daemon status failed",
        generatedAt,
        userVisible: false,
      }),
    );
    return {
      scope: "device",
      targetId: input.device.id,
      targetLabel: input.device.label,
      generatedAt,
      checks,
      steps: checks.map((check) => diagnosticStepFromCheck(check, "server")),
    };
  }

  const payload = status.payload;
  const listenHost = payload.listening?.host;
  const listenPort = payload.listening?.port;
  const registeredNetwork = daemonNetworkKind(input.device.daemonUrl);
  const registeredAsRemote =
    registeredNetwork === "tailscale" ||
    registeredNetwork === "lan" ||
    registeredNetwork === "public";
  const localOnlyListen = listenHost ? isLocalHost(listenHost) : false;
  const listenMismatch = Boolean(registeredAsRemote && localOnlyListen);
  checks.push(
    diagnosticCheck({
      id: "device.listen-bind",
      label: "Connector listen binding",
      severity: listenMismatch ? "error" : listenHost ? "ok" : "unknown",
      summary: listenHost
        ? listenMismatch
          ? `connector is bound to ${listenHost}:${listenPort ?? "?"}`
          : `connector listens on ${listenHost}:${listenPort ?? "?"}`
        : "connector did not report a bind address",
      detail: listenMismatch
        ? `This device is registered as ${input.device.daemonUrl}, but the connector is local-only. Re-register or restart it with listen host 0.0.0.0 so the server can reach it through LAN/Tailscale.`
        : "The reported bind address matches the registered network boundary.",
      generatedAt,
      userVisible: listenMismatch,
    }),
  );

  const remoteClaudeLoaded = payload.diagnostics?.remoteClaudeLoaded;
  checks.push(
    diagnosticCheck({
      id: "device.claude",
      label: "Claude command bridge",
      severity:
        remoteClaudeLoaded === true ? "ok" : remoteClaudeLoaded === false ? "error" : "unknown",
      summary:
        remoteClaudeLoaded === true
          ? "Claude command bridge is ready"
          : remoteClaudeLoaded === false
            ? "Claude command bridge is not ready"
            : "Claude command bridge state is unknown",
      detail:
        remoteClaudeLoaded === false
          ? "Restart or update the connector before starting chat runs."
          : "Connector reports that command execution support is available.",
      generatedAt,
      userVisible: remoteClaudeLoaded === false,
    }),
  );

  const roots = payload.workspaceRoots?.roots ?? [];
  const workspaceMode = payload.workspaceRoots?.mode ?? "unknown";
  checks.push(
    diagnosticCheck({
      id: "device.workspace",
      label: "Workspace roots",
      severity: workspaceMode === "restricted" && roots.length === 0 ? "warn" : "ok",
      summary: `${workspaceMode} workspace mode, ${roots.length} root(s)`,
      detail:
        roots.length > 0
          ? roots.join("; ")
          : workspaceMode === "restricted"
            ? "No allowed workspace roots are configured."
            : "Unrestricted workspace access is enabled.",
      generatedAt,
      userVisible: workspaceMode === "restricted" && roots.length === 0,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "device.security-boundary",
      label: "Security boundary",
      severity:
        daemonNetworkKind(input.device.daemonUrl) === "public" || workspaceMode === "unrestricted"
          ? "warn"
          : "ok",
      summary: `${daemonNetworkKind(input.device.daemonUrl)} connector URL, ${workspaceMode} workspace access`,
      detail:
        workspaceMode === "unrestricted"
          ? "Unrestricted workspace browsing is enabled for this device. Keep the connector behind LAN/VPN access."
          : roots.length > 0
            ? `Allowed roots: ${roots.join("; ")}`
            : "No workspace roots are exposed beyond daemon policy.",
      generatedAt,
      userVisible:
        daemonNetworkKind(input.device.daemonUrl) === "public" || workspaceMode === "unrestricted",
    }),
  );

  const same = sameBuild(input.serverBuild, payload.build);
  checks.push(
    diagnosticCheck({
      id: "device.version",
      label: "Server/connector version",
      severity: same === true ? "ok" : same === false ? "warn" : "unknown",
      summary:
        same === true
          ? "server and connector builds match"
          : same === false
            ? "server and connector builds differ"
            : "build comparison unavailable",
      detail: `server ${buildSummary(input.serverBuild)}; connector ${buildSummary(payload.build)}`,
      generatedAt,
      userVisible: same !== true,
    }),
  );

  checks.push(
    diagnosticCheck({
      id: "device.approvals",
      label: "Approval hook",
      severity: payload.diagnostics?.approvalsHookEnabled ? "ok" : "warn",
      summary: payload.diagnostics?.approvalsHookEnabled
        ? `${payload.diagnostics?.pendingApprovals ?? 0} approval(s) pending`
        : "approval hook is not reported as enabled",
      detail:
        payload.diagnostics?.approvalsHookEnabled === false
          ? "Tool approval UX may not work until the connector is restarted with approvals enabled."
          : undefined,
      generatedAt,
      userVisible: payload.diagnostics?.approvalsHookEnabled === false,
    }),
  );

  return {
    scope: "device",
    targetId: input.device.id,
    targetLabel: input.device.label,
    generatedAt,
    checks,
    steps: checks.map((check) => diagnosticStepFromCheck(check, "server")),
  };
}

function diagnosticCheck(input: {
  id: string;
  label: string;
  severity: DiagnosticSeverity;
  summary: string;
  generatedAt: string;
  detail?: string | undefined;
  fixCommand?: string | undefined;
  copyCommand?: string | undefined;
  userVisible?: boolean | undefined;
}): DiagnosticCheck {
  return {
    id: input.id,
    label: input.label,
    severity: input.severity,
    summary: input.summary,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.fixCommand ? { fixCommand: input.fixCommand } : {}),
    ...(input.copyCommand ? { copyCommand: input.copyCommand } : {}),
    lastCheckedAt: input.generatedAt,
    ...(input.userVisible !== undefined ? { userVisible: input.userVisible } : {}),
  };
}

function localServerDaemonUrl(): string {
  const port = Number(process.env.CR_CONNECTOR_PORT ?? "18191");
  return `http://127.0.0.1:${Number.isFinite(port) ? port : 18191}`;
}

async function fetchDaemonStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  daemonUrl: string,
  authToken?: string,
): Promise<
  | { ok: true; payload: DaemonStatusPayload }
  | { ok: false; severity: DiagnosticSeverity; summary: string; detail?: string }
> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetchImpl(`${daemonUrl}/status`, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    return {
      ok: false,
      severity: "error",
      summary: `cannot reach daemon at ${daemonUrl}`,
      detail: (err as Error).message,
    };
  }
  if (res.status === 401) {
    return {
      ok: false,
      severity: "error",
      summary: "daemon rejected the saved token",
      detail: "Re-register this PC so the server stores the current connector token.",
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      severity: "error",
      summary: `daemon status returned HTTP ${res.status}`,
      ...(text ? { detail: text.slice(0, 500) } : {}),
    };
  }
  try {
    return { ok: true, payload: (await res.json()) as DaemonStatusPayload };
  } catch (err) {
    return {
      ok: false,
      severity: "error",
      summary: "daemon status returned non-JSON",
      detail: (err as Error).message,
    };
  }
}

function sameBuild(
  server: DeskRelayBuildInfo | undefined,
  connector: DeskRelayBuildInfo | undefined,
): boolean | null {
  if (!server || !connector) return null;
  if (
    !server.commit ||
    !connector.commit ||
    server.commit === "unknown" ||
    connector.commit === "unknown"
  ) {
    return null;
  }
  return server.commit === connector.commit && server.dirty === connector.dirty;
}

function buildSummary(build: DeskRelayBuildInfo | undefined): string {
  if (!build) return "unknown";
  const dirty = build.dirty ? "+dirty" : "";
  return `${build.shortCommit || build.version || "unknown"}${dirty}`;
}

async function probeDaemonStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  daemonUrl: string,
  authToken?: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetchImpl(`${daemonUrl}/status`, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `cannot reach daemon status at ${daemonUrl}: ${(err as Error).message}`,
    };
  }
  if (res.status === 401) {
    return {
      ok: false,
      status: 400,
      error:
        "daemon rejected the token. Enter that PC's connector daemon token, or run the daemon with a shared CR_CONNECTOR_AUTH_FILE token.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      error: `daemon status check failed (${res.status}) at ${daemonUrl}`,
    };
  }
  return { ok: true };
}

async function proxyJson(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  method: string,
  url: string,
  body?: string,
  localToken?: string,
): Promise<Response> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  if (body !== undefined && body.length > 0) {
    init.body = body;
    headers["content-type"] = "application/json";
  }
  if (localToken) headers.authorization = `Bearer ${localToken}`;
  if (Object.keys(headers).length > 0) init.headers = headers;
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, init);
  } catch (err) {
    return Response.json(
      { error: `cannot reach daemon: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  const text = await upstream.text();
  return new Response(text || "{}", {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}

async function proxyBinary(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  url: string,
  localToken?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (localToken) headers.authorization = `Bearer ${localToken}`;
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach daemon: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: filterPreviewHeaders(upstream.headers),
  });
}

function filterPreviewHeaders(source: Headers): Headers {
  const out = new Headers();
  const allow = new Set([
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
    "x-content-type-options",
  ]);
  for (const [rawKey, rawValue] of source.entries()) {
    const key = rawKey.toLowerCase();
    if (allow.has(key)) out.set(key, rawValue);
  }
  if (!out.has("content-type")) out.set("content-type", "application/octet-stream");
  out.set("x-content-type-options", "nosniff");
  return out;
}
