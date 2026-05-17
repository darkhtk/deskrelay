import type { ManagerAssistantChatContext } from "@deskrelay/shared";
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  ApiError,
  type ClaudeInstructionScope,
  type ClaudeInstructionSource,
  type DeskRelayBuildInfo,
  type Device,
  type DeviceCleanupEntry,
  type DeviceUpdateQueueEntry,
  type DeviceUpdateResponse,
  type ManagerWorkerCheckResult,
  type ManagerWorkerProfile,
  type SelfServerUpdateStatus,
  api,
  clearBaseUrl,
  clearToken,
  getToken,
  setToken,
} from "./api.ts";
import {
  browserCacheEnabled,
  clearBrowserCacheOnOpen,
  clearDeskRelayBrowserCache,
  clearDeskRelayBrowserCacheOnOpenIfNeeded,
  setBrowserCacheEnabled,
  setClearBrowserCacheOnOpen,
} from "./browser-cache.ts";
import { AnnouncementBanner } from "./components/AnnouncementBanner.tsx";
import {
  ChatView,
  type ContextUsageOverview,
  type ContextUsageSnapshot,
} from "./components/ChatView.tsx";
import { ConnectionDiagnostics } from "./components/ConnectionDiagnostics.tsx";
import { DeviceShell } from "./components/DeviceShell.tsx";
import { Landing } from "./components/Landing.tsx";
import { LegalPage, type LegalPageKind } from "./components/LegalPage.tsx";
import { ManagerAssistant } from "./components/ManagerAssistant.tsx";
import {
  type SettingsScope,
  SettingsScopeLabel,
  SettingsScopeLabels,
} from "./components/SettingsScopeLabel.tsx";
import {
  type ConversationExportSnapshot,
  downloadConversationMarkdown,
  hasConversationExport,
  openConversationPdfPrint,
} from "./conversation-export.ts";
import { deviceDisplayName } from "./device-display.ts";
import { LOCALES, LOCALE_LABELS, locale, setLocale, t } from "./i18n.ts";
import {
  instructionScopeEmptyDescription,
  instructionScopePlaceholder,
} from "./instruction-copy.ts";
import { createManagerEventSubscription } from "./manager-events.ts";
import {
  type AppTheme,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CHAT_TRANSCRIPT_EVENT_LIMIT_MAX,
  CHAT_TRANSCRIPT_EVENT_LIMIT_MIN,
  type NewChatCwdBrowseMode,
  appTheme,
  chatFontSize,
  chatTranscriptEventLimit,
  newChatCwdBrowseMode,
  scrollToBottomOnSend,
  setAppTheme,
  setChatFontSize,
  setChatTranscriptEventLimit,
  setNewChatCwdBrowseMode,
  setScrollToBottomOnSend,
  setShowCtxUsageMeter,
  setShowSessionUsageMeter,
  setShowWeekUsageMeter,
  showCtxUsageMeter,
  showSessionUsageMeter,
  showWeekUsageMeter,
} from "./ui-prefs.ts";

type SettingsTab =
  | "general"
  | "updates"
  | "devices"
  | "assistant"
  | "workers"
  | "diagnostics"
  | "instructions"
  | "help";

const SETTINGS_TABS: SettingsTab[] = [
  "general",
  "updates",
  "devices",
  "assistant",
  "workers",
  "diagnostics",
  "instructions",
  "help",
];

type OpenSettingsOptions = {
  tab?: SettingsTab;
  deviceId?: string | null;
};

type DeviceSelectionRequest = {
  id: string | null;
  seq: number;
};

type ActiveWorkspace = {
  deviceId: string | null;
  cwd: string;
};

type ManualCleanupNotice = {
  count: number;
  labels: string[];
};

const EMPTY_CONTEXT_USAGE: ContextUsageOverview = { ctx: null, session: null, week: null };
const INSTRUCTION_SOURCE_ORDER: Array<ClaudeInstructionSource["scope"]> = ["user", "managed"];
const INSTRUCTION_SOURCE_LABELS: Record<ClaudeInstructionSource["scope"], string> = {
  user: "사용자 전역",
  managed: "관리 정책",
  project: "프로젝트",
  projectClaude: ".claude 프로젝트",
  local: "개인 로컬",
};
const BROWSER_CLIENT_ID_KEY = "cr.browser-client-id";
const LAST_BROWSER_REFRESH_EVENT_KEY = "cr.last-browser-refresh-event";
const BROWSER_PRESENCE_INTERVAL_MS = 15_000;
const BROWSER_REFRESH_EVENT_MAX_AGE_MS = 10_000;

const HELP_SECTIONS: Array<{
  title: string;
  scopes: SettingsScope[];
  open?: boolean;
  items: string[];
}> = [
  {
    title: "브라우저 캐시",
    scopes: ["browser"],
    open: true,
    items: [
      "언어 설정은 이 브라우저에 저장됩니다. 한국어가 기본이며 영어는 설정 > 일반에서 선택할 수 있습니다.",
      "브라우저 캐시는 지금 페이지를 연 기기의 브라우저 저장소에만 남습니다.",
      "대화 표시 캐시, 로컬 이미지 미리보기 캐시, Session/Week/CTX 조회 캐시만 포함합니다.",
      "Site token, daemon token, Claude 계정 토큰 원문은 캐시 삭제/저장 대상에 포함하지 않습니다.",
      "앱을 열 때 캐시 비우기를 켜면 시작 시 이전 대화/이미지 캐시를 지우고 현재 탭에서만 새로 사용합니다.",
      "공용 PC나 분실 위험이 있는 모바일에서는 캐시 사용을 끄거나 매번 비우는 설정을 권장합니다.",
    ],
  },
  {
    title: "대화 내보내기",
    scopes: ["current session", "browser"],
    items: [
      "설정 > 일반에서 현재 브라우저에 로드된 대화를 Markdown 파일로 저장할 수 있습니다.",
      "PDF 저장은 브라우저 인쇄 창을 열어 PDF로 저장하는 방식입니다.",
      "내보내기는 서버에 파일을 만들지 않고 지금 브라우저에서만 처리합니다.",
      "선택한 세션을 바꾸면 내보내기 대상도 해당 세션으로 바뀝니다.",
    ],
  },
  {
    title: "적용 범위",
    scopes: ["server", "current device", "current session", "browser"],
    open: true,
    items: [
      "server: DeskRelay 서버 전체, site token, 등록된 디바이스 목록, 서버 업데이트와 자동 시작에 적용됩니다.",
      "current device: 현재 선택한 PC의 connector, daemon URL, 기본 작업 폴더, CLI 전역 지침에 적용됩니다.",
      "current session: 현재 선택한 Claude 세션과 그 작업 폴더의 권한, 지침, 스킬, transcript에 적용됩니다.",
      "browser: 지금 이 브라우저의 테마, 글자 크기, 표시 옵션, 선택 기억에만 적용됩니다.",
    ],
  },
  {
    title: "구조",
    scopes: ["server", "current device"],
    items: [
      "브라우저는 DeskRelay 서버에 접속합니다.",
      "서버는 site token, 등록된 디바이스 목록, 서버 상태와 업데이트 상태를 관리합니다.",
      "각 디바이스에는 connector daemon이 떠 있어야 하며, Claude Code 실행은 선택된 디바이스에서 일어납니다.",
      "다른 PC를 쓰려면 서버가 Tailscale 또는 LAN으로 그 PC의 connector port에 접근할 수 있어야 합니다.",
    ],
  },
  {
    title: "다른 PC 등록",
    scopes: ["server", "current device"],
    open: true,
    items: [
      "등록 명령에는 서버 URL과 site token이 포함되어야 합니다.",
      "명령은 git에서 설치 스크립트를 내려받고, connector 설치/갱신, 로그인 작업 등록, 서버 등록까지 처리합니다.",
      "등록 후 디바이스 목록에 보이지 않으면 서버 URL, site token, Tailscale/LAN IP, 방화벽, 18091 포트를 확인합니다.",
      "등록 명령 출력의 registration report는 설치/등록 단계별 결과를 요약합니다.",
      "connector verification report는 대상 PC의 %LOCALAPPDATA%\\DeskRelay\\reports\\connector-verify-*.json에 저장됩니다.",
      "이미 설치된 connector가 포트를 점유하면 기존 bun/PowerShell/login task를 종료한 뒤 다시 실행해야 합니다.",
    ],
  },
  {
    title: "설치 검증 리포트",
    scopes: ["current device"],
    open: true,
    items: [
      "Git, Bun, DeskRelay repo, workspace roots, Windows login task, local daemon, advertised daemon, server registry 순서로 확인합니다.",
      "서버는 전체 report를 보관하지만, 사이트에는 사용자가 조치할 수 있는 실패/경고 항목만 표시합니다.",
      "ERROR 행은 실제로 막힌 단계입니다. 같은 행의 action 또는 hint를 먼저 처리합니다.",
      "local daemon은 해당 PC 안에서 127.0.0.1:18091이 응답하는지 확인합니다.",
      "advertised daemon은 서버가 Tailscale/LAN 주소의 18091 포트로 접근 가능한지 확인합니다.",
      "server registry 실패는 서버 URL, site token, 서버 실행 상태를 먼저 확인합니다.",
    ],
  },
  {
    title: "상태와 업데이트",
    scopes: ["server", "current device"],
    items: [
      "연결됨은 서버가 선택한 디바이스의 daemon에 접근 가능하다는 뜻입니다.",
      "오프라인은 서버가 해당 daemon에 접근하지 못한다는 뜻입니다.",
      "Claude command bridge 준비 안 됨은 connector는 살아 있지만 Claude 실행 준비가 끝나지 않은 상태입니다.",
      "업데이트 실행 버튼은 설정 > 업데이트 탭에 모여 있습니다.",
      "전체 업데이트는 등록된 connector를 먼저 갱신한 뒤 서버 PC의 git 저장소를 갱신하고 서버를 재시작합니다.",
      "디바이스별 업데이트 상태는 업데이트 탭에서 확인합니다. 꺼진 디바이스는 실패가 아니라 온라인 대기로 표시합니다.",
      "connector 업데이트는 대상 PC의 Windows 로그인 작업을 다시 실행하도록 요청합니다. 요청 실패는 재시작 필요로 표시합니다.",
      "연결 진단 탭은 상태 확인과 새로고침 중심으로 사용합니다.",
    ],
  },
  {
    title: "작업 폴더와 세션",
    scopes: ["current device", "current session"],
    items: [
      "새 채팅의 기본 작업 폴더는 current device 기준으로 저장됩니다.",
      "작업 폴더 탐색은 기본적으로 허용된 workspace root 안에서만 동작합니다.",
      "세션 목록은 current device 기준으로 로드됩니다.",
      "같은 session id는 하나로 취급하며, 삭제할 때 같은 session id의 파일을 함께 정리합니다.",
      "current session이 없으면 작업 폴더 지침과 세션 context는 조회할 수 없습니다.",
    ],
  },
  {
    title: "지침",
    scopes: ["current device", "current session"],
    items: [
      "설정의 지침 탭은 current device의 사용자 전역 지침과 관리 정책 지침을 다룹니다.",
      "사이드바의 지침 탭은 current session의 작업 폴더 지침을 다룹니다.",
      "사용자 전역 지침은 해당 디바이스 사용자 계정의 ~/.claude/CLAUDE.md입니다.",
      "작업 폴더 지침은 선택한 세션 cwd의 CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md입니다.",
      "관리 정책 지침은 읽기 전용일 수 있으며, 개인 self-host 설치에서는 비어 있을 수 있습니다.",
    ],
  },
  {
    title: "권한과 스킬",
    scopes: ["current device", "current session"],
    items: [
      "권한 탭은 current device의 Claude 설정 파일과 current session 작업 폴더 설정을 함께 보여줍니다.",
      "User settings는 current device 사용자 계정 기준입니다.",
      "Project settings와 Project local settings는 current session 작업 폴더 기준입니다.",
      "스킬 목록은 current device의 Claude 환경과 current session 작업 폴더 기준으로 로드됩니다.",
      "슬래시 명령은 실제 Claude CLI가 지원하는 동작 제약을 따릅니다.",
    ],
  },
  {
    title: "자주 겪는 문제",
    scopes: ["server", "current device", "current session"],
    open: true,
    items: [
      "디바이스가 안 보이면 등록 명령이 서버에 도달했는지 확인합니다.",
      "오프라인이면 해당 PC의 connector daemon, 방화벽, Tailscale/LAN 연결을 확인합니다.",
      "forbidden outside workspace roots가 나오면 current device의 workspace root 설정을 확인합니다.",
      "토큰 입력을 요구하면 등록 명령에 site token이 포함되어 있는지 확인합니다.",
      "서버와 connector 버전이 다르면 업데이트를 실행하거나 등록 명령을 다시 실행합니다.",
    ],
  },
  {
    title: "관리 Assistant",
    scopes: ["server", "current device"],
    open: true,
    items: [
      "AI 버튼 또는 설정 > 관리 Assistant에서 서버 PC의 DeskRelay 폴더에 있는 CLI와 대화합니다.",
      "Assistant는 DeskRelay API와 로컬 명령을 이용해 진단, 업데이트, 복구 방법을 설명하거나 실행을 도울 수 있습니다.",
      "상태를 바꾸는 작업은 사용자가 명시적으로 요청했을 때만 진행해야 합니다.",
      "응답은 서버 PC에서 실행되는 CLI 결과이므로, 서버 PC의 git, bun, Tailscale, connector 상태에 영향을 받습니다.",
    ],
  },
];

function settingsTabLabel(value: SettingsTab): string {
  return t(`app.settings.tab.${value}`);
}

function consumeSiteTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const hash = (window.location.hash ?? "").replace(/^#/, "");
  const hashParams = new URLSearchParams(hash);
  let token = hashParams.get("site-token")?.trim();
  if (!token) {
    try {
      token = new URL(window.location.href).searchParams.get("site-token")?.trim();
    } catch {
      token = undefined;
    }
  }
  if (!token) return null;
  clearBaseUrl();
  setToken(token);
  try {
    const clean = new URL(window.location.href);
    clean.hash = "";
    clean.searchParams.delete("site-token");
    window.history.replaceState(null, "", clean.toString());
  } catch {
    // Keeping the token in storage is the important part; URL cleanup is best effort.
  }
  return token;
}

function browserPresenceClientId(): string {
  if (typeof localStorage === "undefined") return `browser-${Math.random().toString(36).slice(2)}`;
  try {
    const existing = localStorage.getItem(BROWSER_CLIENT_ID_KEY)?.trim();
    if (existing) return existing;
    const random =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `browser-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    localStorage.setItem(BROWSER_CLIENT_ID_KEY, random);
    return random;
  } catch {
    return `browser-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

function shouldHandleBrowserRefreshEvent(event: { id: string; generatedAt: string }): boolean {
  const generatedAt = Date.parse(event.generatedAt);
  if (
    !Number.isFinite(generatedAt) ||
    Date.now() - generatedAt > BROWSER_REFRESH_EVENT_MAX_AGE_MS
  ) {
    return false;
  }
  try {
    if (sessionStorage.getItem(LAST_BROWSER_REFRESH_EVENT_KEY) === event.id) return false;
    sessionStorage.setItem(LAST_BROWSER_REFRESH_EVENT_KEY, event.id);
  } catch {
    // If sessionStorage is unavailable, the event age gate still prevents stale replay loops.
  }
  return true;
}

function nextWeekResetLabel(): string {
  const reset = new Date();
  const day = reset.getDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  reset.setDate(reset.getDate() + daysUntilMonday);
  reset.setHours(0, 0, 0, 0);
  return `${reset.getMonth() + 1}/${reset.getDate()} 00:00`;
}

function resetLabelFromUsage(usage: ContextUsageSnapshot | null, fallback: string): string {
  if (!usage?.resetAt) return fallback;
  const reset = new Date(usage.resetAt);
  if (Number.isNaN(reset.getTime())) return fallback;
  const hours = reset.getHours().toString().padStart(2, "0");
  const minutes = reset.getMinutes().toString().padStart(2, "0");
  return `${reset.getMonth() + 1}/${reset.getDate()} ${hours}:${minutes}`;
}

const ContextUsageBattery: Component<{
  usage: ContextUsageSnapshot | null;
  label: string;
  resetLabel: string;
}> = (props) => {
  const remaining = () => props.usage?.remainingPercent ?? null;
  const known = () => remaining() !== null;
  const level = () => {
    const value = remaining();
    if (value === null) return "unknown";
    if (value >= 70) return "good";
    if (value >= 40) return "warn";
    return "danger";
  };
  const percentText = () => {
    const value = remaining();
    return value === null ? "--%" : `${Math.round(value)}%`;
  };
  const title = () => {
    const value = remaining();
    return value === null
      ? `${props.label} usage unavailable - ${props.resetLabel}`
      : `${props.label} usage remaining ${percentText()} - ${props.resetLabel}`;
  };
  const fillWidth = () => {
    const value = remaining();
    return value === null ? "0%" : `${Math.round(value)}%`;
  };

  return (
    <output
      class={`context-meter context-battery-${level()}`}
      aria-label={title()}
      title={title()}
      data-known={known() ? "true" : "false"}
    >
      <span class="context-meter-main">
        <span class="context-battery">
          <span class="context-battery-label">{props.label}</span>
          <span class="context-battery-shell" aria-hidden="true">
            <span class="context-battery-fill" style={{ width: fillWidth() }} />
          </span>
          <span class="context-battery-value">{percentText()}</span>
        </span>
      </span>
      <span class="context-meter-reset">{props.resetLabel}</span>
    </output>
  );
};

const ContextUsageMeters: Component<{ usage: ContextUsageOverview; visible: boolean }> = (
  props,
) => (
  <Show when={props.visible}>
    <div class="context-meter-group">
      <Show when={showSessionUsageMeter()}>
        <ContextUsageBattery
          usage={props.usage.session}
          label="Session"
          resetLabel={resetLabelFromUsage(props.usage.session, "~5h")}
        />
      </Show>
      <Show when={showWeekUsageMeter()}>
        <ContextUsageBattery
          usage={props.usage.week}
          label="Week"
          resetLabel={resetLabelFromUsage(props.usage.week, nextWeekResetLabel())}
        />
      </Show>
    </div>
  </Show>
);

export const App: Component = () => {
  void clearDeskRelayBrowserCacheOnOpenIfNeeded();
  const initialToken = consumeSiteTokenFromUrl() ?? getToken();
  const [localToken, setLocalToken] = createSignal<string | null>(initialToken);
  const hasAccess = () => Boolean(localToken());
  const browserClientId = browserPresenceClientId();

  const handleTokenLogin = async (value: string) => {
    const previousToken = getToken();
    setToken(value);
    try {
      await api.listDevices();
      setLocalToken(value);
    } catch (err) {
      if (previousToken) setToken(previousToken);
      else clearToken();
      setLocalToken(previousToken);
      if (err instanceof ApiError && err.status === 401) {
        throw new Error(t("login.token.invalid"));
      }
      throw err;
    }
  };

  const handleLocalAccessLogin = async () => {
    const token = await api.localSiteToken();
    if (!token) return false;
    try {
      await handleTokenLogin(token);
      return true;
    } catch {
      return false;
    }
  };

  const handleClearAccess = () => {
    clearToken();
    setLocalToken(null);
    setLandingReopened(true);
    setLandingDismissed(false);
  };

  const handleSettingsClearAccess = () => {
    setSettingsOpen(false);
    handleClearAccess();
  };

  const [pickedLocale, setPickedLocale] = createSignal(true);
  const [landingDismissed, setLandingDismissed] = createSignal(Boolean(initialToken));
  const [landingReopened, setLandingReopened] = createSignal(false);

  const legalPage = (): LegalPageKind | null => {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/privacy" || path === "/privacy.html") return "privacy";
    if (path === "/terms" || path === "/terms.html") return "terms";
    return null;
  };

  const dismissLanding = () => {
    setLandingReopened(false);
    setPickedLocale(true);
    setLandingDismissed(true);
  };

  const reopenLanding = () => {
    setSettingsOpen(false);
    setLandingReopened(true);
    setLandingDismissed(false);
  };

  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsTab, setSettingsTab] = createSignal<SettingsTab>("general");
  const [settingsDeviceId, setSettingsDeviceId] = createSignal<string | null>(null);
  const [devicesRevision, setDevicesRevision] = createSignal(0);
  const [manualCleanupNotice, setManualCleanupNotice] = createSignal<ManualCleanupNotice | null>(
    null,
  );
  const [deviceSelectionRequest, setDeviceSelectionRequest] = createSignal<DeviceSelectionRequest>({
    id: null,
    seq: 0,
  });
  const [contextUsage, setContextUsage] = createSignal<ContextUsageOverview>(EMPTY_CONTEXT_USAGE);
  const [activeWorkspace, setActiveWorkspace] = createSignal<ActiveWorkspace>({
    deviceId: null,
    cwd: "",
  });
  const [conversationExport, setConversationExport] =
    createSignal<ConversationExportSnapshot | null>(null);
  const settingsAssistantContext = createMemo<ManagerAssistantChatContext | null>(() => {
    const workspace = activeWorkspace();
    const deviceId = settingsDeviceId() ?? workspace.deviceId;
    const context: ManagerAssistantChatContext = {};
    if (deviceId) context.deviceId = deviceId;
    if (workspace.cwd) context.cwd = workspace.cwd;
    return Object.keys(context).length > 0 ? context : null;
  });

  createEffect(() => {
    const theme = appTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  });

  createEffect(() => {
    document.documentElement.style.setProperty("--chat-font-size", `${chatFontSize()}px`);
  });

  createEffect(() => {
    if (!hasAccess()) return;
    const announcePresence = () => {
      void api.browserPresence(browserClientId).catch(() => undefined);
    };
    announcePresence();
    const timer = window.setInterval(announcePresence, BROWSER_PRESENCE_INTERVAL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  createManagerEventSubscription({
    enabled: hasAccess,
    onEvent(event) {
      if (event.type !== "browser.refresh") return;
      if (!shouldHandleBrowserRefreshEvent(event)) return;
      void hardRefreshApp();
    },
  });

  const notifyDevicesChanged = () => {
    setDevicesRevision((value) => value + 1);
  };

  const requestDeviceSelection = (id: string | null) => {
    setDeviceSelectionRequest((current) => ({ id, seq: current.seq + 1 }));
  };

  const activateRegisteredDevice = (id: string | null) => {
    requestDeviceSelection(id);
    if (!id) return;
    setLandingReopened(false);
    setLandingDismissed(true);
    setPickedLocale(true);
    setSettingsOpen(false);
  };

  const openSettings = (options: OpenSettingsOptions = {}) => {
    setSettingsTab(options.tab ?? "general");
    setSettingsDeviceId(options.deviceId ?? null);
    setSettingsOpen(true);
  };

  const handleManualCleanupRequired = (devices: DeviceCleanupEntry[]) => {
    const labels = devices
      .map((device) => device.label || device.daemonUrl)
      .filter((label) => label.trim())
      .slice(0, 6);
    setManualCleanupNotice({ count: devices.length, labels });
    setSettingsOpen(false);
    setLandingReopened(true);
    setLandingDismissed(false);
    setPickedLocale(true);
    notifyDevicesChanged();
  };

  const chatReady = () => !landingReopened() && landingDismissed() && hasAccess() && pickedLocale();
  const mainPageChrome = () => !legalPage() && !chatReady();

  return (
    <main id="app-root">
      <div class="alpha-banner" role="note" aria-label="Top bar">
        <div class="alpha-banner-legal">
          <Show when={chatReady()}>
            <>
              <button
                type="button"
                class="alpha-banner-back alpha-banner-sidebar-toggle"
                onClick={() => window.dispatchEvent(new Event("deskrelay:toggle-sidebar"))}
                aria-label={t("chat.toggle-sidebar")}
                title={t("chat.toggle-sidebar")}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="9" y1="4" x2="9" y2="20" />
                </svg>
              </button>
              <button
                type="button"
                class="alpha-banner-back alpha-banner-settings"
                onClick={() =>
                  openSettings({ tab: "general", deviceId: activeWorkspace().deviceId })
                }
                aria-label={t("app.settings.aria")}
                title={t("app.settings.title")}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.73v.52a2 2 0 0 1-1 1.73l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.73v-.52a2 2 0 0 1 1-1.73l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </>
          </Show>
          <Show when={mainPageChrome()}>
            <span class="alpha-banner-legal-text">{t("app.self-host")}</span>
            <span class="alpha-banner-legal-sep">·</span>
            <a class="alpha-banner-legal-link" href="/privacy">
              {t("app.alpha-banner.privacy")}
            </a>
            <span class="alpha-banner-legal-sep">·</span>
            <a class="alpha-banner-legal-link" href="/terms">
              {t("app.alpha-banner.terms")}
            </a>
          </Show>
        </div>
        <AnnouncementBanner />
        <div class="alpha-banner-right">
          <ContextUsageMeters
            usage={contextUsage()}
            visible={chatReady() && (showSessionUsageMeter() || showWeekUsageMeter())}
          />
        </div>
      </div>

      <Show when={legalPage()} keyed>
        {(kind) => <LegalPage kind={kind} />}
      </Show>

      <Show when={!legalPage()}>
        <Show when={landingReopened() || !landingDismissed() || !hasAccess()}>
          <Landing
            onTokenLogin={handleTokenLogin}
            onLocalAccessLogin={handleLocalAccessLogin}
            authed={hasAccess()}
            onProceed={dismissLanding}
            manualCleanupNotice={manualCleanupNotice()}
          />
        </Show>

        <Show when={chatReady()}>
          <ChatView
            onClearAccess={handleClearAccess}
            onOpenSettings={openSettings}
            devicesRevision={devicesRevision()}
            requestedDeviceSelection={deviceSelectionRequest()}
            onContextUsageChange={setContextUsage}
            onActiveWorkspaceChange={setActiveWorkspace}
            onConversationExportChange={setConversationExport}
            showContextUsageMeter={showCtxUsageMeter()}
          />
        </Show>
      </Show>

      <Show when={!legalPage() && settingsOpen()}>
        <dialog
          open
          class="approval-modal-root"
          aria-label={t("app.settings.aria")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSettingsOpen(false);
          }}
        >
          <button
            type="button"
            class="approval-backdrop"
            onClick={() => setSettingsOpen(false)}
            aria-label={t("app.settings.close")}
          />
          <div class="approval-card settings-dialog">
            <div class="approval-header">
              <span class="approval-title">{t("app.settings.title")}</span>
              <button
                type="button"
                class="sidebar-action settings-dialog-close"
                onClick={() => setSettingsOpen(false)}
                aria-label={t("app.dialog.close")}
              >
                x
              </button>
            </div>

            <div class="settings-dialog-shell">
              <nav class="settings-tabs settings-tab-rail">
                <For each={SETTINGS_TABS}>
                  {(value) => (
                    <button
                      type="button"
                      class={`settings-tab${settingsTab() === value ? " active" : ""}`}
                      onClick={() => setSettingsTab(value)}
                    >
                      {settingsTabLabel(value)}
                    </button>
                  )}
                </For>
              </nav>

              <div class="settings-dialog-body">
                <Show when={settingsTab() === "general"}>
                  <GeneralSettings
                    onClearAccess={handleSettingsClearAccess}
                    onOpenLanding={reopenLanding}
                    initialSelectedDeviceId={settingsDeviceId() ?? activeWorkspace().deviceId}
                    selectedDeviceId={settingsDeviceId() ?? activeWorkspace().deviceId}
                    onSelectDevice={(deviceId) => {
                      requestDeviceSelection(deviceId);
                      setSettingsDeviceId(deviceId);
                    }}
                    onOpenDevices={(deviceId) => {
                      setSettingsDeviceId(deviceId ?? activeWorkspace().deviceId);
                      setSettingsTab("devices");
                    }}
                    devicesRevision={devicesRevision()}
                    conversationExport={conversationExport()}
                  />
                </Show>
                <Show when={settingsTab() === "updates"}>
                  <GeneralSettings
                    section="updates"
                    onClearAccess={handleSettingsClearAccess}
                    initialSelectedDeviceId={settingsDeviceId() ?? activeWorkspace().deviceId}
                    devicesRevision={devicesRevision()}
                  />
                </Show>
                <Show when={settingsTab() === "devices"}>
                  <DeviceShell
                    initialSelectedDeviceId={settingsDeviceId()}
                    onDevicesChanged={notifyDevicesChanged}
                    onDeviceSelected={activateRegisteredDevice}
                    onManualCleanupRequired={handleManualCleanupRequired}
                  />
                </Show>
                <Show when={settingsTab() === "assistant"}>
                  <ManagerAssistant context={settingsAssistantContext()} />
                </Show>
                <Show when={settingsTab() === "workers"}>
                  <ManagerWorkersSettings />
                </Show>
                <Show when={settingsTab() === "diagnostics"}>
                  <ConnectionDiagnostics
                    initialSelectedDeviceId={settingsDeviceId()}
                    devicesRevision={devicesRevision()}
                    onOpenDevices={(deviceId) => {
                      setSettingsDeviceId(deviceId);
                      setSettingsTab("devices");
                    }}
                  />
                </Show>
                <Show when={settingsTab() === "instructions"}>
                  <InstructionSettings
                    initialDeviceId={settingsDeviceId() ?? activeWorkspace().deviceId}
                    devicesRevision={devicesRevision()}
                  />
                </Show>
                <Show when={settingsTab() === "help"}>
                  <HelpSettings />
                </Show>
              </div>
            </div>
          </div>
        </dialog>
      </Show>
    </main>
  );
};

const HelpSettings: Component = () => (
  <section class="settings-card settings-help">
    <div class="settings-section-heading">
      <div>
        <h3 class="settings-card-title">도움말</h3>
        <p class="settings-card-help">
          설정이 어디에 적용되는지와 설치/연결 문제를 확인하는 기준입니다.
        </p>
      </div>
      <SettingsScopeLabels scopes={["server", "current device", "current session", "browser"]} />
    </div>

    <div class="settings-help-list">
      <For each={HELP_SECTIONS}>
        {(section) => (
          <details class="settings-help-section" open={section.open}>
            <summary>
              <span>{section.title}</span>
              <SettingsScopeLabels scopes={section.scopes} />
            </summary>
            <ul>
              <For each={section.items}>{(item) => <li>{item}</li>}</For>
            </ul>
          </details>
        )}
      </For>
    </div>
  </section>
);

interface WorkerCheckUiState {
  phase: UpdatePhase;
  message: string;
  result?: ManagerWorkerCheckResult;
}

const ManagerWorkersSettings: Component = () => {
  const [workers, { refetch }] = createResource(() => api.managerWorkers());
  const [checks, setChecks] = createSignal<Record<string, WorkerCheckUiState>>({});
  const [running, setRunning] = createSignal<string | null>(null);

  const setWorkerState = (id: string, state: WorkerCheckUiState) => {
    setChecks((current) => ({ ...current, [id]: state }));
  };

  async function checkWorker(profile: ManagerWorkerProfile) {
    setWorkerState(profile.id, {
      phase: "running",
      message: t("manager.worker-settings.check.running"),
    });
    try {
      const result = await api.checkManagerWorker(profile.id);
      setWorkerState(profile.id, {
        phase: result.available ? "succeeded" : "failed",
        message: workerCheckMessage(result),
        result,
      });
    } catch (err) {
      setWorkerState(profile.id, {
        phase: "failed",
        message: t("manager.worker-settings.check.failed", { error: (err as Error).message }),
      });
    }
  }

  async function dryRunWorker(profile: ManagerWorkerProfile) {
    setRunning(profile.id);
    setWorkerState(profile.id, {
      phase: "running",
      message: t("manager.worker-settings.dry-run.running"),
    });
    try {
      const task = await api.runManagerWorker({
        profile: profile.id,
        prompt:
          "Dry-run only. Verify that this worker profile can be planned. Do not edit files or run destructive commands.",
        dryRun: true,
        requestedBy: "browser",
      });
      setWorkerState(profile.id, {
        phase: task.state === "succeeded" ? "succeeded" : "failed",
        message:
          task.state === "succeeded"
            ? t("manager.worker-settings.dry-run.succeeded")
            : task.error
              ? t("manager.worker-settings.dry-run.failed", { error: task.error })
              : t("manager.worker-settings.dry-run.state", { state: task.state }),
      });
    } catch (err) {
      setWorkerState(profile.id, {
        phase: "failed",
        message: t("manager.worker-settings.dry-run.failed", { error: (err as Error).message }),
      });
    } finally {
      setRunning(null);
    }
  }

  return (
    <section class="settings-card settings-worker-section">
      <div class="settings-card-heading">
        <h3 class="settings-card-title">{t("manager.worker-settings.title")}</h3>
        <SettingsScopeLabel scope="server" />
      </div>
      <p class="settings-card-help">{t("manager.worker-settings.help")}</p>

      <div class="settings-worker-actions">
        <button type="button" class="secondary-button" onClick={() => void refetch()}>
          {t("manager.worker-settings.refresh")}
        </button>
      </div>

      <div class="settings-worker-list">
        <Show
          when={!workers.loading}
          fallback={<p class="settings-card-help">{t("manager.worker-settings.loading")}</p>}
        >
          <For each={workers()?.profiles ?? []}>
            {(profile) => {
              const check = () => checks()[profile.id];
              const phase = () =>
                check()?.phase ?? (profile.available ? "idle" : ("failed" as UpdatePhase));
              return (
                <div class="settings-worker-row">
                  <div class="settings-worker-main">
                    <span class={`settings-update-dot update-phase-${phase()}`} />
                    <div class="settings-worker-copy">
                      <div class="settings-worker-title-row">
                        <span class="settings-update-label">{workerProfileLabel(profile)}</span>
                        <span class={`settings-worker-risk worker-risk-${profile.risk}`}>
                          {workerRiskText(profile)}
                        </span>
                      </div>
                      <span class="settings-update-detail">
                        {workerProfileDescription(profile)}
                      </span>
                      <span class="settings-worker-command">
                        {profile.command} {profile.args.join(" ")}
                      </span>
                      <Show when={profile.roles.length > 0}>
                        <span class="settings-worker-roles">
                          {profile.roles.map(workerRoleText).join(" - ")}
                        </span>
                      </Show>
                      <Show when={check()?.message}>
                        {(message) => <span class="settings-update-detail">{message()}</span>}
                      </Show>
                    </div>
                  </div>
                  <div class="settings-worker-buttons">
                    <button
                      type="button"
                      class="secondary-button"
                      disabled={!profile.available || check()?.phase === "running"}
                      onClick={() => void checkWorker(profile)}
                    >
                      {check()?.phase === "running"
                        ? t("manager.worker-settings.working")
                        : t("manager.worker-settings.status-check")}
                    </button>
                    <button
                      type="button"
                      class="secondary-button"
                      disabled={!profile.available || running() !== null}
                      onClick={() => void dryRunWorker(profile)}
                    >
                      {running() === profile.id
                        ? t("manager.worker-settings.working")
                        : t("manager.worker-settings.plan-check")}
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={(workers()?.profiles ?? []).length === 0}>
            <p class="settings-card-help">{t("manager.worker-settings.empty")}</p>
          </Show>
        </Show>
      </div>
    </section>
  );
};
type UpdatePhase =
  | "idle"
  | "queued"
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "restart_required";

interface UpdateRunState {
  phase: UpdatePhase;
  message: string;
  fallbackCommand?: string;
  recoveryKind?: DeviceUpdateResponse["recoveryKind"];
  retryable?: boolean;
  expectedBranch?: string;
  actualBranch?: string;
  error?: string;
}

interface DeviceBuildSnapshot {
  deviceId: string;
  build?: DeskRelayBuildInfo;
  error?: string;
}

const GeneralSettings: Component<{
  onClearAccess: () => void;
  onOpenLanding?: () => void;
  initialSelectedDeviceId?: string | null;
  selectedDeviceId?: string | null;
  onSelectDevice?: (deviceId: string | null) => void;
  onOpenDevices?: (deviceId?: string | null) => void;
  devicesRevision?: number;
  section?: "general" | "updates";
  conversationExport?: ConversationExportSnapshot | null;
}> = (props) => {
  const [savingAutostart, setSavingAutostart] = createSignal(false);
  const [browserCacheStatus, setBrowserCacheStatus] = createSignal<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [conversationExportStatus, setConversationExportStatus] = createSignal<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [autostart, { mutate: setAutostart }] = createResource(async () => {
    try {
      return await api.selfServerAutostart();
    } catch (err) {
      return {
        supported: false,
        installed: false,
        taskName: "DeskRelay Self Server",
        error: (err as Error).message,
      };
    }
  });
  const autostartStatusText = () => {
    if (savingAutostart()) return t("settings.autostart.saving");
    const current = autostart();
    if (!current) return t("settings.autostart.loading");
    return current.installed ? t("settings.autostart.enabled") : t("settings.autostart.disabled");
  };
  const setServerAutostart = async (enabled: boolean) => {
    setSavingAutostart(true);
    try {
      setAutostart(await api.setSelfServerAutostart(enabled));
    } catch (err) {
      setAutostart({
        supported: false,
        installed: autostart()?.installed ?? false,
        taskName: autostart()?.taskName ?? "DeskRelay Self Server",
        error: (err as Error).message,
      });
    } finally {
      setSavingAutostart(false);
    }
  };
  const handleClearBrowserCache = async () => {
    setBrowserCacheStatus(null);
    try {
      const result = await clearDeskRelayBrowserCache();
      setBrowserCacheStatus({
        kind: "success",
        message: `브라우저 캐시를 삭제했습니다. 삭제 항목: ${
          result.localStorageEntries + result.cacheStorageEntries
        }`,
      });
    } catch (err) {
      setBrowserCacheStatus({
        kind: "error",
        message: `브라우저 캐시 삭제 실패: ${(err as Error).message}`,
      });
    }
  };
  const currentConversationExport = () => props.conversationExport ?? null;
  const conversationExportReady = () => hasConversationExport(currentConversationExport());
  const handleMarkdownExport = () => {
    const snapshot = currentConversationExport();
    setConversationExportStatus(null);
    if (!snapshot || !hasConversationExport(snapshot)) {
      setConversationExportStatus({
        kind: "error",
        message: "내보낼 대화가 없습니다. 세션을 선택하거나 메시지를 보낸 뒤 다시 시도하세요.",
      });
      return;
    }
    try {
      const filename = downloadConversationMarkdown(snapshot);
      setConversationExportStatus({
        kind: "success",
        message: `Markdown 파일을 만들었습니다: ${filename}`,
      });
    } catch (err) {
      setConversationExportStatus({
        kind: "error",
        message: `Markdown 내보내기 실패: ${(err as Error).message}`,
      });
    }
  };
  const handlePdfExport = () => {
    const snapshot = currentConversationExport();
    setConversationExportStatus(null);
    if (!snapshot || !hasConversationExport(snapshot)) {
      setConversationExportStatus({
        kind: "error",
        message: "내보낼 대화가 없습니다. 세션을 선택하거나 메시지를 보낸 뒤 다시 시도하세요.",
      });
      return;
    }
    try {
      const opened = openConversationPdfPrint(snapshot);
      setConversationExportStatus(
        opened
          ? {
              kind: "success",
              message: "인쇄 창이 열렸습니다. 브라우저 인쇄 대화상자에서 PDF로 저장하세요.",
            }
          : {
              kind: "error",
              message: "PDF 인쇄 창을 열지 못했습니다. 브라우저 팝업 차단 설정을 확인하세요.",
            },
      );
    } catch (err) {
      setConversationExportStatus({
        kind: "error",
        message: `PDF 내보내기 실패: ${(err as Error).message}`,
      });
    }
  };
  const [overallUpdate, setOverallUpdate] = createSignal<UpdateRunState>({
    phase: "idle",
    message: "업데이트 실행 전",
  });
  const [deviceUpdateStates, setDeviceUpdateStates] = createSignal<Record<string, UpdateRunState>>(
    {},
  );
  const [updating, setUpdating] = createSignal<"all" | "server" | string | null>(null);
  const [serverUpdateBaseline, setServerUpdateBaseline] = createSignal<string | null>(null);
  const [lastUpdateDeviceFailures, setLastUpdateDeviceFailures] = createSignal(0);
  const [lastUpdateDeviceRestarts, setLastUpdateDeviceRestarts] = createSignal(0);
  const [lastUpdateDevicePending, setLastUpdateDevicePending] = createSignal(0);
  const [devices, { refetch: refetchDevices }] = createResource(
    () => props.devicesRevision ?? 0,
    async () => {
      try {
        return await api.listDevices();
      } catch {
        return [] as Device[];
      }
    },
  );
  const [health, { refetch: refetchHealth }] = createResource(
    () => props.devicesRevision ?? 0,
    () => api.health().catch(() => null),
  );
  const [serverUpdateStatus, { refetch: refetchServerUpdateStatus }] = createResource(
    () => props.devicesRevision ?? 0,
    () => api.selfUpdateStatus().catch(() => null),
  );
  const [deviceUpdateQueue, { refetch: refetchDeviceUpdateQueue }] = createResource(
    () => props.devicesRevision ?? 0,
    () => api.deviceUpdateQueue().catch(() => ({ entries: [] as DeviceUpdateQueueEntry[] })),
  );
  const [deviceBuildSnapshots, { refetch: refetchDeviceBuildSnapshots }] = createResource(
    () => {
      const list = devices();
      if (!list) return null;
      return {
        revision: props.devicesRevision ?? 0,
        devices: list.map((device) => ({
          id: device.id,
          connectionState: device.connectionState,
        })),
      };
    },
    async (source) => {
      if (!source) return [] as DeviceBuildSnapshot[];
      const rows = await Promise.all(
        source.devices.map(async (device) => {
          if (device.connectionState === "offline") {
            return { deviceId: device.id, error: "offline" };
          }
          try {
            const snapshot = await api.deviceInstallStatus(device.id);
            return {
              deviceId: device.id,
              build: snapshot.build,
            };
          } catch (err) {
            return { deviceId: device.id, error: (err as Error).message };
          }
        }),
      );
      return rows;
    },
  );

  function refreshUpdateState(): void {
    void refetchDevices();
    void refetchHealth();
    void refetchServerUpdateStatus();
    void refetchDeviceUpdateQueue();
    void refetchDeviceBuildSnapshots();
  }

  async function updateServer(): Promise<void> {
    setUpdating("server");
    setLastUpdateDeviceFailures(0);
    setLastUpdateDeviceRestarts(0);
    setLastUpdateDevicePending(0);
    setServerUpdateBaseline(serverUpdateStatus()?.startedAt ?? null);
    setOverallUpdate({ phase: "running", message: "서버 업데이트 시작 요청 중" });
    try {
      const result = await api.selfUpdate();
      setOverallUpdate({
        phase: result.started ? "running" : "failed",
        message: result.started
          ? `서버 업데이트 진행 중${result.logPath ? ` · 로그: ${result.logPath}` : ""}`
          : `서버 업데이트 시작 실패: ${result.error ?? "알 수 없는 오류"}`,
      });
      void refetchServerUpdateStatus();
      setTimeout(refreshUpdateState, 6000);
    } catch (err) {
      setOverallUpdate({
        phase: "failed",
        message: `서버 업데이트 실패: ${(err as Error).message}`,
      });
    } finally {
      setUpdating(null);
    }
  }

  async function updateConnector(device: Device): Promise<UpdateRunState> {
    setUpdating(device.id);
    setDeviceUpdateState(device.id, {
      phase: "running",
      message: `${deviceDisplayName(device)} connector 업데이트 중`,
    });
    try {
      const result = await api.updateDevice(device.id);
      const state = {
        phase: connectorUpdatePhase(result),
        message: connectorUpdateMessage(result),
        ...(result.fallbackCommand ? { fallbackCommand: result.fallbackCommand } : {}),
        ...(result.recoveryKind ? { recoveryKind: result.recoveryKind } : {}),
        ...(typeof result.retryable === "boolean" ? { retryable: result.retryable } : {}),
        ...(result.expectedBranch ? { expectedBranch: result.expectedBranch } : {}),
        ...(result.actualBranch ? { actualBranch: result.actualBranch } : {}),
        ...(result.error ? { error: result.error } : {}),
      } satisfies UpdateRunState;
      setDeviceUpdateState(device.id, state);
      void refetchDeviceUpdateQueue();
      setTimeout(refreshUpdateState, result.restartScheduled ? 5000 : 2000);
      return state;
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as DeviceUpdateResponse | undefined) : null;
      const state = {
        phase: body ? connectorUpdatePhase(body) : "failed",
        message: body
          ? connectorUpdateMessage(body)
          : `connector 업데이트 실패: ${(err as Error).message}`,
        ...(body?.fallbackCommand ? { fallbackCommand: body.fallbackCommand } : {}),
        ...(body?.recoveryKind ? { recoveryKind: body.recoveryKind } : {}),
        ...(typeof body?.retryable === "boolean" ? { retryable: body.retryable } : {}),
        ...(body?.expectedBranch ? { expectedBranch: body.expectedBranch } : {}),
        ...(body?.actualBranch ? { actualBranch: body.actualBranch } : {}),
        ...(body?.error ? { error: body.error } : {}),
      } satisfies UpdateRunState;
      setDeviceUpdateState(device.id, state);
      void refetchDeviceUpdateQueue();
      return state;
    } finally {
      setUpdating(null);
    }
  }

  function setDeviceUpdateState(deviceId: string, state: UpdateRunState): void {
    setDeviceUpdateStates((current) => ({ ...current, [deviceId]: state }));
  }

  async function updateAll(): Promise<void> {
    const list = devices() ?? [];
    const connectorTargets = list.filter((device) =>
      connectorNeedsUpdate(
        device,
        deviceBuildSnapshot(device.id),
        deviceUpdateQueueEntry(device.id),
      ),
    );
    const shouldUpdateServer = canUpdateServer();
    if (!shouldUpdateServer && connectorTargets.length === 0) {
      setOverallUpdate({ phase: "idle", message: "업데이트 대상 없음" });
      return;
    }
    setUpdating("all");
    setLastUpdateDeviceFailures(0);
    setLastUpdateDeviceRestarts(0);
    setLastUpdateDevicePending(0);
    setOverallUpdate({ phase: "running", message: "전체 업데이트 진행 중" });
    setDeviceUpdateStates(
      Object.fromEntries(
        connectorTargets.map((device) => [
          device.id,
          {
            phase: "queued",
            message: "대기 중",
          } satisfies UpdateRunState,
        ]),
      ),
    );

    let failures = 0;
    let restartRequired = 0;
    let pending = 0;
    for (const device of connectorTargets) {
      const result = await updateConnector(device);
      if (result?.phase === "failed") failures += 1;
      if (result?.phase === "restart_required") restartRequired += 1;
      if (result?.phase === "pending") pending += 1;
    }
    setLastUpdateDeviceFailures(failures);
    setLastUpdateDeviceRestarts(restartRequired);
    setLastUpdateDevicePending(pending);

    if (!shouldUpdateServer) {
      setOverallUpdate({
        phase:
          failures > 0
            ? "failed"
            : restartRequired > 0
              ? "restart_required"
              : pending > 0
                ? "pending"
                : "succeeded",
        message:
          failures > 0
            ? `connector 업데이트 실패 ${failures}건`
            : restartRequired > 0
              ? `connector 업데이트 완료 · 재시작 필요 ${restartRequired}건`
              : "connector 업데이트 완료",
      });
      if (pending > 0 && failures === 0 && restartRequired === 0) {
        setOverallUpdate({ phase: "pending", message: `connector 업데이트 대기 ${pending}건` });
      }
      setUpdating(null);
      return;
    }

    setOverallUpdate({
      phase: "running",
      message:
        connectorTargets.length === 0
          ? "서버 업데이트 요청 중"
          : failures > 0
            ? `connector 업데이트 실패 ${failures}건 · 서버 업데이트 요청 중`
            : restartRequired > 0
              ? `connector 재시작 필요 ${restartRequired}건 · 서버 업데이트 요청 중`
              : "connector 업데이트 완료 · 서버 업데이트 요청 중",
    });
    setUpdating("all");
    setServerUpdateBaseline(serverUpdateStatus()?.startedAt ?? null);
    try {
      const result = await api.selfUpdate();
      setOverallUpdate({
        phase: result.started ? "running" : "failed",
        message: result.started
          ? failures > 0
            ? `일부 디바이스 실패 · 서버 업데이트 진행 중${result.logPath ? ` · 로그: ${result.logPath}` : ""}`
            : `전체 업데이트 진행 중${result.logPath ? ` · 로그: ${result.logPath}` : ""}`
          : `서버 업데이트 시작 실패: ${result.error ?? "알 수 없는 오류"}`,
      });
      void refetchServerUpdateStatus();
      setTimeout(refreshUpdateState, 6000);
    } catch (err) {
      setOverallUpdate({
        phase: "failed",
        message: `서버 업데이트 실패: ${(err as Error).message}`,
      });
    } finally {
      setUpdating(null);
    }
  }

  const activeDeviceUpdates = createMemo(() =>
    (deviceUpdateQueue()?.entries ?? []).some(
      (entry) => entry.state === "pending_until_device_online" || entry.state === "running",
    ),
  );

  createEffect(() => {
    const current = overallUpdate();
    const status = serverUpdateStatus();
    if (current.phase !== "running") return;
    if (!isTrackedServerUpdateStatus(status, serverUpdateBaseline())) return;
    if (status?.state === "succeeded") {
      const failures = lastUpdateDeviceFailures();
      const restartRequired = lastUpdateDeviceRestarts();
      const pending = lastUpdateDevicePending();
      setOverallUpdate({
        phase:
          failures > 0
            ? "failed"
            : restartRequired > 0
              ? "restart_required"
              : pending > 0
                ? "pending"
                : "succeeded",
        message:
          failures > 0
            ? `${updateStatusText(status)} · 디바이스 업데이트 실패 ${failures}건`
            : restartRequired > 0
              ? `${updateStatusText(status)} · connector 재시작 필요 ${restartRequired}건`
              : updateStatusText(status),
      });
      if (pending > 0 && failures === 0 && restartRequired === 0) {
        setOverallUpdate({
          phase: "pending",
          message: `${updateStatusText(status)} · connector 업데이트 대기 ${pending}건`,
        });
      }
    }
    if (status?.state === "failed") {
      setOverallUpdate({ phase: "failed", message: updateStatusText(status) });
    }
  });

  createEffect(() => {
    const status = serverUpdateStatus();
    const shouldPoll =
      overallUpdate().phase === "running" ||
      activeDeviceUpdates() ||
      (isTrackedServerUpdateStatus(status, serverUpdateBaseline()) && status?.state === "running");
    if (!shouldPoll) return;
    const timer = window.setInterval(refreshUpdateState, 2500);
    onCleanup(() => window.clearInterval(timer));
  });

  const deviceBuildSnapshot = (deviceId: string): DeviceBuildSnapshot | null =>
    (deviceBuildSnapshots() ?? []).find((snapshot) => snapshot.deviceId === deviceId) ?? null;

  const deviceUpdateQueueEntry = (deviceId: string): DeviceUpdateQueueEntry | null =>
    (deviceUpdateQueue()?.entries ?? []).find((entry) => entry.deviceId === deviceId) ?? null;

  const selectedSettingsDeviceId = createMemo(() => {
    const requested = props.selectedDeviceId ?? props.initialSelectedDeviceId ?? "";
    const list = devices() ?? [];
    if (requested && list.some((device) => device.id === requested)) return requested;
    return "";
  });

  const selectedSettingsDevice = createMemo(() => {
    const id = selectedSettingsDeviceId();
    return (devices() ?? []).find((device) => device.id === id) ?? null;
  });

  const selectedSettingsDeviceSummary = () => {
    const device = selectedSettingsDevice();
    if (!device) return "선택된 디바이스 없음";
    const state = device.connectionState === "offline" ? "오프라인" : "연결됨";
    return `${deviceDisplayName(device)} · ${state} · ${device.daemonUrl}`;
  };

  const serverUpdateIsRunning = () => serverUpdateStatus()?.state === "running";

  const canUpdateServer = () =>
    updating() === null &&
    !serverUpdateStatus.loading &&
    serverUpdateStatus()?.updateAvailable === true &&
    !serverUpdateIsRunning();

  const connectorNeedsUpdate = (
    device: Device,
    snapshot: DeviceBuildSnapshot | null,
    queueEntry: DeviceUpdateQueueEntry | null,
  ): boolean => {
    if (isActiveDeviceUpdateQueue(queueEntry)) return false;
    if (connectorRequiresManualRegistration(queueEntry)) return false;
    if (device.connectionState === "offline" || snapshot?.error) return Boolean(health()?.build);
    return sameBuild(health()?.build, snapshot?.build) === false;
  };

  const canUpdateConnector = (device: Device, snapshot: DeviceBuildSnapshot | null): boolean =>
    updating() === null &&
    !deviceBuildSnapshots.loading &&
    !deviceUpdateQueue.loading &&
    connectorNeedsUpdate(device, snapshot, deviceUpdateQueueEntry(device.id));

  const canUpdateAnyConnector = createMemo(() =>
    (devices() ?? []).some((device) =>
      connectorNeedsUpdate(
        device,
        deviceBuildSnapshot(device.id),
        deviceUpdateQueueEntry(device.id),
      ),
    ),
  );

  const canUpdateAll = () =>
    updating() === null &&
    !serverUpdateStatus.loading &&
    !deviceBuildSnapshots.loading &&
    !deviceUpdateQueue.loading &&
    !serverUpdateIsRunning() &&
    (canUpdateServer() || canUpdateAnyConnector());

  const overallPhase = () =>
    isTrackedServerUpdateStatus(serverUpdateStatus(), serverUpdateBaseline()) &&
    serverUpdateStatus()?.state === "running"
      ? "running"
      : overallUpdate().phase;

  const overallMessage = () =>
    isTrackedServerUpdateStatus(serverUpdateStatus(), serverUpdateBaseline()) &&
    serverUpdateStatus()?.state === "running"
      ? updateStatusText(serverUpdateStatus())
      : overallUpdate().message;

  const updateSection = () => (
    <section class="settings-card settings-update-section">
      <div class="settings-card-heading">
        <h3 class="settings-card-title">업데이트</h3>
        <SettingsScopeLabels scopes={["server", "current device"]} />
      </div>
      <p class="settings-card-help">
        서버와 등록된 connector를 git 기준으로 갱신합니다. 실행 상태와 디바이스별 결과를 여기에서
        확인합니다.
      </p>

      <div class={`settings-update-overall update-phase-${overallPhase()}`}>
        <div class="settings-update-overall-copy">
          <strong>전체 업데이트</strong>
          <span>{overallMessage()}</span>
        </div>
        <button
          type="button"
          class="primary-button"
          disabled={!canUpdateAll()}
          onClick={() => void updateAll()}
        >
          {overallPhase() === "running"
            ? "진행 중"
            : canUpdateAll()
              ? "전체 업데이트"
              : "업데이트 없음"}
        </button>
      </div>

      <div class="settings-update-target-grid">
        <section class="settings-update-target settings-update-server-target">
          <div class="settings-update-target-head">
            <span>서버</span>
            <SettingsScopeLabel scope="server" />
          </div>

          <div class="settings-update-row">
            <div class="settings-update-row-main">
              <span
                class={`settings-update-dot update-phase-${updateStatusPhase(serverUpdateStatus())}`}
              />
              <span class="settings-update-label">서버</span>
              <span class="settings-update-detail">{updateStatusText(serverUpdateStatus())}</span>
            </div>
            <button
              type="button"
              class="secondary-button"
              disabled={!canUpdateServer()}
              onClick={() => void updateServer()}
            >
              {updating() === "server" || serverUpdateStatus()?.state === "running"
                ? "진행 중"
                : canUpdateServer()
                  ? "서버 업데이트"
                  : "최신"}
            </button>
          </div>
        </section>

        <section class="settings-update-target settings-update-devices-target">
          <div class="settings-update-target-head">
            <span>디바이스</span>
            <SettingsScopeLabel scope="current device" />
          </div>

          <div class="settings-update-device-list" aria-label="디바이스별 업데이트 상태">
            <For each={devices() ?? []}>
              {(device) => {
                const state = () => deviceUpdateStates()[device.id] ?? null;
                const snapshot = () => deviceBuildSnapshot(device.id);
                const queueEntry = () => deviceUpdateQueueEntry(device.id);
                const fallbackCommand = () => deviceUpdateFallbackCommand(state(), queueEntry());
                const phase = () =>
                  deviceUpdatePhase(device, health()?.build, snapshot(), state(), queueEntry());
                return (
                  <div class="settings-update-device">
                    <div class="settings-update-row">
                      <div class="settings-update-row-main">
                        <span class={`settings-update-dot update-phase-${phase()}`} />
                        <span class="settings-update-label">{deviceDisplayName(device)}</span>
                        <span class="settings-update-detail">
                          {deviceUpdateStatusText(
                            device,
                            health()?.build,
                            snapshot(),
                            state(),
                            queueEntry(),
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="secondary-button"
                        disabled={!canUpdateConnector(device, snapshot())}
                        onClick={() => void updateConnector(device)}
                      >
                        {updating() === device.id
                          ? "진행 중"
                          : canUpdateConnector(device, snapshot())
                            ? "connector 업데이트"
                            : phase() === "pending"
                              ? "대기"
                              : phase() === "restart_required"
                                ? "재시작 필요"
                                : connectorRequiresManualRegistration(state() ?? queueEntry())
                                  ? "명령 필요"
                                  : phase() === "failed"
                                    ? "조치 필요"
                                    : deviceBuildSnapshots.loading || !snapshot()
                                      ? "확인 중"
                                      : phase() === "queued"
                                        ? "업데이트 가능"
                                        : "최신"}
                      </button>
                    </div>
                    <Show when={fallbackCommand()}>
                      {(command) => (
                        <textarea
                          class="settings-command-textarea"
                          readOnly
                          spellcheck={false}
                          value={command()}
                        />
                      )}
                    </Show>
                  </div>
                );
              }}
            </For>
            <Show when={!devices.loading && (devices() ?? []).length === 0}>
              <p class="settings-card-help">등록된 디바이스가 없습니다.</p>
            </Show>
          </div>
        </section>
      </div>
    </section>
  );

  if (props.section === "updates") {
    return <div class="settings-stack">{updateSection()}</div>;
  }

  return (
    <div class="settings-stack">
      <section class="settings-card">
        <div class="settings-card-heading">
          <h3 class="settings-card-title">디바이스 선택</h3>
          <SettingsScopeLabel scope="browser" />
        </div>
        <p class="settings-card-help">
          이 브라우저에서 사용할 디바이스를 선택합니다. 세션, 권한, 스킬, 지침은 선택한 디바이스
          기준으로 갱신됩니다.
        </p>
        <div class="settings-row">
          <select
            class="text-input"
            value={selectedSettingsDeviceId()}
            disabled={devices.loading || (devices() ?? []).length === 0}
            onChange={(event) => props.onSelectDevice?.(event.currentTarget.value || null)}
          >
            <Show
              when={(devices() ?? []).length > 0}
              fallback={<option value="">등록된 디바이스 없음</option>}
            >
              <For each={devices() ?? []}>
                {(device) => (
                  <option value={device.id}>
                    {device.connectionState === "offline"
                      ? `${deviceDisplayName(device)} (오프라인)`
                      : deviceDisplayName(device)}
                  </option>
                )}
              </For>
            </Show>
          </select>
          <button
            type="button"
            class="secondary-button"
            onClick={() => props.onOpenDevices?.(selectedSettingsDeviceId() || null)}
          >
            디바이스 관리
          </button>
        </div>
        <p class="settings-card-help">{selectedSettingsDeviceSummary()}</p>
      </section>

      <section class="settings-card">
        <div class="settings-card-heading">
          <h3 class="settings-card-title">{t("settings.theme.title")}</h3>
          <SettingsScopeLabel scope="browser" />
        </div>
        <div class="settings-toggle-row">
          <div class="settings-toggle-copy">
            <span class="settings-toggle-title">{t("settings.theme.title")}</span>
            <span class="settings-toggle-help">{t("settings.theme.help")}</span>
          </div>
          <div class="settings-segmented" aria-label={t("settings.theme.title")}>
            <For each={["light", "dark"] as AppTheme[]}>
              {(value) => (
                <button
                  type="button"
                  class={`settings-segment${appTheme() === value ? " active" : ""}`}
                  aria-pressed={appTheme() === value ? "true" : "false"}
                  onClick={() => setAppTheme(value)}
                >
                  {t(`settings.theme.${value}`)}
                </button>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-heading">
          <h3 class="settings-card-title">브라우저 캐시</h3>
          <SettingsScopeLabel scope="browser" />
        </div>
        <p class="settings-card-help">
          현재 브라우저에만 남는 임시 캐시입니다. 서버, connector, 다른 디바이스에는 저장되지
          않습니다.
        </p>
        <label class="settings-check-row">
          <input
            type="checkbox"
            checked={browserCacheEnabled()}
            onChange={(event) => setBrowserCacheEnabled(event.currentTarget.checked)}
          />
          <span class="settings-check-copy">
            <span>브라우저 캐시 사용</span>
            <span class="settings-check-help">
              대화 표시, 이미지 미리보기, 사용량 조회 결과를 이 브라우저에 임시 저장합니다.
            </span>
          </span>
        </label>
        <label class="settings-check-row">
          <input
            type="checkbox"
            checked={clearBrowserCacheOnOpen()}
            onChange={(event) => setClearBrowserCacheOnOpen(event.currentTarget.checked)}
          />
          <span class="settings-check-copy">
            <span>앱을 열 때 캐시 비우기</span>
            <span class="settings-check-help">
              DeskRelay를 열 때 이전 대화/이미지 캐시를 지우고 새로 시작합니다.
            </span>
          </span>
        </label>
        <div class="settings-row">
          <button
            type="button"
            class="secondary-button danger"
            onClick={() => void handleClearBrowserCache()}
          >
            브라우저 캐시 전체 삭제
          </button>
        </div>
        <Show when={browserCacheStatus()}>
          {(status) => (
            <p class={status().kind === "error" ? "settings-error" : "settings-success"}>
              {status().message}
            </p>
          )}
        </Show>
      </section>

      <section class="settings-card">
        <div class="settings-card-heading">
          <h3 class="settings-card-title">대화 내보내기</h3>
          <SettingsScopeLabels scopes={["current session", "browser"]} />
        </div>
        <p class="settings-card-help">
          현재 브라우저에 로드된 대화를 파일로 저장합니다. 서버에는 내보내기 파일을 만들지 않습니다.
        </p>
        <div class="settings-row">
          <button
            type="button"
            class="secondary-button"
            disabled={!conversationExportReady()}
            onClick={handleMarkdownExport}
          >
            Markdown 저장
          </button>
          <button
            type="button"
            class="secondary-button"
            disabled={!conversationExportReady()}
            onClick={handlePdfExport}
          >
            PDF로 저장
          </button>
        </div>
        <Show when={conversationExportStatus()}>
          {(status) => (
            <p class={status().kind === "error" ? "settings-error" : "settings-success"}>
              {status().message}
            </p>
          )}
        </Show>
      </section>

      <section class="settings-card">
        <div class="settings-card-heading">
          <h3 class="settings-card-title">{t("settings.autostart.title")}</h3>
          <SettingsScopeLabel scope="server" />
        </div>
        <label class="settings-check-row">
          <input
            type="checkbox"
            checked={autostart()?.installed ?? false}
            disabled={savingAutostart() || autostart.loading || autostart()?.supported === false}
            onChange={(event) => void setServerAutostart(event.currentTarget.checked)}
          />
          <span class="settings-check-copy">
            <span>{t("settings.autostart.server")}</span>
            <span class="settings-check-help">
              {t("settings.autostart.help", { status: autostartStatusText() })}
            </span>
          </span>
        </label>
        <Show when={autostart()?.error}>
          {(message) => <p class="settings-error">{message()}</p>}
        </Show>
      </section>

      <section class="settings-card">
        <div class="settings-card-heading">
          <h3 class="settings-card-title">{t("lang.settings.title")}</h3>
          <SettingsScopeLabel scope="browser" />
        </div>
        <div class="settings-toggle-row">
          <div class="settings-toggle-copy">
            <span class="settings-toggle-title">{t("settings.language.title")}</span>
            <span class="settings-toggle-help">{t("settings.language.help")}</span>
          </div>
          <div class="settings-segmented" aria-label={t("settings.language.title")}>
            <For each={LOCALES}>
              {(value) => (
                <button
                  type="button"
                  class={`settings-segment${locale() === value ? " active" : ""}`}
                  aria-pressed={locale() === value ? "true" : "false"}
                  onClick={() => setLocale(value)}
                  title={LOCALE_LABELS[value]}
                >
                  {t(`settings.language.${value}`)}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="settings-slider-row">
          <div class="settings-toggle-copy">
            <span class="settings-toggle-title">{t("settings.chat-font-size.title")}</span>
            <span class="settings-toggle-help">{t("settings.chat-font-size.help")}</span>
          </div>
          <label class="settings-slider-control">
            <input
              type="range"
              min={CHAT_FONT_SIZE_MIN}
              max={CHAT_FONT_SIZE_MAX}
              step="1"
              value={chatFontSize()}
              aria-label={t("settings.chat-font-size.title")}
              onInput={(event) => setChatFontSize(Number(event.currentTarget.value))}
            />
            <span class="settings-slider-value">
              {t("settings.chat-font-size.value", { size: chatFontSize() })}
            </span>
          </label>
        </div>
        <p class="settings-chat-font-preview">{t("settings.chat-font-size.preview")}</p>
        <div class="settings-slider-row">
          <div class="settings-toggle-copy">
            <span class="settings-toggle-title">{t("settings.transcript-event-limit.title")}</span>
            <span class="settings-toggle-help">{t("settings.transcript-event-limit.help")}</span>
          </div>
          <label class="settings-slider-control">
            <input
              type="range"
              min={CHAT_TRANSCRIPT_EVENT_LIMIT_MIN}
              max={CHAT_TRANSCRIPT_EVENT_LIMIT_MAX}
              step="50"
              value={chatTranscriptEventLimit()}
              aria-label={t("settings.transcript-event-limit.title")}
              onInput={(event) => setChatTranscriptEventLimit(Number(event.currentTarget.value))}
            />
            <span class="settings-slider-value">
              {t("settings.transcript-event-limit.value", { count: chatTranscriptEventLimit() })}
            </span>
          </label>
        </div>
        <label class="settings-check-row">
          <input
            type="checkbox"
            checked={scrollToBottomOnSend()}
            onChange={(event) => setScrollToBottomOnSend(event.currentTarget.checked)}
          />
          {t("lang.settings.scroll-on-send")}
        </label>
        <label class="settings-check-row">
          <input
            type="checkbox"
            checked={showCtxUsageMeter()}
            onChange={(event) => setShowCtxUsageMeter(event.currentTarget.checked)}
          />
          {t("settings.usage.show-ctx")}
        </label>
        <label class="settings-check-row">
          <input
            type="checkbox"
            checked={showSessionUsageMeter()}
            onChange={(event) => setShowSessionUsageMeter(event.currentTarget.checked)}
          />
          {t("settings.usage.show-session")}
        </label>
        <label class="settings-check-row">
          <input
            type="checkbox"
            checked={showWeekUsageMeter()}
            onChange={(event) => setShowWeekUsageMeter(event.currentTarget.checked)}
          />
          {t("settings.usage.show-week")}
        </label>
        <div class="settings-toggle-row">
          <div class="settings-toggle-copy">
            <span class="settings-toggle-title">{t("settings.new-chat-cwd-browse.title")}</span>
            <span class="settings-toggle-help">{t("settings.new-chat-cwd-browse.help")}</span>
          </div>
          <div class="settings-segmented" aria-label={t("settings.new-chat-cwd-browse.title")}>
            <For each={["allowed-roots", "unrestricted"] as NewChatCwdBrowseMode[]}>
              {(value) => (
                <button
                  type="button"
                  class={`settings-segment${newChatCwdBrowseMode() === value ? " active" : ""}`}
                  aria-pressed={newChatCwdBrowseMode() === value ? "true" : "false"}
                  onClick={() => setNewChatCwdBrowseMode(value)}
                >
                  {t(`settings.new-chat-cwd-browse.${value}`)}
                </button>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="settings-card settings-danger-section">
        <div class="settings-card-heading">
          <h3 class="settings-card-title">{t("app.settings.tab.general")}</h3>
          <SettingsScopeLabel scope="browser" />
        </div>
        <div class="settings-row">
          <Show when={props.onOpenLanding}>
            {(onOpenLanding) => (
              <button type="button" class="secondary-button" onClick={onOpenLanding()}>
                {t("app.back-home")}
              </button>
            )}
          </Show>
          <button type="button" class="secondary-button" onClick={() => void hardRefreshApp()}>
            {t("app.hard-refresh")}
          </button>
          <button type="button" class="secondary-button danger" onClick={props.onClearAccess}>
            {t("app.clear-access")}
          </button>
        </div>
      </section>
    </div>
  );
};

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
    return `server ${serverLabel} · connector ${connectorLabel} · 불일치`;
  }
  return `server ${serverLabel} · connector ${connectorLabel} · 확인 필요`;
}

function buildLabel(build: DeskRelayBuildInfo | undefined): string {
  if (!build) return "unknown";
  const dirty = build.dirty ? "+dirty" : "";
  return `${build.shortCommit || build.version || "unknown"}${dirty}`;
}

type ConnectorRecoveryCarrier = {
  recoveryKind?: DeviceUpdateResponse["recoveryKind"];
  retryable?: boolean;
  fallbackCommand?: string;
  error?: string;
  expectedBranch?: string;
  actualBranch?: string;
};

function connectorRequiresManualRegistration(
  value: ConnectorRecoveryCarrier | null | undefined,
): boolean {
  if (!value) return false;
  if (value.recoveryKind === "branch_mismatch" || value.recoveryKind === "registration_required") {
    return true;
  }
  const error = value.error?.toLowerCase() ?? "";
  return (
    error.includes("re-run the registration command") ||
    error.includes("registration command") ||
    error.includes("branch switch required")
  );
}

function connectorManualRecoveryMessage(
  value: ConnectorRecoveryCarrier | null | undefined,
): string | null {
  if (!connectorRequiresManualRegistration(value)) return null;
  if (value?.recoveryKind === "branch_mismatch") {
    const branch =
      value.actualBranch && value.expectedBranch
        ? ` · 현재 ${value.actualBranch}, 필요 ${value.expectedBranch}`
        : "";
    return `connector 브랜치 재등록 필요${branch}: 해당 PC에서 등록 명령을 실행하세요.`;
  }
  return "connector 재등록 필요: 해당 PC에서 등록 명령을 실행하세요.";
}

function deviceUpdateFallbackCommand(
  runState: UpdateRunState | null,
  queueEntry: DeviceUpdateQueueEntry | null,
): string | undefined {
  return runState?.fallbackCommand ?? queueEntry?.fallbackCommand;
}

function connectorUpdateMessage(result: DeviceUpdateResponse): string {
  const manualRecovery = connectorManualRecoveryMessage(result);
  if (manualRecovery) return manualRecovery;
  if (result.state === "pending_until_device_online") {
    return result.warning ?? "대기 중 · 디바이스가 온라인이 되면 자동 업데이트";
  }
  if (result.error) return `connector 업데이트 실패: ${result.error}`;
  const before = result.before?.shortCommit;
  const after = result.after?.shortCommit;
  const range = before && after ? ` · ${before} → ${after}` : "";
  if (result.restartRequestError) {
    return `connector 업데이트 완료 · 재시작 필요: ${result.restartRequestError}${range}`;
  }
  if (result.state === "restart_required") {
    return result.warning ?? `connector 업데이트 완료 · 재시작 필요${range}`;
  }
  if (result.restartScheduled) {
    return result.changed
      ? `connector 업데이트 완료, 재시작 요청됨${range}`
      : `connector가 이미 최신 상태, 재시작 요청됨${range}`;
  }
  return result.warning ?? `connector 업데이트 완료${range}`;
}

function workerCheckMessage(result: ManagerWorkerCheckResult): string {
  if (result.available) {
    const version = result.stdout.trim().split(/\r?\n/).find(Boolean);
    return version
      ? t("manager.worker-settings.check.available-version", { version })
      : t("manager.worker-settings.check.available");
  }
  if (result.timedOut) return t("manager.worker-settings.check.unavailable-timeout");
  if (result.error) {
    return t("manager.worker-settings.check.unavailable-detail", { detail: result.error });
  }
  const stderr = result.stderr.trim().split(/\r?\n/).find(Boolean);
  return stderr
    ? t("manager.worker-settings.check.unavailable-detail", { detail: stderr })
    : t("manager.worker-settings.check.unavailable-exit", {
        code: result.exitCode ?? t("manager.worker-settings.check.unknown"),
      });
}

function workerRiskText(profile: ManagerWorkerProfile): string {
  if (profile.risk === "system") return t("manager.worker-settings.risk.system");
  if (profile.risk === "destructive") return t("manager.worker-settings.risk.destructive");
  if (profile.risk === "write") return t("manager.worker-settings.risk.write");
  return t("manager.worker-settings.risk.read");
}

function workerProfileLabel(profile: ManagerWorkerProfile): string {
  const key = `manager.worker-settings.profile.${profile.id}.label`;
  const localized = t(key);
  return localized === key ? profile.label : localized;
}

function workerProfileDescription(profile: ManagerWorkerProfile): string {
  const key = `manager.worker-settings.profile.${profile.id}.description`;
  const localized = t(key);
  return localized === key ? profile.description : localized;
}

function workerRoleText(role: string): string {
  const key = `manager.worker-settings.role.${role}`;
  const localized = t(key);
  return localized === key ? role : localized;
}

function connectorUpdatePhase(result: DeviceUpdateResponse): UpdatePhase {
  if (result.error || result.state === "failed") return "failed";
  if (result.state === "pending_until_device_online") return "pending";
  if (result.state === "restart_required" || result.restartRequestError) return "restart_required";
  return "succeeded";
}

function updateStatusPhase(status: SelfServerUpdateStatus | null | undefined): UpdatePhase {
  if (!status) return "idle";
  if (status.state === "running") return "running";
  if (status.state === "failed") return "failed";
  if (status.updateAvailable) return "queued";
  if (status.updateAvailable === false) return "succeeded";
  if (status.state === "idle") return "idle";
  if (status.state === "succeeded") return "succeeded";
  return "failed";
}

function updateStatusText(status: SelfServerUpdateStatus | null | undefined): string {
  if (!status) return "서버 업데이트 상태 확인 중";
  const updateRange =
    status.localCommit && status.remoteCommit
      ? ` · ${shortCommit(status.localCommit)} → ${shortCommit(status.remoteCommit)}`
      : "";
  const range = status.before && status.after ? ` · ${status.before} → ${status.after}` : "";
  if (status.state === "running") return `서버 업데이트 진행 중${range}`;
  if (status.state === "failed") {
    return `서버 업데이트 실패${status.error ? ` · ${status.error}` : ""}${range}`;
  }
  if (status.updateAvailable === true) {
    return `서버 업데이트 가능${updateRange}`;
  }
  if (status.updateAvailable === false) {
    return `서버 최신 상태${status.localCommit ? ` · 현재 ${shortCommit(status.localCommit)}` : ""}`;
  }
  if (status.state === "idle") return "서버 업데이트 기록 없음";
  if (status.state === "succeeded") {
    const changed =
      status.changed === true ? "변경 적용" : status.changed === false ? "이미 최신" : "완료";
    return `서버 업데이트 완료 · ${changed}${range}`;
  }
  return "서버 업데이트 상태 확인 필요";
}

function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

function isTrackedServerUpdateStatus(
  status: SelfServerUpdateStatus | null | undefined,
  baseline: string | null,
): boolean {
  if (!status?.startedAt) return false;
  return status.startedAt !== baseline;
}

function deviceUpdatePhase(
  device: Device,
  server: DeskRelayBuildInfo | undefined,
  snapshot: DeviceBuildSnapshot | null,
  runState: UpdateRunState | null,
  queueEntry: DeviceUpdateQueueEntry | null,
): UpdatePhase {
  if (runState) return runState.phase;
  if (shouldUseDeviceUpdateQueue(queueEntry, server, snapshot)) {
    return deviceUpdateQueuePhase(queueEntry);
  }
  if (device.connectionState === "offline") return "pending";
  if (snapshot?.error) return "failed";
  const same = sameBuild(server, snapshot?.build);
  if (same === true) return "succeeded";
  if (same === false) return "queued";
  return "idle";
}

function deviceUpdateStatusText(
  device: Device,
  server: DeskRelayBuildInfo | undefined,
  snapshot: DeviceBuildSnapshot | null,
  runState: UpdateRunState | null,
  queueEntry: DeviceUpdateQueueEntry | null,
): string {
  if (runState) return runState.message;
  if (shouldUseDeviceUpdateQueue(queueEntry, server, snapshot)) {
    return deviceUpdateQueueStatusText(queueEntry);
  }
  if (device.connectionState === "offline") return "오프라인: 온라인 상태가 되면 업데이트 가능";
  if (!snapshot) return "connector 상태 확인 중";
  if (snapshot?.error) return `상태 확인 실패: ${snapshot.error}`;
  return buildDetail(server, snapshot?.build);
}

function isActiveDeviceUpdateQueue(entry: DeviceUpdateQueueEntry | null): boolean {
  return entry?.state === "pending_until_device_online" || entry?.state === "running";
}

function shouldUseDeviceUpdateQueue(
  entry: DeviceUpdateQueueEntry | null,
  server: DeskRelayBuildInfo | undefined,
  snapshot: DeviceBuildSnapshot | null,
): entry is DeviceUpdateQueueEntry {
  if (!entry) return false;
  if (entry.state === "pending_until_device_online" || entry.state === "running") return true;
  if (entry.state === "failed" || entry.state === "restart_required") return true;
  if (entry.state === "succeeded")
    return !snapshot?.error && sameBuild(server, snapshot?.build) !== false;
  return false;
}

function deviceUpdateQueuePhase(entry: DeviceUpdateQueueEntry): UpdatePhase {
  if (entry.state === "pending_until_device_online" || entry.state === "queued") return "pending";
  if (entry.state === "running") return "running";
  if (entry.state === "failed") return "failed";
  if (entry.state === "restart_required" || entry.restartRequestError) return "restart_required";
  if (entry.state === "succeeded") return "succeeded";
  return "idle";
}

function deviceUpdateQueueStatusText(entry: DeviceUpdateQueueEntry): string {
  const manualRecovery = connectorManualRecoveryMessage(entry);
  if (manualRecovery) return manualRecovery;
  const range =
    entry.before?.shortCommit && entry.after?.shortCommit
      ? ` · ${entry.before.shortCommit} -> ${entry.after.shortCommit}`
      : "";
  if (entry.state === "pending_until_device_online") {
    return entry.error
      ? `대기 중 · 디바이스가 온라인이 되면 자동 업데이트 (${entry.error})`
      : "대기 중 · 디바이스가 온라인이 되면 자동 업데이트";
  }
  if (entry.state === "queued") return "대기 중";
  if (entry.state === "running") return "connector 업데이트 진행 중";
  if (entry.state === "restart_required") {
    return entry.restartRequestError
      ? `재시작 필요 · ${entry.restartRequestError}${range}`
      : `재시작 필요${range}`;
  }
  if (entry.state === "failed") {
    return `connector 업데이트 실패${entry.error ? ` · ${entry.error}` : ""}`;
  }
  if (entry.state === "succeeded") {
    return entry.changed === false ? `최신 상태 확인됨${range}` : `connector 업데이트 완료${range}`;
  }
  return "업데이트 상태 없음";
}

const InstructionSettings: Component<{
  initialDeviceId: string | null;
  devicesRevision: number;
}> = (props) => {
  const [selectedDeviceId, setSelectedDeviceId] = createSignal(props.initialDeviceId);

  const [devices] = createResource(
    () => props.devicesRevision,
    async () => {
      try {
        return await api.listDevices();
      } catch {
        return [] as Device[];
      }
    },
  );

  createEffect(() => {
    const id = props.initialDeviceId;
    if (id) setSelectedDeviceId(id);
  });

  const effectiveDeviceId = createMemo(() => {
    const picked = selectedDeviceId();
    if (picked) return picked;
    return devices()?.[0]?.id ?? null;
  });

  const instructionInput = createMemo(() => {
    const deviceId = effectiveDeviceId();
    if (!deviceId) return null;
    return { deviceId, cwd: "" };
  });

  const [snapshot, { refetch: refetchInstructions, mutate: mutateInstructions }] = createResource(
    instructionInput,
    async (input) => {
      if (!input) return null;
      try {
        return await api.instructions(input.deviceId, input.cwd);
      } catch (err) {
        return {
          cwd: input.cwd || null,
          sources: [],
          error: formatInstructionLoadError(err),
        };
      }
    },
  );

  const selectedDevice = createMemo(() => {
    const id = effectiveDeviceId();
    return (devices() ?? []).find((device) => device.id === id) ?? null;
  });
  const instructionSources = createMemo(() =>
    completeInstructionSources(snapshot()?.sources ?? [], ""),
  );
  const deviceInstructionSources = createMemo(() =>
    instructionSources().filter((source) => source.scope === "user" || source.scope === "managed"),
  );
  const [deviceInstructionDrafts, setDeviceInstructionDrafts] = createSignal<
    Record<string, string>
  >({});
  const [savingDeviceInstructionScope, setSavingDeviceInstructionScope] =
    createSignal<ClaudeInstructionScope | null>(null);
  const [deviceInstructionEditStatus, setDeviceInstructionEditStatus] = createSignal<{
    scope: ClaudeInstructionScope;
    kind: "success" | "error";
    message: string;
  } | null>(null);

  createEffect(() => {
    const result = snapshot();
    if (!result || result.error) return;
    const next: Record<string, string> = {};
    for (const source of deviceInstructionSources()) {
      next[source.scope] = source.content;
    }
    setDeviceInstructionDrafts(next);
  });

  const deviceInstructionDraft = (source: ClaudeInstructionSource): string =>
    deviceInstructionDrafts()[source.scope] ?? source.content;
  const deviceInstructionDirty = (source: ClaudeInstructionSource): boolean =>
    !sameInstructionContent(deviceInstructionDraft(source), source.content);
  const setDeviceInstructionDraft = (source: ClaudeInstructionSource, content: string) => {
    setDeviceInstructionEditStatus(null);
    setDeviceInstructionDrafts((current) => ({ ...current, [source.scope]: content }));
  };
  const resetDeviceInstructionDraft = (source: ClaudeInstructionSource) => {
    setDeviceInstructionEditStatus(null);
    setDeviceInstructionDraft(source, source.content);
  };
  const saveDeviceInstructionSource = async (source: ClaudeInstructionSource) => {
    const deviceId = effectiveDeviceId();
    if (!deviceId || source.readonly) return;
    setSavingDeviceInstructionScope(source.scope);
    setDeviceInstructionEditStatus(null);
    try {
      const updated = await api.writeInstruction(deviceId, source.scope, {
        content: deviceInstructionDraft(source),
        ...instructionExpectedHash(source),
      });
      mutateInstructions((current) => updateDeviceInstructionSnapshot(current, updated));
      await refetchInstructions();
      setDeviceInstructionEditStatus({
        scope: source.scope,
        kind: "success",
        message: t("instructions.status.saved"),
      });
    } catch (err) {
      setDeviceInstructionEditStatus({
        scope: source.scope,
        kind: "error",
        message: formatInstructionLoadError(err),
      });
    } finally {
      setSavingDeviceInstructionScope(null);
    }
  };
  const deleteDeviceInstructionSource = async (source: ClaudeInstructionSource) => {
    const deviceId = effectiveDeviceId();
    if (!deviceId || source.readonly || !source.exists) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("chat.sidebar.instructions.delete.confirm", { label: source.label }))
    ) {
      return;
    }
    setSavingDeviceInstructionScope(source.scope);
    setDeviceInstructionEditStatus(null);
    try {
      const updated = await api.deleteInstruction(deviceId, source.scope, {
        ...instructionExpectedHash(source),
      });
      mutateInstructions((current) => updateDeviceInstructionSnapshot(current, updated));
      setDeviceInstructionDraft(updated, updated.content);
      await refetchInstructions();
      setDeviceInstructionEditStatus({
        scope: source.scope,
        kind: "success",
        message: t("instructions.status.deleted"),
      });
    } catch (err) {
      setDeviceInstructionEditStatus({
        scope: source.scope,
        kind: "error",
        message: formatInstructionLoadError(err),
      });
    } finally {
      setSavingDeviceInstructionScope(null);
    }
  };

  return (
    <section class="settings-card instruction-settings">
      <div class="settings-section-heading">
        <div>
          <h3 class="settings-card-title">{t("instructions.title")}</h3>
        </div>
        <SettingsScopeLabel scope="current device" />
      </div>

      <div class="settings-row instruction-context-row">
        <select
          class="text-input"
          value={effectiveDeviceId() ?? ""}
          onChange={(event) => setSelectedDeviceId(event.currentTarget.value || null)}
        >
          <Show
            when={(devices() ?? []).length > 0}
            fallback={<option value="">{t("instructions.device.empty")}</option>}
          >
            <For each={devices() ?? []}>
              {(device) => <option value={device.id}>{device.label}</option>}
            </For>
          </Show>
        </select>
        <button type="button" class="secondary-button" onClick={() => void refetchInstructions()}>
          {t("instructions.reload")}
        </button>
      </div>
      <Show when={selectedDevice()}>
        {(device) => (
          <p class="settings-card-help">
            {t("instructions.device.meta", { label: device().label })}
          </p>
        )}
      </Show>

      <Show
        when={effectiveDeviceId()}
        fallback={<p class="settings-card-help">{t("instructions.no-device")}</p>}
      >
        <Show
          when={!snapshot.loading}
          fallback={<p class="settings-card-help">{t("instructions.loading")}</p>}
        >
          <Show when={(snapshot() as { error?: string } | null)?.error}>
            {(message) => (
              <p class="settings-error">{t("instructions.load.failed", { error: message() })}</p>
            )}
          </Show>
          <InstructionSourceGroup
            sources={deviceInstructionSources()}
            editable
            draft={deviceInstructionDraft}
            dirty={deviceInstructionDirty}
            savingScope={savingDeviceInstructionScope()}
            status={deviceInstructionEditStatus()}
            onInput={setDeviceInstructionDraft}
            onReset={resetDeviceInstructionDraft}
            onSave={(source) => void saveDeviceInstructionSource(source)}
            onDelete={(source) => void deleteDeviceInstructionSource(source)}
          />
        </Show>
      </Show>
    </section>
  );
};

const InstructionSourceGroup: Component<{
  title?: string;
  help?: string;
  sources: ClaudeInstructionSource[];
  editable?: boolean;
  draft?: (source: ClaudeInstructionSource) => string;
  dirty?: (source: ClaudeInstructionSource) => boolean;
  savingScope?: ClaudeInstructionScope | null;
  status?: { scope: ClaudeInstructionScope; kind: "success" | "error"; message: string } | null;
  onInput?: (source: ClaudeInstructionSource, value: string) => void;
  onReset?: (source: ClaudeInstructionSource) => void;
  onSave?: (source: ClaudeInstructionSource) => void;
  onDelete?: (source: ClaudeInstructionSource) => void;
}> = (props) => (
  <div class="instruction-source-group">
    <Show when={props.title || props.help}>
      <div>
        <Show when={props.title}>
          <div class="instruction-field-label">{props.title}</div>
        </Show>
        <Show when={props.help}>
          <div class="instruction-field-help">{props.help}</div>
        </Show>
      </div>
    </Show>
    <For each={props.sources}>
      {(source) => (
        <Show
          when={props.editable && !source.readonly}
          fallback={<InstructionSourceViewer source={source} />}
        >
          <InstructionSourceEditor
            source={source}
            value={props.draft?.(source) ?? source.content}
            dirty={props.dirty?.(source) ?? false}
            saving={props.savingScope === source.scope}
            status={props.status?.scope === source.scope ? props.status : null}
            onInput={(value) => props.onInput?.(source, value)}
            onReset={() => props.onReset?.(source)}
            onSave={() => props.onSave?.(source)}
            onDelete={() => props.onDelete?.(source)}
          />
        </Show>
      )}
    </For>
  </div>
);

const InstructionSourceEditor: Component<{
  source: ClaudeInstructionSource;
  value: string;
  dirty: boolean;
  saving: boolean;
  status: { kind: "success" | "error"; message: string } | null;
  onInput: (value: string) => void;
  onReset: () => void;
  onSave: () => void;
  onDelete: () => void;
}> = (props) => (
  <div class="instruction-source">
    <div class="instruction-source-header">
      <div>
        <div class="instruction-field-label">{props.source.label}</div>
        <div class="instruction-field-help">{props.source.path || t("instructions.path.none")}</div>
      </div>
      <span class="instruction-source-state">
        {props.source.exists ? t("instructions.source.exists") : t("instructions.source.missing")}
      </span>
    </div>
    <Show when={props.source.error}>{(message) => <p class="settings-error">{message()}</p>}</Show>
    <textarea
      class="instruction-textarea instruction-source-textarea"
      value={props.value}
      placeholder={instructionScopePlaceholder(props.source.scope)}
      disabled={props.saving || Boolean(props.source.error)}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
    <Show when={props.status}>
      {(status) => (
        <p class={status().kind === "error" ? "settings-error" : "settings-success"}>
          {status().message}
        </p>
      )}
    </Show>
    <div class="settings-row instruction-actions">
      <Show when={props.source.exists}>
        <button
          type="button"
          class="secondary-button danger"
          onClick={props.onDelete}
          disabled={props.saving || Boolean(props.source.error)}
        >
          {props.saving ? t("instructions.status.saving") : t("chat.sidebar.instructions.delete")}
        </button>
      </Show>
      <Show when={props.dirty}>
        <button
          type="button"
          class="secondary-button"
          onClick={props.onReset}
          disabled={props.saving || Boolean(props.source.error)}
        >
          {t("chat.sidebar.instructions.revert")}
        </button>
        <button
          type="button"
          class="primary-button"
          onClick={props.onSave}
          disabled={props.saving || Boolean(props.source.error)}
        >
          {props.saving ? t("instructions.status.saving") : t("instructions.save")}
        </button>
      </Show>
    </div>
  </div>
);

const InstructionSourceViewer: Component<{
  source: ClaudeInstructionSource;
}> = (props) => {
  const sourceState = () => {
    if (props.source.error === "cwd is not selected") {
      return t("instructions.source.cwd-required");
    }
    if (props.source.error) return props.source.error;
    if (!props.source.exists) return t("instructions.source.missing");
    if (props.source.readonly) return t("instructions.source.readonly");
    return t("instructions.source.exists");
  };
  const sourceBody = () => {
    if (props.source.content.trim()) return props.source.content;
    if (props.source.error === "cwd is not selected") {
      return t("instructions.content.cwd-required");
    }
    if (props.source.error) {
      return t("instructions.content.error", { error: props.source.error });
    }
    if (!props.source.exists) return instructionScopeEmptyDescription(props.source.scope);
    return t("instructions.content.empty");
  };

  return (
    <div class="instruction-source">
      <div class="instruction-source-header">
        <div>
          <div class="instruction-field-label">{props.source.label}</div>
          <div class="instruction-field-help">
            {props.source.path || t("instructions.path.none")}
          </div>
        </div>
        <span class="instruction-source-state">{sourceState()}</span>
      </div>
      <pre
        class="instruction-content"
        classList={{ "instruction-content-empty": !props.source.content.trim() }}
      >
        {sourceBody()}
      </pre>
    </div>
  );
};

function completeInstructionSources(
  sources: ClaudeInstructionSource[],
  cwd: string,
): ClaudeInstructionSource[] {
  const byScope = new Map(sources.map((source) => [source.scope, source]));
  return INSTRUCTION_SOURCE_ORDER.map(
    (scope) => byScope.get(scope) ?? fallbackInstructionSource(scope, cwd),
  );
}

function sameInstructionContent(a: string, b: string): boolean {
  return a === b;
}

function instructionExpectedHash(source: ClaudeInstructionSource): { expectedHash?: string } {
  if (!source.exists) return { expectedHash: "missing" };
  return source.hash ? { expectedHash: source.hash } : {};
}

function updateDeviceInstructionSnapshot(
  current:
    | { cwd: string | null; sources: ClaudeInstructionSource[]; error?: string }
    | null
    | undefined,
  updated: ClaudeInstructionSource,
): { cwd: string | null; sources: ClaudeInstructionSource[] } {
  const cwd = current?.cwd ?? null;
  const sources = completeInstructionSources(current?.sources ?? [], cwd ?? "").map((source) =>
    source.scope === updated.scope ? updated : source,
  );
  return { cwd, sources };
}

function formatInstructionLoadError(err: unknown): string {
  const message = (err as Error).message || String(err);
  const normalized = message.toLowerCase();
  if (
    normalized === "not found" ||
    normalized.includes("http 404") ||
    normalized.includes("404 not found")
  ) {
    return `${message} - 실행 중인 DeskRelay 서버 또는 선택한 디바이스 connector가 지침 API를 지원하지 않는 오래된 코드입니다. 서버와 connector를 최신 코드로 재시작하세요.`;
  }
  return message;
}

function fallbackInstructionSource(
  scope: ClaudeInstructionSource["scope"],
  cwd: string,
): ClaudeInstructionSource {
  const source: ClaudeInstructionSource = {
    scope,
    label: INSTRUCTION_SOURCE_LABELS[scope],
    path: fallbackInstructionPath(scope, cwd),
    readonly: scope === "managed",
    exists: false,
    content: "",
  };
  if (scope === "project" || scope === "projectClaude" || scope === "local") {
    source.error = "cwd is not selected";
  }
  return source;
}

function fallbackInstructionPath(scope: ClaudeInstructionSource["scope"], cwd: string): string {
  if (scope === "user") return "~/.claude/CLAUDE.md";
  if (scope === "managed") return t("instructions.path.managed");
  if (!cwd) return "";
  if (scope === "project") return joinDisplayPath(cwd, "CLAUDE.md");
  if (scope === "projectClaude") return joinDisplayPath(cwd, ".claude", "CLAUDE.md");
  return joinDisplayPath(cwd, "CLAUDE.local.md");
}

function joinDisplayPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(sep);
}

async function hardRefreshApp(): Promise<void> {
  await clearDeskRelayBrowserCache();
  try {
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch {
    // Cache API can be blocked in private modes.
  }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    // Ignore browser support and permission failures.
  }

  const url = new URL(window.location.href);
  url.searchParams.set("reload", String(Date.now()));
  window.location.replace(url.toString());
}
