import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App.tsx";
import { t } from "../src/i18n.ts";

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
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("App landing flow", () => {
  test("a visitor starts on the self-host landing screen", async () => {
    render(() => <App />);
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: t("landing.cta.start") }).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByRole("heading", { name: "릴리즈 노트" })).toBeTruthy();
    expect(document.body.textContent).toContain("CLI 권한을 편집할 수 있습니다");
  });

  test("a stored token for this self-host server opens the chat directly", async () => {
    window.localStorage.setItem("cr.site-token:http://test.local", "tok-abc");
    render(() => <App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("app.back-home") })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: t("landing.cta.start") })).toBeNull();
  });

  test("chat top-bar back button reopens the main landing screen", async () => {
    render(() => <App />);

    const openButton = screen.getAllByRole("button", { name: t("landing.cta.start") })[0];
    if (!openButton) throw new Error("open button missing");
    fireEvent.click(openButton);
    fireEvent.input(await screen.findByPlaceholderText(t("login.token.placeholder")), {
      target: { value: "tok-abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("login.token.submit") }));

    const back = await screen.findByRole("button", { name: t("app.back-home") });
    fireEvent.click(back);

    await waitFor(() => {
      const heading = document.querySelector(".landing-headline")?.textContent ?? "";
      expect(heading).toContain("DeskRelay");
    });
    expect(screen.queryByRole("button", { name: t("app.back-home") })).toBeNull();
  });

  test("local server users can open the app without typing the Site token", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/__deskrelay/local-site-token")) {
        return new Response(JSON.stringify({ token: "tok-local" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(() => <App />);
    const openButton = screen.getAllByRole("button", { name: t("landing.cta.start") })[0];
    if (!openButton) throw new Error("open button missing");
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(window.localStorage.getItem("cr.site-token:http://test.local")).toBe("tok-local");
    });
    expect(screen.queryByPlaceholderText(t("login.token.placeholder"))).toBeNull();
  });
});
