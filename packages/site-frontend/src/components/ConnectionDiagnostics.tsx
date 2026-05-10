import { type Component, For, Show, createEffect, createResource, createSignal } from "solid-js";
import {
  type DeskRelayBuildInfo,
  type Device,
  type DiagnosticCheck,
  type DiagnosticSeverity,
  type SelfServerUpdateStatus,
  api,
} from "../api.ts";
import { deviceDisplayName } from "../device-display.ts";
import { t } from "../i18n.ts";
import { SettingsScopeLabels } from "./SettingsScopeLabel.tsx";

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
  disabled?: boolean | undefined;
}

interface DeviceDiagnosticSource {
  id: string;
  revision: number;
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
  const [doctorError, setDoctorError] = createSignal<Error | null>(null);
  const [health, { refetch: refetchHealth }] = createResource(
    () => props.devicesRevision ?? 0,
    () => api.health().catch(() => null),
  );
  const [serverUpdateStatus, { refetch: refetchServerUpdateStatus }] = createResource(
    () => props.devicesRevision ?? 0,
    () => api.selfUpdateStatus().catch(() => null),
  );

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

  const selectedDeviceDiagnosticSource = (): DeviceDiagnosticSource | null => {
    const id = selectedDevice()?.id;
    if (!id) return null;
    return { id, revision: props.devicesRevision ?? 0 };
  };

  const [diagnostics, { refetch: refetchDiagnostics }] = createResource(
    selectedDeviceDiagnosticSource,
    async (source) => {
      if (!source) return null;
      try {
        const snapshot = await api.diagnostics(source.id);
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
  const [doctor, { refetch: refetchDoctor }] = createResource(
    selectedDeviceDiagnosticSource,
    async (source) => {
      if (!source) return null;
      try {
        const report = await api.deviceDoctor(source.id);
        setDoctorError(null);
        return report;
      } catch (err) {
        setDoctorError(err as Error);
        return null;
      }
    },
  );

  function refresh(): void {
    void refetchHealth();
    void refetchServerUpdateStatus();
    void refetchDevices();
    if (selectedDevice()) void refetchDiagnostics();
    if (selectedDevice()) void refetchDoctor();
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

  const buildTone = (): Tone => {
    if (diagnostics.loading || health.loading) return "pending";
    const server = health()?.build;
    const connector = diagnostics()?.build;
    const same = sameBuild(server, connector);
    if (same === true) return "ok";
    if (same === false) return "warning";
    return "pending";
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
        tone: updateStatusTone(serverUpdateStatus()),
        label: "서버 업데이트",
        detail: updateStatusText(serverUpdateStatus()),
      },
      {
        tone: buildTone(),
        label: "버전",
        detail: buildDetail(health()?.build, snapshot?.build),
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
        tone: !snapshot
          ? "warning"
          : snapshot.workspaceRoots?.mode === "restricted"
            ? "warning"
            : "ok",
        label: t("conn-diag.row.workspace"),
        detail: t("conn-diag.workspace.detail", {
          mode: workspaceMode,
          count: snapshot?.workspaceRoots?.roots.length ?? 0,
        }),
      },
    ];
  };

  const doctorChecks = (): DiagnosticCheck[] => {
    const report = doctor();
    return Array.isArray(report?.checks) ? report.checks : [];
  };

  const doctorRows = (): StatusRow[] => {
    if (doctor.loading) {
      return [{ tone: "pending", label: "상세 진단", detail: "디바이스 상태 확인 중..." }];
    }
    if (doctorError()) {
      return [
        {
          tone: "bad",
          label: "상세 진단",
          detail: `상세 진단 실패: ${doctorError()?.message ?? ""}`,
        },
      ];
    }
    return doctorChecks().map((check) => ({
      tone: diagnosticTone(check.severity),
      label: check.label,
      detail: check.detail ? `${check.summary} · ${check.detail}` : check.summary,
    }));
  };

  return (
    <div class="connection-diagnostics">
      <div class="connection-diagnostics-header">
        <h3>
          {t("conn-diag.title")}
          <SettingsScopeLabels scopes={["server", "current device"]} />
        </h3>
        <Show when={updatedAt()}>
          {(date) => (
            <span class="connection-diagnostics-updated">
              {t("conn-diag.updated", { time: formatTime(date().toISOString()) })}
            </span>
          )}
        </Show>
        <div class="connection-diagnostics-actions">
          <button type="button" class="text-button" onClick={refresh}>
            {diagnostics.loading || devices.loading
              ? t("dsd.diagnostics.busy")
              : t("dsd.diagnostics.refresh")}
          </button>
        </div>
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
                <button
                  type="button"
                  class="text-button"
                  disabled={row.disabled}
                  onClick={() => row.onAction?.()}
                >
                  {row.action}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={doctorRows().length > 0}>
        <div class="connection-diagnostics-list">
          <div class="connection-diagnostics-list-title">상세 진단</div>
          <div class="connection-diagnostics-rows">
            <For each={doctorRows()}>
              {(row) => (
                <div class="connection-diagnostics-row">
                  <div class="connection-diagnostics-row-main">
                    <div class="connection-diagnostics-row-title">
                      <span class={`connection-diagnostics-dot tone-${row.tone}`} />
                      {row.label}
                    </div>
                    <div class="connection-diagnostics-row-detail">{row.detail}</div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={(diagnostics()?.workspaceRoots?.roots ?? []).length > 0}>
        <div class="connection-diagnostics-list">
          <div class="connection-diagnostics-list-title">
            {t("dsd.diagnostics.workspace-roots")}
          </div>
          <For each={diagnostics()?.workspaceRoots?.roots ?? []}>
            {(root) => <code>{root}</code>}
          </For>
        </div>
      </Show>

      <Show when={(diagnostics()?.behaviors ?? []).length > 0}>
        <div class="connection-diagnostics-list">
          <div class="connection-diagnostics-list-title">
            {t("dsd.diagnostics.loaded-behaviors")}
          </div>
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

function buildDetail(
  server: DeskRelayBuildInfo | undefined,
  connector: DeskRelayBuildInfo | undefined,
): string {
  const serverLabel = buildLabel(server);
  const connectorLabel = buildLabel(connector);
  const same = sameBuild(server, connector);
  if (same === true) return `server ${serverLabel} · connector ${connectorLabel} · 일치`;
  if (same === false) {
    return `server ${serverLabel} · connector ${connectorLabel} · 불일치: 서버와 connector를 같은 git 버전으로 재시작하세요`;
  }
  return `server ${serverLabel} · connector ${connectorLabel} · 확인 필요`;
}

function buildLabel(build: DeskRelayBuildInfo | undefined): string {
  if (!build) return "unknown";
  const dirty = build.dirty ? "+dirty" : "";
  return `${build.shortCommit || build.version || "unknown"}${dirty}`;
}

function diagnosticTone(severity: DiagnosticSeverity): Tone {
  if (severity === "ok") return "ok";
  if (severity === "warn") return "warning";
  if (severity === "error") return "bad";
  return "pending";
}

function updateStatusTone(status: SelfServerUpdateStatus | null | undefined): Tone {
  if (!status || status.state === "idle") return "pending";
  if (status.state === "running") return "pending";
  if (status.state === "succeeded") return "ok";
  return "bad";
}

function updateStatusText(status: SelfServerUpdateStatus | null | undefined): string {
  if (!status || status.state === "idle") return "서버 업데이트 기록 없음";
  const range = status.before && status.after ? ` · ${status.before} → ${status.after}` : "";
  if (status.state === "running") return `서버 업데이트 진행 중${range}`;
  if (status.state === "succeeded") {
    const changed =
      status.changed === true ? "변경 적용됨" : status.changed === false ? "이미 최신" : "완료";
    return `서버 업데이트 완료 · ${changed}${range}`;
  }
  return `서버 업데이트 실패${status.error ? ` · ${status.error}` : ""}${range}`;
}
