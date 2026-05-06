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
  window.localStorage.clear();
});

const pkgRoot = resolve(process.cwd());

describe("static index.html", () => {
  test('theme-color meta is "#faf9f5"', () => {
    const html = readFileSync(resolve(pkgRoot, "index.html"), "utf8");
    expect(html).toContain('content="#faf9f5"');
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

    const submit = screen.getByRole("button", { name: "Connect" });
    expect(submit).toBeDisabled();

    fireEvent.input(screen.getByPlaceholderText("CR_SITE_TOKEN"), {
      target: { value: "tok-1" },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(onTokenLogin).toHaveBeenCalledWith("tok-1");
  });
});

describe("settings and chrome invariants", () => {
  test("language, devices, diagnostics, and hard refresh live in unified settings", () => {
    const appSource = readFileSync(resolve(pkgRoot, "src/App.tsx"), "utf8");
    const chatViewSource = readFileSync(resolve(pkgRoot, "src/components/ChatView.tsx"), "utf8");

    expect(appSource).toContain('t("lang.settings.title")');
    expect(appSource).toContain('["general", "devices", "diagnostics"]');
    expect(appSource).toContain("app.settings.tab.${value}");
    expect(appSource).toContain('t("app.hard-refresh")');
    expect(appSource).toContain("window.caches");
    expect(appSource).toContain("navigator.serviceWorker");
    expect(appSource).toContain('url.searchParams.set("reload"');
    expect(chatViewSource).toContain("profile-settings-action");
    expect(chatViewSource).not.toContain("DeviceSettingsDialog");
    expect(chatViewSource).not.toContain("LocalePicker");
  });

  test("signed-out App renders the self-host landing CTA", async () => {
    const { container } = render(() => <App />);
    await waitFor(() => {
      const found = [...container.querySelectorAll("button")].find((button) =>
        /open app/i.test(button.textContent ?? ""),
      );
      if (!found) throw new Error("Landing CTA missing");
    });
  });

  test("self-host privacy and terms links are available from app chrome", async () => {
    const { container } = render(() => <App />);
    await waitFor(() => {
      expect(container.querySelector('a[href="/privacy"]')?.textContent).toMatch(/privacy/i);
      expect(container.querySelector('a[href="/terms"]')?.textContent).toMatch(/terms/i);
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
      expect(text).toContain("Privacy for self-hosted DeskRelay");
      expect(text).toContain("do not receive, store, or process your chats");
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
      expect(text).toContain("Terms for self-hosted DeskRelay");
      expect(text).toContain("do not provide a hosted service");
      expect(text).toContain("Do not expose connector or site ports");
    });
  });

  test("self-host token can move from Landing into the app flow", async () => {
    render(() => <App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open app" })[0]!);
    fireEvent.input(await screen.findByPlaceholderText("CR_SITE_TOKEN"), {
      target: { value: "tok-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("cr.site-token")).toBe("tok-1");
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
