import type {
  ManagerAgent,
  ManagerAgentResult,
  ManagerArtifact,
  ManagerArtifactUpdateRequest,
  ManagerAssistantStatusReport,
  ManagerBlocker,
  ManagerBlockerCreateRequest,
  ManagerBlockerResolveRequest,
  ManagerCommandFlowResponse,
  ManagerCommandFlowStage,
  ManagerDecision,
  ManagerDecisionCreateRequest,
  ManagerDecisionUpdateRequest,
  ManagerDirectionChangeRequest,
  ManagerEvidenceItem,
  ManagerJudgmentPacket,
  ManagerOrchestrationAction,
  ManagerOrchestrationFlowNode,
  ManagerOrchestrationPhase,
  ManagerOrchestrationSnapshot,
  ManagerProject,
  ManagerProjectCharter,
  ManagerProjectCharterUpdateRequest,
  ManagerProjectCompleteRequest,
  ManagerProjectCreateRequest,
  ManagerProjectHygieneIssue,
  ManagerProjectHygieneReport,
  ManagerProjectOverviewAction,
  ManagerProjectOverviewResponse,
  ManagerProjectProtocolSource,
  ManagerProjectStartRequest,
  ManagerProposedAction,
  ManagerProtocolState,
  ManagerProtocolTrace,
  ManagerProtocolUpdateRequest,
  ManagerRound,
  ManagerRoundHealthGate,
  ManagerRoundReportResponse,
  ManagerRoundReviewRequest,
  ManagerSessionHygieneItem,
  ManagerSessionHygieneReport,
  ManagerStateViewResponse,
  ManagerTask,
  ManagerTaskObservationResponse,
  ManagerWizardIntentEvent,
  ManagerWizardIntentEventInput,
  ManagerWorkerRun,
} from "@deskrelay/shared";
import {
  type Component,
  For,
  type JSX,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { renderMarkdown } from "../claude/message-renderer.ts";
import { t } from "../i18n.ts";
import type { ManagerEventConnectionState } from "../manager-events.ts";

type Tone = "neutral" | "running" | "done" | "blocked";

const HEIGHT_STORAGE_KEY = "cr.manager-orchestration-panel-height";
const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_HEIGHT = 160;
const MAX_PANEL_HEIGHT = 620;
let mermaidDiagramInstance = 0;

interface ManagerOrchestrationPanelProps {
  projects?: ManagerProject[] | undefined;
  archivedProjects?: ManagerProject[] | undefined;
  selectedProject?: ManagerProject | null | undefined;
  commandFlow?: ManagerCommandFlowResponse | null | undefined;
  orchestrationSnapshot?: ManagerOrchestrationSnapshot | null | undefined;
  orchestrationSnapshotLoading?: boolean | undefined;
  projectOverview?: ManagerProjectOverviewResponse | null | undefined;
  projectLoading?: boolean | undefined;
  projectBusy?: boolean | undefined;
  projectFolderBusy?: boolean | undefined;
  projectFolderError?: string | null | undefined;
  projectFolderStatus?: string | null | undefined;
  flowBusy?: boolean | undefined;
  decisions?: ManagerDecision[] | undefined;
  archivedDecisions?: ManagerDecision[] | undefined;
  decisionBusy?: boolean | undefined;
  blockers?: ManagerBlocker[] | undefined;
  resolvedBlockers?: ManagerBlocker[] | undefined;
  blockerBusy?: boolean | undefined;
  artifacts?: ManagerArtifact[] | undefined;
  inactiveArtifacts?: ManagerArtifact[] | undefined;
  artifactBusy?: boolean | undefined;
  protocol?: ManagerProtocolState | null | undefined;
  protocolBusy?: boolean | undefined;
  rounds: ManagerRound[];
  agents: ManagerAgent[];
  report?: ManagerRoundReportResponse | null | undefined;
  health?: ManagerRoundHealthGate | null | undefined;
  workerRuns?: ManagerWorkerRun[] | undefined;
  assistantStatusReports?: ManagerAssistantStatusReport[] | undefined;
  hygiene?: ManagerSessionHygieneReport | null | undefined;
  projectHygiene?: ManagerProjectHygieneReport | null | undefined;
  hygieneLoading?: boolean | undefined;
  hygieneCleanupBusy?: boolean | undefined;
  projectHygieneLoading?: boolean | undefined;
  projectHygieneCleanupBusy?: boolean | undefined;
  state?: ManagerStateViewResponse | null | undefined;
  observedTask?: ManagerTaskObservationResponse | null | undefined;
  eventState?: ManagerEventConnectionState | undefined;
  eventStateDetail?: string | null | undefined;
  observeBusy?: boolean | undefined;
  acknowledgeBusy?: boolean | undefined;
  actionBusy?: boolean | undefined;
  approvalActionBusy?: boolean | undefined;
  approvalActionStatus?: string | null | undefined;
  approvalActionError?: string | null | undefined;
  suppressedApprovalActionKeys?: string[] | undefined;
  standalone?: boolean | undefined;
  onAcknowledgeFailures?: (() => void) | undefined;
  onAcknowledgeRound?: ((roundId: string) => void) | undefined;
  onCancelTask?: ((taskId: string) => void) | undefined;
  onInspectTask?: ((taskId: string) => void) | undefined;
  onRepairRound?: ((roundId: string) => void) | undefined;
  onRepairRegistration?: (() => void) | undefined;
  onRefreshState?: (() => void) | undefined;
  onRetryTask?: ((taskId: string) => void) | undefined;
  onRunUpdateAll?: (() => void) | undefined;
  onRefreshHygiene?: (() => void) | undefined;
  onCleanupHygiene?: (() => void) | undefined;
  onRefreshProjectHygiene?: (() => void) | undefined;
  onCleanupProjectHygiene?: (() => void) | undefined;
  onRefreshProjects?: (() => void) | undefined;
  onSelectProject?: ((projectId: string | null) => void) | undefined;
  onCreateProject?: ((input: ManagerProjectCreateRequest) => void) | undefined;
  onArchiveProject?: ((projectId: string) => void) | undefined;
  onOpenProjectFolder?: ((projectId: string) => void) | undefined;
  onCreateDecision?: ((input: ManagerDecisionCreateRequest) => void) | undefined;
  onUpdateDecision?:
    | ((decisionId: string, input: ManagerDecisionUpdateRequest) => void)
    | undefined;
  onCreateBlocker?: ((input: ManagerBlockerCreateRequest) => void) | undefined;
  onResolveBlocker?:
    | ((blockerId: string, input?: ManagerBlockerResolveRequest) => void)
    | undefined;
  onScanArtifacts?: (() => void) | undefined;
  onUpdateArtifact?:
    | ((artifactId: string, input: ManagerArtifactUpdateRequest) => void)
    | undefined;
  onScanProtocol?: (() => void) | undefined;
  onUpdateProtocol?: ((input: ManagerProtocolUpdateRequest) => void) | undefined;
  onUpdateCharter?: ((input: ManagerProjectCharterUpdateRequest) => void) | undefined;
  onPrepareProject?: (() => void) | undefined;
  onStartProject?: ((input: ManagerProjectStartRequest) => void) | undefined;
  onReviewRound?: ((roundId: string, input: ManagerRoundReviewRequest) => void) | undefined;
  onDirectionChange?: ((input: ManagerDirectionChangeRequest) => void) | undefined;
  onCompleteProject?: ((input: ManagerProjectCompleteRequest) => void) | undefined;
  onApproveProposedAction?: ((action: ManagerProposedAction) => void) | undefined;
}

interface TimelineEntry {
  at: string;
  label: string;
  detail?: string | undefined;
  tone: Tone;
}

interface ArtifactEntry {
  id?: string | undefined;
  path: string;
  owner: string;
  status: string;
  updatedAt: string;
  kind?: string | undefined;
  note?: string | undefined;
}

type ManagerCurrentJudgmentBrief = {
  tone: "ready" | "thinking" | "warning";
  headline: string;
  project: string;
  round: string;
  nextAction: string;
  approval: string;
  report: string;
  recommendation: string;
  reportIsStale: boolean;
  approvalCount: number;
  updatedAt?: string;
};

const COMMAND_FLOW_STAGES = [
  "draft",
  "protocol_ready",
  "ready_to_start",
  "running",
  "review",
  "replanning",
  "completed",
  "archived",
] as const satisfies readonly ManagerCommandFlowStage[];

const COMMAND_FLOW_MAIN_STAGES = [
  "draft",
  "protocol_ready",
  "ready_to_start",
  "running",
  "review",
] as const satisfies readonly ManagerCommandFlowStage[];

const COMMAND_FLOW_BRANCH_STAGES = [
  "replanning",
  "completed",
  "archived",
] as const satisfies readonly ManagerCommandFlowStage[];

type OrchestrationInfoTab =
  | "flow"
  | "overview"
  | "agents"
  | "state"
  | "decisions"
  | "blockers"
  | "graph"
  | "runs"
  | "artifacts"
  | "protocol"
  | "timeline"
  | "hygiene";

type OrchestrationTabGroup = "intent" | "protocol" | "progress" | "review";

const ORCHESTRATION_INFO_TAB_GROUPS: Array<{
  id: OrchestrationTabGroup;
  tabs: OrchestrationInfoTab[];
}> = [
  { id: "intent", tabs: ["flow", "decisions", "blockers"] },
  { id: "protocol", tabs: ["protocol"] },
  { id: "progress", tabs: ["overview", "agents", "runs", "graph", "timeline"] },
  { id: "review", tabs: ["artifacts", "state", "hygiene"] },
];

const USER_ORCHESTRATION_INFO_TAB_GROUPS: Array<{
  id: OrchestrationTabGroup;
  tabs: OrchestrationInfoTab[];
}> = [
  { id: "progress", tabs: ["overview", "agents"] },
  { id: "protocol", tabs: ["protocol"] },
  { id: "review", tabs: ["blockers", "artifacts"] },
];

const USER_ORCHESTRATION_INFO_TABS = new Set<OrchestrationInfoTab>(
  USER_ORCHESTRATION_INFO_TAB_GROUPS.flatMap((group) => group.tabs),
);

export const ManagerOrchestrationPanel: Component<ManagerOrchestrationPanelProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [panelHeight, setPanelHeight] = createSignal(readPanelHeight());
  const [activeTab, setActiveTab] = createSignal<OrchestrationInfoTab>("overview");
  const [adminDetailOpen, setAdminDetailOpen] = createSignal(false);
  const [projectWizardOpen, setProjectWizardOpen] = createSignal(false);
  const [projectWizardMode, setProjectWizardMode] = createSignal<ProjectWizardMode>("create");
  const [dismissedJudgmentIds, setDismissedJudgmentIds] = createSignal<Record<string, true>>({});
  let stopResize: (() => void) | undefined;
  const isExpanded = () => Boolean(props.standalone) || expanded();
  const dockProjectWizard = () => Boolean(props.standalone && projectWizardOpen());
  const activeRound = createMemo(() => {
    const projectRoundId = props.selectedProject?.activeRoundId;
    return (
      (projectRoundId ? props.rounds.find((round) => round.id === projectRoundId) : undefined) ??
      pickActiveRound(props.rounds)
    );
  });
  const rawAgents = createMemo(() => {
    const round = activeRound();
    if (!round) return props.agents;
    const ids = new Set(round.agentIds);
    const linked = props.agents.filter((agent) => agent.roundId === round.id || ids.has(agent.id));
    return linked.length > 0 ? linked : props.agents;
  });
  const agents = createMemo(() => visibleManagerAgents(rawAgents(), activeRound()));
  const hiddenAgentCount = createMemo(() => Math.max(0, rawAgents().length - agents().length));
  const tasks = createMemo(() => props.report?.tasks ?? []);
  const timeline = createMemo(() => buildTimeline(activeRound(), agents(), tasks()));
  const artifacts = createMemo(() =>
    props.artifacts && props.artifacts.length > 0
      ? props.artifacts.map(artifactEntryFromStored)
      : buildArtifacts(agents(), tasks()),
  );
  const inactiveArtifacts = createMemo(() =>
    (props.inactiveArtifacts ?? []).map(artifactEntryFromStored),
  );
  const totals = createMemo(() => summarizeTotals(agents()));
  const runTotals = createMemo(() => summarizeWorkerRunTotals(props.workerRuns ?? []));
  const currentState = createMemo(() => props.state?.current ?? null);
  const selectedProject = createMemo(() => props.selectedProject ?? null);
  const displayProject = createMemo<ManagerProject | null>(() => {
    const selected = selectedProject();
    if (!selected) return null;
    const overviewProject = props.projectOverview?.project;
    const commandFlowProject = props.commandFlow?.project;
    return {
      ...selected,
      ...(overviewProject?.id === selected.id ? overviewProject : {}),
      ...(commandFlowProject?.id === selected.id ? commandFlowProject : {}),
    };
  });
  const selectedProjectCompleted = createMemo(() => isManagerProjectCompleted(displayProject()));
  const effectiveOverview = createMemo<ManagerProjectOverviewResponse | null>(
    () => props.commandFlow?.overview ?? props.projectOverview ?? null,
  );
  const displayCommandFlow = createMemo(() =>
    filterManagerCommandFlowApprovalActions(
      props.commandFlow,
      new Set(props.suppressedApprovalActionKeys ?? []),
    ),
  );
  const effectiveNextAction = createMemo(() =>
    selectedProjectCompleted()
      ? null
      : (props.commandFlow?.nextAction ?? effectiveOverview()?.nextAction ?? null),
  );
  const latestStatusReport = createMemo(() => {
    const reports = props.assistantStatusReports ?? [];
    const project = displayProject();
    if (!project) return reports[0] ?? null;
    const currentRoundId =
      props.commandFlow?.activeRound?.id ??
      props.projectOverview?.activeRound?.id ??
      project.activeRoundId ??
      null;
    return (
      reports.find((report) =>
        assistantStatusReportMatchesProjectScope(report, project.id, currentRoundId),
      ) ?? null
    );
  });
  const currentJudgmentBrief = createMemo(() =>
    buildManagerCurrentJudgmentBrief({
      project: displayProject(),
      overview: effectiveOverview(),
      commandFlow: displayCommandFlow(),
      snapshot: props.orchestrationSnapshot ?? null,
      latestReport: latestStatusReport(),
    }),
  );
  const projectCurrentSignal = createMemo(() =>
    selectedProject() ? (effectiveOverview()?.currentSignal ?? null) : null,
  );
  const headlineTone = createMemo(() => {
    const projectTone = overviewTone(projectCurrentSignal()?.tone);
    if (projectTone) return projectTone;
    const state = currentState();
    return state ? currentStateTone(state.tone) : statusTone(activeRound()?.status);
  });
  const headlineTitle = createMemo(
    () =>
      displayProject()?.name ??
      projectCurrentSignal()?.title ??
      currentState()?.title ??
      activeRound()?.title ??
      t("manager.orchestration.title"),
  );
  const headlineDetail = createMemo(() =>
    selectedProject()
      ? (projectCurrentSignal()?.title ?? displayProject()?.goal ?? activeRound()?.title)
      : undefined,
  );
  const freshnessLabel = createMemo(() => formatFreshness(props.state));
  const eventConnectionLabel = createMemo(() =>
    props.eventState && props.eventState !== "connected"
      ? `events ${props.eventState}${props.eventStateDetail ? `: ${props.eventStateDetail}` : ""}`
      : null,
  );
  const activeIssueCount = createMemo(
    () => props.state?.counts.blockers ?? props.state?.blockers.length ?? 0,
  );
  const visibleJudgments = createMemo(() => {
    const project = displayProject();
    if (isManagerProjectCompleted(project)) return [];
    return (displayCommandFlow()?.judgments ?? []).filter(
      (judgment) => !dismissedJudgmentIds()[judgment.id],
    );
  });
  const actionableApprovalJudgments = createMemo(() =>
    visibleJudgments().filter(
      (judgment) =>
        judgment.priority === "approval" &&
        judgment.proposedActions.some((action) => action.requiresApproval),
    ),
  );
  const visibleTabGroups = createMemo(() =>
    adminDetailOpen() ? ORCHESTRATION_INFO_TAB_GROUPS : USER_ORCHESTRATION_INFO_TAB_GROUPS,
  );
  createEffect(() => {
    const projectId = props.selectedProject?.id;
    if (!projectId) setDismissedJudgmentIds({});
  });
  createEffect(() => {
    if (!adminDetailOpen() && !USER_ORCHESTRATION_INFO_TABS.has(activeTab())) {
      setActiveTab("overview");
    }
  });
  const openProjectWizard = (mode: ProjectWizardMode) => {
    setProjectWizardMode(mode);
    setProjectWizardOpen(true);
  };

  onCleanup(() => {
    stopResize?.();
  });

  const startResize = (event: PointerEvent) => {
    if (!isExpanded() || props.standalone) return;
    event.preventDefault();
    stopResize?.();
    const startY = event.clientY;
    const startHeight = panelHeight();
    document.body.classList.add("manager-orchestration-resizing");

    const move = (moveEvent: PointerEvent) => {
      const next = clampPanelHeight(startHeight + moveEvent.clientY - startY);
      setPanelHeight(next);
      writePanelHeight(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("manager-orchestration-resizing");
      stopResize = undefined;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    stopResize = stop;
  };

  return (
    <section
      class="manager-orchestration-panel"
      classList={{
        "manager-orchestration-admin-detail": adminDetailOpen(),
        "manager-orchestration-panel-expanded": isExpanded(),
        "manager-orchestration-panel-standalone": Boolean(props.standalone),
        "manager-orchestration-user-mode": !adminDetailOpen(),
      }}
      aria-label={t("manager.orchestration.aria.panel")}
      style={{ "--manager-orchestration-panel-height": `${panelHeight()}px` } as JSX.CSSProperties}
    >
      <header class="manager-orchestration-panel-head">
        <button
          type="button"
          class="manager-orchestration-title"
          aria-expanded={isExpanded()}
          onClick={() => {
            if (!props.standalone) setExpanded((current) => !current);
          }}
        >
          <span class={`manager-status-dot manager-status-dot-${headlineTone()}`} />
          <strong>{headlineTitle()}</strong>
          <Show when={headlineDetail()}>
            {(detail) => <span class="manager-orchestration-title-detail">{detail()}</span>}
          </Show>
          <Show
            when={projectCurrentSignal()}
            fallback={
              <Show when={currentState()} fallback={<RoundStatusPill round={activeRound()} />}>
                {(current) => (
                  <span class="manager-status-pill">{statusLabel(current().status)}</span>
                )}
              </Show>
            }
          >
            <span class="manager-status-pill">
              {statusLabel(displayProject()?.status ?? props.selectedProject?.status)}
            </span>
          </Show>
        </button>
        <div class="manager-orchestration-summary">
          <Show
            when={displayProject()}
            fallback={
              <>
                <Show
                  when={props.state}
                  fallback={
                    <span>
                      {t("manager.orchestration.metric.agents-done", {
                        completed: totals().completed,
                        total: totals().total,
                      })}
                    </span>
                  }
                >
                  <span>{currentState()?.kind ?? "manager"}</span>
                </Show>
                <Show when={freshnessLabel()}>{(label) => <span>{label()}</span>}</Show>
                <Show when={eventConnectionLabel()}>{(label) => <span>{label()}</span>}</Show>
                <span>
                  {t("manager.orchestration.metric.running", { count: totals().running })}
                </span>
                <span>
                  {t("manager.orchestration.metric.blocked", { count: totals().blocked })}
                </span>
                <span>
                  {t("manager.orchestration.metric.runs", {
                    active: runTotals().active,
                    total: runTotals().total,
                  })}
                </span>
              </>
            }
          >
            {(project) => (
              <>
                <span>{t("manager.orchestration.scope.selected-project")}</span>
                <span>{managerProjectFlowStageLabel(project().flowStage)}</span>
                <Show when={effectiveNextAction()}>
                  {(action) => <span>{managerProjectOverviewActionLabel(action())}</span>}
                </Show>
                <span>
                  {t("manager.orchestration.metric.agents-done", {
                    completed: totals().completed,
                    total: totals().total,
                  })}
                </span>
                <span>
                  {t("manager.orchestration.metric.runs", {
                    active: runTotals().active,
                    total: runTotals().total,
                  })}
                </span>
              </>
            )}
          </Show>
        </div>
        <Show when={!props.standalone}>
          <button
            type="button"
            class="manager-orchestration-expand"
            aria-expanded={isExpanded()}
            onClick={() => setExpanded((current) => !current)}
          >
            {isExpanded()
              ? t("manager.orchestration.action.hide")
              : t("manager.orchestration.action.details")}
          </button>
        </Show>
      </header>

      <Show when={isExpanded()}>
        <div
          class="manager-orchestration-body"
          classList={{ "manager-orchestration-body-wizard-open": dockProjectWizard() }}
        >
          <div class="manager-orchestration-workboard">
            <ProjectHeader
              projects={props.projects ?? []}
              archivedProjects={props.archivedProjects ?? []}
              selectedProject={displayProject()}
              overview={effectiveOverview()}
              nextAction={effectiveNextAction()}
              loading={props.projectLoading}
              busy={props.projectBusy}
              folderBusy={props.projectFolderBusy}
              folderError={props.projectFolderError}
              folderStatus={props.projectFolderStatus}
              onRefresh={props.onRefreshProjects}
              onSelect={props.onSelectProject}
              onOpenWizard={openProjectWizard}
              onArchive={props.onArchiveProject}
              onOpenFolder={props.onOpenProjectFolder}
              advanced={adminDetailOpen()}
            />
            <ManagerCurrentJudgmentCard brief={currentJudgmentBrief()} />
            <ManagerCenterlineCard
              snapshot={props.orchestrationSnapshot ?? null}
              loading={props.orchestrationSnapshotLoading}
            />
            <div class="manager-workboard-mode">
              <div>
                <strong>
                  {adminDetailOpen()
                    ? t("manager.orchestration.mode.admin")
                    : t("manager.orchestration.mode.user")}
                </strong>
                <span>
                  {adminDetailOpen()
                    ? t("manager.orchestration.mode.admin-help")
                    : t("manager.orchestration.mode.user-help")}
                </span>
              </div>
              <button
                type="button"
                aria-pressed={adminDetailOpen()}
                onClick={() => setAdminDetailOpen((current) => !current)}
              >
                {adminDetailOpen()
                  ? t("manager.orchestration.action.hide-admin-detail")
                  : t("manager.orchestration.action.show-admin-detail")}
              </button>
            </div>
            <Show when={adminDetailOpen()}>
              <GlobalManagerStatus
                state={props.state}
                freshnessLabel={freshnessLabel()}
                eventConnectionLabel={eventConnectionLabel()}
                totals={totals()}
                runTotals={runTotals()}
                issueCount={activeIssueCount()}
                busy={props.acknowledgeBusy}
                onAcknowledge={props.onAcknowledgeFailures}
              />
            </Show>
            <ManagerApprovalInbox
              judgments={actionableApprovalJudgments()}
              snapshot={props.orchestrationSnapshot ?? null}
              busy={props.flowBusy || props.actionBusy || props.approvalActionBusy}
              status={props.approvalActionStatus}
              error={props.approvalActionError}
              onApprove={props.onApproveProposedAction}
              onDismiss={(judgmentId) =>
                setDismissedJudgmentIds((current) => ({ ...current, [judgmentId]: true }))
              }
            />
            <nav
              class="manager-orchestration-tab-groups"
              role="tablist"
              aria-label={t("manager.orchestration.aria.information")}
            >
              <For each={visibleTabGroups()}>
                {(group) => (
                  <div
                    class="manager-orchestration-tab-group"
                    classList={{
                      "is-active": group.tabs.includes(activeTab()),
                    }}
                  >
                    <span>{t(`manager.orchestration.tab-group.${group.id}`)}</span>
                    <div>
                      <For each={group.tabs}>
                        {(tab) => (
                          <button
                            type="button"
                            role="tab"
                            class="manager-orchestration-tab"
                            classList={{ "is-active": activeTab() === tab }}
                            aria-selected={activeTab() === tab}
                            onClick={() => setActiveTab(tab)}
                          >
                            {t(`manager.orchestration.tab.${tab}`)}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </nav>
            <div
              class="manager-orchestration-tab-panel"
              classList={{
                "manager-orchestration-tab-panel-wide":
                  activeTab() === "flow" || activeTab() === "overview",
                "manager-orchestration-tab-panel-single":
                  activeTab() !== "flow" && activeTab() !== "overview",
                "manager-orchestration-tab-panel-agents": activeTab() === "agents",
              }}
              role="tabpanel"
            >
              <Show when={activeTab() === "flow"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.command-flow")}
                  class="manager-section-overview"
                >
                  <CommandFlowView
                    project={displayProject()}
                    commandFlow={props.commandFlow ?? null}
                    activeRound={activeRound()}
                    busy={props.flowBusy || props.actionBusy}
                    onUpdateCharter={props.onUpdateCharter}
                    onPrepare={props.onPrepareProject}
                    onStart={props.onStartProject}
                    onReview={props.onReviewRound}
                    onDirectionChange={props.onDirectionChange}
                    onComplete={props.onCompleteProject}
                  />
                </OrchestrationSection>
              </Show>
              <Show when={activeTab() === "overview"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.command-center")}
                  class="manager-section-overview"
                >
                  <OverviewView
                    round={activeRound()}
                    overview={effectiveOverview()}
                    agents={agents()}
                    tasks={tasks()}
                    blockers={props.blockers ?? []}
                    hiddenAgentCount={hiddenAgentCount()}
                  />
                  <Show when={displayProject()}>
                    {(project) => (
                      <CommandFlowStateMachine
                        project={project()}
                        commandFlow={props.commandFlow ?? null}
                        overview={effectiveOverview()}
                        activeRound={activeRound()}
                      />
                    )}
                  </Show>
                </OrchestrationSection>
                <Show
                  when={
                    props.assistantStatusReports?.length ||
                    displayProject() ||
                    effectiveOverview() ||
                    props.commandFlow
                  }
                >
                  <OrchestrationSection title="실행 기록" class="manager-section-ledger">
                    <ManagerAssistantLedgerView
                      project={displayProject()}
                      overview={effectiveOverview()}
                      commandFlow={props.commandFlow}
                      reports={props.assistantStatusReports ?? []}
                      workerRuns={props.workerRuns ?? []}
                    />
                  </OrchestrationSection>
                </Show>
                <Show when={adminDetailOpen()}>
                  <OrchestrationSection
                    title={t("manager.orchestration.section.current-state")}
                    class="manager-section-current"
                  >
                    <CurrentStateView
                      state={props.state}
                      project={displayProject()}
                      activeRound={activeRound()}
                      agents={agents()}
                      busy={props.actionBusy || props.acknowledgeBusy}
                      onAcknowledge={props.onAcknowledgeFailures}
                      onCancelTask={props.onCancelTask}
                      onInspectTask={props.onInspectTask}
                      onRepairRegistration={props.onRepairRegistration}
                      onRefresh={props.onRefreshState}
                      onRetryTask={props.onRetryTask}
                      onRunUpdateAll={props.onRunUpdateAll}
                    />
                  </OrchestrationSection>
                  <OrchestrationSection
                    title={t("manager.orchestration.section.health")}
                    class="manager-section-health"
                  >
                    <RoundHealthGateView
                      health={props.health}
                      busy={props.actionBusy || props.acknowledgeBusy}
                      onAcknowledgeRound={props.onAcknowledgeRound}
                      onInspectTask={props.onInspectTask}
                      onRepairRound={props.onRepairRound}
                      onRetryTask={props.onRetryTask}
                    />
                  </OrchestrationSection>
                </Show>
              </Show>

              <Show when={activeTab() === "agents"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.theater")}
                  class="manager-section-agents"
                >
                  <AgentsView
                    agents={agents()}
                    workerRuns={props.workerRuns ?? []}
                    agentResults={props.commandFlow?.agentResults ?? []}
                    evidence={props.commandFlow?.evidence ?? []}
                    busy={props.actionBusy || props.observeBusy}
                    onInspectTask={props.onInspectTask}
                    advanced={adminDetailOpen()}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "state"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.current-state")}
                  class="manager-section-current"
                >
                  <CurrentStateView
                    state={props.state}
                    project={props.selectedProject ?? null}
                    activeRound={activeRound()}
                    agents={agents()}
                    busy={props.actionBusy || props.acknowledgeBusy}
                    onAcknowledge={props.onAcknowledgeFailures}
                    onCancelTask={props.onCancelTask}
                    onInspectTask={props.onInspectTask}
                    onRepairRegistration={props.onRepairRegistration}
                    onRefresh={props.onRefreshState}
                    onRetryTask={props.onRetryTask}
                    onRunUpdateAll={props.onRunUpdateAll}
                  />
                </OrchestrationSection>
                <OrchestrationSection
                  title={t("manager.orchestration.section.health")}
                  class="manager-section-health"
                >
                  <RoundHealthGateView
                    health={props.health}
                    busy={props.actionBusy || props.acknowledgeBusy}
                    onAcknowledgeRound={props.onAcknowledgeRound}
                    onInspectTask={props.onInspectTask}
                    onRepairRound={props.onRepairRound}
                    onRetryTask={props.onRetryTask}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "decisions"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.decisions")}
                  class="manager-section-decisions"
                >
                  <DecisionsView
                    project={props.selectedProject ?? null}
                    decisions={props.decisions ?? []}
                    archivedDecisions={props.archivedDecisions ?? []}
                    busy={props.decisionBusy}
                    activeRoundId={activeRound()?.id}
                    onCreate={props.onCreateDecision}
                    onUpdate={props.onUpdateDecision}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "blockers"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.blockers")}
                  class="manager-section-blockers"
                >
                  <BlockersView
                    project={props.selectedProject ?? null}
                    blockers={props.blockers ?? []}
                    resolvedBlockers={props.resolvedBlockers ?? []}
                    busy={props.blockerBusy}
                    activeRoundId={activeRound()?.id}
                    onCreate={props.onCreateBlocker}
                    onResolve={props.onResolveBlocker}
                    advanced={adminDetailOpen()}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "graph"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.graph")}
                  class="manager-section-flow"
                >
                  <MermaidFlowView
                    round={activeRound()}
                    agents={agents()}
                    tasks={tasks()}
                    hiddenAgentCount={hiddenAgentCount()}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "runs"}>
                <Show when={props.observedTask}>
                  {(observation) => (
                    <OrchestrationSection
                      title={t("manager.orchestration.section.task-observation")}
                      class="manager-section-observation"
                    >
                      <TaskObservationView observation={observation()} busy={props.observeBusy} />
                    </OrchestrationSection>
                  )}
                </Show>
                <OrchestrationSection
                  title={t("manager.orchestration.section.runs")}
                  class="manager-section-worker-runs"
                >
                  <WorkerRunsView
                    runs={props.workerRuns ?? []}
                    evidence={props.commandFlow?.evidence ?? []}
                    busy={props.observeBusy || props.actionBusy}
                    onInspectTask={props.onInspectTask}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "artifacts"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.artifacts")}
                  class="manager-section-artifacts"
                >
                  <ArtifactsView
                    artifacts={artifacts()}
                    inactiveArtifacts={inactiveArtifacts()}
                    busy={props.artifactBusy}
                    stored={Boolean(props.artifacts && props.artifacts.length > 0)}
                    onScan={props.onScanArtifacts}
                    onUpdate={props.onUpdateArtifact}
                    advanced={adminDetailOpen()}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "protocol"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.protocol")}
                  class="manager-section-protocol"
                >
                  <ProtocolView
                    protocol={props.protocol ?? null}
                    trace={props.commandFlow?.protocolTrace ?? []}
                    evidence={props.commandFlow?.evidence ?? []}
                    busy={props.protocolBusy}
                    activeRoundId={activeRound()?.id}
                    decisions={props.decisions ?? []}
                    onScan={props.onScanProtocol}
                    onUpdate={props.onUpdateProtocol}
                    advanced={adminDetailOpen()}
                  />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "timeline"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.timeline")}
                  class="manager-section-timeline"
                >
                  <TimelineView entries={timeline()} />
                </OrchestrationSection>
              </Show>

              <Show when={activeTab() === "hygiene"}>
                <OrchestrationSection
                  title={t("manager.orchestration.section.hygiene")}
                  class="manager-section-hygiene"
                >
                  <HygieneView
                    report={props.hygiene}
                    projectReport={props.projectHygiene}
                    loading={props.hygieneLoading}
                    projectLoading={props.projectHygieneLoading}
                    cleanupBusy={props.hygieneCleanupBusy}
                    projectCleanupBusy={props.projectHygieneCleanupBusy}
                    onRefresh={props.onRefreshHygiene}
                    onCleanup={props.onCleanupHygiene}
                    onRefreshProject={props.onRefreshProjectHygiene}
                    onCleanupProject={props.onCleanupProjectHygiene}
                  />
                </OrchestrationSection>
              </Show>
            </div>
          </div>
          <ProjectWizardDialog
            open={projectWizardOpen()}
            mode={projectWizardMode()}
            project={props.selectedProject ?? null}
            commandFlow={props.commandFlow ?? null}
            activeRound={activeRound()}
            busy={props.projectBusy}
            docked={dockProjectWizard()}
            onModeChange={setProjectWizardMode}
            onClose={() => setProjectWizardOpen(false)}
            onCreate={props.onCreateProject}
            onUpdateCharter={props.onUpdateCharter}
            onComplete={props.onCompleteProject}
          />
        </div>
        <Show when={!props.standalone}>
          <button
            type="button"
            class="manager-orchestration-resize-handle"
            aria-label={t("manager.orchestration.aria.resize-panel")}
            title={t("manager.orchestration.action.resize")}
            onPointerDown={startResize}
          />
        </Show>
      </Show>
    </section>
  );
};

const RoundStatusPill: Component<{ round: ManagerRound | undefined }> = (props) => (
  <Show when={props.round}>
    {(round) => <span class="manager-status-pill">{statusLabel(round().status)}</span>}
  </Show>
);

const OrchestrationSection: Component<{ title: string; class?: string; children: JSX.Element }> = (
  props,
) => (
  <section
    class={`manager-orchestration-section ${props.class ?? ""}`.trim()}
    aria-label={props.title}
  >
    <h4>{props.title}</h4>
    {props.children}
  </section>
);

const ManagerCurrentJudgmentCard: Component<{
  brief: ManagerCurrentJudgmentBrief | null;
}> = (props) => (
  <Show when={props.brief}>
    {(brief) => (
      <section
        class={`manager-current-judgment manager-assistant-current manager-assistant-current-${brief().tone}`}
        aria-label={t("manager.orchestration.current-judgment.aria")}
      >
        <header class="manager-assistant-current-head">
          <div>
            <span>{t("manager.orchestration.current-judgment.title")}</span>
            <strong>{brief().headline}</strong>
          </div>
          <Show when={brief().updatedAt}>{(updatedAt) => <time>{updatedAt()}</time>}</Show>
        </header>
        <dl class="manager-assistant-current-grid">
          <div>
            <dt>{t("manager.orchestration.current-judgment.project")}</dt>
            <dd>{brief().project}</dd>
          </div>
          <div>
            <dt>{t("manager.orchestration.current-judgment.round")}</dt>
            <dd>{brief().round}</dd>
          </div>
          <div>
            <dt>{t("manager.orchestration.current-judgment.next-action")}</dt>
            <dd>{brief().nextAction}</dd>
          </div>
          <div class={brief().approvalCount > 0 ? "needs-approval" : ""}>
            <dt>{t("manager.orchestration.current-judgment.approval")}</dt>
            <dd>{brief().approval}</dd>
          </div>
          <div class={brief().reportIsStale ? "is-stale" : ""}>
            <dt>{t("manager.orchestration.current-judgment.report")}</dt>
            <dd>{brief().report}</dd>
          </div>
        </dl>
        <p class="manager-current-judgment-required">
          <strong>{t("manager.orchestration.current-judgment.required-action")}</strong>
          <span>{brief().recommendation}</span>
        </p>
      </section>
    )}
  </Show>
);

const ManagerCenterlineCard: Component<{
  snapshot: ManagerOrchestrationSnapshot | null;
  loading?: boolean | undefined;
}> = (props) => {
  const activeWorkers = createMemo(
    () =>
      props.snapshot?.workers.filter((worker) =>
        ["queued", "starting", "active", "quiet_but_alive", "waiting_external"].includes(
          worker.runtimeState,
        ),
      ) ?? [],
  );
  const availableActions = createMemo(
    () =>
      props.snapshot?.approvalActions.filter(
        (action) => action.requiresApproval && action.status === "available",
      ) ?? [],
  );
  const staleActions = createMemo(
    () =>
      props.snapshot?.approvalActions.filter((action) =>
        ["stale", "expired", "preflight_failed"].includes(action.status),
      ) ?? [],
  );

  return (
    <section
      class="manager-centerline-card"
      classList={{
        "manager-centerline-card-loading": Boolean(props.loading && !props.snapshot),
        [`manager-centerline-phase-${props.snapshot?.phase ?? "idle"}`]: true,
      }}
      aria-label={t("manager.orchestration.centerline.aria")}
    >
      <Show
        when={props.snapshot}
        fallback={
          <div class="manager-centerline-empty">
            {props.loading
              ? t("manager.orchestration.centerline.loading")
              : t("manager.orchestration.centerline.unavailable")}
          </div>
        }
      >
        {(snapshot) => (
          <>
            <header class="manager-centerline-head">
              <div>
                <span>{t("manager.orchestration.centerline.title")}</span>
                <strong>{managerCenterlinePhaseLabel(snapshot().phase)}</strong>
              </div>
              <p>
                <span>{t("manager.orchestration.centerline.updated")}</span>
                <strong>{formatTime(snapshot().updatedAt)}</strong>
              </p>
            </header>
            <ol class="manager-centerline-flow">
              <For each={snapshot().flow}>
                {(node) => (
                  <li
                    class="manager-centerline-node"
                    classList={{
                      "manager-centerline-node-done": node.status === "done",
                      "manager-centerline-node-current": node.status === "current",
                      "manager-centerline-node-blocked": node.status === "blocked",
                      "manager-centerline-node-pending": node.status === "pending",
                    }}
                    aria-current={node.status === "current" || node.status === "blocked" ? "step" : undefined}
                  >
                    <span>{managerCenterlinePhaseLabel(node.phase)}</span>
                    <small>{managerCenterlineNodeDetail(node, snapshot())}</small>
                    <Show when={node.status === "current" || node.status === "blocked"}>
                      <em>{t("manager.orchestration.centerline.current")}</em>
                    </Show>
                  </li>
                )}
              </For>
            </ol>
            <div class="manager-centerline-summary">
              <div>
                <span>{t("manager.orchestration.centerline.metric.action")}</span>
                <strong>{managerCenterlineReason(snapshot())}</strong>
              </div>
              <div>
                <span>{t("manager.orchestration.centerline.metric.approvals")}</span>
                <strong>
                  {t("manager.orchestration.centerline.metric.approvals-value", {
                    available: availableActions().length,
                    stale: staleActions().length,
                  })}
                </strong>
              </div>
              <div>
                <span>{t("manager.orchestration.centerline.metric.workers")}</span>
                <strong>{activeWorkers().length}</strong>
              </div>
              <div>
                <span>{t("manager.orchestration.centerline.metric.blockers")}</span>
                <strong>{snapshot().blockers.length}</strong>
              </div>
            </div>
            <Show when={availableActions().length > 0}>
              <div class="manager-centerline-actions">
                <span>{t("manager.orchestration.centerline.actions")}</span>
                <For each={availableActions().slice(0, 3)}>
                  {(action) => (
                    <small>
                      {managerCenterlineActionLabel(action)}
                      {" · "}
                      {managerCenterlineActionStatusLabel(action.status)}
                    </small>
                  )}
                </For>
              </div>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
};

const ManagerApprovalInbox: Component<{
  judgments: ManagerJudgmentPacket[];
  snapshot?: ManagerOrchestrationSnapshot | null | undefined;
  busy?: boolean | undefined;
  status?: string | null | undefined;
  error?: string | null | undefined;
  onApprove?: ((action: ManagerProposedAction) => void) | undefined;
  onDismiss: (judgmentId: string) => void;
}> = (props) => {
  const approvalJudgments = createMemo(() =>
    props.judgments.filter((judgment) => judgment.priority === "approval"),
  );
  const availableSnapshotActions = createMemo(
    () =>
      props.snapshot?.approvalActions.filter(
        (action) => action.requiresApproval && action.status === "available",
      ) ?? [],
  );
  const unavailableSnapshotActions = createMemo(
    () =>
      props.snapshot?.approvalActions.filter(
        (action) => action.requiresApproval && action.status !== "available",
      ) ?? [],
  );
  const visibleJudgments = createMemo(() => {
    const judgments = approvalJudgments();
    if (!props.snapshot) return judgments.slice(0, 4);
    return judgments
      .filter((judgment) =>
        judgment.proposedActions.some(
          (action) =>
            action.requiresApproval &&
            managerSnapshotActionForProposed(props.snapshot, action)?.status === "available",
        ),
      )
      .slice(0, 4);
  });
  const approvalCount = createMemo(() =>
    props.snapshot ? availableSnapshotActions().length : approvalJudgments().length,
  );
  return (
    <Show when={approvalCount() > 0 || Boolean(props.error || props.status)}>
      <section
        class="manager-approval-inbox"
        aria-label={t("manager.orchestration.approval.title")}
      >
        <header class="manager-approval-inbox-head">
          <div>
            <span>{t("manager.orchestration.approval.kicker")}</span>
            <strong>
              {approvalCount() > 0
                ? t("manager.orchestration.approval.pending", { count: approvalCount() })
                : t("manager.orchestration.approval.watch")}
            </strong>
          </div>
          <span>{t("manager.orchestration.approval.worker")}</span>
        </header>
        <Show when={props.error || props.status}>
          {(message) => (
            <p class="manager-approval-feedback" classList={{ "is-error": Boolean(props.error) }}>
              {message()}
            </p>
          )}
        </Show>
        <Show when={props.snapshot && unavailableSnapshotActions().length > 0}>
          <p class="manager-approval-feedback">
            {t("manager.orchestration.approval.unavailable-summary", {
              count: unavailableSnapshotActions().length,
            })}
          </p>
        </Show>
        <Show when={props.snapshot && approvalCount() > 0 && visibleJudgments().length === 0}>
          <p class="manager-approval-feedback">
            {t("manager.orchestration.approval.syncing-actions")}
          </p>
        </Show>
        <div class="manager-approval-list">
          <For each={visibleJudgments()}>
            {(judgment) => {
              const summary = managerJudgmentDisplaySummary(judgment);
              const reason = managerJudgmentDisplayReason(judgment);
              const approvalActions = judgment.proposedActions.filter((action) => {
                if (!action.requiresApproval) return false;
                if (!props.snapshot) return true;
                return managerSnapshotActionForProposed(props.snapshot, action)?.status === "available";
              });
              return (
                <article
                  class={`manager-approval-item manager-approval-item-${judgment.priority} manager-approval-verdict-${judgment.verdict}`}
                >
                  <div class="manager-approval-main">
                    <div class="manager-approval-meta">
                      <span>{managerJudgmentPriorityLabel(judgment.priority)}</span>
                      <span>{managerJudgmentVerdictLabel(judgment.verdict)}</span>
                      <span>{agentResultConfidenceLabel(judgment.confidence)}</span>
                    </div>
                    <strong title={summary}>{clip(summary, 120)}</strong>
                    <p title={reason}>{clip(reason, 180)}</p>
                    <div class="manager-approval-evidence">
                      <span>
                        {t("manager.orchestration.agent.evidence-count", {
                          count: judgment.evidenceIds.length,
                        })}
                      </span>
                      <Show when={judgment.protocolTraceIds.length > 0}>
                        <span>
                          {t("manager.orchestration.protocol.trace-count", {
                            count: judgment.protocolTraceIds.length,
                          })}
                        </span>
                      </Show>
                    </div>
                    <Show when={approvalActions[0]}>
                      {(action) => (
                        <div class="manager-approval-decision">
                          <span>{t("manager.orchestration.approval.decision-title")}</span>
                          <strong>{managerProposedActionLabel(action())}</strong>
                        </div>
                      )}
                    </Show>
                  </div>
                  <div class="manager-approval-actions">
                    <For each={approvalActions}>
                      {(action) => {
                        const snapshotAction = props.snapshot
                          ? managerSnapshotActionForProposed(props.snapshot, action)
                          : undefined;
                        return (
                          <div class="manager-approval-action-card">
                            <button
                              type="button"
                              disabled={props.busy || !props.onApprove}
                              title={action.rationale}
                              onClick={() => props.onApprove?.(action)}
                            >
                              {managerProposedActionLabel(action)}
                            </button>
                            <dl>
                              <dt>{t("manager.orchestration.approval.approve-effect")}</dt>
                              <dd>{managerProposedActionEffect(action)}</dd>
                              <dt>{t("manager.orchestration.approval.ignore-effect")}</dt>
                              <dd>{managerProposedActionDismissEffect(action)}</dd>
                            </dl>
                            <Show when={snapshotAction}>
                              {(current) => (
                                <p>
                                  {t("manager.orchestration.approval.preflight-status")}:{" "}
                                  {managerCenterlineActionStatusLabel(current().status)}
                                </p>
                              )}
                            </Show>
                            <Show when={action.rationale}>
                              {(rationale) => (
                                <p title={rationale()}>
                                  {t("manager.orchestration.approval.reason-label")}:{" "}
                                  {clip(rationale(), 140)}
                                </p>
                              )}
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                    <button
                      type="button"
                      class="text-button"
                      disabled={props.busy}
                      onClick={() => props.onDismiss(judgment.id)}
                    >
                      {t("manager.orchestration.action.dismiss-proposal")}
                    </button>
                  </div>
                </article>
              );
            }}
          </For>
        </div>
      </section>
    </Show>
  );
};

type ProjectWizardKind =
  | "app"
  | "website"
  | "automation"
  | "document"
  | "data"
  | "game"
  | "existing"
  | "other";

type ProjectWizardMode = "create" | "change" | "review";

type ManagerProjectCharterTextField =
  | "goal"
  | "scope"
  | "nonGoals"
  | "constraints"
  | "successCriteria"
  | "preferredApproach"
  | "verificationPlan"
  | "userCheckpoints"
  | "finalDeliverables";

const PROJECT_WIZARD_KINDS: ProjectWizardKind[] = [
  "app",
  "website",
  "automation",
  "document",
  "data",
  "game",
  "existing",
  "other",
];

const PROJECT_WIZARD_MODES: ProjectWizardMode[] = ["create", "change", "review"];

const ProjectHeader: Component<{
  projects: ManagerProject[];
  archivedProjects: ManagerProject[];
  selectedProject: ManagerProject | null;
  overview: ManagerProjectOverviewResponse | null;
  nextAction?: ManagerProjectOverviewAction | null | undefined;
  loading?: boolean | undefined;
  busy?: boolean | undefined;
  folderBusy?: boolean | undefined;
  folderError?: string | null | undefined;
  folderStatus?: string | null | undefined;
  onRefresh?: (() => void) | undefined;
  onSelect?: ((projectId: string | null) => void) | undefined;
  onOpenWizard: (mode: ProjectWizardMode) => void;
  onOpenFolder?: ((projectId: string) => void) | undefined;
  onArchive?: ((projectId: string) => void) | undefined;
  advanced?: boolean | undefined;
}> = (props) => {
  let projectSelectEl!: HTMLSelectElement;
  const project = createMemo(() => props.selectedProject);
  const headerNextAction = createMemo(() =>
    isManagerProjectCompleted(project())
      ? null
      : (props.nextAction ?? props.overview?.nextAction ?? null),
  );
  const visibleArchivedProjects = createMemo(() => {
    if (props.advanced) return props.archivedProjects;
    const selectedId = project()?.id;
    return props.archivedProjects.filter((item) => item.id === selectedId);
  });
  const projectOptions = createMemo(() => [...props.projects, ...visibleArchivedProjects()]);
  createEffect(() => {
    const selectedProjectId = project()?.id ?? "";
    if (projectSelectEl && projectSelectEl.value !== selectedProjectId) {
      projectSelectEl.value = selectedProjectId;
    }
  });
  return (
    <section class="manager-project-header" aria-label={t("manager.orchestration.project.aria")}>
      <div class="manager-project-header-main">
        <div class="manager-project-selector-row">
          <span class="manager-project-label">{t("manager.orchestration.project.label")}</span>
          <select
            ref={projectSelectEl}
            value={project()?.id ?? ""}
            disabled={props.busy || projectOptions().length === 0}
            onChange={(event) => props.onSelect?.(event.currentTarget.value || null)}
          >
            <option value="">{t("manager.orchestration.project.none")}</option>
            <For each={props.projects}>
              {(item) => <option value={item.id}>{item.name}</option>}
            </For>
            <For each={visibleArchivedProjects()}>
              {(item) => (
                <option value={item.id}>
                  {t("manager.orchestration.project.archived", { name: item.name })}
                </option>
              )}
            </For>
          </select>
          <button type="button" disabled={props.busy} onClick={() => props.onOpenWizard("create")}>
            {t("manager.orchestration.action.new-project")}
          </button>
          <button
            type="button"
            disabled={props.busy || !project()}
            onClick={() => props.onOpenWizard("change")}
          >
            {t("manager.orchestration.action.intent-wizard")}
          </button>
          <Show when={Boolean(props.onOpenFolder)}>
            <button
              type="button"
              disabled={props.busy || props.folderBusy || !project()}
              onClick={() => {
                const current = project();
                if (current) props.onOpenFolder?.(current.id);
              }}
            >
              {props.folderBusy
                ? t("manager.orchestration.action.opening-folder")
                : t("manager.orchestration.action.open-project-folder")}
            </button>
          </Show>
          <button
            type="button"
            disabled={props.busy || props.loading}
            onClick={() => props.onRefresh?.()}
          >
            {props.loading
              ? t("manager.orchestration.action.loading")
              : t("manager.orchestration.action.refresh")}
          </button>
          <Show
            when={Boolean(
              props.advanced && project() && project()?.status !== "archived" && props.onArchive,
            )}
          >
            <button
              type="button"
              disabled={props.busy}
              onClick={() => {
                const current = project();
                if (
                  current &&
                  confirmManagerAction("manager.orchestration.confirm.archive-project", {
                    name: current.name,
                  })
                ) {
                  props.onArchive?.(current.id);
                }
              }}
            >
              {t("manager.orchestration.action.archive-project")}
            </button>
          </Show>
        </div>
        <Show when={props.folderError}>
          {(error) => (
            <p class="manager-project-open-error" role="alert">
              {t("manager.orchestration.project.open-folder-error", { error: error() })}
            </p>
          )}
        </Show>
        <Show when={!props.folderError && props.folderStatus}>
          {(status) => (
            <p class="manager-project-open-status" role="status">
              {status()}
            </p>
          )}
        </Show>
        <Show
          when={project()}
          fallback={
            <p class="manager-project-summary">{t("manager.orchestration.project.summary-none")}</p>
          }
        >
          {(current) => (
            <dl class="manager-project-summary manager-project-summary-grid">
              <div>
                <dt>{t("manager.orchestration.project-summary.project")}</dt>
                <dd>
                  <strong>{current().name}</strong>
                  <span>{statusLabel(current().status)}</span>
                </dd>
              </div>
              <div>
                <dt>{t("manager.orchestration.project-summary.stage")}</dt>
                <dd>{managerProjectFlowStageLabel(current().flowStage)}</dd>
              </div>
              <div>
                <dt>{t("manager.orchestration.project-summary.next")}</dt>
                <dd>
                  <Show
                    when={headerNextAction()}
                    fallback={t("manager.orchestration.project-summary.next-unknown")}
                  >
                    {(action) => managerProjectOverviewActionLabel(action())}
                  </Show>
                </dd>
              </div>
              <Show when={props.advanced}>
                <div>
                  <dt>{t("manager.orchestration.project-summary.workspace")}</dt>
                  <dd title={current().cwd}>{current().cwd}</dd>
                </div>
                <Show when={current().activeRoundId}>
                  {(roundId) => (
                    <div>
                      <dt>{t("manager.orchestration.project-summary.round")}</dt>
                      <dd>{t("manager.orchestration.word.round", { id: shortId(roundId()) })}</dd>
                    </div>
                  )}
                </Show>
              </Show>
              <Show when={current().goal}>
                {(text) => (
                  <div>
                    <dt>{t("manager.orchestration.project-summary.goal")}</dt>
                    <dd>{clip(text(), 160)}</dd>
                  </div>
                )}
              </Show>
            </dl>
          )}
        </Show>
      </div>
    </section>
  );
};

const GlobalManagerStatus: Component<{
  state: ManagerStateViewResponse | null | undefined;
  freshnessLabel: string | undefined;
  eventConnectionLabel: string | null | undefined;
  totals: ReturnType<typeof summarizeTotals>;
  runTotals: ReturnType<typeof summarizeWorkerRunTotals>;
  issueCount: number;
  busy?: boolean | undefined;
  onAcknowledge?: (() => void) | undefined;
}> = (props) => {
  const current = createMemo(() => props.state?.current ?? null);
  const hasGlobalSignal = createMemo(
    () =>
      Boolean(props.state) ||
      Boolean(props.freshnessLabel) ||
      Boolean(props.eventConnectionLabel) ||
      props.issueCount > 0 ||
      props.totals.total > 0 ||
      props.runTotals.total > 0,
  );

  return (
    <Show when={hasGlobalSignal()}>
      <details class="manager-global-status">
        <summary>
          <span>{t("manager.orchestration.global.title")}</span>
          <Show when={current()}>{(item) => <span>{statusLabel(item().status)}</span>}</Show>
          <Show when={props.issueCount > 0}>
            <span>
              {t("manager.orchestration.global.issue-count", { count: props.issueCount })}
            </span>
          </Show>
          <span>{t("manager.orchestration.metric.running", { count: props.totals.running })}</span>
          <span>
            {t("manager.orchestration.metric.runs", {
              active: props.runTotals.active,
              total: props.runTotals.total,
            })}
          </span>
        </summary>
        <div class="manager-global-status-body">
          <Show when={current()} fallback={<p>{t("manager.orchestration.global.empty")}</p>}>
            {(item) => (
              <dl>
                <div>
                  <dt>{t("manager.orchestration.field.kind")}</dt>
                  <dd>{item().kind}</dd>
                </div>
                <div>
                  <dt>{t("manager.orchestration.field.state")}</dt>
                  <dd>{statusLabel(item().status)}</dd>
                </div>
                <div>
                  <dt>{t("manager.orchestration.field.signal")}</dt>
                  <dd>{item().title}</dd>
                </div>
                <Show when={item().detail}>
                  {(detail) => (
                    <div>
                      <dt>{t("manager.orchestration.field.detail")}</dt>
                      <dd>{clip(detail(), 140)}</dd>
                    </div>
                  )}
                </Show>
              </dl>
            )}
          </Show>
          <div class="manager-global-status-meta">
            <Show when={props.freshnessLabel}>{(label) => <span>{label()}</span>}</Show>
            <Show when={props.eventConnectionLabel}>{(label) => <span>{label()}</span>}</Show>
            <span>
              {t("manager.orchestration.metric.blocked", { count: props.totals.blocked })}
            </span>
            <Show when={props.issueCount > 0 && Boolean(props.onAcknowledge)}>
              <button
                type="button"
                disabled={props.busy}
                onClick={() => props.onAcknowledge?.()}
                title={t("manager.orchestration.recovery.acknowledge-title")}
              >
                {props.busy
                  ? t("manager.orchestration.action.acknowledging")
                  : t("manager.orchestration.action.acknowledge")}
              </button>
            </Show>
          </div>
        </div>
      </details>
    </Show>
  );
};

const ProjectWizardDialog: Component<{
  open: boolean;
  mode: ProjectWizardMode;
  project: ManagerProject | null;
  commandFlow: ManagerCommandFlowResponse | null;
  activeRound: ManagerRound | undefined;
  busy?: boolean | undefined;
  docked?: boolean | undefined;
  onModeChange: (mode: ProjectWizardMode) => void;
  onClose: () => void;
  onCreate?: ((input: ManagerProjectCreateRequest) => void) | undefined;
  onUpdateCharter?: ((input: ManagerProjectCharterUpdateRequest) => void) | undefined;
  onComplete?: ((input: ManagerProjectCompleteRequest) => void) | undefined;
}> = (props) => {
  const [name, setName] = createSignal("");
  const [cwd, setCwd] = createSignal("");
  const [goal, setGoal] = createSignal("");
  const [intent, setIntent] = createSignal("");
  const [kind, setKind] = createSignal<ProjectWizardKind>("app");
  const [audience, setAudience] = createSignal("");
  const [useCase, setUseCase] = createSignal("");
  const [scope, setScope] = createSignal("");
  const [constraints, setConstraints] = createSignal("");
  const [successCriteria, setSuccessCriteria] = createSignal("");
  const [nonGoals, setNonGoals] = createSignal("");
  const [preferredApproach, setPreferredApproach] = createSignal("");
  const [verificationPlan, setVerificationPlan] = createSignal("");
  const [userCheckpoints, setUserCheckpoints] = createSignal("");
  const [finalDeliverables, setFinalDeliverables] = createSignal("");
  const [protocolSource, setProtocolSource] =
    createSignal<ManagerProjectProtocolSource>("base-copy");
  const [finalSummary, setFinalSummary] = createSignal("");
  const [remainingRisks, setRemainingRisks] = createSignal("");
  const [verificationEvidence, setVerificationEvidence] = createSignal("");
  const [finalArtifacts, setFinalArtifacts] = createSignal("");
  const [acceptedByUser, setAcceptedByUser] = createSignal(false);

  const activeRound = createMemo(() => props.commandFlow?.activeRound ?? props.activeRound);
  const currentCharter = createMemo(() => commandFlowCharter(props.project, props.commandFlow));
  const generatedName = createMemo(() => projectWizardName(intent(), kind()));
  const projectName = createMemo(() => name().trim() || generatedName());
  const projectGoal = createMemo(() => goal().trim() || projectWizardGoal(intent()));
  const createCharter = createMemo<Partial<ManagerProjectCharter>>(() =>
    buildProjectWizardCharter({
      goal: projectGoal(),
      intent: intent(),
      kind: kind(),
      audience: audience(),
      useCase: useCase(),
      constraints: constraints(),
      successCriteria: successCriteria(),
      nonGoals: nonGoals(),
      preferredApproach: preferredApproach(),
    }),
  );
  const editedCharter = createMemo<ManagerProjectCharterUpdateRequest>(() => ({
    goal: goal(),
    scope: scope(),
    nonGoals: nonGoals(),
    constraints: constraints(),
    successCriteria: successCriteria(),
    preferredApproach: preferredApproach(),
    verificationPlan: verificationPlan(),
    userCheckpoints: userCheckpoints(),
    finalDeliverables: finalDeliverables(),
    updatedBy: "browser",
  }));
  const charterPreview = createMemo<Partial<ManagerProjectCharter>>(() =>
    props.mode === "create" ? createCharter() : editedCharter(),
  );
  const cwdIssue = createMemo(() => {
    if (props.mode !== "create" || !cwd().trim()) return "";
    return isLikelyAbsoluteWorkspacePath(cwd())
      ? ""
      : t("manager.orchestration.project-wizard.warning.cwd-absolute");
  });
  const modeGuidance = createMemo(() => projectWizardModeGuidance(props.mode));
  const wizardEventPreview = createMemo<ManagerWizardIntentEventInput | undefined>(() => {
    if (props.mode === "create") {
      return buildProjectWizardIntentEvent(createCharter(), protocolSource(), activeRound()?.id);
    }
    if (props.mode === "change") {
      return buildCharterApplyWizardIntentEvent(
        currentCharter(),
        editedCharter(),
        props.commandFlow?.readiness.stage,
        activeRound()?.id,
      );
    }
    return undefined;
  });
  const canCreate = createMemo(() =>
    Boolean(cwd().trim() && !cwdIssue() && projectGoal().trim() && props.onCreate && !props.busy),
  );
  const canApply = createMemo(() =>
    Boolean(props.project && props.onUpdateCharter && wizardEventPreview() && !props.busy),
  );
  const canComplete = createMemo(() =>
    Boolean(props.project && props.onComplete && finalSummary().trim() && !props.busy),
  );

  const resetCreateWizard = () => {
    setName("");
    setCwd("");
    setGoal("");
    setIntent("");
    setKind("app");
    setAudience("");
    setUseCase("");
    setScope("");
    setConstraints("");
    setSuccessCriteria("");
    setNonGoals("");
    setPreferredApproach("");
    setVerificationPlan("");
    setUserCheckpoints("");
    setFinalDeliverables("");
    setProtocolSource("base-copy");
  };

  createEffect(() => {
    if (!props.open) return;
    if (props.mode === "create") {
      resetCreateWizard();
      return;
    }
    const charter = currentCharter();
    setName(props.project?.name ?? "");
    setCwd(props.project?.cwd ?? "");
    setGoal(charter.goal);
    setIntent(charter.goal || props.project?.goal || "");
    setKind("existing");
    setAudience("");
    setUseCase("");
    setScope(charter.scope);
    setNonGoals(charter.nonGoals);
    setConstraints(charter.constraints);
    setSuccessCriteria(charter.successCriteria);
    setPreferredApproach(charter.preferredApproach);
    setVerificationPlan(charter.verificationPlan);
    setUserCheckpoints(charter.userCheckpoints);
    setFinalDeliverables(charter.finalDeliverables);
    setFinalSummary(props.project?.finalReview?.summary || props.project?.summary || charter.goal);
    setRemainingRisks(props.project?.finalReview?.remainingRisks || "");
    setVerificationEvidence(props.project?.finalReview?.verificationEvidence || "");
    setFinalArtifacts((props.project?.finalReview?.artifacts ?? []).join("\n"));
    setAcceptedByUser(Boolean(props.project?.finalReview?.acceptedByUser));
  });

  const submitCreate = () => {
    const value = cwd().trim();
    const nextGoal = projectGoal().trim();
    if (!value || !nextGoal || !props.onCreate) return;
    props.onCreate({
      cwd: value,
      ...(projectName().trim() ? { name: projectName().trim() } : {}),
      goal: nextGoal,
      protocolSource: protocolSource(),
      charter: createCharter(),
      wizardEvent: buildProjectWizardIntentEvent(createCharter(), protocolSource(), undefined),
    });
    props.onClose();
  };

  const applyChange = () => {
    const wizardEvent = wizardEventPreview();
    if (!props.project || !props.onUpdateCharter || !wizardEvent) return;
    props.onUpdateCharter({
      ...editedCharter(),
      wizardEvent,
    });
    props.onClose();
  };

  const completeProject = () => {
    if (!props.project || !props.onComplete || !finalSummary().trim()) return;
    if (
      !confirmManagerAction("manager.orchestration.confirm.complete-project", {
        name: props.project.name,
      })
    ) {
      return;
    }
    props.onComplete({
      summary: finalSummary(),
      acceptedByUser: acceptedByUser(),
      goalMatched: acceptedByUser(),
      remainingRisks: remainingRisks(),
      verificationEvidence: verificationEvidence(),
      artifacts: splitList(finalArtifacts()),
    });
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        class="manager-wizard-dialog-root"
        classList={{ "manager-wizard-dialog-root-docked": Boolean(props.docked) }}
      >
        <button
          type="button"
          class="manager-wizard-dialog-backdrop"
          aria-label={t("manager.orchestration.action.cancel")}
          onClick={() => props.onClose()}
        />
        <dialog
          open
          class="manager-wizard-dialog"
          classList={{ "manager-wizard-dialog-docked": Boolean(props.docked) }}
          aria-modal={props.docked ? "false" : "true"}
          aria-labelledby="manager-wizard-dialog-title"
        >
          <header class="manager-wizard-dialog-head">
            <div>
              <span>{t("manager.orchestration.project-wizard.window-kicker")}</span>
              <h3 id="manager-wizard-dialog-title">{projectWizardModeTitle(props.mode)}</h3>
            </div>
            <button
              type="button"
              class="manager-wizard-dialog-close"
              aria-label={t("manager.orchestration.action.cancel")}
              onClick={() => props.onClose()}
            >
              ×
            </button>
          </header>
          <div
            class="manager-wizard-dialog-modes"
            role="tablist"
            aria-label={t("manager.orchestration.project-wizard.mode-label")}
          >
            <For each={PROJECT_WIZARD_MODES}>
              {(item) => (
                <button
                  type="button"
                  role="tab"
                  class="manager-wizard-dialog-mode"
                  classList={{ "is-active": props.mode === item }}
                  aria-selected={props.mode === item}
                  disabled={item !== "create" && !props.project}
                  onClick={() => props.onModeChange(item)}
                >
                  {projectWizardModeLabel(item)}
                </button>
              )}
            </For>
          </div>
          <p class="manager-wizard-dialog-guidance">{modeGuidance()}</p>
          <div class="manager-wizard-dialog-body">
            <Show when={props.mode === "create"}>
              <form
                class="manager-project-create manager-wizard-dialog-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCreate();
                }}
              >
                <label class="manager-project-wizard-field">
                  <span>{t("manager.orchestration.project-wizard.field.project-name")}</span>
                  <input
                    type="text"
                    value={name()}
                    onInput={(event) => setName(event.currentTarget.value)}
                    placeholder={
                      generatedName() || t("manager.orchestration.placeholder.project-name")
                    }
                  />
                </label>
                <label class="manager-project-wizard-field manager-project-wizard-intent">
                  <span>{t("manager.orchestration.project-wizard.field.intent")}</span>
                  <textarea
                    value={intent()}
                    onInput={(event) => setIntent(event.currentTarget.value)}
                    placeholder={t("manager.orchestration.project-wizard.placeholder.intent")}
                    rows={3}
                    required
                  />
                </label>
                <div
                  class="manager-project-wizard-kinds"
                  aria-label={t("manager.orchestration.project-wizard.field.kind")}
                >
                  <For each={PROJECT_WIZARD_KINDS}>
                    {(item) => (
                      <button
                        type="button"
                        class="manager-project-wizard-kind"
                        classList={{ "is-active": kind() === item }}
                        aria-pressed={kind() === item}
                        onClick={() => setKind(item)}
                      >
                        {projectWizardKindLabel(item)}
                      </button>
                    )}
                  </For>
                </div>
                <div class="manager-project-wizard-grid">
                  <label class="manager-project-wizard-field">
                    <span>{t("manager.orchestration.project-wizard.field.cwd")}</span>
                    <input
                      type="text"
                      value={cwd()}
                      onInput={(event) => setCwd(event.currentTarget.value)}
                      placeholder={t("manager.orchestration.placeholder.project-cwd")}
                      aria-label={t("manager.orchestration.project-wizard.field.cwd")}
                      aria-invalid={cwdIssue() ? "true" : "false"}
                      required
                    />
                    <span
                      class="manager-project-wizard-help"
                      classList={{ "is-warning": Boolean(cwdIssue()) }}
                    >
                      {cwdIssue() || t("manager.orchestration.project-wizard.help.cwd")}
                    </span>
                  </label>
                  <label class="manager-project-wizard-field">
                    <span>{t("manager.orchestration.project-wizard.field.goal")}</span>
                    <input
                      type="text"
                      value={goal()}
                      onInput={(event) => setGoal(event.currentTarget.value)}
                      placeholder={
                        projectGoal() || t("manager.orchestration.placeholder.project-goal")
                      }
                    />
                  </label>
                  <label class="manager-project-wizard-field">
                    <span>{t("manager.orchestration.project-wizard.field.audience")}</span>
                    <input
                      type="text"
                      value={audience()}
                      onInput={(event) => setAudience(event.currentTarget.value)}
                      placeholder={t("manager.orchestration.project-wizard.placeholder.audience")}
                    />
                  </label>
                  <label class="manager-project-wizard-field">
                    <span>{t("manager.orchestration.project-wizard.field.use-case")}</span>
                    <input
                      type="text"
                      value={useCase()}
                      onInput={(event) => setUseCase(event.currentTarget.value)}
                      placeholder={t("manager.orchestration.project-wizard.placeholder.use-case")}
                    />
                  </label>
                  <label class="manager-project-wizard-field">
                    <span>{t("manager.orchestration.project.protocol-source")}</span>
                    <select
                      value={protocolSource()}
                      onChange={(event) =>
                        setProtocolSource(event.currentTarget.value as ManagerProjectProtocolSource)
                      }
                    >
                      <option value="base-copy">
                        {t("manager.orchestration.project.protocol-source.base-copy")}
                      </option>
                      <option value="blank">
                        {t("manager.orchestration.project.protocol-source.blank")}
                      </option>
                    </select>
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.success")}</span>
                    <textarea
                      value={successCriteria()}
                      onInput={(event) => setSuccessCriteria(event.currentTarget.value)}
                      placeholder={projectWizardDefaultSuccess(kind())}
                      rows={2}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.constraints")}</span>
                    <textarea
                      value={constraints()}
                      onInput={(event) => setConstraints(event.currentTarget.value)}
                      placeholder={t("manager.orchestration.project-wizard.generated.constraints")}
                      rows={2}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.non-goals")}</span>
                    <textarea
                      value={nonGoals()}
                      onInput={(event) => setNonGoals(event.currentTarget.value)}
                      placeholder={t("manager.orchestration.project-wizard.generated.non-goals")}
                      rows={2}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.approach")}</span>
                    <textarea
                      value={preferredApproach()}
                      onInput={(event) => setPreferredApproach(event.currentTarget.value)}
                      placeholder={t("manager.orchestration.project-wizard.generated.approach")}
                      rows={2}
                    />
                  </label>
                </div>
              </form>
            </Show>
            <Show when={props.mode === "change"}>
              <form
                class="manager-project-create manager-wizard-dialog-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyChange();
                }}
              >
                <label class="manager-project-wizard-field">
                  <span>{t("manager.orchestration.project-wizard.field.goal")}</span>
                  <input
                    type="text"
                    value={goal()}
                    onInput={(event) => setGoal(event.currentTarget.value)}
                    placeholder={t("manager.orchestration.placeholder.project-goal")}
                  />
                </label>
                <div class="manager-project-wizard-grid">
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.scope")}</span>
                    <textarea
                      value={scope()}
                      onInput={(event) => setScope(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.constraints")}</span>
                    <textarea
                      value={constraints()}
                      onInput={(event) => setConstraints(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.success")}</span>
                    <textarea
                      value={successCriteria()}
                      onInput={(event) => setSuccessCriteria(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.verification")}</span>
                    <textarea
                      value={verificationPlan()}
                      onInput={(event) => setVerificationPlan(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.checkpoints")}</span>
                    <textarea
                      value={userCheckpoints()}
                      onInput={(event) => setUserCheckpoints(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.deliverables")}</span>
                    <textarea
                      value={finalDeliverables()}
                      onInput={(event) => setFinalDeliverables(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.non-goals")}</span>
                    <textarea
                      value={nonGoals()}
                      onInput={(event) => setNonGoals(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                  <label class="manager-project-wizard-field manager-project-wizard-wide">
                    <span>{t("manager.orchestration.project-wizard.field.approach")}</span>
                    <textarea
                      value={preferredApproach()}
                      onInput={(event) => setPreferredApproach(event.currentTarget.value)}
                      rows={3}
                    />
                  </label>
                </div>
              </form>
            </Show>
            <Show when={props.mode === "review"}>
              <form
                class="manager-project-create manager-wizard-dialog-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  completeProject();
                }}
              >
                <label class="manager-project-wizard-field manager-project-wizard-wide">
                  <span>{t("manager.orchestration.project-wizard.field.review-summary")}</span>
                  <textarea
                    value={finalSummary()}
                    onInput={(event) => setFinalSummary(event.currentTarget.value)}
                    rows={4}
                  />
                </label>
                <label class="manager-project-wizard-field manager-project-wizard-wide">
                  <span>
                    {t("manager.orchestration.project-wizard.field.verification-evidence")}
                  </span>
                  <textarea
                    value={verificationEvidence()}
                    onInput={(event) => setVerificationEvidence(event.currentTarget.value)}
                    rows={3}
                  />
                </label>
                <label class="manager-project-wizard-field manager-project-wizard-wide">
                  <span>{t("manager.orchestration.project-wizard.field.remaining-risks")}</span>
                  <textarea
                    value={remainingRisks()}
                    onInput={(event) => setRemainingRisks(event.currentTarget.value)}
                    rows={3}
                  />
                </label>
                <label class="manager-project-wizard-field manager-project-wizard-wide">
                  <span>{t("manager.orchestration.project-wizard.field.final-artifacts")}</span>
                  <textarea
                    value={finalArtifacts()}
                    onInput={(event) => setFinalArtifacts(event.currentTarget.value)}
                    rows={3}
                  />
                </label>
                <label class="manager-flow-check">
                  <input
                    type="checkbox"
                    checked={acceptedByUser()}
                    onChange={(event) => setAcceptedByUser(event.currentTarget.checked)}
                  />
                  <span>{t("manager.orchestration.project-wizard.field.accepted")}</span>
                </label>
              </form>
            </Show>
            <aside
              class="manager-project-wizard-summary manager-wizard-dialog-preview"
              aria-label={t("manager.orchestration.project-wizard.summary")}
            >
              <div class="manager-project-wizard-summary-head">
                <strong>
                  {props.mode === "create"
                    ? projectName() || t("manager.orchestration.project-wizard.summary")
                    : props.project?.name || t("manager.orchestration.project-wizard.summary")}
                </strong>
                <span>
                  {props.mode === "create"
                    ? projectProtocolSourceLabel(protocolSource())
                    : projectWizardModeLabel(props.mode)}
                </span>
              </div>
              <dl>
                <For each={projectWizardSummaryRows(charterPreview())}>
                  {(row) => (
                    <div>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  )}
                </For>
              </dl>
              <Show
                when={wizardEventPreview()}
                fallback={
                  <p class="manager-wizard-dialog-event-empty">
                    {t("manager.orchestration.project-wizard.event.no-change")}
                  </p>
                }
              >
                {(event) => (
                  <div class="manager-wizard-dialog-event">
                    <span>{t("manager.orchestration.project-wizard.event.preview")}</span>
                    <strong>{wizardIntentEventInputLabel(event())}</strong>
                  </div>
                )}
              </Show>
              <p class="manager-wizard-dialog-next">{modeGuidance()}</p>
            </aside>
          </div>
          <footer class="manager-wizard-dialog-footer">
            <button type="button" onClick={() => props.onClose()}>
              {t("manager.orchestration.action.cancel")}
            </button>
            <Show when={props.mode === "create"}>
              <button type="button" disabled={!canCreate()} onClick={submitCreate}>
                {t("manager.orchestration.action.create")}
              </button>
            </Show>
            <Show when={props.mode === "change"}>
              <button type="button" disabled={!canApply()} onClick={applyChange}>
                {t("manager.orchestration.action.apply-wizard")}
              </button>
            </Show>
            <Show when={props.mode === "review"}>
              <button type="button" disabled={!canComplete()} onClick={completeProject}>
                {t("manager.orchestration.action.complete-project")}
              </button>
            </Show>
          </footer>
        </dialog>
      </div>
    </Show>
  );
};

const CommandFlowStateMachine: Component<{
  project: ManagerProject | null;
  commandFlow: ManagerCommandFlowResponse | null;
  overview?: ManagerProjectOverviewResponse | null | undefined;
  activeRound: ManagerRound | undefined;
}> = (props) => {
  const currentStage = createMemo(() =>
    resolveCurrentCommandFlowStage(props.project, props.commandFlow, props.activeRound),
  );
  const nextAction = createMemo(
    () =>
      props.commandFlow?.nextAction ??
      props.commandFlow?.overview.nextAction ??
      props.overview?.nextAction ??
      null,
  );
  const readiness = createMemo(() => props.commandFlow?.readiness ?? null);
  const openBlockers = createMemo(
    () => props.commandFlow?.blockers.filter((blocker) => blocker.status === "open") ?? [],
  );
  const stateMeta = createMemo(() => {
    if (
      openBlockers().some(
        (blocker) =>
          blocker.requiredAction === "user" && !managerBlockerIsToolchainSetupCandidate(blocker),
      )
    ) {
      return t("manager.orchestration.flow.state-machine.user-check");
    }
    if (readiness()?.warnings.length) {
      return managerCommandFlowWarningLabel(readiness()?.warnings[0] ?? "");
    }
    const action = nextAction();
    if (action) return managerProjectOverviewActionLabel(action);
    return managerCommandFlowStageNextLabel(currentStage());
  });

  return (
    <section
      class="manager-state-machine"
      aria-label={t("manager.orchestration.flow.state-machine.title")}
    >
      <header class="manager-state-machine-head">
        <div>
          <strong>{t("manager.orchestration.flow.state-machine.title")}</strong>
          <span>{t("manager.orchestration.flow.state-machine.subtitle")}</span>
        </div>
        <p>
          <span>{t("manager.orchestration.flow.state-machine.current")}</span>
          <strong>{managerProjectFlowStageLabel(currentStage())}</strong>
        </p>
      </header>
      <ul class="manager-state-machine-track">
        <For each={COMMAND_FLOW_MAIN_STAGES}>
          {(stage, index) => (
            <li class="manager-state-machine-step">
              <CommandFlowStateNode stage={stage} currentStage={currentStage()} />
              <Show when={index() < COMMAND_FLOW_MAIN_STAGES.length - 1}>
                <span class="manager-state-machine-connector" aria-hidden="true" />
              </Show>
            </li>
          )}
        </For>
      </ul>
      <div class="manager-state-machine-branches">
        <div class="manager-state-machine-route">
          <span class="manager-state-machine-route-label">
            {t("manager.orchestration.flow.state-machine.route.iterate")}
          </span>
          <CommandFlowStateNode stage="replanning" currentStage={currentStage()} compact />
          <span class="manager-state-machine-route-target">
            {t("manager.orchestration.flow.state-machine.route.back-to-running")}
          </span>
        </div>
        <div class="manager-state-machine-route">
          <span class="manager-state-machine-route-label">
            {t("manager.orchestration.flow.state-machine.route.finish")}
          </span>
          <For each={COMMAND_FLOW_BRANCH_STAGES.filter((stage) => stage !== "replanning")}>
            {(stage) => (
              <CommandFlowStateNode stage={stage} currentStage={currentStage()} compact />
            )}
          </For>
        </div>
      </div>
      <footer class="manager-state-machine-foot">
        <span>{t("manager.orchestration.flow.state-machine.next")}</span>
        <strong>{stateMeta()}</strong>
      </footer>
    </section>
  );
};

const CommandFlowStateNode: Component<{
  stage: ManagerCommandFlowStage;
  currentStage: ManagerCommandFlowStage;
  compact?: boolean | undefined;
}> = (props) => {
  const isCurrent = createMemo(() => props.currentStage === props.stage);
  const isDone = createMemo(() => commandFlowStageDone(props.stage, props.currentStage));

  return (
    <div
      class="manager-state-machine-node"
      classList={{
        "manager-state-machine-node-current": isCurrent(),
        "manager-state-machine-node-done": isDone(),
        "manager-state-machine-node-compact": Boolean(props.compact),
      }}
      data-flow-stage={props.stage}
      aria-current={isCurrent() ? "step" : undefined}
    >
      <span class="manager-state-machine-node-label">
        {t(`manager.orchestration.flow.stage.${props.stage}`)}
      </span>
      <small>{t(`manager.orchestration.flow.stage-detail.${props.stage}`)}</small>
      <Show when={isCurrent()}>
        <em>{t("manager.orchestration.flow.state-machine.current-marker")}</em>
      </Show>
    </div>
  );
};

const CommandFlowView: Component<{
  project: ManagerProject | null;
  commandFlow: ManagerCommandFlowResponse | null;
  activeRound: ManagerRound | undefined;
  busy: boolean | undefined;
  onUpdateCharter?: ((input: ManagerProjectCharterUpdateRequest) => void) | undefined;
  onPrepare?: (() => void) | undefined;
  onStart?: ((input: ManagerProjectStartRequest) => void) | undefined;
  onReview?: ((roundId: string, input: ManagerRoundReviewRequest) => void) | undefined;
  onDirectionChange?: ((input: ManagerDirectionChangeRequest) => void) | undefined;
  onComplete?: ((input: ManagerProjectCompleteRequest) => void) | undefined;
}> = (props) => {
  const [goal, setGoal] = createSignal("");
  const [scope, setScope] = createSignal("");
  const [nonGoals, setNonGoals] = createSignal("");
  const [constraints, setConstraints] = createSignal("");
  const [successCriteria, setSuccessCriteria] = createSignal("");
  const [preferredApproach, setPreferredApproach] = createSignal("");
  const [verificationPlan, setVerificationPlan] = createSignal("");
  const [userCheckpoints, setUserCheckpoints] = createSignal("");
  const [finalDeliverables, setFinalDeliverables] = createSignal("");
  const [phase, setPhase] =
    createSignal<NonNullable<ManagerProjectStartRequest["phase"]>>("design");
  const [startObjective, setStartObjective] = createSignal("");
  const [dryRun, setDryRun] = createSignal(true);
  const [reviewAction, setReviewAction] =
    createSignal<ManagerRoundReviewRequest["action"]>("accept");
  const [reviewSummary, setReviewSummary] = createSignal("");
  const [reviewNextObjective, setReviewNextObjective] = createSignal("");
  const [directionChange, setDirectionChange] = createSignal("");
  const [directionImpact, setDirectionImpact] = createSignal("");
  const [directionNextObjective, setDirectionNextObjective] = createSignal("");
  const [roundAction, setRoundAction] =
    createSignal<NonNullable<ManagerDirectionChangeRequest["currentRoundAction"]>>("keep");
  const [finalSummary, setFinalSummary] = createSignal("");
  const [remainingRisks, setRemainingRisks] = createSignal("");
  const [verificationEvidence, setVerificationEvidence] = createSignal("");
  const [finalArtifacts, setFinalArtifacts] = createSignal("");
  const [acceptedByUser, setAcceptedByUser] = createSignal(false);

  const charter = createMemo(() => commandFlowCharter(props.project, props.commandFlow));
  const activeRound = createMemo(() => props.commandFlow?.activeRound ?? props.activeRound);
  const readiness = createMemo(() => props.commandFlow?.readiness ?? null);
  const wizardEvents = createMemo(
    () => props.commandFlow?.wizardEvents ?? props.project?.wizardEvents ?? [],
  );
  const disabled = createMemo(() => props.busy || !props.project);

  createEffect(() => {
    const value = charter();
    setGoal(value.goal);
    setScope(value.scope);
    setNonGoals(value.nonGoals);
    setConstraints(value.constraints);
    setSuccessCriteria(value.successCriteria);
    setPreferredApproach(value.preferredApproach);
    setVerificationPlan(value.verificationPlan);
    setUserCheckpoints(value.userCheckpoints);
    setFinalDeliverables(value.finalDeliverables);
    setStartObjective(value.goal || props.project?.goal || "");
    setFinalSummary(props.project?.summary || value.goal || "");
  });

  const saveCharter = () => {
    const nextCharter: ManagerProjectCharterUpdateRequest = {
      goal: goal(),
      scope: scope(),
      nonGoals: nonGoals(),
      constraints: constraints(),
      successCriteria: successCriteria(),
      preferredApproach: preferredApproach(),
      verificationPlan: verificationPlan(),
      userCheckpoints: userCheckpoints(),
      finalDeliverables: finalDeliverables(),
      updatedBy: "browser",
    };
    const wizardEvent = buildCharterApplyWizardIntentEvent(
      charter(),
      nextCharter,
      readiness()?.stage,
      activeRound()?.id,
    );
    props.onUpdateCharter?.({
      ...nextCharter,
      ...(wizardEvent ? { wizardEvent } : {}),
    });
  };

  const start = () => {
    props.onStart?.({
      objective: startObjective(),
      phase: phase(),
      dryRun: dryRun(),
    });
  };

  const review = () => {
    const round = activeRound();
    if (!round) return;
    props.onReview?.(round.id, {
      action: reviewAction(),
      summary: reviewSummary(),
      nextObjective: reviewNextObjective(),
      createNextRound: Boolean(reviewNextObjective().trim()),
    });
  };

  const changeDirection = () => {
    props.onDirectionChange?.({
      requestedChange: directionChange(),
      impact: directionImpact(),
      currentRoundAction: roundAction(),
      nextObjective: directionNextObjective(),
    });
  };

  const complete = () => {
    props.onComplete?.({
      summary: finalSummary(),
      acceptedByUser: acceptedByUser(),
      goalMatched: acceptedByUser(),
      remainingRisks: remainingRisks(),
      verificationEvidence: verificationEvidence(),
      artifacts: splitList(finalArtifacts()),
    });
  };

  return (
    <Show
      when={props.project}
      fallback={<p class="manager-orchestration-empty">{t("manager.orchestration.empty.flow")}</p>}
    >
      <div class="manager-command-flow">
        <CommandFlowStateMachine
          project={props.project}
          commandFlow={props.commandFlow}
          activeRound={activeRound()}
        />
        <Show when={wizardEvents().length > 0}>
          <div
            class="manager-wizard-events"
            aria-label={t("manager.orchestration.wizard-events.title")}
          >
            <strong>{t("manager.orchestration.wizard-events.title")}</strong>
            <div>
              <For each={wizardEvents().slice(0, 3)}>
                {(event) => (
                  <span class={`manager-wizard-event manager-wizard-event-${event.impact}`}>
                    {wizardIntentEventLabel(event)}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>
        <div class="manager-command-flow-grid">
          <form
            class="manager-flow-form manager-flow-charter"
            onSubmit={(event) => {
              event.preventDefault();
              saveCharter();
            }}
          >
            <h5>{t("manager.orchestration.flow.charter")}</h5>
            <textarea
              value={goal()}
              onInput={(event) => setGoal(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.goal")}
            />
            <textarea
              value={scope()}
              onInput={(event) => setScope(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.scope")}
            />
            <textarea
              value={constraints()}
              onInput={(event) => setConstraints(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.constraints")}
            />
            <textarea
              value={successCriteria()}
              onInput={(event) => setSuccessCriteria(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.success")}
            />
            <div class="manager-flow-collapsible">
              <textarea
                value={preferredApproach()}
                onInput={(event) => setPreferredApproach(event.currentTarget.value)}
                placeholder={t("manager.orchestration.flow.approach")}
              />
              <textarea
                value={verificationPlan()}
                onInput={(event) => setVerificationPlan(event.currentTarget.value)}
                placeholder={t("manager.orchestration.flow.verification")}
              />
              <textarea
                value={userCheckpoints()}
                onInput={(event) => setUserCheckpoints(event.currentTarget.value)}
                placeholder={t("manager.orchestration.flow.checkpoints")}
              />
              <textarea
                value={finalDeliverables()}
                onInput={(event) => setFinalDeliverables(event.currentTarget.value)}
                placeholder={t("manager.orchestration.flow.deliverables")}
              />
              <textarea
                value={nonGoals()}
                onInput={(event) => setNonGoals(event.currentTarget.value)}
                placeholder={t("manager.orchestration.flow.non-goals")}
              />
            </div>
            <div class="manager-flow-actions">
              <button type="submit" disabled={disabled() || !props.onUpdateCharter}>
                {t("manager.orchestration.action.save-charter")}
              </button>
              <button
                type="button"
                disabled={disabled() || !props.onPrepare}
                onClick={() => props.onPrepare?.()}
              >
                {t("manager.orchestration.action.prepare")}
              </button>
            </div>
          </form>
          <div class="manager-flow-form">
            <h5>{t("manager.orchestration.flow.start")}</h5>
            <select
              value={phase()}
              onChange={(event) =>
                setPhase(
                  event.currentTarget.value as NonNullable<ManagerProjectStartRequest["phase"]>,
                )
              }
            >
              <option value="design">{t("manager.orchestration.flow.phase.design")}</option>
              <option value="implementation">
                {t("manager.orchestration.flow.phase.implementation")}
              </option>
              <option value="feedback">{t("manager.orchestration.flow.phase.feedback")}</option>
              <option value="verification">
                {t("manager.orchestration.flow.phase.verification")}
              </option>
              <option value="replan">{t("manager.orchestration.flow.phase.replan")}</option>
            </select>
            <textarea
              value={startObjective()}
              onInput={(event) => setStartObjective(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.objective")}
            />
            <label class="manager-flow-check">
              <input
                type="checkbox"
                checked={dryRun()}
                onChange={(event) => setDryRun(event.currentTarget.checked)}
              />
              <span>{t("manager.orchestration.flow.dry-run")}</span>
            </label>
            <Show when={readiness()?.warnings.length}>
              <ul class="manager-protocol-warnings">
                <For each={readiness()?.warnings ?? []}>
                  {(warning) => <li>{managerCommandFlowWarningLabel(warning)}</li>}
                </For>
              </ul>
            </Show>
            <button
              type="button"
              disabled={disabled() || !startObjective().trim() || !props.onStart}
              onClick={start}
            >
              {managerStartButtonLabel(dryRun())}
            </button>
          </div>
          <div class="manager-flow-form">
            <h5>{t("manager.orchestration.flow.review")}</h5>
            <select
              value={reviewAction()}
              onChange={(event) =>
                setReviewAction(event.currentTarget.value as ManagerRoundReviewRequest["action"])
              }
            >
              <option value="accept">{t("manager.orchestration.flow.review.accept")}</option>
              <option value="request_changes">
                {t("manager.orchestration.flow.review.request-changes")}
              </option>
              <option value="user_check_required">
                {t("manager.orchestration.flow.review.user-check")}
              </option>
              <option value="replan">{t("manager.orchestration.flow.review.replan")}</option>
              <option value="stop">{t("manager.orchestration.flow.review.stop")}</option>
            </select>
            <textarea
              value={reviewSummary()}
              onInput={(event) => setReviewSummary(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.review-summary")}
            />
            <textarea
              value={reviewNextObjective()}
              onInput={(event) => setReviewNextObjective(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.next-objective")}
            />
            <button
              type="button"
              disabled={disabled() || !activeRound() || !props.onReview}
              onClick={review}
            >
              {managerRoundReviewActionButtonLabel(reviewAction())}
            </button>
          </div>
          <div class="manager-flow-form">
            <h5>{t("manager.orchestration.flow.direction")}</h5>
            <select
              value={roundAction()}
              onChange={(event) =>
                setRoundAction(
                  event.currentTarget.value as NonNullable<
                    ManagerDirectionChangeRequest["currentRoundAction"]
                  >,
                )
              }
            >
              <option value="keep">{t("manager.orchestration.flow.direction.keep")}</option>
              <option value="cancel">{t("manager.orchestration.flow.direction.cancel")}</option>
              <option value="supersede">
                {t("manager.orchestration.flow.direction.supersede")}
              </option>
            </select>
            <textarea
              value={directionChange()}
              onInput={(event) => setDirectionChange(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.direction-change")}
            />
            <textarea
              value={directionImpact()}
              onInput={(event) => setDirectionImpact(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.direction-impact")}
            />
            <textarea
              value={directionNextObjective()}
              onInput={(event) => setDirectionNextObjective(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.next-objective")}
            />
            <button
              type="button"
              disabled={disabled() || !directionChange().trim() || !props.onDirectionChange}
              onClick={changeDirection}
            >
              {t("manager.orchestration.action.record-direction")}
            </button>
          </div>
          <div class="manager-flow-form">
            <h5>{t("manager.orchestration.flow.complete")}</h5>
            <textarea
              value={finalSummary()}
              onInput={(event) => setFinalSummary(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.final-summary")}
            />
            <textarea
              value={verificationEvidence()}
              onInput={(event) => setVerificationEvidence(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.verification-evidence")}
            />
            <textarea
              value={remainingRisks()}
              onInput={(event) => setRemainingRisks(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.remaining-risks")}
            />
            <textarea
              value={finalArtifacts()}
              onInput={(event) => setFinalArtifacts(event.currentTarget.value)}
              placeholder={t("manager.orchestration.flow.final-artifacts")}
            />
            <label class="manager-flow-check">
              <input
                type="checkbox"
                checked={acceptedByUser()}
                onChange={(event) => setAcceptedByUser(event.currentTarget.checked)}
              />
              <span>{t("manager.orchestration.flow.accepted")}</span>
            </label>
            <button
              type="button"
              disabled={disabled() || !finalSummary().trim() || !props.onComplete}
              onClick={() => {
                if (
                  confirmManagerAction("manager.orchestration.confirm.complete-project", {
                    name: props.project?.name ?? "",
                  })
                ) {
                  complete();
                }
              }}
            >
              {t("manager.orchestration.action.complete-project")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

const OverviewView: Component<{
  round: ManagerRound | undefined;
  overview: ManagerProjectOverviewResponse | null;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  blockers: ManagerBlocker[];
  hiddenAgentCount: number;
}> = (props) => {
  const totals = createMemo(() => summarizeTotals(props.agents));
  const artifacts = createMemo(() => buildArtifacts(props.agents, props.tasks));
  const counts = createMemo(() => props.overview?.counts);
  const lastUpdatedAt = createMemo(() => {
    if (props.overview?.lastUpdateAt) return props.overview.lastUpdateAt;
    const values = [
      props.round?.updatedAt,
      ...props.agents.map((agent) => agent.updatedAt),
      ...props.tasks.map((task) => task.updatedAt),
    ].filter(Boolean) as string[];
    return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  });
  const blocker = createMemo(
    () =>
      props.agents.find((agent) => agent.status === "blocked" || agent.status === "failed") ?? null,
  );
  const activeBlocker = createMemo(() => pickPrimaryBlocker(props.blockers));
  const nextAction = createMemo(() => {
    if (isManagerProjectCompleted(props.overview?.project)) {
      return t("manager.orchestration.current-judgment.completed");
    }
    const projectBlocker = activeBlocker();
    if (projectBlocker) {
      if (managerBlockerIsToolchainSetupCandidate(projectBlocker)) {
        return t("manager.orchestration.next-action.toolchain", {
          title: projectBlocker.title,
        });
      }
      if (projectBlocker.requiredAction === "user")
        return t("manager.orchestration.next-action.user", { title: projectBlocker.title });
      if (projectBlocker.requiredAction === "worker")
        return t("manager.orchestration.next-action.assign-worker", {
          title: projectBlocker.title,
        });
      if (projectBlocker.requiredAction === "manager")
        return t("manager.orchestration.next-action.manager", { title: projectBlocker.title });
      return t("manager.orchestration.next-action.track", { title: projectBlocker.title });
    }
    if (props.overview?.nextAction)
      return managerProjectOverviewActionLabel(props.overview.nextAction);
    const blocked = blocker();
    if (blocked) {
      return blocked.taskId
        ? t("manager.orchestration.next-action.inspect-task", {
            role: blocked.role,
            taskId: shortId(blocked.taskId),
          })
        : t("manager.orchestration.next-action.inspect-role", { role: blocked.role });
    }
    if (totals().running > 0) {
      return t("manager.orchestration.next-action.watch");
    }
    if (props.tasks.some((task) => ["blocked", "failed"].includes(task.state))) {
      return t("manager.orchestration.next-action.review-failed");
    }
    if (props.tasks.length > 0 || totals().completed > 0) {
      return t("manager.orchestration.next-action.review-artifacts");
    }
    return t("manager.orchestration.next-action.dispatch");
  });
  return (
    <div class="manager-command-board">
      <div class="manager-command-hero">
        <div class="manager-command-kicker">
          <span
            class={`manager-status-dot manager-status-dot-${overviewTone(props.overview?.currentSignal.tone) ?? statusTone(props.round?.status)}`}
          />
          <span>
            {props.overview?.currentSignal.title ??
              (props.round
                ? statusLabel(props.round.status)
                : t("manager.orchestration.overview.no-round"))}
          </span>
          <Show when={lastUpdatedAt()}>
            {(updatedAt) => (
              <time>
                {t("manager.orchestration.overview.last-update", {
                  time: formatTime(updatedAt()),
                })}
              </time>
            )}
          </Show>
        </div>
        <h3>
          {props.overview?.activeRound?.title ??
            props.round?.title ??
            t("manager.orchestration.title")}
        </h3>
        <p>
          {props.overview?.currentSignal.detail ||
            props.round?.objective ||
            t("manager.orchestration.overview.no-round-objective")}
        </p>
      </div>
      <div class="manager-command-metrics" aria-label={t("manager.orchestration.aria.metrics")}>
        <div class="manager-command-metric">
          <span>{t("manager.orchestration.field.agents")}</span>
          <strong>{counts()?.agents ?? totals().total}</strong>
        </div>
        <div class="manager-command-metric">
          <span>{t("manager.orchestration.field.done")}</span>
          <strong>{counts()?.completedAgents ?? totals().completed}</strong>
        </div>
        <div class="manager-command-metric">
          <span>{t("manager.orchestration.field.blocked")}</span>
          <strong>{props.blockers.length || counts()?.blockedAgents || totals().blocked}</strong>
        </div>
        <div class="manager-command-metric">
          <span>{t("manager.orchestration.field.artifacts")}</span>
          <strong>{counts()?.artifacts ?? artifacts().length}</strong>
        </div>
      </div>
      <div class="manager-command-decision">
        <div>
          <span class="manager-overview-label">
            {t("manager.orchestration.overview.current-signal")}
          </span>
          <p>
            {props.overview?.currentSignal.detail ||
              (activeBlocker()
                ? `${statusLabel(activeBlocker()?.severity)}: ${activeBlocker()?.title}`
                : blocker()
                  ? `${blocker()?.role} agent needs attention: ${
                      blocker()?.lastError || statusLabel(blocker()?.status)
                    }`
                  : [
                      props.tasks.length > 0
                        ? t("manager.orchestration.overview.task-records", {
                            count: props.tasks.length,
                          })
                        : t("manager.orchestration.overview.no-blocker"),
                      props.hiddenAgentCount > 0
                        ? t("manager.orchestration.overview.quiet-agents", {
                            count: props.hiddenAgentCount,
                          })
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" "))}
          </p>
        </div>
        <div>
          <span class="manager-overview-label">
            {t("manager.orchestration.overview.next-action")}
          </span>
          <p>{nextAction()}</p>
        </div>
      </div>
    </div>
  );
};

const CurrentStateView: Component<{
  state: ManagerStateViewResponse | null | undefined;
  project: ManagerProject | null | undefined;
  activeRound: ManagerRound | undefined;
  agents: ManagerAgent[];
  busy: boolean | undefined;
  onAcknowledge: (() => void) | undefined;
  onCancelTask: ((taskId: string) => void) | undefined;
  onInspectTask: ((taskId: string) => void) | undefined;
  onRepairRegistration: (() => void) | undefined;
  onRefresh: (() => void) | undefined;
  onRetryTask: ((taskId: string) => void) | undefined;
  onRunUpdateAll: (() => void) | undefined;
}> = (props) => {
  const scope = createMemo(() =>
    projectManagerStateScope(props.project, props.activeRound, props.agents),
  );
  const current = createMemo(() => {
    const item = props.state?.current ?? null;
    if (!item) return null;
    const projectScope = scope();
    if (!projectScope) return item;
    return managerStateSignalMatchesProject(item, projectScope) ? item : null;
  });
  const blockers = createMemo(() => {
    const items = props.state?.blockers ?? [];
    const projectScope = scope();
    if (!projectScope) return items;
    return items.filter((item) => managerStateSignalMatchesProject(item, projectScope));
  });
  const recoveryActions = createMemo(() => props.state?.recoveryActions ?? []);
  const taskId = createMemo(() => current()?.taskId);
  const runRecoveryAction = (id: ManagerStateViewResponse["recoveryActions"][number]["id"]) => {
    if (id === "update-all") props.onRunUpdateAll?.();
    if (id === "repair-registration") props.onRepairRegistration?.();
  };
  const canRunRecoveryAction = (
    action: ManagerStateViewResponse["recoveryActions"][number],
  ): boolean => {
    if (!action.enabled) return false;
    if (action.id === "update-all") return Boolean(props.onRunUpdateAll);
    if (action.id === "repair-registration") return Boolean(props.onRepairRegistration);
    return false;
  };
  return (
    <div class="manager-current-state">
      <Show
        when={current()}
        fallback={
          <p class="manager-orchestration-empty">
            {scope()
              ? t("manager.orchestration.empty.project-manager-state")
              : t("manager.orchestration.empty.manager-state")}
          </p>
        }
      >
        {(item) => (
          <>
            <div class="manager-current-state-head">
              <span
                class={`manager-status-dot manager-status-dot-${currentStateTone(item().tone)}`}
              />
              <strong>{item().title}</strong>
              <span class="manager-status-pill">{statusLabel(item().status)}</span>
            </div>
            <dl class="manager-current-state-grid">
              <div>
                <dt>{t("manager.orchestration.field.kind")}</dt>
                <dd>{item().kind}</dd>
              </div>
              <div>
                <dt>{t("manager.orchestration.field.source")}</dt>
                <dd>{item().source}</dd>
              </div>
              <Show when={item().updatedAt}>
                {(updatedAt) => (
                  <div>
                    <dt>{t("manager.orchestration.field.updated")}</dt>
                    <dd>{formatTime(updatedAt())}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.state?.freshness}>
                {(freshness) => (
                  <div>
                    <dt>{t("manager.orchestration.field.signal")}</dt>
                    <dd>
                      {freshness().stale ? statusLabel("stale") : formatFreshness(props.state)}
                    </dd>
                  </div>
                )}
              </Show>
            </dl>
            <Show when={item().detail}>
              {(detail) => <p class="manager-current-state-detail">{detail()}</p>}
            </Show>
            <div class="manager-current-state-ids">
              <Show when={item().roundId}>
                {(id) => (
                  <span>{t("manager.orchestration.word.round", { id: shortId(id()) })}</span>
                )}
              </Show>
              <Show when={item().agentId}>
                {(id) => (
                  <span>
                    {t("manager.orchestration.word.agent")} {shortId(id())}
                  </span>
                )}
              </Show>
              <Show when={item().taskId}>
                {(id) => <span>{t("manager.orchestration.word.task", { id: shortId(id()) })}</span>}
              </Show>
            </div>
            <div class="manager-current-state-actions">
              <Show when={item().actions.includes("refresh") && props.onRefresh}>
                <button type="button" disabled={props.busy} onClick={() => props.onRefresh?.()}>
                  {t("manager.orchestration.action.refresh")}
                </button>
              </Show>
              <Show
                when={Boolean(item().actions.includes("retry") && taskId() && props.onRetryTask)}
              >
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => {
                    const id = taskId();
                    if (id) props.onRetryTask?.(id);
                  }}
                >
                  {t("manager.orchestration.action.retry")}
                </button>
              </Show>
              <Show when={Boolean(taskId() && props.onInspectTask)}>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => {
                    const id = taskId();
                    if (id) props.onInspectTask?.(id);
                  }}
                >
                  {t("manager.orchestration.action.inspect")}
                </button>
              </Show>
              <Show
                when={Boolean(item().actions.includes("cancel") && taskId() && props.onCancelTask)}
              >
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => {
                    const id = taskId();
                    if (id) props.onCancelTask?.(id);
                  }}
                >
                  {t("manager.orchestration.action.cancel")}
                </button>
              </Show>
              <Show when={item().actions.includes("acknowledge") && props.onAcknowledge}>
                <button type="button" disabled={props.busy} onClick={() => props.onAcknowledge?.()}>
                  {t("manager.orchestration.action.acknowledge")}
                </button>
              </Show>
              <For each={recoveryActions()}>
                {(action) => (
                  <button
                    type="button"
                    disabled={props.busy || !canRunRecoveryAction(action)}
                    title={action.reason}
                    onClick={() => runRecoveryAction(action.id)}
                  >
                    {action.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={recoveryActions().length > 0}>
              <ul class="manager-current-recovery">
                <For each={recoveryActions()}>
                  {(action) => (
                    <li>
                      <strong>{action.label}</strong>
                      <small>{action.reason}</small>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
      <Show when={blockers().length > 0}>
        <ul class="manager-current-blockers">
          <For each={blockers().slice(0, 5)}>
            {(blocker) => (
              <li>
                <span>{statusLabel(blocker.severity)}</span>
                <strong>{blocker.message}</strong>
                <Show when={blocker.detail}>{(detail) => <small>{detail()}</small>}</Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

const RoundHealthGateView: Component<{
  health?: ManagerRoundHealthGate | null | undefined;
  busy?: boolean | undefined;
  onAcknowledgeRound?: ((roundId: string) => void) | undefined;
  onInspectTask?: ((taskId: string) => void) | undefined;
  onRepairRound?: ((roundId: string) => void) | undefined;
  onRetryTask?: ((taskId: string) => void) | undefined;
}> = (props) => {
  const issues = createMemo(() => props.health?.issues ?? []);
  return (
    <div class="manager-round-health" aria-label={t("manager.orchestration.section.health")}>
      <Show
        when={props.health}
        fallback={
          <p class="manager-orchestration-empty">{t("manager.orchestration.empty.health")}</p>
        }
      >
        {(health) => (
          <>
            <div class="manager-round-health-head">
              <span
                class={`manager-status-dot manager-status-dot-${roundHealthTone(health().status)}`}
              />
              <strong>{statusLabel(health().status)}</strong>
              <span>{health().summary}</span>
            </div>
            <dl class="manager-round-health-grid">
              <div>
                <dt>{t("manager.orchestration.field.expected")}</dt>
                <dd>
                  {t("manager.orchestration.health.expected", {
                    agents: health().expectedAgents,
                    tasks: health().expectedTasks,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("manager.orchestration.field.runs")}</dt>
                <dd>
                  {t("manager.orchestration.health.runs", {
                    completed: health().completedRuns,
                    actual: health().actualRuns,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("manager.orchestration.field.active")}</dt>
                <dd>
                  {t("manager.orchestration.health.active", {
                    running: health().runningRuns,
                    blocked: health().blockedRuns,
                  })}
                </dd>
              </div>
              <div>
                <dt>{t("manager.orchestration.field.missing")}</dt>
                <dd>{health().missingRuns}</dd>
              </div>
            </dl>
            <Show when={issues().length > 0}>
              <ul class="manager-round-health-issues">
                <For each={issues().slice(0, 6)}>
                  {(issue) => (
                    <li>
                      <span>{statusLabel(issue.severity)}</span>
                      <strong>{issue.message}</strong>
                      <Show when={issue.detail}>
                        {(detail) => <small>{clip(detail(), 160)}</small>}
                      </Show>
                      <HealthIssueAction
                        issue={issue}
                        roundId={health().roundId}
                        busy={props.busy}
                        onAcknowledgeRound={props.onAcknowledgeRound}
                        onInspectTask={props.onInspectTask}
                        onRepairRound={props.onRepairRound}
                        onRetryTask={props.onRetryTask}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};
const HealthIssueAction: Component<{
  issue: ManagerRoundHealthGate["issues"][number];
  roundId: string;
  busy?: boolean | undefined;
  onAcknowledgeRound?: ((roundId: string) => void) | undefined;
  onInspectTask?: ((taskId: string) => void) | undefined;
  onRepairRound?: ((roundId: string) => void) | undefined;
  onRetryTask?: ((taskId: string) => void) | undefined;
}> = (props) => {
  const label = createMemo(() => healthIssueActionLabel(props.issue));
  const disabled = createMemo(() => {
    if (props.busy) return true;
    if (props.issue.action === "retry-worker") return !props.issue.taskId || !props.onRetryTask;
    if (props.issue.action === "inspect-worker") return !props.issue.taskId || !props.onInspectTask;
    if (props.issue.action === "repair-round") return !props.onRepairRound;
    if (props.issue.action === "acknowledge") return !props.onAcknowledgeRound;
    return true;
  });
  const run = () => {
    if (disabled()) return;
    if (props.issue.action === "retry-worker" && props.issue.taskId) {
      props.onRetryTask?.(props.issue.taskId);
    } else if (props.issue.action === "inspect-worker" && props.issue.taskId) {
      props.onInspectTask?.(props.issue.taskId);
    } else if (props.issue.action === "repair-round") {
      props.onRepairRound?.(props.roundId);
    } else if (props.issue.action === "acknowledge") {
      props.onAcknowledgeRound?.(props.roundId);
    }
  };
  return (
    <Show when={label()}>
      {(text) => (
        <button type="button" disabled={disabled()} onClick={run}>
          {text()}
        </button>
      )}
    </Show>
  );
};

const TaskObservationView: Component<{
  observation: ManagerTaskObservationResponse;
  busy?: boolean | undefined;
}> = (props) => {
  const steps = createMemo(() => props.observation.log.steps.slice(-6));
  const resultPreview = createMemo(() => taskResultPreview(props.observation.log.result));
  return (
    <div
      class="manager-task-observation"
      aria-label={t("manager.orchestration.aria.task-observation")}
    >
      <div class="manager-task-observation-head">
        <span
          class={`manager-status-dot manager-status-dot-${statusTone(props.observation.task.state)}`}
        />
        <strong>{props.observation.summary}</strong>
        <span>
          {props.observation.terminal
            ? t("manager.orchestration.task.terminal")
            : t("manager.orchestration.task.active")}
        </span>
        <Show when={props.busy}>
          <span>{t("manager.orchestration.task.loading")}</span>
        </Show>
      </div>
      <dl class="manager-task-observation-grid">
        <div>
          <dt>{t("manager.orchestration.field.task")}</dt>
          <dd>{shortId(props.observation.task.id)}</dd>
        </div>
        <div>
          <dt>{t("manager.orchestration.field.kind")}</dt>
          <dd>{props.observation.task.kind}</dd>
        </div>
        <div>
          <dt>{t("manager.orchestration.field.state")}</dt>
          <dd>{statusLabel(props.observation.task.state)}</dd>
        </div>
        <div>
          <dt>{t("manager.orchestration.field.next")}</dt>
          <dd>{props.observation.nextRead}</dd>
        </div>
      </dl>
      <Show when={props.observation.task.error}>
        {(error) => <p class="manager-task-observation-error">{error()}</p>}
      </Show>
      <Show when={steps().length > 0}>
        <ol class="manager-task-observation-steps">
          <For each={steps()}>
            {(step) => (
              <li>
                <span>{statusLabel(step.status)}</span>
                <strong>{step.label}</strong>
                <Show when={step.summary}>{(summary) => <small>{summary()}</small>}</Show>
              </li>
            )}
          </For>
        </ol>
      </Show>
      <Show when={resultPreview()}>
        {(preview) => (
          <pre
            aria-label={t("manager.orchestration.task.result-preview")}
            class="manager-task-observation-result"
          >
            {preview()}
          </pre>
        )}
      </Show>
      <Show when={props.observation.log.lines.length > 0}>
        <pre>{props.observation.log.lines.slice(-8).join("\n")}</pre>
      </Show>
    </div>
  );
};
const WorkerRunsView: Component<{
  runs: ManagerWorkerRun[];
  evidence: ManagerEvidenceItem[];
  busy?: boolean | undefined;
  onInspectTask?: ((taskId: string) => void) | undefined;
}> = (props) => (
  <div class="manager-worker-runs" aria-label={t("manager.orchestration.aria.worker-runs")}>
    <EvidenceLedgerView evidence={props.evidence} />
    <div class="manager-worker-run-row manager-worker-run-row-head">
      <span>{t("manager.orchestration.field.worker")}</span>
      <span>{t("manager.orchestration.field.status")}</span>
      <span>{t("manager.orchestration.field.session")}</span>
      <span>{t("manager.orchestration.field.result")}</span>
      <span>{t("manager.orchestration.field.signal")}</span>
    </div>
    <For each={props.runs.slice(0, 12)}>
      {(run) => (
        <div
          class="manager-worker-run-row"
          classList={{
            "manager-worker-run-row-problem":
              run.integrity.some((item) => item !== "ok") ||
              ["failed", "blocked", "missing"].includes(run.status),
          }}
        >
          <span class="manager-worker-run-main">
            <strong>
              {run.agentRole ??
                run.agentLabel ??
                run.profile ??
                t("manager.orchestration.word.worker")}
            </strong>
            <small title={run.cwd ?? ""}>
              {clip(run.cwd ?? run.profile ?? run.taskId ?? "", 42)}
            </small>
          </span>
          <span class={`manager-agent-status manager-agent-status-${statusTone(run.status)}`}>
            {statusLabel(run.status)}
          </span>
          <span title={run.sessionId ?? run.taskId ?? ""}>
            {run.sessionId
              ? shortId(run.sessionId)
              : run.taskId
                ? t("manager.orchestration.word.task", { id: shortId(run.taskId) })
                : "-"}
          </span>
          <span title={workerRunResultTitle(run)}>{workerRunResultLabel(run)}</span>
          <span
            class="manager-worker-run-signal"
            title={run.error || run.outputPreview || run.integrity.join(", ")}
          >
            {workerRunSignal(run)}
            <Show when={run.taskId && Boolean(props.onInspectTask)}>
              <button
                type="button"
                disabled={props.busy}
                onClick={() => {
                  if (run.taskId) props.onInspectTask?.(run.taskId);
                }}
              >
                {t("manager.orchestration.action.inspect")}
              </button>
            </Show>
          </span>
        </div>
      )}
    </For>
    <Show when={props.runs.length > 12}>
      <p class="manager-orchestration-empty">
        {t("manager.orchestration.worker.older-hidden", { count: props.runs.length - 12 })}
      </p>
    </Show>
    <Show when={props.runs.length === 0}>
      <p class="manager-orchestration-empty">{t("manager.orchestration.empty.worker-runs")}</p>
    </Show>
  </div>
);

const EvidenceLedgerView: Component<{ evidence: ManagerEvidenceItem[] }> = (props) => {
  const visible = createMemo(() => props.evidence.slice(0, 8));
  const counts = createMemo(() => evidenceCounts(props.evidence));
  return (
    <Show when={props.evidence.length > 0}>
      <div class="manager-evidence-ledger" aria-label={t("manager.orchestration.evidence.title")}>
        <div class="manager-evidence-ledger-head">
          <strong>{t("manager.orchestration.evidence.title")}</strong>
          <span>
            {t("manager.orchestration.evidence.summary", {
              valid: counts().valid,
              failed: counts().failed,
              missing: counts().missing,
              stale: counts().stale,
            })}
          </span>
        </div>
        <div class="manager-evidence-list">
          <For each={visible()}>
            {(item) => (
              <div class={`manager-evidence-item manager-evidence-item-${item.status}`}>
                <span>{evidenceTypeLabel(item.type)}</span>
                <strong title={item.detail}>{clip(item.label, 64)}</strong>
                <small title={item.excerpt ?? item.detail}>
                  {clip(item.excerpt ?? item.detail, 110)}
                </small>
                <em>{evidenceStatusLabel(item.status)}</em>
              </div>
            )}
          </For>
        </div>
        <Show when={props.evidence.length > visible().length}>
          <p class="manager-orchestration-empty">
            {t("manager.orchestration.evidence.older-hidden", {
              count: props.evidence.length - visible().length,
            })}
          </p>
        </Show>
      </div>
    </Show>
  );
};

const ManagerAssistantLedgerView: Component<{
  project: ManagerProject | null | undefined;
  overview: ManagerProjectOverviewResponse | null | undefined;
  commandFlow: ManagerCommandFlowResponse | null | undefined;
  reports: ManagerAssistantStatusReport[];
  workerRuns: ManagerWorkerRun[];
}> = (props) => {
  const projectCompleted = createMemo(() => isManagerProjectCompleted(props.project));
  const scopedReports = createMemo(() => {
    if (!props.project) return props.reports;
    const currentRoundId =
      props.commandFlow?.activeRound?.id ??
      props.overview?.activeRound?.id ??
      props.project.activeRoundId ??
      null;
    return props.reports.filter((report) =>
      assistantStatusReportMatchesProjectScope(report, props.project?.id ?? null, currentRoundId),
    );
  });
  const latestReport = createMemo(() => scopedReports()[0]);
  const recentReports = createMemo(() => scopedReports().slice(0, 4));
  const nextActionLabel = createMemo(() =>
    projectCompleted()
      ? t("manager.orchestration.current-judgment.completed")
      : (props.commandFlow?.nextAction.label ?? props.overview?.nextAction.label),
  );
  const projectId = createMemo(
    () => props.project?.id ?? projectIdFromAssistantReport(latestReport()) ?? null,
  );
  const roundId = createMemo(
    () =>
      props.overview?.activeRound?.id ??
      props.project?.activeRoundId ??
      roundIdFromAssistantReport(latestReport()) ??
      null,
  );
  const completedRuns = createMemo(
    () =>
      props.workerRuns.filter((run) => ["succeeded", "completed"].includes(String(run.status)))
        .length,
  );
  const failedRuns = createMemo(
    () =>
      props.workerRuns.filter((run) =>
        ["failed", "blocked", "cancelled", "missing"].includes(String(run.status)),
      ).length,
  );
  const shouldRender = createMemo(() =>
    Boolean(props.project || latestReport() || props.overview || props.commandFlow),
  );

  return (
    <Show when={shouldRender()}>
      <section class="manager-assistant-ledger" aria-label="관리 Assistant 실행 기록">
        <div class="manager-assistant-ledger-head">
          <strong>실행 기록</strong>
          <Show when={latestReport()}>
            {(report) => <span>{formatAssistantLedgerTime(report().createdAt)}</span>}
          </Show>
        </div>
        <div class="manager-assistant-result-card">
          <div class="manager-assistant-result-title">
            <strong>{props.project?.name ?? latestReport()?.message ?? "최근 실행 결과"}</strong>
            <span>{nextActionLabel()}</span>
          </div>
          <dl class="manager-assistant-result-grid">
            <Show when={projectId()}>
              {(id) => (
                <>
                  <dt>프로젝트</dt>
                  <dd>{id()}</dd>
                </>
              )}
            </Show>
            <Show when={roundId()}>
              {(id) => (
                <>
                  <dt>라운드</dt>
                  <dd>{id()}</dd>
                </>
              )}
            </Show>
            <dt>단계</dt>
            <dd>{props.project?.flowStage ?? props.commandFlow?.readiness.stage ?? "-"}</dd>
            <dt>준비</dt>
            <dd>{props.commandFlow?.readiness.ready ? "ready" : "check"}</dd>
            <dt>작업자</dt>
            <dd>
              {props.workerRuns.length > 0
                ? `${completedRuns()}/${props.workerRuns.length} 완료${
                    failedRuns() ? `, 실패 ${failedRuns()}` : ""
                  }`
                : "-"}
            </dd>
          </dl>
          <Show when={latestReport()?.detail}>{(detail) => <p>{detail()}</p>}</Show>
        </div>
        <Show when={recentReports().length > 0}>
          <ol class="manager-assistant-report-list">
            <For each={recentReports()}>
              {(report) => (
                <li class={`manager-assistant-report manager-assistant-report-${report.level}`}>
                  <span>{report.phase}</span>
                  <strong>{report.message}</strong>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </section>
    </Show>
  );
};

const AgentsView: Component<{
  agents: ManagerAgent[];
  workerRuns: ManagerWorkerRun[];
  agentResults: ManagerAgentResult[];
  evidence: ManagerEvidenceItem[];
  busy?: boolean | undefined;
  onInspectTask?: ((taskId: string) => void) | undefined;
  advanced?: boolean | undefined;
}> = (props) => {
  const briefs = createMemo(() =>
    buildAgentRoleBriefs(props.agents, props.workerRuns, props.agentResults, props.evidence),
  );
  const showRawAgents = createMemo(() => Boolean(props.advanced) || briefs().length === 0);
  return (
    <div class="manager-agent-table" aria-label={t("manager.orchestration.tab.agents")}>
      <Show when={briefs().length > 0}>
        <div class="manager-agent-role-briefs" aria-label={t("manager.orchestration.agent.briefs")}>
          <For each={briefs()}>
            {(brief) => (
              <details class={`manager-agent-brief manager-agent-brief-${brief.tone}`}>
                <summary class="manager-agent-brief-summary">
                  <span class="manager-agent-brief-role">
                    <strong>{brief.label}</strong>
                  </span>
                  <span class={`manager-agent-status manager-agent-status-${brief.tone}`}>
                    {statusLabel(brief.status)}
                  </span>
                </summary>
                <div class="manager-agent-brief-body">
                  <div class="manager-agent-brief-verdict">
                    <span>{agentResultVerdictLabel(brief.verdict)}</span>
                    <span>
                      {t("manager.orchestration.agent.evidence-count", {
                        count: brief.evidenceCount,
                      })}
                    </span>
                    <span>{agentResultConfidenceLabel(brief.confidence)}</span>
                  </div>
                  <dl>
                    <AgentDetailField
                      label={t("manager.orchestration.field.role")}
                      value={[brief.role, brief.profile].filter(Boolean).join("\n")}
                    />
                    <AgentDetailField
                      label={t("manager.orchestration.agent.assignment")}
                      value={brief.assignment}
                    />
                    <AgentDetailField
                      label={t("manager.orchestration.agent.output")}
                      value={brief.output}
                    />
                    <Show when={brief.findings.length > 0}>
                      <AgentDetailField
                        label={t("manager.orchestration.agent.findings")}
                        value={brief.findings.map((finding) => `- ${finding}`).join("\n")}
                      />
                    </Show>
                    <Show when={brief.risks.length > 0}>
                      <AgentDetailField
                        label={t("manager.orchestration.agent.risks")}
                        value={brief.risks.map((risk) => `- ${risk}`).join("\n")}
                      />
                    </Show>
                    <AgentDetailField
                      label={t("manager.orchestration.field.evidence")}
                      value={brief.evidence}
                    />
                    <AgentDetailField
                      label={t("manager.orchestration.field.next")}
                      value={brief.next}
                    />
                  </dl>
                </div>
                <Show when={props.advanced}>
                  <footer class="manager-agent-detail-footer">
                    <span>{brief.meta}</span>
                    <Show when={brief.taskId && props.onInspectTask ? brief.taskId : null}>
                      {(taskId) => (
                        <button
                          type="button"
                          disabled={props.busy}
                          onClick={() => props.onInspectTask?.(taskId())}
                        >
                          {t("manager.orchestration.action.inspect")}
                        </button>
                      )}
                    </Show>
                  </footer>
                </Show>
              </details>
            )}
          </For>
        </div>
      </Show>
      <Show when={showRawAgents()}>
        <div class="manager-agent-row manager-agent-row-head">
          <span>{t("manager.orchestration.field.name")}</span>
          <span>{t("manager.orchestration.field.status")}</span>
        </div>
        <For each={props.agents}>
          {(agent) => (
            <details class={`manager-agent-row manager-agent-row-${statusTone(agent.status)}`}>
              <summary class="manager-agent-row-summary">
                <span class="manager-agent-role" title={`${agent.label} - ${agent.profile}`}>
                  {agent.label || agent.role}
                </span>
                <span
                  class={`manager-agent-status manager-agent-status-${statusTone(agent.status)}`}
                >
                  {statusLabel(agent.status)}
                </span>
              </summary>
              <dl class="manager-agent-row-details">
                <AgentDetailField
                  label={t("manager.orchestration.field.role")}
                  value={agent.role}
                />
                <AgentDetailField
                  label={t("manager.orchestration.field.profile")}
                  value={agent.profile}
                />
                <AgentDetailField
                  label={t("manager.orchestration.field.task")}
                  value={
                    agent.taskId
                      ? t("manager.orchestration.word.task", { id: shortId(agent.taskId) })
                      : undefined
                  }
                />
                <AgentDetailField
                  label={t("manager.orchestration.field.instruction")}
                  value={agent.lastInstruction}
                />
                <AgentDetailField
                  label={t("manager.orchestration.agent.output")}
                  value={agent.lastOutput}
                />
                <AgentDetailField
                  label={t("manager.orchestration.field.error")}
                  value={agent.lastError}
                />
                <AgentDetailField
                  label={t("manager.orchestration.field.session")}
                  value={agent.sessionId}
                />
                <AgentDetailField label="CWD" value={agent.cwd} />
                <AgentDetailField
                  label={t("manager.orchestration.field.updated")}
                  value={formatTime(agent.lastOutputAt ?? agent.updatedAt)}
                />
              </dl>
              <Show when={agent.taskId}>
                {(taskId) => (
                  <div class="manager-agent-action manager-agent-detail-action">
                    <button
                      type="button"
                      disabled={props.busy || !props.onInspectTask}
                      onClick={() => props.onInspectTask?.(taskId())}
                    >
                      {t("manager.orchestration.action.inspect")}
                    </button>
                  </div>
                )}
              </Show>
            </details>
          )}
        </For>
      </Show>
      <Show when={props.agents.length === 0}>
        <p class="manager-orchestration-empty">{t("manager.orchestration.empty.agents")}</p>
      </Show>
    </div>
  );
};

const AgentDetailField: Component<{ label: string; value?: string | null | undefined }> = (
  props,
) => (
  <Show when={props.value?.trim()}>
    {(value) => (
      <div>
        <dt>{props.label}</dt>
        <dd>
          <AgentReadableContent value={value()} />
        </dd>
      </div>
    )}
  </Show>
);

const AgentReadableContent: Component<{ value: string }> = (props) => {
  const parsedJson = createMemo(() => parseReadableJson(props.value));
  return (
    <Show
      when={parsedJson()}
      fallback={
        <div
          class="manager-agent-readable manager-agent-markdown"
          innerHTML={renderMarkdown(props.value)}
        />
      }
    >
      {(json) => (
        <div class="manager-agent-readable manager-agent-json-render">
          <JsonReadableValue value={json().value} />
        </div>
      )}
    </Show>
  );
};

const JsonReadableValue: Component<{ value: unknown }> = (props) => {
  const value = () => props.value;
  return (
    <Show
      when={Array.isArray(value())}
      fallback={
        <Show
          when={value() && typeof value() === "object"}
          fallback={<span class="manager-agent-json-scalar">{formatJsonScalar(value())}</span>}
        >
          <dl class="manager-agent-json-object">
            <For each={Object.entries(value() as Record<string, unknown>)}>
              {([key, child]) => (
                <div>
                  <dt>{humanizeJsonKey(key)}</dt>
                  <dd>
                    <JsonReadableValue value={child} />
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
      }
    >
      <ol class="manager-agent-json-list">
        <For each={value() as unknown[]}>
          {(item) => (
            <li>
              <JsonReadableValue value={item} />
            </li>
          )}
        </For>
      </ol>
    </Show>
  );
};

function parseReadableJson(value: string): { value: unknown } | null {
  const candidate = stripJsonFence(value.trim());
  if (!candidate || !/^[{[]/.test(candidate)) return null;
  try {
    return { value: JSON.parse(candidate) };
  } catch {
    return null;
  }
}

function stripJsonFence(value: string): string {
  const fence = value.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fence?.[1] ?? value).trim();
}

function formatJsonScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function humanizeJsonKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((word) => (/^[A-Z0-9]+$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

interface ManagerAgentRoleBrief {
  label: string;
  role: string;
  profile: string;
  status: string;
  tone: Tone;
  taskId?: string | undefined;
  assignment: string;
  output: string;
  evidence: string;
  findings: string[];
  risks: string[];
  evidenceCount: number;
  verdict: ManagerAgentResult["verdict"] | "unknown";
  confidence: ManagerAgentResult["confidence"] | "unknown";
  next: string;
  meta: string;
}

function buildAgentRoleBriefs(
  agents: ManagerAgent[],
  runs: ManagerWorkerRun[],
  results: ManagerAgentResult[],
  evidence: ManagerEvidenceItem[],
): ManagerAgentRoleBrief[] {
  const usedRunIds = new Set<string>();
  const briefs: ManagerAgentRoleBrief[] = [];
  const resultByAgentId = new Map(
    results.flatMap((result) => (result.agentId ? [[result.agentId, result]] : [])),
  );
  const resultByTaskId = new Map(
    results.flatMap((result) => (result.taskId ? [[result.taskId, result]] : [])),
  );
  const usedResultIds = new Set<string>();
  for (const agent of agents) {
    const run = findWorkerRunForAgent(agent, runs, usedRunIds);
    if (run) usedRunIds.add(run.id);
    const result =
      resultByAgentId.get(agent.id) ??
      (agent.taskId ? resultByTaskId.get(agent.taskId) : undefined);
    if (result) usedResultIds.add(result.id);
    briefs.push(buildAgentRoleBrief(agent, run, result, evidence));
  }
  for (const run of runs) {
    if (usedRunIds.has(run.id)) continue;
    const result =
      (run.agentId ? resultByAgentId.get(run.agentId) : undefined) ??
      (run.taskId ? resultByTaskId.get(run.taskId) : undefined);
    if (result) usedResultIds.add(result.id);
    briefs.push(buildAgentRoleBrief(undefined, run, result, evidence));
  }
  for (const result of results) {
    if (usedResultIds.has(result.id)) continue;
    briefs.push(buildAgentRoleBrief(undefined, undefined, result, evidence));
  }
  return briefs.slice(0, 12);
}

function findWorkerRunForAgent(
  agent: ManagerAgent,
  runs: ManagerWorkerRun[],
  usedRunIds: Set<string>,
): ManagerWorkerRun | undefined {
  const candidates = runs.filter((run) => !usedRunIds.has(run.id));
  return (
    candidates.find((run) => run.agentId === agent.id) ??
    candidates.find((run) => run.taskId && run.taskId === agent.taskId) ??
    candidates.find((run) => run.agentRole === agent.role)
  );
}

function buildAgentRoleBrief(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  result: ManagerAgentResult | undefined,
  evidence: ManagerEvidenceItem[],
): ManagerAgentRoleBrief {
  const status = run?.status ?? agent?.status ?? "unknown";
  const taskId = run?.taskId ?? agent?.taskId;
  const output = result?.summary ?? agentRoleOutput(agent, run, status);
  const role =
    result?.role ??
    agent?.role ??
    run?.agentRole ??
    run?.agentLabel ??
    t("manager.orchestration.word.worker");
  const linkedEvidence = result
    ? evidence.filter((item) => result.evidenceIds.includes(item.id))
    : evidence.filter(
        (item) =>
          (agent?.id && item.agentId === agent.id) ||
          (run?.agentId && item.agentId === run.agentId) ||
          (taskId && item.taskId === taskId),
      );
  return {
    label: agent?.label ?? run?.agentLabel ?? role,
    role,
    profile: agent?.profile ?? run?.profile ?? "-",
    status,
    tone: statusTone(status),
    taskId,
    assignment:
      result?.assignment ||
      (extractAgentAssignment(agent?.lastInstruction) ??
        t("manager.orchestration.agent.assignment.missing")),
    output,
    evidence: result ? agentResultEvidence(linkedEvidence) : agentRoleEvidence(agent, run),
    findings: result?.findings ?? [],
    risks: result?.risks ?? [],
    evidenceCount: linkedEvidence.length,
    verdict: result?.verdict ?? "unknown",
    confidence: result?.confidence ?? "unknown",
    next: result?.nextRequest ?? agentRoleNextRequest(agent, run, status, output),
    meta: agentRoleMeta(agent, run),
  };
}

function extractAgentAssignment(instruction: string | undefined): string | undefined {
  const lines =
    instruction
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
  const metadataPrefixes = [
    "Project:",
    "CWD:",
    "Objective:",
    "Goal:",
    "Scope:",
    "Constraints:",
    "Success criteria:",
    "Verification plan:",
    "User checkpoints:",
    "Final deliverables:",
  ];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!metadataPrefixes.some((prefix) => line.startsWith(prefix))) return line;
  }
  return undefined;
}

function agentRoleOutput(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  status: string,
): string {
  const explicit = agent?.lastError || run?.error || agent?.lastOutput || run?.outputPreview;
  if (explicit) return explicit;
  if (["assigned", "pending", "running", "waiting"].includes(status)) {
    return t("manager.orchestration.agent.output.waiting");
  }
  if (["failed", "blocked", "missing"].includes(status)) {
    return t("manager.orchestration.agent.output.needs-inspection");
  }
  if (run?.dryRun && ["succeeded", "completed"].includes(status)) {
    return t("manager.orchestration.agent.output.dry-run");
  }
  if (["succeeded", "completed"].includes(status)) {
    return t("manager.orchestration.agent.output.completed-no-output");
  }
  return t("manager.orchestration.worker.no-reply");
}

function agentRoleEvidence(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
): string {
  const parts: string[] = [];
  if (run) {
    const issues = run.integrity.filter((item) => item !== "ok");
    parts.push(
      issues.length > 0
        ? t("manager.orchestration.agent.evidence.integrity-issues", {
            issues: issues.join(", "),
          })
        : t("manager.orchestration.agent.evidence.integrity-ok"),
    );
    const result = workerRunResultLabel(run);
    if (result !== "-") parts.push(result);
    if (run.dryRun) parts.push(t("manager.orchestration.agent.evidence.dry-run"));
  }
  const updatedAt = agent?.lastOutputAt ?? agent?.updatedAt ?? run?.updatedAt;
  if (updatedAt) {
    parts.push(t("manager.orchestration.agent.evidence.updated", { time: formatTime(updatedAt) }));
  }
  const taskId = run?.taskId ?? agent?.taskId;
  if (taskId) parts.push(t("manager.orchestration.word.task", { id: shortId(taskId) }));
  return parts.join(" · ") || t("manager.orchestration.agent.evidence.none");
}

function agentResultEvidence(evidence: ManagerEvidenceItem[]): string {
  if (evidence.length === 0) return t("manager.orchestration.agent.evidence.none");
  const counts = evidenceCounts(evidence);
  const parts = [
    counts.valid ? t("manager.orchestration.evidence.valid-count", { count: counts.valid }) : "",
    counts.failed ? t("manager.orchestration.evidence.failed-count", { count: counts.failed }) : "",
    counts.missing
      ? t("manager.orchestration.evidence.missing-count", { count: counts.missing })
      : "",
    counts.stale ? t("manager.orchestration.evidence.stale-count", { count: counts.stale }) : "",
  ].filter(Boolean);
  return parts.join(" 쨌 ");
}

function evidenceCounts(
  evidence: ManagerEvidenceItem[],
): Record<ManagerEvidenceItem["status"], number> {
  return {
    valid: evidence.filter((item) => item.status === "valid").length,
    stale: evidence.filter((item) => item.status === "stale").length,
    failed: evidence.filter((item) => item.status === "failed").length,
    missing: evidence.filter((item) => item.status === "missing").length,
  };
}

function agentResultVerdictLabel(verdict: ManagerAgentRoleBrief["verdict"]): string {
  return verdict === "unknown"
    ? t("manager.orchestration.status.unknown")
    : t(`manager.orchestration.agent.verdict.${verdict}`);
}

function agentResultConfidenceLabel(confidence: ManagerAgentRoleBrief["confidence"]): string {
  return confidence === "unknown"
    ? t("manager.orchestration.status.unknown")
    : t(`manager.orchestration.agent.confidence.${confidence}`);
}

function evidenceStatusLabel(status: ManagerEvidenceItem["status"]): string {
  return t(`manager.orchestration.evidence.status.${status}`);
}

function evidenceTypeLabel(type: ManagerEvidenceItem["type"]): string {
  return t(`manager.orchestration.evidence.type.${type}`);
}

function protocolTraceResultLabel(result: ManagerProtocolTrace["result"]): string {
  return t(`manager.orchestration.protocol.trace-result.${result}`);
}

function managerJudgmentVerdictLabel(verdict: ManagerJudgmentPacket["verdict"]): string {
  return t(`manager.orchestration.judgment.verdict.${verdict}`);
}

function managerJudgmentPriorityLabel(priority: ManagerJudgmentPacket["priority"]): string {
  return t(`manager.orchestration.judgment.priority.${priority}`);
}

function managerJudgmentDisplaySummary(judgment: ManagerJudgmentPacket): string {
  if (
    managerJudgmentHasAction(judgment, "start_next_round") ||
    managerJudgmentHasAction(judgment, "complete_project")
  ) {
    return t("manager.orchestration.judgment.summary.accepted");
  }
  if (managerJudgmentHasAction(judgment, "review_round")) {
    return t("manager.orchestration.judgment.summary.ready-review");
  }
  return t(`manager.orchestration.judgment.summary.${judgment.verdict}`);
}

function managerJudgmentDisplayReason(judgment: ManagerJudgmentPacket): string {
  if (
    managerJudgmentHasAction(judgment, "start_next_round") ||
    managerJudgmentHasAction(judgment, "complete_project")
  ) {
    return t("manager.orchestration.judgment.reason.accepted");
  }
  if (managerJudgmentHasAction(judgment, "review_round")) {
    return t("manager.orchestration.judgment.reason.ready-review");
  }
  return t(`manager.orchestration.judgment.reason.${judgment.verdict}`);
}

function managerJudgmentHasAction(
  judgment: ManagerJudgmentPacket,
  type: ManagerProposedAction["type"],
): boolean {
  return judgment.proposedActions.some((action) => action.type === type);
}

function managerProposedActionTypeLabel(type: ManagerProposedAction["type"]): string {
  return t(`manager.orchestration.proposed-action.${type}`);
}

function managerCenterlinePhaseLabel(phase: ManagerOrchestrationPhase): string {
  return t(`manager.orchestration.centerline.phase.${phase}`);
}

function managerCenterlinePhaseHint(phase: ManagerOrchestrationPhase): string {
  return t(`manager.orchestration.centerline.phase-hint.${phase}`);
}

function managerCenterlineNodeDetail(
  node: ManagerOrchestrationFlowNode,
  snapshot: ManagerOrchestrationSnapshot,
): string {
  if (node.status === "current" || node.status === "blocked") {
    return managerCenterlineReason(snapshot);
  }
  return managerCenterlinePhaseHint(node.phase);
}

function managerCenterlineReason(snapshot: ManagerOrchestrationSnapshot): string {
  const activeWorkers = snapshot.workers.filter((worker) =>
    ["queued", "starting", "active", "quiet_but_alive", "waiting_external"].includes(
      worker.runtimeState,
    ),
  ).length;
  const availableApprovals = snapshot.approvalActions.filter(
    (action) => action.requiresApproval && action.status === "available",
  ).length;
  switch (snapshot.phase) {
    case "observing":
      return t("manager.orchestration.centerline.reason.observing", { count: activeWorkers });
    case "needs_approval":
      return t("manager.orchestration.centerline.reason.needs_approval", {
        count: availableApprovals,
      });
    case "blocked":
      return (
        snapshot.blockers[0]?.title ??
        t("manager.orchestration.centerline.reason.blocked", { count: snapshot.blockers.length })
      );
    case "completed":
      return t("manager.orchestration.centerline.reason.completed");
    case "planning":
    case "ready":
    case "running":
    case "applying_action":
    case "reviewing":
    case "replanning":
    case "idle":
      return t(`manager.orchestration.centerline.reason.${snapshot.phase}`);
    default:
      return snapshot.currentReason;
  }
}

function managerCenterlineActionLabel(action: ManagerOrchestrationAction): string {
  if (action.type === "start_next_round") {
    return managerProposedActionPayloadBoolean(action.payload, "dryRun")
      ? t("manager.orchestration.proposed-action.start_next_round.dry-run")
      : t("manager.orchestration.proposed-action.start_next_round.live");
  }
  return managerProposedActionTypeLabel(action.type);
}

function managerCenterlineActionStatusLabel(
  status: ManagerOrchestrationAction["status"],
): string {
  return t(`manager.orchestration.centerline.action-status.${status}`);
}

function managerProposedActionLabel(action: ManagerProposedAction): string {
  if (action.type === "start_next_round") {
    return managerProposedActionPayloadBoolean(action.payload, "dryRun")
      ? t("manager.orchestration.proposed-action.start_next_round.dry-run")
      : t("manager.orchestration.proposed-action.start_next_round.live");
  }
  return managerProposedActionTypeLabel(action.type);
}

function managerProposedActionEffect(action: ManagerProposedAction): string {
  const key = `manager.orchestration.proposed-action.effect.${action.type}`;
  if (action.type === "start_next_round") {
    return managerProposedActionPayloadBoolean(action.payload, "dryRun")
      ? t("manager.orchestration.proposed-action.effect.start_next_round.dry-run")
      : t("manager.orchestration.proposed-action.effect.start_next_round.live");
  }
  return t(key);
}

function managerProposedActionDismissEffect(action: ManagerProposedAction): string {
  return t("manager.orchestration.approval.dismiss-effect", {
    action: managerProposedActionLabel(action),
  });
}

function filterManagerCommandFlowApprovalActions(
  commandFlow: ManagerCommandFlowResponse | null | undefined,
  suppressedActionKeys: Set<string>,
): ManagerCommandFlowResponse | null | undefined {
  if (!commandFlow || suppressedActionKeys.size === 0) return commandFlow;
  let changed = false;
  const judgments = commandFlow.judgments
    .map((judgment) => {
      const proposedActions = judgment.proposedActions.filter((action) => {
        const hidden =
          action.requiresApproval && suppressedActionKeys.has(managerApprovalActionKey(action));
        if (hidden) changed = true;
        return !hidden;
      });
      return proposedActions.length === judgment.proposedActions.length
        ? judgment
        : { ...judgment, proposedActions };
    })
    .filter((judgment) => {
      const keep =
        judgment.priority !== "approval" ||
        judgment.proposedActions.some((action) => action.requiresApproval);
      if (!keep) changed = true;
      return keep;
    });
  return changed ? { ...commandFlow, judgments } : commandFlow;
}

function managerApprovalActionKey(action: ManagerProposedAction): string {
  return [
    action.type,
    action.projectId,
    managerProposedActionRoundId(action),
    managerProposedActionTargetId(action) || action.id,
  ].join(":");
}

function managerSnapshotActionForProposed(
  snapshot: ManagerOrchestrationSnapshot | null | undefined,
  action: ManagerProposedAction,
): ManagerOrchestrationAction | undefined {
  if (!snapshot) return undefined;
  return snapshot.approvalActions.find((candidate) =>
    managerSnapshotActionMatchesProposed(candidate, action),
  );
}

function managerSnapshotActionMatchesProposed(
  snapshotAction: ManagerOrchestrationAction,
  action: ManagerProposedAction,
): boolean {
  if (snapshotAction.id === action.id) return true;
  if (snapshotAction.type !== action.type) return false;
  if (snapshotAction.target.projectId !== action.projectId) return false;

  const snapshotRoundId = managerSnapshotActionRoundId(snapshotAction);
  const actionRoundId = managerProposedActionRoundId(action);
  if (snapshotRoundId && actionRoundId && snapshotRoundId !== actionRoundId) return false;

  const snapshotTargetId = managerSnapshotActionTargetId(snapshotAction);
  const actionTargetId = managerProposedActionTargetId(action);
  if (snapshotTargetId && actionTargetId && snapshotTargetId !== actionTargetId) return false;

  return true;
}

function managerSnapshotActionRoundId(action: ManagerOrchestrationAction): string {
  return managerProposedActionPayloadString(action.payload, "roundId") ?? action.target.roundId ?? "";
}

function managerSnapshotActionTargetId(action: ManagerOrchestrationAction): string {
  return (
    managerProposedActionPayloadString(action.payload, "taskId") ??
    action.target.taskId ??
    managerProposedActionPayloadString(action.payload, "agentId") ??
    action.target.agentId ??
    ""
  );
}

function managerProposedActionTargetId(action: ManagerProposedAction): string {
  return (
    managerProposedActionPayloadString(action.payload, "taskId") ??
    action.taskId ??
    managerProposedActionPayloadString(action.payload, "agentId") ??
    action.agentId ??
    ""
  );
}

function managerProposedActionRoundId(action: ManagerProposedAction): string {
  return managerProposedActionPayloadString(action.payload, "roundId") ?? action.roundId ?? "";
}

function managerProposedActionPayloadString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function managerProposedActionPayloadBoolean(
  payload: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function managerSnapshotJudgmentTone(
  phase: ManagerOrchestrationPhase,
): ManagerCurrentJudgmentBrief["tone"] {
  switch (phase) {
    case "needs_approval":
    case "blocked":
      return "warning";
    case "running":
    case "observing":
    case "applying_action":
    case "reviewing":
    case "replanning":
      return "thinking";
    case "idle":
    case "planning":
    case "ready":
    case "completed":
      return "ready";
    default:
      return "ready";
  }
}

function buildManagerCurrentJudgmentBrief(input: {
  project: ManagerProject | null;
  overview: ManagerProjectOverviewResponse | null | undefined;
  commandFlow: ManagerCommandFlowResponse | null | undefined;
  snapshot?: ManagerOrchestrationSnapshot | null | undefined;
  latestReport: ManagerAssistantStatusReport | null | undefined;
}): ManagerCurrentJudgmentBrief | null {
  const project = input.commandFlow?.project ?? input.overview?.project ?? input.project ?? null;
  const activeRound = input.commandFlow?.activeRound ?? input.overview?.activeRound;
  const snapshot = input.snapshot ?? null;
  if (snapshot) {
    const phaseLabel = managerCenterlinePhaseLabel(snapshot.phase);
    const availableActions = snapshot.approvalActions.filter(
      (action) => action.requiresApproval && action.status === "available",
    );
    const primaryApproval = availableActions[0];
    const currentRoundId = snapshot.activeRoundId ?? activeRound?.id ?? project?.activeRoundId ?? null;
    const projectText = project
      ? `${project.name} · ${phaseLabel}`
      : `${snapshot.projectId} · ${phaseLabel}`;
    const roundText = activeRound
      ? `${activeRound.title} · ${statusLabel(activeRound.status)} · ${shortManagerId(activeRound.id)}`
      : currentRoundId
        ? t("manager.orchestration.current-judgment.active-round-id", {
            id: shortManagerId(currentRoundId),
          })
        : t("manager.orchestration.current-judgment.no-round");
    const reportTime = formatAssistantLedgerTime(snapshot.updatedAt);
    const nextActionText = phaseLabel;
    const recommendation = primaryApproval
      ? t("manager.orchestration.current-judgment.recommend.approve", {
          action: managerCenterlineActionLabel(primaryApproval),
        })
      : snapshot.phase === "completed"
        ? t("manager.orchestration.current-judgment.recommend.completed")
        : snapshot.phase === "idle"
          ? t("manager.orchestration.current-judgment.recommend.ask-manager")
          : t("manager.orchestration.current-judgment.recommend.next-action", {
              action: nextActionText,
            });

    return {
      tone: managerSnapshotJudgmentTone(snapshot.phase),
      headline: phaseLabel,
      project: projectText,
      round: roundText,
      nextAction: nextActionText,
      approval:
        availableActions.length > 0
          ? t("manager.orchestration.current-judgment.pending-approval", {
              count: availableActions.length,
            })
          : t("manager.orchestration.current-judgment.no-approval"),
      report: t("manager.orchestration.current-judgment.snapshot-report", {
        time: reportTime,
      }),
      recommendation,
      reportIsStale: false,
      approvalCount: availableActions.length,
      updatedAt: reportTime,
    };
  }
  const projectCompleted = isManagerProjectCompleted(project);
  const nextAction = projectCompleted
    ? null
    : (input.commandFlow?.nextAction ?? input.overview?.nextAction ?? null);
  const approvalJudgments =
    input.commandFlow?.judgments.filter((judgment) => judgment.priority === "approval") ?? [];
  const approvalActions = approvalJudgments.flatMap((judgment) =>
    judgment.proposedActions.filter((action) => action.requiresApproval),
  );
  const approvalCount = approvalActions.length || approvalJudgments.length;
  const latestReport = input.latestReport;
  if (!project && !activeRound && !nextAction && !latestReport && approvalCount === 0) return null;

  const currentProjectId = project?.id ?? null;
  const currentRoundId = activeRound?.id ?? project?.activeRoundId ?? null;
  const reportProjectId = projectIdFromStatusReport(latestReport);
  const reportRoundId = roundIdFromStatusReport(latestReport);
  const reportIsStale = Boolean(
    latestReport &&
      ((currentProjectId && reportProjectId && reportProjectId !== currentProjectId) ||
        (currentRoundId && reportRoundId && reportRoundId !== currentRoundId)),
  );

  const flowStage = project?.flowStage
    ? managerProjectFlowStageLabel(project.flowStage)
    : statusLabel(project?.status);
  const nextActionText = projectCompleted
    ? t("manager.orchestration.current-judgment.completed")
    : nextAction
      ? managerProjectOverviewActionLabel(nextAction)
      : project
        ? flowStage
        : t("manager.orchestration.current-judgment.no-next-action");
  const projectText = project
    ? `${project.name} · ${flowStage}`
    : t("manager.orchestration.current-judgment.no-project");
  const roundText = activeRound
    ? `${activeRound.title} · ${statusLabel(activeRound.status)} · ${shortManagerId(activeRound.id)}`
    : currentRoundId
      ? t("manager.orchestration.current-judgment.active-round-id", {
          id: shortManagerId(currentRoundId),
        })
      : t("manager.orchestration.current-judgment.no-round");
  const reportText = latestReport
    ? `${t(
        reportIsStale
          ? "manager.orchestration.current-judgment.stale-report"
          : "manager.orchestration.current-judgment.latest-report",
      )}: ${latestReport.message}`
    : t("manager.orchestration.current-judgment.no-report");
  const approvalText =
    approvalCount > 0
      ? t("manager.orchestration.current-judgment.pending-approval", { count: approvalCount })
      : input.commandFlow?.judgments.length
        ? t("manager.orchestration.current-judgment.no-approval")
        : t("manager.orchestration.current-judgment.no-judgment");
  const primaryApproval = approvalActions[0];
  const recommendation = primaryApproval
    ? t("manager.orchestration.current-judgment.recommend.approve", {
        action: managerProposedActionLabel(primaryApproval),
      })
    : projectCompleted
      ? t("manager.orchestration.current-judgment.recommend.completed")
      : reportIsStale && currentRoundId
        ? t("manager.orchestration.current-judgment.recommend.refresh-current-round")
        : nextAction
          ? t("manager.orchestration.current-judgment.recommend.next-action", {
              action: nextActionText,
            })
          : t("manager.orchestration.current-judgment.recommend.ask-manager");
  const headline =
    approvalCount > 0
      ? t("manager.orchestration.current-judgment.headline.approval")
      : projectCompleted
        ? t("manager.orchestration.current-judgment.headline.completed")
        : reportIsStale
          ? t("manager.orchestration.current-judgment.headline.stale")
          : nextAction?.kind === "wait"
            ? t("manager.orchestration.current-judgment.headline.wait")
            : t("manager.orchestration.current-judgment.headline.ready");
  const updatedAt = formatAssistantLedgerTime(
    input.commandFlow?.generatedAt ?? input.overview?.generatedAt ?? latestReport?.createdAt,
  );

  return {
    tone:
      approvalCount > 0 || reportIsStale
        ? "warning"
        : nextAction?.kind === "wait"
          ? "thinking"
          : "ready",
    headline,
    project: projectText,
    round: roundText,
    nextAction: nextActionText,
    approval: approvalText,
    report: reportText,
    recommendation,
    reportIsStale,
    approvalCount,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function projectIdFromStatusReport(
  report: ManagerAssistantStatusReport | null | undefined,
): string | null {
  return firstStatusReportMatch([report?.detail, report?.message], /\bproject_[A-Za-z0-9_-]+\b/);
}

function roundIdFromStatusReport(
  report: ManagerAssistantStatusReport | null | undefined,
): string | null {
  return firstStatusReportMatch(
    [report?.detail, report?.message, report?.round],
    /\bround_[A-Za-z0-9_-]+\b/,
  );
}

function isManagerProjectCompleted(project: ManagerProject | null | undefined): boolean {
  return project?.status === "completed" || project?.flowStage === "completed";
}

function assistantStatusReportMatchesProjectScope(
  report: ManagerAssistantStatusReport | null | undefined,
  projectId: string | null | undefined,
  roundId: string | null | undefined,
): boolean {
  const reportProjectId = projectIdFromStatusReport(report);
  const reportRoundId = roundIdFromStatusReport(report);
  if (!reportProjectId && !reportRoundId) return false;
  if (projectId && reportProjectId && reportProjectId !== projectId) return false;
  if (roundId && reportRoundId && reportRoundId !== roundId) return false;
  return true;
}

function firstStatusReportMatch(values: Array<string | undefined>, pattern: RegExp): string | null {
  for (const value of values) {
    const match = value?.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}

function shortManagerId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return trimmed.slice(0, 8);
}

function managerStartButtonLabel(dryRun: boolean): string {
  return dryRun
    ? t("manager.orchestration.action.start-dry-run")
    : t("manager.orchestration.action.start-real");
}

function managerRoundReviewActionButtonLabel(action: ManagerRoundReviewRequest["action"]): string {
  return t(`manager.orchestration.review-action.${action}`);
}

function confirmManagerAction(key: string, params: Record<string, string | number> = {}): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm(t(key, params));
}

function agentRoleNextRequest(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  status: string,
  output: string,
): string {
  const taskId = run?.taskId ?? agent?.taskId;
  const hasIntegrityIssue = Boolean(run?.integrity.some((item) => item !== "ok"));
  if (hasIntegrityIssue || ["failed", "blocked", "missing"].includes(status)) {
    return taskId
      ? t("manager.orchestration.agent.next.inspect-task", { taskId: shortId(taskId) })
      : t("manager.orchestration.agent.next.manager-review");
  }
  if (["assigned", "pending", "running", "waiting"].includes(status)) {
    return t("manager.orchestration.agent.next.wait");
  }
  if (run?.dryRun && ["succeeded", "completed"].includes(status)) {
    return t("manager.orchestration.agent.next.promote-or-replan");
  }
  if (output && output !== t("manager.orchestration.worker.no-reply")) {
    return t("manager.orchestration.agent.next.review-output");
  }
  if (!taskId) return t("manager.orchestration.agent.next.assign");
  return t("manager.orchestration.agent.next.summarize");
}

function agentRoleMeta(agent: ManagerAgent | undefined, run: ManagerWorkerRun | undefined): string {
  const taskId = run?.taskId ?? agent?.taskId;
  const sessionId = run?.sessionId ?? agent?.sessionId;
  const parts = [
    taskId ? t("manager.orchestration.word.task", { id: shortId(taskId) }) : "",
    sessionId ? `${t("manager.orchestration.field.session")} ${shortId(sessionId)}` : "",
    run?.dryRun ? t("manager.orchestration.flow.dry-run") : "",
    formatTime(agent?.lastOutputAt ?? agent?.updatedAt ?? run?.updatedAt),
  ].filter(Boolean);
  return parts.join(" · ");
}
const DecisionsView: Component<{
  project: ManagerProject | null;
  decisions: ManagerDecision[];
  archivedDecisions: ManagerDecision[];
  busy?: boolean | undefined;
  activeRoundId?: string | undefined;
  onCreate?: ((input: ManagerDecisionCreateRequest) => void) | undefined;
  onUpdate?: ((decisionId: string, input: ManagerDecisionUpdateRequest) => void) | undefined;
}> = (props) => {
  const [creating, setCreating] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [detail, setDetail] = createSignal("");
  const [tags, setTags] = createSignal("");
  const canCreate = createMemo(
    () =>
      Boolean(props.project && props.onCreate && title().trim() && detail().trim()) && !props.busy,
  );
  const submit = () => {
    if (!canCreate() || !props.onCreate) return;
    props.onCreate({
      title: title().trim(),
      detail: detail().trim(),
      tags: parseDecisionTags(tags()),
      createdBy: "browser",
      ...(props.activeRoundId ? { roundId: props.activeRoundId } : {}),
    });
    setCreating(false);
    setTitle("");
    setDetail("");
    setTags("");
  };

  return (
    <div class="manager-decision-board">
      <div class="manager-decision-toolbar">
        <p class="manager-orchestration-empty">{t("manager.orchestration.toolbar.decisions")}</p>
        <button
          type="button"
          disabled={!props.project || props.busy || !props.onCreate}
          onClick={() => setCreating((value) => !value)}
        >
          {creating()
            ? t("manager.orchestration.action.cancel")
            : t("manager.orchestration.action.record-decision")}
        </button>
      </div>

      <Show when={creating()}>
        <form
          class="manager-decision-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            type="text"
            value={title()}
            onInput={(event) => setTitle(event.currentTarget.value)}
            placeholder={t("manager.orchestration.placeholder.decision-title")}
          />
          <textarea
            value={detail()}
            onInput={(event) => setDetail(event.currentTarget.value)}
            placeholder={t("manager.orchestration.placeholder.decision-detail")}
            rows={4}
          />
          <input
            type="text"
            value={tags()}
            onInput={(event) => setTags(event.currentTarget.value)}
            placeholder={t("manager.orchestration.placeholder.tags")}
          />
          <button type="submit" disabled={!canCreate()}>
            {t("manager.orchestration.action.save-decision")}
          </button>
        </form>
      </Show>

      <div class="manager-decision-list">
        <For each={props.decisions}>
          {(decision) => (
            <DecisionRow decision={decision} busy={props.busy} onUpdate={props.onUpdate} />
          )}
        </For>
        <Show when={props.decisions.length === 0}>
          <p class="manager-orchestration-empty">{t("manager.orchestration.empty.decisions")}</p>
        </Show>
      </div>

      <Show when={props.archivedDecisions.length > 0}>
        <details class="manager-decision-archive">
          <summary>
            {t("manager.orchestration.archive.decisions", {
              count: props.archivedDecisions.length,
            })}
          </summary>
          <For each={props.archivedDecisions.slice(0, 8)}>
            {(decision) => (
              <DecisionRow decision={decision} busy={props.busy} onUpdate={props.onUpdate} />
            )}
          </For>
        </details>
      </Show>
    </div>
  );
};

const DecisionRow: Component<{
  decision: ManagerDecision;
  busy?: boolean | undefined;
  onUpdate?: ((decisionId: string, input: ManagerDecisionUpdateRequest) => void) | undefined;
}> = (props) => (
  <article class={`manager-decision-row manager-decision-row-${props.decision.status}`}>
    <div class="manager-decision-row-main">
      <strong>{props.decision.title}</strong>
      <p>{props.decision.detail}</p>
      <div class="manager-decision-meta">
        <span>{statusLabel(props.decision.status)}</span>
        <time>{formatTime(props.decision.updatedAt)}</time>
        <Show when={props.decision.roundId}>
          {(roundId) => (
            <span>{t("manager.orchestration.word.round", { id: shortId(roundId()) })}</span>
          )}
        </Show>
        <Show when={props.decision.revisions.length > 0}>
          <span>
            {t("manager.orchestration.word.revisions", {
              count: props.decision.revisions.length,
            })}
          </span>
        </Show>
      </div>
      <Show when={props.decision.tags.length > 0}>
        <div class="manager-decision-tags">
          <For each={props.decision.tags}>{(tag) => <span>{tag}</span>}</For>
        </div>
      </Show>
    </div>
    <div class="manager-decision-actions">
      <Show when={props.decision.status === "active"}>
        <button
          type="button"
          disabled={props.busy || !props.onUpdate}
          onClick={() => props.onUpdate?.(props.decision.id, { status: "superseded" })}
        >
          {t("manager.orchestration.action.supersede-decision")}
        </button>
      </Show>
      <Show when={props.decision.status !== "archived"}>
        <button
          type="button"
          disabled={props.busy || !props.onUpdate}
          onClick={() => {
            if (
              confirmManagerAction("manager.orchestration.confirm.archive-decision", {
                title: props.decision.title,
              })
            ) {
              props.onUpdate?.(props.decision.id, { status: "archived" });
            }
          }}
        >
          {t("manager.orchestration.action.archive-decision")}
        </button>
      </Show>
    </div>
  </article>
);

const BlockersView: Component<{
  project: ManagerProject | null;
  blockers: ManagerBlocker[];
  resolvedBlockers: ManagerBlocker[];
  busy?: boolean | undefined;
  activeRoundId?: string | undefined;
  onCreate?: ((input: ManagerBlockerCreateRequest) => void) | undefined;
  onResolve?: ((blockerId: string, input?: ManagerBlockerResolveRequest) => void) | undefined;
  advanced?: boolean | undefined;
}> = (props) => {
  const [creating, setCreating] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [detail, setDetail] = createSignal("");
  const [severity, setSeverity] = createSignal<ManagerBlocker["severity"]>("warning");
  const [requiredAction, setRequiredAction] =
    createSignal<ManagerBlocker["requiredAction"]>("manager");
  const [owner, setOwner] = createSignal("manager");
  const [dedupeKey, setDedupeKey] = createSignal("");
  const canCreate = createMemo(
    () => Boolean(props.project && props.onCreate && title().trim()) && !props.busy,
  );
  const submit = () => {
    if (!canCreate() || !props.onCreate) return;
    props.onCreate({
      title: title().trim(),
      severity: severity(),
      requiredAction: requiredAction(),
      source: "browser",
      owner: owner().trim() || "manager",
      ...(detail().trim() ? { detail: detail().trim() } : {}),
      ...(dedupeKey().trim() ? { dedupeKey: dedupeKey().trim() } : {}),
      ...(props.activeRoundId ? { roundId: props.activeRoundId } : {}),
    });
    setCreating(false);
    setTitle("");
    setDetail("");
    setSeverity("warning");
    setRequiredAction("manager");
    setOwner("manager");
    setDedupeKey("");
  };

  return (
    <div class="manager-blocker-board">
      <Show when={props.advanced}>
        <div class="manager-blocker-toolbar">
          <p class="manager-orchestration-empty">{t("manager.orchestration.toolbar.blockers")}</p>
          <button
            type="button"
            disabled={!props.project || props.busy || !props.onCreate}
            onClick={() => setCreating((value) => !value)}
          >
            {creating()
              ? t("manager.orchestration.action.cancel")
              : t("manager.orchestration.action.record-blocker")}
          </button>
        </div>

        <Show when={creating()}>
          <form
            class="manager-blocker-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              type="text"
              value={title()}
              onInput={(event) => setTitle(event.currentTarget.value)}
              placeholder={t("manager.orchestration.placeholder.blocker-title")}
            />
            <textarea
              value={detail()}
              onInput={(event) => setDetail(event.currentTarget.value)}
              placeholder={t("manager.orchestration.placeholder.blocker-detail")}
              rows={4}
            />
            <select
              value={severity()}
              onChange={(event) =>
                setSeverity(event.currentTarget.value as ManagerBlocker["severity"])
              }
            >
              <option value="info">{statusLabel("info")}</option>
              <option value="warning">{statusLabel("warning")}</option>
              <option value="error">{statusLabel("error")}</option>
            </select>
            <select
              value={requiredAction()}
              onChange={(event) =>
                setRequiredAction(event.currentTarget.value as ManagerBlocker["requiredAction"])
              }
            >
              <option value="manager">{t("manager.orchestration.blocker.required.manager")}</option>
              <option value="worker">{t("manager.orchestration.blocker.required.worker")}</option>
              <option value="user">{t("manager.orchestration.blocker.required.user")}</option>
              <option value="none">{t("manager.orchestration.blocker.required.none")}</option>
            </select>
            <input
              type="text"
              value={owner()}
              onInput={(event) => setOwner(event.currentTarget.value)}
              placeholder={t("manager.orchestration.placeholder.owner")}
            />
            <input
              type="text"
              value={dedupeKey()}
              onInput={(event) => setDedupeKey(event.currentTarget.value)}
              placeholder={t("manager.orchestration.placeholder.dedupe-key")}
            />
            <button type="submit" disabled={!canCreate()}>
              {t("manager.orchestration.action.save-blocker")}
            </button>
          </form>
        </Show>
      </Show>

      <div class="manager-blocker-list">
        <For each={props.blockers}>
          {(blocker) => (
            <BlockerRow
              blocker={blocker}
              busy={props.busy}
              onResolve={props.onResolve}
              advanced={props.advanced}
            />
          )}
        </For>
        <Show when={props.blockers.length === 0}>
          <p class="manager-orchestration-empty">{t("manager.orchestration.empty.blockers")}</p>
        </Show>
      </div>

      <Show when={Boolean(props.advanced && props.resolvedBlockers.length > 0)}>
        <details class="manager-blocker-resolved">
          <summary>
            {t("manager.orchestration.archive.resolved-blockers", {
              count: props.resolvedBlockers.length,
            })}
          </summary>
          <For each={props.resolvedBlockers.slice(0, 8)}>
            {(blocker) => (
              <BlockerRow
                blocker={blocker}
                busy={props.busy}
                onResolve={props.onResolve}
                advanced={props.advanced}
              />
            )}
          </For>
        </details>
      </Show>
    </div>
  );
};

const BlockerRow: Component<{
  blocker: ManagerBlocker;
  busy?: boolean | undefined;
  onResolve?: ((blockerId: string, input?: ManagerBlockerResolveRequest) => void) | undefined;
  advanced?: boolean | undefined;
}> = (props) => (
  <article
    class={`manager-blocker-row manager-blocker-row-${props.blocker.severity} manager-blocker-row-${props.blocker.status}`}
  >
    <div class="manager-blocker-row-main">
      <strong>{props.blocker.title}</strong>
      <Show when={props.blocker.detail}>{(detail) => <p>{detail()}</p>}</Show>
      <div class="manager-blocker-meta">
        <span>{statusLabel(props.blocker.severity)}</span>
        <span>{t(`manager.orchestration.blocker.required.${props.blocker.requiredAction}`)}</span>
        <Show when={props.advanced}>
          <span>{t("manager.orchestration.word.owner", { owner: props.blocker.owner })}</span>
          <time>{formatTime(props.blocker.updatedAt)}</time>
          <Show when={props.blocker.roundId}>
            {(roundId) => (
              <span>{t("manager.orchestration.word.round", { id: shortId(roundId()) })}</span>
            )}
          </Show>
          <Show when={props.blocker.dedupeKey}>
            {(key) => (
              <span title={key()}>
                {t("manager.orchestration.word.key", { key: clip(key(), 32) })}
              </span>
            )}
          </Show>
        </Show>
      </div>
      <Show when={props.blocker.resolution}>
        {(resolution) => <small class="manager-blocker-resolution">{resolution()}</small>}
      </Show>
    </div>
    <div class="manager-blocker-actions">
      <Show when={props.blocker.status === "open"}>
        <button
          type="button"
          disabled={props.busy || !props.onResolve}
          onClick={() =>
            props.onResolve?.(props.blocker.id, {
              resolution: t("manager.orchestration.recovery.resolved"),
            })
          }
        >
          {t("manager.orchestration.action.resolve-blocker")}
        </button>
        <button
          type="button"
          disabled={props.busy || !props.onResolve}
          onClick={() =>
            props.onResolve?.(props.blocker.id, {
              status: "dismissed",
              resolution: t("manager.orchestration.recovery.dismissed"),
            })
          }
        >
          {t("manager.orchestration.action.dismiss-blocker")}
        </button>
      </Show>
    </div>
  </article>
);

const TimelineView: Component<{ entries: TimelineEntry[] }> = (props) => (
  <ol class="manager-timeline">
    <For each={props.entries}>
      {(entry) => (
        <li class={`manager-timeline-item manager-timeline-${entry.tone}`}>
          <time>{formatTime(entry.at)}</time>
          <span>{entry.label}</span>
          <Show when={entry.detail}>{(detail) => <small>{detail()}</small>}</Show>
        </li>
      )}
    </For>
    <Show when={props.entries.length === 0}>
      <li class="manager-orchestration-empty">{t("manager.orchestration.empty.events")}</li>
    </Show>
  </ol>
);

const MermaidFlowView: Component<{
  round: ManagerRound | undefined;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  hiddenAgentCount: number;
}> = (props) => {
  const source = createMemo(() =>
    buildWorkerFlowDiagram(props.round, props.agents, props.tasks, props.hiddenAgentCount),
  );
  return (
    <div class="manager-mermaid-flow">
      <MermaidDiagram source={source()} ariaLabel={t("manager.orchestration.aria.worker-flow")} />
      <details class="manager-mermaid-source">
        <summary>{t("manager.orchestration.graph.source")}</summary>
        <pre>{source()}</pre>
      </details>
    </div>
  );
};

const MermaidDiagram: Component<{ source: string; ariaLabel?: string | undefined }> = (props) => {
  const [svg, setSvg] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const diagramId = ++mermaidDiagramInstance;
  let renderId = 0;

  createEffect(() => {
    const source = props.source;
    const currentId = ++renderId;
    setSvg("");
    setError(null);
    void renderMermaid(source, currentId);
  });

  async function renderMermaid(source: string, currentId: number) {
    try {
      const mermaidModule = await import("mermaid");
      const mermaid = mermaidModule.default;
      const dark = globalThis.document?.documentElement.dataset.theme === "dark";
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "base",
        themeVariables: {
          background: "transparent",
          fontFamily: "inherit",
          primaryColor: dark ? "#2f2f2f" : "#f6f5f2",
          primaryTextColor: dark ? "#f4f4f4" : "#1f1e1b",
          primaryBorderColor: dark ? "#525252" : "#d6d1c8",
          lineColor: dark ? "#8a8580" : "#8d867b",
          actorBorder: dark ? "#6f6a63" : "#c9c1b7",
          actorBkg: dark ? "#262626" : "#fbfaf8",
          actorTextColor: dark ? "#f4f4f4" : "#1f1e1b",
          signalColor: dark ? "#f4f4f4" : "#1f1e1b",
          signalTextColor: dark ? "#f4f4f4" : "#1f1e1b",
          noteBkgColor: dark ? "#2a2521" : "#fff6df",
          noteTextColor: dark ? "#f4f4f4" : "#1f1e1b",
          noteBorderColor: dark ? "#8c6a46" : "#e0b875",
        },
      });
      const result = await mermaid.render(`manager-flow-${diagramId}-${currentId}`, source);
      if (currentId !== renderId) return;
      setSvg(result.svg);
    } catch (err) {
      if (currentId !== renderId) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      class="manager-mermaid-render"
      aria-label={props.ariaLabel ?? t("manager.orchestration.aria.worker-flow")}
    >
      <Show
        when={!error()}
        fallback={
          <p class="manager-orchestration-empty">
            {t("manager.orchestration.graph.render-failed", { error: error() ?? "" })}
          </p>
        }
      >
        <Show
          when={svg()}
          fallback={
            <p class="manager-orchestration-empty">{t("manager.orchestration.graph.rendering")}</p>
          }
        >
          {(html) => <div class="manager-mermaid-svg" innerHTML={html()} />}
        </Show>
      </Show>
    </div>
  );
};

const ProtocolPrincipleDiagram: Component<{ protocol: ManagerProtocolState | null }> = (props) => {
  const source = createMemo(() => buildProtocolPrincipleDiagram(props.protocol));
  return (
    <div class="manager-protocol-principle">
      <div class="manager-protocol-principle-header">
        <strong>{t("manager.orchestration.protocol.diagram.title")}</strong>
        <span>{t("manager.orchestration.protocol.diagram.subtitle")}</span>
      </div>
      <MermaidDiagram
        source={source()}
        ariaLabel={t("manager.orchestration.aria.protocol-principle")}
      />
      <details class="manager-mermaid-source">
        <summary>{t("manager.orchestration.graph.source")}</summary>
        <pre>{source()}</pre>
      </details>
    </div>
  );
};

const ArtifactsView: Component<{
  artifacts: ArtifactEntry[];
  inactiveArtifacts?: ArtifactEntry[] | undefined;
  busy?: boolean | undefined;
  stored?: boolean | undefined;
  onScan?: (() => void) | undefined;
  onUpdate?: ((artifactId: string, input: ManagerArtifactUpdateRequest) => void) | undefined;
  advanced?: boolean | undefined;
}> = (props) => (
  <div class="manager-artifact-list" classList={{ "manager-artifact-list-basic": !props.advanced }}>
    <div class="manager-artifact-toolbar">
      <p>
        {props.stored
          ? t("manager.orchestration.toolbar.artifacts-stored")
          : t("manager.orchestration.toolbar.artifacts-derived")}
      </p>
      <Show when={props.advanced}>
        <button type="button" disabled={props.busy} onClick={() => props.onScan?.()}>
          {props.busy
            ? t("manager.orchestration.action.scanning")
            : t("manager.orchestration.action.scan-artifacts")}
        </button>
      </Show>
    </div>
    <div class="manager-artifact-row manager-artifact-row-head">
      <span>{t("manager.orchestration.field.file")}</span>
      <span>{t("manager.orchestration.field.kind")}</span>
      <span>{t("manager.orchestration.field.status")}</span>
      <span>{t("manager.orchestration.field.updated")}</span>
      <Show when={props.advanced}>
        <span>{t("manager.orchestration.field.owner")}</span>
        <span>{t("manager.orchestration.field.action")}</span>
      </Show>
    </div>
    <For each={props.artifacts}>
      {(artifact) => (
        <div class="manager-artifact-row">
          <span class="manager-artifact-path" title={artifact.path}>
            {artifact.path}
          </span>
          <span>{artifact.kind ?? t("manager.orchestration.status.unknown")}</span>
          <span>{statusLabel(artifact.status)}</span>
          <time>{formatTime(artifact.updatedAt)}</time>
          <Show when={props.advanced}>
            <span>{artifact.owner}</span>
            <span>
              <Show when={artifact.id}>
                {(id) => (
                  <button
                    type="button"
                    class="manager-artifact-action"
                    disabled={props.busy}
                    onClick={() => {
                      if (
                        confirmManagerAction("manager.orchestration.confirm.obsolete-artifact", {
                          path: artifact.path,
                        })
                      ) {
                        props.onUpdate?.(id(), { status: "obsolete" });
                      }
                    }}
                  >
                    {t("manager.orchestration.action.obsolete")}
                  </button>
                )}
              </Show>
            </span>
          </Show>
        </div>
      )}
    </For>
    <Show when={props.artifacts.length === 0}>
      <p class="manager-orchestration-empty">{t("manager.orchestration.empty.artifacts")}</p>
    </Show>
    <Show when={Boolean(props.advanced && (props.inactiveArtifacts?.length ?? 0) > 0)}>
      <details class="manager-artifact-inactive">
        <summary>
          {t("manager.orchestration.artifact.inactive", {
            count: props.inactiveArtifacts?.length ?? 0,
          })}
        </summary>
        <For each={props.inactiveArtifacts ?? []}>
          {(artifact) => (
            <div class="manager-artifact-row">
              <span class="manager-artifact-path" title={artifact.path}>
                {artifact.path}
              </span>
              <span>{artifact.owner}</span>
              <span>{artifact.kind ?? t("manager.orchestration.status.unknown")}</span>
              <span>{statusLabel(artifact.status)}</span>
              <time>{formatTime(artifact.updatedAt)}</time>
              <span>
                <Show when={artifact.id}>
                  {(id) => (
                    <button
                      type="button"
                      class="manager-artifact-action"
                      disabled={props.busy}
                      onClick={() => props.onUpdate?.(id(), { status: "active" })}
                    >
                      {t("manager.orchestration.action.activate")}
                    </button>
                  )}
                </Show>
              </span>
            </div>
          )}
        </For>
      </details>
    </Show>
  </div>
);

const ProtocolTraceView: Component<{
  trace: ManagerProtocolTrace[];
  evidence: ManagerEvidenceItem[];
}> = (props) => {
  const visible = createMemo(() => props.trace.slice(0, 8));
  const evidenceById = createMemo(() => new Map(props.evidence.map((item) => [item.id, item])));
  return (
    <Show when={props.trace.length > 0}>
      <div class="manager-protocol-trace" aria-label={t("manager.orchestration.protocol.trace")}>
        <div class="manager-protocol-trace-head">
          <strong>{t("manager.orchestration.protocol.trace")}</strong>
          <span>
            {t("manager.orchestration.protocol.trace-count", { count: props.trace.length })}
          </span>
        </div>
        <For each={visible()}>
          {(item) => {
            const linked = item.evidenceIds
              .map((id) => evidenceById().get(id))
              .filter((evidence): evidence is ManagerEvidenceItem => Boolean(evidence));
            return (
              <div class={`manager-protocol-trace-row manager-protocol-trace-${item.result}`}>
                <span>{protocolTraceResultLabel(item.result)}</span>
                <strong title={item.detail}>{item.sourceFile}</strong>
                <small title={item.detail}>{clip(item.detail, 120)}</small>
                <em>{t("manager.orchestration.agent.evidence-count", { count: linked.length })}</em>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
};

const ProtocolView: Component<{
  protocol: ManagerProtocolState | null;
  trace: ManagerProtocolTrace[];
  evidence: ManagerEvidenceItem[];
  busy?: boolean | undefined;
  activeRoundId?: string | undefined;
  decisions: ManagerDecision[];
  onScan?: (() => void) | undefined;
  onUpdate?: ((input: ManagerProtocolUpdateRequest) => void) | undefined;
  advanced?: boolean | undefined;
}> = (props) => {
  const [version, setVersion] = createSignal("unversioned");
  const [activeRules, setActiveRules] = createSignal("");
  const [changeSummary, setChangeSummary] = createSignal("");
  const [changeDecisionId, setChangeDecisionId] = createSignal("");
  const [changeRoundId, setChangeRoundId] = createSignal("");
  createEffect(() => {
    const protocol = props.protocol;
    setVersion(protocol?.version ?? "unversioned");
    setActiveRules((protocol?.activeRules ?? []).join("\n"));
    setChangeSummary(protocol?.latestChange?.summary ?? "");
    setChangeDecisionId(protocol?.latestChange?.decisionId ?? "");
    setChangeRoundId(protocol?.latestChange?.roundId ?? props.activeRoundId ?? "");
  });
  const presentCount = createMemo(
    () => props.protocol?.files.filter((file) => file.status === "present").length ?? 0,
  );
  const save = () => {
    if (!props.onUpdate) return;
    const rules = activeRules()
      .split(/\r?\n/)
      .map((rule) => rule.trim())
      .filter(Boolean);
    const summary = changeSummary().trim();
    props.onUpdate({
      version: version().trim(),
      activeRules: rules,
      ...(summary
        ? {
            latestChange: {
              summary,
              ...(changeDecisionId().trim() ? { decisionId: changeDecisionId().trim() } : {}),
              ...(changeRoundId().trim() ? { roundId: changeRoundId().trim() } : {}),
            },
          }
        : {}),
    });
  };
  return (
    <div class="manager-protocol-view">
      <ProtocolPrincipleDiagram protocol={props.protocol} />
      <div class="manager-artifact-toolbar">
        <p>
          {props.protocol
            ? t("manager.orchestration.protocol.files-present", {
                present: presentCount(),
                total: props.protocol.files.length,
                version: props.protocol.version,
              })
            : t("manager.orchestration.empty.protocol-scan")}
        </p>
        <button type="button" disabled={props.busy} onClick={() => props.onScan?.()}>
          {props.busy
            ? t("manager.orchestration.action.scanning")
            : t("manager.orchestration.action.scan-protocol")}
        </button>
      </div>
      <Show when={!props.advanced && (props.protocol?.activeRules.length ?? 0) > 0}>
        <div class="manager-protocol-rule-summary">
          <strong>{t("manager.orchestration.protocol.active-rules")}</strong>
          <ul>
            <For each={(props.protocol?.activeRules ?? []).slice(0, 5)}>
              {(rule) => <li>{rule}</li>}
            </For>
          </ul>
        </div>
      </Show>
      <Show when={(props.protocol?.warnings.length ?? 0) > 0}>
        <ul class="manager-protocol-warnings">
          <For each={props.protocol?.warnings ?? []}>{(warning) => <li>{warning}</li>}</For>
        </ul>
      </Show>
      <Show when={props.advanced}>
        <ProtocolTraceView trace={props.trace} evidence={props.evidence} />
        <div class="manager-protocol-editor">
          <label>
            <span>{t("manager.orchestration.field.version")}</span>
            <input
              type="text"
              value={version()}
              disabled={props.busy}
              onInput={(event) => setVersion(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>{t("manager.orchestration.protocol.active-rules")}</span>
            <textarea
              value={activeRules()}
              disabled={props.busy}
              rows={4}
              onInput={(event) => setActiveRules(event.currentTarget.value)}
              placeholder={t("manager.orchestration.placeholder.active-rules")}
            />
          </label>
          <label>
            <span>{t("manager.orchestration.field.latest-change")}</span>
            <input
              type="text"
              value={changeSummary()}
              disabled={props.busy}
              onInput={(event) => setChangeSummary(event.currentTarget.value)}
              placeholder={t("manager.orchestration.placeholder.latest-change")}
            />
          </label>
          <div class="manager-protocol-change-row">
            <label>
              <span>{t("manager.orchestration.field.decision")}</span>
              <select
                value={changeDecisionId()}
                disabled={props.busy}
                onChange={(event) => setChangeDecisionId(event.currentTarget.value)}
              >
                <option value="">{t("manager.orchestration.protocol.no-linked-decision")}</option>
                <For each={props.decisions.filter((decision) => decision.status === "active")}>
                  {(decision) => <option value={decision.id}>{decision.title}</option>}
                </For>
              </select>
            </label>
            <label>
              <span>{t("manager.orchestration.field.round")}</span>
              <input
                type="text"
                value={changeRoundId()}
                disabled={props.busy}
                onInput={(event) => setChangeRoundId(event.currentTarget.value)}
                placeholder={t("manager.orchestration.placeholder.round-id")}
              />
            </label>
          </div>
          <div class="manager-protocol-actions">
            <button type="button" disabled={props.busy || !props.onUpdate} onClick={save}>
              {t("manager.orchestration.action.save-protocol")}
            </button>
            <button
              type="button"
              disabled={props.busy || !props.onUpdate}
              onClick={() => {
                if (confirmManagerAction("manager.orchestration.confirm.clear-protocol-change")) {
                  props.onUpdate?.({ latestChange: null });
                }
              }}
            >
              {t("manager.orchestration.action.clear-change")}
            </button>
          </div>
        </div>
        <div class="manager-artifact-row manager-artifact-row-head">
          <span>{t("manager.orchestration.field.file")}</span>
          <span>{t("manager.orchestration.field.role")}</span>
          <span>{t("manager.orchestration.field.status")}</span>
          <span>{t("manager.orchestration.field.updated")}</span>
          <span>{t("manager.orchestration.field.evidence")}</span>
          <span>{t("manager.orchestration.field.note")}</span>
        </div>
        <For each={props.protocol?.files ?? []}>
          {(file) => (
            <div class="manager-artifact-row">
              <span class="manager-artifact-path" title={file.path}>
                {file.path}
              </span>
              <span>{file.role}</span>
              <span>{statusLabel(file.status)}</span>
              <time>{file.modifiedAt ? formatTime(file.modifiedAt) : "-"}</time>
              <span>
                <Show when={file.excerpt}>
                  {(excerpt) => (
                    <details class="manager-protocol-excerpt">
                      <summary>{t("manager.orchestration.protocol.excerpt")}</summary>
                      <pre>{excerpt()}</pre>
                    </details>
                  )}
                </Show>
              </span>
              <span>
                {file.error ??
                  (file.sizeBytes
                    ? t("manager.orchestration.word.bytes", { count: file.sizeBytes })
                    : "")}
              </span>
            </div>
          )}
        </For>
      </Show>
      <Show when={!props.protocol}>
        <p class="manager-orchestration-empty">{t("manager.orchestration.empty.protocol")}</p>
      </Show>
    </div>
  );
};

const HygieneView: Component<{
  report?: ManagerSessionHygieneReport | null | undefined;
  projectReport?: ManagerProjectHygieneReport | null | undefined;
  loading?: boolean | undefined;
  projectLoading?: boolean | undefined;
  cleanupBusy?: boolean | undefined;
  projectCleanupBusy?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
  onCleanup?: (() => void) | undefined;
  onRefreshProject?: (() => void) | undefined;
  onCleanupProject?: (() => void) | undefined;
}> = (props) => {
  const cleanupItems = createMemo(() =>
    (props.report?.items ?? []).filter((item) => item.action === "cleanup"),
  );
  const visibleItems = createMemo(() => [
    ...cleanupItems(),
    ...(props.report?.items ?? []).filter((item) => item.action !== "cleanup"),
  ]);
  const projectCleanupIssues = createMemo(() =>
    (props.projectReport?.issues ?? []).filter((issue) => issue.cleanupEligible),
  );
  const visibleProjectIssues = createMemo(() => [
    ...projectCleanupIssues(),
    ...(props.projectReport?.issues ?? []).filter((issue) => !issue.cleanupEligible),
  ]);
  return (
    <div class="manager-hygiene">
      <div class="manager-hygiene-group">
        <div class="manager-hygiene-head">
          <div>
            <span class="manager-overview-label">{t("manager.orchestration.hygiene.project")}</span>
            <p>
              <Show
                when={props.projectReport}
                fallback={
                  props.projectLoading
                    ? t("manager.orchestration.hygiene.project-loading")
                    : t("manager.orchestration.hygiene.project-none")
                }
              >
                {(report) =>
                  t("manager.orchestration.hygiene.project-summary", {
                    cleanup: report().summary.cleanupCandidates,
                    protected: report().summary.protected,
                    recorded: report().summary.recordedBlockers,
                  })
                }
              </Show>
            </p>
          </div>
          <div class="manager-hygiene-actions">
            <button
              type="button"
              onClick={() => props.onRefreshProject?.()}
              disabled={props.projectLoading}
            >
              {t("manager.orchestration.action.refresh")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  confirmManagerAction("manager.orchestration.confirm.record-cleanup-blockers", {
                    count: projectCleanupIssues().length,
                  })
                ) {
                  props.onCleanupProject?.();
                }
              }}
              disabled={props.projectCleanupBusy || projectCleanupIssues().length === 0}
            >
              {props.projectCleanupBusy
                ? t("manager.orchestration.hygiene.recording")
                : t("manager.orchestration.hygiene.record-blockers")}
            </button>
          </div>
        </div>
        <Show when={props.projectReport}>
          {(report) => (
            <div class="manager-hygiene-categories">
              <For each={Object.entries(report().summary.categories)}>
                {([category, count]) => (
                  <span classList={{ "manager-hygiene-category-empty": count === 0 }}>
                    {formatProjectHygieneKind(category)} {count}
                  </span>
                )}
              </For>
            </div>
          )}
        </Show>
        <div class="manager-hygiene-list">
          <For each={visibleProjectIssues().slice(0, 12)}>
            {(issue) => <ProjectHygieneIssueRow issue={issue} />}
          </For>
          <Show when={visibleProjectIssues().length === 0}>
            <p class="manager-orchestration-empty">
              {t("manager.orchestration.hygiene.empty.project")}
            </p>
          </Show>
        </div>
      </div>
      <div class="manager-hygiene-head">
        <div>
          <span class="manager-overview-label">{t("manager.orchestration.hygiene.session")}</span>
          <p>
            <Show
              when={props.report}
              fallback={
                props.loading
                  ? t("manager.orchestration.hygiene.session-loading")
                  : t("manager.orchestration.hygiene.session-none")
              }
            >
              {(report) =>
                t("manager.orchestration.hygiene.session-summary", {
                  cleanup: report().summary.cleanupCandidates,
                  preserved: report().summary.preserved,
                })
              }
            </Show>
          </p>
        </div>
        <div class="manager-hygiene-actions">
          <button type="button" onClick={() => props.onRefresh?.()} disabled={props.loading}>
            {t("manager.orchestration.action.refresh")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                confirmManagerAction("manager.orchestration.confirm.safe-cleanup", {
                  count: cleanupItems().length,
                })
              ) {
                props.onCleanup?.();
              }
            }}
            disabled={props.cleanupBusy || cleanupItems().length === 0}
          >
            {props.cleanupBusy
              ? t("manager.orchestration.hygiene.cleanup")
              : t("manager.orchestration.action.safe-cleanup")}
          </button>
        </div>
      </div>
      <Show when={props.report?.errors.length}>
        <div class="manager-hygiene-errors">
          <For each={props.report?.errors ?? []}>
            {(error) => (
              <span>
                {error.stage}: {error.error}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.report}>
        {(report) => (
          <div class="manager-hygiene-categories">
            <For each={Object.entries(report().summary.categories)}>
              {([category, count]) => (
                <span classList={{ "manager-hygiene-category-empty": count === 0 }}>
                  {formatHygieneCategory(category)} {count}
                </span>
              )}
            </For>
          </div>
        )}
      </Show>
      <div class="manager-hygiene-list">
        <For each={visibleItems().slice(0, 16)}>{(item) => <HygieneItemRow item={item} />}</For>
        <Show when={visibleItems().length === 0}>
          <p class="manager-orchestration-empty">
            {t("manager.orchestration.hygiene.empty.sessions")}
          </p>
        </Show>
      </div>
    </div>
  );
};

const ProjectHygieneIssueRow: Component<{ issue: ManagerProjectHygieneIssue }> = (props) => (
  <div class="manager-hygiene-row">
    <span class={`manager-agent-status manager-agent-status-${projectHygieneTone(props.issue)}`}>
      {props.issue.blockerId
        ? t("manager.orchestration.hygiene.action.recorded")
        : props.issue.protected
          ? t("manager.orchestration.hygiene.action.protected")
          : props.issue.cleanupEligible
            ? t("manager.orchestration.hygiene.action.record")
            : t("manager.orchestration.hygiene.action.check")}
    </span>
    <span class="manager-hygiene-title" title={props.issue.title}>
      {props.issue.title}
    </span>
    <span>{formatProjectHygieneKind(props.issue.kind)}</span>
    <span title={props.issue.detail ?? props.issue.dedupeKey ?? ""}>
      {clip(props.issue.detail ?? props.issue.dedupeKey, 72)}
    </span>
    <time>{formatTime(props.issue.updatedAt)}</time>
  </div>
);

const HygieneItemRow: Component<{ item: ManagerSessionHygieneItem }> = (props) => (
  <div class="manager-hygiene-row">
    <span class={`manager-agent-status manager-agent-status-${hygieneTone(props.item)}`}>
      {props.item.action === "cleanup"
        ? t("manager.orchestration.hygiene.action.cleanup")
        : t("manager.orchestration.hygiene.action.keep")}
    </span>
    <span class="manager-hygiene-title" title={props.item.fullTitle || props.item.title || ""}>
      {props.item.title || shortId(props.item.sessionId)}
    </span>
    <span>{formatHygieneCategory(props.item.category)}</span>
    <span title={props.item.reason}>{clip(props.item.reason, 72)}</span>
    <time>{formatTime(props.item.modifiedAt)}</time>
  </div>
);

function pickActiveRound(rounds: ManagerRound[]): ManagerRound | undefined {
  const unacknowledged = rounds.filter((round) => !round.acknowledgedAt);
  return (
    unacknowledged.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ?? unacknowledged[0]
  );
}

function readPanelHeight(): number {
  try {
    const value = globalThis.localStorage?.getItem(HEIGHT_STORAGE_KEY);
    return clampPanelHeight(Number(value));
  } catch {
    return DEFAULT_PANEL_HEIGHT;
  }
}

function writePanelHeight(value: number): void {
  try {
    globalThis.localStorage?.setItem(HEIGHT_STORAGE_KEY, String(clampPanelHeight(value)));
  } catch {
    // Ignore private-mode/localStorage failures; the in-memory height still works.
  }
}

function clampPanelHeight(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PANEL_HEIGHT;
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(value)));
}

function projectWizardKindLabel(value: ProjectWizardKind): string {
  switch (value) {
    case "app":
      return t("manager.orchestration.project-wizard.kind.app");
    case "website":
      return t("manager.orchestration.project-wizard.kind.website");
    case "automation":
      return t("manager.orchestration.project-wizard.kind.automation");
    case "document":
      return t("manager.orchestration.project-wizard.kind.document");
    case "data":
      return t("manager.orchestration.project-wizard.kind.data");
    case "game":
      return t("manager.orchestration.project-wizard.kind.game");
    case "existing":
      return t("manager.orchestration.project-wizard.kind.existing");
    case "other":
      return t("manager.orchestration.project-wizard.kind.other");
  }
}

function projectWizardModeLabel(value: ProjectWizardMode): string {
  switch (value) {
    case "create":
      return t("manager.orchestration.project-wizard.mode.create");
    case "change":
      return t("manager.orchestration.project-wizard.mode.change");
    case "review":
      return t("manager.orchestration.project-wizard.mode.review");
  }
}

function projectWizardModeTitle(value: ProjectWizardMode): string {
  switch (value) {
    case "create":
      return t("manager.orchestration.project-wizard.title.create");
    case "change":
      return t("manager.orchestration.project-wizard.title.change");
    case "review":
      return t("manager.orchestration.project-wizard.title.review");
  }
}

function projectWizardModeGuidance(value: ProjectWizardMode): string {
  switch (value) {
    case "create":
      return t("manager.orchestration.project-wizard.guidance.create");
    case "change":
      return t("manager.orchestration.project-wizard.guidance.change");
    case "review":
      return t("manager.orchestration.project-wizard.guidance.review");
  }
}

function projectProtocolSourceLabel(value: ManagerProjectProtocolSource): string {
  return value === "blank"
    ? t("manager.orchestration.project.protocol-source.blank")
    : t("manager.orchestration.project.protocol-source.base-copy");
}

function isLikelyAbsoluteWorkspacePath(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/")
  );
}

function projectWizardName(intent: string, kind: ProjectWizardKind): string {
  return clip(projectWizardGoal(intent), 54) || projectWizardKindLabel(kind);
}

function projectWizardGoal(intent: string): string {
  return clip(compactWizardText(firstWizardSentence(intent)), 160);
}

function buildProjectWizardCharter(input: {
  goal: string;
  intent: string;
  kind: ProjectWizardKind;
  audience: string;
  useCase: string;
  constraints: string;
  successCriteria: string;
  nonGoals: string;
  preferredApproach: string;
}): Partial<ManagerProjectCharter> {
  const intent = compactWizardText(input.intent);
  const kind = projectWizardKindLabel(input.kind);
  const audience = compactWizardText(input.audience);
  const useCase = compactWizardText(input.useCase);
  const constraints = compactWizardText(input.constraints);
  const successCriteria = compactWizardText(input.successCriteria);
  const nonGoals = compactWizardText(input.nonGoals);
  const preferredApproach = compactWizardText(input.preferredApproach);
  return {
    goal: compactWizardText(input.goal),
    scope: joinWizardLines([
      `${t("manager.orchestration.project-wizard.summary.kind")}: ${kind}`,
      intent ? `${t("manager.orchestration.project-wizard.summary.intent")}: ${intent}` : "",
      useCase ? `${t("manager.orchestration.project-wizard.summary.use-case")}: ${useCase}` : "",
      audience ? `${t("manager.orchestration.project-wizard.summary.audience")}: ${audience}` : "",
    ]),
    nonGoals: nonGoals || t("manager.orchestration.project-wizard.generated.non-goals"),
    constraints: joinWizardLines([
      constraints,
      t("manager.orchestration.project-wizard.generated.constraints"),
    ]),
    successCriteria: successCriteria || projectWizardDefaultSuccess(input.kind),
    preferredApproach:
      preferredApproach || t("manager.orchestration.project-wizard.generated.approach"),
    verificationPlan: projectWizardDefaultVerification(input.kind),
    userCheckpoints: joinWizardLines([
      t("manager.orchestration.project-wizard.checkpoint.before-start"),
      t("manager.orchestration.project-wizard.checkpoint.after-round"),
      t("manager.orchestration.project-wizard.checkpoint.before-final"),
    ]),
    finalDeliverables: projectWizardDefaultDeliverable(input.kind),
    updatedBy: "browser",
  };
}

function buildProjectWizardIntentEvent(
  charter: Partial<ManagerProjectCharter>,
  protocolSource: ManagerProjectProtocolSource,
  roundId: string | undefined,
): ManagerWizardIntentEventInput {
  return {
    kind: "charter-applied",
    fields: [
      ...projectWizardCharterFields(charter),
      {
        field: "protocolSource",
        after: projectProtocolSourceLabel(protocolSource),
      },
    ],
    impact: protocolSource === "blank" ? "high" : "medium",
    managerAction: "refresh-readiness",
    ...(roundId ? { roundId } : {}),
    note: t("manager.orchestration.project-wizard.event.created"),
  };
}

function buildCharterApplyWizardIntentEvent(
  before: ManagerProjectCharter,
  after: ManagerProjectCharterUpdateRequest,
  stage: ManagerCommandFlowResponse["readiness"]["stage"] | undefined,
  roundId: string | undefined,
): ManagerWizardIntentEventInput | undefined {
  const fields = charterApplyWizardFields(before, after);
  if (fields.length === 0) return undefined;
  const impact = wizardImpactForFields(fields);
  const runningStage = stage === "running" || stage === "review" || stage === "replanning";
  return {
    kind: "charter-applied",
    fields,
    impact,
    managerAction: runningStage ? (impact === "high" ? "replan" : "continue") : "refresh-readiness",
    ...(roundId ? { roundId } : {}),
    note: t("manager.orchestration.project-wizard.event.charter-applied"),
  };
}

function projectWizardCharterFields(
  charter: Partial<ManagerProjectCharter>,
): ManagerWizardIntentEventInput["fields"] {
  const fields: Array<[ManagerProjectCharterTextField, string | undefined]> = [
    ["goal", charter.goal],
    ["scope", charter.scope],
    ["nonGoals", charter.nonGoals],
    ["constraints", charter.constraints],
    ["successCriteria", charter.successCriteria],
    ["preferredApproach", charter.preferredApproach],
    ["verificationPlan", charter.verificationPlan],
    ["userCheckpoints", charter.userCheckpoints],
    ["finalDeliverables", charter.finalDeliverables],
  ];
  return fields.flatMap(([field, after]) =>
    typeof after === "string" && after.trim() ? [{ field, after: after.trim() }] : [],
  );
}

function charterApplyWizardFields(
  before: ManagerProjectCharter,
  after: ManagerProjectCharterUpdateRequest,
): ManagerWizardIntentEventInput["fields"] {
  const fields: ManagerProjectCharterTextField[] = [
    "goal",
    "scope",
    "nonGoals",
    "constraints",
    "successCriteria",
    "preferredApproach",
    "verificationPlan",
    "userCheckpoints",
    "finalDeliverables",
  ];
  return fields.flatMap((field) => {
    const beforeValue = typeof before[field] === "string" ? before[field].trim() : "";
    const afterValue = typeof after[field] === "string" ? after[field].trim() : "";
    if (!afterValue || beforeValue === afterValue) return [];
    return [
      {
        field,
        ...(beforeValue ? { before: beforeValue } : {}),
        after: afterValue,
      },
    ];
  });
}

function wizardImpactForFields(
  fields: ManagerWizardIntentEventInput["fields"],
): ManagerWizardIntentEvent["impact"] {
  const highImpact = new Set(["goal", "constraints", "nonGoals", "protocolSource"]);
  const mediumImpact = new Set([
    "successCriteria",
    "verificationPlan",
    "userCheckpoints",
    "finalDeliverables",
  ]);
  if (fields.some((field) => highImpact.has(field.field))) return "high";
  if (fields.some((field) => mediumImpact.has(field.field))) return "medium";
  return "low";
}

function wizardIntentEventLabel(event: ManagerWizardIntentEvent): string {
  const fields = event.fields.map((field) => field.field).join(", ");
  return t("manager.orchestration.wizard-events.item", {
    impact: t(`manager.orchestration.wizard-events.impact.${event.impact}`),
    action: t(`manager.orchestration.wizard-events.action.${event.managerAction}`),
    fields,
  });
}

function wizardIntentEventInputLabel(event: ManagerWizardIntentEventInput): string {
  const fields = event.fields.map((field) => field.field).join(", ");
  const impact = event.impact ?? "unknown";
  const action = event.managerAction ?? "record";
  return t("manager.orchestration.wizard-events.item", {
    impact: t(`manager.orchestration.wizard-events.impact.${impact}`),
    action: t(`manager.orchestration.wizard-events.action.${action}`),
    fields,
  });
}

function projectWizardSummaryRows(
  charter: Partial<ManagerProjectCharter>,
): Array<{ label: string; value: string }> {
  return [
    { label: t("manager.orchestration.project-wizard.field.goal"), value: charter.goal ?? "" },
    { label: t("manager.orchestration.project-wizard.field.scope"), value: charter.scope ?? "" },
    {
      label: t("manager.orchestration.project-wizard.field.success"),
      value: charter.successCriteria ?? "",
    },
    {
      label: t("manager.orchestration.project-wizard.field.verification"),
      value: charter.verificationPlan ?? "",
    },
    {
      label: t("manager.orchestration.project-wizard.field.checkpoints"),
      value: charter.userCheckpoints ?? "",
    },
    {
      label: t("manager.orchestration.project-wizard.field.deliverables"),
      value: charter.finalDeliverables ?? "",
    },
  ].filter((row) => row.value.trim());
}

function projectWizardDefaultSuccess(kind: ProjectWizardKind): string {
  switch (kind) {
    case "app":
      return t("manager.orchestration.project-wizard.success.app");
    case "website":
      return t("manager.orchestration.project-wizard.success.website");
    case "automation":
      return t("manager.orchestration.project-wizard.success.automation");
    case "document":
      return t("manager.orchestration.project-wizard.success.document");
    case "data":
      return t("manager.orchestration.project-wizard.success.data");
    case "game":
      return t("manager.orchestration.project-wizard.success.game");
    case "existing":
      return t("manager.orchestration.project-wizard.success.existing");
    case "other":
      return t("manager.orchestration.project-wizard.success.other");
  }
}

function projectWizardDefaultVerification(kind: ProjectWizardKind): string {
  return t("manager.orchestration.project-wizard.generated.verification", {
    kind: projectWizardKindLabel(kind),
  });
}

function projectWizardDefaultDeliverable(kind: ProjectWizardKind): string {
  switch (kind) {
    case "app":
      return t("manager.orchestration.project-wizard.deliverable.app");
    case "website":
      return t("manager.orchestration.project-wizard.deliverable.website");
    case "automation":
      return t("manager.orchestration.project-wizard.deliverable.automation");
    case "document":
      return t("manager.orchestration.project-wizard.deliverable.document");
    case "data":
      return t("manager.orchestration.project-wizard.deliverable.data");
    case "game":
      return t("manager.orchestration.project-wizard.deliverable.game");
    case "existing":
      return t("manager.orchestration.project-wizard.deliverable.existing");
    case "other":
      return t("manager.orchestration.project-wizard.deliverable.other");
  }
}

function firstWizardSentence(value: string): string {
  const compact = compactWizardText(value);
  const firstLine = compact.split(/\n+/)[0] ?? "";
  return firstLine.split(/(?<=[.!?。！？])\s+/)[0] ?? firstLine;
}

function compactWizardText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function joinWizardLines(values: string[]): string {
  return values.map(compactWizardText).filter(Boolean).join("\n");
}

function summarizeTotals(agents: ManagerAgent[]) {
  return {
    total: agents.length,
    completed: agents.filter((agent) => agent.status === "completed").length,
    running: agents.filter((agent) => ["assigned", "running", "waiting"].includes(agent.status))
      .length,
    blocked: agents.filter((agent) => ["blocked", "failed", "stale"].includes(agent.status)).length,
  };
}

function pickPrimaryBlocker(blockers: ManagerBlocker[]): ManagerBlocker | null {
  if (blockers.length === 0) return null;
  return (
    [...blockers].sort(
      (left, right) =>
        blockerSeverityWeight(right.severity) - blockerSeverityWeight(left.severity) ||
        blockerActionWeight(right.requiredAction) - blockerActionWeight(left.requiredAction) ||
        blockerSpecificityWeight(right) - blockerSpecificityWeight(left) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0] ?? null
  );
}

function blockerSeverityWeight(value: ManagerBlocker["severity"]): number {
  if (value === "error") return 3;
  if (value === "warning") return 2;
  return 1;
}

function blockerActionWeight(value: ManagerBlocker["requiredAction"]): number {
  if (value === "user") return 4;
  if (value === "manager") return 3;
  if (value === "worker") return 2;
  return 1;
}

function blockerSpecificityWeight(blocker: ManagerBlocker): number {
  return (
    (managerBlockerIsToolchainSetupCandidate(blocker) ? 2 : 0) +
    (blocker.dedupeKey ? 1 : 0) -
    (/^user verification required$/i.test(blocker.title.trim()) ? 1 : 0)
  );
}

function managerBlockerIsToolchainSetupCandidate(blocker: ManagerBlocker): boolean {
  const text = [blocker.title, blocker.detail, blocker.dedupeKey, blocker.owner, blocker.source]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (!text) return false;
  if (text.includes("godot") && /(missing|not found|executable|runtime|toolchain)/.test(text)) {
    return true;
  }
  return [
    "godot-missing",
    "godot4_exe",
    "godot_exe",
    "toolchain missing",
    "missing toolchain",
    "runtime verification blocked",
    "runtime missing",
    "sdk missing",
    "missing sdk",
    "cli missing",
    "missing cli",
    "executable not found",
  ].some((needle) => text.includes(needle));
}

function summarizeWorkerRunTotals(runs: ManagerWorkerRun[]) {
  return {
    total: runs.length,
    active: runs.filter((run) =>
      ["pending", "running", "waiting_for_device", "restart_required"].includes(run.status),
    ).length,
  };
}

function visibleManagerAgents(
  agents: ManagerAgent[],
  round: ManagerRound | undefined,
): ManagerAgent[] {
  const scoped = round
    ? agents.filter((agent) => agent.roundId === round.id || round.agentIds.includes(agent.id))
    : agents;
  const withSignals = scoped.filter((agent) => hasAgentSignal(agent));
  const candidates =
    withSignals.length > 0 ? withSignals : scoped.filter((agent) => agent.status !== "idle");
  const fallback = candidates.length > 0 ? candidates : scoped;
  return dedupeManagerAgents(fallback);
}

function dedupeManagerAgents(agents: ManagerAgent[]): ManagerAgent[] {
  const preferred = agents.filter((agent) => !isShadowAgent(agent, agents));
  const byKey = new Map<string, ManagerAgent>();
  for (const agent of preferred) {
    const key = managerAgentDedupeKey(agent);
    const existing = byKey.get(key);
    if (!existing || compareManagerAgentSignal(agent, existing) > 0) {
      byKey.set(key, agent);
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const leftActive = hasAgentSignal(left) ? 1 : 0;
    const rightActive = hasAgentSignal(right) ? 1 : 0;
    return (
      rightActive - leftActive ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.role.localeCompare(right.role)
    );
  });
}

function commandFlowCharter(
  project: ManagerProject | null,
  commandFlow: ManagerCommandFlowResponse | null,
): ManagerProjectCharter {
  const charter = commandFlow?.charter ?? project?.charter;
  const updatedAt = charter?.updatedAt ?? project?.updatedAt;
  return {
    goal: charter?.goal || project?.goal || "",
    scope: charter?.scope ?? "",
    nonGoals: charter?.nonGoals ?? "",
    constraints: charter?.constraints ?? "",
    successCriteria: charter?.successCriteria ?? "",
    preferredApproach: charter?.preferredApproach ?? "",
    verificationPlan: charter?.verificationPlan ?? "",
    userCheckpoints: charter?.userCheckpoints ?? "",
    finalDeliverables: charter?.finalDeliverables ?? "",
    ...(updatedAt ? { updatedAt } : {}),
    updatedBy: charter?.updatedBy ?? "system",
  };
}

function resolveCurrentCommandFlowStage(
  project: ManagerProject | null,
  commandFlow: ManagerCommandFlowResponse | null,
  activeRound: ManagerRound | undefined,
): ManagerCommandFlowStage {
  if (commandFlow?.readiness.stage) return commandFlow.readiness.stage;
  if (project?.flowStage) return project.flowStage;
  return projectStatusCommandFlowStage(project?.status, activeRound?.status);
}

function projectStatusCommandFlowStage(
  status: ManagerProject["status"] | undefined,
  roundStatus: ManagerRound["status"] | undefined,
): ManagerCommandFlowStage {
  if (status === "archived") return "archived";
  if (status === "completed") return "completed";
  if (status === "reviewing") return "review";
  if (status === "blocked") return "replanning";
  if (status === "running") return roundStatusCommandFlowStage(roundStatus) ?? "running";
  return "draft";
}

function roundStatusCommandFlowStage(
  status: ManagerRound["status"] | undefined,
): ManagerCommandFlowStage | undefined {
  switch (status) {
    case "planned":
      return "ready_to_start";
    case "dispatching":
    case "running":
    case "collecting":
      return "running";
    case "reviewing":
    case "completed":
      return "review";
    case "blocked":
    case "failed":
    case "cancelled":
      return "replanning";
    default:
      return undefined;
  }
}

function commandFlowStageDone(
  stage: ManagerCommandFlowStage,
  current: ManagerCommandFlowStage | undefined,
): boolean {
  if (!current) return false;
  const currentIndex = COMMAND_FLOW_STAGES.indexOf(current);
  const stageIndex = COMMAND_FLOW_STAGES.indexOf(stage);
  if (currentIndex < 0 || stageIndex < 0) return false;
  return currentIndex > stageIndex;
}

function managerProjectFlowStageLabel(stage: ManagerProject["flowStage"]): string {
  return stage
    ? t(`manager.orchestration.flow.stage.${stage}`)
    : t("manager.orchestration.flow.stage.draft");
}

function managerProjectOverviewActionLabel(action: ManagerProjectOverviewAction): string {
  switch (action.kind) {
    case "create-round":
      return t("manager.orchestration.next-action.create-round");
    case "dispatch":
      return t("manager.orchestration.next-action.dispatch");
    case "inspect":
      return t("manager.orchestration.next-action.inspect");
    case "repair":
      return t("manager.orchestration.next-action.repair");
    case "review":
      return t("manager.orchestration.next-action.review");
    case "summarize":
      return t("manager.orchestration.next-action.summarize");
    case "wait":
      return t("manager.orchestration.next-action.wait");
    default:
      return action.label;
  }
}

function managerCommandFlowStageNextLabel(stage: ManagerCommandFlowStage): string {
  switch (stage) {
    case "draft":
    case "protocol_ready":
      return t("manager.orchestration.action.prepare");
    case "ready_to_start":
      return t("manager.orchestration.next-action.create-round");
    case "running":
      return t("manager.orchestration.next-action.wait");
    case "review":
      return t("manager.orchestration.next-action.review");
    case "replanning":
      return t("manager.orchestration.next-action.repair");
    case "completed":
      return t("manager.orchestration.current-judgment.completed");
    case "archived":
      return t("manager.orchestration.status.archived");
    default:
      return t("manager.orchestration.flow.state-machine.no-action");
  }
}

function managerCommandFlowWarningLabel(warning: string): string {
  switch (warning) {
    case "Project charter goal is not recorded.":
      return t("manager.orchestration.flow.warning.missing-goal");
    case "A user verification blocker is open.":
      return t("manager.orchestration.flow.warning.user-check");
    case "A missing toolchain can be handled by workers.":
      return t("manager.orchestration.flow.warning.toolchain-setup");
    default:
      return warning;
  }
}

function splitList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isShadowAgent(agent: ManagerAgent, agents: ManagerAgent[]): boolean {
  if (agent.taskId) return false;
  if (agent.status !== "idle" && agent.status !== "assigned") return false;
  return agents.some((candidate) => {
    if (candidate.id === agent.id || !candidate.taskId) return false;
    return (
      candidate.roundId === agent.roundId &&
      candidate.role === agent.role &&
      candidate.profile === agent.profile &&
      (candidate.cwd ?? "") === (agent.cwd ?? "") &&
      (!agent.lastInstruction || candidate.lastInstruction === agent.lastInstruction)
    );
  });
}

function managerAgentDedupeKey(agent: ManagerAgent): string {
  if (agent.taskId) return `task:${agent.taskId}`;
  return [
    "agent",
    agent.roundId ?? "",
    agent.role,
    agent.profile,
    agent.cwd ?? "",
    normalizeDedupeText(agent.lastInstruction),
  ].join("|");
}

function compareManagerAgentSignal(left: ManagerAgent, right: ManagerAgent): number {
  return (
    signalWeight(left) - signalWeight(right) ||
    Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
  );
}

function signalWeight(agent: ManagerAgent): number {
  let score = 0;
  if (agent.taskId) score += 8;
  if (agent.lastOutput) score += 4;
  if (agent.lastError) score += 4;
  if (agent.lastInstruction) score += 2;
  if (["running", "waiting", "blocked", "failed", "completed", "stale"].includes(agent.status)) {
    score += 2;
  }
  if (agent.status === "idle") score -= 2;
  return score;
}

function hasAgentSignal(agent: ManagerAgent): boolean {
  return Boolean(
    agent.taskId ||
      agent.lastInstruction ||
      agent.lastOutput ||
      agent.lastError ||
      ["assigned", "running", "waiting", "blocked", "failed", "completed", "stale"].includes(
        agent.status,
      ),
  );
}

function normalizeDedupeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function buildWorkerFlowDiagram(
  round: ManagerRound | undefined,
  agents: ManagerAgent[],
  tasks: ManagerTask[],
  hiddenAgentCount: number,
): string {
  const visibleAgents = agents.slice(0, 12);
  const hiddenCount = Math.max(0, agents.length - visibleAgents.length) + hiddenAgentCount;
  const lines = [
    "flowchart TB",
    "    classDef neutral fill:transparent,stroke:#8d867b;",
    "    classDef running fill:transparent,stroke:#d39b2f,stroke-width:2px;",
    "    classDef done fill:transparent,stroke:#2f8f5b,stroke-width:2px;",
    "    classDef blocked fill:transparent,stroke:#c94f45,stroke-width:2px;",
    `    R["${mermaidText(round?.title ?? t("manager.orchestration.title"), 68)}"]:::${statusTone(round?.status)}`,
    `    O["${mermaidText(round?.objective || t("manager.orchestration.overview.no-round-objective"), 84)}"]:::neutral`,
    `    D["${t("manager.orchestration.graph.dispatch-workers")}"]:::running`,
    `    C["${t("manager.orchestration.graph.collect-results")}"]:::neutral`,
    "    R --> O --> D",
  ];

  if (visibleAgents.length === 0) {
    lines.push("    D --> C");
  }

  for (const [index, agent] of visibleAgents.entries()) {
    const task = tasks.find((candidate) => candidate.id === agent.taskId);
    const lastStep = task?.steps[task.steps.length - 1];
    const agentId = `A${index}`;
    const taskId = `T${index}`;
    const signalId = `N${index}`;
    const taskState = task?.state ?? agent.status;
    const taskLabel = lastStep
      ? `${lastStep.label} - ${statusLabel(lastStep.status)}`
      : `${task?.kind ?? agent.profile} - ${statusLabel(taskState)}`;
    const signal = mermaidText(
      agent.lastError || lastStep?.summary || agent.lastOutput || agent.lastInstruction,
      76,
    );
    lines.push(
      `    ${agentId}["${mermaidText(
        `${agent.role} - ${statusLabel(agent.status)}`,
        54,
      )}"]:::${statusTone(agent.status)}`,
    );
    lines.push(`    ${taskId}["${mermaidText(taskLabel, 58)}"]:::${statusTone(taskState)}`);
    lines.push(`    D --> ${agentId} --> ${taskId}`);
    if (signal !== "-") {
      lines.push(`    ${signalId}["${signal}"]:::${statusTone(taskState)}`);
      lines.push(`    ${taskId} --> ${signalId} --> C`);
    } else {
      lines.push(`    ${taskId} --> C`);
    }
  }

  if (hiddenCount > 0) {
    lines.push(
      `    H["${t("manager.orchestration.graph.hidden-workers", { count: hiddenCount })}"]:::neutral`,
    );
    lines.push("    D -.-> H");
  }
  lines.push(
    `    S["${mermaidText(
      round?.error || round?.summary || currentFlowSignal(visibleAgents, tasks),
      88,
    )}"]:::${statusTone(round?.status)}`,
  );
  lines.push("    C --> S");
  return lines.join("\n");
}

function buildProtocolPrincipleDiagram(protocol: ManagerProtocolState | null): string {
  const version = protocol?.version ?? t("manager.orchestration.protocol.diagram.blank");
  const rules = (protocol?.activeRules ?? []).slice(0, 4);
  const lines = [
    "flowchart TD",
    "    classDef source fill:transparent,stroke:#6f7f8f,stroke-width:2px;",
    "    classDef cycle fill:transparent,stroke:#8d867b;",
    "    classDef gate fill:transparent,stroke:#d39b2f,stroke-width:2px;",
    "    classDef rule fill:transparent,stroke:#2f8f5b,stroke-width:2px;",
    "    classDef failure fill:transparent,stroke:#c94f45,stroke-width:2px;",
    `    Charter["${mermaidText(
      `${t("manager.orchestration.protocol.diagram.charter")} - ${version}`,
      84,
    )}"]:::source`,
    `    Observe["${mermaidText(t("manager.orchestration.protocol.diagram.observe"), 72)}"]:::cycle`,
    `    Plan["${mermaidText(t("manager.orchestration.protocol.diagram.plan"), 72)}"]:::cycle`,
    `    Delegate["${mermaidText(
      t("manager.orchestration.protocol.diagram.delegate"),
      72,
    )}"]:::cycle`,
    `    Inspect["${mermaidText(t("manager.orchestration.protocol.diagram.inspect"), 72)}"]:::cycle`,
    `    Verify{"${mermaidText(t("manager.orchestration.protocol.diagram.verify"), 72)}"}:::gate`,
    `    Improve["${mermaidText(t("manager.orchestration.protocol.diagram.improve"), 72)}"]:::rule`,
    `    Report["${mermaidText(t("manager.orchestration.protocol.diagram.report"), 72)}"]:::cycle`,
    `    Adapter["${mermaidText(t("manager.orchestration.protocol.diagram.adapter"), 72)}"]:::source`,
    `    Runtime["${mermaidText(t("manager.orchestration.protocol.diagram.runtime"), 72)}"]:::gate`,
    `    Failure["${mermaidText(t("manager.orchestration.protocol.diagram.failure"), 72)}"]:::failure`,
    "    Charter --> Observe --> Plan --> Delegate --> Inspect --> Verify",
    "    Verify --> Improve --> Report --> Observe",
    "    Verify --> Failure --> Improve",
    "    Delegate --> Adapter",
    "    Verify --> Runtime",
  ];

  if (rules.length > 0) {
    rules.forEach((rule, index) => {
      const ruleId = `Rule${index}`;
      lines.push(`    ${ruleId}["${mermaidText(rule, 96)}"]:::rule`);
      lines.push(`    Improve -.-> ${ruleId}`);
    });
  } else {
    lines.push(
      `    Rules["${mermaidText(t("manager.orchestration.protocol.diagram.no-rules"), 72)}"]:::rule`,
    );
    lines.push("    Improve -.-> Rules");
  }

  return lines.join("\n");
}

function currentFlowSignal(agents: ManagerAgent[], tasks: ManagerTask[]): string {
  const blockedAgent = agents.find((agent) =>
    ["blocked", "failed", "stale"].includes(agent.status),
  );
  if (blockedAgent) {
    return t("manager.orchestration.graph.needs-attention", { role: blockedAgent.role });
  }
  const activeCount = agents.filter((agent) =>
    ["assigned", "running", "waiting"].includes(agent.status),
  ).length;
  if (activeCount > 0) {
    return t("manager.orchestration.graph.workers-running", { count: activeCount });
  }
  const blockedTask = tasks.find((task) => ["blocked", "failed"].includes(task.state));
  if (blockedTask) return `${blockedTask.kind} ${statusLabel(blockedTask.state)}`;
  return agents.length > 0
    ? t("manager.orchestration.graph.worker-records", { count: agents.length })
    : t("manager.orchestration.graph.no-worker-signal");
}

function buildTimeline(
  round: ManagerRound | undefined,
  agents: ManagerAgent[],
  tasks: ManagerTask[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  if (round) {
    entries.push({
      at: round.createdAt,
      label: t("manager.orchestration.timeline.round-created", { title: round.title }),
      detail: round.objective,
      tone: "neutral",
    });
    if (round.startedAt) {
      entries.push({
        at: round.startedAt,
        label: t("manager.orchestration.timeline.round-started"),
        detail: statusLabel(round.status),
        tone: "running",
      });
    }
    if (round.completedAt) {
      entries.push({
        at: round.completedAt,
        label: t("manager.orchestration.timeline.round-finished"),
        detail: round.summary || round.error,
        tone: round.status === "completed" ? "done" : "blocked",
      });
    }
  }
  for (const agent of agents) {
    entries.push({
      at: agent.updatedAt,
      label: `${agent.role} ${statusLabel(agent.status)}`,
      detail: agent.lastError || agent.lastOutput || agent.lastInstruction,
      tone: statusTone(agent.status),
    });
  }
  for (const task of tasks) {
    const lastStep = task.steps[task.steps.length - 1];
    entries.push({
      at: task.completedAt ?? task.startedAt ?? task.updatedAt,
      label: t("manager.orchestration.timeline.task", {
        id: shortId(task.id),
        status: statusLabel(task.state),
      }),
      detail: task.error || lastStep?.summary,
      tone: statusTone(task.state),
    });
  }
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-40);
}

function buildArtifacts(agents: ManagerAgent[], tasks: ManagerTask[]): ArtifactEntry[] {
  const seen = new Map<string, ArtifactEntry>();
  for (const agent of agents) {
    for (const path of collectArtifactPaths(
      [agent.lastInstruction, agent.lastOutput, agent.lastError].join("\n"),
    )) {
      seen.set(path, {
        path,
        owner: agent.role,
        status: agent.status,
        updatedAt: agent.updatedAt,
      });
    }
  }
  for (const task of tasks) {
    const text = [
      task.error,
      JSON.stringify(task.params ?? {}),
      JSON.stringify(task.result ?? {}),
      ...task.steps.map((step) => `${step.label}\n${step.summary}\n${step.detail ?? ""}`),
    ].join("\n");
    for (const path of collectArtifactPaths(text)) {
      if (seen.has(path)) continue;
      seen.set(path, {
        path,
        owner: task.targetLabel ?? task.kind,
        status: task.state,
        updatedAt: task.updatedAt,
      });
    }
  }
  return [...seen.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 24);
}

function artifactEntryFromStored(artifact: ManagerArtifact): ArtifactEntry {
  return {
    id: artifact.id,
    path: artifact.path,
    owner: artifact.owner,
    status: artifact.status,
    updatedAt: artifact.updatedAt,
    kind: artifact.kind,
    ...(artifact.note ? { note: artifact.note } : {}),
  };
}

function collectArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  const pattern =
    /(?:^|\s|["'`])([A-Za-z0-9_.~:/\\-]+(?:ORCHESTRATION|AGENTS|PROTOCOL|REVIEW|TASKS|STATE|FAILURES|PROJECT|README|CLAUDE)?[A-Za-z0-9_.~:/\\-]*\.(?:md|ts|tsx|js|jsx|json|css|html|ps1|py|yml|yaml))/gi;
  for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? "").replace(/[),.;:'"`\]]+$/g, "");
    if (value.length >= 4) paths.add(value);
  }
  return [...paths];
}

function taskResultPreview(result: unknown): string {
  if (result === undefined || result === null) return "";
  try {
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return clipBlock(text ?? "", 1800);
  } catch {
    return clipBlock(String(result), 1800);
  }
}

function statusTone(status: string | undefined): Tone {
  switch (status) {
    case "completed":
    case "succeeded":
      return "done";
    case "dispatching":
    case "running":
    case "collecting":
    case "reviewing":
    case "assigned":
    case "waiting":
    case "pending":
    case "waiting_for_device":
    case "restart_required":
      return "running";
    case "blocked":
    case "failed":
    case "cancelled":
    case "stale":
      return "blocked";
    default:
      return "neutral";
  }
}

function overviewTone(
  tone: ManagerProjectOverviewResponse["currentSignal"]["tone"] | undefined,
): Tone | undefined {
  switch (tone) {
    case "success":
      return "done";
    case "running":
      return "running";
    case "warning":
    case "error":
      return "blocked";
    case "idle":
      return "neutral";
    default:
      return undefined;
  }
}

function currentStateTone(tone: ManagerStateViewResponse["current"]["tone"] | undefined): Tone {
  switch (tone) {
    case "running":
      return "running";
    case "warning":
    case "error":
      return "blocked";
    case "idle":
      return "neutral";
    default:
      return "neutral";
  }
}

interface ProjectManagerStateScope {
  roundIds: Set<string>;
  agentIds: Set<string>;
  taskIds: Set<string>;
}

function projectManagerStateScope(
  project: ManagerProject | null | undefined,
  activeRound: ManagerRound | undefined,
  agents: ManagerAgent[],
): ProjectManagerStateScope | null {
  if (!project) return null;
  const roundIds = new Set<string>();
  const agentIds = new Set<string>();
  const taskIds = new Set<string>();
  if (project.activeRoundId) roundIds.add(project.activeRoundId);
  if (activeRound?.id) roundIds.add(activeRound.id);
  for (const agent of agents) {
    agentIds.add(agent.id);
    if (agent.roundId) roundIds.add(agent.roundId);
    if (agent.taskId) taskIds.add(agent.taskId);
  }
  return { roundIds, agentIds, taskIds };
}

function managerStateSignalMatchesProject(
  signal: { roundId?: string; agentId?: string; taskId?: string },
  scope: ProjectManagerStateScope,
): boolean {
  return Boolean(
    (signal.roundId && scope.roundIds.has(signal.roundId)) ||
      (signal.agentId && scope.agentIds.has(signal.agentId)) ||
      (signal.taskId && scope.taskIds.has(signal.taskId)),
  );
}

function roundHealthTone(status: ManagerRoundHealthGate["status"] | undefined): Tone {
  switch (status) {
    case "healthy":
      return "done";
    case "warning":
      return "running";
    case "blocked":
      return "blocked";
    default:
      return "neutral";
  }
}

function healthIssueActionLabel(issue: ManagerRoundHealthGate["issues"][number]): string {
  switch (issue.action) {
    case "retry-worker":
      return t("manager.orchestration.action.retry");
    case "inspect-worker":
      return t("manager.orchestration.action.inspect");
    case "repair-round":
      return t("manager.orchestration.action.repair");
    case "acknowledge":
      return t("manager.orchestration.action.acknowledge");
    default:
      return "";
  }
}
function hygieneTone(item: ManagerSessionHygieneItem): Tone {
  if (item.action === "cleanup") return "blocked";
  if (item.category === "current_manager") return "done";
  return "neutral";
}

function projectHygieneTone(issue: ManagerProjectHygieneIssue): Tone {
  if (issue.blockerId) return "done";
  if (issue.severity === "error") return "blocked";
  if (issue.protected || issue.severity === "warning") return "running";
  return "neutral";
}

function statusLabel(status: string | undefined): string {
  return status
    ? t(`manager.orchestration.status.${status}`)
    : t("manager.orchestration.status.unknown");
}
function workerRunResultLabel(run: ManagerWorkerRun): string {
  if (run.status === "missing") return t("manager.orchestration.result.missing-task");
  if (run.timedOut) return t("manager.orchestration.result.timeout");
  if (typeof run.exitCode === "number") {
    return run.durationMs
      ? t("manager.orchestration.result.exit-duration", {
          code: run.exitCode,
          duration: formatDuration(run.durationMs),
        })
      : t("manager.orchestration.result.exit", { code: run.exitCode });
  }
  if (run.durationMs) return formatDuration(run.durationMs);
  if (run.completedAt) return formatTime(run.completedAt);
  if (run.startedAt)
    return t("manager.orchestration.result.started", { time: formatTime(run.startedAt) });
  return "-";
}
function workerRunResultTitle(run: ManagerWorkerRun): string {
  return [
    run.command ? `${t("manager.orchestration.field.command")}: ${run.command}` : "",
    run.startedAt ? t("manager.orchestration.result.started", { time: run.startedAt }) : "",
    run.completedAt ? `${t("manager.orchestration.status.completed")}: ${run.completedAt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
function workerRunSignal(run: ManagerWorkerRun): string {
  const issues = run.integrity.filter((item) => item !== "ok");
  if (issues.length > 0) return issues.join(", ");
  if (run.error) return clip(run.error, 64);
  if (run.outputPreview) return clip(run.outputPreview, 64);
  return "ok";
}

function formatFreshness(state: ManagerStateViewResponse | null | undefined): string | undefined {
  if (!state?.freshness) return undefined;
  if (state.freshness.stale) return statusLabel("stale");
  if (typeof state.freshness.ageMs === "number") {
    return t("manager.orchestration.overview.last-update", {
      time: formatRelativeDuration(state.freshness.ageMs),
    });
  }
  return t("manager.orchestration.overview.last-update", { time: formatRelativeDuration(0) });
}
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function formatRelativeDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) return "now";
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatHygieneCategory(value: string): string {
  return t(`manager.orchestration.kind.${value}`);
}
function formatProjectHygieneKind(value: string): string {
  return t(`manager.orchestration.project-kind.${value}`);
}
function parseDecisionTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const chunk of value.split(/[,\s]+/)) {
    const tag = chunk.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function formatTime(value: string | undefined): string {
  if (!value) return "-";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(time));
}

function formatAssistantLedgerTime(value: string | undefined): string {
  return formatTime(value);
}

function projectIdFromAssistantReport(
  report: ManagerAssistantStatusReport | null | undefined,
): string | null {
  return firstAssistantReportMatch([report?.detail, report?.message], /\bproject_[A-Za-z0-9_-]+\b/);
}

function roundIdFromAssistantReport(
  report: ManagerAssistantStatusReport | null | undefined,
): string | null {
  return firstAssistantReportMatch(
    [report?.detail, report?.message, report?.round],
    /\bround_[A-Za-z0-9_-]+\b/,
  );
}

function firstAssistantReportMatch(
  values: Array<string | undefined>,
  pattern: RegExp,
): string | null {
  for (const value of values) {
    const match = value?.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}

function clip(value: string | undefined, max: number): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function clipBlock(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function mermaidText(value: string | undefined, max: number): string {
  const text = clip(value, max)
    .replace(/[\r\n]+/g, " ")
    .replace(/[#:;{}<>"'`|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || "-";
}

function shortId(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 8)}...`;
}
