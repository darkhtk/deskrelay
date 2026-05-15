import type {
  ManagerAgent,
  ManagerAssistantChatContext,
  ManagerRound,
  ManagerSessionHygieneReport,
} from "@deskrelay/shared";
import {
  type Component,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  type ClaudeSessionSummary,
  type ClaudeSessionTranscript,
  type ClaudeStreamEvent,
  type Device,
  type ManagerAssistantStatusReport,
  type ManagerAssistantStatusReportResponse,
  type ManagerStateViewResponse,
  api,
} from "../api.ts";
import {
  claudeEventForTranscript,
  describeCliActionFromClaudeEvent,
} from "../claude/cli-action.ts";
import { deviceDisplayName, deviceDisplayRole } from "../device-display.ts";
import { createManagerEventSubscription, isManagerOrchestrationEvent } from "../manager-events.ts";
import {
  readManagerOrchestrationCache,
  writeManagerOrchestrationCache,
} from "../manager-orchestration-cache.ts";
import { Composer } from "./Composer.tsx";
import { ManagerOrchestrationPanel } from "./ManagerOrchestrationPanel.tsx";
import { Transcript } from "./Transcript.tsx";

const MANAGER_CONVERSATION_ID = "deskrelay-manager-assistant";
const MANAGER_SESSION_LIMIT = 10;
const MANAGER_SESSION_EVENT_LIMIT = 400;
const MANAGER_SESSION_MAX_BYTES = 8 * 1024 * 1024;
const STREAM_OPEN_GRACE_MS = 350;
const ORCHESTRATION_PRESET_PROMPT = [
  "Start or continue a DeskRelay orchestration framework loop.",
  "",
  "Act as the supervisor, not as the sole implementer. Use the manager orchestration APIs to create rounds, create role agents, dispatch multiple workers, collect their outputs, compare results, and improve the protocol.",
  "",
  "Default roles to consider: architect, protocol, implementer, verifier, critic, and recorder. Use multiple agents when a task benefits from independent viewpoints. Keep each worker prompt bounded, with a clear objective, writable scope, expected output, and failure reporting format.",
  "",
  "After every round, produce a compact Korean status report: what was assigned, what each agent returned, what changed, what failed, and what the next round should test. Continue iterating unless there is a real blocker that cannot be resolved with available APIs.",
  "",
  "Do not do all project work yourself. Your job is to supervise the agents, improve the orchestration documents/protocol, and verify that the framework is becoming more reliable.",
].join("\n");

const INITIAL_EVENT: ClaudeStreamEvent = {
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "DeskRelay 관리, 진단, 업데이트, 복구를 도와드릴게요.",
      },
    ],
  },
};

interface ManagerAssistantProps {
  context?: ManagerAssistantChatContext | null;
  devices?: Device[];
  showOrchestrationPanel?: boolean;
}

interface ManagerRuntime {
  deviceId: string;
  instanceId: string;
  cwd: string;
}

type ManagerVisibleStatus = {
  tone: "ready" | "thinking" | "warning";
  main: string;
  detail?: string;
};

export const ManagerAssistant: Component<ManagerAssistantProps> = (props) => {
  const [reloadSeq, setReloadSeq] = createSignal(0);
  const [events, setEvents] = createSignal<ClaudeStreamEvent[]>([]);
  const [runIds, setRunIds] = createSignal<string[]>([]);
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [transcriptAtBottom, setTranscriptAtBottom] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<ManagerVisibleStatus | null>(null);
  const [statusReportSeq, setStatusReportSeq] = createSignal(0);
  const [hygieneCleanupBusy, setHygieneCleanupBusy] = createSignal(false);
  const [cachedOrchestrationSnapshot, setCachedOrchestrationSnapshot] = createSignal(
    readManagerOrchestrationCache(),
  );
  let transcriptScroller: HTMLDivElement | undefined;
  let statusReportTimer: number | undefined;
  let eventRefreshTimer: number | undefined;

  const serverDevice = createMemo(() => {
    const devices = props.devices ?? [];
    return (
      devices.find((device) => deviceDisplayRole(device) === "Server") ??
      devices.find((device) => device.connectionState === "online") ??
      null
    );
  });

  const [workspace] = createResource(
    () => reloadSeq(),
    () => api.managerAssistantWorkspace(),
  );
  const [
    conversationState,
    { mutate: mutateConversationState, refetch: refetchConversationState },
  ] = createResource(
    () => reloadSeq(),
    async () => {
      try {
        return await api.managerAssistantConversation();
      } catch {
        return null;
      }
    },
  );
  const [statusReports] = createResource(
    () => statusReportSeq(),
    async (): Promise<ManagerAssistantStatusReportResponse | null> => {
      try {
        return await api.managerAssistantStatus(5);
      } catch {
        return null;
      }
    },
  );
  const [managerState] = createResource(
    () => statusReportSeq(),
    async (): Promise<ManagerStateViewResponse | null> => {
      try {
        return await api.managerState();
      } catch {
        return null;
      }
    },
  );
  const [orchestration] = createResource(
    () => statusReportSeq(),
    async (): Promise<{ agents: ManagerAgent[]; rounds: ManagerRound[] } | null> => {
      try {
        const [agents, rounds] = await Promise.all([api.managerAgents(), api.managerRounds()]);
        const next = { agents: agents.agents, rounds: rounds.rounds };
        setCachedOrchestrationSnapshot(
          writeManagerOrchestrationCache(next) ?? {
            ...next,
            report: null,
            reportRoundId: null,
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
    const cached = cachedOrchestrationSnapshot();
    return cached ? { agents: cached.agents, rounds: cached.rounds } : null;
  });
  const [sessionHygiene, { refetch: refetchSessionHygiene }] = createResource(
    () => statusReportSeq(),
    async (): Promise<ManagerSessionHygieneReport | null> => {
      try {
        const hygiene = await api.managerSessionHygiene();
        setCachedOrchestrationSnapshot(
          writeManagerOrchestrationCache({ hygiene }) ?? cachedOrchestrationSnapshot(),
        );
        return hygiene;
      } catch {
        return null;
      }
    },
  );
  const visibleSessionHygiene = createMemo(
    () => sessionHygiene() ?? cachedOrchestrationSnapshot()?.hygiene ?? null,
  );

  const [behaviors] = createResource(
    () => serverDevice()?.id ?? null,
    async (deviceId) => {
      if (!deviceId) return [];
      try {
        return await api.listBehaviors(deviceId);
      } catch {
        return [];
      }
    },
  );

  const runtime = createMemo<ManagerRuntime | null>(() => {
    const device = serverDevice();
    const info = workspace();
    if (!device || !info?.cwd) return null;
    const instanceId = (behaviors() ?? []).find(
      (behavior) => behavior.name === "remote-claude",
    )?.instanceId;
    if (!instanceId) return null;
    return { deviceId: device.id, instanceId, cwd: info.cwd };
  });

  const [loadedTranscript] = createResource(
    () => {
      const current = runtime();
      const seq = reloadSeq();
      const persistedSessionId = sessionId() ?? conversationState()?.sessionId ?? null;
      const conversationLoaded = Boolean(conversationState());
      return current ? { ...current, persistedSessionId, conversationLoaded, seq } : null;
    },
    async (current) => {
      if (!current) return null;
      const list = await api.callBehavior<ClaudeSessionSummary[]>(
        current.deviceId,
        current.instanceId,
        "sessions.list",
        {
          cwd: current.cwd,
          limit: MANAGER_SESSION_LIMIT,
          dedupeSessionIds: true,
        },
      );
      if (list.error) throw new Error(list.error.message);
      const summary = chooseManagerSession(list.result ?? [], current.persistedSessionId);
      if (!summary) {
        setSessionId(null);
        return null;
      }
      setSessionId(summary.sessionId);
      if (
        current.conversationLoaded &&
        current.persistedSessionId !== summary.sessionId &&
        conversationState()?.sessionId !== summary.sessionId
      ) {
        void persistManagerSession(summary.sessionId, summary.cwd);
      }
      const transcript = await api.callBehavior<ClaudeSessionTranscript>(
        current.deviceId,
        current.instanceId,
        "sessions.read",
        {
          cwd: summary.cwd,
          sessionId: summary.sessionId,
          maxBytes: MANAGER_SESSION_MAX_BYTES,
          eventLimit: MANAGER_SESSION_EVENT_LIMIT,
        },
      );
      if (transcript.error) throw new Error(transcript.error.message);
      return transcript.result ?? null;
    },
  );

  const visibleEvents = createMemo(() => (events().length > 0 ? events() : [INITIAL_EVENT]));
  const busy = createMemo(() => runIds().length > 0);
  const liveStateStatus = createMemo(() => managerStatusFromState(managerState()));
  const latestReportStatus = createMemo(() => managerStatusFromReport(statusReports()?.latest));
  const visibleStatus = createMemo<ManagerVisibleStatus>(() => {
    const currentStatus = status();
    if (currentStatus) return currentStatus;
    const stateStatus = liveStateStatus();
    if (stateStatus) return stateStatus;
    const reportStatus = latestReportStatus();
    if (reportStatus) return reportStatus;
    if (!serverDevice()) {
      return {
        tone: "warning",
        main: "관리자 준비 안 됨",
        detail: "서버 PC connector를 찾을 수 없습니다.",
      };
    }
    if (workspace.loading || behaviors.loading || loadedTranscript.loading) {
      return { tone: "thinking", main: "관리자 상태 확인 중" };
    }
    if (!workspace()) {
      return {
        tone: "warning",
        main: "관리자 준비 안 됨",
        detail: "작업 폴더를 준비하지 못했습니다.",
      };
    }
    if (!runtime()) {
      return {
        tone: "warning",
        main: "관리자 준비 안 됨",
        detail: "서버 PC의 Claude 실행 환경을 확인해야 합니다.",
      };
    }
    if (busy()) return { tone: "thinking", main: "관리자 실행 중" };
    return {
      tone: "ready",
      main: "관리자 대기 중",
      detail: "Orchestration 또는 직접 메시지 입력 가능",
    };
  });
  const orchestrationStatus = createMemo(() =>
    summarizeOrchestration(
      visibleOrchestration()?.rounds ?? [],
      visibleOrchestration()?.agents ?? [],
    ),
  );
  const activeOrchestrationRound = createMemo(() =>
    pickActiveRound(visibleOrchestration()?.rounds ?? []),
  );
  const [activeRoundReport] = createResource(
    () => {
      const round = activeOrchestrationRound();
      const seq = statusReportSeq();
      return round ? { id: round.id, seq } : null;
    },
    async (input) => {
      if (!input) return null;
      try {
        const report = await api.managerRoundReport(input.id);
        setCachedOrchestrationSnapshot(
          writeManagerOrchestrationCache({ report, reportRoundId: input.id }) ??
            cachedOrchestrationSnapshot(),
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
    const cached = cachedOrchestrationSnapshot();
    const round = activeOrchestrationRound();
    return cached?.reportRoundId && cached.reportRoundId === round?.id ? cached.report : null;
  });

  createEffect(() => {
    const transcript = loadedTranscript();
    if (runIds().length > 0) return;
    setEvents(visibleClaudeEvents(transcript?.events ?? []));
    queueMicrotask(scrollToBottomIfPinned);
  });

  createEffect(() => {
    workspace.error;
    loadedTranscript.error;
    const err = workspace.error ?? loadedTranscript.error;
    if (err) setError(err instanceof Error ? err.message : String(err));
  });

  createEffect(() => {
    events();
    runIds();
    queueMicrotask(scrollToBottomIfPinned);
  });

  createEffect(() => {
    busy();
    if (statusReportTimer !== undefined) window.clearInterval(statusReportTimer);
    const intervalMs = busy() ? 5_000 : 30_000;
    statusReportTimer = window.setInterval(() => setStatusReportSeq((seq) => seq + 1), intervalMs);
  });

  const scheduleManagerEventRefresh = (includeHygiene = false) => {
    if (eventRefreshTimer !== undefined) return;
    eventRefreshTimer = window.setTimeout(() => {
      eventRefreshTimer = undefined;
      setStatusReportSeq((seq) => seq + 1);
      if (includeHygiene) void refetchSessionHygiene();
    }, 250);
  };

  createManagerEventSubscription({
    onEvent(event) {
      if (event.type === "assistant.status" || isManagerOrchestrationEvent(event)) {
        scheduleManagerEventRefresh();
      } else if (event.type === "hygiene.updated") {
        scheduleManagerEventRefresh(true);
      }
    },
  });

  onCleanup(() => {
    transcriptScroller = undefined;
    if (statusReportTimer !== undefined) window.clearInterval(statusReportTimer);
    if (eventRefreshTimer !== undefined) window.clearTimeout(eventRefreshTimer);
  });

  const readyError = createMemo(() => {
    if (!serverDevice()) return "서버 PC connector를 찾을 수 없습니다.";
    if (workspace.loading || behaviors.loading) return null;
    if (!workspace()) return "관리자 작업 폴더를 준비하지 못했습니다.";
    if (!runtime()) return "서버 PC의 remote-claude가 준비되지 않았습니다.";
    return null;
  });

  const updateTranscriptBottomState = () => {
    const el = transcriptScroller;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setTranscriptAtBottom(distance < 8);
  };

  const scrollToBottom = () => {
    if (!transcriptScroller) return;
    transcriptScroller.scrollTo({ top: transcriptScroller.scrollHeight, behavior: "smooth" });
    setTranscriptAtBottom(true);
  };

  function scrollToBottomIfPinned() {
    if (!transcriptScroller || !transcriptAtBottom()) return;
    transcriptScroller.scrollTop = transcriptScroller.scrollHeight;
  }

  function visibleClaudeEvents(nextEvents: ClaudeStreamEvent[]): ClaudeStreamEvent[] {
    return nextEvents.flatMap((event) => {
      const visible = claudeEventForTranscript(event);
      return visible ? [visible] : [];
    });
  }

  const appendEvent = (event: ClaudeStreamEvent) => {
    setEvents((current) => [...current, event]);
  };

  async function persistManagerSession(nextSessionId: string, nextCwd: string) {
    const trimmed = nextSessionId.trim();
    if (!trimmed) return;
    setSessionId(trimmed);
    const now = new Date().toISOString();
    mutateConversationState((current) => ({
      generatedAt: current?.generatedAt ?? now,
      conversationId: current?.conversationId ?? MANAGER_CONVERSATION_ID,
      ...current,
      sessionId: trimmed,
      cwd: nextCwd,
      updatedAt: now,
    }));
    try {
      const persisted = await api.updateManagerAssistantConversation({
        sessionId: trimmed,
        cwd: nextCwd,
      });
      mutateConversationState(persisted);
    } catch {
      // The Claude session is already persisted on disk; this server pointer is
      // retried after the next transcript load or completed run.
    }
  }

  const removeRun = (runId: string) => {
    setRunIds((current) => current.filter((id) => id !== runId));
  };

  const send = async (value: string) => {
    const text = value.trim();
    if (!text) return;
    const current = runtime();
    const notReady = readyError();
    if (!current || notReady) {
      setError(notReady ?? "Manager assistant is not ready.");
      return;
    }

    setError(null);
    setStatus({ tone: "thinking", main: "요청 접수" });
    const userEvent = userTranscriptEvent(text);
    appendEvent(userEvent);
    setTranscriptAtBottom(true);

    const runId = `manager_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setRunIds((currentIds) => [...currentIds, runId]);
    const space = `remote-claude.run:${runId}`;
    const abort = new AbortController();
    let streamSawRun = false;
    let chatAccepted = false;
    let capturedSessionId: string | null = null;
    const resumeSessionId = sessionId() ?? conversationState()?.sessionId ?? null;

    const streamPromise = (async () => {
      try {
        for await (const env of api.streamEvents(current.deviceId, space, {
          signal: abort.signal,
          onOpen: () => undefined,
        })) {
          const envelope = env as { kind?: string; content?: unknown };
          const nextStatus = managerStatusFromEnvelope(envelope.kind, envelope.content);
          if (nextStatus) setStatus(nextStatus);
          if (
            envelope.kind === "run.started" ||
            envelope.kind === "claude.event" ||
            envelope.kind === "run.finished" ||
            envelope.kind === "run.error" ||
            envelope.kind === "run.cancelled"
          ) {
            streamSawRun = true;
          }
          if (envelope.kind === "claude.event") {
            const transcriptEvent = claudeEventForTranscript(envelope.content);
            capturedSessionId = sessionIdFromClaudeEvent(transcriptEvent) ?? capturedSessionId;
            if (transcriptEvent) appendEvent(transcriptEvent);
          } else if (envelope.kind === "run.error") {
            const message = runErrorMessage(envelope.content);
            setError(message);
            setStatus({ tone: "warning", main: "Assistant 오류", detail: message });
            abort.abort();
            return;
          } else if (envelope.kind === "run.cancelled") {
            setStatus(null);
            abort.abort();
            return;
          } else if (envelope.kind === "run.finished") {
            abort.abort();
            return;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setStatus({ tone: "warning", main: "Assistant 오류", detail: message });
        }
      }
    })();

    try {
      await Promise.race([
        new Promise<void>((resolve) => setTimeout(resolve, STREAM_OPEN_GRACE_MS)),
      ]);
      const response = await api.callBehavior<{
        ok: true;
        runId: string;
        accepted: true;
        eventCount: number;
      }>(current.deviceId, current.instanceId, "chat", {
        cwd: current.cwd,
        message: text,
        runId,
        managerMode: true,
        managerBrowserContext: props.context ?? null,
        permissionMode: "bypassPermissions",
        conversationId: MANAGER_CONVERSATION_ID,
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      });
      if (response.error) {
        throw new Error(response.error.message);
      }
      chatAccepted = true;
    } catch (err) {
      if (!streamSawRun) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus({ tone: "warning", main: "Assistant 오류", detail: message });
      } else {
        chatAccepted = true;
      }
    } finally {
      if (!chatAccepted && !streamSawRun) abort.abort();
      await streamPromise;
      removeRun(runId);
      if (capturedSessionId) await persistManagerSession(capturedSessionId, current.cwd);
      setStatus((currentStatus) => (currentStatus?.tone === "warning" ? currentStatus : null));
      setReloadSeq((seq) => seq + 1);
      void refetchConversationState();
    }
  };

  const interrupt = async () => {
    const current = runtime();
    const runId = runIds()[0];
    if (!current || !runId) return;
    try {
      await api.callBehavior(current.deviceId, current.instanceId, "interrupt", { runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const cleanupSessionHygiene = async () => {
    if (hygieneCleanupBusy()) return;
    setHygieneCleanupBusy(true);
    setError(null);
    try {
      await api.cleanupManagerSessionHygiene();
      await refetchSessionHygiene();
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHygieneCleanupBusy(false);
    }
  };

  const runOrchestrationPreset = () => {
    void send(ORCHESTRATION_PRESET_PROMPT);
  };

  return (
    <div class="manager-assistant manager-assistant-chat">
      <Show when={props.showOrchestrationPanel !== false && orchestrationStatus()}>
        <ManagerOrchestrationPanel
          rounds={visibleOrchestration()?.rounds ?? []}
          agents={visibleOrchestration()?.agents ?? []}
          report={visibleActiveRoundReport()}
          hygiene={visibleSessionHygiene()}
          hygieneLoading={sessionHygiene.loading}
          hygieneCleanupBusy={hygieneCleanupBusy()}
          onRefreshHygiene={() => void refetchSessionHygiene()}
          onCleanupHygiene={() => void cleanupSessionHygiene()}
        />
      </Show>
      <div
        ref={transcriptScroller}
        class="transcript manager-assistant-transcript"
        onScroll={updateTranscriptBottomState}
      >
        <div class="transcript-inner">
          <Transcript
            events={visibleEvents()}
            deviceId={serverDevice()?.id ?? null}
            cwd={workspace()?.cwd ?? null}
          />
        </div>
      </div>

      <Show when={error() || readyError()}>
        {(message) => (
          <div class="upstream-banner manager-assistant-error" role="alert">
            <span class="upstream-banner-message">{message()}</span>
          </div>
        )}
      </Show>

      <div class="composer-shell manager-assistant-composer">
        <Show when={!transcriptAtBottom() && visibleEvents().length > 0}>
          <button
            type="button"
            class="scroll-to-bottom-button"
            aria-label="아래로 이동"
            title="아래로 이동"
            onClick={scrollToBottom}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 5v14" />
              <path d="m6 13 6 6 6-6" />
            </svg>
          </button>
        </Show>
        <Show when={visibleStatus()}>
          {(guidance) => (
            <output class={`composer-status composer-status-${guidance().tone}`} aria-live="polite">
              <span class="composer-status-main">{guidance().main}</span>
              <Show when={guidance().detail}>
                {(detail) => <span class="composer-status-detail">{detail()}</span>}
              </Show>
            </output>
          )}
        </Show>
        <Composer
          onSend={send}
          onInterrupt={() => void interrupt()}
          inFlight={busy()}
          disabled={Boolean(readyError())}
          idPrefix="manager-assistant-composer"
          extraActions={
            <button
              type="button"
              class="composer-preset-button"
              disabled={busy() || Boolean(readyError())}
              title="Run orchestration preset"
              onClick={runOrchestrationPreset}
            >
              Orchestration
            </button>
          }
          placeholder={`${serverDevice() ? deviceDisplayName(serverDevice() as Device) : "DeskRelay"} 관리자에게 보내기...`}
        />
      </div>
    </div>
  );
};

function chooseManagerSession(
  sessions: ClaudeSessionSummary[],
  currentSessionId: string | null,
): ClaudeSessionSummary | null {
  if (currentSessionId) {
    const current = sessions.find((session) => session.sessionId === currentSessionId);
    if (current) return current;
  }
  return sessions[0] ?? null;
}

function summarizeOrchestration(
  rounds: ManagerRound[],
  agents: ManagerAgent[],
): { round: string; agents: string } | null {
  if (rounds.length === 0 && agents.length === 0) return null;
  const activeRound = pickActiveRound(rounds);
  const activeAgents = agents.filter((agent) =>
    ["assigned", "running", "waiting", "blocked", "failed"].includes(agent.status),
  );
  const visibleAgents = (activeAgents.length ? activeAgents : agents).slice(0, 4);
  const roundText = activeRound
    ? `${activeRound.title} · ${statusLabel(activeRound.status)}`
    : "Agent orchestration";
  const agentText = visibleAgents.length
    ? visibleAgents.map((agent) => `${agent.role}: ${statusLabel(agent.status)}`).join(" · ")
    : "agent 없음";
  return { round: roundText, agents: agentText };
}

function pickActiveRound(rounds: ManagerRound[]): ManagerRound | undefined {
  return (
    rounds.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ?? rounds[0]
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "planned":
      return "계획됨";
    case "dispatching":
      return "배정 중";
    case "running":
      return "실행 중";
    case "collecting":
      return "수집 중";
    case "reviewing":
      return "검토 중";
    case "completed":
      return "완료";
    case "blocked":
      return "막힘";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소";
    case "idle":
      return "대기";
    case "assigned":
      return "배정됨";
    case "waiting":
      return "대기 중";
    case "stale":
      return "끊김";
    default:
      return status;
  }
}

function userTranscriptEvent(text: string): ClaudeStreamEvent {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

function sessionIdFromClaudeEvent(event: ClaudeStreamEvent | null): string | null {
  if (!event || event.type !== "system" || (event as { subtype?: unknown }).subtype !== "init") {
    return null;
  }
  const sessionId =
    (event as { session_id?: unknown; sessionId?: unknown }).session_id ??
    (event as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

function managerStatusFromEnvelope(
  kind: string | undefined,
  content: unknown,
): ManagerVisibleStatus | null {
  if (kind === "queue.updated") {
    const status =
      typeof (content as { status?: unknown })?.status === "string"
        ? (content as { status: string }).status
        : "";
    const position =
      typeof (content as { position?: unknown })?.position === "number"
        ? (content as { position: number }).position
        : null;
    if (status === "queued") {
      return {
        tone: "thinking",
        main: "대기 중",
        ...(position ? { detail: `큐 ${position}번째` } : {}),
      };
    }
    if (status === "running") return { tone: "thinking", main: "Assistant 실행 중" };
  }
  if (kind === "run.started") return { tone: "thinking", main: "Assistant 실행 중" };
  if (kind === "claude.event") {
    const action = describeCliActionFromClaudeEvent(content);
    if (action) return { tone: "thinking", main: action };
    return { tone: "thinking", main: "응답 수신 중" };
  }
  if (kind === "claude.stderr") {
    const line =
      typeof (content as { line?: unknown })?.line === "string"
        ? (content as { line: string }).line
        : "";
    if (line) return { tone: "thinking", main: "Claude CLI 메시지", detail: line.slice(0, 160) };
  }
  return null;
}

function managerStatusFromReport(
  report: ManagerAssistantStatusReport | undefined,
): ManagerVisibleStatus | null {
  if (!report) return null;
  const tone = report.level === "warning" || report.level === "error" ? "warning" : "thinking";
  const prefix = report.round ? `${report.round} ` : "";
  const detailParts = [report.scope, report.detail].filter(Boolean);
  return {
    tone,
    main: `${prefix}${report.message}`,
    ...(detailParts.length ? { detail: detailParts.join(" · ") } : {}),
  };
}

function managerStatusFromState(
  state: ManagerStateViewResponse | null | undefined,
): ManagerVisibleStatus | null {
  if (!state?.status) return null;
  const tone: ManagerVisibleStatus["tone"] =
    state.status.tone === "running"
      ? "thinking"
      : state.status.tone === "warning" || state.status.tone === "error"
        ? "warning"
        : "ready";
  return {
    tone,
    main: state.status.message,
    ...(state.status.detail ? { detail: state.status.detail } : {}),
  };
}

function runErrorMessage(content: unknown): string {
  if (content && typeof content === "object") {
    const message = (content as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
    const stderr = (content as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return "Assistant run failed.";
}
