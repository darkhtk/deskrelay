import type {
  ManagerAgent,
  ManagerArtifact,
  ManagerArtifactUpdateRequest,
  ManagerBlocker,
  ManagerBlockerCreateRequest,
  ManagerBlockerResolveRequest,
  ManagerDecision,
  ManagerDecisionCreateRequest,
  ManagerDecisionUpdateRequest,
  ManagerProject,
  ManagerProjectCreateRequest,
  ManagerProjectOverviewResponse,
  ManagerProtocolState,
  ManagerProtocolUpdateRequest,
  ManagerRound,
  ManagerRoundHealthGate,
  ManagerRoundReportResponse,
  ManagerSessionHygieneItem,
  ManagerSessionHygieneReport,
  ManagerStateViewResponse,
  ManagerTask,
  ManagerTaskObservationResponse,
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
import type { ManagerEventConnectionState } from "../manager-events.ts";

type Tone = "neutral" | "running" | "done" | "blocked";

const HEIGHT_STORAGE_KEY = "cr.manager-orchestration-panel-height";
const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_HEIGHT = 160;
const MAX_PANEL_HEIGHT = 620;

interface ManagerOrchestrationPanelProps {
  projects?: ManagerProject[] | undefined;
  archivedProjects?: ManagerProject[] | undefined;
  selectedProject?: ManagerProject | null | undefined;
  projectOverview?: ManagerProjectOverviewResponse | null | undefined;
  projectLoading?: boolean | undefined;
  projectBusy?: boolean | undefined;
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
  hygiene?: ManagerSessionHygieneReport | null | undefined;
  hygieneLoading?: boolean | undefined;
  hygieneCleanupBusy?: boolean | undefined;
  state?: ManagerStateViewResponse | null | undefined;
  observedTask?: ManagerTaskObservationResponse | null | undefined;
  eventState?: ManagerEventConnectionState | undefined;
  eventStateDetail?: string | null | undefined;
  observeBusy?: boolean | undefined;
  acknowledgeBusy?: boolean | undefined;
  actionBusy?: boolean | undefined;
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
  onRefreshProjects?: (() => void) | undefined;
  onSelectProject?: ((projectId: string | null) => void) | undefined;
  onCreateProject?: ((input: ManagerProjectCreateRequest) => void) | undefined;
  onArchiveProject?: ((projectId: string) => void) | undefined;
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

type OrchestrationInfoTab =
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

const ORCHESTRATION_INFO_TABS: Array<{ id: OrchestrationInfoTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "state", label: "State" },
  { id: "decisions", label: "Decisions" },
  { id: "blockers", label: "Blockers" },
  { id: "graph", label: "Graph" },
  { id: "runs", label: "Runs" },
  { id: "artifacts", label: "Artifacts" },
  { id: "protocol", label: "Protocol" },
  { id: "timeline", label: "Timeline" },
  { id: "hygiene", label: "Hygiene" },
];

export const ManagerOrchestrationPanel: Component<ManagerOrchestrationPanelProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [panelHeight, setPanelHeight] = createSignal(readPanelHeight());
  const [activeTab, setActiveTab] = createSignal<OrchestrationInfoTab>("overview");
  let stopResize: (() => void) | undefined;
  const isExpanded = () => Boolean(props.standalone) || expanded();
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
  const freshnessLabel = createMemo(() => formatFreshness(props.state));
  const eventConnectionLabel = createMemo(() =>
    props.eventState && props.eventState !== "connected"
      ? `events ${props.eventState}${props.eventStateDetail ? `: ${props.eventStateDetail}` : ""}`
      : null,
  );
  const activeIssueCount = createMemo(
    () => props.state?.counts.blockers ?? props.state?.blockers.length ?? 0,
  );

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
        "manager-orchestration-panel-expanded": isExpanded(),
        "manager-orchestration-panel-standalone": Boolean(props.standalone),
      }}
      aria-label="orchestration progress"
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
          <span
            class={`manager-status-dot manager-status-dot-${currentStateTone(currentState()?.tone) ?? statusTone(activeRound()?.status)}`}
          />
          <strong>{currentState()?.title ?? activeRound()?.title ?? "Agent orchestration"}</strong>
          <Show when={currentState()} fallback={<RoundStatusPill round={activeRound()} />}>
            {(current) => <span class="manager-status-pill">{current().status}</span>}
          </Show>
        </button>
        <div class="manager-orchestration-summary">
          <Show
            when={props.state}
            fallback={
              <span>
                {totals().completed}/{totals().total} agents done
              </span>
            }
          >
            <span>{currentState()?.kind ?? "manager"}</span>
          </Show>
          <Show when={freshnessLabel()}>{(label) => <span>{label()}</span>}</Show>
          <Show when={eventConnectionLabel()}>{(label) => <span>{label()}</span>}</Show>
          <span>running {totals().running}</span>
          <span>blocked {totals().blocked}</span>
          <span>
            runs {runTotals().active}/{runTotals().total}
          </span>
        </div>
        <Show when={activeIssueCount() > 0 && Boolean(props.onAcknowledgeFailures)}>
          <button
            type="button"
            class="manager-orchestration-ack"
            disabled={props.acknowledgeBusy}
            onClick={() => props.onAcknowledgeFailures?.()}
            title="Keep the history but clear acknowledged failures from current state"
          >
            {props.acknowledgeBusy ? "Acknowledging" : "Acknowledge"}
          </button>
        </Show>
        <Show when={!props.standalone}>
          <button
            type="button"
            class="manager-orchestration-expand"
            aria-expanded={isExpanded()}
            onClick={() => setExpanded((current) => !current)}
          >
            {isExpanded() ? "Hide" : "Details"}
          </button>
        </Show>
      </header>

      <Show when={isExpanded()}>
        <div class="manager-orchestration-body">
          <ProjectHeader
            projects={props.projects ?? []}
            archivedProjects={props.archivedProjects ?? []}
            selectedProject={props.selectedProject ?? null}
            overview={props.projectOverview ?? null}
            activeRound={activeRound()}
            loading={props.projectLoading}
            busy={props.projectBusy}
            onRefresh={props.onRefreshProjects}
            onSelect={props.onSelectProject}
            onCreate={props.onCreateProject}
            onArchive={props.onArchiveProject}
          />
          <nav
            class="manager-orchestration-tabs"
            role="tablist"
            aria-label="Orchestration information"
          >
            <For each={ORCHESTRATION_INFO_TABS}>
              {(tab) => (
                <button
                  type="button"
                  role="tab"
                  class="manager-orchestration-tab"
                  classList={{ "is-active": activeTab() === tab.id }}
                  aria-selected={activeTab() === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </nav>
          <div
            class="manager-orchestration-tab-panel"
            classList={{
              "manager-orchestration-tab-panel-wide": activeTab() === "overview",
              "manager-orchestration-tab-panel-single": activeTab() !== "overview",
            }}
            role="tabpanel"
          >
            <Show when={activeTab() === "overview"}>
              <OrchestrationSection title="Command Center" class="manager-section-overview">
                <OverviewView
                  round={activeRound()}
                  overview={props.projectOverview ?? null}
                  agents={agents()}
                  tasks={tasks()}
                  blockers={props.blockers ?? []}
                  hiddenAgentCount={hiddenAgentCount()}
                />
              </OrchestrationSection>
              <OrchestrationSection title="Current state" class="manager-section-current">
                <CurrentStateView
                  state={props.state}
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
              <OrchestrationSection title="Blockers / Health" class="manager-section-health">
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

            <Show when={activeTab() === "agents"}>
              <OrchestrationSection title="Agent Theater" class="manager-section-agents">
                <AgentsView
                  agents={agents()}
                  busy={props.actionBusy || props.observeBusy}
                  onInspectTask={props.onInspectTask}
                />
              </OrchestrationSection>
            </Show>

            <Show when={activeTab() === "state"}>
              <OrchestrationSection title="Current state" class="manager-section-current">
                <CurrentStateView
                  state={props.state}
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
              <OrchestrationSection title="Blockers / Health" class="manager-section-health">
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
              <OrchestrationSection title="Decisions" class="manager-section-decisions">
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
              <OrchestrationSection title="Blockers" class="manager-section-blockers">
                <BlockersView
                  project={props.selectedProject ?? null}
                  blockers={props.blockers ?? []}
                  resolvedBlockers={props.resolvedBlockers ?? []}
                  busy={props.blockerBusy}
                  activeRoundId={activeRound()?.id}
                  onCreate={props.onCreateBlocker}
                  onResolve={props.onResolveBlocker}
                />
              </OrchestrationSection>
            </Show>

            <Show when={activeTab() === "graph"}>
              <OrchestrationSection title="Worker Graph" class="manager-section-flow">
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
                    title="Task observation"
                    class="manager-section-observation"
                  >
                    <TaskObservationView observation={observation()} busy={props.observeBusy} />
                  </OrchestrationSection>
                )}
              </Show>
              <OrchestrationSection title="Worker runs" class="manager-section-worker-runs">
                <WorkerRunsView
                  runs={props.workerRuns ?? []}
                  busy={props.observeBusy || props.actionBusy}
                  onInspectTask={props.onInspectTask}
                />
              </OrchestrationSection>
            </Show>

            <Show when={activeTab() === "artifacts"}>
              <OrchestrationSection title="Artifacts" class="manager-section-artifacts">
                <ArtifactsView
                  artifacts={artifacts()}
                  inactiveArtifacts={inactiveArtifacts()}
                  busy={props.artifactBusy}
                  stored={Boolean(props.artifacts && props.artifacts.length > 0)}
                  onScan={props.onScanArtifacts}
                  onUpdate={props.onUpdateArtifact}
                />
              </OrchestrationSection>
            </Show>

            <Show when={activeTab() === "protocol"}>
              <OrchestrationSection title="Protocol" class="manager-section-protocol">
                <ProtocolView
                  protocol={props.protocol ?? null}
                  busy={props.protocolBusy}
                  activeRoundId={activeRound()?.id}
                  decisions={props.decisions ?? []}
                  onScan={props.onScanProtocol}
                  onUpdate={props.onUpdateProtocol}
                />
              </OrchestrationSection>
            </Show>

            <Show when={activeTab() === "timeline"}>
              <OrchestrationSection title="Timeline" class="manager-section-timeline">
                <TimelineView entries={timeline()} />
              </OrchestrationSection>
            </Show>

            <Show when={activeTab() === "hygiene"}>
              <OrchestrationSection title="Session Hygiene" class="manager-section-hygiene">
                <HygieneView
                  report={props.hygiene}
                  loading={props.hygieneLoading}
                  cleanupBusy={props.hygieneCleanupBusy}
                  onRefresh={props.onRefreshHygiene}
                  onCleanup={props.onCleanupHygiene}
                />
              </OrchestrationSection>
            </Show>
          </div>
        </div>
        <Show when={!props.standalone}>
          <button
            type="button"
            class="manager-orchestration-resize-handle"
            aria-label="Resize orchestration panel"
            title="Resize height"
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

const ProjectHeader: Component<{
  projects: ManagerProject[];
  archivedProjects: ManagerProject[];
  selectedProject: ManagerProject | null;
  overview: ManagerProjectOverviewResponse | null;
  activeRound: ManagerRound | undefined;
  loading?: boolean | undefined;
  busy?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
  onSelect?: ((projectId: string | null) => void) | undefined;
  onCreate?: ((input: ManagerProjectCreateRequest) => void) | undefined;
  onArchive?: ((projectId: string) => void) | undefined;
}> = (props) => {
  const [creating, setCreating] = createSignal(false);
  const [name, setName] = createSignal("");
  const [cwd, setCwd] = createSignal("");
  const [goal, setGoal] = createSignal("");
  const projectOptions = createMemo(() => [...props.projects, ...props.archivedProjects]);
  const project = createMemo(() => props.selectedProject);
  const canCreate = createMemo(() => Boolean(cwd().trim() && props.onCreate && !props.busy));
  const submit = () => {
    const value = cwd().trim();
    if (!value || !props.onCreate) return;
    props.onCreate({
      cwd: value,
      ...(name().trim() ? { name: name().trim() } : {}),
      ...(goal().trim() ? { goal: goal().trim() } : {}),
      ...(props.activeRound?.id ? { activeRoundId: props.activeRound.id } : {}),
    });
    setCreating(false);
    setName("");
    setCwd("");
    setGoal("");
  };
  return (
    <section class="manager-project-header" aria-label="Manager project">
      <div class="manager-project-header-main">
        <div class="manager-project-selector-row">
          <span class="manager-project-label">Project</span>
          <select
            value={project()?.id ?? ""}
            disabled={props.busy || projectOptions().length === 0}
            onChange={(event) => props.onSelect?.(event.currentTarget.value || null)}
          >
            <option value="">No project selected</option>
            <For each={props.projects}>
              {(item) => <option value={item.id}>{item.name}</option>}
            </For>
            <For each={props.archivedProjects}>
              {(item) => <option value={item.id}>{item.name} (archived)</option>}
            </For>
          </select>
          <button
            type="button"
            disabled={props.busy}
            onClick={() => setCreating((value) => !value)}
          >
            {creating() ? "Cancel" : "New"}
          </button>
          <button
            type="button"
            disabled={props.busy || props.loading}
            onClick={() => props.onRefresh?.()}
          >
            {props.loading ? "Loading" : "Refresh"}
          </button>
          <Show when={Boolean(project() && project()?.status !== "archived" && props.onArchive)}>
            <button
              type="button"
              disabled={props.busy}
              onClick={() => {
                const current = project();
                if (current) props.onArchive?.(current.id);
              }}
            >
              Archive
            </button>
          </Show>
        </div>
        <Show
          when={project()}
          fallback={
            <p class="manager-project-summary">
              No project is pinned yet. Current rounds are still visible, but they are not grouped
              by project.
            </p>
          }
        >
          {(current) => (
            <p class="manager-project-summary">
              <strong>{current().name}</strong>
              <span>{current().status}</span>
              <span>{current().cwd}</span>
              <Show when={current().goal}>{(text) => <span>{text()}</span>}</Show>
              <Show when={current().activeRoundId}>
                {(roundId) => <span>round {shortId(roundId())}</span>}
              </Show>
              <Show when={props.overview?.nextAction}>
                {(action) => <span>{action().label}</span>}
              </Show>
            </p>
          )}
        </Show>
      </div>
      <Show when={creating()}>
        <form
          class="manager-project-create"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            type="text"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder="Project name"
          />
          <input
            type="text"
            value={cwd()}
            onInput={(event) => setCwd(event.currentTarget.value)}
            placeholder="C:\path\to\project"
            required
          />
          <input
            type="text"
            value={goal()}
            onInput={(event) => setGoal(event.currentTarget.value)}
            placeholder="Goal"
          />
          <button type="submit" disabled={!canCreate()}>
            Create
          </button>
        </form>
      </Show>
    </section>
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
    if (props.overview?.nextAction) return props.overview.nextAction.label;
    const projectBlocker = activeBlocker();
    if (projectBlocker) {
      if (projectBlocker.requiredAction === "user")
        return `User action needed: ${projectBlocker.title}`;
      if (projectBlocker.requiredAction === "worker")
        return `Assign worker recovery: ${projectBlocker.title}`;
      if (projectBlocker.requiredAction === "manager")
        return `Manager should resolve: ${projectBlocker.title}`;
      return `Track blocker: ${projectBlocker.title}`;
    }
    const blocked = blocker();
    if (blocked) {
      return blocked.taskId
        ? `Inspect ${blocked.role} and decide whether to retry task ${shortId(blocked.taskId)}.`
        : `Inspect ${blocked.role} and ask the manager for a recovery instruction.`;
    }
    if (totals().running > 0) {
      return "Watch for fresh worker signals and artifact updates before closing the round.";
    }
    if (props.tasks.some((task) => ["blocked", "failed"].includes(task.state))) {
      return "Review failed task evidence before starting another round.";
    }
    if (props.tasks.length > 0 || totals().completed > 0) {
      return "Review artifacts and ask the manager to summarize the round result.";
    }
    return "Dispatch agents or ask the manager to plan the next round.";
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
              (props.round ? statusLabel(props.round.status) : "no round")}
          </span>
          <Show when={lastUpdatedAt()}>
            {(updatedAt) => <time>last update {formatTime(updatedAt())}</time>}
          </Show>
        </div>
        <h3>{props.overview?.activeRound?.title ?? props.round?.title ?? "Agent orchestration"}</h3>
        <p>
          {props.overview?.currentSignal.detail ||
            props.round?.objective ||
            "No round objective is available yet."}
        </p>
      </div>
      <div class="manager-command-metrics" aria-label="orchestration metrics">
        <div class="manager-command-metric">
          <span>Agents</span>
          <strong>{counts()?.agents ?? totals().total}</strong>
        </div>
        <div class="manager-command-metric">
          <span>Done</span>
          <strong>{counts()?.completedAgents ?? totals().completed}</strong>
        </div>
        <div class="manager-command-metric">
          <span>Blocked</span>
          <strong>{props.blockers.length || counts()?.blockedAgents || totals().blocked}</strong>
        </div>
        <div class="manager-command-metric">
          <span>Artifacts</span>
          <strong>{counts()?.artifacts ?? artifacts().length}</strong>
        </div>
      </div>
      <div class="manager-command-decision">
        <div>
          <span class="manager-overview-label">Current signal</span>
          <p>
            {props.overview?.currentSignal.detail ||
              (activeBlocker()
                ? `${activeBlocker()?.severity}: ${activeBlocker()?.title}`
                : blocker()
                  ? `${blocker()?.role} agent needs attention: ${
                      blocker()?.lastError || statusLabel(blocker()?.status)
                    }`
                  : [
                      props.tasks.length > 0
                        ? `${props.tasks.length} task records collected.`
                        : "No active blocker detected.",
                      props.hiddenAgentCount > 0
                        ? `${props.hiddenAgentCount} quiet agents hidden.`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" "))}
          </p>
        </div>
        <div>
          <span class="manager-overview-label">Next action</span>
          <p>{nextAction()}</p>
        </div>
      </div>
    </div>
  );
};

const CurrentStateView: Component<{
  state: ManagerStateViewResponse | null | undefined;
  busy: boolean | undefined;
  onAcknowledge: (() => void) | undefined;
  onCancelTask: ((taskId: string) => void) | undefined;
  onInspectTask: ((taskId: string) => void) | undefined;
  onRepairRegistration: (() => void) | undefined;
  onRefresh: (() => void) | undefined;
  onRetryTask: ((taskId: string) => void) | undefined;
  onRunUpdateAll: (() => void) | undefined;
}> = (props) => {
  const current = createMemo(() => props.state?.current ?? null);
  const blockers = createMemo(() => props.state?.blockers ?? []);
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
        fallback={<p class="manager-orchestration-empty">No manager state is loaded yet.</p>}
      >
        {(item) => (
          <>
            <div class="manager-current-state-head">
              <span
                class={`manager-status-dot manager-status-dot-${currentStateTone(item().tone)}`}
              />
              <strong>{item().title}</strong>
              <span class="manager-status-pill">{item().status}</span>
            </div>
            <dl class="manager-current-state-grid">
              <div>
                <dt>Kind</dt>
                <dd>{item().kind}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{item().source}</dd>
              </div>
              <Show when={item().updatedAt}>
                {(updatedAt) => (
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatTime(updatedAt())}</dd>
                  </div>
                )}
              </Show>
              <Show when={props.state?.freshness}>
                {(freshness) => (
                  <div>
                    <dt>Signal</dt>
                    <dd>{freshness().stale ? "stale" : formatFreshness(props.state)}</dd>
                  </div>
                )}
              </Show>
            </dl>
            <Show when={item().detail}>
              {(detail) => <p class="manager-current-state-detail">{detail()}</p>}
            </Show>
            <div class="manager-current-state-ids">
              <Show when={item().roundId}>{(id) => <span>round {shortId(id())}</span>}</Show>
              <Show when={item().agentId}>{(id) => <span>agent {shortId(id())}</span>}</Show>
              <Show when={item().taskId}>{(id) => <span>task {shortId(id())}</span>}</Show>
            </div>
            <div class="manager-current-state-actions">
              <Show when={item().actions.includes("refresh") && props.onRefresh}>
                <button type="button" disabled={props.busy} onClick={() => props.onRefresh?.()}>
                  Refresh
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
                  Retry
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
                  Inspect
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
                  Cancel
                </button>
              </Show>
              <Show when={item().actions.includes("acknowledge") && props.onAcknowledge}>
                <button type="button" disabled={props.busy} onClick={() => props.onAcknowledge?.()}>
                  Acknowledge
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
                <span>{blocker.severity}</span>
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
    <div class="manager-round-health" aria-label="round health gate">
      <Show
        when={props.health}
        fallback={
          <p class="manager-orchestration-empty">
            No round health gate yet. Select or dispatch a round to verify worker evidence.
          </p>
        }
      >
        {(health) => (
          <>
            <div class="manager-round-health-head">
              <span
                class={`manager-status-dot manager-status-dot-${roundHealthTone(health().status)}`}
              />
              <strong>{health().status}</strong>
              <span>{health().summary}</span>
            </div>
            <dl class="manager-round-health-grid">
              <div>
                <dt>Expected</dt>
                <dd>
                  {health().expectedAgents} agents · {health().expectedTasks} tasks
                </dd>
              </div>
              <div>
                <dt>Runs</dt>
                <dd>
                  {health().completedRuns}/{health().actualRuns} complete
                </dd>
              </div>
              <div>
                <dt>Active</dt>
                <dd>
                  {health().runningRuns} running · {health().blockedRuns} blocked
                </dd>
              </div>
              <div>
                <dt>Missing</dt>
                <dd>{health().missingRuns}</dd>
              </div>
            </dl>
            <Show when={issues().length > 0}>
              <ul class="manager-round-health-issues">
                <For each={issues().slice(0, 6)}>
                  {(issue) => (
                    <li>
                      <span>{issue.severity}</span>
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
    <div class="manager-task-observation" aria-label="manager task observation">
      <div class="manager-task-observation-head">
        <span
          class={`manager-status-dot manager-status-dot-${statusTone(props.observation.task.state)}`}
        />
        <strong>{props.observation.summary}</strong>
        <span>{props.observation.terminal ? "terminal" : "active"}</span>
        <Show when={props.busy}>
          <span>loading</span>
        </Show>
      </div>
      <dl class="manager-task-observation-grid">
        <div>
          <dt>Task</dt>
          <dd>{shortId(props.observation.task.id)}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{props.observation.task.kind}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{props.observation.task.state}</dd>
        </div>
        <div>
          <dt>Next</dt>
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
                <span>{step.status}</span>
                <strong>{step.label}</strong>
                <Show when={step.summary}>{(summary) => <small>{summary()}</small>}</Show>
              </li>
            )}
          </For>
        </ol>
      </Show>
      <Show when={resultPreview()}>
        {(preview) => (
          <pre aria-label="task result preview" class="manager-task-observation-result">
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
  busy?: boolean | undefined;
  onInspectTask?: ((taskId: string) => void) | undefined;
}> = (props) => (
  <div class="manager-worker-runs" aria-label="worker run ledger">
    <div class="manager-worker-run-row manager-worker-run-row-head">
      <span>Worker</span>
      <span>Status</span>
      <span>Session</span>
      <span>Result</span>
      <span>Signal</span>
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
            <strong>{run.agentRole ?? run.agentLabel ?? run.profile ?? "worker"}</strong>
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
                ? `task ${shortId(run.taskId)}`
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
                Inspect
              </button>
            </Show>
          </span>
        </div>
      )}
    </For>
    <Show when={props.runs.length > 12}>
      <p class="manager-orchestration-empty">{props.runs.length - 12} older worker runs hidden.</p>
    </Show>
    <Show when={props.runs.length === 0}>
      <p class="manager-orchestration-empty">No worker runs recorded for this round yet.</p>
    </Show>
  </div>
);

const AgentsView: Component<{
  agents: ManagerAgent[];
  busy?: boolean | undefined;
  onInspectTask?: ((taskId: string) => void) | undefined;
}> = (props) => (
  <div class="manager-agent-table" aria-label="orchestration agents">
    <div class="manager-agent-row manager-agent-row-head">
      <span>Role</span>
      <span>Status</span>
      <span>Current task</span>
      <span>Last reply</span>
      <span>Action</span>
    </div>
    <For each={props.agents}>
      {(agent) => (
        <div class={`manager-agent-row manager-agent-row-${statusTone(agent.status)}`}>
          <span class="manager-agent-role" title={`${agent.label} · ${agent.profile}`}>
            {agent.role}
            <small>{clip(agent.profile, 28)}</small>
          </span>
          <span class={`manager-agent-status manager-agent-status-${statusTone(agent.status)}`}>
            {statusLabel(agent.status)}
          </span>
          <span class="manager-agent-task" title={agent.taskId ?? agent.lastInstruction ?? ""}>
            {agent.taskId
              ? `task ${shortId(agent.taskId)}`
              : clip(agent.lastInstruction, 68) || "-"}
          </span>
          <span
            class="manager-agent-work"
            title={agent.lastError || agent.lastOutput || agent.lastInstruction || ""}
          >
            {clip(
              agent.lastError || agent.lastOutput || agent.lastInstruction || "No reply yet",
              92,
            )}
            <time>{formatTime(agent.lastOutputAt ?? agent.updatedAt)}</time>
          </span>
          <span class="manager-agent-action">
            <Show when={agent.taskId} fallback={<span>-</span>}>
              {(taskId) => (
                <button
                  type="button"
                  disabled={props.busy || !props.onInspectTask}
                  onClick={() => props.onInspectTask?.(taskId())}
                >
                  Inspect
                </button>
              )}
            </Show>
          </span>
        </div>
      )}
    </For>
    <Show when={props.agents.length === 0}>
      <p class="manager-orchestration-empty">No agents yet.</p>
    </Show>
  </div>
);

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
        <p class="manager-orchestration-empty">
          Capture decisions that explain why the manager chose a protocol, role split, or recovery
          path.
        </p>
        <button
          type="button"
          disabled={!props.project || props.busy || !props.onCreate}
          onClick={() => setCreating((value) => !value)}
        >
          {creating() ? "Cancel" : "Record decision"}
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
            placeholder="Decision title"
          />
          <textarea
            value={detail()}
            onInput={(event) => setDetail(event.currentTarget.value)}
            placeholder="What was decided, and what should future agents remember?"
            rows={4}
          />
          <input
            type="text"
            value={tags()}
            onInput={(event) => setTags(event.currentTarget.value)}
            placeholder="tags: protocol, verification"
          />
          <button type="submit" disabled={!canCreate()}>
            Save decision
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
          <p class="manager-orchestration-empty">No active project decisions recorded yet.</p>
        </Show>
      </div>

      <Show when={props.archivedDecisions.length > 0}>
        <details class="manager-decision-archive">
          <summary>Archived decisions ({props.archivedDecisions.length})</summary>
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
        <span>{props.decision.status}</span>
        <time>{formatTime(props.decision.updatedAt)}</time>
        <Show when={props.decision.roundId}>
          {(roundId) => <span>round {shortId(roundId())}</span>}
        </Show>
        <Show when={props.decision.revisions.length > 0}>
          <span>{props.decision.revisions.length} revisions</span>
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
          Supersede
        </button>
      </Show>
      <Show when={props.decision.status !== "archived"}>
        <button
          type="button"
          disabled={props.busy || !props.onUpdate}
          onClick={() => props.onUpdate?.(props.decision.id, { status: "archived" })}
        >
          Archive
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
      <div class="manager-blocker-toolbar">
        <p class="manager-orchestration-empty">
          Record only actionable blockers. Transient daemon/network noise should stay diagnostic
          until it needs a clear owner.
        </p>
        <button
          type="button"
          disabled={!props.project || props.busy || !props.onCreate}
          onClick={() => setCreating((value) => !value)}
        >
          {creating() ? "Cancel" : "Record blocker"}
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
            placeholder="Blocker title"
          />
          <textarea
            value={detail()}
            onInput={(event) => setDetail(event.currentTarget.value)}
            placeholder="What is blocked, what evidence exists, and what action is required?"
            rows={4}
          />
          <select
            value={severity()}
            onChange={(event) =>
              setSeverity(event.currentTarget.value as ManagerBlocker["severity"])
            }
          >
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
          </select>
          <select
            value={requiredAction()}
            onChange={(event) =>
              setRequiredAction(event.currentTarget.value as ManagerBlocker["requiredAction"])
            }
          >
            <option value="manager">manager action</option>
            <option value="worker">worker action</option>
            <option value="user">user action</option>
            <option value="none">track only</option>
          </select>
          <input
            type="text"
            value={owner()}
            onInput={(event) => setOwner(event.currentTarget.value)}
            placeholder="owner"
          />
          <input
            type="text"
            value={dedupeKey()}
            onInput={(event) => setDedupeKey(event.currentTarget.value)}
            placeholder="dedupe key"
          />
          <button type="submit" disabled={!canCreate()}>
            Save blocker
          </button>
        </form>
      </Show>

      <div class="manager-blocker-list">
        <For each={props.blockers}>
          {(blocker) => (
            <BlockerRow blocker={blocker} busy={props.busy} onResolve={props.onResolve} />
          )}
        </For>
        <Show when={props.blockers.length === 0}>
          <p class="manager-orchestration-empty">No active project blockers.</p>
        </Show>
      </div>

      <Show when={props.resolvedBlockers.length > 0}>
        <details class="manager-blocker-resolved">
          <summary>Resolved blockers ({props.resolvedBlockers.length})</summary>
          <For each={props.resolvedBlockers.slice(0, 8)}>
            {(blocker) => (
              <BlockerRow blocker={blocker} busy={props.busy} onResolve={props.onResolve} />
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
}> = (props) => (
  <article
    class={`manager-blocker-row manager-blocker-row-${props.blocker.severity} manager-blocker-row-${props.blocker.status}`}
  >
    <div class="manager-blocker-row-main">
      <strong>{props.blocker.title}</strong>
      <Show when={props.blocker.detail}>{(detail) => <p>{detail()}</p>}</Show>
      <div class="manager-blocker-meta">
        <span>{props.blocker.severity}</span>
        <span>{props.blocker.requiredAction}</span>
        <span>owner {props.blocker.owner}</span>
        <time>{formatTime(props.blocker.updatedAt)}</time>
        <Show when={props.blocker.roundId}>
          {(roundId) => <span>round {shortId(roundId())}</span>}
        </Show>
        <Show when={props.blocker.dedupeKey}>
          {(key) => <span title={key()}>key {clip(key(), 32)}</span>}
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
              resolution: "Resolved from workbench.",
            })
          }
        >
          Resolve
        </button>
        <button
          type="button"
          disabled={props.busy || !props.onResolve}
          onClick={() =>
            props.onResolve?.(props.blocker.id, {
              status: "dismissed",
              resolution: "Dismissed from workbench.",
            })
          }
        >
          Dismiss
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
      <li class="manager-orchestration-empty">No events yet.</li>
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
      <MermaidDiagram source={source()} />
      <details class="manager-mermaid-source">
        <summary>Mermaid source</summary>
        <pre>{source()}</pre>
      </details>
    </div>
  );
};

const MermaidDiagram: Component<{ source: string }> = (props) => {
  const [svg, setSvg] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
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
      const result = await mermaid.render(`manager-flow-${currentId}`, source);
      if (currentId !== renderId) return;
      setSvg(result.svg);
    } catch (err) {
      if (currentId !== renderId) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div class="manager-mermaid-render" aria-label="worker flow diagram">
      <Show
        when={!error()}
        fallback={<p class="manager-orchestration-empty">Mermaid render failed: {error()}</p>}
      >
        <Show
          when={svg()}
          fallback={<p class="manager-orchestration-empty">Rendering worker flow...</p>}
        >
          {(html) => <div class="manager-mermaid-svg" innerHTML={html()} />}
        </Show>
      </Show>
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
}> = (props) => (
  <div class="manager-artifact-list">
    <div class="manager-artifact-toolbar">
      <p>
        {props.stored
          ? "Stored project artifacts."
          : "Derived from recent worker output until the project is scanned."}
      </p>
      <button type="button" disabled={props.busy} onClick={() => props.onScan?.()}>
        {props.busy ? "Scanning..." : "Scan artifacts"}
      </button>
    </div>
    <div class="manager-artifact-row manager-artifact-row-head">
      <span>File</span>
      <span>Owner</span>
      <span>Kind</span>
      <span>Status</span>
      <span>Updated</span>
      <span>Action</span>
    </div>
    <For each={props.artifacts}>
      {(artifact) => (
        <div class="manager-artifact-row">
          <span class="manager-artifact-path" title={artifact.path}>
            {artifact.path}
          </span>
          <span>{artifact.owner}</span>
          <span>{artifact.kind ?? "unknown"}</span>
          <span>{statusLabel(artifact.status)}</span>
          <time>{formatTime(artifact.updatedAt)}</time>
          <span>
            <Show when={artifact.id}>
              {(id) => (
                <button
                  type="button"
                  class="manager-artifact-action"
                  disabled={props.busy}
                  onClick={() => props.onUpdate?.(id(), { status: "obsolete" })}
                >
                  Obsolete
                </button>
              )}
            </Show>
          </span>
        </div>
      )}
    </For>
    <Show when={props.artifacts.length === 0}>
      <p class="manager-orchestration-empty">
        No artifact paths detected yet. Scan after worker output references files.
      </p>
    </Show>
    <Show when={(props.inactiveArtifacts?.length ?? 0) > 0}>
      <details class="manager-artifact-inactive">
        <summary>Inactive artifacts ({props.inactiveArtifacts?.length ?? 0})</summary>
        <For each={props.inactiveArtifacts ?? []}>
          {(artifact) => (
            <div class="manager-artifact-row">
              <span class="manager-artifact-path" title={artifact.path}>
                {artifact.path}
              </span>
              <span>{artifact.owner}</span>
              <span>{artifact.kind ?? "unknown"}</span>
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
                      Active
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

const ProtocolView: Component<{
  protocol: ManagerProtocolState | null;
  busy?: boolean | undefined;
  activeRoundId?: string | undefined;
  decisions: ManagerDecision[];
  onScan?: (() => void) | undefined;
  onUpdate?: ((input: ManagerProtocolUpdateRequest) => void) | undefined;
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
      <div class="manager-artifact-toolbar">
        <p>
          {props.protocol
            ? `${presentCount()}/${props.protocol.files.length} core files present · ${props.protocol.version}`
            : "No protocol scan has loaded yet."}
        </p>
        <button type="button" disabled={props.busy} onClick={() => props.onScan?.()}>
          {props.busy ? "Scanning..." : "Scan protocol"}
        </button>
      </div>
      <Show when={(props.protocol?.warnings.length ?? 0) > 0}>
        <ul class="manager-protocol-warnings">
          <For each={props.protocol?.warnings ?? []}>{(warning) => <li>{warning}</li>}</For>
        </ul>
      </Show>
      <div class="manager-protocol-editor">
        <label>
          <span>Version</span>
          <input
            type="text"
            value={version()}
            disabled={props.busy}
            onInput={(event) => setVersion(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Active rules</span>
          <textarea
            value={activeRules()}
            disabled={props.busy}
            rows={4}
            onInput={(event) => setActiveRules(event.currentTarget.value)}
            placeholder="One pinned rule per line"
          />
        </label>
        <label>
          <span>Latest change</span>
          <input
            type="text"
            value={changeSummary()}
            disabled={props.busy}
            onInput={(event) => setChangeSummary(event.currentTarget.value)}
            placeholder="What changed and why"
          />
        </label>
        <div class="manager-protocol-change-row">
          <label>
            <span>Decision</span>
            <select
              value={changeDecisionId()}
              disabled={props.busy}
              onChange={(event) => setChangeDecisionId(event.currentTarget.value)}
            >
              <option value="">No linked decision</option>
              <For each={props.decisions.filter((decision) => decision.status === "active")}>
                {(decision) => <option value={decision.id}>{decision.title}</option>}
              </For>
            </select>
          </label>
          <label>
            <span>Round</span>
            <input
              type="text"
              value={changeRoundId()}
              disabled={props.busy}
              onInput={(event) => setChangeRoundId(event.currentTarget.value)}
              placeholder="round id"
            />
          </label>
        </div>
        <div class="manager-protocol-actions">
          <button type="button" disabled={props.busy || !props.onUpdate} onClick={save}>
            Save protocol state
          </button>
          <button
            type="button"
            disabled={props.busy || !props.onUpdate}
            onClick={() => props.onUpdate?.({ latestChange: null })}
          >
            Clear change
          </button>
        </div>
      </div>
      <div class="manager-artifact-row manager-artifact-row-head">
        <span>File</span>
        <span>Role</span>
        <span>Status</span>
        <span>Updated</span>
        <span>Evidence</span>
        <span>Note</span>
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
                    <summary>excerpt</summary>
                    <pre>{excerpt()}</pre>
                  </details>
                )}
              </Show>
            </span>
            <span>{file.error ?? (file.sizeBytes ? `${file.sizeBytes} bytes` : "")}</span>
          </div>
        )}
      </For>
      <Show when={!props.protocol}>
        <p class="manager-orchestration-empty">Select a project to scan protocol files.</p>
      </Show>
    </div>
  );
};

const HygieneView: Component<{
  report?: ManagerSessionHygieneReport | null | undefined;
  loading?: boolean | undefined;
  cleanupBusy?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
  onCleanup?: (() => void) | undefined;
}> = (props) => {
  const cleanupItems = createMemo(() =>
    (props.report?.items ?? []).filter((item) => item.action === "cleanup"),
  );
  const visibleItems = createMemo(() => [
    ...cleanupItems(),
    ...(props.report?.items ?? []).filter((item) => item.action !== "cleanup"),
  ]);
  return (
    <div class="manager-hygiene">
      <div class="manager-hygiene-head">
        <div>
          <span class="manager-overview-label">Session hygiene</span>
          <p>
            <Show
              when={props.report}
              fallback={props.loading ? "Scanning manager sessions..." : "No hygiene report yet."}
            >
              {(report) =>
                `${report().summary.cleanupCandidates} cleanup candidates · ${report().summary.preserved} preserved`
              }
            </Show>
          </p>
        </div>
        <div class="manager-hygiene-actions">
          <button type="button" onClick={() => props.onRefresh?.()} disabled={props.loading}>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => props.onCleanup?.()}
            disabled={props.cleanupBusy || cleanupItems().length === 0}
          >
            {props.cleanupBusy ? "Cleaning..." : "Safe cleanup"}
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
          <p class="manager-orchestration-empty">No manager sessions were found.</p>
        </Show>
      </div>
    </div>
  );
};

const HygieneItemRow: Component<{ item: ManagerSessionHygieneItem }> = (props) => (
  <div class="manager-hygiene-row">
    <span class={`manager-agent-status manager-agent-status-${hygieneTone(props.item)}`}>
      {props.item.action === "cleanup" ? "cleanup" : "keep"}
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
    `    R["${mermaidText(round?.title ?? "Agent orchestration", 68)}"]:::${statusTone(round?.status)}`,
    `    O["${mermaidText(round?.objective || "No objective recorded", 84)}"]:::neutral`,
    '    D["Dispatch workers"]:::running',
    '    C["Collect results"]:::neutral',
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
    lines.push(`    H["${hiddenCount} quiet workers hidden"]:::neutral`);
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

function currentFlowSignal(agents: ManagerAgent[], tasks: ManagerTask[]): string {
  const blockedAgent = agents.find((agent) =>
    ["blocked", "failed", "stale"].includes(agent.status),
  );
  if (blockedAgent) return `${blockedAgent.role} needs attention`;
  const activeCount = agents.filter((agent) =>
    ["assigned", "running", "waiting"].includes(agent.status),
  ).length;
  if (activeCount > 0) return `${activeCount} workers running`;
  const blockedTask = tasks.find((task) => ["blocked", "failed"].includes(task.state));
  if (blockedTask) return `${blockedTask.kind} ${statusLabel(blockedTask.state)}`;
  return agents.length > 0 ? `${agents.length} worker records visible` : "No active worker signal";
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
      label: `${round.title} created`,
      detail: round.objective,
      tone: "neutral",
    });
    if (round.startedAt) {
      entries.push({
        at: round.startedAt,
        label: "Round started",
        detail: statusLabel(round.status),
        tone: "running",
      });
    }
    if (round.completedAt) {
      entries.push({
        at: round.completedAt,
        label: "Round finished",
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
      label: `task ${shortId(task.id)} ${statusLabel(task.state)}`,
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
    /(?:^|\s|["'`])([A-Za-z0-9_.~:/\\-]+(?:ORCHESTRATION|AGENTS|PROTOCOL|LOCKS|TASKS|STATE|FAILURES|PROJECT|README|CLAUDE)?[A-Za-z0-9_.~:/\\-]*\.(?:md|ts|tsx|js|jsx|json|css|html|ps1|py|yml|yaml))/gi;
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
      return "Retry";
    case "inspect-worker":
      return "Inspect";
    case "repair-round":
      return "Repair";
    case "acknowledge":
      return "Acknowledge";
    default:
      return "";
  }
}

function hygieneTone(item: ManagerSessionHygieneItem): Tone {
  if (item.action === "cleanup") return "blocked";
  if (item.category === "current_manager") return "done";
  return "neutral";
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "planned":
      return "planned";
    case "dispatching":
      return "dispatching";
    case "running":
      return "running";
    case "collecting":
      return "collecting";
    case "reviewing":
      return "reviewing";
    case "completed":
      return "completed";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "idle":
      return "idle";
    case "assigned":
      return "assigned";
    case "waiting":
      return "waiting";
    case "stale":
      return "stale";
    case "pending":
      return "pending";
    case "waiting_for_device":
      return "waiting for device";
    case "restart_required":
      return "restart required";
    case "succeeded":
      return "succeeded";
    case "acknowledged":
      return "acknowledged";
    default:
      return status ?? "unknown";
  }
}

function workerRunResultLabel(run: ManagerWorkerRun): string {
  if (run.status === "missing") return "missing task";
  if (run.timedOut) return "timeout";
  if (typeof run.exitCode === "number") {
    return `exit ${run.exitCode}${run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ""}`;
  }
  if (run.durationMs) return formatDuration(run.durationMs);
  if (run.completedAt) return formatTime(run.completedAt);
  if (run.startedAt) return `started ${formatTime(run.startedAt)}`;
  return "-";
}

function workerRunResultTitle(run: ManagerWorkerRun): string {
  return [
    run.command ? `command: ${run.command}` : "",
    run.startedAt ? `started: ${run.startedAt}` : "",
    run.completedAt ? `completed: ${run.completedAt}` : "",
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
  if (state.freshness.stale) return "signal stale";
  if (typeof state.freshness.ageMs === "number") {
    return `updated ${formatRelativeDuration(state.freshness.ageMs)} ago`;
  }
  return "updated now";
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
  switch (value) {
    case "current_manager":
      return "Current manager";
    case "manager_history":
      return "Manager history";
    case "internal_only":
      return "Internal only";
    case "worker_session":
      return "Worker";
    case "orphan":
      return "Orphan";
    case "unreadable":
      return "Unreadable";
    default:
      return value;
  }
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
