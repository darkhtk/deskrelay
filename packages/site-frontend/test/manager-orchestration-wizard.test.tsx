import type {
  ManagerAgent,
  ManagerBlocker,
  ManagerProject,
  ManagerProjectCharterUpdateRequest,
  ManagerProjectCreateRequest,
  ManagerProjectOverviewResponse,
  ManagerStateViewResponse,
} from "@deskrelay/shared";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

describe("ManagerOrchestrationPanel project wizard", () => {
  test("creates a project with a generated charter from human intent", () => {
    const onCreateProject = vi.fn<(input: ManagerProjectCreateRequest) => void>();
    render(() => (
      <ManagerOrchestrationPanel
        rounds={[]}
        agents={[]}
        standalone
        onCreateProject={onCreateProject}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: t("manager.orchestration.action.new") }));
    expect(
      screen.getByRole("dialog", {
        name: t("manager.orchestration.project-wizard.title.create"),
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(t("manager.orchestration.project-wizard.guidance.create")).length,
    ).toBeGreaterThan(0);
    fireEvent.input(screen.getByLabelText(t("manager.orchestration.project-wizard.field.intent")), {
      target: {
        value: "Build a project planning dashboard. Keep data writes reviewable by the human.",
      },
    });
    fireEvent.input(screen.getByLabelText(t("manager.orchestration.project-wizard.field.cwd")), {
      target: { value: "C:\\work\\planner" },
    });
    fireEvent.input(
      screen.getByLabelText(t("manager.orchestration.project-wizard.field.audience")),
      {
        target: { value: "operations admins" },
      },
    );
    fireEvent.input(
      screen.getByLabelText(t("manager.orchestration.project-wizard.field.use-case")),
      {
        target: { value: "round planning and review" },
      },
    );
    fireEvent.input(
      screen.getByLabelText(t("manager.orchestration.project-wizard.field.success")),
      {
        target: { value: "Admins can see the next action and approve the final result." },
      },
    );
    fireEvent.input(
      screen.getByLabelText(t("manager.orchestration.project-wizard.field.constraints")),
      {
        target: { value: "No production writes without approval." },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: t("manager.orchestration.action.create") }));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    const input = onCreateProject.mock.calls[0]?.[0];
    expect(input?.cwd).toBe("C:\\work\\planner");
    expect(input?.name).toBe("Build a project planning dashboard.");
    expect(input?.goal).toBe("Build a project planning dashboard.");
    expect(input?.protocolSource).toBe("base-copy");
    expect(input?.charter?.goal).toBe("Build a project planning dashboard.");
    expect(input?.charter?.scope).toContain("round planning and review");
    expect(input?.charter?.scope).toContain("operations admins");
    expect(input?.charter?.successCriteria).toContain("Admins can see the next action");
    expect(input?.charter?.constraints).toContain("No production writes without approval.");
    expect(input?.charter?.constraints).toContain("Keep API use and data read/write effects");
    expect(input?.charter?.userCheckpoints).toContain("Before orchestration starts");
    expect(input?.charter?.finalDeliverables).toContain("Working app changes");
    expect(input?.wizardEvent?.kind).toBe("charter-applied");
    expect(input?.wizardEvent?.impact).toBe("medium");
    expect(input?.wizardEvent?.managerAction).toBe("refresh-readiness");
    expect(input?.wizardEvent?.fields.map((field) => field.field)).toContain("successCriteria");
  });

  test("blocks relative workspace paths before project creation", () => {
    const onCreateProject = vi.fn<(input: ManagerProjectCreateRequest) => void>();
    render(() => (
      <ManagerOrchestrationPanel
        rounds={[]}
        agents={[]}
        standalone
        onCreateProject={onCreateProject}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: t("manager.orchestration.action.new") }));
    fireEvent.input(screen.getByLabelText(t("manager.orchestration.project-wizard.field.intent")), {
      target: { value: "Build the orchestration project wizard." },
    });
    fireEvent.input(screen.getByLabelText(t("manager.orchestration.project-wizard.field.cwd")), {
      target: { value: "deskrelay" },
    });

    const createButton = screen.getByRole("button", {
      name: t("manager.orchestration.action.create"),
    }) as HTMLButtonElement;
    expect(
      screen.getByText(t("manager.orchestration.project-wizard.warning.cwd-absolute")),
    ).toBeTruthy();
    expect(createButton.disabled).toBe(true);

    fireEvent.input(screen.getByLabelText(t("manager.orchestration.project-wizard.field.cwd")), {
      target: { value: "C:\\work\\deskrelay" },
    });

    expect(
      screen.queryByText(t("manager.orchestration.project-wizard.warning.cwd-absolute")),
    ).toBeNull();
    expect(createButton.disabled).toBe(false);
  });

  test("does not inherit the selected project's active round when creating a new project", () => {
    const onCreateProject = vi.fn<(input: ManagerProjectCreateRequest) => void>();
    const selectedProject: ManagerProject = {
      id: "project_existing",
      name: "Existing project",
      cwd: "C:\\work\\existing",
      goal: "Keep existing work isolated",
      status: "running",
      flowStage: "running",
      activeRoundId: "round_existing",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
    render(() => (
      <ManagerOrchestrationPanel
        projects={[selectedProject]}
        selectedProject={selectedProject}
        rounds={[
          {
            id: "round_existing",
            projectId: selectedProject.id,
            title: "Existing round",
            objective: "Do not inherit this round",
            phase: "design",
            status: "running",
            agentIds: [],
            taskIds: [],
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z",
          },
        ]}
        agents={[]}
        standalone
        onCreateProject={onCreateProject}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: t("manager.orchestration.action.new") }));
    fireEvent.input(screen.getByLabelText(t("manager.orchestration.project-wizard.field.intent")), {
      target: { value: "Create a separate project from the wizard." },
    });
    fireEvent.input(screen.getByLabelText(t("manager.orchestration.project-wizard.field.cwd")), {
      target: { value: "C:\\work\\separate" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("manager.orchestration.action.create") }));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    const input = onCreateProject.mock.calls[0]?.[0];
    expect(input?.activeRoundId).toBeUndefined();
    expect(input?.wizardEvent?.roundId).toBeUndefined();
  });

  test("records direction changes from the wizard as manager-visible charter signals", () => {
    const onUpdateCharter = vi.fn<(input: ManagerProjectCharterUpdateRequest) => void>();
    const selectedProject: ManagerProject = {
      id: "project_1",
      name: "Planner",
      cwd: "C:\\work\\planner",
      goal: "Build a planning dashboard",
      status: "running",
      flowStage: "running",
      activeRoundId: "round_1",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
      charter: {
        goal: "Build a planning dashboard",
        scope: "Show round planning",
        nonGoals: "Do not change production data",
        constraints: "Ask before writes",
        successCriteria: "Admins approve final state",
        preferredApproach: "Design, implement, review",
        verificationPlan: "Run tests",
        userCheckpoints: "Review before final",
        finalDeliverables: "Working dashboard",
        updatedBy: "browser",
      },
    };
    render(() => (
      <ManagerOrchestrationPanel
        projects={[selectedProject]}
        selectedProject={selectedProject}
        rounds={[]}
        agents={[]}
        standalone
        onUpdateCharter={onUpdateCharter}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: t("manager.orchestration.action.wizard") }));
    expect(
      screen.getByRole("dialog", {
        name: t("manager.orchestration.project-wizard.title.change"),
      }),
    ).toBeTruthy();
    fireEvent.input(
      screen.getByLabelText(t("manager.orchestration.project-wizard.field.constraints")),
      {
        target: { value: "Ask before writes\nNo deploys without human approval." },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t("manager.orchestration.action.apply-wizard"),
      }),
    );

    expect(onUpdateCharter).toHaveBeenCalledTimes(1);
    const input = onUpdateCharter.mock.calls[0]?.[0];
    expect(input?.constraints).toContain("No deploys without human approval.");
    expect(input?.wizardEvent?.kind).toBe("charter-applied");
    expect(input?.wizardEvent?.impact).toBe("high");
    expect(input?.wizardEvent?.managerAction).toBe("refresh-readiness");
    expect(input?.wizardEvent?.fields.map((field) => field.field)).toContain("constraints");
  });

  test("scopes current manager state to the selected project", () => {
    const selectedProject: ManagerProject = {
      id: "project_1",
      name: "Planner",
      cwd: "C:\\work\\planner",
      goal: "Build a planning dashboard",
      status: "planning",
      flowStage: "replanning",
      activeRoundId: "round_project",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
    const agent: ManagerAgent = {
      id: "agent_project",
      projectId: selectedProject.id,
      role: "architect",
      label: "Architect",
      profile: "claude-code",
      status: "completed",
      roundId: "round_project",
      taskId: "task_project",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
    const state: ManagerStateViewResponse = {
      generatedAt: "2026-05-17T00:00:00.000Z",
      freshness: {
        source: "poll",
        lastRefreshAt: "2026-05-17T00:00:00.000Z",
        stale: false,
      },
      current: {
        kind: "task",
        status: "blocked",
        tone: "warning",
        source: "task",
        title: "Unrelated task blocked",
        detail: "This belongs to another project.",
        roundId: "round_other",
        taskId: "task_other",
        actionable: true,
        actions: ["details"],
      },
      status: {
        tone: "warning",
        source: "task",
        message: "Unrelated task blocked",
      },
      counts: {
        rounds: 2,
        activeRounds: 1,
        agents: 2,
        runningAgents: 0,
        blockedAgents: 1,
        tasks: 2,
        runningTasks: 0,
        blockedTasks: 1,
        failedTasks: 0,
        staleTasks: 0,
        blockers: 2,
      },
      recentRounds: [],
      runningTasks: [],
      staleTasks: [],
      blockers: [
        {
          id: "task-blocked:task_other",
          kind: "task",
          severity: "warning",
          message: "Unrelated task blocked",
          taskId: "task_other",
          roundId: "round_other",
        },
        {
          id: "task-blocked:task_project",
          kind: "task",
          severity: "warning",
          message: "Project task needs review",
          taskId: "task_project",
          roundId: "round_project",
          agentId: "agent_project",
        },
      ],
      recoveryActions: [],
    };

    render(() => (
      <ManagerOrchestrationPanel
        projects={[selectedProject]}
        selectedProject={selectedProject}
        rounds={[
          {
            id: "round_project",
            projectId: selectedProject.id,
            title: "Project round",
            objective: "Stay scoped",
            phase: "design",
            status: "completed",
            agentIds: [agent.id],
            taskIds: ["task_project"],
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z",
          },
        ]}
        agents={[agent]}
        state={state}
        standalone
      />
    ));

    fireEvent.click(screen.getByRole("tab", { name: t("manager.orchestration.tab.state") }));

    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText(t("manager.orchestration.empty.project-manager-state"))).toBeTruthy();
    expect(panel.queryByText("Unrelated task blocked")).toBeNull();
    expect(panel.getByText("Project task needs review")).toBeTruthy();
  });

  test("prioritizes active project blockers over overview suggestions", () => {
    const selectedProject: ManagerProject = {
      id: "project_1",
      name: "Planner",
      cwd: "C:\\work\\planner",
      goal: "Build a planning dashboard",
      status: "planning",
      flowStage: "replanning",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
    const blocker: ManagerBlocker = {
      id: "blocker_1",
      projectId: selectedProject.id,
      title: "Fix stale selection",
      detail: "Selector and detail panel disagree.",
      severity: "warning",
      owner: "manager",
      requiredAction: "manager",
      status: "open",
      source: "browser",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
    const overview: ManagerProjectOverviewResponse = {
      generatedAt: "2026-05-17T00:00:00.000Z",
      project: selectedProject,
      counts: {
        rounds: 1,
        agents: 0,
        runningAgents: 0,
        completedAgents: 0,
        blockedAgents: 0,
        tasks: 0,
        runningTasks: 0,
        failedTasks: 0,
        workerRuns: 0,
        artifacts: 0,
      },
      currentSignal: {
        tone: "success",
        title: "Round completed",
        detail: "Ready to summarize.",
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
      nextAction: {
        kind: "summarize",
        label: "Summarize round result",
        detail: "Summarize worker output.",
      },
      recentSignals: [],
      lastUpdateAt: "2026-05-17T00:00:00.000Z",
    };

    render(() => (
      <ManagerOrchestrationPanel
        projects={[selectedProject]}
        selectedProject={selectedProject}
        projectOverview={overview}
        blockers={[blocker]}
        rounds={[]}
        agents={[]}
        standalone
      />
    ));

    fireEvent.click(screen.getByRole("tab", { name: t("manager.orchestration.tab.overview") }));

    expect(
      within(screen.getByRole("tabpanel")).getByText("Manager should resolve: Fix stale selection"),
    ).toBeTruthy();
  });

  test("separates selected project context from global manager status", () => {
    const selectedProject: ManagerProject = {
      id: "project_1",
      name: "Planner",
      cwd: "C:\\work\\planner",
      goal: "Build a planning dashboard",
      status: "reviewing",
      flowStage: "review",
      activeRoundId: "round_project",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    };
    const overview: ManagerProjectOverviewResponse = {
      generatedAt: "2026-05-17T00:00:00.000Z",
      project: selectedProject,
      counts: {
        rounds: 1,
        agents: 0,
        runningAgents: 0,
        completedAgents: 0,
        blockedAgents: 0,
        tasks: 0,
        runningTasks: 0,
        failedTasks: 0,
        workerRuns: 0,
        artifacts: 0,
      },
      currentSignal: {
        tone: "success",
        title: "Project round ready for review",
        detail: "Selected project signal.",
      },
      nextAction: {
        kind: "summarize",
        label: "Summarize round result",
      },
      recentSignals: [],
    };
    const state: ManagerStateViewResponse = {
      generatedAt: "2026-05-17T00:00:00.000Z",
      freshness: {
        source: "poll",
        lastRefreshAt: "2026-05-17T00:00:00.000Z",
        stale: false,
      },
      current: {
        kind: "task",
        status: "running",
        tone: "running",
        source: "task",
        title: "Global task outside this project",
        detail: "This is intentionally separated from the selected project header.",
        actionable: false,
        actions: ["details"],
      },
      status: {
        tone: "running",
        source: "task",
        message: "Global task outside this project",
      },
      counts: {
        rounds: 2,
        activeRounds: 1,
        agents: 2,
        runningAgents: 1,
        blockedAgents: 0,
        tasks: 2,
        runningTasks: 1,
        blockedTasks: 0,
        failedTasks: 0,
        staleTasks: 0,
        blockers: 0,
      },
      recentRounds: [],
      runningTasks: [],
      staleTasks: [],
      blockers: [],
      recoveryActions: [],
    };

    render(() => (
      <ManagerOrchestrationPanel
        projects={[selectedProject]}
        selectedProject={selectedProject}
        projectOverview={overview}
        state={state}
        rounds={[]}
        agents={[]}
        standalone
      />
    ));

    const projectRegion = screen.getByRole("region", {
      name: t("manager.orchestration.project.aria"),
    });
    expect(
      within(projectRegion).getByText(t("manager.orchestration.project-summary.stage")),
    ).toBeTruthy();
    expect(
      within(projectRegion).getByText(t("manager.orchestration.project-summary.next")),
    ).toBeTruthy();
    expect(
      within(projectRegion).getByText(t("manager.orchestration.project-summary.goal")),
    ).toBeTruthy();
    expect(screen.getByText(t("manager.orchestration.global.title"))).toBeTruthy();

    const tablist = screen.getByRole("tablist", {
      name: t("manager.orchestration.aria.information"),
    });
    expect(
      within(tablist).getAllByText(t("manager.orchestration.tab-group.intent")).length,
    ).toBeGreaterThan(0);
    expect(
      within(tablist).getAllByText(t("manager.orchestration.tab-group.protocol")).length,
    ).toBeGreaterThan(0);
    expect(
      within(tablist).getAllByText(t("manager.orchestration.tab-group.progress")).length,
    ).toBeGreaterThan(0);
    expect(
      within(tablist).getAllByText(t("manager.orchestration.tab-group.review")).length,
    ).toBeGreaterThan(0);
  });
});
