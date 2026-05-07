import { type Component, For, Show, createResource, createSignal } from "solid-js";
import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { LoginCard } from "./LoginCard.tsx";

type WizardStep = "server" | "local" | "remote" | "diagnose";

export interface LandingProps {
  onTokenLogin: (token: string) => void | Promise<void>;
  onLocalAccessLogin?: () => boolean | Promise<boolean>;
  authed?: boolean;
  onProceed?: () => void;
}

export const Landing: Component<LandingProps> = (props) => {
  const [accessOpen, setAccessOpen] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [activeStep, setActiveStep] = createSignal<WizardStep>("server");
  const [copied, setCopied] = createSignal(false);
  const [copyError, setCopyError] = createSignal<string | null>(null);
  const [health] = createResource(async () => await api.health());
  const [localToken] = createResource(async () => await api.localSiteToken());
  const [registerCommand, { refetch: refetchRegisterCommand }] = createResource(
    () => (props.authed ? "ready" : null),
    async () => await api.registerOtherPcCommand(),
  );

  const copyRegisterCommand = async () => {
    setCopyError(null);
    setCopied(false);
    const command = registerCommand()?.command;
    if (!command) {
      setCopyError("먼저 시작하기로 Site token을 확보하세요.");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopyError("클립보드에 쓸 수 없습니다. 명령을 직접 선택해서 복사하세요.");
    }
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
              {t("landing.cta.start")}
            </button>
          </div>
        </div>
      </section>

      <section class="landing-reliability" aria-label="설치와 연결 신뢰">
        <div class="landing-reliability-inner">
          <div class="landing-reliability-header">
            <p class="landing-kicker">Power-user setup</p>
            <h2>설치와 진단 wizard</h2>
            <p>
              목표는 한 번의 등록 명령이 현재 상태를 판별하고, 가능한 것은 보정하고, 막힌 것은
              원인과 재실행 지점을 알려주는 것이다.
            </p>
          </div>

          <div class="landing-live-state" aria-label="현재 서버 상태">
            <StatePill
              label="site server"
              value={
                health.loading
                  ? "확인 중"
                  : health.error
                    ? "도달 실패"
                    : `online · devices ${health()?.devices ?? 0}`
              }
              tone={health.error ? "bad" : health.loading ? "wait" : "good"}
            />
            <StatePill
              label="local token"
              value={
                localToken.loading ? "확인 중" : localToken() ? "자동 입장 가능" : "수동 입력 필요"
              }
              tone={localToken.loading ? "wait" : localToken() ? "good" : "warn"}
            />
            <StatePill
              label="next action"
              value={props.authed ? "앱 열기" : "시작하기"}
              tone="neutral"
            />
          </div>

          <div class="landing-wizard">
            <nav class="landing-wizard-tabs" aria-label="설치 단계" role="tablist">
              <WizardTab
                id="server"
                active={activeStep() === "server"}
                title="서버 PC"
                status={health.error ? "확인 필요" : health.loading ? "확인 중" : "online"}
                onSelect={setActiveStep}
              />
              <WizardTab
                id="local"
                active={activeStep() === "local"}
                title="이 PC"
                status={localToken() ? "token 확인" : "token 입력"}
                onSelect={setActiveStep}
              />
              <WizardTab
                id="remote"
                active={activeStep() === "remote"}
                title="다른 PC"
                status={props.authed ? "명령 준비" : "인증 필요"}
                onSelect={setActiveStep}
              />
              <WizardTab
                id="diagnose"
                active={activeStep() === "diagnose"}
                title="진단"
                status="실패 분류"
                onSelect={setActiveStep}
              />
            </nav>

            <div class="landing-wizard-body">
              <Show when={activeStep() === "server"}>
                <WizardPanel
                  title="서버 PC"
                  summary="브라우저와 모든 connector daemon 사이의 control plane이다."
                  checks={[
                    health.loading
                      ? "site server /healthz 확인 중"
                      : health.error
                        ? "site server /healthz 도달 실패"
                        : `site server online · registered devices ${health()?.devices ?? 0}`,
                    "Site token은 브라우저 API 접근 경계다.",
                    "다른 PC 등록 명령은 이 서버 URL과 Site token을 포함해야 한다.",
                  ]}
                  next="서버가 online이면 이 PC 또는 다른 PC connector를 등록한다."
                />
              </Show>

              <Show when={activeStep() === "local"}>
                <WizardPanel
                  title="이 PC connector"
                  summary="서버 PC 자체를 제어 대상으로 쓸 때 필요한 local connector 상태다."
                  checks={[
                    localToken.loading
                      ? "local Site token 확인 중"
                      : localToken()
                        ? "local Site token 확인됨 · 시작하기로 바로 입장 가능"
                        : "local Site token 없음 · 수동 token 입력 필요",
                    "connector daemon은 127.0.0.1:18091 local /status를 통과해야 한다.",
                    "login task가 설치되어야 재로그인 후 connector가 복구된다.",
                  ]}
                  next="이 PC가 서버라면 시작하기를 눌러 앱에 들어간 뒤 연결 진단을 확인한다."
                />
              </Show>

              <Show when={activeStep() === "remote"}>
                <section class="landing-wizard-panel" aria-label="다른 Windows PC 등록">
                  <div class="landing-wizard-panel-head">
                    <h3>다른 Windows PC 등록</h3>
                    <p>
                      대상 PC에서는 GitHub에서 받은 PowerShell installer가 preflight, repo
                      reconcile, Tailscale/LAN 감지, firewall 확인, connector 시작, registry 등록을
                      수행한다.
                    </p>
                  </div>
                  <ol class="landing-check-list">
                    <li>서버 URL이 127.0.0.1이면 다른 PC 등록용으로 실패해야 한다.</li>
                    <li>Tailscale/LAN 후보 IP를 고르고 server에서 접근 가능한지 probe한다.</li>
                    <li>같은 명령을 다시 실행해도 중복 device row를 만들지 않는다.</li>
                  </ol>
                  <div class="landing-command-box">
                    <div class="landing-command-box-head">
                      <span>등록 명령</span>
                      <div class="landing-command-actions">
                        <button
                          type="button"
                          class="landing-inline-button"
                          onClick={() => void refetchRegisterCommand()}
                          disabled={!props.authed || registerCommand.loading}
                        >
                          새로고침
                        </button>
                        <button
                          type="button"
                          class="primary-button landing-command-copy"
                          onClick={() => void copyRegisterCommand()}
                          disabled={!props.authed || registerCommand.loading}
                        >
                          {copied() ? "복사됨" : "명령 복사"}
                        </button>
                      </div>
                    </div>
                    <pre>
                      <code>
                        {props.authed
                          ? registerCommand.loading
                            ? "명령 생성 중..."
                            : registerCommand.error
                              ? `명령 생성 실패: ${(registerCommand.error as Error).message}`
                              : registerCommand()?.command
                          : "시작하기로 Site token을 확인하면 다른 PC 등록 명령을 생성할 수 있습니다."}
                      </code>
                    </pre>
                    <Show when={copyError()}>
                      {(message) => <p class="landing-command-error">{message()}</p>}
                    </Show>
                    <Show when={registerCommand()?.preferredUrl}>
                      {(url) => <p class="landing-command-url">server URL: {url()}</p>}
                    </Show>
                  </div>
                </section>
              </Show>

              <Show when={activeStep() === "diagnose"}>
                <WizardPanel
                  title="실패 진단"
                  summary="offline 하나로 뭉개지 않고, 어느 노드에서 실패했는지 분리한다."
                  checks={[
                    "server unreachable: 서버 PC의 18193이 열려 있는지 확인",
                    "local-only bind: connector가 127.0.0.1에만 묶였는지 확인",
                    "firewall blocked: 대상 PC의 TCP 18091 inbound 확인",
                    "Tailscale disconnected: 양쪽 PC가 같은 tailnet인지 확인",
                    "token mismatch: Site token과 daemon token을 분리해서 확인",
                  ]}
                  next="해결 후 같은 등록 명령을 다시 실행한다."
                />
              </Show>
            </div>
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

const StatePill: Component<{
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "wait" | "neutral";
}> = (props) => {
  return (
    <div class={`landing-state-pill landing-state-${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
};

const WizardTab: Component<{
  id: WizardStep;
  title: string;
  status: string;
  active: boolean;
  onSelect: (id: WizardStep) => void;
}> = (props) => (
  <button
    type="button"
    role="tab"
    aria-selected={props.active}
    class={`landing-wizard-tab${props.active ? " active" : ""}`}
    onClick={() => props.onSelect(props.id)}
  >
    <span>{props.title}</span>
    <small>{props.status}</small>
  </button>
);

const WizardPanel: Component<{
  title: string;
  summary: string;
  checks: string[];
  next: string;
}> = (props) => (
  <section class="landing-wizard-panel" aria-label={props.title}>
    <div class="landing-wizard-panel-head">
      <h3>{props.title}</h3>
      <p>{props.summary}</p>
    </div>
    <ol class="landing-check-list">
      <For each={props.checks}>{(check) => <li>{check}</li>}</For>
    </ol>
    <p class="landing-next-step">{props.next}</p>
  </section>
);
