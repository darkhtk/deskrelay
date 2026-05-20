import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ManagerAssistant } from "../src/components/ManagerAssistant.tsx";
import { setLocale } from "../src/i18n.ts";

const SERVER_DEVICE = {
  id: "dev_server",
  label: "Local dev (HOMEDEV)",
  daemonUrl: "http://127.0.0.1:18191",
  registeredAt: "2026-05-13T00:00:00.000Z",
  connectionState: "online" as const,
};

function pngFile(name = "clip.png", size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setLocale("ko");
});

describe("ManagerAssistant", () => {
  test("renders manager transcript markdown without role labels", async () => {
    setLocale("en");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-md",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-md",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Session",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          return Response.json({
            result: {
              sessionId: "manager-session-md",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: "**Bold answer**\n\n- first item\n- second item",
                      },
                    ],
                  },
                },
              ],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    await waitFor(() => {
      expect(
        document.querySelector(".manager-assistant-dialogue-markdown strong")?.textContent,
      ).toBe("Bold answer");
    });
    expect(document.querySelectorAll(".manager-assistant-dialogue-markdown li")).toHaveLength(2);
    expect(document.querySelector(".manager-assistant-dialogue-role")).toBeNull();
  });

  test("renders manager conversation messages stored by another browser", async () => {
    setLocale("en");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          revision: 7,
          updatedAt: "2026-05-13T00:00:00.000Z",
          messages: [
            {
              id: "remote-user",
              role: "user",
              text: "Remote browser request",
              createdAt: "2026-05-13T00:00:00.000Z",
            },
            {
              id: "remote-assistant",
              role: "assistant",
              text: "**Remote answer**",
              createdAt: "2026-05-13T00:00:01.000Z",
            },
          ],
        });
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        return Response.json({ result: [] });
      }
      if (url.includes("/api/manager/assistant/status")) {
        return Response.json({ generatedAt: "2026-05-13T00:00:00.000Z", reports: [] });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain("Remote browser request");
    });
    expect(document.querySelector(".manager-assistant-dialogue-markdown strong")?.textContent).toBe(
      "Remote answer",
    );
    const tags = Array.from(document.querySelectorAll(".manager-assistant-dialogue-tag")).map(
      (tag) => tag.textContent,
    );
    expect(tags).toContain("외부 브라우저");
    expect(tags).toContain("Markdown");
    expect(tags).not.toContain("요청");
    expect(tags).not.toContain("응답");
    expect(tags).not.toContain("세션 기록");
  });

  test("renders collapsed manager previews as markdown without embedding detailed logs", async () => {
    setLocale("en");
    const markdownText = [
      "**Summary**",
      "",
      "- one",
      "- two",
      "",
      '"```ts"',
      "const answer: number = 42;",
      '"```"',
      "",
      "| Axis | Result |",
      "|---|---|",
      "| Markdown | rendered |",
      "",
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
    ].join("\n");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-collapsed-md",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-collapsed-md",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Session",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          return Response.json({
            result: {
              sessionId: "manager-session-collapsed-md",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: markdownText }],
                  },
                },
              ],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    await waitFor(() => {
      expect(
        document.querySelector(".manager-assistant-dialogue-preview strong")?.textContent,
      ).toBe("Summary");
    });
    const preview = document.querySelector(".manager-assistant-dialogue-preview");
    expect(preview?.textContent).not.toContain("**Summary**");
    expect(preview?.querySelectorAll("li")).toHaveLength(2);
    expect(document.querySelector(".manager-assistant-dialogue-details")).toBeNull();
    expect(document.querySelector(".manager-assistant-dialogue-full")).toBeNull();
    expect(document.body.textContent).not.toContain("const answer: number = 42;");
    expect(document.body.textContent).not.toContain("Markdown rendered");
  });

  test("hides internal task notifications and routine manager chatter", async () => {
    setLocale("en");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-filter-noise",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-filter-noise",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Session",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          return Response.json({
            result: {
              sessionId: "manager-session-filter-noise",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [
                {
                  type: "user",
                  message: {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: '<task-notification><task-id>abc</task-id><summary>Monitor event: "internal"</summary><event>STEP=dispatch round task_abc123</event></task-notification>',
                      },
                    ],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "Monitor 종료 — worker background running." }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "healthz polling 시작 (10회)." }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "2/10 polling: worker heartbeat 확인 중" }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "폴링 66회." }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "1차 timeout." }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "10/10 모두 timeout. 마지막 로그 대기." }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: "dispatch 성공 — round_abc123XYZ, task 상세 대기.",
                      },
                    ],
                  },
                },
                {
                  type: "user",
                  message: {
                    role: "user",
                    content: [{ type: "text", text: "Next polish plan" }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: "## Plan\n\n- Add stage 6\n- Rebuild playable exe",
                      },
                    ],
                  },
                },
              ],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain("Next polish plan");
    });
    expect(document.body.textContent).toContain("Add stage 6");
    expect(document.querySelectorAll(".manager-assistant-dialogue-markdown li")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("task-notification");
    expect(document.body.textContent).not.toContain("Monitor 종료");
    expect(document.body.textContent).not.toContain("healthz polling");
    expect(document.body.textContent).not.toContain("2/10 polling");
    expect(document.body.textContent).not.toContain("폴링 66회");
    expect(document.body.textContent).not.toContain("1차 timeout");
    expect(document.body.textContent).not.toContain("10/10 모두 timeout");
    expect(document.body.textContent).not.toContain("round_abc123XYZ");
    expect(document.body.textContent).not.toContain("task 상세 대기");
  });

  test("keeps a streamed manager reply visible when the refreshed transcript is stale", async () => {
    setLocale("ko");
    let sessionsListCount = 0;
    let sessionReadCount = 0;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-stale",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes("/api/manager/assistant/status")) {
        return Response.json({ generatedAt: "2026-05-13T00:00:00.000Z", reports: [] });
      }
      if (url.includes("/api/manager/assistant/chat/stream") && init?.method === "POST") {
        return new Response(
          [
            `data: ${JSON.stringify({
              type: "status",
              status: { phase: "running", tone: "thinking", main: "생각 중" },
            })}`,
            `data: ${JSON.stringify({
              type: "message",
              message: {
                id: "manager-message-stale",
                role: "assistant",
                text: "즉시 보이는 새 응답",
                createdAt: "2026-05-13T00:00:02.000Z",
              },
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              command: "manager assistant",
              durationMs: 12,
              sessionId: "manager-session-stale",
            })}`,
            "",
          ].join("\n\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as { method?: string };
        if (body.method === "sessions.list") {
          sessionsListCount += 1;
          return Response.json({
            result: [
              {
                sessionId: "manager-session-stale",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Session",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          sessionReadCount += 1;
          return Response.json({
            result: {
              sessionId: "manager-session-stale",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "이전 관리자 응답" }],
                  },
                },
              ],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    const input = await screen.findByPlaceholderText(/관리자에게 보내기/);
    await waitFor(() => {
      expect(document.body.textContent).toContain("입력 가능");
    });
    await waitFor(() => {
      expect(sessionsListCount).toBeGreaterThan(0);
    });

    fireEvent.input(input, { target: { value: "현재 상태 알려줘" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(document.body.textContent).toContain("즉시 보이는 새 응답");
    });
    await waitFor(() => {
      expect(sessionReadCount).toBeGreaterThan(1);
    });
    expect(document.body.textContent).toContain("즉시 보이는 새 응답");
  });

  test("keeps long manager waits as thinking status instead of transcript errors", async () => {
    setLocale("ko");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-long-wait",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes("/api/manager/assistant/status")) {
        return Response.json({ generatedAt: "2026-05-13T00:00:00.000Z", reports: [] });
      }
      if (url.includes("/api/manager/assistant/chat/stream") && init?.method === "POST") {
        return new Response(
          [
            `data: ${JSON.stringify({
              type: "status",
              status: { phase: "running", tone: "thinking", main: "생각 중" },
            })}`,
            `data: ${JSON.stringify({
              type: "error",
              error: "Manager assistant CLI timed out after 600000ms.",
            })}`,
            "",
          ].join("\n\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as { method?: string };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-long-wait",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Session",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          return Response.json({
            result: {
              sessionId: "manager-session-long-wait",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    const input = await screen.findByPlaceholderText(/관리자에게 보내기/);
    fireEvent.input(input, { target: { value: "계속 진행" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(document.body.textContent).toContain("생각 중");
    });
    expect(document.body.textContent).not.toContain("Manager assistant CLI timed out");
    expect(document.body.textContent).not.toContain("관리자 Assistant 오류");
  });

  test("pastes image attachments into the manager composer and sends them", async () => {
    setLocale("ko");
    const capturedRequests: Array<{
      message?: string;
      attachments?: Array<{ name?: string }>;
    }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-paste",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes("/api/manager/assistant/status")) {
        return Response.json({ generatedAt: "2026-05-13T00:00:00.000Z", reports: [] });
      }
      if (url.includes("/api/manager/assistant/chat/stream") && init?.method === "POST") {
        capturedRequests.push(JSON.parse(String(init.body ?? "{}")));
        return new Response(
          [
            `data: ${JSON.stringify({
              type: "message",
              message: {
                id: "manager-image-reply",
                role: "assistant",
                text: "이미지 확인했습니다.",
                createdAt: "2026-05-13T00:00:02.000Z",
              },
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              command: "manager assistant",
              durationMs: 12,
              sessionId: "manager-session-paste",
            })}`,
            "",
          ].join("\n\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as { method?: string };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-paste",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Session",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          return Response.json({
            result: {
              sessionId: "manager-session-paste",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    const { container } = render(() => (
      <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />
    ));

    const composer = await screen.findByPlaceholderText(/관리자에게 보내기/);
    pasteImage(composer, pngFile("clipboard.png"));
    await waitFor(() => {
      expect(container.textContent).toContain("clipboard.png");
    });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(capturedRequests.at(-1)?.attachments?.[0]?.name).toBe("clipboard.png");
    });
    expect(capturedRequests.at(-1)?.message).toBe("");
    await waitFor(() => {
      expect(container.querySelector(".attachment-chip")).toBeNull();
    });
    expect(document.body.textContent).toContain("이미지 확인했습니다.");
  });

  test("reports when a manager run ends without a visible final answer", async () => {
    setLocale("ko");
    let behaviorRequests = 0;
    let sessionsReadRequests = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-no-final",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes("/api/manager/assistant/status")) {
        return Response.json({ generatedAt: "2026-05-13T00:00:00.000Z", reports: [] });
      }
      if (url.includes("/api/manager/assistant/chat/stream") && init?.method === "POST") {
        return new Response(
          [
            `data: ${JSON.stringify({
              type: "message",
              message: {
                id: "manager-no-final",
                role: "assistant",
                text: "No response requested.",
                createdAt: "2026-05-13T00:00:02.000Z",
              },
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              command: "manager assistant",
              durationMs: 12,
              sessionId: "manager-session-no-final",
            })}`,
            "",
          ].join("\n\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        behaviorRequests += 1;
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as { method?: string };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-no-final",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Session",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          sessionsReadRequests += 1;
          return Response.json({
            result: {
              sessionId: "manager-session-no-final",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    const input = await screen.findByPlaceholderText(/관리자에게 보내기/);
    await waitFor(() => {
      expect(behaviorRequests).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(sessionsReadRequests).toBeGreaterThan(0);
    });
    fireEvent.input(input, { target: { value: "진행해" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(document.body.textContent).toContain("최종 보고 없이");
    });
    expect(document.body.textContent).not.toContain("No response requested");
  });

  test("keeps empty manager replies out of the transcript", async () => {
    setLocale("en");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-1",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-1",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Manager",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          return Response.json({
            result: {
              sessionId: "manager-session-1",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [
                {
                  type: "user",
                  message: {
                    role: "user",
                    content: [{ type: "text", text: "Continue from where you left off." }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "No response requested." }],
                  },
                },
              ],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    await waitFor(() => {
      expect(document.querySelector(".manager-assistant-transcript-empty")).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain("The manager response was empty.");
    expect(document.body.textContent).not.toContain("No response requested");
  });

  test("does not surface tool results as manager dialogue summaries", async () => {
    setLocale("en");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/assistant/conversation")) {
        return Response.json({
          conversationId: "deskrelay-manager-assistant",
          sessionId: "manager-session-tool-result",
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          updatedAt: "2026-05-13T00:00:00.000Z",
        });
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "sessions.list") {
          return Response.json({
            result: [
              {
                sessionId: "manager-session-tool-result",
                cwd: "C:\\repo\\.deskrelay\\manager-assistant",
                title: "Manager",
                modifiedAt: "2026-05-13T00:00:00.000Z",
              },
            ],
          });
        }
        if (body.method === "sessions.read") {
          return Response.json({
            result: {
              sessionId: "manager-session-tool-result",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              events: [
                {
                  type: "user",
                  message: {
                    role: "user",
                    content: [{ type: "text", text: "니가 해결하렴" }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "알겠습니다. 작업자를 호출하겠습니다." }],
                  },
                },
                {
                  type: "assistant",
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "tool_use",
                        id: "tool_1",
                        name: "Agent",
                        input: { description: "work" },
                      },
                    ],
                  },
                },
                {
                  type: "user",
                  message: {
                    role: "user",
                    content: [
                      {
                        type: "tool_result",
                        tool_use_id: "tool_1",
                        content: "result: worker finished and all checks passed",
                      },
                    ],
                  },
                },
              ],
            },
          });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => <ManagerAssistant devices={[SERVER_DEVICE]} showOrchestrationPanel={false} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain("알겠습니다. 작업자를 호출하겠습니다.");
    });
    expect(document.body.textContent).not.toContain("result: worker finished and all checks passed");
    expect(document.body.textContent).not.toContain("마지막 도구 결과 요약");
  });

  test("uses the normal remote-claude behavior session path instead of browser chat storage", async () => {
    const behaviorCalls: Array<{ method?: string; params?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/manager/assistant/workspace")) {
        return Response.json({
          cwd: "C:\\repo\\.deskrelay\\manager-assistant",
          instructionsPath: "C:\\repo\\.deskrelay\\manager-assistant\\CLAUDE.md",
          repoRoot: "C:\\repo",
          deviceId: SERVER_DEVICE.id,
          deviceLabel: SERVER_DEVICE.label,
        });
      }
      if (url.includes("/api/manager/sessions/hygiene")) {
        return Response.json({
          generatedAt: "2026-05-13T00:00:00.000Z",
          managerCwd: "C:\\repo\\.deskrelay\\manager-assistant",
          managerSessionId: "manager-session-1",
          summary: {
            total: 2,
            preserved: 1,
            cleanupCandidates: 1,
            currentManagerSession: "manager-session-1",
            categories: {
              current_manager: 1,
              manager_history: 0,
              internal_only: 1,
              worker_session: 0,
              orphan: 0,
              unreadable: 0,
              unknown: 0,
            },
          },
          items: [
            {
              deviceId: SERVER_DEVICE.id,
              deviceLabel: SERVER_DEVICE.label,
              behaviorInstanceId: "remote-claude",
              sessionId: "manager-session-1",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              title: "Current manager",
              modifiedAt: "2026-05-13T00:00:00.000Z",
              category: "current_manager",
              action: "preserve",
              reason: "current persistent manager assistant conversation",
            },
            {
              deviceId: SERVER_DEVICE.id,
              deviceLabel: SERVER_DEVICE.label,
              behaviorInstanceId: "remote-claude",
              sessionId: "internal-context",
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              title: "/context",
              modifiedAt: "2026-05-13T00:00:00.000Z",
              category: "internal_only",
              action: "cleanup",
              reason: "manager cwd session created by a local command/status probe",
            },
          ],
          errors: [],
        });
      }
      if (url.includes("/api/manager/agents")) {
        return Response.json({
          generatedAt: "2026-05-13T00:00:00.000Z",
          agents: [
            {
              id: "agent_architect",
              role: "architect",
              label: "Architect agent",
              profile: "claude-code",
              status: "running",
              roundId: "round_r1",
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/manager/rounds")) {
        if (url.includes("/api/manager/rounds/round_r1/report")) {
          return Response.json({
            round: {
              id: "round_r1",
              title: "R1",
              objective: "Test orchestration",
              status: "running",
              agentIds: ["agent_architect"],
              taskIds: ["task_1"],
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:01.000Z",
              startedAt: "2026-05-13T00:00:01.000Z",
            },
            agents: [],
            tasks: [
              {
                id: "task_1",
                kind: "run-worker",
                state: "running",
                dryRun: false,
                requestedBy: "manager-assistant",
                createdAt: "2026-05-13T00:00:01.000Z",
                updatedAt: "2026-05-13T00:00:02.000Z",
                startedAt: "2026-05-13T00:00:02.000Z",
                steps: [],
                result: { stdout: "Updated PROTOCOL.md" },
              },
            ],
            summary: "R1 running.",
          });
        }
        return Response.json({
          generatedAt: "2026-05-13T00:00:00.000Z",
          rounds: [
            {
              id: "round_r1",
              title: "R1",
              objective: "Test orchestration",
              status: "running",
              agentIds: ["agent_architect"],
              taskIds: [],
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors`) && init?.method !== "POST") {
        return Response.json([
          {
            instanceId: "remote-claude",
            name: "remote-claude",
            version: "0.0.1",
            loadedAt: "2026-05-13T00:00:00.000Z",
          },
        ]);
      }
      if (url.includes("/api/manager/assistant/chat/stream") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        behaviorCalls.push({ method: "chat", params: body });
        return new Response(
          [
            `data: ${JSON.stringify({
              type: "status",
              status: { phase: "running", tone: "thinking", main: "thinking" },
            })}`,
            `data: ${JSON.stringify({
              type: "claude_event",
              event: { type: "system", subtype: "init", session_id: "manager-session-1" },
            })}`,
            `data: ${JSON.stringify({
              type: "claude_event",
              event: {
                type: "assistant",
                message: { content: [{ type: "text", text: "관리자 응답" }] },
              },
            })}`,
            `data: ${JSON.stringify({
              type: "message",
              message: {
                id: "manager-message-1",
                role: "assistant",
                text: "관리자 응답",
                createdAt: "2026-05-13T00:00:02.000Z",
              },
              cwd: "C:\\repo\\.deskrelay\\manager-assistant",
              command: "manager assistant",
              durationMs: 12,
              sessionId: "manager-session-1",
            })}`,
            "",
          ].join("\n\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (
        url.includes(`/api/devices/${SERVER_DEVICE.id}/behaviors/remote-claude/request`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          method?: string;
          params?: Record<string, unknown>;
        };
        behaviorCalls.push(body);
        if (body.method === "sessions.list") return Response.json({ result: [] });
        if (body.method === "chat") {
          return Response.json({ result: { ok: true, runId: body.params?.runId, accepted: true } });
        }
        return Response.json({ result: {} });
      }
      return Response.json({ ok: true });
    });

    render(() => (
      <ManagerAssistant
        devices={[SERVER_DEVICE]}
        showOrchestrationPanel={false}
        context={{
          deviceId: "dev_selected",
          deviceLabel: "Remote PC",
          sessionId: "selected-session",
          cwd: "C:\\work",
        }}
      />
    ));

    const input = await screen.findByPlaceholderText(/관리자에게 보내기/);
    await waitFor(() => {
      expect(behaviorCalls.some((call) => call.method === "sessions.list")).toBe(true);
    });
    await waitFor(() => {
      expect(document.body.textContent).toContain("입력 가능");
    });
    const presetButton = screen.getByRole("button", { name: "Orchestration" }) as HTMLButtonElement;
    expect(presetButton.disabled).toBe(false);
    fireEvent.click(presetButton);
    await waitFor(() => {
      expect(
        behaviorCalls.some(
          (call) =>
            call.method === "chat" &&
            String(call.params?.message ?? "").includes("orchestration framework loop"),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(presetButton.disabled).toBe(false);
    });
    fireEvent.input(input, { target: { value: "현재 상태 확인" } });
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(document.body.textContent).toContain("관리자 응답");
    });

    await waitFor(() => {
      expect(behaviorCalls.filter((call) => call.method === "chat")).toHaveLength(2);
    });
    const chatCall = behaviorCalls.filter((call) => call.method === "chat").at(-1);
    expect(chatCall?.params?.context).toMatchObject({
      deviceId: "dev_selected",
      sessionId: "selected-session",
    });
    expect(window.localStorage.getItem("cr.manager-assistant.messages:v2")).toBeNull();
  });
});
