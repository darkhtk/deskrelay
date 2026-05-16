import type {
  ManagerAgent,
  ManagerAssistantChatContext,
  ManagerRound,
  ManagerRoundHealthGateResponse,
  ManagerSessionHygieneReport,
  ManagerStateViewResponse,
  ManagerTaskObservationResponse,
  ManagerWorkerRunLedgerResponse,
} from "@deskrelay/shared";
import {
  type Component,
  type JSX,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { type Device, api } from "../api.ts";
import {
  createManagerEventSubscription,
  type ManagerEventConnectionState,
  isManagerOrchestrationEvent,
} from "../manager-events.ts";
import {
  readManagerOrchestrationCache,
  writeManagerOrchestrationCache,
} from "../manager-orchestration-cache.ts";
import { ManagerAssistant } from "./ManagerAssistant.tsx";
import { ManagerOrchestrationPanel } from "./ManagerOrchestrationPanel.tsx";

interface ManagerOrchestrationWorkspaceProps {
  context?: ManagerAssistantChatContext | null;
  devices?: Device[];
  assistantWidth: number;
  assistantResizing: boolean;
  assistantResizeWillClose: boolean;
  onAssistantResizePointerDown: (event: PointerEvent) => void;
  onAssistantResizeKeyDown: (event: KeyboardEvent) => void;
}

export const ManagerOrchestrationWorkspace: Component<ManagerOrchestrationWorkspaceProps> = (
  props,
) => {
  const [refreshSeq, setRefreshSeq] = createSignal(0);
  const [hygieneCleanupBusy, setHygieneCleanupBusy] = createSignal(false);
  const [acknowledgeBusy, setAcknowledgeBusy] = createSignal(false);
  const [managerActionBusy, setManagerActionBusy] = createSignal(false);
  const [observeBusy, setObserveBusy] = createSignal(false);
  const [observedTask, setObservedTask] = createSignal<ManagerTaskObservationResponse | null>(null);
  const [cachedSnapshot, setCachedSnapshot] = createSignal(readManagerOrchestrationCache());
  const [eventState, setEventState] = createSignal<ManagerEventConnectionState>("connecting");
  const [eventStateDetail, setEventStateDetail] = createSignal<string | null>(null);
  let eventRefreshTimer: number | undefined;

  const [orchestration] = createResource(
    () => refreshSeq(),
    async (): Promise<{ agents: ManagerAgent[]; rounds: ManagerRound[] } | null> => {
      try {
        const [agents, rounds] = await Promise.all([api.managerAgents(), api.managerRounds()]);
        const next = { agents: agents.agents, rounds: rounds.rounds };
        setCachedSnapshot(
          writeManagerOrchestrationCache(next) ?? {
            ...next,
            report: null,
            reportRoundId: null,
            roundHealth: null,
            roundHealthRoundId: null,
            workerRuns: null,
            workerRunsRoundId: null,
            hygiene: null,
            cachedAt: Date.now(),
          },
        );
        return next;
      } catch {
        return null;
      }
    },
  );

  const visibleOrchestration = createMemo(() => {
    const current = orchestration();
    if (current) return current;
    const cached = cachedSnapshot();
    return cached ? { agents: cached.agents, rounds: cached.rounds } : null;
  });

  const [sessionHygiene, { refetch: refetchSessionHygiene }] = createResource(
    () => refreshSeq(),
    async (): Promise<ManagerSessionHygieneReport | null> => {
      try {
        const hygiene = await api.managerSessionHygiene();
        setCachedSnapshot(writeManagerOrchestrationCache({ hygiene }) ?? cachedSnapshot());
        return hygiene;
      } catch {
        return null;
      }
    },
  );

  const [managerState, { mutate: mutateManagerState }] = createResource(
    () => refreshSeq(),
    async (): Promise<ManagerStateViewResponse | null> => {
      try {
        return await api.managerState();
      } catch {
        return null;
      }
    },
  );

  const visibleHygiene = createMemo(() => sessionHygiene() ?? cachedSnapshot()?.hygiene ?? null);
  const activeRound = createMemo(() => pickActiveRound(visibleOrchestration()?.rounds ?? []));
  const [activeRoundReport] = createResource(
    () => {
      const round = activeRound();
      const seq = refreshSeq();
      return round ? { id: round.id, seq } : null;
    },
    async (input) => {
      if (!input) return null;
      try {
        const report = await api.managerRoundReport(input.id);
        setCachedSnapshot(
          writeManagerOrchestrationCache({ report, reportRoundId: input.id }) ?? cachedSnapshot(),
        );
        return report;
      } catch {
        return null;
      }
    },
  );

  const visibleActiveRoundReport = createMemo(() => {
    const current = activeRoundReport();
    if (current) return current;
    const cached = cachedSnapshot();
    const round = activeRound();
    return cached?.reportRoundId && cached.reportRoundId === round?.id ? cached.report : null;
  });

  const [workerRuns] = createResource(
    () => {
      const round = activeRound();
      const seq = refreshSeq();
      return round ? { id: round.id, seq } : null;
    },
    async (input): Promise<ManagerWorkerRunLedgerResponse | null> => {
      if (!input) return null;
      try {
        const ledger = await api.managerRoundWorkerRuns(input.id);
        setCachedSnapshot(
          writeManagerOrchestrationCache({
            workerRuns: ledger,
            workerRunsRoundId: input.id,
          }) ?? cachedSnapshot(),
        );
        return ledger;
      } catch {
        return null;
      }
    },
  );

  const visibleWorkerRuns = createMemo(() => {
    const current = workerRuns();
    if (current) return current;
    const cached = cachedSnapshot();
    const round = activeRound();
    return cached?.workerRunsRoundId && cached.workerRunsRoundId === round?.id
      ? cached.workerRuns
      : null;
  });

  const [roundHealth] = createResource(
    () => {
      const round = activeRound();
      const seq = refreshSeq();
      return round ? { id: round.id, seq } : null;
    },
    async (input): Promise<ManagerRoundHealthGateResponse | null> => {
      if (!input) return null;
      try {
        const health = await api.managerRoundHealth(input.id);
        setCachedSnapshot(
          writeManagerOrchestrationCache({
            roundHealth: health,
            roundHealthRoundId: input.id,
          }) ?? cachedSnapshot(),
        );
        return health;
      } catch {
        return null;
      }
    },
  );

  const visibleRoundHealth = createMemo(() => {
    const current = roundHealth();
    if (current) return current;
    const cached = cachedSnapshot();
    const round = activeRound();
    return cached?.roundHealthRoundId && cached.roundHealthRoundId === round?.id
      ? cached.roundHealth
      : null;
  });

  const scheduleEventRefresh = (includeHygiene = false) => {
    if (eventRefreshTimer !== undefined) return;
    eventRefreshTimer = window.setTimeout(() => {
      eventRefreshTimer = undefined;
      setRefreshSeq((seq) => seq + 1);
      if (includeHygiene) void refetchSessionHygiene();
    }, 250);
  };

  createManagerEventSubscription({
    onEvent(event) {
      if (isManagerOrchestrationEvent(event)) {
        scheduleEventRefresh();
      } else if (event.type === "hygiene.updated") {
        scheduleEventRefresh(true);
      }
    },
    onState(state, detail) {
      setEventState(state);
      setEventStateDetail(detail ?? null);
    },
  });

  createEffect(() => {
    const timer = window.setInterval(() => setRefreshSeq((seq) => seq + 1), 30_000);
    onCleanup(() => window.clearInterval(timer));
  });

  onCleanup(() => {
    if (eventRefreshTimer !== undefined) window.clearTimeout(eventRefreshTimer);
  });

  async function cleanupSessionHygiene() {
    if (hygieneCleanupBusy()) return;
    setHygieneCleanupBusy(true);
    try {
      await api.cleanupManagerSessionHygiene();
      await refetchSessionHygiene();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setHygieneCleanupBusy(false);
    }
  }

  async function acknowledgeManagerFailures() {
    if (acknowledgeBusy()) return;
    setAcknowledgeBusy(true);
    try {
      await api.acknowledgeManagerState("cleared from orchestration workspace");
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } catch {
      // The assistant panel will keep showing the current blockers until the next successful refresh.
    } finally {
      setAcknowledgeBusy(false);
    }
  }

  async function refreshManagerStateNow() {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    try {
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function inspectManagerTask(taskId: string) {
    if (observeBusy()) return;
    setObserveBusy(true);
    try {
      setObservedTask(await api.managerTaskObservation(taskId));
    } finally {
      setObserveBusy(false);
    }
  }

  async function runUpdateAll() {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    try {
      const task = await api.managerUpdateAll({ requestedBy: "browser" });
      setObservedTask(await api.managerTaskObservation(task.id));
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function repairRegistration() {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    try {
      const task = await api.managerRegistrationRepair({ requestedBy: "browser" });
      setObservedTask(await api.managerTaskObservation(task.id));
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function retryManagerTask(taskId: string) {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    try {
      await api.retryManagerTask(taskId);
      const round = activeRound();
      if (round) await api.repairManagerRound(round.id);
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function repairManagerRound(roundId: string) {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    try {
      await api.repairManagerRound(roundId);
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function acknowledgeManagerRound(roundId: string) {
    if (acknowledgeBusy()) return;
    setAcknowledgeBusy(true);
    try {
      await api.acknowledgeManagerRound(roundId, "acknowledged from round health gate");
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setAcknowledgeBusy(false);
    }
  }

  async function cancelManagerTask(taskId: string) {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    try {
      await api.cancelManagerTask(taskId);
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setManagerActionBusy(false);
    }
  }

  return (
    <div
      class="manager-workspace"
      style={{ "--assistant-width": `${props.assistantWidth}px` } as JSX.CSSProperties}
    >
      <section class="manager-workspace-board" aria-label="Orchestration workspace">
        <ManagerOrchestrationPanel
          standalone
          rounds={visibleOrchestration()?.rounds ?? []}
          agents={visibleOrchestration()?.agents ?? []}
          report={visibleActiveRoundReport()}
          health={visibleRoundHealth()?.gate}
          workerRuns={visibleWorkerRuns()?.runs ?? []}
          hygiene={visibleHygiene()}
          state={managerState()}
          observedTask={observedTask()}
          eventState={eventState()}
          eventStateDetail={eventStateDetail()}
          observeBusy={observeBusy()}
          hygieneLoading={sessionHygiene.loading}
          hygieneCleanupBusy={hygieneCleanupBusy()}
          acknowledgeBusy={acknowledgeBusy()}
          actionBusy={managerActionBusy()}
          onRefreshHygiene={() => void refetchSessionHygiene()}
          onCleanupHygiene={() => void cleanupSessionHygiene()}
          onAcknowledgeFailures={() => void acknowledgeManagerFailures()}
          onAcknowledgeRound={(roundId) => void acknowledgeManagerRound(roundId)}
          onCancelTask={(taskId) => void cancelManagerTask(taskId)}
          onInspectTask={(taskId) => void inspectManagerTask(taskId)}
          onRepairRound={(roundId) => void repairManagerRound(roundId)}
          onRepairRegistration={() => void repairRegistration()}
          onRefreshState={() => void refreshManagerStateNow()}
          onRetryTask={(taskId) => void retryManagerTask(taskId)}
          onRunUpdateAll={() => void runUpdateAll()}
        />
      </section>
      <aside class="manager-workspace-assistant" aria-label="Manager Assistant">
        <div
          class="assistant-resize-handle"
          classList={{
            "is-dragging": props.assistantResizing,
            "will-close": props.assistantResizeWillClose,
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Assistant panel"
          tabIndex={0}
          onPointerDown={props.onAssistantResizePointerDown}
          onKeyDown={props.onAssistantResizeKeyDown}
        />
        <ManagerAssistant
          context={props.context ?? null}
          devices={props.devices ?? []}
          showOrchestrationPanel={false}
        />
      </aside>
    </div>
  );
};

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
