import { networkInterfaces } from "node:os";
import {
  type DiagnosticCheck,
  type DiagnosticReport,
  type DiagnosticSeverity,
  diagnosticStepFromCheck,
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
import type { InstallReportStore } from "./install-report-store.ts";
import { loc } from "./i18n.ts";
import type {
  SelfServerAutostartController,
  SelfServerAutostartStatus,
} from "./self-server-autostart.ts";
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
  selfServerUpdater?: SelfServerUpdater;
  installReportStore?: InstallReportStore;
}

const DEFAULT_CONNECTOR_PORT = 18091;
const CONNECTOR_CLEANUP_TIMEOUT_MS = 5_000;

export function createSiteApp(options: SiteAppOptions): Hono {
  const app = new Hono();
  const fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]> =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const registry = options.registry;
  const localToken = options.localDaemonToken;
  const announcements = createAnnouncementSource(options, fetchImpl);
  const build = options.build ?? getDeskRelayBuildInfo();

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

  app.get("/api/devices", (c) => c.json(registry.list().map(toPublicDevice)));

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
    }
    return c.json({ ok: true, cleanup });
  });

  app.delete("/api/devices/:id", async (c) => {
    const id = c.req.param("id");
    const device = registry.get(id);
    if (!device) return c.json({ error: `unknown device: ${id}` }, 404);
    const result = await unregisterDeviceWithCleanup(fetchImpl, registry, device, localToken);
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
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/status`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/system/update", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    const preferredUrl = pickRemoteAccessUrl(urls);
    const fallbackCommand = options.token
      ? buildRegisterOtherPcCommand({ siteUrl: preferredUrl, siteToken: options.token })
      : "";
    return await requestDaemonSystemUpdate(
      fetchImpl,
      device,
      daemonToken(device, localToken),
      fallbackCommand,
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
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetchImpl(`${device.daemonUrl}/system/update`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        state: "failed",
        error: `cannot reach daemon: ${(err as Error).message}`,
        fallbackCommand,
      },
      { status: 502 },
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
    return Response.json(
      {
        ok: false,
        state: "failed",
        error: unavailable
          ? "connector update API is unavailable on this device. Re-run the registration command."
          : error,
        daemonStatus: res.status,
        fallbackCommand,
      },
      { status: unavailable ? 424 : res.status },
    );
  }

  return Response.json(payload ?? { ok: true });
}

function parseJsonPayload(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
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
