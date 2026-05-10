import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ChatView } from "../src/components/ChatView.tsx";
import { t } from "../src/i18n.ts";
import { setChatTranscriptEventLimit } from "../src/ui-prefs.ts";

const DEV = {
  id: "dev_refresh_1",
  label: "Fresh Laptop",
  daemonUrl: "http://127.0.0.1:18091",
  registeredAt: "2026-04-30T00:00:00.000Z",
};

const OTHER_DEV = {
  id: "dev_refresh_2",
  label: "Old Desktop",
  daemonUrl: "http://127.0.0.1:18092",
  registeredAt: "2026-04-30T00:00:00.000Z",
};

function pngFile(name = "image.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function pasteImage(target: Element, file: File) {
  fireEvent.paste(target, {
    clipboardData: {
      items: [
        {
          kind: "file",
          type: file.type,
          getAsFile: () => file,
        },
      ],
    },
  });
}

function storedSelectedDevice(): { id?: string; label?: string; daemonUrl?: string } | null {
  const raw = localStorage.getItem("cr.chat-selected-device-id");
  return raw ? (JSON.parse(raw) as { id?: string; label?: string; daemonUrl?: string }) : null;
}

interface ChatRequestParams {
  message?: string;
  attachments?: Array<{ name?: string }>;
  permissionMode?: string;
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin: "http://test.local" },
  });
});

afterEach(() => {
  vi.useRealTimers();
  setChatTranscriptEventLimit(100);
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatView device refresh bridge", () => {
  test("keeps the selected chat device across reloads and updates it when changed", async () => {
    localStorage.setItem("cr.chat-selected-device-id", OTHER_DEV.id);
    const requestedUrls: string[] = [];
    let sessionsListDeviceId: string | null = null;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV, OTHER_DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      for (const device of [DEV, OTHER_DEV]) {
        if (url.endsWith(`/api/devices/${device.id}/behaviors`) && method === "GET") {
          return new Response(
            JSON.stringify([
              {
                instanceId: "remote-claude",
                name: "remote-claude",
                version: "0.0.0-test",
                loadedAt: "2026-04-30T00:00:00.000Z",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (
          url.endsWith(`/api/devices/${device.id}/behaviors/remote-claude/request`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
          if (body.method === "sessions.list") {
            sessionsListDeviceId = device.id;
            return new Response(JSON.stringify({ result: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (body.method === "context.usage") {
            return new Response(JSON.stringify({ result: { usage: null } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (body.method === "usage.limits") {
            return new Response(JSON.stringify({ result: { session: null, week: null } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    const select = await waitFor(() => {
      const found = container.querySelector(
        ".sidebar-section-devices select",
      ) as HTMLSelectElement | null;
      if (!found) throw new Error("device select missing");
      expect(found.value).toBe(OTHER_DEV.id);
      return found;
    });
    await waitFor(() => {
      expect(sessionsListDeviceId).toBe(OTHER_DEV.id);
    });
    expect(
      requestedUrls.some((url) => url.endsWith(`/api/devices/${OTHER_DEV.id}/behaviors`)),
    ).toBe(true);

    fireEvent.change(select, { target: { value: DEV.id } });
    expect(storedSelectedDevice()).toMatchObject({
      id: DEV.id,
      label: DEV.label,
      daemonUrl: DEV.daemonUrl,
    });
    await waitFor(() => {
      expect(select.value).toBe(DEV.id);
    });
  });

  test("restores the selected chat device by daemon URL when its id changes", async () => {
    localStorage.setItem(
      "cr.chat-selected-device-id",
      JSON.stringify({
        id: "dev_previous_registration",
        label: OTHER_DEV.label,
        daemonUrl: OTHER_DEV.daemonUrl,
      }),
    );
    let sessionsListDeviceId: string | null = null;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV, OTHER_DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      for (const device of [DEV, OTHER_DEV]) {
        if (url.endsWith(`/api/devices/${device.id}/behaviors`) && method === "GET") {
          return new Response(
            JSON.stringify([
              {
                instanceId: "remote-claude",
                name: "remote-claude",
                version: "0.0.0-test",
                loadedAt: "2026-04-30T00:00:00.000Z",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (
          url.endsWith(`/api/devices/${device.id}/behaviors/remote-claude/request`) &&
          method === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
          if (body.method === "sessions.list") {
            sessionsListDeviceId = device.id;
            return new Response(JSON.stringify({ result: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (body.method === "context.usage") {
            return new Response(JSON.stringify({ result: { usage: null } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (body.method === "usage.limits") {
            return new Response(JSON.stringify({ result: { session: null, week: null } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      const select = container.querySelector(
        ".sidebar-section-devices select",
      ) as HTMLSelectElement | null;
      expect(select?.value).toBe(OTHER_DEV.id);
      expect(sessionsListDeviceId).toBe(OTHER_DEV.id);
      expect(storedSelectedDevice()).toMatchObject({
        id: OTHER_DEV.id,
        label: OTHER_DEV.label,
        daemonUrl: OTHER_DEV.daemonUrl,
      });
    });
  });

  test("does not clear the saved chat device for the initial empty selection request", async () => {
    localStorage.setItem("cr.chat-selected-device-id", OTHER_DEV.id);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV, OTHER_DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      for (const device of [DEV, OTHER_DEV]) {
        if (url.endsWith(`/api/devices/${device.id}/behaviors`) && method === "GET") {
          return new Response(
            JSON.stringify([
              {
                instanceId: "remote-claude",
                name: "remote-claude",
                version: "0.0.0-test",
                loadedAt: "2026-04-30T00:00:00.000Z",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (
          url.endsWith(`/api/devices/${device.id}/behaviors/remote-claude/request`) &&
          method === "POST"
        ) {
          return new Response(JSON.stringify({ result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
        requestedDeviceSelection={{ id: null, seq: 0 }}
      />
    ));

    await waitFor(() => {
      const select = container.querySelector(
        ".sidebar-section-devices select",
      ) as HTMLSelectElement | null;
      expect(select?.value).toBe(OTHER_DEV.id);
      expect(storedSelectedDevice()).toMatchObject({
        id: OTHER_DEV.id,
        label: OTHER_DEV.label,
        daemonUrl: OTHER_DEV.daemonUrl,
      });
    });
  });

  test("clears a saved chat device when it no longer exists", async () => {
    localStorage.setItem("cr.chat-selected-device-id", "dev_missing");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      const select = container.querySelector(
        ".sidebar-section-devices select",
      ) as HTMLSelectElement | null;
      expect(select?.value).toBe(DEV.id);
      expect(localStorage.getItem("cr.chat-selected-device-id")).toBeNull();
    });
  });

  test("loads sessions for the default selected device on first site load", async () => {
    const requestedUrls: string[] = [];
    let sessionsRequests = 0;
    let sessionsListParams: Record<string, unknown> | null = null;
    let contextUsageRequests = 0;
    let usageLimitsRequests = 0;
    const contextUsageParams: Array<Record<string, unknown>> = [];
    const contextUsageSnapshots: Array<unknown> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          sessionsRequests += 1;
          sessionsListParams = body.params ?? null;
          return new Response(
            JSON.stringify({
              result: [
                {
                  sessionId: "sess_initial_1",
                  cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
                  title: "Initial session loaded",
                  modifiedAt: "2026-04-30T00:00:00.000Z",
                  fileSize: 512,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "context.usage") {
          contextUsageRequests += 1;
          contextUsageParams.push(body.params ?? {});
          return new Response(
            JSON.stringify({
              result: {
                usage: { remainingPercent: 88, usedPercent: 12, source: "text" },
                eventCount: 3,
                checkedAt: "2026-05-07T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "usage.limits") {
          usageLimitsRequests += 1;
          return new Response(
            JSON.stringify({
              result: {
                session: {
                  remainingPercent: 98,
                  usedPercent: 2,
                  source: "event",
                  resetAt: "2026-05-07T06:20:00.000Z",
                  rateLimitType: "five_hour",
                },
                week: {
                  remainingPercent: 71,
                  usedPercent: 29,
                  source: "event",
                  resetAt: "2026-05-10T10:59:59.000Z",
                  rateLimitType: "seven_day",
                },
                checkedAt: "2026-05-07T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
        onContextUsageChange={(usage) => contextUsageSnapshots.push(usage)}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Fresh Laptop");
      expect(container.textContent).toContain("Initial session loaded");
    });
    expect(sessionsRequests).toBe(1);
    expect(sessionsListParams).toMatchObject({ limit: 200, dedupeSessionIds: true });
    await waitFor(() => {
      expect(contextUsageRequests).toBe(1);
      expect(usageLimitsRequests).toBe(1);
      expect(contextUsageParams[0]).toMatchObject({
        cwd: ".",
        permissionMode: "default",
      });
      expect(contextUsageParams[0]).not.toHaveProperty("scope");
      expect(contextUsageSnapshots).toContainEqual({
        ctx: { remainingPercent: 88, usedPercent: 12, source: "text" },
        session: {
          remainingPercent: 98,
          usedPercent: 2,
          source: "event",
          resetAt: "2026-05-07T06:20:00.000Z",
          rateLimitType: "five_hour",
        },
        week: {
          remainingPercent: 71,
          usedPercent: 29,
          source: "event",
          resetAt: "2026-05-10T10:59:59.000Z",
          rateLimitType: "seven_day",
        },
      });
    });
    expect(requestedUrls.some((url) => url.endsWith(`/api/devices/${DEV.id}/behaviors`))).toBe(
      true,
    );
    expect(
      requestedUrls.some((url) =>
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`),
      ),
    ).toBe(true);
  });

  test("restores the last selected session for the selected device", async () => {
    localStorage.setItem("cr.chat-selected-device-id", DEV.id);
    localStorage.setItem(
      "cr.chat-selected-sessions",
      JSON.stringify({
        [DEV.id]: {
          sessionId: "sess_restore_1",
          cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
          modifiedAt: "2026-04-30T00:00:00.000Z",
        },
        [OTHER_DEV.id]: {
          sessionId: "sess_other_device",
          cwd: "C:\\Users\\desktop\\Projects\\deskrelay",
        },
      }),
    );
    let readSessionParams: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV, OTHER_DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          return new Response(
            JSON.stringify({
              result: [
                {
                  sessionId: "sess_restore_1",
                  cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
                  title: "Restored session",
                  modifiedAt: "2026-04-30T00:00:00.000Z",
                  fileSize: 512,
                },
                {
                  sessionId: "sess_newer_but_not_selected",
                  cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
                  title: "Newer unselected session",
                  modifiedAt: "2026-04-30T01:00:00.000Z",
                  fileSize: 512,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "sessions.read") {
          readSessionParams = body.params ?? null;
          return new Response(
            JSON.stringify({
              result: {
                sessionId: "sess_restore_1",
                cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
                events: [],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "context.usage") {
          return new Response(JSON.stringify({ result: { usage: null } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "usage.limits") {
          return new Response(JSON.stringify({ result: { session: null, week: null } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Restored session");
      expect(readSessionParams).toMatchObject({
        sessionId: "sess_restore_1",
        cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
      });
    });
    const stored = JSON.parse(localStorage.getItem("cr.chat-selected-sessions") ?? "{}") as Record<
      string,
      { sessionId?: string; cwd?: string }
    >;
    expect(stored[DEV.id]).toMatchObject({
      sessionId: "sess_restore_1",
      cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
    });
    expect(stored[OTHER_DEV.id]).toMatchObject({ sessionId: "sess_other_device" });
  });

  test("polls CTX with /context and Session/Week with Claude usage limits", async () => {
    vi.useFakeTimers();
    let contextUsageRequests = 0;
    let usageLimitsRequests = 0;
    const contextUsageParams: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          return new Response(JSON.stringify({ result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "context.usage") {
          contextUsageRequests += 1;
          contextUsageParams.push(body.params ?? {});
          return new Response(
            JSON.stringify({
              result: {
                usage: { remainingPercent: 91, usedPercent: 9, source: "text" },
                eventCount: 3,
                checkedAt: "2026-05-07T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "usage.limits") {
          usageLimitsRequests += 1;
          return new Response(
            JSON.stringify({
              result: {
                session: {
                  remainingPercent: 98,
                  usedPercent: 2,
                  source: "event",
                  resetAt: "2026-05-07T06:20:00.000Z",
                  rateLimitType: "five_hour",
                },
                week: {
                  remainingPercent: 71,
                  usedPercent: 29,
                  source: "event",
                  resetAt: "2026-05-10T10:59:59.000Z",
                  rateLimitType: "seven_day",
                },
                checkedAt: "2026-05-07T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await vi.waitFor(() => {
      expect(contextUsageRequests).toBe(1);
      expect(usageLimitsRequests).toBe(1);
    });
    expect(contextUsageParams[0]).toMatchObject({ cwd: "." });
    expect(contextUsageParams[0]).not.toHaveProperty("scope");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await vi.waitFor(() => {
      expect(contextUsageRequests).toBe(2);
      expect(usageLimitsRequests).toBe(2);
    });
    expect(contextUsageParams[1]).toMatchObject({ cwd: "." });
    expect(contextUsageParams[1]).not.toHaveProperty("scope");
  });

  test("uses the saved device default cwd for New Chat even after selecting an older session", async () => {
    localStorage.setItem(`cr:device:${DEV.id}:defaultCwd`, "C:\\Users\\darkh\\saved-default");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes(`/api/devices/${DEV.id}/fs/roots`) && method === "GET") {
        return new Response(JSON.stringify({ mode: "unrestricted", roots: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: unknown;
        };
        if (body.method === "sessions.list") {
          return new Response(
            JSON.stringify({
              result: [
                {
                  sessionId: "sess_old_cwd",
                  cwd: "C:\\Users\\darkh\\old-session",
                  title: "Old cwd session",
                  modifiedAt: "2026-04-30T00:00:00.000Z",
                  fileSize: 512,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "sessions.read") {
          return new Response(
            JSON.stringify({
              result: {
                sessionId: "sess_old_cwd",
                cwd: "C:\\Users\\darkh\\old-session",
                events: [],
                truncated: false,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Old cwd session");
    });

    const oldSession = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Old cwd session"),
    ) as HTMLButtonElement | undefined;
    if (!oldSession) throw new Error("old session row missing");
    fireEvent.click(oldSession);

    const newChat = container.querySelector(
      `button[aria-label="${t("chat.sidebar.new.button")}"]`,
    ) as HTMLButtonElement | null;
    if (!newChat) throw new Error("new chat button missing");
    fireEvent.click(newChat);

    await waitFor(() => {
      const input = container.querySelector("#new-chat-cwd") as HTMLInputElement | null;
      expect(input?.value).toBe("C:\\Users\\darkh\\saved-default");
    });
  });

  test("keeps session search state while switching sidebar tabs and edits CLI permissions", async () => {
    let permissionUpdateParams: { path?: string; allow?: string[] } | null = null;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: unknown;
        };
        if (body.method === "slashCommands") {
          return new Response(
            JSON.stringify({
              result: {
                slashCommands: ["/status"],
                skills: ["simplify", "deep-review"],
                model: "claude-opus",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "permissions.inspect") {
          return new Response(
            JSON.stringify({
              result: {
                sources: [
                  {
                    label: "User settings",
                    path: "C:\\Users\\darkh\\.claude\\settings.json",
                    exists: true,
                    allow: ["Bash(git status:*)"],
                    deny: [],
                    ask: [],
                    defaultMode: "default",
                  },
                  {
                    label: "Project settings",
                    path: "C:\\Users\\darkh\\Projects\\deskrelay\\.claude\\settings.json",
                    exists: true,
                    allow: [],
                    deny: [],
                    ask: [],
                    defaultMode: null,
                  },
                  {
                    label: "Project local settings",
                    path: "C:\\Users\\darkh\\Projects\\deskrelay\\.claude\\settings.local.json",
                    exists: false,
                    allow: [],
                    deny: [],
                    ask: [],
                    defaultMode: null,
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "permissions.update") {
          permissionUpdateParams = body.params as { path?: string; allow?: string[] };
          return new Response(
            JSON.stringify({
              result: {
                source: {
                  label: "User settings",
                  path: "C:\\Users\\darkh\\.claude\\settings.json",
                  exists: true,
                  allow: permissionUpdateParams.allow ?? [],
                  deny: [],
                  ask: [],
                  defaultMode: "default",
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            result: [
              {
                sessionId: "sess_tab_1",
                cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
                title: "Tabbed session",
                modifiedAt: "2026-04-30T00:00:00.000Z",
                fileSize: 512,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Tabbed session");
    });

    const sidebarToggle = container.querySelector(
      `button[aria-label="${t("chat.toggle-sidebar")}"]`,
    ) as HTMLButtonElement | null;
    if (!sidebarToggle) throw new Error("sidebar toggle missing");
    fireEvent.click(sidebarToggle);
    await waitFor(() => {
      expect(document.body.classList.contains("sidebar-collapsed")).toBe(true);
    });
    fireEvent.click(sidebarToggle);
    await waitFor(() => {
      expect(document.body.classList.contains("sidebar-collapsed")).toBe(false);
    });

    const signedInPane = container.querySelector("#signed-in-pane") as HTMLElement | null;
    const resizeHandle = container.querySelector(".sidebar-resize-handle") as HTMLElement | null;
    if (!signedInPane) throw new Error("signed-in pane missing");
    if (!resizeHandle) throw new Error("sidebar resize handle missing");

    resizeHandle.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 260, bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 420, bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 420, bubbles: true, cancelable: true }),
    );
    await waitFor(() => {
      expect(localStorage.getItem("cr.sidebar-width")).toBe("420");
      expect(signedInPane.style.getPropertyValue("--sidebar-width")).toBe("420px");
      expect(document.body.classList.contains("sidebar-collapsed")).toBe(false);
    });

    resizeHandle.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 420, bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 390, bubbles: true, cancelable: true }),
    );
    await waitFor(() => {
      expect(localStorage.getItem("cr.sidebar-width")).toBe("420");
      expect(signedInPane.style.getPropertyValue("--sidebar-width")).toBe("390px");
      expect(document.body.classList.contains("sidebar-collapsed")).toBe(false);
      expect(document.body.classList.contains("sidebar-resizing")).toBe(true);
    });
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 220, bubbles: true, cancelable: true }),
    );
    await waitFor(() => {
      expect(localStorage.getItem("cr.sidebar-width")).toBe("260");
      expect(signedInPane.style.getPropertyValue("--sidebar-width")).toBe("260px");
      expect(document.body.classList.contains("sidebar-collapsed")).toBe(true);
      expect(document.body.classList.contains("sidebar-resizing")).toBe(false);
    });
    window.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 220, bubbles: true, cancelable: true }),
    );
    fireEvent.click(sidebarToggle);
    await waitFor(() => {
      expect(document.body.classList.contains("sidebar-collapsed")).toBe(false);
    });

    expect(container.querySelector(".session-search")).toBeNull();

    const searchToggle = container.querySelector(
      `button[aria-label="${t("chat.sidebar.search.toggle")}"]`,
    ) as HTMLButtonElement | null;
    if (!searchToggle) throw new Error("session search toggle missing");
    fireEvent.click(searchToggle);

    const searchInput = container.querySelector(".session-search") as HTMLInputElement | null;
    if (!searchInput) throw new Error("session search input missing");
    fireEvent.input(searchInput, { target: { value: "Tabbed" } });

    const skillsTab = [...container.querySelectorAll('[role="tab"]')].find(
      (button) => button.textContent === t("chat.sidebar.tab.skills"),
    ) as HTMLButtonElement | undefined;
    if (!skillsTab) throw new Error("skills tab missing");
    fireEvent.click(skillsTab);
    await waitFor(() => {
      expect(container.textContent).toContain("deep-review");
      expect(container.textContent).toContain("simplify");
      expect(container.textContent).toContain("/status");
    });
    const addedSkill = [...container.querySelectorAll(".sidebar-skill-row.skill-added")].find(
      (item) => item.querySelector(".sidebar-skill-name")?.textContent === "deep-review",
    );
    const builtinSkill = [...container.querySelectorAll(".sidebar-skill-row.skill-builtin")].find(
      (item) => item.querySelector(".sidebar-skill-name")?.textContent === "simplify",
    );
    expect(addedSkill).toBeTruthy();
    expect(builtinSkill).toBeTruthy();
    expect(addedSkill?.getAttribute("data-full-description")).toBe("Claude Code skill");
    expect(addedSkill?.getAttribute("title")).toBe("Claude Code skill");
    const statusCommand = [...container.querySelectorAll(".sidebar-command-row")].find(
      (item) => item.querySelector(".sidebar-command-name")?.textContent === "/status",
    );
    expect(statusCommand).toBeTruthy();
    expect(statusCommand?.querySelector(".sidebar-command-hint")?.textContent).toBe(
      "Show DeskRelay connection and session status",
    );
    expect(statusCommand?.getAttribute("data-full-description")).toBe(
      "Show DeskRelay connection and session status",
    );
    expect(statusCommand?.getAttribute("title")).toBe(
      "Show DeskRelay connection and session status",
    );

    const sessionsTab = [...container.querySelectorAll('[role="tab"]')].find(
      (button) => button.textContent === t("chat.sidebar.tab.sessions"),
    ) as HTMLButtonElement | undefined;
    if (!sessionsTab) throw new Error("sessions tab missing");
    fireEvent.click(sessionsTab);
    const restoredSearch = container.querySelector(".session-search") as HTMLInputElement | null;
    expect(restoredSearch?.value).toBe("Tabbed");

    const permissionsTab = [...container.querySelectorAll('[role="tab"]')].find(
      (button) => button.textContent === t("chat.sidebar.tab.permissions"),
    ) as HTMLButtonElement | undefined;
    if (!permissionsTab) throw new Error("permissions tab missing");
    fireEvent.click(permissionsTab);
    await waitFor(() => {
      expect(container.textContent).toContain("User settings");
      expect(container.textContent).toContain("Project settings");
      expect(container.textContent).toContain("Project local settings");
      expect(container.textContent).toContain("Bash(git status:*)");
      expect(container.textContent).toContain("default");
    });
    expect(container.querySelectorAll(".sidebar-permission-source")).toHaveLength(3);
    const removePermission = container.querySelector(
      `button[aria-label="${t("chat.sidebar.permissions.remove", {
        item: "Bash(git status:*)",
      })}"]`,
    ) as HTMLButtonElement | null;
    if (!removePermission) throw new Error("remove permission button missing");
    fireEvent.click(removePermission);
    const grepPermission = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Grep",
    ) as HTMLButtonElement | undefined;
    if (!grepPermission) throw new Error("grep permission button missing");
    fireEvent.click(grepPermission);
    const savePermission = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("chat.sidebar.permissions.save"),
    ) as HTMLButtonElement | undefined;
    if (!savePermission) throw new Error("save permission button missing");
    fireEvent.click(savePermission);
    await waitFor(() => {
      expect(permissionUpdateParams).toEqual({
        cwd: ".",
        path: "C:\\Users\\darkh\\.claude\\settings.json",
        allow: ["Grep(*)"],
      });
      expect(container.textContent).toContain(t("chat.sidebar.permissions.saved"));
    });
  });

  test("deletes every session in a cwd group from the grouped session list", async () => {
    const cwd = "C:\\Users\\darkh\\Projects\\alpha";
    let sessionRows = [
      {
        sessionId: "sess_alpha_1",
        cwd,
        title: "Alpha one",
        modifiedAt: "2026-04-30T00:00:00.000Z",
        fileSize: 512,
      },
      {
        sessionId: "sess_alpha_2",
        cwd,
        title: "Alpha two",
        modifiedAt: "2026-04-30T00:00:00.000Z",
        fileSize: 512,
      },
    ];
    let deleteByCwdParams: Record<string, unknown> | null = null;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          return new Response(JSON.stringify({ result: sessionRows }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "sessions.deleteByCwd") {
          deleteByCwdParams = body.params ?? null;
          sessionRows = [];
          return new Response(
            JSON.stringify({ result: { cwd, total: 2, deleted: 2, missing: 0 } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Alpha one");
      expect(container.textContent).toContain("Alpha two");
    });

    const deleteGroup = container.querySelector(
      ".session-group-delete",
    ) as HTMLButtonElement | null;
    if (!deleteGroup) throw new Error("group delete button missing");
    fireEvent.click(deleteGroup);
    fireEvent.click(deleteGroup);

    await waitFor(() => {
      expect(deleteByCwdParams).toEqual({ cwd });
      expect(container.textContent).not.toContain("Alpha one");
      expect(container.textContent).not.toContain("Alpha two");
    });
  });

  test("falls back to per-session deletion when a daemon lacks sessions.deleteByCwd", async () => {
    const cwd = "C:\\Users\\darkh\\Projects\\legacy";
    let sessionRows = [
      {
        sessionId: "sess_legacy_1",
        cwd,
        title: "Legacy one",
        modifiedAt: "2026-04-30T00:00:00.000Z",
        fileSize: 512,
      },
      {
        sessionId: "sess_legacy_2",
        cwd,
        title: "Legacy two",
        modifiedAt: "2026-04-30T00:00:00.000Z",
        fileSize: 512,
      },
    ];
    const deleteParams: Array<Record<string, unknown> | null> = [];
    let fallbackListParams: Record<string, unknown> | null = null;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          if (body.params?.cwd === cwd) fallbackListParams = body.params;
          return new Response(JSON.stringify({ result: sessionRows }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "sessions.deleteByCwd") {
          return new Response(
            JSON.stringify({
              error: { code: -32601, message: "method not found: sessions.deleteByCwd" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "sessions.delete") {
          deleteParams.push(body.params ?? null);
          sessionRows = sessionRows.filter((row) => row.sessionId !== body.params?.sessionId);
          return new Response(
            JSON.stringify({ result: { deleted: true, path: "C:\\fake\\session.jsonl" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Legacy one");
      expect(container.textContent).toContain("Legacy two");
    });

    const deleteGroup = container.querySelector(
      ".session-group-delete",
    ) as HTMLButtonElement | null;
    if (!deleteGroup) throw new Error("group delete button missing");
    fireEvent.click(deleteGroup);
    fireEvent.click(deleteGroup);

    await waitFor(() => {
      expect(fallbackListParams).toEqual({ cwd, limit: 10000 });
      expect(deleteParams).toEqual([
        { cwd, sessionId: "sess_legacy_1" },
        { cwd, sessionId: "sess_legacy_2" },
      ]);
      expect(container.textContent).not.toContain("Legacy one");
      expect(container.textContent).not.toContain("Legacy two");
    });
  });

  test("removes an individually deleted session from the grouped session list", async () => {
    const cwd = "C:\\Users\\darkh\\Projects\\solo";
    let sessionRows = [
      {
        sessionId: "sess_solo_1",
        cwd,
        title: "Solo session",
        modifiedAt: "2026-04-30T00:00:00.000Z",
        fileSize: 512,
      },
    ];
    const deleteBySessionIdParams: Array<Record<string, unknown> | null> = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          return new Response(JSON.stringify({ result: sessionRows }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "sessions.deleteBySessionId") {
          deleteBySessionIdParams.push(body.params ?? null);
          sessionRows = [];
          return new Response(
            JSON.stringify({
              result: {
                sessionId: "sess_solo_1",
                total: 1,
                deleted: 1,
                missing: 0,
                paths: ["C:\\fake\\session.jsonl"],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "sessions.delete") {
          return new Response(
            JSON.stringify({ result: { deleted: true, path: "C:\\fake\\session.jsonl" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Solo session");
    });

    const deleteButton = container.querySelector(
      ".session-item-delete",
    ) as HTMLButtonElement | null;
    if (!deleteButton) throw new Error("session delete button missing");
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteBySessionIdParams).toEqual([{ sessionId: "sess_solo_1" }]);
      expect(container.textContent).not.toContain("Solo session");
    });
  });

  test("deletes every duplicate copy of an individually deleted session id", async () => {
    const newestCwd = "C:\\Users\\desktop\\Projects\\current";
    const olderCwd = "C:\\Users\\desktop\\Projects\\older";
    let sessionRows = [
      {
        sessionId: "sess_duplicate",
        cwd: newestCwd,
        title: "Duplicate session",
        modifiedAt: "2026-04-30T01:00:00.000Z",
        fileSize: 512,
      },
      {
        sessionId: "sess_duplicate",
        cwd: olderCwd,
        title: "Duplicate session older copy",
        modifiedAt: "2026-04-30T00:00:00.000Z",
        fileSize: 512,
      },
    ];
    const deleteBySessionIdParams: Array<Record<string, unknown> | null> = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          const rows = body.params?.dedupeSessionIds ? sessionRows.slice(0, 1) : sessionRows;
          return new Response(JSON.stringify({ result: rows }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "sessions.deleteBySessionId") {
          deleteBySessionIdParams.push(body.params ?? null);
          const before = sessionRows.length;
          sessionRows = sessionRows.filter((row) => row.sessionId !== body.params?.sessionId);
          return new Response(
            JSON.stringify({
              result: {
                sessionId: "sess_duplicate",
                total: before,
                deleted: before - sessionRows.length,
                missing: 0,
                paths: ["C:\\fake\\newer.jsonl", "C:\\fake\\older.jsonl"],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "sessions.delete") {
          sessionRows = sessionRows.filter(
            (row) => !(row.cwd === body.params?.cwd && row.sessionId === body.params?.sessionId),
          );
          return new Response(
            JSON.stringify({ result: { deleted: true, path: "C:\\fake\\session.jsonl" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Duplicate session");
      expect(container.textContent).not.toContain("Duplicate session older copy");
    });

    const deleteButton = container.querySelector(
      ".session-item-delete",
    ) as HTMLButtonElement | null;
    if (!deleteButton) throw new Error("session delete button missing");
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteBySessionIdParams).toEqual([{ sessionId: "sess_duplicate" }]);
      expect(container.textContent).not.toContain("Duplicate session");
      expect(sessionRows).toEqual([]);
    });
  });

  test("prefers an online device when the first listed device is stale offline", async () => {
    const stale = { ...OTHER_DEV, label: "Old stale desktop", connectionState: "offline" as const };
    const online = { ...DEV, label: "Current online laptop", connectionState: "online" as const };
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([stale, online]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${online.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${online.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Current online laptop");
    });

    await waitFor(() => {
      expect(
        requestedUrls.some((url) =>
          url.endsWith(`/api/devices/${online.id}/behaviors/remote-claude/request`),
        ),
      ).toBe(true);
    });
    expect(
      requestedUrls.some((url) =>
        url.endsWith(`/api/devices/${stale.id}/behaviors/remote-claude/request`),
      ),
    ).toBe(false);
  });

  test("auto-refreshes an offline selected device until it becomes usable", async () => {
    vi.useFakeTimers();
    let connectionState: "offline" | "online" = "offline";
    let deviceRequests = 0;
    let behaviorRequests = 0;
    let sessionsRequests = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        deviceRequests += 1;
        return new Response(JSON.stringify([{ ...DEV, connectionState }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        behaviorRequests += 1;
        if (connectionState === "offline") {
          return new Response(JSON.stringify({ error: "device not connected" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        if (body.method === "sessions.list") sessionsRequests += 1;
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain(
        t("chat.sidebar.device.offline-prefix", { label: "Fresh Laptop (Local)" }),
      );
    });
    expect(sessionsRequests).toBe(0);

    connectionState = "online";
    await vi.advanceTimersByTimeAsync(1600);

    await waitFor(() => {
      expect(deviceRequests).toBeGreaterThan(1);
      expect(behaviorRequests).toBeGreaterThan(1);
      expect(sessionsRequests).toBeGreaterThan(0);
      expect(container.textContent).toContain("Fresh Laptop");
      expect(container.textContent).not.toContain(
        t("chat.sidebar.device.offline-prefix", { label: "Fresh Laptop (Local)" }),
      );
    });
  });

  test("refreshes the sidebar picker when settings reports a device-list change", async () => {
    let listedDevices: Array<typeof DEV> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify(listedDevices), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    let bumpDevicesRevision!: () => void;
    const Harness = () => {
      const [revision, setRevision] = createSignal(0);
      bumpDevicesRevision = () => setRevision((v) => v + 1);
      return (
        <ChatView
          me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
          onSignOut={vi.fn()}
          onOpenSettings={vi.fn()}
          devicesRevision={revision()}
        />
      );
    };

    const { container } = render(() => <Harness />);

    await waitFor(() => {
      expect(container.textContent).not.toContain("Fresh Laptop");
    });

    listedDevices = [DEV];
    bumpDevicesRevision();

    await waitFor(() => {
      expect(container.textContent).toContain("Fresh Laptop");
    });
  });

  test("activates a newly registered device after the settings refresh includes it", async () => {
    let listedDevices: Array<typeof DEV | typeof OTHER_DEV> = [DEV];
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify(listedDevices), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/behaviors") && method === "GET") {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    let bumpDevicesRevision!: () => void;
    let requestDeviceSelection!: (id: string) => void;
    const Harness = () => {
      const [revision, setRevision] = createSignal(0);
      const [request, setRequest] = createSignal({ id: null as string | null, seq: 0 });
      bumpDevicesRevision = () => setRevision((v) => v + 1);
      requestDeviceSelection = (id) => setRequest((current) => ({ id, seq: current.seq + 1 }));
      return (
        <ChatView
          me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
          onSignOut={vi.fn()}
          onOpenSettings={vi.fn()}
          devicesRevision={revision()}
          requestedDeviceSelection={request()}
        />
      );
    };

    const { container } = render(() => <Harness />);

    await waitFor(() => {
      const picker = container.querySelector("select") as HTMLSelectElement | null;
      expect(picker?.value).toBe(DEV.id);
    });

    listedDevices = [DEV, OTHER_DEV];
    requestDeviceSelection(OTHER_DEV.id);
    bumpDevicesRevision();

    await waitFor(() => {
      const picker = container.querySelector("select") as HTMLSelectElement | null;
      expect(picker?.value).toBe(OTHER_DEV.id);
    });
    expect(
      requestedUrls.some((url) => url.endsWith(`/api/devices/${OTHER_DEV.id}/behaviors`)),
    ).toBe(true);
  });

  test("clears an explicitly selected device when a settings-list remove refetch drops it", async () => {
    let listedDevices = [DEV, OTHER_DEV];
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify(listedDevices), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/behaviors") && method === "GET") {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/fs/roots") && method === "GET") {
        return new Response(JSON.stringify({ mode: "unrestricted", roots: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    let bumpDevicesRevision!: () => void;
    const Harness = () => {
      const [revision, setRevision] = createSignal(0);
      bumpDevicesRevision = () => setRevision((v) => v + 1);
      return (
        <ChatView
          me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
          onSignOut={vi.fn()}
          onOpenSettings={vi.fn()}
          devicesRevision={revision()}
        />
      );
    };

    const { container } = render(() => <Harness />);

    await waitFor(() => {
      expect(container.textContent).toContain(OTHER_DEV.label);
    });
    const picker = container.querySelector("select") as HTMLSelectElement | null;
    if (!picker) throw new Error("device picker missing");
    fireEvent.change(picker, { target: { value: OTHER_DEV.id } });

    listedDevices = [DEV];
    requestedUrls.length = 0;
    bumpDevicesRevision();

    await waitFor(() => {
      expect(container.textContent).not.toContain(OTHER_DEV.label);
    });

    const newChat = container.querySelector(
      `button[aria-label="${t("chat.sidebar.new.button")}"]`,
    ) as HTMLButtonElement | null;
    if (!newChat) throw new Error("new chat button missing");
    fireEvent.click(newChat);

    await waitFor(() => {
      expect(requestedUrls.some((url) => url.includes(`/api/devices/${DEV.id}/fs/roots`))).toBe(
        true,
      );
    });
    expect(requestedUrls.some((url) => url.includes(`/api/devices/${OTHER_DEV.id}/fs/roots`))).toBe(
      false,
    );
  });

  test("retries behavior discovery after a fresh pair until sessions can load", async () => {
    let listedDevices: Array<typeof DEV> = [];
    let behaviorReady = false;
    let sessionsRequests = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify(listedDevices), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        if (!behaviorReady) {
          return new Response(JSON.stringify({ error: "relay not ready" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        if (body.method === "sessions.list") sessionsRequests += 1;
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    let bumpDevicesRevision!: () => void;
    const Harness = () => {
      const [revision, setRevision] = createSignal(0);
      bumpDevicesRevision = () => setRevision((v) => v + 1);
      return (
        <ChatView
          me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
          onSignOut={vi.fn()}
          onOpenSettings={vi.fn()}
          devicesRevision={revision()}
        />
      );
    };

    const { container } = render(() => <Harness />);
    await waitFor(() => {
      expect(container.textContent).not.toContain(DEV.label);
    });

    listedDevices = [DEV];
    bumpDevicesRevision();
    await waitFor(() => {
      expect(container.textContent).toContain(DEV.label);
    });
    expect(sessionsRequests).toBe(0);

    behaviorReady = true;
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await waitFor(() => {
      expect(sessionsRequests).toBeGreaterThan(0);
    });
  });

  test("uses the configured transcript event limit and scrolls selected sessions to the bottom", async () => {
    setChatTranscriptEventLimit(150);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    let readParams: Record<string, unknown> | null = null;
    const events = Array.from({ length: 155 }, (_, i) => ({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: `message ${i}` }],
      },
    }));

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (body.method === "sessions.list") {
          return new Response(
            JSON.stringify({
              result: [
                {
                  sessionId: "sess_many",
                  cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
                  title: "Long session",
                  modifiedAt: "2026-04-30T00:00:00.000Z",
                  fileSize: 4096,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "sessions.read") {
          readParams = body.params ?? null;
          return new Response(
            JSON.stringify({
              result: {
                sessionId: "sess_many",
                cwd: "C:\\Users\\darkh\\Projects\\deskrelay",
                events,
                truncated: true,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Long session");
    });

    const scroller = container.querySelector(".chat > .transcript") as HTMLDivElement | null;
    if (!scroller) throw new Error("transcript scroller missing");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1234 });

    const row = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Long session"),
    ) as HTMLButtonElement | undefined;
    if (!row) throw new Error("session row missing");
    fireEvent.click(row);

    await waitFor(() => {
      expect(readParams?.eventLimit).toBe(150);
      expect(scroller.scrollTop).toBe(1234);
      expect(container.textContent).not.toContain("message 0");
      expect(container.textContent).toContain("message 154");
      expect(container.textContent).toContain(
        t("chat.error.session-event-limited", { count: 150 }),
      );
      expect(container.querySelector(".chat-header-status")?.textContent).toContain(
        t("chat.error.session-event-limited", { count: 150 }),
      );
      expect(container.querySelector(".chat-header-current-status")?.textContent).toContain(
        t("connection.status.online.main"),
      );
      expect(container.querySelector(".composer-status-main")?.textContent ?? "").not.toContain(
        "입력 가능",
      );
      expect(container.querySelector(".composer-status-detail")?.textContent ?? "").not.toContain(
        "대상: 선택된 세션",
      );
      expect(container.querySelector(".composer-status-main")?.textContent ?? "").not.toContain(
        t("connection.status.online.main"),
      );
      expect(container.querySelector(".upstream-banner")?.textContent ?? "").not.toContain(
        t("chat.error.session-event-limited", { count: 150 }),
      );
      expect(container.textContent).not.toContain("8 MiB");
    });
  });

  test("waits for the run SSE stream and scrolls composer sends/live CLI events into view", async () => {
    localStorage.setItem(`cr:device:${DEV.id}:defaultCwd`, "C:\\Users\\darkh\\Projects\\deskrelay");
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const encoder = new TextEncoder();
    const order: string[] = [];
    let behaviorRequests = 0;
    let sessionsListRequests = 0;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let chatParams: ChatRequestParams | undefined;
    const contextUsageSnapshots: Array<unknown> = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([DEV]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${DEV.id}/behaviors`) && method === "GET") {
        behaviorRequests += 1;
        return new Response(
          JSON.stringify([
            {
              instanceId: "remote-claude",
              name: "remote-claude",
              version: "0.0.0-test",
              loadedAt: "2026-04-30T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes(`/api/devices/${DEV.id}/events/spaces/`) && method === "GET") {
        const isRunStream = url.includes("remote-claude.run");
        if (isRunStream) order.push("sse-fetch");
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              if (isRunStream) streamController = controller;
              queueMicrotask(() => {
                if (isRunStream) order.push("sse-open");
                controller.enqueue(encoder.encode(": connected\n\n"));
                if (!isRunStream) controller.close();
              });
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
          params?: unknown;
        };
        if (body.method === "sessions.list") {
          sessionsListRequests += 1;
          return new Response(JSON.stringify({ result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (body.method === "context.usage") {
          return new Response(
            JSON.stringify({
              result: {
                usage: { remainingPercent: 94.1, usedPercent: 5.9, source: "text" },
                eventCount: 3,
                checkedAt: "2026-05-07T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "chat") {
          order.push("chat-request");
          chatParams = body.params as ChatRequestParams;
          streamController?.enqueue(
            encoder.encode(
              'data: {"kind":"claude.event","content":{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1778134800,"rateLimitType":"five_hour","used_percentage":22}}}\n\n',
            ),
          );
          streamController?.enqueue(
            encoder.encode(
              'data: {"kind":"claude.event","content":{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1778739600,"rateLimitType":"weekly","used_percentage":45}}}\n\n',
            ),
          );
          streamController?.enqueue(
            encoder.encode(
              'data: {"kind":"claude.event","content":{"type":"system","subtype":"init","permissionMode":"default","session_id":"sess_live","model":"claude-test"}}\n\n',
            ),
          );
          streamController?.enqueue(
            encoder.encode(
              'data: {"kind":"claude.event","content":{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"live chunk"}}}}\n\n',
            ),
          );
          streamController?.enqueue(
            encoder.encode(
              'data: {"kind":"claude.event","content":{"type":"assistant","message":{"role":"assistant","content":"final string live"}}}\n\n',
            ),
          );
          streamController?.enqueue(
            encoder.encode('data: {"kind":"run.finished","content":{"runId":"r1"}}\n\n'),
          );
          streamController?.close();
          return new Response(
            JSON.stringify({ result: { ok: true, runId: "r1", accepted: true, eventCount: 0 } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <ChatView
        me={{ id: "u1", email: "u@test.local", displayName: "U", authProvider: "token" }}
        onSignOut={vi.fn()}
        onOpenSettings={vi.fn()}
        onContextUsageChange={(usage) => contextUsageSnapshots.push(usage)}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Fresh Laptop");
    });
    await waitFor(() => {
      expect(behaviorRequests).toBeGreaterThan(0);
      expect(sessionsListRequests).toBeGreaterThan(0);
    });

    const permissionSelect = container.querySelector(
      "#permission-mode",
    ) as HTMLSelectElement | null;
    if (!permissionSelect) throw new Error("permission mode picker missing");
    fireEvent.change(permissionSelect, { target: { value: "plan" } });

    const newChat = container.querySelector(
      `button[aria-label="${t("chat.sidebar.new.button")}"]`,
    ) as HTMLButtonElement | null;
    if (!newChat) throw new Error("new chat button missing");
    fireEvent.click(newChat);

    const start = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === t("new-chat.actions.start"),
    );
    if (!start) throw new Error("new chat start button missing");
    fireEvent.click(start);

    const scroller = container.querySelector(".chat > .transcript") as HTMLDivElement | null;
    if (!scroller) throw new Error("transcript scroller missing");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 987 });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    if (!textarea) throw new Error("composer missing");
    const attach = container.querySelector(".composer-attach") as HTMLButtonElement | null;
    if (!attach) throw new Error("attach button missing");
    const chat = container.querySelector(".chat") as HTMLElement | null;
    if (!chat) throw new Error("chat pane missing");
    pasteImage(chat, pngFile("dog.png"));
    await waitFor(() => {
      expect(container.textContent).toContain("dog.png");
    });
    fireEvent.input(textarea, { target: { value: "hello" } });
    const send = container.querySelector(".composer-send") as HTMLButtonElement | null;
    if (!send) throw new Error("send button missing");
    fireEvent.click(send);
    await waitFor(() => {
      expect(container.querySelector(".attachment-chip")).toBeNull();
    });

    await waitFor(() => {
      expect(container.textContent).toContain("hello");
      expect(scroller.scrollTop).toBe(987);
    });

    await waitFor(
      () => {
        expect(order).toContain("chat-request");
      },
      { timeout: 4000 },
    );
    expect(order.indexOf("sse-open")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("sse-open")).toBeLessThan(order.indexOf("chat-request"));
    expect(chatParams?.attachments?.[0]?.name).toBe("dog.png");
    expect(chatParams?.permissionMode).toBe("plan");
    await waitFor(() => {
      expect(container.textContent).toContain("final string live");
      expect(container.textContent).toContain(
        t("pm.status.mismatch", { actual: "default", requested: "plan" }),
      );
      expect(permissionSelect.value).toBe("default");
      expect(scroller.scrollTop).toBe(987);
    });
    await waitFor(() => {
      expect(contextUsageSnapshots).toContainEqual({
        ctx: expect.objectContaining({
          remainingPercent: 94.1,
          usedPercent: 5.9,
          source: "text",
        }),
        session: expect.objectContaining({
          remainingPercent: 78,
          usedPercent: 22,
          source: "event",
          resetAt: "2026-05-07T06:20:00.000Z",
          rateLimitType: "five_hour",
        }),
        week: expect.objectContaining({
          remainingPercent: 55,
          usedPercent: 45,
          source: "event",
          resetAt: "2026-05-14T06:20:00.000Z",
          rateLimitType: "weekly",
        }),
      });
    });
  });
});
