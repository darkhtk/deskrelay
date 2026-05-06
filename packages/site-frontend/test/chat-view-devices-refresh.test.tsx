import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ChatView } from "../src/components/ChatView.tsx";

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
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatView device refresh bridge", () => {
  test("loads sessions for the default selected device on first site load", async () => {
    const requestedUrls: string[] = [];
    let sessionsRequests = 0;
    let sessionsListParams: Record<string, unknown> | null = null;
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
        }
        return new Response(
          JSON.stringify({
            result: [
              {
                sessionId: "sess_initial_1",
                cwd: "C:\\Users\\darkh\\Projects\\claude-remote-platform",
                title: "Initial session loaded",
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
      expect(container.textContent).toContain("Fresh Laptop");
      expect(container.textContent).toContain("Initial session loaded");
    });
    expect(sessionsRequests).toBe(1);
    expect(sessionsListParams).toMatchObject({ limit: 200, dedupeSessionIds: true });
    expect(requestedUrls.some((url) => url.endsWith(`/api/devices/${DEV.id}/behaviors`))).toBe(
      true,
    );
    expect(
      requestedUrls.some((url) =>
        url.endsWith(`/api/devices/${DEV.id}/behaviors/remote-claude/request`),
      ),
    ).toBe(true);
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
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
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
      'button[aria-label="New chat"]',
    ) as HTMLButtonElement | null;
    if (!newChat) throw new Error("new chat button missing");
    fireEvent.click(newChat);

    await waitFor(() => {
      const input = container.querySelector("#new-chat-cwd") as HTMLInputElement | null;
      expect(input?.value).toBe("C:\\Users\\darkh\\saved-default");
    });
  });

  test("keeps session search state while switching sidebar tabs and shows read-only CLI data", async () => {
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
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        if (body.method === "slashCommands") {
          return new Response(
            JSON.stringify({
              result: {
                slashCommands: ["/status"],
                skills: ["deep-review"],
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
                ],
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
    expect(container.querySelector(".session-search")).toBeNull();

    const searchToggle = container.querySelector(
      'button[aria-label="Toggle session search"]',
    ) as HTMLButtonElement | null;
    if (!searchToggle) throw new Error("session search toggle missing");
    fireEvent.click(searchToggle);

    const searchInput = container.querySelector(".session-search") as HTMLInputElement | null;
    if (!searchInput) throw new Error("session search input missing");
    fireEvent.input(searchInput, { target: { value: "Tabbed" } });

    const skillsTab = [...container.querySelectorAll('[role="tab"]')].find(
      (button) => button.textContent === "Skills",
    ) as HTMLButtonElement | undefined;
    if (!skillsTab) throw new Error("skills tab missing");
    fireEvent.click(skillsTab);
    await waitFor(() => {
      expect(container.textContent).toContain("deep-review");
      expect(container.textContent).toContain("/status");
    });

    const sessionsTab = [...container.querySelectorAll('[role="tab"]')].find(
      (button) => button.textContent === "Sessions",
    ) as HTMLButtonElement | undefined;
    if (!sessionsTab) throw new Error("sessions tab missing");
    fireEvent.click(sessionsTab);
    const restoredSearch = container.querySelector(".session-search") as HTMLInputElement | null;
    expect(restoredSearch?.value).toBe("Tabbed");

    const permissionsTab = [...container.querySelectorAll('[role="tab"]')].find(
      (button) => button.textContent === "Permissions",
    ) as HTMLButtonElement | undefined;
    if (!permissionsTab) throw new Error("permissions tab missing");
    fireEvent.click(permissionsTab);
    await waitFor(() => {
      expect(container.textContent).toContain("User settings");
      expect(container.textContent).toContain("Bash(git status:*)");
      expect(container.textContent).toContain("default");
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
      expect(container.textContent).toContain("Fresh Laptop (Local) (offline)");
    });
    expect(sessionsRequests).toBe(0);

    connectionState = "online";
    await vi.advanceTimersByTimeAsync(1600);

    await waitFor(() => {
      expect(deviceRequests).toBeGreaterThan(1);
      expect(behaviorRequests).toBeGreaterThan(1);
      expect(sessionsRequests).toBeGreaterThan(0);
      expect(container.textContent).toContain("Fresh Laptop");
      expect(container.textContent).not.toContain("Fresh Laptop (Local) (offline)");
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
      'button[aria-label="New chat"]',
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

  test("loads only the latest 100 events and scrolls selected sessions to the bottom", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    let readParams: Record<string, unknown> | null = null;
    const events = Array.from({ length: 105 }, (_, i) => ({
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
                  cwd: "C:\\Users\\darkh\\Projects\\claude-remote-platform",
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
                cwd: "C:\\Users\\darkh\\Projects\\claude-remote-platform",
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
      expect(readParams?.eventLimit).toBe(100);
      expect(scroller.scrollTop).toBe(1234);
      expect(container.textContent).not.toContain("message 0");
      expect(container.textContent).toContain("message 104");
      expect(container.textContent).toContain("latest 100 transcript events");
      expect(container.textContent).not.toContain("8 MiB");
    });
  });

  test("waits for the run SSE stream and scrolls composer sends/live CLI events into view", async () => {
    localStorage.setItem(
      `cr:device:${DEV.id}:defaultCwd`,
      "C:\\Users\\darkh\\Projects\\claude-remote-platform",
    );
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
        if (body.method === "chat") {
          order.push("chat-request");
          chatParams = body.params as ChatRequestParams;
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
      'button[aria-label="New chat"]',
    ) as HTMLButtonElement | null;
    if (!newChat) throw new Error("new chat button missing");
    fireEvent.click(newChat);

    const start = [...container.querySelectorAll("button")].find((b) => b.textContent === "Start");
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
      expect(container.textContent).toContain("permission mode: default");
      expect(container.textContent).toContain("requested plan");
      expect(permissionSelect.value).toBe("default");
      expect(scroller.scrollTop).toBe(987);
    });
  });
});
