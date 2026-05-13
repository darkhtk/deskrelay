import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ManagerAssistant } from "../src/components/ManagerAssistant.tsx";

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
});

describe("ManagerAssistant", () => {
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
      if (url.includes("/events/spaces/remote-claude.run%3A")) {
        return new Response(
          [
            `data: ${JSON.stringify({
              kind: "run.started",
              content: { runId: "r1" },
            })}`,
            `data: ${JSON.stringify({
              kind: "claude.event",
              content: { type: "system", subtype: "init", session_id: "manager-session-1" },
            })}`,
            `data: ${JSON.stringify({
              kind: "claude.event",
              content: {
                type: "assistant",
                message: { content: [{ type: "text", text: "관리자 응답" }] },
              },
            })}`,
            `data: ${JSON.stringify({ kind: "run.finished", content: { exitCode: 0 } })}`,
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
      expect(document.body.textContent).toContain("R1");
      expect(document.body.textContent).toContain("Details");
      expect(document.body.textContent).not.toContain("Overview");
    });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("Overview");
      expect(document.body.textContent).toContain("Agents");
    });
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("architect");
    });
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("flowchart TD");
      expect(document.body.textContent).toContain("Manager Supervisor");
    });
    fireEvent.click(screen.getByRole("button", { name: "Artifacts" }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("PROTOCOL.md");
    });
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    await waitFor(() => {
      expect(document.body.textContent).toContain("관리자 대기 중");
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
      expect(
        behaviorCalls.some((call) => call.method === "chat" && call.params?.managerMode === true),
      ).toBe(true);
    });
    const chatCall = behaviorCalls.find(
      (call) => call.method === "chat" && call.params?.managerMode === true,
    );
    expect(chatCall?.params?.managerMode).toBe(true);
    expect(chatCall?.params?.permissionMode).toBe("bypassPermissions");
    expect(chatCall?.params?.conversationId).toBe("deskrelay-manager-assistant");
    expect(chatCall?.params?.cwd).toBe("C:\\repo\\.deskrelay\\manager-assistant");
    expect(chatCall?.params?.managerBrowserContext).toMatchObject({
      deviceId: "dev_selected",
      sessionId: "selected-session",
    });
    expect(window.localStorage.getItem("cr.manager-assistant.messages:v2")).toBeNull();
  });
});
