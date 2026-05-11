import { type Component, For, Show, createEffect, createResource, createSignal } from "solid-js";
import type { DiagnosticStep } from "@deskrelay/shared";
import {
  type DeskRelayBuildInfo,
  type Device,
  type DiagnosticCheck,
  type DiagnosticSeverity,
  type InstallReportRecord,
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
  const [installReports, { refetch: refetchInstallReports }] = createResource(
    () => props.devicesRevision ?? 0,
    () =>
      api
        .installReports()
        .then((result) => result.reports ?? [])
        .catch(() => []),
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
    void refetchInstallReports();
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

  const buildTone = (): Tone => {
    if (diagnostics.loading || health.loading) return "pending";
    const server = health()?.build;
    const connector = diagnostics()?.build;
    const same = sameBuild(server, connector);
    if (same === true) return "ok";
    if (same === false) return "warning";
    return "pending";
  };

  const serverTone = (): Tone => {
    if (health.loading) return "pending";
    return health()?.ok ? "ok" : "bad";
  };

  const daemonStatusDetail = (): string => {
    const snapshot = diagnostics();
    if (diagnostics.loading) return t("conn-diag.loading");
    if (diagnosticsError()) {
      return t("conn-diag.daemon.error", { error: diagnosticsError()?.message ?? "" });
    }
    if (snapshot?.ok) {
      return t("conn-diag.daemon.running", {
        started: snapshot.startedAt ? formatTime(snapshot.startedAt) : t("conn-diag.unknown"),
      });
    }
    return t("conn-diag.unknown");
  };

  const currentStatusRows = (): StatusRow[] => {
    const device = selectedDevice();
    return [
      {
        tone: serverTone(),
        label: "Server",
        detail: health.loading
          ? t("conn-diag.loading")
          : health()
            ? `running · ${buildLabel(health()?.build)}`
            : "status unavailable",
      },
      {
        tone: device ? deviceConnectionTone() : "offline",
        label: "Device",
        detail: device
          ? `${deviceDisplayName(device)} · ${
              device.connectionState === "offline" ? t("conn-diag.value.offline") : "selected"
            }`
          : t("conn-diag.no-device"),
      },
      {
        tone: daemonTone(),
        label: "Connector",
        detail: daemonStatusDetail(),
      },
      {
        tone: deviceConnectionTone(),
        label: "Site",
        detail:
          device?.connectionState === "offline"
            ? t("conn-diag.site.offline", { seen: formatOptionalTime(device.lastSeenAt) })
            : t("conn-diag.site.online", { seen: formatOptionalTime(device?.lastSeenAt) }),
      },
      {
        tone: buildTone(),
        label: "Version",
        detail: buildDetail(health()?.build, diagnostics()?.build),
      },
    ];
  };

  const rows = (): StatusRow[] => {
    const device = selectedDevice();
    const snapshot = diagnostics();

    const workspaceMode = snapshot?.workspaceRoots?.mode ?? t("conn-diag.unknown");
    const baseRows: StatusRow[] = [
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
        detail: daemonStatusDetail(),
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
    return baseRows.filter(isUserVisibleStatusRow);
  };

  const doctorChecks = (): DiagnosticCheck[] => {
    const report = doctor();
    return Array.isArray(report?.checks) ? report.checks.filter(isUserVisibleDiagnosticCheck) : [];
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
  const visibleInstallReports = (): InstallReportRecord[] =>
    (installReports() ?? []).filter((report) => report.steps.some(isUserVisibleDiagnosticStep));
  const installReportRows = (report: InstallReportRecord): StatusRow[] =>
    report.steps.filter(isUserVisibleDiagnosticStep).map((step) => ({
      tone: diagnosticTone(step.severity),
      label: step.label,
      detail: step.detail ? `${step.summary} · ${step.detail}` : step.summary,
    }));

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
        <For each={currentStatusRows()}>
          {(row) => (
            <Metric
              tone={row.tone}
              label={row.label}
              value={toneLabel(row.tone)}
              detail={row.detail}
            />
          )}
        </For>
      </div>

      <Show
        when={rows().length > 0}
        fallback={<p class="settings-card-help">표시할 조치 항목이 없습니다.</p>}
      >
        <StatusTable rows={rows()} label={t("conn-diag.summary")} />
      </Show>

      <Show when={doctorRows().length > 0}>
        <div class="connection-diagnostics-list">
          <div class="connection-diagnostics-list-title">상세 진단</div>
          <StatusTable rows={doctorRows()} label="상세 진단" />
        </div>
      </Show>

      <Show when={visibleInstallReports().length > 0}>
        <div class="connection-diagnostics-list">
          <div class="connection-diagnostics-list-title">최근 설치/등록 조치 항목</div>
          <For each={visibleInstallReports()}>
            {(report) => (
              <div class="connection-diagnostics-report">
                <div class="settings-card-help">
                  {report.label ? `${report.label} · ` : ""}
                  {formatTime(report.generatedAt ?? report.receivedAt)}
                </div>
                <StatusTable rows={installReportRows(report)} label="최근 설치/등록 조치 항목" />
              </div>
            )}
          </For>
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
    </div>
  );
};

const Metric: Component<{ tone: Tone; label: string; value: string; detail: string }> = (props) => (
  <div class="connection-diagnostics-metric">
    <div class="connection-diagnostics-metric-label">
      <span class={`connection-diagnostics-dot tone-${props.tone}`} />
      <span>{props.label}</span>
    </div>
    <div class="connection-diagnostics-metric-value">{props.value}</div>
    <div class="connection-diagnostics-metric-detail">{props.detail}</div>
  </div>
);

const StatusTable: Component<{ rows: StatusRow[]; label: string }> = (props) => (
  <div class="connection-diagnostics-table-wrap">
    <table class="connection-diagnostics-table" aria-label={props.label}>
      <colgroup>
        <col class="connection-diagnostics-table-status" />
        <col class="connection-diagnostics-table-name" />
        <col class="connection-diagnostics-table-detail" />
        <col class="connection-diagnostics-table-action" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">상태</th>
          <th scope="col">항목</th>
          <th scope="col">내용</th>
          <th scope="col">작업</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.rows}>
          {(row) => (
            <tr>
              <td class="connection-diagnostics-status-cell">
                <span class={`connection-diagnostics-dot tone-${row.tone}`} />
              </td>
              <th scope="row" class="connection-diagnostics-item-cell">
                {row.label}
              </th>
              <td class="connection-diagnostics-detail-cell">{row.detail}</td>
              <td class="connection-diagnostics-action-cell">
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
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
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

function toneLabel(tone: Tone): string {
  if (tone === "ok") return "OK";
  if (tone === "pending") return "Checking";
  if (tone === "warning") return "Warning";
  if (tone === "bad") return "Error";
  return "Offline";
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

function isUserVisibleStatusRow(row: StatusRow): boolean {
  if (row.action || row.onAction) return true;
  if (row.tone === "ok") return false;
  if (row.tone === "pending" && row.label.includes("업데이트") && row.detail.includes("기록")) {
    return false;
  }
  return true;
}

function isUserVisibleDiagnosticCheck(check: DiagnosticCheck): boolean {
  if (check.userVisible === false) return false;
  if (check.userVisible === true) return true;
  if (check.fixCommand || check.copyCommand) return true;
  return check.severity !== "ok";
}

function isUserVisibleDiagnosticStep(step: DiagnosticStep): boolean {
  if (step.userVisible === false) return false;
  if (step.userVisible === true) return true;
  if (step.action) return true;
  return step.severity !== "ok";
}
