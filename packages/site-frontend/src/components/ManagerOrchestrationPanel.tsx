import type {
  ManagerAgent,
  ManagerRound,
  ManagerRoundReportResponse,
  ManagerTask,
} from "@deskrelay/shared";
import { type Component, For, Show, createMemo, createSignal } from "solid-js";

type OrchestrationTab = "overview" | "agents" | "timeline" | "graph" | "artifacts";
type Tone = "neutral" | "running" | "done" | "blocked";

interface ManagerOrchestrationPanelProps {
  rounds: ManagerRound[];
  agents: ManagerAgent[];
  report?: ManagerRoundReportResponse | null | undefined;
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

const ORCHESTRATION_TABS: Array<{ id: OrchestrationTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "timeline", label: "Timeline" },
  { id: "graph", label: "Graph" },
  { id: "artifacts", label: "Artifacts" },
];

export const ManagerOrchestrationPanel: Component<ManagerOrchestrationPanelProps> = (props) => {
  const [tab, setTab] = createSignal<OrchestrationTab>("overview");
  const [expanded, setExpanded] = createSignal(false);
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
  const mermaid = createMemo(() => buildMermaid(activeRound(), agents()));
  const totals = createMemo(() => summarizeTotals(agents()));

  return (
    <section
      class="manager-orchestration-panel"
      classList={{ "manager-orchestration-panel-expanded": expanded() }}
      aria-label="orchestration progress"
    >
      <header class="manager-orchestration-panel-head">
        <button
          type="button"
          class="manager-orchestration-title"
          aria-expanded={expanded()}
          onClick={() => setExpanded((current) => !current)}
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
        <button
          type="button"
          class="manager-orchestration-expand"
          aria-expanded={expanded()}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded() ? "Hide" : "Details"}
        </button>
      </header>

      <Show when={expanded()}>
        <nav class="manager-orchestration-tabs" aria-label="orchestration views">
          <For each={ORCHESTRATION_TABS}>
            {(item) => (
              <button
                type="button"
                class="manager-orchestration-tab"
                classList={{ "manager-orchestration-tab-active": tab() === item.id }}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>

        <div class="manager-orchestration-body">
          <Show when={tab() === "overview"}>
            <OverviewView round={activeRound()} agents={agents()} tasks={tasks()} />
          </Show>
          <Show when={tab() === "agents"}>
            <AgentsView agents={agents()} />
          </Show>
          <Show when={tab() === "timeline"}>
            <TimelineView entries={timeline()} />
          </Show>
          <Show when={tab() === "graph"}>
            <GraphView mermaid={mermaid()} agents={agents()} />
          </Show>
          <Show when={tab() === "artifacts"}>
            <ArtifactsView artifacts={artifacts()} />
          </Show>
        </div>
      </Show>
    </section>
  );
};

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

const GraphView: Component<{ mermaid: string; agents: ManagerAgent[] }> = (props) => (
  <div class="manager-graph-layout">
    <div class="manager-graph-preview" aria-label="agent graph preview">
      <div class="manager-graph-node manager-graph-manager">Manager</div>
      <For each={props.agents.slice(0, 8)}>
        {(agent) => (
          <div class={`manager-graph-node manager-graph-node-${statusTone(agent.status)}`}>
            <strong>{agent.role}</strong>
            <span>{statusLabel(agent.status)}</span>
          </div>
        )}
      </For>
    </div>
    <pre class="manager-mermaid-source">
      <code>{props.mermaid}</code>
    </pre>
  </div>
);

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

function pickActiveRound(rounds: ManagerRound[]): ManagerRound | undefined {
  return (
    rounds.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ?? rounds[0]
  );
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

function buildMermaid(round: ManagerRound | undefined, agents: ManagerAgent[]): string {
  const lines = ["flowchart TD", '  Manager["Manager Supervisor"]'];
  if (round) lines.push(`  Round["${escapeMermaid(round.title)}\\n${statusLabel(round.status)}"]`);
  if (round) lines.push("  Manager --> Round");
  const graphAgents = agents.slice(0, 12);
  for (const [index, agent] of graphAgents.entries()) {
    const id = `A${index}`;
    lines.push(`  ${id}["${escapeMermaid(agent.role)}\\n${statusLabel(agent.status)}"]`);
    lines.push(round ? `  Round --> ${id}` : `  Manager --> ${id}`);
  }
  lines.push(
    "  classDef done fill:#d8f3dc,stroke:#2d6a4f,color:#111",
    "  classDef running fill:#fff3bf,stroke:#f08c00,color:#111",
    "  classDef blocked fill:#ffe3e3,stroke:#c92a2a,color:#111",
    "  classDef neutral fill:#f1f3f5,stroke:#868e96,color:#111",
  );
  const groups = new Map<string, string[]>();
  for (const [index, agent] of graphAgents.entries()) {
    const tone = statusTone(agent.status);
    const className = tone === "done" ? "done" : tone === "blocked" ? "blocked" : tone;
    groups.set(className, [...(groups.get(className) ?? []), `A${index}`]);
  }
  for (const [className, ids] of groups) lines.push(`  class ${ids.join(",")} ${className}`);
  return lines.join("\n");
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

function shortId(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 8)}...`;
}

function escapeMermaid(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}
