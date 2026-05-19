import type {
  ManagerAgent,
  ManagerCommandFlowResponse,
  ManagerOrchestrationSnapshot,
} from "@deskrelay/shared";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ManagerOrchestrationPanel } from "../src/components/ManagerOrchestrationPanel.tsx";
import { setLocale, t } from "../src/i18n.ts";

beforeEach(() => {
  setLocale("en");
  window.localStorage.clear();
});

afterEach(() => {
  setLocale("ko");
  window.localStorage.clear();
});

describe("ManagerOrchestrationPanel agents view", () => {
  test("separates the current step from the required action in the judgment card", () => {
    const commandFlow = {
      generatedAt: "2026-05-18T00:10:00.000Z",
      nextAction: { kind: "review", label: "Review round result" },
      readiness: {
        ready: true,
        stage: "review",
        missingProtocolFiles: [],
        warnings: [],
        userCheckRequired: false,
      },
      judgments: [],
    } as unknown as ManagerCommandFlowResponse;

    render(() => (
      <ManagerOrchestrationPanel
        rounds={[]}
        agents={[]}
        standalone
        commandFlow={commandFlow}
      />
    ));

    const currentJudgment = screen.getByLabelText("Workboard current judgment");
    expect(currentJudgment.textContent).toContain("Current step");
    expect(currentJudgment.textContent).toContain("Review round result");
    expect(currentJudgment.textContent).toContain("Required action");
    expect(currentJudgment.textContent).toContain(
      'Confirm "Review round result" is the right step',
    );
    expect(currentJudgment.textContent).not.toContain("The manager's next action");
  });

  test("renders the authoritative orchestration snapshot as a localized flowchart", () => {
    setLocale("ko");
    const now = "2026-05-18T00:10:00.000Z";
    const snapshot: ManagerOrchestrationSnapshot = {
      projectId: "project-centerline",
      phase: "needs_approval",
      currentLabel: "Approval required",
      currentReason: "1 approval action is available after preflight.",
      flowStage: "review",
      activeTaskIds: ["task-worker"],
      activeAgentIds: ["agent-worker"],
      approvalActions: [
        {
          id: "action-review",
          sourceJudgmentId: "judgment-review",
          type: "review_round",
          title: "Summarize round result",
          description: "Accept the current round result.",
          risk: "low",
          requiresApproval: true,
          target: { projectId: "project-centerline", roundId: "round-1" },
          status: "available",
          preflight: {
            valid: true,
            validWhen: ["active round is completed"],
            checkedAt: now,
          },
          payload: { roundId: "round-1" },
          evidenceIds: [],
          createdAt: now,
        },
        {
          id: "action-stale",
          type: "retry_task",
          title: "Retry old task",
          description: "Retry a stale task.",
          risk: "medium",
          requiresApproval: true,
          target: { projectId: "project-centerline", taskId: "task-old" },
          status: "stale",
          preflight: {
            valid: false,
            validWhen: ["target task is retryable"],
            checkedAt: now,
            failureReason: "The target task is already completed.",
          },
          payload: { taskId: "task-old" },
          evidenceIds: [],
          createdAt: now,
        },
      ],
      flow: [
        { id: "flow.planning", phase: "planning", label: "Planning", status: "done" },
        { id: "flow.ready", phase: "ready", label: "Ready", status: "done" },
        { id: "flow.running", phase: "running", label: "Running", status: "done" },
        { id: "flow.observing", phase: "observing", label: "Observing", status: "done" },
        {
          id: "flow.needs_approval",
          phase: "needs_approval",
          label: "Approval",
          status: "current",
          detail: "Summarize round result",
        },
        {
          id: "flow.applying_action",
          phase: "applying_action",
          label: "Applying action",
          status: "pending",
        },
        { id: "flow.reviewing", phase: "reviewing", label: "Review", status: "pending" },
        { id: "flow.replanning", phase: "replanning", label: "Replan", status: "pending" },
        { id: "flow.completed", phase: "completed", label: "Complete", status: "pending" },
        { id: "flow.blocked", phase: "blocked", label: "Blocked", status: "pending" },
      ],
      workers: [
        {
          id: "run-worker",
          runtimeState: "active",
          taskState: "running",
          label: "Worker",
          taskId: "task-worker",
          agentId: "agent-worker",
          updatedAt: now,
          integrity: [],
        },
      ],
      blockers: [],
      updatedAt: now,
    };
    const commandFlow = {
      generatedAt: now,
      nextAction: { kind: "wait", label: "Wait for worker signal" },
      readiness: {
        ready: true,
        stage: "review",
        missingProtocolFiles: [],
        warnings: [],
        userCheckRequired: false,
      },
      judgments: [
        {
          id: "judgment-review",
          projectId: "project-centerline",
          roundId: "round-1",
          verdict: "continue",
          priority: "approval",
          confidence: "high",
          summary: "Accept the round result",
          reason: "The worker output is ready for review.",
          evidenceIds: [],
          agentResultIds: [],
          protocolTraceIds: [],
          proposedActions: [
            {
              id: "action-review",
              projectId: "project-centerline",
              roundId: "round-1",
              type: "review_round",
              risk: "low",
              requiresApproval: true,
              title: "Summarize round result",
              rationale: "Accept the completed round.",
              payload: { roundId: "round-1" },
              evidenceIds: [],
              agentResultIds: [],
              protocolTraceIds: [],
            },
            {
              id: "action-stale",
              projectId: "project-centerline",
              taskId: "task-old",
              type: "retry_task",
              risk: "medium",
              requiresApproval: true,
              title: "Retry old task",
              rationale: "Retry a stale task.",
              payload: { taskId: "task-old" },
              evidenceIds: [],
              agentResultIds: [],
              protocolTraceIds: [],
            },
          ],
        },
      ],
    } as unknown as ManagerCommandFlowResponse;

    render(() => (
      <ManagerOrchestrationPanel
        rounds={[]}
        agents={[]}
        standalone
        commandFlow={commandFlow}
        orchestrationSnapshot={snapshot}
      />
    ));

    const currentJudgment = screen.getByLabelText("작업판 현재 판단");
    expect(currentJudgment.textContent).toContain("승인 대기");
    expect(currentJudgment.textContent).toContain("1건 대기");
    expect(currentJudgment.textContent).not.toContain("현재 흐름 확인됨");
    expect(currentJudgment.textContent).not.toContain("확인된 다음 행동 없음");
    expect(screen.getByLabelText("오케스트레이션 순서도")).toBeTruthy();
    expect(screen.getAllByText("승인 대기").length).toBeGreaterThan(0);
    expect(screen.getByText("가능 1 / 정리 1")).toBeTruthy();
    expect(screen.getByText("실행할 수 없는 승인 제안 1개는 숨겼습니다.")).toBeTruthy();
    expect(screen.getByText("사전 검증: 실행 가능")).toBeTruthy();
    expect(screen.queryByText("작업 재시도 승인")).toBeNull();
    expect(
      screen.getAllByText((_, element) =>
        Boolean(element?.textContent?.includes("라운드 결과 수용")),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Approval required")).toBeNull();
  });

  test("keeps agent details collapsed and renders JSON output as readable fields", () => {
    const agent: ManagerAgent = {
      id: "agent-verifier",
      role: "verifier",
      label: "Verifier agent",
      profile: "Checks whether the build matches the requested UX.",
      status: "completed",
      lastInstruction: "Review the latest orchestration board.",
      lastOutput: JSON.stringify({
        review_notes: "Agent cards are easier to scan.",
        changedFiles: ["ManagerOrchestrationPanel.tsx", "styles.css"],
        metrics: {
          collapsedByDefault: true,
          visibleFields: 2,
        },
      }),
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:10:00.000Z",
    };

    render(() => <ManagerOrchestrationPanel rounds={[]} agents={[agent]} standalone />);

    fireEvent.click(screen.getByRole("tab", { name: t("manager.orchestration.tab.agents") }));

    const summary = screen.getByText("Verifier agent").closest("summary");
    expect(summary).toBeTruthy();
    expect(summary?.textContent).toContain("Verifier agent");
    expect(summary?.textContent).toContain(t("manager.orchestration.status.completed"));
    expect(summary?.textContent).not.toContain("Checks whether");
    expect(summary?.textContent).not.toContain("review_notes");

    const details = summary?.closest("details") as HTMLDetailsElement | null;
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);

    fireEvent.click(summary as HTMLElement);

    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain("Checks whether the build matches the requested UX.");

    const readableJson = details?.querySelector(".manager-agent-json-render");
    expect(readableJson).toBeTruthy();
    expect(readableJson?.textContent).toContain("review notes");
    expect(readableJson?.textContent).toContain("Agent cards are easier to scan.");
    expect(readableJson?.textContent).toContain("changed files");
    expect(readableJson?.textContent).toContain("collapsed by default");
    expect(readableJson?.textContent).not.toContain('"review_notes"');
  });
});
