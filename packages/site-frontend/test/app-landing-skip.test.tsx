import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App.tsx";
import { Landing } from "../src/components/Landing.tsx";
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
    expect(screen.getByRole("heading", { name: "자동 설치와 진단" })).toBeTruthy();
    expect(document.body.textContent).toContain("현재 디바이스");
    expect(document.body.textContent).toContain("서버 자동 확인");
    expect(document.body.textContent).toContain("다른 PC 등록 명령");
  });

  test("an authenticated landing user can view and copy the remote registration command", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/self/register-other-pc-command")) {
        return new Response(
          JSON.stringify({
            preferredUrl: "http://100.64.1.2:18193",
            urls: [{ kind: "tailscale", url: "http://100.64.1.2:18193" }],
            command:
              'powershell -ExecutionPolicy Bypass -Command "irm https://example.invalid/install.ps1 | iex"',
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/__deskrelay/local-site-token")) {
        return new Response(JSON.stringify({ error: "local only" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/__deskrelay/client-context")) {
        return new Response(JSON.stringify({ address: "100.64.1.44", isLocal: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/devices")) {
        return new Response(
          JSON.stringify([
            {
              id: "dev_remote",
              label: "WORKPC",
              daemonUrl: "http://100.64.1.44:18091",
              registeredAt: "2026-01-01T00:00:00.000Z",
              connectionState: "online",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(() => <Landing authed onTokenLogin={vi.fn()} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain("powershell -ExecutionPolicy Bypass");
    });
    expect(document.body.textContent).toContain("등록된 디바이스");
    expect(document.body.textContent).toContain("WORKPC");
    fireEvent.click(screen.getByRole("button", { name: "등록 명령 복사" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("powershell -ExecutionPolicy Bypass"),
      );
      expect(screen.getByRole("button", { name: "복사됨" })).toBeTruthy();
    });
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

  test("a remote authenticated browser that does not match a device is labeled unregistered", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/__deskrelay/client-context")) {
        return new Response(JSON.stringify({ address: "100.64.1.99", isLocal: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/__deskrelay/local-site-token")) {
        return new Response(JSON.stringify({ error: "local only" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/devices")) {
        return new Response(
          JSON.stringify([
            {
              id: "dev_remote",
              label: "WORKPC",
              daemonUrl: "http://100.64.1.44:18091",
              registeredAt: "2026-01-01T00:00:00.000Z",
              connectionState: "online",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(() => <Landing authed onTokenLogin={vi.fn()} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain("등록 안 된 디바이스");
    });
  });

  test("a mobile browser is labeled mobile before device matching", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile",
    });
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(() => <Landing authed onTokenLogin={vi.fn()} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain("모바일");
      expect(document.body.textContent).toContain("모바일 브라우저");
    });
  });
});
