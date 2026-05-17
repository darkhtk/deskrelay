import type {
  ManagerAgent,
  ManagerArtifactUpdateRequest,
  ManagerAssistantChatContext,
  ManagerBlockerCreateRequest,
  ManagerBlockerResolveRequest,
  ManagerCommandFlowResponse,
  ManagerDecisionCreateRequest,
  ManagerDecisionUpdateRequest,
  ManagerDirectionChangeRequest,
  ManagerProject,
  ManagerProjectCharterUpdateRequest,
  ManagerProjectCompleteRequest,
  ManagerProjectCreateRequest,
  ManagerProjectOverviewResponse,
  ManagerProjectStartRequest,
  ManagerProposedAction,
  ManagerProtocolUpdateRequest,
  ManagerRound,
  ManagerRoundHealthGateResponse,
  ManagerRoundReviewRequest,
  ManagerSessionHygieneReport,
  ManagerWorkerRun,
  ManagerWorkerRunLedgerResponse,
} from "@deskrelay/shared";
import {
  type Component,
  For,
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
  type ManagerTaskObservationResponse,
  api,
} from "../api.ts";
import {
  claudeEventForTranscript,
  describeCliActionFromClaudeEvent,
} from "../claude/cli-action.ts";
import { deviceDisplayName, deviceDisplayRole } from "../device-display.ts";
import { t } from "../i18n.ts";
import { createManagerEventSubscription, isManagerOrchestrationEvent } from "../manager-events.ts";
import {
  readManagerOrchestrationCache,
  writeManagerOrchestrationCache,
} from "../manager-orchestration-cache.ts";
import {
  readSelectedManagerProjectId,
  writeSelectedManagerProjectId,
} from "../manager-project-selection.ts";
import { Composer } from "./Composer.tsx";
import { ManagerOrchestrationPanel } from "./ManagerOrchestrationPanel.tsx";
import { Transcript } from "./Transcript.tsx";

const MANAGER_CONVERSATION_ID = "deskrelay-manager-assistant";
const MANAGER_SESSION_LIMIT = 10;
const MANAGER_SESSION_EVENT_LIMIT = 400;
const MANAGER_SESSION_MAX_BYTES = 8 * 1024 * 1024;
const STREAM_OPEN_GRACE_MS = 350;
const MANAGER_ASSISTANT_HISTORY_LIMIT = 240;
const MANAGER_ASSISTANT_HISTORY_CACHE_BYTES = 2 * 1024 * 1024;
const STREAM_CLOSE_GRACE_MS = 5_000;
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

interface ManagerAssistantHistory {
  events: ClaudeStreamEvent[];
  reports: ManagerAssistantStatusReport[];
  focusedProjectId: string | null;
  updatedAt: number;
}

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
  const [acknowledgeBusy, setAcknowledgeBusy] = createSignal(false);
  const [managerActionBusy, setManagerActionBusy] = createSignal(false);
  const [observeBusy, setObserveBusy] = createSignal(false);
  const [observedTask, setObservedTask] = createSignal<ManagerTaskObservationResponse | null>(null);
  const [cachedOrchestrationSnapshot, setCachedOrchestrationSnapshot] = createSignal(
    readManagerOrchestrationCache(),
  );
  const [assistantHistory, setAssistantHistory] = createSignal(readManagerAssistantHistory());
  const [focusedProjectId, setFocusedProjectId] = createSignal(
    readSelectedManagerProjectId() ?? assistantHistory()?.focusedProjectId ?? null,
  );
  let transcriptScroller: HTMLDivElement | undefined;
  let eventRefreshTimer: number | undefined;

  const orchestrationPanelEnabled = createMemo(() => props.showOrchestrationPanel !== false);

  const [workspace] = createResource(
    () => reloadSeq(),
    () => api.managerAssistantWorkspace(),
  );

  const workspaceDevice = createMemo<Device | null>(() => {
    const info = workspace();
    if (!info?.deviceId) return null;
    return {
      id: info.deviceId,
      label: info.deviceLabel ?? info.deviceId,
      daemonUrl: "",
      registeredAt: "",
      connectionState: "online",
    };
  });

  const serverDevice = createMemo(() => {
    const devices = props.devices ?? [];
    return (
      devices.find((device) => deviceDisplayRole(device) === "Server") ??
      devices.find((device) => device.connectionState === "online") ??
      workspaceDevice() ??
      null
    );
  });

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
  const [managerState, { mutate: mutateManagerState }] = createResource(
    () => statusReportSeq(),
    async (): Promise<ManagerStateViewResponse | null> => {
      try {
        return await api.managerState();
      } catch {
        return null;
      }
    },
  );
  const [managerProjects, { refetch: refetchManagerProjects }] = createResource(
    () => statusReportSeq(),
    async () => {
      try {
        return await api.managerProjects();
      } catch {
        return null;
      }
    },
  );
  const focusedProject = createMemo<ManagerProject | null>(() => {
    const projectId = focusedProjectId();
    const response = managerProjects();
    if (!projectId || !response) return null;
    return (
      response.projects.find((project) => project.id === projectId) ??
      response.archived.find((project) => project.id === projectId) ??
      null
    );
  });
  const [focusedProjectOverview] = createResource(
    () => {
      const projectId = focusedProjectId();
      const seq = statusReportSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerProjectOverviewResponse | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectOverview(input.projectId);
      } catch {
        return null;
      }
    },
  );
  const [focusedProjectCommandFlow] = createResource(
    () => {
      const projectId = focusedProjectId();
      const seq = statusReportSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerCommandFlowResponse | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectCommandFlow(input.projectId);
      } catch {
        return null;
      }
    },
  );
  const [orchestration] = createResource(
    () =>
      orchestrationPanelEnabled()
        ? { seq: statusReportSeq(), projectId: focusedProjectId() }
        : null,
    async (input): Promise<{ agents: ManagerAgent[]; rounds: ManagerRound[] } | null> => {
      if (input === null) return null;
      try {
        const [agents, rounds] = input.projectId
          ? await Promise.all([
              api.managerProjectAgents(input.projectId),
              api.managerProjectRounds(input.projectId),
            ])
          : await Promise.all([api.managerAgents(), api.managerRounds()]);
        const next = { agents: agents.agents, rounds: rounds.rounds };
        setCachedOrchestrationSnapshot(
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
    if (!orchestrationPanelEnabled()) return null;
    const current = orchestration();
    if (current) return current;
    const cached = cachedOrchestrationSnapshot();
    return cached ? { agents: cached.agents, rounds: cached.rounds } : null;
  });
  const [sessionHygiene, { refetch: refetchSessionHygiene }] = createResource(
    () => (orchestrationPanelEnabled() ? statusReportSeq() : null),
    async (seq): Promise<ManagerSessionHygieneReport | null> => {
      if (seq === null) return null;
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
  const visibleSessionHygiene = createMemo(() =>
    orchestrationPanelEnabled()
      ? (sessionHygiene() ?? cachedOrchestrationSnapshot()?.hygiene ?? null)
      : null,
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

  const visibleEvents = createMemo(() => {
    if (events().length > 0) return events();
    const cached = assistantHistory()?.events ?? [];
    return cached.length > 0 ? cached : [INITIAL_EVENT];
  });
  const busy = createMemo(() => runIds().length > 0);
  const liveStateStatus = createMemo(() => managerStatusFromState(managerState()));
  const focusedProjectStatus = createMemo(() =>
    managerStatusFromProject(
      focusedProject(),
      focusedProjectOverview(),
      focusedProjectCommandFlow(),
    ),
  );
  const latestReportStatus = createMemo(() => managerStatusFromReport(statusReports()?.latest));
  const visibleStatus = createMemo<ManagerVisibleStatus>(() => {
    const currentStatus = status();
    if (currentStatus) return currentStatus;
    const projectStatus = focusedProjectStatus();
    if (projectStatus) return projectStatus;
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
    orchestrationPanelEnabled()
      ? summarizeOrchestration(
          visibleOrchestration()?.rounds ?? [],
          visibleOrchestration()?.agents ?? [],
        )
      : null,
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

  const [workerRuns] = createResource(
    () => {
      const round = activeOrchestrationRound();
      const seq = statusReportSeq();
      return round ? { id: round.id, seq } : null;
    },
    async (input): Promise<ManagerWorkerRunLedgerResponse | null> => {
      if (!input) return null;
      try {
        const ledger = await api.managerRoundWorkerRuns(input.id);
        setCachedOrchestrationSnapshot(
          writeManagerOrchestrationCache({
            workerRuns: ledger,
            workerRunsRoundId: input.id,
          }) ?? cachedOrchestrationSnapshot(),
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
    const cached = cachedOrchestrationSnapshot();
    const round = activeOrchestrationRound();
    return cached?.workerRunsRoundId && cached.workerRunsRoundId === round?.id
      ? cached.workerRuns
      : null;
  });

  const [roundHealth] = createResource(
    () => {
      const round = activeOrchestrationRound();
      const seq = statusReportSeq();
      return round ? { id: round.id, seq } : null;
    },
    async (input): Promise<ManagerRoundHealthGateResponse | null> => {
      if (!input) return null;
      try {
        const health = await api.managerRoundHealth(input.id);
        setCachedOrchestrationSnapshot(
          writeManagerOrchestrationCache({
            roundHealth: health,
            roundHealthRoundId: input.id,
          }) ?? cachedOrchestrationSnapshot(),
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
    const cached = cachedOrchestrationSnapshot();
    const round = activeOrchestrationRound();
    return cached?.roundHealthRoundId && cached.roundHealthRoundId === round?.id
      ? cached.roundHealth
      : null;
  });

  createEffect(() => {
    const transcript = loadedTranscript();
    if (runIds().length > 0) return;
    const nextEvents = visibleClaudeEvents(transcript?.events ?? []);
    if (nextEvents.length > 0) {
      setEvents(nextEvents);
      rememberAssistantHistory({ events: nextEvents });
    } else if (events().length === 0 && (assistantHistory()?.events.length ?? 0) > 0) {
      setEvents(assistantHistory()?.events ?? []);
    }
    queueMicrotask(scrollToBottomIfPinned);
  });

  createEffect(() => {
    const reports = statusReports()?.reports ?? [];
    if (reports.length === 0) return;
    const nextHistory = rememberAssistantHistory({
      reports,
      focusedProjectId: focusedProjectId(),
    });
    setAssistantHistory(nextHistory);
    const latestProjectId = projectIdFromStatusReport(statusReports()?.latest);
    if (latestProjectId && shouldAdoptStatusProject(statusReports()?.latest)) {
      focusManagerProject(latestProjectId);
    }
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
    const intervalMs = busy() ? 5_000 : 30_000;
    const timer = window.setInterval(() => setStatusReportSeq((seq) => seq + 1), intervalMs);
    onCleanup(() => window.clearInterval(timer));
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
      if (event.type === "assistant.status") {
        scheduleManagerEventRefresh();
      } else if (orchestrationPanelEnabled() && isManagerOrchestrationEvent(event)) {
        if (event.type === "project.created") {
          focusManagerProject(event.project.id);
        } else if (event.type === "project.updated" && event.project.id === focusedProjectId()) {
          rememberAssistantHistory({ focusedProjectId: event.project.id });
        }
        scheduleManagerEventRefresh();
      } else if (orchestrationPanelEnabled() && event.type === "hygiene.updated") {
        scheduleManagerEventRefresh(true);
      }
    },
  });

  onCleanup(() => {
    transcriptScroller = undefined;
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
    setEvents((current) => {
      const next = [...current, event].slice(-MANAGER_ASSISTANT_HISTORY_LIMIT);
      setAssistantHistory(rememberAssistantHistory({ events: next }));
      return next;
    });
  };

  function focusManagerProject(projectId: string | null) {
    const normalized = projectId?.trim() || null;
    setFocusedProjectId(normalized);
    writeSelectedManagerProjectId(normalized);
    setAssistantHistory(rememberAssistantHistory({ focusedProjectId: normalized }));
  }

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
        firstEventTimeoutMs: 600_000,
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
      await waitForManagerStreamClose(streamPromise, abort);
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

  const acknowledgeManagerFailures = async () => {
    if (acknowledgeBusy()) return;
    setAcknowledgeBusy(true);
    setError(null);
    try {
      await api.acknowledgeManagerState("cleared from orchestration panel");
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcknowledgeBusy(false);
    }
  };

  const refreshManagerStateNow = async () => {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    setError(null);
    try {
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManagerActionBusy(false);
    }
  };

  const retryManagerTask = async (taskId: string) => {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    setError(null);
    try {
      await api.retryManagerTask(taskId);
      const round = activeOrchestrationRound();
      if (round) await api.repairManagerRound(round.id);
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManagerActionBusy(false);
    }
  };

  const inspectManagerTask = async (taskId: string) => {
    if (observeBusy()) return;
    setObserveBusy(true);
    setError(null);
    try {
      setObservedTask(await api.managerTaskObservation(taskId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setObserveBusy(false);
    }
  };

  const runUpdateAll = async () => {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    setError(null);
    try {
      const task = await api.managerUpdateAll({ requestedBy: "browser" });
      setObservedTask(await api.managerTaskObservation(task.id));
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManagerActionBusy(false);
    }
  };

  const repairRegistration = async () => {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    setError(null);
    try {
      const task = await api.managerRegistrationRepair({ requestedBy: "browser" });
      setObservedTask(await api.managerTaskObservation(task.id));
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManagerActionBusy(false);
    }
  };

  const repairManagerRound = async (roundId: string) => {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    setError(null);
    try {
      await api.repairManagerRound(roundId);
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManagerActionBusy(false);
    }
  };

  const acknowledgeManagerRound = async (roundId: string) => {
    if (acknowledgeBusy()) return;
    setAcknowledgeBusy(true);
    setError(null);
    try {
      await api.acknowledgeManagerRound(roundId, "acknowledged from round health gate");
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcknowledgeBusy(false);
    }
  };

  const cancelManagerTask = async (taskId: string) => {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    setError(null);
    try {
      await api.cancelManagerTask(taskId);
      mutateManagerState(await api.managerState());
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManagerActionBusy(false);
    }
  };

  const currentProjectId = () => focusedProjectId() ?? focusedProject()?.id ?? null;

  async function runManagerProjectMutation(
    mutation: () => Promise<unknown>,
    nextProjectId?: string | null,
  ) {
    if (managerActionBusy()) return;
    setManagerActionBusy(true);
    setError(null);
    try {
      await mutation();
      if (nextProjectId !== undefined) focusManagerProject(nextProjectId);
      await refetchManagerProjects();
      try {
        mutateManagerState(await api.managerState());
      } catch {
        // The project command-flow refresh is still enough to update the workboard.
      }
      setStatusReportSeq((seq) => seq + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManagerActionBusy(false);
    }
  }

  const createManagerProject = async (input: ManagerProjectCreateRequest) => {
    await runManagerProjectMutation(async () => {
      const response = await api.createManagerProject(input);
      focusManagerProject(response.project.id);
    });
  };

  const archiveManagerProject = async (projectId: string) => {
    await runManagerProjectMutation(
      async () => {
        await api.archiveManagerProject(projectId);
      },
      currentProjectId() === projectId ? null : currentProjectId(),
    );
  };

  const createProjectDecision = async (input: ManagerDecisionCreateRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.createManagerProjectDecision(projectId, input));
  };

  const updateProjectDecision = async (decisionId: string, input: ManagerDecisionUpdateRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() =>
      api.updateManagerProjectDecision(projectId, decisionId, input),
    );
  };

  const createProjectBlocker = async (input: ManagerBlockerCreateRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.createManagerProjectBlocker(projectId, input));
  };

  const resolveProjectBlocker = async (
    blockerId: string,
    input: ManagerBlockerResolveRequest = {},
  ) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() =>
      api.resolveManagerProjectBlocker(projectId, blockerId, input),
    );
  };

  const scanProjectArtifacts = async () => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.scanManagerProjectArtifacts(projectId));
  };

  const updateProjectArtifact = async (artifactId: string, input: ManagerArtifactUpdateRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() =>
      api.updateManagerProjectArtifact(projectId, artifactId, input),
    );
  };

  const scanProjectProtocol = async () => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.scanManagerProjectProtocol(projectId));
  };

  const updateProjectProtocol = async (input: ManagerProtocolUpdateRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.updateManagerProjectProtocol(projectId, input));
  };

  const updateProjectCharter = async (input: ManagerProjectCharterUpdateRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.updateManagerProjectCharter(projectId, input));
  };

  const prepareProjectFlow = async () => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.prepareManagerProject(projectId));
  };

  const startProjectFlow = async (input: ManagerProjectStartRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.startManagerProject(projectId, input));
  };

  const reviewProjectRound = async (roundId: string, input: ManagerRoundReviewRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.reviewManagerProjectRound(projectId, roundId, input));
  };

  const changeProjectDirection = async (input: ManagerDirectionChangeRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.changeManagerProjectDirection(projectId, input));
  };

  const completeProjectFlow = async (input: ManagerProjectCompleteRequest) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    await runManagerProjectMutation(() => api.completeManagerProject(projectId, input));
  };

  async function approveProposedAction(action: ManagerProposedAction) {
    if (action.projectId && action.projectId !== currentProjectId()) {
      focusManagerProject(action.projectId);
    }
    switch (action.type) {
      case "wait":
        await refreshManagerStateNow();
        return;
      case "prepare_project":
        await prepareProjectFlow();
        return;
      case "scan_protocol":
        await scanProjectProtocol();
        return;
      case "inspect_task": {
        const taskId = payloadString(action.payload, "taskId") ?? action.taskId;
        if (taskId) await inspectManagerTask(taskId);
        return;
      }
      case "retry_task": {
        const taskId = payloadString(action.payload, "taskId") ?? action.taskId;
        if (taskId) await retryManagerTask(taskId);
        return;
      }
      case "repair_round": {
        const roundId = payloadString(action.payload, "roundId") ?? action.roundId;
        if (roundId) await repairManagerRound(roundId);
        return;
      }
      case "review_round": {
        const roundId = payloadString(action.payload, "roundId") ?? action.roundId;
        if (!roundId) return;
        const summary = payloadString(action.payload, "summary");
        const nextObjective = payloadString(action.payload, "nextObjective");
        await reviewProjectRound(roundId, {
          action: managerReviewAction(payloadString(action.payload, "action")) ?? "accept",
          ...(summary ? { summary } : {}),
          ...(nextObjective ? { nextObjective } : {}),
        });
        return;
      }
      case "start_next_round": {
        const phase = managerStartPhase(payloadString(action.payload, "phase"));
        await startProjectFlow({
          objective:
            payloadString(action.payload, "objective") ??
            focusedProject()?.goal ??
            t("manager.orchestration.flow.default-round-objective"),
          ...(phase ? { phase } : {}),
          dryRun: payloadBoolean(action.payload, "dryRun") ?? true,
        });
        return;
      }
      case "direction_change": {
        const impact = payloadString(action.payload, "impact");
        const currentRoundAction = managerDirectionRoundAction(
          payloadString(action.payload, "currentRoundAction"),
        );
        const nextObjective = payloadString(action.payload, "nextObjective");
        await changeProjectDirection({
          requestedChange:
            payloadString(action.payload, "requestedChange") ??
            t("manager.orchestration.approval.default-direction-change"),
          ...(impact ? { impact } : {}),
          ...(currentRoundAction ? { currentRoundAction } : {}),
          ...(nextObjective ? { nextObjective } : {}),
        });
        return;
      }
      case "request_user_check": {
        const roundId = payloadString(action.payload, "roundId") ?? action.roundId;
        const summary =
          payloadString(action.payload, "summary") ??
          t("manager.orchestration.approval.default-user-check");
        if (roundId) {
          await reviewProjectRound(roundId, { action: "user_check_required", summary });
          return;
        }
        await createProjectBlocker({
          title: t("manager.orchestration.approval.default-user-check-title"),
          detail: summary,
          severity: "warning",
          requiredAction: "user",
          source: "manager",
        });
        return;
      }
      case "complete_project":
        await completeProjectFlow({
          summary:
            payloadString(action.payload, "summary") ??
            t("manager.orchestration.approval.default-complete-summary"),
          acceptedByUser: payloadBoolean(action.payload, "acceptedByUser") ?? false,
          verificationEvidence:
            payloadString(action.payload, "verificationEvidence") ?? action.rationale,
        });
        return;
    }
  }

  const runOrchestrationPreset = () => {
    void send(ORCHESTRATION_PRESET_PROMPT);
  };

  return (
    <div class="manager-assistant manager-assistant-chat">
      <Show when={orchestrationStatus()}>
        <ManagerOrchestrationPanel
          projects={managerProjects()?.projects ?? []}
          archivedProjects={managerProjects()?.archived ?? []}
          selectedProject={focusedProject()}
          commandFlow={focusedProjectCommandFlow()}
          projectOverview={focusedProjectOverview()}
          projectLoading={managerProjects.loading}
          projectBusy={managerActionBusy()}
          flowBusy={managerActionBusy() || focusedProjectCommandFlow.loading}
          decisions={focusedProjectCommandFlow()?.decisions ?? []}
          blockers={focusedProjectCommandFlow()?.blockers ?? []}
          artifacts={focusedProjectCommandFlow()?.artifacts ?? []}
          protocol={focusedProjectCommandFlow()?.protocol ?? null}
          protocolBusy={managerActionBusy() || focusedProjectCommandFlow.loading}
          rounds={visibleOrchestration()?.rounds ?? []}
          agents={visibleOrchestration()?.agents ?? []}
          report={visibleActiveRoundReport()}
          health={visibleRoundHealth()?.gate}
          workerRuns={visibleWorkerRuns()?.runs ?? []}
          hygiene={visibleSessionHygiene()}
          state={managerState()}
          observedTask={observedTask()}
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
          onRefreshProjects={() => void refetchManagerProjects()}
          onSelectProject={(projectId) => focusManagerProject(projectId)}
          onCreateProject={(input) => void createManagerProject(input)}
          onArchiveProject={(projectId) => void archiveManagerProject(projectId)}
          onCreateDecision={(input) => void createProjectDecision(input)}
          onUpdateDecision={(decisionId, input) => void updateProjectDecision(decisionId, input)}
          onCreateBlocker={(input) => void createProjectBlocker(input)}
          onResolveBlocker={(blockerId, input) => void resolveProjectBlocker(blockerId, input)}
          onScanArtifacts={() => void scanProjectArtifacts()}
          onUpdateArtifact={(artifactId, input) => void updateProjectArtifact(artifactId, input)}
          onScanProtocol={() => void scanProjectProtocol()}
          onUpdateProtocol={(input) => void updateProjectProtocol(input)}
          onUpdateCharter={(input) => void updateProjectCharter(input)}
          onPrepareProject={() => void prepareProjectFlow()}
          onStartProject={(input) => void startProjectFlow(input)}
          onReviewRound={(roundId, input) => void reviewProjectRound(roundId, input)}
          onDirectionChange={(input) => void changeProjectDirection(input)}
          onCompleteProject={(input) => void completeProjectFlow(input)}
          onApproveProposedAction={(action) => void approveProposedAction(action)}
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

export const ManagerAssistantLedger: Component<{
  project: ManagerProject | null;
  overview: ManagerProjectOverviewResponse | null | undefined;
  commandFlow: ManagerCommandFlowResponse | null | undefined;
  reports: ManagerAssistantStatusReport[];
  workerRuns: ManagerWorkerRun[];
}> = (props) => {
  const latestReport = createMemo(() => props.reports[0]);
  const recentReports = createMemo(() => props.reports.slice(0, 3));
  const projectId = createMemo(
    () => props.project?.id ?? projectIdFromStatusReport(latestReport()) ?? null,
  );
  const roundId = createMemo(
    () =>
      props.overview?.activeRound?.id ??
      props.project?.activeRoundId ??
      roundIdFromStatusReport(latestReport()) ??
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
        <Show when={props.project || props.overview || props.commandFlow || latestReport()}>
          <div class="manager-assistant-result-card">
            <div class="manager-assistant-result-title">
              <strong>{props.project?.name ?? latestReport()?.message ?? "최근 실행 결과"}</strong>
              <span>{props.commandFlow?.nextAction.label ?? props.overview?.nextAction.label}</span>
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
        </Show>
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

async function waitForManagerStreamClose(
  streamPromise: Promise<void>,
  abort: AbortController,
): Promise<void> {
  const settled = await Promise.race([
    streamPromise.then(() => true),
    new Promise<boolean>((resolve) =>
      window.setTimeout(() => {
        resolve(false);
      }, STREAM_CLOSE_GRACE_MS),
    ),
  ]);
  if (settled) return;
  abort.abort();
  await streamPromise.catch(() => undefined);
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function managerReviewAction(
  value: string | undefined,
): ManagerRoundReviewRequest["action"] | undefined {
  if (
    value === "accept" ||
    value === "request_changes" ||
    value === "user_check_required" ||
    value === "replan" ||
    value === "stop"
  ) {
    return value;
  }
  return undefined;
}

function managerStartPhase(
  value: string | undefined,
): ManagerProjectStartRequest["phase"] | undefined {
  if (
    value === "design" ||
    value === "implementation" ||
    value === "feedback" ||
    value === "verification" ||
    value === "replan"
  ) {
    return value;
  }
  return undefined;
}

function managerDirectionRoundAction(
  value: string | undefined,
): ManagerDirectionChangeRequest["currentRoundAction"] | undefined {
  if (value === "keep" || value === "cancel" || value === "supersede") return value;
  return undefined;
}

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
  const unacknowledged = rounds.filter((round) => !round.acknowledgedAt);
  return (
    unacknowledged.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ?? unacknowledged[0]
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

function managerStatusFromProject(
  project: ManagerProject | null,
  overview: ManagerProjectOverviewResponse | null | undefined,
  commandFlow: ManagerCommandFlowResponse | null | undefined,
): ManagerVisibleStatus | null {
  if (!project) return null;
  const signalTone = overview?.currentSignal.tone;
  const tone: ManagerVisibleStatus["tone"] =
    signalTone === "running"
      ? "thinking"
      : signalTone === "warning" || signalTone === "error"
        ? "warning"
        : "ready";
  const detail = [
    project.flowStage,
    commandFlow?.readiness.ready ? "ready" : commandFlow?.readiness.stage,
    commandFlow?.nextAction.label ?? overview?.nextAction.label,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    tone,
    main: project.name,
    ...(detail ? { detail } : {}),
  };
}

function managerStatusFromState(
  state: ManagerStateViewResponse | null | undefined,
): ManagerVisibleStatus | null {
  if (!state?.current) return null;
  const tone: ManagerVisibleStatus["tone"] =
    state.current.tone === "running"
      ? "thinking"
      : state.current.tone === "warning" || state.current.tone === "error"
        ? "warning"
        : "ready";
  const freshnessDetail = state.freshness?.stale ? "manager signal is stale" : undefined;
  const detail = [state.current.detail, freshnessDetail].filter(Boolean).join(" · ");
  return {
    tone,
    main: state.current.title,
    ...(detail ? { detail } : {}),
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

function managerAssistantHistoryCacheKey(): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "local";
  return `cr.manager-assistant-history:${encodeURIComponent(origin)}`;
}

function readManagerAssistantHistory(): ManagerAssistantHistory | null {
  try {
    const raw = globalThis.localStorage?.getItem(managerAssistantHistoryCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManagerAssistantHistory>;
    return {
      events: Array.isArray(parsed.events)
        ? (parsed.events as ClaudeStreamEvent[]).slice(-MANAGER_ASSISTANT_HISTORY_LIMIT)
        : [],
      reports: Array.isArray(parsed.reports)
        ? (parsed.reports as ManagerAssistantStatusReport[]).slice(0, 8)
        : [],
      focusedProjectId:
        typeof parsed.focusedProjectId === "string" && parsed.focusedProjectId.trim()
          ? parsed.focusedProjectId.trim()
          : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function rememberAssistantHistory(
  patch: Partial<ManagerAssistantHistory>,
): ManagerAssistantHistory {
  const previous = readManagerAssistantHistory();
  const next: ManagerAssistantHistory = {
    events: (patch.events ?? previous?.events ?? []).slice(-MANAGER_ASSISTANT_HISTORY_LIMIT),
    reports: dedupeManagerAssistantReports(patch.reports ?? previous?.reports ?? []).slice(0, 8),
    focusedProjectId:
      "focusedProjectId" in patch
        ? (patch.focusedProjectId ?? null)
        : (previous?.focusedProjectId ?? null),
    updatedAt: Date.now(),
  };
  try {
    const serialized = JSON.stringify(next);
    if (serialized.length <= MANAGER_ASSISTANT_HISTORY_CACHE_BYTES) {
      globalThis.localStorage?.setItem(managerAssistantHistoryCacheKey(), serialized);
    }
  } catch {
    // The visible in-memory transcript still remains available for this tab.
  }
  return next;
}

function dedupeManagerAssistantReports(
  reports: ManagerAssistantStatusReport[],
): ManagerAssistantStatusReport[] {
  const seen = new Set<string>();
  const next: ManagerAssistantStatusReport[] = [];
  for (const report of reports) {
    if (!report?.id || seen.has(report.id)) continue;
    seen.add(report.id);
    next.push(report);
  }
  return next;
}

function projectIdFromStatusReport(
  report: ManagerAssistantStatusReport | null | undefined,
): string | null {
  return firstMatch([report?.detail, report?.message], /\bproject_[A-Za-z0-9_-]+\b/);
}

function roundIdFromStatusReport(
  report: ManagerAssistantStatusReport | null | undefined,
): string | null {
  return firstMatch([report?.detail, report?.message, report?.round], /\bround_[A-Za-z0-9_-]+\b/);
}

function firstMatch(values: Array<string | undefined>, pattern: RegExp): string | null {
  for (const value of values) {
    const match = value?.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}

function shouldAdoptStatusProject(report: ManagerAssistantStatusReport | undefined): boolean {
  if (!report || !projectIdFromStatusReport(report)) return false;
  const createdAt = Date.parse(report.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt < 15 * 60 * 1000;
}

function formatAssistantLedgerTime(value: string | undefined): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}
