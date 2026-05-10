import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";
import {
  ApiError,
  api,
  clearBaseUrl,
  clearToken,
  type ClaudeInstructionScope,
  type ClaudeInstructionSource,
  type Device,
  type DeviceCleanupEntry,
  getToken,
  setToken,
} from "./api.ts";
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
import { SettingsScopeLabel } from "./components/SettingsScopeLabel.tsx";
import { t } from "./i18n.ts";
import {
  instructionScopeEmptyDescription,
  instructionScopePlaceholder,
} from "./instruction-copy.ts";
import {
  appTheme,
  type AppTheme,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  chatFontSize,
  newChatCwdBrowseMode,
  type NewChatCwdBrowseMode,
  scrollToBottomOnSend,
  setAppTheme,
  setChatFontSize,
  setNewChatCwdBrowseMode,
  setScrollToBottomOnSend,
  setShowCtxUsageMeter,
  setShowSessionUsageMeter,
  setShowWeekUsageMeter,
  showCtxUsageMeter,
  showSessionUsageMeter,
  showWeekUsageMeter,
} from "./ui-prefs.ts";

type SettingsTab = "general" | "devices" | "diagnostics" | "instructions";

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
  const initialToken = consumeSiteTokenFromUrl() ?? getToken();
  const [localToken, setLocalToken] = createSignal<string | null>(initialToken);
  const hasAccess = () => Boolean(localToken());

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

  createEffect(() => {
    const theme = appTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  });

  createEffect(() => {
    document.documentElement.style.setProperty("--chat-font-size", `${chatFontSize()}px`);
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
                class="alpha-banner-back"
                onClick={reopenLanding}
                aria-label={t("app.back-home")}
                title={t("app.back-home")}
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
                  <path d="m15 18-6-6 6-6" />
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
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  <path d="m4.9 4.9 2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
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
                <For each={["general", "devices", "diagnostics", "instructions"] as const}>
                  {(value) => (
                    <button
                      type="button"
                      class={`settings-tab${settingsTab() === value ? " active" : ""}`}
                      onClick={() => setSettingsTab(value)}
                    >
                      {t(`app.settings.tab.${value}`)}
                    </button>
                  )}
                </For>
              </nav>

              <div class="settings-dialog-body">
                <Show when={settingsTab() === "general"}>
                  <LanguageSettings onClearAccess={handleSettingsClearAccess} />
                </Show>
                <Show when={settingsTab() === "devices"}>
                  <DeviceShell
                    initialSelectedDeviceId={settingsDeviceId()}
                    onDevicesChanged={notifyDevicesChanged}
                    onDeviceSelected={activateRegisteredDevice}
                    onManualCleanupRequired={handleManualCleanupRequired}
                  />
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
              </div>
            </div>
          </div>
        </dialog>
      </Show>
    </main>
  );
};

const LanguageSettings: Component<{ onClearAccess: () => void }> = (props) => {
  const [savingAutostart, setSavingAutostart] = createSignal(false);
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

  return (
    <div class="settings-stack">
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
          <div class="settings-segmented" role="radiogroup" aria-label={t("settings.theme.title")}>
            <For each={["light", "dark"] as AppTheme[]}>
              {(value) => (
                <button
                  type="button"
                  class={`settings-segment${appTheme() === value ? " active" : ""}`}
                  role="radio"
                  aria-checked={appTheme() === value ? "true" : "false"}
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
          <div
            class="settings-segmented"
            role="radiogroup"
            aria-label={t("settings.new-chat-cwd-browse.title")}
          >
            <For each={["allowed-roots", "unrestricted"] as NewChatCwdBrowseMode[]}>
              {(value) => (
                <button
                  type="button"
                  class={`settings-segment${newChatCwdBrowseMode() === value ? " active" : ""}`}
                  role="radio"
                  aria-checked={newChatCwdBrowseMode() === value ? "true" : "false"}
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
