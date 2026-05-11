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
    expect(screen.getByRole("heading", { name: "상태와 등록" })).toBeTruthy();
    expect(document.body.textContent).toContain("현재 디바이스");
    expect(document.body.textContent).toContain("서버");
    expect(document.body.textContent).toContain("업데이트");
    expect(document.body.textContent).toContain("다른 PC 등록 명령");
  });

  test("an authenticated landing user can view the remote registration command", async () => {
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
      if (url.includes("/api/self/update/status")) {
        return new Response(JSON.stringify({ state: "idle" }), {
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
    expect(document.body.textContent).toContain("server URL: http://100.64.1.2:18193");
  });

  test("a stored token for this self-host server opens the chat directly", async () => {
    window.localStorage.setItem("cr.site-token:http://test.local", "tok-abc");
    render(() => <App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("app.settings.aria") })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: t("landing.cta.start") })).toBeNull();
  });

  test("chat top bar opens settings and access clearing lives in settings", async () => {
    window.localStorage.setItem("cr.site-token:http://test.local", "tok-abc");
    render(() => <App />);

    const settings = await screen.findByRole("button", { name: t("app.settings.aria") });
    expect(document.querySelector("#profile-card")).toBeNull();
    fireEvent.click(settings);

    const clearAccess = await screen.findByRole("button", { name: t("app.clear-access") });
    fireEvent.click(clearAccess);

    await waitFor(() => {
      expect(window.localStorage.getItem("cr.site-token:http://test.local")).toBeNull();
      expect(
        screen.getAllByRole("button", { name: t("landing.cta.start") }).length,
      ).toBeGreaterThan(0);
    });
  });

  test("settings general tab toggles self server autostart", async () => {
    window.localStorage.setItem("cr.site-token:http://test.local", "tok-abc");
    const requests: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (url.endsWith("/api/self/autostart")) {
        if (init?.method === "PUT") {
          return new Response(
            JSON.stringify({
              supported: true,
              installed: true,
              taskName: "DeskRelay Self Server",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            supported: true,
            installed: false,
            taskName: "DeskRelay Self Server",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(() => <App />);
    const settings = await screen.findByRole("button", { name: t("app.settings.aria") });
    fireEvent.click(settings);

    const label = await screen.findByText(t("settings.autostart.server"));
    const checkbox = label.closest("label")?.querySelector("input");
    if (!checkbox) throw new Error("autostart checkbox missing");
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(checkbox.checked).toBe(true);
      expect(requests.some((req) => req.body === JSON.stringify({ enabled: true }))).toBe(true);
    });
  });

  test("settings manager assistant sends a server-local CLI chat message", async () => {
    window.localStorage.setItem("cr.site-token:http://test.local", "tok-abc");
    const requests: Array<{ url: string; method: string; body?: string }> = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/manager/assistant/chat") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            cwd: "C:\\deskrelay",
            command: "claude -p",
            durationMs: 42,
            message: {
              id: "assistant-1",
              role: "assistant",
              text: "서버 PC의 DeskRelay 폴더에서 확인했습니다.",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { container } = render(() => <App />);
    const settings = await screen.findByRole("button", { name: t("app.settings.aria") });
    fireEvent.click(settings);
    fireEvent.click(await screen.findByRole("button", { name: "관리 Assistant" }));

    const input = await screen.findByPlaceholderText("DeskRelay 관리에 대해 물어보세요...");
    fireEvent.input(input, { target: { value: "서버 상태 알려줘" } });
    const send = container.querySelector<HTMLButtonElement>(
      ".manager-assistant-composer .composer-send",
    );
    if (!send) throw new Error("manager assistant send button missing");
    fireEvent.click(send);

    await waitFor(() => {
      const request = requests.find(
        (entry) => entry.url.endsWith("/api/manager/assistant/chat") && entry.method === "POST",
      );
      const body = JSON.parse(request?.body ?? "{}") as { message?: string; history?: unknown[] };
      expect(body.message).toBe("서버 상태 알려줘");
      expect(body.history?.length).toBeGreaterThan(0);
      expect(container.textContent).toContain("서버 PC의 DeskRelay 폴더에서 확인했습니다.");
    });
  });

  test("settings general tab adjusts the chat font size", async () => {
    window.localStorage.setItem("cr.site-token:http://test.local", "tok-abc");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/self/autostart")) {
        return new Response(
          JSON.stringify({
            supported: true,
            installed: false,
            taskName: "DeskRelay Self Server",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(() => <App />);
    const settings = await screen.findByRole("button", { name: t("app.settings.aria") });
    fireEvent.click(settings);

    const slider = await screen.findByRole("slider", {
      name: t("settings.chat-font-size.title"),
    });
    fireEvent.input(slider, { target: { value: "18" } });

    expect(window.localStorage.getItem("cr.chat-font-size")).toBe("18");
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("18px");
    expect(document.body.textContent).toContain(t("settings.chat-font-size.value", { size: 18 }));
    expect(document.body.textContent).toContain(t("settings.chat-font-size.preview"));

    fireEvent.click(
      screen.getByRole("button", {
        name: t("settings.new-chat-cwd-browse.unrestricted"),
      }),
    );
    expect(window.localStorage.getItem("cr.new-chat-cwd-browse-mode")).toBe("unrestricted");
  });

  test("settings instructions show missing device instruction files inline", async () => {
    window.localStorage.setItem("cr.site-token:http://test.local", "tok-abc");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/devices")) {
        return new Response(
          JSON.stringify([
            {
              id: "dev_home",
              label: "HOMEDEV",
              daemonUrl: "http://127.0.0.1:18091",
              registeredAt: "2026-01-01T00:00:00.000Z",
              connectionState: "online",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/devices/dev_home/behaviors")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/devices/dev_home/instructions")) {
        return new Response(
          JSON.stringify({
            cwd: null,
            sources: [
              {
                scope: "user",
                label: "사용자 전역",
                path: "C:\\Users\\darkh\\.claude\\CLAUDE.md",
                readonly: false,
                exists: false,
                content: "",
              },
              {
                scope: "managed",
                label: "관리 정책",
                path: "C:\\Program Files\\ClaudeCode\\CLAUDE.md",
                readonly: true,
                exists: false,
                content: "",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/healthz")) {
        return new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { container } = render(() => <App />);
    const settings = await screen.findByRole("button", { name: t("app.settings.aria") });
    fireEvent.click(settings);
    const instructionsTab = [...container.querySelectorAll(".settings-tab")].find(
      (button) => button.textContent === t("app.settings.tab.instructions"),
    ) as HTMLButtonElement | undefined;
    if (!instructionsTab) throw new Error("settings instructions tab missing");
    fireEvent.click(instructionsTab);

    await waitFor(() => {
      expect(container.textContent).toContain("사용자 전역");
      expect(container.textContent).toContain("관리 정책");
      expect(container.textContent).toContain("C:\\Users\\darkh\\.claude\\CLAUDE.md");
      expect(container.textContent).toContain("C:\\Program Files\\ClaudeCode\\CLAUDE.md");
    });
    expect(container.textContent).not.toContain(t("instructions.device.sources.title"));
    expect(container.textContent).toContain(t("instructions.source.missing"));
    const missingStates = [...container.querySelectorAll(".instruction-source-state")].filter(
      (state) => state.textContent === t("instructions.source.missing"),
    );
    expect(missingStates.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain(t("instructions.device.empty.user"));
    expect(container.textContent).not.toContain(t("instructions.device.empty.managed"));
  });

  test("a site-token URL fragment is stored and opens the chat directly", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "http://test.local/#site-token=tok-fragment",
        hash: "#site-token=tok-fragment",
        pathname: "/",
        origin: "http://test.local",
        replace: vi.fn(),
        assign: vi.fn(),
      },
    });

    render(() => <App />);

    await waitFor(() => {
      expect(window.localStorage.getItem("cr.site-token:http://test.local")).toBe("tok-fragment");
      expect(screen.getByRole("button", { name: t("app.settings.aria") })).toBeTruthy();
    });
  });

  test("settings general tab can reopen the main landing screen", async () => {
    render(() => <App />);

    const openButton = screen.getAllByRole("button", { name: t("landing.cta.start") })[0];
    if (!openButton) throw new Error("open button missing");
    fireEvent.click(openButton);
    fireEvent.input(await screen.findByPlaceholderText(t("login.token.placeholder")), {
      target: { value: "tok-abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("login.token.submit") }));

    const settings = await screen.findByRole("button", { name: t("app.settings.aria") });
    fireEvent.click(settings);
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
