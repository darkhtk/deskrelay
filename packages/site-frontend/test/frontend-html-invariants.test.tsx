// jsdom-friendly invariants for the self-host app shell. Layout checks
// still belong in browser smoke tests; this file keeps product-routing
// and static HTML assumptions honest in CI.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ChatView } from "../src/components/ChatView.tsx";
import { LoginCard } from "../src/components/LoginCard.tsx";
import { OfflineHint } from "../src/components/OfflineHint.tsx";
import { setLocale, t } from "../src/i18n.ts";

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: "http://test.local/",
      pathname: "/",
      origin: "http://test.local",
      replace: vi.fn(),
      assign: vi.fn(),
    },
  });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("ko");
  window.localStorage.clear();
});

const pkgRoot = resolve(process.cwd());

describe("static index.html", () => {
  test('theme-color meta is "#f7f7f7"', () => {
    const html = readFileSync(resolve(pkgRoot, "index.html"), "utf8");
    expect(html).toContain('content="#f7f7f7"');
  });
});

describe("LoginCard", () => {
  test('tree has no raw "panel"/"col"/"row" utility classes', () => {
    const { container } = render(() => <LoginCard onTokenLogin={vi.fn()} />);
    expect(container.querySelector(".panel")).toBeNull();
    expect(container.querySelector(".col")).toBeNull();
    expect(container.querySelector(".row")).toBeNull();
  });

  test("submits a self-host token only after text is entered", () => {
    const onTokenLogin = vi.fn();
    render(() => <LoginCard onTokenLogin={onTokenLogin} />);

    const submit = screen.getByRole("button", { name: t("login.token.submit") });
    expect(submit).toBeDisabled();

    fireEvent.input(screen.getByPlaceholderText(t("login.token.placeholder")), {
      target: { value: "tok-1" },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(onTokenLogin).toHaveBeenCalledWith("tok-1");
  });
});

describe("settings and chrome invariants", () => {
  test("composer context text sits in the composer footer without a progress bar", () => {
    const styles = readFileSync(resolve(pkgRoot, "src/styles.css"), "utf8");
    const composerSource = readFileSync(resolve(pkgRoot, "src/components/Composer.tsx"), "utf8");

    expect(styles).toMatch(/\.composer-card\s*{[^}]*position:\s*relative;/s);
    expect(styles).toMatch(/\.composer-card\s*{[^}]*padding:\s*12px 22px 8px 12px;/s);
    expect(styles).toContain(".composer-context-status");
    expect(styles).not.toContain(".composer-ctx-meter");
    expect(composerSource).toContain("컨텍스트 압축까지");
  });

  test("session and week usage meters stack with reset labels on the right", () => {
    const appSource = readFileSync(resolve(pkgRoot, "src/App.tsx"), "utf8");
    const styles = readFileSync(resolve(pkgRoot, "src/styles.css"), "utf8");

    expect(appSource).toContain('class="context-meter-main"');
    expect(styles).toMatch(/\.context-meter-group\s*{[^}]*flex-direction:\s*column;/s);
    expect(styles).toMatch(/\.context-meter\s*{[^}]*justify-content:\s*space-between;/s);
    expect(styles).toMatch(/\.context-battery-label\s*{[^}]*min-width:\s*46px;/s);
    expect(styles).toMatch(/\.context-meter-reset\s*{[^}]*margin-left:\s*auto;/s);
  });

  test("general settings, devices, diagnostics, instructions, and hard refresh live in unified settings", () => {
    const appSource = readFileSync(resolve(pkgRoot, "src/App.tsx"), "utf8");
    const chatViewSource = readFileSync(resolve(pkgRoot, "src/components/ChatView.tsx"), "utf8");

    expect(appSource).toContain('t("lang.settings.title")');
    expect(appSource).toContain("appTheme()");
    expect(appSource).toContain("setAppTheme(value)");
    expect(appSource).toContain('t("settings.theme.title")');
    expect(appSource).toContain('["general", "devices", "diagnostics", "instructions", "help"]');
    expect(appSource).toContain("saveDeviceInstructionSource");
    expect(appSource).toContain("deleteDeviceInstructionSource");
    expect(appSource).toContain("formatInstructionLoadError");
    expect(chatViewSource).toContain("formatInstructionLoadError");
    expect(appSource).toContain("app.settings.tab.${value}");
    expect(appSource).toContain('t("app.hard-refresh")');
    expect(appSource).toContain('t("settings.usage.show-ctx")');
    expect(appSource).toContain('t("settings.usage.show-session")');
    expect(appSource).toContain('t("settings.usage.show-week")');
    expect(appSource).toContain("showCtxUsageMeter()");
    expect(appSource).toContain("showSessionUsageMeter()");
    expect(appSource).toContain("showWeekUsageMeter()");
    expect(chatViewSource).toContain("showContextUsageMeter");
    expect(appSource).toContain("window.caches");
    expect(appSource).toContain("navigator.serviceWorker");
    expect(appSource).toContain('url.searchParams.set("reload"');
    expect(appSource).toContain("settings-dialog-shell");
    expect(appSource).toContain("settings-tab-rail");
    expect(chatViewSource).not.toContain("profile-settings-action");
    expect(chatViewSource).not.toContain("DeviceSettingsDialog");
    expect(chatViewSource).not.toContain("LocalePicker");
  });

  test("signed-out App renders the self-host landing CTA", async () => {
    const { container } = render(() => <App />);
    await waitFor(() => {
      const found = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === t("landing.cta.start"),
      );
      if (!found) throw new Error("Landing CTA missing");
    });
  });

  test("self-host privacy and terms links are available from main app chrome", async () => {
    const { container } = render(() => <App />);
    await waitFor(() => {
      expect(container.querySelector('.alpha-banner a[href="/privacy"]')?.textContent).toBe(
        t("app.alpha-banner.privacy"),
      );
      expect(container.querySelector('.alpha-banner a[href="/terms"]')?.textContent).toBe(
        t("app.alpha-banner.terms"),
      );
    });
  });

  test("privacy and terms links are hidden once the chat app is open", async () => {
    const { container } = render(() => <App />);

    const openButton = screen.getAllByRole("button", { name: t("landing.cta.start") })[0];
    if (!openButton) throw new Error("landing CTA missing");
    fireEvent.click(openButton);
    fireEvent.input(await screen.findByPlaceholderText(t("login.token.placeholder")), {
      target: { value: "tok-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("login.token.submit") }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("app.back-home") })).toBeTruthy();
      expect(container.querySelector('a[href="/privacy"]')).toBeNull();
      expect(container.querySelector('a[href="/terms"]')).toBeNull();
    });
  });

  test("privacy and terms links are hidden on legal routes", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://test.local/privacy",
        pathname: "/privacy",
        origin: "http://test.local",
        replace: vi.fn(),
        assign: vi.fn(),
      },
    });

    const { container } = render(() => <App />);
    await waitFor(() => {
      expect(container.textContent).toContain(t("legal.privacy.title"));
      expect(container.querySelector('a[href="/privacy"]')).toBeNull();
      expect(container.querySelector('a[href="/terms"]')).toBeNull();
    });
  });

  test("privacy route describes local self-host data handling", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://test.local/privacy",
        pathname: "/privacy",
        origin: "http://test.local",
        replace: vi.fn(),
        assign: vi.fn(),
      },
    });

    const { container } = render(() => <App />);
    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(text).toContain(t("legal.privacy.title"));
      expect(text).toContain(t("legal.privacy.section.1.body"));
      expect(text).toContain("Site token");
    });
  });

  test("privacy route follows the selected language", async () => {
    setLocale("ko");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://test.local/privacy",
        pathname: "/privacy",
        origin: "http://test.local",
        replace: vi.fn(),
        assign: vi.fn(),
      },
    });

    const { container } = render(() => <App />);
    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(text).toContain(t("legal.privacy.title"));
      expect(text).toContain(t("legal.privacy.section.1.body"));
      expect(text).toContain("Site token");
    });
  });

  test("terms route is written for self-host operation", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://test.local/terms",
        pathname: "/terms",
        origin: "http://test.local",
        replace: vi.fn(),
        assign: vi.fn(),
      },
    });

    const { container } = render(() => <App />);
    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(text).toContain(t("legal.terms.title"));
      expect(text).toContain(t("legal.terms.intro"));
      expect(text).toContain(t("legal.terms.section.2.body"));
    });
  });

  test("self-host token can move from Landing into the app flow", async () => {
    render(() => <App />);
    const openButton = screen.getAllByRole("button", { name: t("landing.cta.start") })[0];
    if (!openButton) throw new Error("landing CTA missing");
    fireEvent.click(openButton);
    fireEvent.input(await screen.findByPlaceholderText(t("login.token.placeholder")), {
      target: { value: "tok-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("login.token.submit") }));

    await waitFor(() => {
      expect(window.localStorage.getItem("cr.site-token:http://test.local")).toBe("tok-1");
    });
    void ChatView;
  });
});

describe("ChatView upstream-banner", () => {
  test("error banner is a div role=alert, never an output with block children", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="upstream-banner" role="alert">
        <span class="upstream-banner-message">device offline - connector daemon</span>
      </div>`;
    const banner = root.querySelector(".upstream-banner");
    expect(banner?.tagName.toLowerCase()).toBe("div");
    expect(banner?.getAttribute("role")).toBe("alert");

    const chatViewSource = readFileSync(resolve(pkgRoot, "src/components/ChatView.tsx"), "utf8");
    expect(chatViewSource).toContain('class="upstream-banner" role="alert"');
    expect(chatViewSource).not.toMatch(/<output[^>]*class="upstream-banner"/);
  });

  test("OfflineHint renders for daemon-offline messages inside the banner", () => {
    const { container } = render(() => (
      <div class="upstream-banner" role="alert">
        <span class="upstream-banner-message">device offline - connector daemon</span>
        <OfflineHint message="device offline - connector daemon" onRetry={vi.fn()} />
      </div>
    ));
    const banner = container.querySelector(".upstream-banner");
    expect(banner?.querySelector(".offline-hint")).not.toBeNull();
    expect(banner?.getAttribute("role")).toBe("alert");
  });
});
