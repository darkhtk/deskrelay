import { type Component, For, type JSX, Show, createResource, createSignal } from "solid-js";
import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { LoginCard } from "./LoginCard.tsx";

type StepTone = "good" | "warn" | "bad" | "wait" | "neutral";

export interface LandingProps {
  onTokenLogin: (token: string) => void | Promise<void>;
  onLocalAccessLogin?: () => boolean | Promise<boolean>;
  authed?: boolean;
  onProceed?: () => void;
}

export const Landing: Component<LandingProps> = (props) => {
  const [accessOpen, setAccessOpen] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [copyError, setCopyError] = createSignal<string | null>(null);
  const [health, { refetch: refetchHealth }] = createResource(async () => await api.health());
  const [localToken, { refetch: refetchLocalToken }] = createResource(
    async () => await api.localSiteToken(),
  );
  const [devices, { refetch: refetchDevices }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.listDevices(),
  );
  const [registerCommand, { refetch: refetchRegisterCommand }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.registerOtherPcCommand(),
  );

  const copyRegisterCommand = async () => {
    setCopyError(null);
    setCopied(false);
    const command = registerCommand()?.command;
    if (!command) {
      setCopyError("먼저 시작하기로 Site token을 확인하세요.");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopyError("클립보드에 쓸 수 없습니다. 아래 명령을 직접 선택해서 복사하세요.");
    }
  };

  const refreshAll = async () => {
    setCopyError(null);
    await Promise.all([
      refetchHealth(),
      refetchLocalToken(),
      props.authed ? refetchDevices() : Promise.resolve(),
      props.authed ? refetchRegisterCommand() : Promise.resolve(),
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

  const serverTone = (): StepTone => (health.loading ? "wait" : health.error ? "bad" : "good");
  const accessTone = (): StepTone =>
    props.authed ? "good" : localToken.loading ? "wait" : localToken() ? "warn" : "bad";
  const devicesTone = (): StepTone => {
    if (!props.authed) return "wait";
    if (devices.loading) return "wait";
    if (devices.error) return "bad";
    return (devices()?.length ?? health()?.devices ?? 0) > 0 ? "good" : "warn";
  };
  const remoteTone = (): StepTone => {
    if (!props.authed) return "wait";
    if (registerCommand.loading) return "wait";
    if (registerCommand.error) return "bad";
    return registerCommand() ? "good" : "warn";
  };
  const deviceCount = () => devices()?.length ?? health()?.devices ?? 0;
  const remoteUrl = () => registerCommand()?.preferredUrl ?? "";
  const diagnostics = () => {
    const rows: Array<{ tone: StepTone; text: string }> = [];
    if (health.loading) rows.push({ tone: "wait", text: "서버 API 확인 중" });
    else if (health.error) rows.push({ tone: "bad", text: "서버 API에 도달하지 못함" });
    else
      rows.push({ tone: "good", text: `서버 응답 정상 · 등록 디바이스 ${health()?.devices ?? 0}` });

    if (props.authed) rows.push({ tone: "good", text: "브라우저 Site token 인증됨" });
    else if (localToken())
      rows.push({ tone: "warn", text: "이 PC의 Site token 감지됨 · 시작하기 필요" });
    else rows.push({ tone: "bad", text: "브라우저 인증 전 · Site token 입력 필요" });

    if (props.authed && devices.error) rows.push({ tone: "bad", text: "디바이스 목록 조회 실패" });
    else if (props.authed && deviceCount() === 0)
      rows.push({ tone: "warn", text: "등록된 디바이스 없음" });
    else if (props.authed) rows.push({ tone: "good", text: `디바이스 ${deviceCount()}대 등록됨` });

    if (props.authed && registerCommand.error)
      rows.push({ tone: "bad", text: "다른 PC 등록 명령 생성 실패" });
    else if (props.authed && remoteUrl().includes("127.0.0.1"))
      rows.push({ tone: "warn", text: "다른 PC 등록용 외부 URL이 127.0.0.1로 잡힘" });
    else if (props.authed && remoteUrl())
      rows.push({ tone: "good", text: `다른 PC 등록 URL 준비됨 · ${remoteUrl()}` });
    return rows;
  };

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
            <p class="landing-kicker">Self-host control plane</p>
            <h2>자동 설치와 진단</h2>
            <p>DeskRelay가 현재 상태를 확인하고, 필요한 다음 작업만 바로 실행하게 합니다.</p>
          </div>

          <div class="landing-live-state" aria-label="자동 진단 요약">
            <StatePill
              label="server"
              value={
                health.loading
                  ? "확인 중"
                  : health.error
                    ? "실패"
                    : `정상 · devices ${health()?.devices ?? 0}`
              }
              tone={serverTone()}
            />
            <StatePill
              label="browser"
              value={props.authed ? "인증됨" : localToken() ? "자동 token 감지" : "token 필요"}
              tone={accessTone()}
            />
            <StatePill
              label="next"
              value={props.authed ? "다른 PC 등록 가능" : "시작하기"}
              tone={props.authed ? "good" : "neutral"}
            />
          </div>

          <div class="landing-auto-actions">
            <AutoStep
              index="1"
              title="서버 자동 확인"
              tone={serverTone()}
              status={
                health.loading
                  ? "확인 중"
                  : health.error
                    ? "서버 응답 실패"
                    : `정상 · v${health()?.version ?? "0.0.0"}`
              }
            >
              <Show
                when={!health.error}
                fallback={
                  <code class="landing-inline-code">
                    powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-start.ps1
                  </code>
                }
              >
                <span>프론트엔드와 API가 응답합니다.</span>
              </Show>
            </AutoStep>

            <AutoStep
              index="2"
              title="브라우저 접근 확인"
              tone={accessTone()}
              status={props.authed ? "인증됨" : localToken() ? "Site token 감지됨" : "입력 필요"}
            >
              <div class="landing-step-actions">
                <button
                  type="button"
                  class="primary-button landing-command-copy"
                  onClick={() => void open()}
                  disabled={opening()}
                >
                  {props.authed ? "앱 열기" : localToken() ? "자동 입장" : "Site token 입력"}
                </button>
              </div>
            </AutoStep>

            <AutoStep
              index="3"
              title="디바이스 등록 진단"
              tone={devicesTone()}
              status={
                !props.authed
                  ? "인증 대기"
                  : devices.loading
                    ? "조회 중"
                    : devices.error
                      ? "조회 실패"
                      : `${deviceCount()}대 등록됨`
              }
            >
              <Show
                when={props.authed}
                fallback={<span>시작하기 후 등록 상태를 자동 조회합니다.</span>}
              >
                <span>등록된 PC는 사이드바의 디바이스 목록에 자동 반영됩니다.</span>
              </Show>
            </AutoStep>

            <AutoStep
              index="4"
              title="다른 PC 자동 등록"
              tone={remoteTone()}
              status={
                !props.authed
                  ? "인증 대기"
                  : registerCommand.loading
                    ? "명령 생성 중"
                    : registerCommand.error
                      ? "생성 실패"
                      : "명령 준비됨"
              }
            >
              <div class="landing-step-actions">
                <button
                  type="button"
                  class="landing-inline-button"
                  onClick={() => void refreshAll()}
                >
                  다시 진단
                </button>
                <button
                  type="button"
                  class="primary-button landing-command-copy"
                  onClick={() => void copyRegisterCommand()}
                  disabled={!props.authed || registerCommand.loading}
                >
                  {copied() ? "복사됨" : "등록 명령 복사"}
                </button>
              </div>
            </AutoStep>
          </div>

          <div class="landing-diagnostics" aria-label="자동 판별 결과">
            <h3>자동 판별 결과</h3>
            <ul>
              <For each={diagnostics()}>
                {(item) => <li class={`landing-diagnostic-${item.tone}`}>{item.text}</li>}
              </For>
            </ul>
          </div>

          <div class="landing-command-box">
            <div class="landing-command-box-head">
              <span>다른 PC 등록 명령</span>
              <span class="landing-command-url">
                {remoteUrl() ? `server URL: ${remoteUrl()}` : "Site token 확인 후 생성됩니다."}
              </span>
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
            <Show when={copyError()}>
              {(message) => <p class="landing-command-error">{message()}</p>}
            </Show>
          </div>
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

const StatePill: Component<{ label: string; value: string; tone: StepTone }> = (props) => {
  return (
    <div class={`landing-state-pill landing-state-${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
};

const AutoStep: Component<{
  index: string;
  title: string;
  status: string;
  tone: StepTone;
  children: JSX.Element;
}> = (props) => (
  <section class={`landing-auto-step landing-auto-step-${props.tone}`} aria-label={props.title}>
    <span class="landing-auto-index">{props.index}</span>
    <div class="landing-auto-main">
      <div class="landing-auto-head">
        <h3>{props.title}</h3>
        <strong>{props.status}</strong>
      </div>
      <div class="landing-auto-body">{props.children}</div>
    </div>
  </section>
);
