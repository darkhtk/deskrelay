import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  type DiagnosticCheck,
  type DiagnosticReport,
  type DiagnosticSeverity,
  MANAGER_API_VERSION,
  type ManagerAssistantChatMessage,
  type ManagerAssistantChatRequest,
  type ManagerAssistantChatResponse,
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
  type ManagerTaskRequest,
  type ManagerTaskState,
  type ManagerUpdatePlan,
  type ManagerUpdateStatus,
  type ManagerUpdateTargetStatus,
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
import type { DeviceUpdateQueueStore } from "./device-update-queue-store.ts";
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
  installReportStore?: InstallReportStore;
  deviceUpdateQueue?: DeviceUpdateQueueStore;
  managerTaskStore?: ManagerTaskStore;
  managerAssistant?: ManagerAssistantOptions;
  logDir?: string;
}

export interface ManagerAssistantRunInput {
  message: string;
  history: ManagerAssistantChatMessage[];
  cwd: string;
  repoRoot: string;
  instructionsPath: string;
  apiBaseUrl: string;
}

export interface ManagerAssistantRunResult {
  text: string;
  command: string;
}

export interface ManagerAssistantOptions {
  cwd?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  runner?: (input: ManagerAssistantRunInput) => Promise<ManagerAssistantRunResult>;
}

const DEFAULT_CONNECTOR_PORT = 18091;
const CONNECTOR_CLEANUP_TIMEOUT_MS = 5_000;
const MANAGER_ASSISTANT_DIR = ".deskrelay/manager-assistant";
const MANAGER_ASSISTANT_INSTRUCTIONS_FILE = "CLAUDE.md";

export function createSiteApp(options: SiteAppOptions): Hono {
  const app = new Hono();
  const fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]> =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const registry = options.registry;
  const localToken = options.localDaemonToken;
  const announcements = createAnnouncementSource(options, fetchImpl);
  const build = options.build ?? getDeskRelayBuildInfo();
  const managerTaskStore = options.managerTaskStore ?? createInMemoryManagerTaskStore();

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

  app.get("/api/manager/tasks", async (c) => {
    return c.json({ tasks: await managerTaskStore.list(clampListLimit(c.req.query("limit"))) });
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
    return c.json(completed, completed.state === "blocked" ? 409 : 202);
  });

  app.get("/api/manager/tasks/:id/logs", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(buildManagerTaskLogResponse(task));
  });

  app.post("/api/manager/tasks/:id/cancel", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    const cancelled = await cancelManagerTask(task, managerTaskStore, options.deviceUpdateQueue);
    if (!cancelled.ok) {
      return c.json({ error: cancelled.error ?? "task cannot be cancelled", task }, 409);
    }
    return c.json(cancelled.task, 202);
  });

  app.post("/api/manager/tasks/:id/retry", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    const retry = buildRetryManagerTaskRequest(task);
    if (!retry.ok) return c.json({ error: retry.error, task }, 409);
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
    return c.json(completed, completed.state === "blocked" ? 409 : 202);
  });

  app.get("/api/manager/tasks/:id", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(task);
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

  app.get("/api/manager/audit-log", async (c) => {
    return c.json({ entries: await managerTaskStore.list(clampListLimit(c.req.query("limit"))) });
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
    return c.json(await buildManagerUpdatePlan({ options, registry, build }));
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
    return c.json(completed, completed.state === "blocked" ? 409 : 202);
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
    return c.json(completed, completed.state === "blocked" ? 409 : 202);
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
    return c.json({
      entries: options.deviceUpdateQueue ? await options.deviceUpdateQueue.list() : [],
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
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/behaviors/${encodeURIComponent(c.req.param("instance"))}/request`,
      await c.req.text(),
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
  { method: "GET", path: "/api/devices/:id/fs/list", description: "List files and directories." },
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

async function createAndRunManagerTask(input: ManagerTaskCreateRunInput): Promise<ManagerTask> {
  const task = await input.store.create({
    kind: input.request.kind,
    ...(input.request.targetId ? { targetId: input.request.targetId } : {}),
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
  const result = await runner({
    message: request.message.trim(),
    history,
    cwd,
    repoRoot,
    instructionsPath: workspace.instructionsPath,
    apiBaseUrl,
  });
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
  };
}

async function runDefaultManagerAssistantCli(
  input: ManagerAssistantRunInput,
  options: SiteAppOptions,
): Promise<ManagerAssistantRunResult> {
  const assistantOptions = options.managerAssistant;
  const command =
    assistantOptions?.command ?? process.env.DESKRELAY_MANAGER_ASSISTANT_CLI ?? "claude";
  const args =
    assistantOptions?.args ??
    parseManagerAssistantArgs(process.env.DESKRELAY_MANAGER_ASSISTANT_ARGS);
  const timeoutMs = Math.max(5_000, assistantOptions?.timeoutMs ?? 120_000);
  const prompt = buildManagerAssistantPrompt(input);
  const argv = [...args, prompt];
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([command, ...argv], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
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

  proc.stdin.end();
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exitCode = await withTimeout(proc.exited, timeoutMs, () => {
    proc.kill();
  });
  const [out, err] = await Promise.all([stdout, stderr]);
  if (exitCode !== 0) {
    throw new Error(
      `Manager assistant CLI exited with code ${exitCode}${err.trim() ? `: ${err.trim()}` : ""}`,
    );
  }
  const text = out.trim() || err.trim();
  if (!text) throw new Error("Manager assistant CLI returned no output.");
  return {
    text,
    command: `${command} ${args.join(" ")}`.trim(),
  };
}

function buildManagerAssistantPrompt(input: ManagerAssistantRunInput): string {
  const recent = input.history.slice(-12);
  const transcript = recent
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`)
    .join("\n\n");
  return [
    "You are the DeskRelay manager assistant.",
    "You are running on the server PC in a managed DeskRelay assistant folder.",
    `Repository root: ${input.repoRoot}`,
    `Managed instruction file: ${input.instructionsPath}`,
    `DeskRelay manager API base URL: ${input.apiBaseUrl}`,
    "Talk with the user as a practical local development assistant.",
    "Answer in Korean unless the user asks for another language.",
    "If you did not actually run a command, do not claim that you did.",
    transcript ? `Previous conversation:\n${transcript}` : "",
    `User: ${input.message}`,
    "Assistant:",
  ]
    .filter(Boolean)
    .join("\n\n");
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
    "- You help the user inspect, diagnose, update, and repair this self-host DeskRelay instance.",
    "- You run on the server PC. Treat this as a local developer tool, not a hosted SaaS product.",
    "- Answer in Korean unless the user explicitly asks for another language.",
    "- Do not claim that you ran an API call, command, update, restart, or repair unless you actually did.",
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
    "Use the DeskRelay HTTP API for operational facts instead of guessing.",
    "For authenticated `/api/*` calls, send `Authorization: Bearer $DESKRELAY_SITE_TOKEN` when the token exists.",
    "`GET /api/capabilities` is the live source of truth for route and behavior-method discovery.",
    "Avoid calling `POST /api/manager/assistant/chat` from inside the assistant unless you are deliberately testing the assistant endpoint.",
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
    '{ "method": "chat", "params": { "prompt": "...", "cwd": "..." } }',
    '{ "method": "interrupt", "params": {} }',
    '{ "method": "permissions.inspect", "params": { "cwd": "..." } }',
    '{ "method": "permissions.update", "params": { "mode": "auto" } }',
    "```",
    "",
    "## Write/Task APIs",
    "",
    "- Prefer `dryRun: true` first for manager task shortcuts when available.",
    "- Ask the user before destructive or disruptive actions unless the user already gave explicit instruction.",
    '- Manager task body: `{ "kind": "diagnose|update-server|update-device|update-all|restart-server|restart-device|repair-registration", "targetId": "optional-device-id", "dryRun": true, "requestedBy": "manager-assistant" }`.',
    '- Shortcut task bodies accept `{ "dryRun": true, "requestedBy": "manager-assistant" }` when supported.',
    "",
    "## Safety Rules",
    "",
    "- Never print full Site tokens or daemon tokens in the answer.",
    "- Do not expose connector daemon tokens; `/api/devices` intentionally omits them.",
    "- Summarize large logs; quote only the relevant lines.",
    "- If a command or API call fails, report the failing endpoint/command and the exact status or error.",
    "- When the user asks for status, use read APIs first and answer from observed data.",
    "- When the user asks for a repair/update, inspect current state, explain the intended action, then run the smallest matching API.",
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
  const serverResult = await executeUpdateServerTask({
    ...input,
    request: { ...input.request, kind: "update-server", dryRun: false },
  });
  results.push(serverResult.result);
  steps.push(...serverResult.steps.slice(input.task.steps.length));

  for (const device of input.registry.list()) {
    const deviceResult = await executeUpdateDeviceTask({
      ...input,
      request: { ...input.request, kind: "update-device", targetId: device.id, dryRun: false },
    });
    results.push(deviceResult.result);
    steps.push(...deviceResult.steps.slice(input.task.steps.length));
  }

  const states = steps.map((step) => step.status);
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
    items.push({
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      action: queued
        ? queued.state === "pending_until_device_online" || queued.state === "queued"
          ? "queue"
          : queued.state === "running"
            ? "blocked"
            : queued.state === "restart_required"
              ? "restart"
              : queued.state === "failed"
                ? "update"
                : "none"
        : "unknown",
      ...(queued?.state ? { state: queued.state } : {}),
      reason: queued
        ? queued.warning || queued.error || `Queued update state: ${queued.state}.`
        : "No queued update state is known. Query device install status before deciding.",
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
    recentTasks,
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
  const action = actionFromRegistrationFailure(failureStep, classification);
  return {
    generatedAt,
    found: true,
    reportId: report.id,
    receivedAt: report.receivedAt,
    status: report.status,
    ...(report.label ? { label: report.label } : {}),
    ...(failureStep ? { failureStep } : {}),
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
  return {
    ok: true,
    value: {
      message: input.message.trim(),
      history: normalizeAssistantHistory(input.history),
    },
  };
}

function normalizeAssistantHistory(input: unknown): ManagerAssistantChatMessage[] {
  if (!Array.isArray(input)) return [];
  const history: ManagerAssistantChatMessage[] = [];
  for (const item of input) {
    if (!isRecord(item)) continue;
    if (item.role !== "user" && item.role !== "assistant" && item.role !== "system") continue;
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    history.push({
      id: typeof item.id === "string" && item.id.trim() ? item.id : `history_${history.length}`,
      role: item.role,
      text: item.text.trim().slice(0, 20_000),
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

function isManagerTaskKind(value: unknown): value is ManagerTaskKind {
  return (
    value === "diagnose" ||
    value === "update-server" ||
    value === "update-device" ||
    value === "update-all" ||
    value === "restart-server" ||
    value === "restart-device" ||
    value === "repair-registration"
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

async function requestDaemonSystemUpdate(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
  fallbackCommand: string,
  queue?: DeviceUpdateQueueStore,
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
      body: JSON.stringify({}),
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
      daemonStatus: res.status,
      fallbackCommand,
    });
    return Response.json(
      {
        ok: false,
        state: "failed",
        error: finalError,
        daemonStatus: res.status,
        fallbackCommand,
      },
      { status: unavailable ? 424 : res.status },
    );
  }

  const responsePayload = isRecord(payload) ? payload : { ok: true };
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

  return Response.json(responsePayload);
}

async function retryQueuedDeviceSystemUpdate(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
  fallbackCommand: string,
  queue: DeviceUpdateQueueStore,
): Promise<void> {
  const entry = await queue.get(device.id);
  if (entry?.state !== "pending_until_device_online") return;
  await requestDaemonSystemUpdate(fetchImpl, device, token, fallbackCommand, queue);
}

function buildFallbackRegisterCommandForRequest(
  options: SiteAppOptions,
  requestUrl: string,
): string {
  if (!options.token) return "";
  const urls = getAccessUrls(options.selfHostUrl ?? requestUrl);
  const preferredUrl = pickRemoteAccessUrl(urls);
  return buildRegisterOtherPcCommand({ siteUrl: preferredUrl, siteToken: options.token });
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

function buildRegisterOtherPcCommand(input: { siteUrl: string; siteToken: string }): string {
  const siteUrl = input.siteUrl.replace(/\/+$/, "");
  return [
    "$ErrorActionPreference = 'Stop'",
    "$installer = Join-Path $env:TEMP 'deskrelay-install-connector.ps1'",
    "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/install-connector.ps1' -OutFile $installer",
    "",
    "$workspaceRoots = Join-Path $HOME 'Projects'",
    `powershell -ExecutionPolicy Bypass -File $installer -Server ${quotePs(siteUrl)} -SiteToken ${quotePs(input.siteToken)} -WorkspaceRoots $workspaceRoots -Label $env:COMPUTERNAME -Port ${DEFAULT_CONNECTOR_PORT}`,
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
