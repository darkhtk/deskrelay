import type {
  ManagerAgent,
  ManagerRound,
  ManagerRoundReportResponse,
  ManagerSessionHygieneItem,
  ManagerSessionHygieneReport,
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
  standalone?: boolean | undefined;
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
  const agents = createMemo(() => {
    const round = activeRound();
    if (!round) return props.agents;
    const ids = new Set(round.agentIds);
    const linked = props.agents.filter((agent) => agent.roundId === round.id || ids.has(agent.id));
    return linked.length > 0 ? linked : props.agents;
  });
  const tasks = createMemo(() => props.report?.tasks ?? []);
  const timeline = createMemo(() => buildTimeline(activeRound(), agents(), tasks()));
  const artifacts = createMemo(() => buildArtifacts(agents(), tasks()));
  const totals = createMemo(() => summarizeTotals(agents()));

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
            class={`manager-status-dot manager-status-dot-${statusTone(activeRound()?.status)}`}
          />
          <strong>{activeRound()?.title ?? "Agent orchestration"}</strong>
          <Show when={activeRound()}>
            {(round) => <span class="manager-status-pill">{statusLabel(round().status)}</span>}
          </Show>
        </button>
        <div class="manager-orchestration-summary">
          <span>
            {totals().completed}/{totals().total} agents done
          </span>
          <span>running {totals().running}</span>
          <span>blocked {totals().blocked}</span>
        </div>
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
            <OverviewView round={activeRound()} agents={agents()} tasks={tasks()} />
          </OrchestrationSection>
          <OrchestrationSection title="Worker sequence" class="manager-section-sequence">
            <MermaidSequenceView round={activeRound()} agents={agents()} tasks={tasks()} />
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
            fallback={
              props.tasks.length > 0
                ? `${props.tasks.length} task records collected.`
                : "No active blocker detected."
            }
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

const MermaidSequenceView: Component<{
  round: ManagerRound | undefined;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
}> = (props) => {
  const source = createMemo(() =>
    buildWorkerSequenceDiagram(props.round, props.agents, props.tasks),
  );
  return (
    <div class="manager-mermaid-sequence">
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
      const result = await mermaid.render(`manager-sequence-${currentId}`, source);
      if (currentId !== renderId) return;
      setSvg(result.svg);
    } catch (err) {
      if (currentId !== renderId) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div class="manager-mermaid-render" aria-label="worker sequence diagram">
      <Show
        when={!error()}
        fallback={<p class="manager-orchestration-empty">Mermaid render failed: {error()}</p>}
      >
        <Show
          when={svg()}
          fallback={<p class="manager-orchestration-empty">Rendering worker sequence...</p>}
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
  return (
    rounds.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ?? rounds[0]
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

function buildWorkerSequenceDiagram(
  round: ManagerRound | undefined,
  agents: ManagerAgent[],
  tasks: ManagerTask[],
): string {
  const visibleAgents = agents.slice(0, 10);
  const lines = ["sequenceDiagram", "    autonumber", "    participant Manager as Manager"];
  for (const [index, agent] of visibleAgents.entries()) {
    lines.push(`    participant W${index + 1} as ${mermaidText(workerLabel(agent), 34)}`);
  }

  if (!round && visibleAgents.length === 0) {
    lines.push("    Note over Manager: No orchestration round is active yet");
    return lines.join("\n");
  }

  if (round) {
    lines.push(`    Note over Manager: ${mermaidText(round.title, 72)}`);
    if (round.objective) {
      lines.push(`    Note over Manager: ${mermaidText(round.objective, 96)}`);
    }
  }

  for (const [index, agent] of visibleAgents.entries()) {
    const alias = `W${index + 1}`;
    const task = tasks.find((candidate) => candidate.id === agent.taskId);
    const firstStep = task?.steps[0];
    const lastStep = task?.steps[task.steps.length - 1];
    const assignment =
      agent.lastInstruction ||
      firstStep?.summary ||
      task?.kind ||
      `status ${statusLabel(agent.status)}`;
    lines.push(`    Manager->>${alias}: ${mermaidText(assignment, 82)}`);
    lines.push(
      `    Note over ${alias}: ${mermaidText(
        `${agent.profile} · ${statusLabel(agent.status)} · ${formatTime(agent.updatedAt)}`,
        82,
      )}`,
    );
    if (lastStep) {
      lines.push(
        `    ${alias}-->>Manager: ${mermaidText(
          `${lastStep.label} · ${statusLabel(lastStep.status)} · ${lastStep.summary}`,
          92,
        )}`,
      );
    } else {
      lines.push(
        `    ${alias}-->>Manager: ${mermaidText(
          agent.lastError || agent.lastOutput || statusLabel(agent.status),
          92,
        )}`,
      );
    }
    if (["blocked", "failed", "stale"].includes(agent.status)) {
      lines.push(`    Manager-->>${alias}: ${mermaidText("needs review or recovery", 48)}`);
    }
  }

  const unassignedTasks = tasks.filter((task) => !agents.some((agent) => agent.taskId === task.id));
  for (const task of unassignedTasks.slice(0, 4)) {
    lines.push(
      `    Manager->>Manager: ${mermaidText(
        `${task.kind} · ${statusLabel(task.state)} · ${task.error || task.steps.at(-1)?.summary || ""}`,
        92,
      )}`,
    );
  }

  if (agents.length > visibleAgents.length) {
    lines.push(
      `    Note over Manager: ${agents.length - visibleAgents.length} more workers hidden`,
    );
  }
  if (round?.summary) {
    lines.push(`    Note over Manager: ${mermaidText(round.summary, 96)}`);
  }
  if (round?.error) {
    lines.push(`    Note over Manager: ${mermaidText(round.error, 96)}`);
  }

  return lines.join("\n");
}

function workerLabel(agent: ManagerAgent): string {
  return agent.label && agent.label !== agent.role ? `${agent.role} ${agent.label}` : agent.role;
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
    default:
      return status ?? "unknown";
  }
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
