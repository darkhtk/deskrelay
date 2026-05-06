import { type Component, For, Show, createEffect, createResource, createSignal } from "solid-js";
import { type Device, api } from "../api.ts";
import { deviceDisplayName } from "../device-display.ts";
import { t } from "../i18n.ts";

export interface ConnectionDiagnosticsProps {
  initialSelectedDeviceId?: string | null;
  devicesRevision?: number;
  onOpenDevices?: (deviceId: string | null) => void;
}

type Tone = "ok" | "pending" | "warning" | "bad" | "offline";

interface StatusRow {
  tone: Tone;
  label: string;
  detail: string;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
}

export const ConnectionDiagnostics: Component<ConnectionDiagnosticsProps> = (props) => {
  const [devices, { refetch: refetchDevices }] = createResource(
    () => props.devicesRevision ?? 0,
    () => api.listDevices(),
  );
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | null>(
    props.initialSelectedDeviceId ?? null,
  );
  const [updatedAt, setUpdatedAt] = createSignal<Date | null>(null);
  const [diagnosticsError, setDiagnosticsError] = createSignal<Error | null>(null);

  createEffect(() => {
    const list = devices();
    if (!list) return;
    if (list.length === 0) {
      if (selectedDeviceId() !== null) setSelectedDeviceId(null);
      return;
    }
    const current = selectedDeviceId();
    if (current && list.some((d) => d.id === current)) return;
    const initial = props.initialSelectedDeviceId;
    const next = initial && list.some((d) => d.id === initial) ? initial : list[0]?.id;
    setSelectedDeviceId(next ?? null);
  });

  const selectedDevice = () => {
    const id = selectedDeviceId();
    if (!id) return null;
    return (devices() ?? []).find((d) => d.id === id) ?? null;
  };

  const [diagnostics, { refetch: refetchDiagnostics }] = createResource(
    () => selectedDevice()?.id ?? null,
    async (id) => {
      if (!id) return null;
      try {
        const snapshot = await api.diagnostics(id);
        setDiagnosticsError(null);
        setUpdatedAt(new Date());
        return snapshot;
      } catch (err) {
        setDiagnosticsError(err as Error);
        setUpdatedAt(new Date());
        return null;
      }
    },
  );

  function refresh(): void {
    void refetchDevices();
    if (selectedDevice()) void refetchDiagnostics();
  }

  function openDevices(): void {
    props.onOpenDevices?.(selectedDeviceId());
  }

  const deviceConnectionTone = (): Tone => {
    const device = selectedDevice();
    if (!device) return "offline";
    return device.connectionState === "offline" ? "offline" : "ok";
  };

  const daemonTone = (): Tone => {
    if (diagnostics.loading) return "pending";
    if (diagnosticsError()) return "bad";
    return diagnostics()?.ok ? "ok" : "warning";
  };

  const claudeTone = (): Tone => {
    if (diagnostics.loading) return "pending";
    if (diagnosticsError()) return "bad";
    const value = diagnostics()?.diagnostics?.remoteClaudeLoaded;
    if (value === true) return "ok";
    if (value === false) return "bad";
    return "warning";
  };

  const rows = (): StatusRow[] => {
    const device = selectedDevice();
    const snapshot = diagnostics();
    const daemonDetail = diagnostics.loading
      ? t("conn-diag.loading")
      : diagnosticsError()
        ? t("conn-diag.daemon.error", { error: diagnosticsError()?.message ?? "" })
        : snapshot?.ok
          ? t("conn-diag.daemon.running", {
              started: snapshot.startedAt ? formatTime(snapshot.startedAt) : t("conn-diag.unknown"),
            })
          : t("conn-diag.unknown");

    const workspaceMode = snapshot?.workspaceRoots?.mode ?? t("conn-diag.unknown");
    const behaviorList = snapshot?.behaviors ?? [];
    const loadedBehavior = behaviorList.find((b) => b.instanceId === "remote-claude");

    return [
      {
        tone: device ? "ok" : "offline",
        label: t("conn-diag.row.installed"),
        detail: device
          ? t("conn-diag.installed.detail", {
              label: deviceDisplayName(device),
              registered: formatTime(device.registeredAt),
            })
          : t("conn-diag.no-device"),
        action: device ? undefined : t("connection.action.devices"),
        onAction: device ? undefined : openDevices,
      },
      {
        tone: daemonTone(),
        label: t("conn-diag.row.daemon"),
        detail: daemonDetail,
        action: diagnosticsError() ? t("conn-diag.action.refresh") : undefined,
        onAction: diagnosticsError() ? refresh : undefined,
      },
      {
        tone: deviceConnectionTone(),
        label: t("conn-diag.row.site"),
        detail:
          device?.connectionState === "offline"
            ? t("conn-diag.site.offline", { seen: formatOptionalTime(device.lastSeenAt) })
            : t("conn-diag.site.online", { seen: formatOptionalTime(device?.lastSeenAt) }),
        action: device?.connectionState === "offline" ? t("connection.action.devices") : undefined,
        onAction: device?.connectionState === "offline" ? openDevices : undefined,
      },
      {
        tone: claudeTone(),
        label: t("conn-diag.row.claude"),
        detail:
          diagnosticsError() || !snapshot
            ? t("conn-diag.not-read")
            : snapshot.diagnostics?.remoteClaudeLoaded
              ? t("conn-diag.claude.loaded", {
                  version: loadedBehavior?.version ?? t("conn-diag.unknown"),
                })
              : t("conn-diag.claude.not-ready"),
        action:
          snapshot?.diagnostics?.remoteClaudeLoaded === false
            ? t("conn-diag.action.refresh")
            : undefined,
        onAction: snapshot?.diagnostics?.remoteClaudeLoaded === false ? refresh : undefined,
      },
      {
        tone:
          snapshot?.diagnostics?.approvalsHookEnabled === undefined
            ? "warning"
            : snapshot.diagnostics.approvalsHookEnabled
              ? "ok"
              : "bad",
        label: t("conn-diag.row.approvals"),
        detail: snapshot
          ? t("conn-diag.approvals.detail", {
              hook: snapshot.diagnostics?.approvalsHookEnabled
                ? t("conn-diag.value.ready")
                : t("conn-diag.value.not-ready"),
              count: snapshot.diagnostics?.pendingApprovals ?? 0,
            })
          : t("conn-diag.not-read"),
      },
      {
        tone: !snapshot ? "warning" : snapshot.workspaceRoots?.mode === "restricted" ? "warning" : "ok",
        label: t("conn-diag.row.workspace"),
        detail: t("conn-diag.workspace.detail", {
          mode: workspaceMode,
          count: snapshot?.workspaceRoots?.roots.length ?? 0,
        }),
      },
    ];
  };

  return (
    <div class="connection-diagnostics">
      <div class="connection-diagnostics-header">
        <h3>{t("conn-diag.title")}</h3>
        <Show when={updatedAt()}>
          {(date) => (
            <span class="connection-diagnostics-updated">
              {t("conn-diag.updated", { time: formatTime(date().toISOString()) })}
            </span>
          )}
        </Show>
        <button type="button" class="text-button" onClick={refresh}>
          {diagnostics.loading || devices.loading
            ? t("dsd.diagnostics.busy")
            : t("dsd.diagnostics.refresh")}
        </button>
      </div>

      <Show
        when={(devices() ?? []).length > 0}
        fallback={<p class="settings-card-help">{t("conn-diag.no-device")}</p>}
      >
        <div class="connection-diagnostics-device">
          <label for="connection-diagnostics-device">{t("chat.sidebar.device.label")}</label>
          <select
            id="connection-diagnostics-device"
            class="text-input"
            value={selectedDeviceId() ?? ""}
            onChange={(e) => setSelectedDeviceId(e.currentTarget.value || null)}
          >
            <For each={devices() ?? []}>
              {(device: Device) => <option value={device.id}>{deviceDisplayName(device)}</option>}
            </For>
          </select>
        </div>
      </Show>

      <div class="connection-diagnostics-summary" aria-label={t("conn-diag.summary")}>
        <Metric
          label={t("conn-diag.summary.install")}
          value={selectedDevice() ? t("conn-diag.value.ready") : t("conn-diag.value.not-ready")}
        />
        <Metric
          label={t("conn-diag.summary.daemon")}
          value={
            diagnosticsError()
              ? t("conn-diag.value.not-ready")
              : diagnostics.loading
                ? t("conn-diag.loading")
                : diagnostics()?.ok
                  ? t("conn-diag.value.ready")
                  : t("conn-diag.unknown")
          }
        />
        <Metric
          label={t("conn-diag.summary.site")}
          value={
            !selectedDevice()
              ? t("conn-diag.value.not-ready")
              : selectedDevice()?.connectionState === "offline"
                ? t("conn-diag.value.offline")
                : t("conn-diag.value.connected")
          }
        />
        <Metric
          label={t("conn-diag.summary.claude")}
          value={
            diagnostics()?.diagnostics?.remoteClaudeLoaded
              ? t("conn-diag.value.ready")
              : t("conn-diag.value.not-ready")
          }
        />
      </div>

      <div class="connection-diagnostics-rows">
        <For each={rows()}>
          {(row) => (
            <div class="connection-diagnostics-row">
              <div class="connection-diagnostics-row-main">
                <div class="connection-diagnostics-row-title">
                  <span class={`connection-diagnostics-dot tone-${row.tone}`} />
                  {row.label}
                </div>
                <div class="connection-diagnostics-row-detail">{row.detail}</div>
              </div>
              <Show when={row.action && row.onAction}>
                <button type="button" class="text-button" onClick={() => row.onAction?.()}>
                  {row.action}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={(diagnostics()?.workspaceRoots?.roots ?? []).length > 0}>
        <div class="connection-diagnostics-list">
          <div class="connection-diagnostics-list-title">{t("dsd.diagnostics.workspace-roots")}</div>
          <For each={diagnostics()?.workspaceRoots?.roots ?? []}>
            {(root) => <code>{root}</code>}
          </For>
        </div>
      </Show>

      <Show when={(diagnostics()?.behaviors ?? []).length > 0}>
        <div class="connection-diagnostics-list">
          <div class="connection-diagnostics-list-title">{t("dsd.diagnostics.loaded-behaviors")}</div>
          <For each={diagnostics()?.behaviors ?? []}>
            {(behavior) => (
              <code>
                {behavior.name}@{behavior.version}
              </code>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const Metric: Component<{ label: string; value: string }> = (props) => (
  <div class="connection-diagnostics-metric">
    <div class="connection-diagnostics-metric-label">{props.label}</div>
    <div class="connection-diagnostics-metric-value">{props.value}</div>
  </div>
);

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return value;
  }
}

function formatOptionalTime(value: string | undefined): string {
  return value ? formatTime(value) : t("conn-diag.unknown");
}
