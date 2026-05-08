import { type Component, For, Show, createSignal } from "solid-js";
import {
  ApiError,
  api,
  clearBaseUrl,
  clearToken,
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
import { t } from "./i18n.ts";
import {
  scrollToBottomOnSend,
  FACTORY_CUSTOM_INSTRUCTION_PREFS,
  getCustomInstructionPrefs,
  hasCustomInstructions,
  resetCustomInstructionPrefs,
  setScrollToBottomOnSend,
  setCustomInstructionPrefs,
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

type ManualCleanupNotice = {
  count: number;
  labels: string[];
};

const EMPTY_CONTEXT_USAGE: ContextUsageOverview = { ctx: null, session: null, week: null };

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
  const [manualCleanupNotice, setManualCleanupNotice] =
    createSignal<ManualCleanupNotice | null>(null);
  const [deviceSelectionRequest, setDeviceSelectionRequest] = createSignal<DeviceSelectionRequest>({
    id: null,
    seq: 0,
  });
  const [contextUsage, setContextUsage] = createSignal<ContextUsageOverview>(EMPTY_CONTEXT_USAGE);

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
          <div
            class="approval-card settings-dialog"
            style={{
              width: "min(780px, 95vw)",
              "max-width": "780px",
              "max-height": "86vh",
              "overflow-y": "auto",
            }}
          >
            <div class="approval-header">
              <span class="approval-title">{t("app.settings.title")}</span>
              <button
                type="button"
                class="sidebar-action"
                onClick={() => setSettingsOpen(false)}
                style={{ "margin-left": "auto", width: "auto", padding: "4px 10px" }}
                aria-label={t("app.dialog.close")}
              >
                x
              </button>
            </div>

            <nav class="settings-tabs">
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
                <LanguageSettings />
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
                <InstructionSettings />
              </Show>
            </div>
          </div>
        </dialog>
      </Show>
    </main>
  );
};

const LanguageSettings: Component = () => (
  <section class="settings-card">
    <h3 class="settings-card-title">{t("lang.settings.title")}</h3>
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
    <div class="settings-row">
      <button type="button" class="secondary-button" onClick={() => void hardRefreshApp()}>
        {t("app.hard-refresh")}
      </button>
    </div>
  </section>
);

const InstructionSettings: Component = () => {
  const [draft, setDraft] = createSignal(getCustomInstructionPrefs());
  const [saved, setSaved] = createSignal(false);
  const dirty = () => JSON.stringify(draft()) !== JSON.stringify(getCustomInstructionPrefs());
  const statusKey = () =>
    hasCustomInstructions(draft()) ? "instructions.status.custom" : "instructions.status.factory";

  function update(scope: keyof ReturnType<typeof getCustomInstructionPrefs>, value: string): void {
    setSaved(false);
    setDraft((current) => ({ ...current, [scope]: value }));
  }

  function save(): void {
    setCustomInstructionPrefs(draft());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function resetFactory(): void {
    resetCustomInstructionPrefs();
    setDraft({ ...FACTORY_CUSTOM_INSTRUCTION_PREFS });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <section class="settings-card instruction-settings">
      <div class="settings-section-heading">
        <div>
          <h3 class="settings-card-title">{t("instructions.title")}</h3>
          <p class="settings-card-help">{t("instructions.help")}</p>
        </div>
        <span
          class={`instruction-status${
            hasCustomInstructions(draft()) ? " instruction-status-custom" : ""
          }`}
        >
          {t(statusKey())}
        </span>
      </div>

      <InstructionTextarea
        label={t("instructions.global.label")}
        help={t("instructions.global.help")}
        value={draft().global}
        onInput={(value) => update("global", value)}
      />
      <InstructionTextarea
        label={t("instructions.local.label")}
        help={t("instructions.local.help")}
        value={draft().local}
        onInput={(value) => update("local", value)}
      />
      <InstructionTextarea
        label={t("instructions.session.label")}
        help={t("instructions.session.help")}
        value={draft().session}
        onInput={(value) => update("session", value)}
      />

      <div class="settings-row instruction-actions">
        <button type="button" class="secondary-button" onClick={resetFactory}>
          {t("instructions.reset")}
        </button>
        <button type="button" class="primary-button" onClick={save} disabled={!dirty()}>
          {t("instructions.save")}
        </button>
      </div>
      <Show when={saved()}>
        <span class="settings-saved">{t("instructions.saved")}</span>
      </Show>
    </section>
  );
};

const InstructionTextarea: Component<{
  label: string;
  help: string;
  value: string;
  onInput: (value: string) => void;
}> = (props) => (
  <label class="instruction-field">
    <span class="instruction-field-label">{props.label}</span>
    <span class="instruction-field-help">{props.help}</span>
    <textarea
      class="instruction-textarea"
      value={props.value}
      placeholder={t("instructions.placeholder")}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  </label>
);

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
