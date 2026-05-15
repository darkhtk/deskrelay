import type {
  ManagerAgent,
  ManagerRound,
  ManagerRoundReportResponse,
  ManagerSessionHygieneItem,
  ManagerSessionHygieneReport,
  ManagerStateViewResponse,
  ManagerTask,
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

type Tone = "neutral" | "running" | "done" | "blocked";

const HEIGHT_STORAGE_KEY = "cr.manager-orchestration-panel-height";
const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_HEIGHT = 160;
const MAX_PANEL_HEIGHT = 620;

interface ManagerOrchestrationPanelProps {
  rounds: ManagerRound[];
  agents: ManagerAgent[];
  report?: ManagerRoundReportResponse | null | undefined;
  hygiene?: ManagerSessionHygieneReport | null | undefined;
  hygieneLoading?: boolean | undefined;
  hygieneCleanupBusy?: boolean | undefined;
  state?: ManagerStateViewResponse | null | undefined;
  acknowledgeBusy?: boolean | undefined;
  actionBusy?: boolean | undefined;
  standalone?: boolean | undefined;
  onAcknowledgeFailures?: (() => void) | undefined;
  onCancelTask?: ((taskId: string) => void) | undefined;
  onRefreshState?: (() => void) | undefined;
  onRetryTask?: ((taskId: string) => void) | undefined;
  onRefreshHygiene?: (() => void) | undefined;
  onCleanupHygiene?: (() => void) | undefined;
}

interface TimelineEntry {
  at: string;
  label: string;
  detail?: string | undefined;
  tone: Tone;
}

interface ArtifactEntry {
  path: string;
  owner: string;
  status: string;
  updatedAt: string;
}

export const ManagerOrchestrationPanel: Component<ManagerOrchestrationPanelProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [panelHeight, setPanelHeight] = createSignal(readPanelHeight());
  let stopResize: (() => void) | undefined;
  const isExpanded = () => Boolean(props.standalone) || expanded();
  const activeRound = createMemo(() => pickActiveRound(props.rounds));
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
  const artifacts = createMemo(() => buildArtifacts(agents(), tasks()));
  const totals = createMemo(() => summarizeTotals(agents()));
  const currentState = createMemo(() => props.state?.current ?? null);
  const freshnessLabel = createMemo(() => formatFreshness(props.state));
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
          <span>running {totals().running}</span>
          <span>blocked {totals().blocked}</span>
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
          <OrchestrationSection title="Overview" class="manager-section-overview">
            <OverviewView
              round={activeRound()}
              agents={agents()}
              tasks={tasks()}
              hiddenAgentCount={hiddenAgentCount()}
            />
          </OrchestrationSection>
          <OrchestrationSection title="Current state" class="manager-section-current">
            <CurrentStateView
              state={props.state}
              busy={props.actionBusy || props.acknowledgeBusy}
              onAcknowledge={props.onAcknowledgeFailures}
              onCancelTask={props.onCancelTask}
              onRefresh={props.onRefreshState}
              onRetryTask={props.onRetryTask}
            />
          </OrchestrationSection>
          <OrchestrationSection title="Worker flow" class="manager-section-flow">
            <MermaidFlowView
              round={activeRound()}
              agents={agents()}
              tasks={tasks()}
              hiddenAgentCount={hiddenAgentCount()}
            />
          </OrchestrationSection>
          <OrchestrationSection title="Agents" class="manager-section-agents">
            <AgentsView agents={agents()} />
          </OrchestrationSection>
          <OrchestrationSection title="Timeline" class="manager-section-timeline">
            <TimelineView entries={timeline()} />
          </OrchestrationSection>
          <OrchestrationSection title="Artifacts" class="manager-section-artifacts">
            <ArtifactsView artifacts={artifacts()} />
          </OrchestrationSection>
          <OrchestrationSection title="Hygiene" class="manager-section-hygiene">
            <HygieneView
              report={props.hygiene}
              loading={props.hygieneLoading}
              cleanupBusy={props.hygieneCleanupBusy}
              onRefresh={props.onRefreshHygiene}
              onCleanup={props.onCleanupHygiene}
            />
          </OrchestrationSection>
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

const OverviewView: Component<{
  round: ManagerRound | undefined;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  hiddenAgentCount: number;
}> = (props) => {
  const totals = createMemo(() => summarizeTotals(props.agents));
  const blocker = createMemo(
    () =>
      props.agents.find((agent) => agent.status === "blocked" || agent.status === "failed") ?? null,
  );
  return (
    <div class="manager-overview-grid">
      <div class="manager-overview-main">
        <span class="manager-overview-label">Objective</span>
        <p>{props.round?.objective || "No round objective is available yet."}</p>
      </div>
      <div class="manager-overview-stat">
        <span>Agents</span>
        <strong>{totals().total}</strong>
      </div>
      <div class="manager-overview-stat">
        <span>Done</span>
        <strong>{totals().completed}</strong>
      </div>
      <div class="manager-overview-stat">
        <span>Running</span>
        <strong>{totals().running}</strong>
      </div>
      <div class="manager-overview-stat">
        <span>Blocked</span>
        <strong>{totals().blocked}</strong>
      </div>
      <div class="manager-overview-main">
        <span class="manager-overview-label">Current signal</span>
        <p>
          <Show
            when={blocker()}
            fallback={[
              props.tasks.length > 0
                ? `${props.tasks.length} task records collected.`
                : "No active blocker detected.",
              props.hiddenAgentCount > 0 ? `${props.hiddenAgentCount} quiet agents hidden.` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {(agent) =>
              `${agent().role} agent needs attention: ${
                agent().lastError || statusLabel(agent().status)
              }`
            }
          </Show>
        </p>
      </div>
    </div>
  );
};

const CurrentStateView: Component<{
  state: ManagerStateViewResponse | null | undefined;
  busy: boolean | undefined;
  onAcknowledge: (() => void) | undefined;
  onCancelTask: ((taskId: string) => void) | undefined;
  onRefresh: (() => void) | undefined;
  onRetryTask: ((taskId: string) => void) | undefined;
}> = (props) => {
  const current = createMemo(() => props.state?.current ?? null);
  const blockers = createMemo(() => props.state?.blockers ?? []);
  const taskId = createMemo(() => current()?.taskId);
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
            </div>
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

const AgentsView: Component<{ agents: ManagerAgent[] }> = (props) => (
  <div class="manager-agent-table" aria-label="orchestration agents">
    <div class="manager-agent-row manager-agent-row-head">
      <span>Role</span>
      <span>Status</span>
      <span>Current work</span>
      <span>Task</span>
    </div>
    <For each={props.agents}>
      {(agent) => (
        <div class="manager-agent-row">
          <span class="manager-agent-role">{agent.role}</span>
          <span class={`manager-agent-status manager-agent-status-${statusTone(agent.status)}`}>
            {statusLabel(agent.status)}
          </span>
          <span class="manager-agent-work" title={agent.lastOutput || agent.lastInstruction || ""}>
            {clip(agent.lastError || agent.lastOutput || agent.lastInstruction || "Idle", 120)}
          </span>
          <span class="manager-agent-task">{agent.taskId ? shortId(agent.taskId) : "-"}</span>
        </div>
      )}
    </For>
    <Show when={props.agents.length === 0}>
      <p class="manager-orchestration-empty">No agents yet.</p>
    </Show>
  </div>
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

const ArtifactsView: Component<{ artifacts: ArtifactEntry[] }> = (props) => (
  <div class="manager-artifact-list">
    <For each={props.artifacts}>
      {(artifact) => (
        <div class="manager-artifact-row">
          <span class="manager-artifact-path" title={artifact.path}>
            {artifact.path}
          </span>
          <span>{artifact.owner}</span>
          <span>{statusLabel(artifact.status)}</span>
          <time>{formatTime(artifact.updatedAt)}</time>
        </div>
      )}
    </For>
    <Show when={props.artifacts.length === 0}>
      <p class="manager-orchestration-empty">
        No artifact paths detected yet. File paths in worker output will appear here.
      </p>
    </Show>
  </div>
);

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

function formatFreshness(state: ManagerStateViewResponse | null | undefined): string | undefined {
  if (!state?.freshness) return undefined;
  if (state.freshness.stale) return "signal stale";
  if (typeof state.freshness.ageMs === "number") {
    return `updated ${formatRelativeDuration(state.freshness.ageMs)} ago`;
  }
  return "updated now";
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
