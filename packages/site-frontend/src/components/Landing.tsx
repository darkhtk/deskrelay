import type { ManagerTask } from "@deskrelay/shared";
import { type Component, For, Show, createResource, createSignal } from "solid-js";
import {
  type DiagnosticCheck,
  type DiagnosticSeverity,
  type SelfServerUpdateStatus,
  api,
} from "../api.ts";
import { t } from "../i18n.ts";
import { LoginCard } from "./LoginCard.tsx";

type StepTone = "good" | "warn" | "bad" | "wait" | "neutral";
type DeviceLabelState = {
  tone: StepTone;
  label: string;
  detail: string;
};

export interface LandingProps {
  onTokenLogin: (token: string) => void | Promise<void>;
  onLocalAccessLogin?: () => boolean | Promise<boolean>;
  authed?: boolean;
  onProceed?: () => void;
  manualCleanupNotice?: { count: number; labels: string[] } | null;
}

export const Landing: Component<LandingProps> = (props) => {
  const [accessOpen, setAccessOpen] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [health, { refetch: refetchHealth }] = createResource(async () => await api.health());
  const [localToken, { refetch: refetchLocalToken }] = createResource(
    async () => await api.localSiteToken(),
  );
  const [clientContext, { refetch: refetchClientContext }] = createResource(
    async () => await api.browserClientContext(),
  );
  const [devices, { refetch: refetchDevices }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.listDevices(),
  );
  const [serverDoctor, { refetch: refetchServerDoctor }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.selfDoctor(),
  );
  const [registerCommand, { refetch: refetchRegisterCommand }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.registerOtherPcCommand(),
  );
  const [removeCommand, { refetch: refetchRemoveCommand }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.removeOtherPcCommand(),
  );
  const [updateStatus, { refetch: refetchUpdateStatus }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.selfUpdateStatus().catch(() => null),
  );
  const [managerTasks, { refetch: refetchManagerTasks }] = createResource(
    () => (props.authed ? "ready" : null),
    async () =>
      await api
        .managerTasks(3)
        .then((response) => response.tasks)
        .catch(() => []),
  );

  const refreshAll = async () => {
    await Promise.all([
      refetchHealth(),
      refetchLocalToken(),
      refetchClientContext(),
      props.authed ? refetchDevices() : Promise.resolve(),
      props.authed ? refetchServerDoctor() : Promise.resolve(),
      props.authed ? refetchRegisterCommand() : Promise.resolve(),
      props.authed ? refetchRemoveCommand() : Promise.resolve(),
      props.authed ? refetchUpdateStatus() : Promise.resolve(),
      props.authed ? refetchManagerTasks() : Promise.resolve(),
    ]);
  };

  const open = async () => {
    if (opening()) return;
    if (props.authed) {
      props.onProceed?.();
      return;
    }
    setOpening(true);
    try {
      if (await props.onLocalAccessLogin?.()) {
        props.onProceed?.();
        return;
      }
    } catch {
      // Fall back to manual Site token entry.
    } finally {
      setOpening(false);
    }
    setAccessOpen(true);
  };

  const serverTone = (): StepTone => {
    if (health.loading) return "wait";
    if (health.error) return "bad";
    if (props.authed && serverDoctor.loading) return "wait";
    if (props.authed && serverDoctor.error) return "bad";
    const severity = worstSeverity(serverChecks());
    return severity ? severityToStepTone(severity) : "good";
  };
  const accessTone = (): StepTone =>
    props.authed ? "good" : localToken.loading ? "wait" : localToken() ? "warn" : "bad";
  const devicesTone = (): StepTone => {
    if (!props.authed) return "wait";
    if (devices.loading) return "wait";
    if (devices.error) return "bad";
    return (devices()?.length ?? health()?.devices ?? 0) > 0 ? "good" : "warn";
  };
  const updateTone = (): StepTone => {
    if (!props.authed) return "neutral";
    if (updateStatus.loading) return "wait";
    const state = updateStatus()?.state ?? "idle";
    if (!isKnownUpdateState(state)) return "neutral";
    if (state === "running") return "wait";
    if (state === "succeeded") return "good";
    if (state === "failed") return "bad";
    return "neutral";
  };
  const latestManagerTask = () => managerTasks()?.[0] ?? null;
  const deviceCount = () => devices()?.length ?? health()?.devices ?? 0;
  const remoteUrl = () => registerCommand()?.preferredUrl ?? "";
  const siteToken = () => registerCommand()?.siteToken ?? "";
  const serverChecks = (): DiagnosticCheck[] => {
    const report = serverDoctor();
    return Array.isArray(report?.checks) ? report.checks : [];
  };
  const manualCleanupCommand = () => {
    if (!props.authed) return "Site token 인증 후 제거 명령을 생성합니다.";
    if (removeCommand.loading) return "제거 명령 생성 중...";
    if (removeCommand.error)
      return `제거 명령 생성 실패: ${(removeCommand.error as Error).message}`;
    return removeCommand()?.command ?? "제거 명령을 생성하지 못했습니다.";
  };
  const manualCleanupLabel = () => {
    const notice = props.manualCleanupNotice;
    if (!notice) return "";
    const names = notice.labels.length > 0 ? notice.labels.join(", ") : "알 수 없는 디바이스";
    return notice.count > notice.labels.length
      ? `${names} 외 ${notice.count - notice.labels.length}개`
      : names;
  };
  const matchingCurrentDevice = () => {
    const address = normalizeHost(clientContext()?.address ?? "");
    if (!address) return null;
    return (devices() ?? []).find((device) => deviceHosts(device).has(address)) ?? null;
  };
  const currentDeviceLabel = (): DeviceLabelState => {
    if (isMobileBrowser()) {
      return {
        tone: "neutral",
        label: "모바일",
        detail: "모바일 브라우저에서는 서버에 등록된 PC를 선택해 사용합니다.",
      };
    }

    if (clientContext.loading || localToken.loading) {
      return { tone: "wait", label: "확인 중", detail: "현재 브라우저 위치를 확인하고 있습니다." };
    }

    if (clientContext()?.isLocal || localToken()) {
      return {
        tone: "good",
        label: "서버 PC",
        detail: "이 PC에서 DeskRelay 서버가 실행 중입니다.",
      };
    }

    if (!props.authed) {
      return {
        tone: "wait",
        label: "등록 확인 전",
        detail: "Site token 확인 후 이 PC가 등록됐는지 판별합니다.",
      };
    }

    if (devices.loading) {
      return {
        tone: "wait",
        label: "확인 중",
        detail: "등록된 디바이스 목록과 비교하고 있습니다.",
      };
    }

    if (devices.error) {
      return { tone: "bad", label: "확인 실패", detail: "디바이스 목록을 읽지 못했습니다." };
    }

    const current = matchingCurrentDevice();
    if (current) {
      const offline = current.connectionState === "offline";
      return {
        tone: offline ? "warn" : "good",
        label: "등록된 디바이스",
        detail: `${current.label}${current.os ? ` (${current.os})` : ""}${offline ? " · 오프라인" : ""}`,
      };
    }

    return {
      tone: "warn",
      label: "등록 안 된 디바이스",
      detail: "이 PC에서 등록 명령을 실행하면 디바이스 목록에 추가됩니다.",
    };
  };
  const statusRows = () => [
    {
      tone: serverTone(),
      label: "서버",
      value: health.loading
        ? "확인 중"
        : health.error
          ? "응답 실패"
          : `정상 · v${health()?.version ?? "0.0.0"}`,
      detail: "프론트엔드와 API 상태",
    },
    {
      tone: accessTone(),
      label: "브라우저",
      value: props.authed ? "인증됨" : localToken() ? "Site token 감지됨" : "인증 필요",
      detail: props.authed ? "앱 사용 가능" : "시작하기로 입장",
    },
    {
      tone: devicesTone(),
      label: "디바이스",
      value: !props.authed
        ? "인증 대기"
        : devices.loading
          ? "조회 중"
          : devices.error
            ? "조회 실패"
            : `${deviceCount()}대 등록됨`,
      detail: currentDeviceLabel().detail,
    },
    {
      tone: updateTone(),
      label: "업데이트",
      value: updateStatusLabel(updateStatus()),
      detail: updateStatusDetail(updateStatus()),
    },
    {
      tone: managerTaskTone(latestManagerTask()),
      label: "관리 작업",
      value: managerTaskValue(latestManagerTask(), managerTasks.loading),
      detail: managerTaskDetail(latestManagerTask()),
    },
  ];

  return (
    <>
      <section class="landing-hero">
        <div class="landing-hero-inner">
          <h1 class="landing-headline">
            <For each={t("landing.headline").split("\n")}>
              {(line, index) => (
                <>
                  <Show when={index() > 0}>
                    <br />
                  </Show>
                  {line}
                </>
              )}
            </For>
          </h1>
          <div class="landing-cta-row">
            <button
              type="button"
              class="primary-button landing-cta"
              onClick={() => void open()}
              disabled={opening()}
            >
              {props.authed ? "앱 열기" : t("landing.cta.start")}
            </button>
          </div>
        </div>
      </section>

      <section class="landing-reliability" aria-label="자동 설치와 진단">
        <div class="landing-reliability-inner">
          <div class="landing-reliability-header">
            <h2>상태와 등록</h2>
            <p>서버, 브라우저, 디바이스, 업데이트 상태만 먼저 확인합니다.</p>
            <CurrentDeviceLabel state={currentDeviceLabel()} />
          </div>

          <div class="landing-dashboard">
            <div class="landing-status-list" aria-label="현재 상태">
              <For each={statusRows()}>
                {(row) => (
                  <div class={`landing-status-row landing-status-${row.tone}`}>
                    <span class="landing-status-dot" />
                    <div class="landing-status-main">
                      <strong>{row.label}</strong>
                      <span>{row.detail}</span>
                    </div>
                    <span class="landing-status-value">{row.value}</span>
                  </div>
                )}
              </For>
            </div>

            <div class="landing-command-box">
              <div class="landing-command-box-head">
                <span>다른 PC 등록 명령</span>
                <button
                  type="button"
                  class="landing-inline-button"
                  onClick={() => void refreshAll()}
                >
                  다시 진단
                </button>
              </div>
              <div class="landing-command-meta">
                <span class="landing-command-url">
                  {remoteUrl() ? `server URL: ${remoteUrl()}` : "Site token 확인 후 생성됩니다."}
                </span>
                <Show when={siteToken()}>
                  {(token) => <span class="landing-command-url">Site token: {token()}</span>}
                </Show>
              </div>
              <pre>
                <code>
                  {props.authed
                    ? registerCommand.loading
                      ? "명령 생성 중..."
                      : registerCommand.error
                        ? `명령 생성 실패: ${(registerCommand.error as Error).message}`
                        : registerCommand()?.command
                    : "시작하기를 누르면 이 서버의 Site token으로 등록 명령을 자동 생성합니다."}
                </code>
              </pre>
              <p class="landing-command-note">
                실행 끝에는 등록 리포트와 connector 검증 리포트가 출력됩니다. 실패 시 ERROR 항목과{" "}
                <code>%LOCALAPPDATA%\DeskRelay\reports\connector-verify-*.json</code> 경로를
                확인하세요.
              </p>
            </div>
          </div>

          <Show when={props.manualCleanupNotice}>
            {(notice) => (
              <div class="landing-cleanup-alert" role="alert">
                <div class="landing-command-box-head">
                  <span>수동 제거 필요</span>
                  <div class="landing-command-meta">
                    <span class="landing-command-url">자동 제거 미확인: {notice().count}대</span>
                  </div>
                </div>
                <p>
                  서버 목록에서는 제거됐지만, 다음 PC가 자동 uninstall 응답을 주지 않았습니다:{" "}
                  {manualCleanupLabel()}
                </p>
                <p>해당 PC가 켜지면 PowerShell에 아래 제거 명령을 통째로 붙여넣으세요.</p>
                <pre>
                  <code>{manualCleanupCommand()}</code>
                </pre>
              </div>
            )}
          </Show>
        </div>
      </section>

      <Show when={accessOpen()}>
        <dialog
          open
          class="approval-modal-root"
          aria-label={t("landing.signin.title")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setAccessOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setAccessOpen(false);
          }}
        >
          <button
            type="button"
            class="approval-backdrop"
            onClick={() => setAccessOpen(false)}
            aria-label={t("app.settings.close")}
          />
          <div class="approval-card" style={{ width: "min(420px, 95vw)" }}>
            <div class="approval-header">
              <span class="approval-title">{t("landing.signin.title")}</span>
              <button
                type="button"
                class="sidebar-action"
                style={{ "margin-left": "auto", width: "auto", padding: "4px 10px" }}
                onClick={() => setAccessOpen(false)}
                aria-label={t("app.dialog.close")}
              >
                x
              </button>
            </div>
            <LoginCard
              onTokenLogin={async (token) => {
                await props.onTokenLogin(token);
                props.onProceed?.();
              }}
            />
          </div>
        </dialog>
      </Show>
    </>
  );
};

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("::ffff:")) return trimmed.slice("::ffff:".length);
  if (trimmed === "::1" || trimmed === "localhost") return "127.0.0.1";
  return trimmed;
}

function hostFromUrl(value: string): string | null {
  try {
    return normalizeHost(new URL(value).hostname);
  } catch {
    return null;
  }
}

function deviceHosts(device: { daemonUrl: string; hostname?: string }): Set<string> {
  const hosts = new Set<string>();
  const urlHost = hostFromUrl(device.daemonUrl);
  if (urlHost) hosts.add(urlHost);
  if (device.hostname) hosts.add(normalizeHost(device.hostname));
  return hosts;
}

function severityToStepTone(severity: DiagnosticSeverity): StepTone {
  if (severity === "ok") return "good";
  if (severity === "warn") return "warn";
  if (severity === "error") return "bad";
  return "wait";
}

function worstSeverity(checks: DiagnosticCheck[]): DiagnosticSeverity | null {
  if (checks.length === 0) return null;
  if (checks.some((check) => check.severity === "error")) return "error";
  if (checks.some((check) => check.severity === "warn")) return "warn";
  if (checks.some((check) => check.severity === "unknown")) return "unknown";
  return "ok";
}

const CurrentDeviceLabel: Component<{ state: DeviceLabelState }> = (props) => (
  <div class={`landing-current-device landing-current-device-${props.state.tone}`}>
    <span class="landing-current-device-key">현재 디바이스</span>
    <strong>{props.state.label}</strong>
    <span>{props.state.detail}</span>
  </div>
);

function updateStatusLabel(status: SelfServerUpdateStatus | null | undefined): string {
  if (!isKnownUpdateState(status?.state) || status?.state === "idle") return "기록 없음";
  if (status.state === "running") return "진행 중";
  if (status.state === "succeeded") {
    if (status.changed === true) return "완료 · 변경 적용";
    if (status.changed === false) return "완료 · 이미 최신";
    return "완료";
  }
  return "실패";
}

function updateStatusDetail(status: SelfServerUpdateStatus | null | undefined): string {
  if (!isKnownUpdateState(status?.state) || status?.state === "idle") {
    return "설정 > 업데이트에서 업데이트를 실행할 수 있습니다.";
  }
  const range = status.before && status.after ? ` · ${status.before} → ${status.after}` : "";
  if (status.state === "running") return `업데이트 작업이 실행 중입니다${range}`;
  if (status.state === "succeeded") return `마지막 업데이트가 정상 종료됐습니다${range}`;
  return `마지막 업데이트 실패${status.error ? ` · ${status.error}` : ""}${range}`;
}

function managerTaskTone(task: ManagerTask | null): StepTone {
  if (!task) return "neutral";
  if (task.state === "succeeded") return "good";
  if (task.state === "failed" || task.state === "cancelled") return "bad";
  if (
    task.state === "blocked" ||
    task.state === "waiting_for_device" ||
    task.state === "restart_required"
  ) {
    return "warn";
  }
  return "wait";
}

function managerTaskValue(task: ManagerTask | null, loading: boolean): string {
  if (loading) return "조회 중";
  if (!task) return "기록 없음";
  return `${managerTaskKindLabel(task.kind)} · ${managerTaskStateLabel(task.state)}`;
}

function managerTaskDetail(task: ManagerTask | null): string {
  if (!task) return "설정 > 관리 Assistant에서 작업을 실행할 수 있습니다.";
  return task.error ?? `${task.steps.length}단계 기록 · ${formatShortDate(task.updatedAt)}`;
}

function managerTaskKindLabel(kind: ManagerTask["kind"]): string {
  const labels: Record<ManagerTask["kind"], string> = {
    diagnose: "진단",
    "update-server": "서버 업데이트",
    "update-device": "디바이스 업데이트",
    "update-all": "전체 업데이트",
    "restart-server": "서버 재시작",
    "restart-device": "디바이스 재시작",
    "repair-registration": "등록 복구",
    "run-worker": "작업자 실행",
  };
  return labels[kind] ?? kind;
}

function managerTaskStateLabel(state: ManagerTask["state"]): string {
  const labels: Record<ManagerTask["state"], string> = {
    pending: "대기",
    running: "진행 중",
    blocked: "중단",
    waiting_for_device: "디바이스 대기",
    restart_required: "재시작 필요",
    succeeded: "완료",
    failed: "실패",
    cancelled: "취소",
  };
  return labels[state] ?? state;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isKnownUpdateState(value: unknown): value is SelfServerUpdateStatus["state"] {
  return value === "idle" || value === "running" || value === "succeeded" || value === "failed";
}
