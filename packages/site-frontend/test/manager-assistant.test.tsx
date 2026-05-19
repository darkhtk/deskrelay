import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
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

  test("keeps collapsed previews plain while rendering full manager markdown", async () => {
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
      expect(document.querySelector(".manager-assistant-dialogue-preview")?.textContent).toContain(
        "**Summary**",
      );
    });
    const preview = document.querySelector(".manager-assistant-dialogue-preview");
    expect(preview?.querySelector("strong")).toBeNull();
    expect(
      document.querySelector(".manager-assistant-dialogue-full pre code")?.textContent,
    ).toContain("const answer: number = 42;");
    expect(document.querySelector(".manager-assistant-dialogue-full table")).toBeTruthy();
    expect(document.querySelector(".manager-assistant-dialogue-full strong")?.textContent).toBe(
      "Summary",
    );
  });

  test("keeps a streamed manager reply visible when the refreshed transcript is stale", async () => {
    setLocale("ko");
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

    fireEvent.input(input, { target: { value: "현재 상태 알려줘" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(document.body.textContent).toContain("즉시 보이는 새 응답");
    });
    await waitFor(() => {
      expect(sessionReadCount).toBeGreaterThan(1);
    });
    expect(document.body.textContent).toContain("즉시 보이는 새 응답");
  });

  test("shows a clear transcript entry when the manager returns no visible reply", async () => {
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
      expect(document.body.textContent).toContain("The manager response was empty.");
    });
    expect(document.body.textContent).not.toContain("No response requested");
  });

  test("shows the latest tool result when the manager has not produced a final reply yet", async () => {
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
      expect(document.body.textContent).toContain("result: worker finished and all checks passed");
    });
    expect(document.body.textContent).toContain("마지막 도구 결과 요약");
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
