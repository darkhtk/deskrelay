import { type Component, For, Show, createSignal } from "solid-js";
import { ApiError, api, clearToken, getToken, setToken } from "./api.ts";
import { AnnouncementBanner } from "./components/AnnouncementBanner.tsx";
import { ChatView } from "./components/ChatView.tsx";
import { ConnectionDiagnostics } from "./components/ConnectionDiagnostics.tsx";
import { DeviceShell } from "./components/DeviceShell.tsx";
import { Landing } from "./components/Landing.tsx";
import { LegalPage, type LegalPageKind } from "./components/LegalPage.tsx";
import { LocaleChooser } from "./components/LocaleChooser.tsx";
import { LOCALES, LOCALE_LABELS, hasExplicitLocale, locale, setLocale, t } from "./i18n.ts";
import { scrollToBottomOnSend, setScrollToBottomOnSend } from "./ui-prefs.ts";

type SettingsTab = "general" | "devices" | "diagnostics";

type OpenSettingsOptions = {
  tab?: SettingsTab;
  deviceId?: string | null;
};

type DeviceSelectionRequest = {
  id: string | null;
  seq: number;
};

export const App: Component = () => {
  const [localToken, setLocalToken] = createSignal<string | null>(getToken());
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

  const [pickedLocale, setPickedLocale] = createSignal(hasExplicitLocale());
  const [landingDismissed, setLandingDismissed] = createSignal(false);
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
  const [deviceSelectionRequest, setDeviceSelectionRequest] = createSignal<DeviceSelectionRequest>({
    id: null,
    seq: 0,
  });

  const notifyDevicesChanged = () => {
    setDevicesRevision((value) => value + 1);
  };

  const requestDeviceSelection = (id: string | null) => {
    setDeviceSelectionRequest((current) => ({ id, seq: current.seq + 1 }));
  };

  const openSettings = (options: OpenSettingsOptions = {}) => {
    setSettingsTab(options.tab ?? "general");
    setSettingsDeviceId(options.deviceId ?? null);
    setSettingsOpen(true);
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
      </div>

      <Show when={legalPage()} keyed>
        {(kind) => <LegalPage kind={kind} />}
      </Show>

      <Show when={!legalPage()}>
        <Show when={!chatReady()}>
          <header class="app-header">
            <div class="header-left">
              <h1>{t("app.title")}</h1>
            </div>
          </header>
        </Show>

        <Show when={landingReopened() || !landingDismissed() || !hasAccess()}>
          <Landing
            onTokenLogin={handleTokenLogin}
            onLocalAccessLogin={handleLocalAccessLogin}
            authed={hasAccess()}
            onProceed={dismissLanding}
          />
        </Show>

        <Show when={!landingReopened() && landingDismissed() && hasAccess() && !pickedLocale()}>
          <LocaleChooser onPicked={() => setPickedLocale(true)} />
        </Show>

        <Show when={chatReady()}>
          <ChatView
            onClearAccess={handleClearAccess}
            onOpenSettings={openSettings}
            devicesRevision={devicesRevision()}
            requestedDeviceSelection={deviceSelectionRequest()}
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
              <For each={["general", "devices", "diagnostics"] as const}>
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
                  onDeviceSelected={requestDeviceSelection}
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
    <div class="settings-row" role="radiogroup" aria-label={t("lang.settings.title")}>
      <For each={LOCALES}>
        {(id) => (
          <button
            type="button"
            class={`secondary-button${id === locale() ? " primary-button" : ""}`}
            aria-pressed={id === locale()}
            onClick={() => setLocale(id)}
          >
            {LOCALE_LABELS[id]}
          </button>
        )}
      </For>
    </div>
    <label class="settings-check-row">
      <input
        type="checkbox"
        checked={scrollToBottomOnSend()}
        onChange={(event) => setScrollToBottomOnSend(event.currentTarget.checked)}
      />
      {t("lang.settings.scroll-on-send")}
    </label>
    <div class="settings-row">
      <button type="button" class="secondary-button" onClick={() => void hardRefreshApp()}>
        {t("app.hard-refresh")}
      </button>
    </div>
  </section>
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
