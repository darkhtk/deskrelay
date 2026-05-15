import type {
  ManagerAgent,
  ManagerAssistantChatContext,
  ManagerRound,
  ManagerSessionHygieneReport,
} from "@deskrelay/shared";
import { type Component, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { type Device, api } from "../api.ts";
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

  const [orchestration] = createResource(
    () => refreshSeq(),
    async (): Promise<{ agents: ManagerAgent[]; rounds: ManagerRound[] } | null> => {
      try {
        const [agents, rounds] = await Promise.all([api.managerAgents(), api.managerRounds()]);
        return { agents: agents.agents, rounds: rounds.rounds };
      } catch {
        return null;
      }
    },
  );

  const [sessionHygiene, { refetch: refetchSessionHygiene }] = createResource(
    () => refreshSeq(),
    async (): Promise<ManagerSessionHygieneReport | null> => {
      try {
        return await api.managerSessionHygiene();
      } catch {
        return null;
      }
    },
  );

  const activeRound = createMemo(() => pickActiveRound(orchestration()?.rounds ?? []));
  const [activeRoundReport] = createResource(
    () => {
      const round = activeRound();
      const seq = refreshSeq();
      return round ? { id: round.id, seq } : null;
    },
    async (input) => {
      if (!input) return null;
      try {
        return await api.managerRoundReport(input.id);
      } catch {
        return null;
      }
    },
  );

  createEffect(() => {
    const timer = window.setInterval(() => setRefreshSeq((seq) => seq + 1), 5000);
    onCleanup(() => window.clearInterval(timer));
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

  return (
    <div
      class="manager-workspace"
      style={{ "--assistant-width": `${props.assistantWidth}px` }}
    >
      <section class="manager-workspace-board" aria-label="오케스트레이션 작업판">
        <ManagerOrchestrationPanel
          standalone
          rounds={orchestration()?.rounds ?? []}
          agents={orchestration()?.agents ?? []}
          report={activeRoundReport()}
          hygiene={sessionHygiene()}
          hygieneLoading={sessionHygiene.loading}
          hygieneCleanupBusy={hygieneCleanupBusy()}
          onRefreshHygiene={() => void refetchSessionHygiene()}
          onCleanupHygiene={() => void cleanupSessionHygiene()}
        />
      </section>
      <aside class="manager-workspace-assistant" aria-label="관리 Assistant">
        <div
          class="assistant-resize-handle"
          classList={{
            "is-dragging": props.assistantResizing,
            "will-close": props.assistantResizeWillClose,
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Assistant 창 크기 조절"
          tabIndex={0}
          onPointerDown={props.onAssistantResizePointerDown}
          onKeyDown={props.onAssistantResizeKeyDown}
        />
        <ManagerAssistant
          context={props.context}
          devices={props.devices ?? []}
          showOrchestrationPanel={false}
        />
      </aside>
    </div>
  );
};

function pickActiveRound(rounds: ManagerRound[]): ManagerRound | undefined {
  return (
    rounds.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ?? rounds[0]
  );
}
