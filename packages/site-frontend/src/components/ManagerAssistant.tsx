import type {
  ManagerAgent,
  ManagerArtifactUpdateRequest,
  ManagerAssistantChatContext,
  ManagerAssistantChatMessage,
  ManagerAssistantStreamEvent,
  ManagerAssistantStructuredState,
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
import { renderMarkdown } from "../claude/message-renderer.ts";
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

const MANAGER_CONVERSATION_ID = "deskrelay-manager-assistant";
const MANAGER_SESSION_LIMIT = 10;
const MANAGER_SESSION_EVENT_LIMIT = 400;
const MANAGER_SESSION_MAX_BYTES = 8 * 1024 * 1024;
const MANAGER_ASSISTANT_HISTORY_LIMIT = 240;
const MANAGER_ASSISTANT_HISTORY_CACHE_BYTES = 2 * 1024 * 1024;
const MANAGER_ASSISTANT_COLLAPSE_CHARS = 1_400;
const MANAGER_ASSISTANT_COLLAPSE_LINES = 14;
const MANAGER_ASSISTANT_PREVIEW_CHARS = 560;
const MANAGER_ASSISTANT_LOG_PATTERNS = [
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/api\//i,
  /\b(?:stdout|stderr|exit code|PowerShell|bun run|Count=)\b/i,
  /\b(?:project|round|agent|task|worker)_[A-Za-z0-9_-]{6,}\b/,
  /\b(?:projectId|roundId|taskId|agentId|workerRunId)\b/,
];
const MANAGER_ASSISTANT_INTERNAL_CHATTER_PATTERNS = [
  /^monitor\b/i,
  /^healthz\b/i,
  /^\d+\/\d+\s+모두\s+timeout/i,
  /^\d+차(?:\s*timeout|[.\s])/i,
  /^bun\s+정리/i,
  /\bsite-backend\b.*(?:pid|port|healthz|stale|spawn)/i,
  /^BUILD-RESULT\.md\s+인용\s+확인/i,
  /자동\s+accept.*dispatch\s+진행\s+중/i,
  /^(?:\/start\s+)?응답\s*timeout/i,
  /응답\s*대기/i,
  /^accept\s+호출\s+진행\s+중\.?$/i,
  /^acting\s+status\s+게시됨/i,
  /^todo\s+정리됐습니다\b/i,
  /^dispatch\s+(?:응답|\/start|실제|성공|확인)/i,
  /\bdispatch\s+실제\s+됐는지\s+확인/i,
  /\btask\s+상세\s+대기/i,
  /\bstream\s+ended\b/i,
  /\bworker\s+백그라운드\s+진행\s+중/i,
  /\b(?:builder|stage-content|effects-integrator|graphics-polish|vfx|playtest)-engineer\b.*성공/i,
  /\bplaytest-verifier\b.*(?:running|실행 중)/i,
];
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
  const [awaitingReplyRecoveryCount, setAwaitingReplyRecoveryCount] = createSignal(0);
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
  let managerAssistantAbort: AbortController | undefined;

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
    const preferred = workspaceDevice();
    return (
      (preferred ? devices.find((device) => device.id === preferred.id) : null) ??
      devices.find((device) => deviceDisplayRole(device) === "Server") ??
      devices.find((device) => device.connectionState === "online") ??
      preferred ??
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
  const managerAssistantTranscriptEntries = createMemo(() =>
    buildManagerAssistantTranscriptEntries(visibleEvents()),
  );
  const busy = createMemo(() => runIds().length > 0);
  const lastTranscriptEntry = createMemo(() => managerAssistantTranscriptEntries().at(-1) ?? null);
  const managerAssistantAwaitingReply = createMemo(
    () => !busy() && lastTranscriptEntry()?.role === "user",
  );
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
    if (managerAssistantAwaitingReply()) {
      return {
        tone: "warning",
        main: "관리자 응답 필요",
        detail: "마지막 지시에 대한 답변이 아직 보이지 않습니다.",
      };
    }
    const stateStatus = liveStateStatus();
    if (stateStatus) return stateStatus;
    const projectStatus = focusedProjectStatus();
    if (projectStatus) return projectStatus;
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
      main: "관리자 입력 가능",
      detail: "Orchestration 또는 직접 지시를 보낼 수 있습니다.",
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
    const currentEvents = events();
    if (nextEvents.length > 0) {
      if (shouldKeepLocalManagerAssistantEvents(currentEvents, nextEvents)) {
        setAssistantHistory(rememberAssistantHistory({ events: currentEvents }));
        queueMicrotask(scrollToBottomIfPinned);
        return;
      }
      if (managerAssistantEventsEquivalent(currentEvents, nextEvents)) {
        queueMicrotask(scrollToBottomIfPinned);
        return;
      }
      setEvents(nextEvents);
      setAssistantHistory(rememberAssistantHistory({ events: nextEvents }));
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
    if (!managerAssistantAwaitingReply()) {
      setAwaitingReplyRecoveryCount(0);
      return;
    }
    if (busy() || loadedTranscript.loading) return;
    const count = awaitingReplyRecoveryCount();
    if (count >= 12) return;
    const timer = window.setTimeout(() => {
      setAwaitingReplyRecoveryCount((current) => current + 1);
      setReloadSeq((seq) => seq + 1);
    }, 5_000);
    onCleanup(() => window.clearTimeout(timer));
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
    const visibleEvents: ClaudeStreamEvent[] = [];
    let pendingToolResult = "";
    let sawUserRequest = false;
    let sawAssistantEvent = false;
    let sawVisibleAssistantReply = false;
    for (const event of nextEvents) {
      pendingToolResult = managerAssistantToolResultSummary(event) || pendingToolResult;
      const visible = claudeEventForTranscript(event);
      if (!visible) continue;
      if (visible.type === "user" && managerAssistantDisplayText(visible).trim()) {
        sawUserRequest = true;
      }
      if (visible.type === "assistant") {
        sawAssistantEvent = true;
      }
      if (visible.type === "assistant" && isVisibleManagerAssistantReply(visible)) {
        sawVisibleAssistantReply = true;
        pendingToolResult = "";
      }
      visibleEvents.push(visible);
    }
    if (pendingToolResult) {
      visibleEvents.push(managerAssistantToolResultFallbackEvent(pendingToolResult));
    } else if (sawUserRequest && sawAssistantEvent && !sawVisibleAssistantReply) {
      visibleEvents.push(managerAssistantNoReplyEvent());
    }
    return visibleEvents;
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
    const previousEntries = managerAssistantTranscriptEntries();
    const resumeSessionId = sessionId() ?? conversationState()?.sessionId ?? null;
    const history = managerAssistantChatHistory(previousEntries);
    const assistantState = managerAssistantStructuredState(previousEntries, resumeSessionId);
    const userEvent = userTranscriptEvent(text);
    appendEvent(userEvent);
    setTranscriptAtBottom(true);

    const runId = `manager_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setRunIds((currentIds) => [...currentIds, runId]);
    const abort = new AbortController();
    managerAssistantAbort = abort;
    let capturedSessionId: string | null = null;
    let responseCwd = current.cwd;
    let visibleAssistantReplySeen = false;

    try {
      await api.managerAssistantChatStream(
        {
          message: text,
          history,
          ...(props.context ? { context: props.context } : {}),
          ...(assistantState ? { assistantState } : {}),
        },
        (event) => {
          const nextStatus = managerStatusFromAssistantStreamEvent(event);
          if (nextStatus) setStatus(nextStatus);
          if (event.type === "claude_event") {
            capturedSessionId =
              sessionIdFromClaudeEvent(event.event as ClaudeStreamEvent) ?? capturedSessionId;
            const transcriptEvent = claudeEventForTranscript(event.event);
            if (transcriptEvent) {
              if (isVisibleManagerAssistantReply(transcriptEvent)) {
                visibleAssistantReplySeen = true;
              }
              appendEvent(transcriptEvent);
            }
          } else if (event.type === "message") {
            responseCwd = event.cwd || responseCwd;
            capturedSessionId = event.sessionId ?? capturedSessionId;
            const finalText = event.message.text.trim();
            if (
              finalText &&
              !managerAssistantFinalTextAlreadyVisible(
                managerAssistantTranscriptEntries(),
                finalText,
              )
            ) {
              appendEvent(managerAssistantChatMessageEvent(event.message));
            }
            if (finalText) visibleAssistantReplySeen = true;
          } else if (event.type === "error") {
            const visibleError = managerAssistantVisibleError(event.error);
            if (!visibleAssistantReplySeen) {
              appendEvent(managerAssistantSyntheticEvent(`관리자 Assistant 오류: ${visibleError}`));
              visibleAssistantReplySeen = true;
            }
            setError(visibleError);
            setStatus({ tone: "warning", main: "Assistant 오류", detail: visibleError });
          }
        },
        { signal: abort.signal },
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const message = managerAssistantVisibleError(
          err instanceof Error ? err.message : String(err),
        );
        if (!visibleAssistantReplySeen) {
          appendEvent(managerAssistantSyntheticEvent(`관리자 Assistant 요청 실패: ${message}`));
          visibleAssistantReplySeen = true;
        }
        setError(message);
        setStatus({ tone: "warning", main: "Assistant 오류", detail: message });
      }
    } finally {
      const wasAborted = abort.signal.aborted;
      if (!wasAborted && !visibleAssistantReplySeen) {
        appendEvent(managerAssistantNoReplyEvent());
      }
      abort.abort();
      if (managerAssistantAbort === abort) managerAssistantAbort = undefined;
      removeRun(runId);
      if (capturedSessionId) await persistManagerSession(capturedSessionId, responseCwd);
      setStatus((currentStatus) => (currentStatus?.tone === "warning" ? currentStatus : null));
      setReloadSeq((seq) => seq + 1);
      void refetchConversationState();
      window.setTimeout(() => setReloadSeq((seq) => seq + 1), 750);
    }
  };

  const interrupt = async () => {
    const current = runtime();
    const runId = runIds()[0];
    if (managerAssistantAbort) {
      managerAssistantAbort.abort();
      setStatus(null);
      if (runId) removeRun(runId);
      return;
    }
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
          dryRun: payloadBoolean(action.payload, "dryRun") ?? false,
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
          <ManagerAssistantTranscript entries={managerAssistantTranscriptEntries()} />
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
        <Show when={!transcriptAtBottom() && managerAssistantTranscriptEntries().length > 0}>
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
              <span class="composer-status-main">
                {managerComposerActionLabel(guidance(), busy())}
              </span>
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

type ManagerAssistantTranscriptRole = "assistant" | "user";

interface ManagerAssistantTranscriptEntry {
  id: string;
  role: ManagerAssistantTranscriptRole;
  text: string;
  preview: string;
  collapsed: boolean;
}

const ManagerAssistantTranscript: Component<{
  entries: ManagerAssistantTranscriptEntry[];
}> = (props) => (
  <Show
    when={props.entries.length > 0}
    fallback={<p class="manager-assistant-transcript-empty">{t("tx.empty")}</p>}
  >
    <div class="manager-assistant-dialogue" onClick={handleManagerAssistantDialogueClick}>
      <For each={props.entries}>
        {(entry) => (
          <article
            class={`manager-assistant-dialogue-item manager-assistant-dialogue-${entry.role}`}
          >
            <div class="manager-assistant-dialogue-body">
              <Show
                when={entry.collapsed}
                fallback={
                  <div
                    class="manager-assistant-dialogue-markdown"
                    innerHTML={renderManagerAssistantMarkdown(entry.text)}
                  />
                }
              >
                <div
                  class="manager-assistant-dialogue-markdown manager-assistant-dialogue-preview"
                  innerHTML={renderManagerAssistantMarkdown(entry.preview)}
                />
              </Show>
              <Show when={entry.collapsed}>
                <details class="manager-assistant-dialogue-details">
                  <summary>{t("manager.assistant.transcript.details")}</summary>
                  <div
                    class="manager-assistant-dialogue-markdown manager-assistant-dialogue-full"
                    innerHTML={renderManagerAssistantMarkdown(entry.text)}
                  />
                </details>
              </Show>
            </div>
          </article>
        )}
      </For>
    </div>
  </Show>
);

function handleManagerAssistantDialogueClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.matches("button[data-copy]")) return;
  const pre = target.closest("pre");
  const code = pre?.querySelector("code");
  if (!code?.textContent) return;
  navigator.clipboard?.writeText(code.textContent).catch(() => undefined);
  const original = target.textContent;
  target.textContent = t("tx.copied");
  window.setTimeout(() => {
    target.textContent = original;
  }, 1200);
}

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

function managerAssistantSyntheticEvent(text: string): ClaudeStreamEvent {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function managerAssistantChatMessageEvent(message: ManagerAssistantChatMessage): ClaudeStreamEvent {
  return {
    type: message.role === "user" ? "user" : "assistant",
    message: {
      role: message.role,
      content: [{ type: "text", text: message.text }],
    },
  };
}

function managerAssistantChatHistory(
  entries: ManagerAssistantTranscriptEntry[],
): ManagerAssistantChatMessage[] {
  const now = Date.now();
  return entries
    .filter((entry) => entry.text.trim())
    .slice(-18)
    .map((entry, index) => ({
      id: `visible_${index}_${entry.id}`,
      role: entry.role,
      text: entry.text.slice(0, 20_000),
      createdAt: new Date(now - (entries.length - index) * 1000).toISOString(),
    }));
}

function managerAssistantStructuredState(
  entries: ManagerAssistantTranscriptEntry[],
  sessionId: string | null,
): ManagerAssistantStructuredState | undefined {
  const lastAssistant = [...entries]
    .reverse()
    .find((entry) => entry.role === "assistant" && entry.text.trim());
  const state: ManagerAssistantStructuredState = {};
  if (sessionId) state.sessionId = sessionId;
  if (lastAssistant) state.lastAssistantText = lastAssistant.text.slice(0, 8_000);
  return Object.keys(state).length > 0 ? state : undefined;
}

function managerAssistantFinalTextAlreadyVisible(
  entries: ManagerAssistantTranscriptEntry[],
  text: string,
): boolean {
  const normalizedFinal = normalizeManagerAssistantComparableText(text);
  if (!normalizedFinal) return true;
  const lastAssistant = [...entries]
    .reverse()
    .find((entry) => entry.role === "assistant" && entry.text.trim());
  return normalizeManagerAssistantComparableText(lastAssistant?.text ?? "") === normalizedFinal;
}

function shouldKeepLocalManagerAssistantEvents(
  currentEvents: ClaudeStreamEvent[],
  nextEvents: ClaudeStreamEvent[],
): boolean {
  if (currentEvents.length === 0 || nextEvents.length === 0) return false;
  const currentEntries = buildManagerAssistantTranscriptEntries(currentEvents);
  const nextEntries = buildManagerAssistantTranscriptEntries(nextEvents);
  const lastLocalUserIndex = findLastManagerAssistantEntryIndex(
    currentEntries,
    (entry) => entry.role === "user",
  );
  if (lastLocalUserIndex < 0) return false;

  const lastLocalUser = currentEntries[lastLocalUserIndex];
  if (!lastLocalUser) return false;
  const transcriptHasUser = managerAssistantEntriesInclude(nextEntries, lastLocalUser);
  if (!transcriptHasUser) return true;

  const localReply = currentEntries
    .slice(lastLocalUserIndex + 1)
    .find((entry) => entry.role === "assistant" && entry.text.trim());
  return Boolean(localReply && !managerAssistantEntriesInclude(nextEntries, localReply));
}

function managerAssistantEventsEquivalent(
  currentEvents: ClaudeStreamEvent[],
  nextEvents: ClaudeStreamEvent[],
): boolean {
  if (currentEvents.length === 0 || currentEvents.length !== nextEvents.length) return false;
  const currentEntries = buildManagerAssistantTranscriptEntries(currentEvents);
  const nextEntries = buildManagerAssistantTranscriptEntries(nextEvents);
  if (currentEntries.length !== nextEntries.length) return false;
  return currentEntries.every((entry, index) => {
    const nextEntry = nextEntries[index];
    return (
      nextEntry !== undefined &&
      entry.role === nextEntry.role &&
      normalizeManagerAssistantComparableText(entry.text) ===
        normalizeManagerAssistantComparableText(nextEntry.text)
    );
  });
}

function findLastManagerAssistantEntryIndex(
  entries: ManagerAssistantTranscriptEntry[],
  predicate: (entry: ManagerAssistantTranscriptEntry) => boolean,
): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && predicate(entry)) return index;
  }
  return -1;
}

function managerAssistantEntriesInclude(
  entries: ManagerAssistantTranscriptEntry[],
  target: ManagerAssistantTranscriptEntry,
): boolean {
  const targetText = normalizeManagerAssistantComparableText(target.text);
  if (!targetText) return true;
  return entries.some(
    (entry) =>
      entry.role === target.role &&
      normalizeManagerAssistantComparableText(entry.text) === targetText,
  );
}

function normalizeManagerAssistantComparableText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function managerAssistantToolResultFallbackEvent(summary: string): ClaudeStreamEvent {
  return managerAssistantSyntheticEvent(
    `관리자 Assistant가 도구 실행 결과를 받은 뒤 최종 답변을 아직 남기지 않았습니다.\n\n마지막 도구 결과 요약: ${summary}`,
  );
}

function managerAssistantNoReplyEvent(): ClaudeStreamEvent {
  return managerAssistantSyntheticEvent(t("manager.assistant.transcript.no-reply"));
}

function isVisibleManagerAssistantReply(event: ClaudeStreamEvent): boolean {
  if (event.type !== "assistant") return false;
  const text = managerAssistantDisplayText(event);
  return text.length > 0 && !isManagerAssistantNoiseText(text);
}

function buildManagerAssistantTranscriptEntries(
  events: ClaudeStreamEvent[],
): ManagerAssistantTranscriptEntry[] {
  return events.flatMap((event, index) => {
    const role = managerAssistantTranscriptRole(event);
    if (!role) return [];
    const rawText = managerAssistantDisplayText(event);
    if (!rawText) return [];
    const noise =
      isManagerAssistantNoiseText(rawText) ||
      (role === "assistant" && isManagerAssistantTranscriptChatterText(rawText));
    if (noise) return [];
    const text = rawText;
    const collapsed = shouldCollapseManagerAssistantEntry(role, text);
    return [
      {
        id: `${role}-${index}-${text.slice(0, 20)}`,
        role,
        text,
        preview: collapsed ? managerAssistantPreviewText(text) : text,
        collapsed,
      },
    ];
  });
}

function managerAssistantTranscriptRole(
  event: ClaudeStreamEvent,
): ManagerAssistantTranscriptRole | null {
  if (event.type === "assistant") return "assistant";
  if (event.type === "user") return "user";
  return null;
}

function managerAssistantDisplayText(event: ClaudeStreamEvent): string {
  const text = managerAssistantEventText(event).trim();
  if (event.type === "user") return extractManagerAssistantUserRequest(text);
  return text;
}

function extractManagerAssistantUserRequest(text: string): string {
  if (isManagerAssistantTaskNotificationText(text)) return "";

  const browserRequest = /## My request for Codex:\s*\n([\s\S]*)$/i.exec(text);
  if (browserRequest?.[1]?.trim()) return browserRequest[1].trim();

  const currentRequest =
    /## Current User Request\s*\n([\s\S]*?)(?:\n## Current User Request ASCII-Safe Copy|\n## Response Requirements|$)/i.exec(
      text,
    );
  if (currentRequest?.[1]?.trim()) return currentRequest[1].trim();

  return text;
}

function isManagerAssistantTaskNotificationText(text: string): boolean {
  return /^<task-notification\b[\s\S]*<\/task-notification>\s*$/i.test(text.trim());
}

function isManagerAssistantNoiseText(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "no response requested." ||
    normalized === "no response requested" ||
    normalized === "continue from where you left off." ||
    normalized === "continue from where you left off"
  );
}

function isManagerAssistantTranscriptChatterText(text: string): boolean {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return true;
  if (MANAGER_ASSISTANT_INTERNAL_CHATTER_PATTERNS.some((pattern) => pattern.test(compact))) {
    return true;
  }
  if (
    compact.length <= 520 &&
    /\b(?:round|task|agent)_[A-Za-z0-9_-]{6,}\b/.test(compact) &&
    /(?:dispatch|running|실행 중|상세 대기|응답 대기|확인)/i.test(compact)
  ) {
    return true;
  }
  if (compact.length > 360) {
    return (
      /\b(?:round|task|agent)_[A-Za-z0-9_-]{6,}\b/.test(compact) &&
      /\b(?:dispatch|running|상세 대기|응답 대기|monitor)\b/i.test(compact) &&
      !/[.!?。]\s*[A-Z가-힣].{120,}/.test(compact)
    );
  }
  return false;
}

function shouldCollapseManagerAssistantEntry(
  role: ManagerAssistantTranscriptRole,
  text: string,
): boolean {
  if (role !== "assistant") return false;
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  return (
    text.length > MANAGER_ASSISTANT_COLLAPSE_CHARS ||
    lineCount > MANAGER_ASSISTANT_COLLAPSE_LINES ||
    MANAGER_ASSISTANT_LOG_PATTERNS.some((pattern) => pattern.test(text))
  );
}

function managerAssistantPreviewText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !looksLikeManagerAssistantDiagnosticLine(line));
  const sourceLines = lines.length > 0 ? lines : [t("manager.assistant.transcript.log-collapsed")];
  return clipManagerAssistantText(sourceLines.slice(0, 4).join("\n"));
}

function renderManagerAssistantMarkdown(text: string): string {
  return renderMarkdown(normalizeManagerAssistantMarkdown(text));
}

function normalizeManagerAssistantMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const quotedFence = line.trim().match(/^["'“”‘’](```[^"'“”‘’]*)["'“”‘’]$/);
      if (!quotedFence?.[1]) return line;
      const indent = line.match(/^\s*/)?.[0] ?? "";
      return `${indent}${quotedFence[1].trimEnd()}`;
    })
    .join("\n");
}

function looksLikeManagerAssistantDiagnosticLine(line: string): boolean {
  const compact = line.replace(/\s+/g, " ").trim();
  if (compact.length > 180) return true;
  return MANAGER_ASSISTANT_LOG_PATTERNS.some((pattern) => pattern.test(compact));
}

function clipManagerAssistantText(text: string): string {
  const compact = text.trim();
  if (compact.length <= MANAGER_ASSISTANT_PREVIEW_CHARS) return compact;
  return `${compact.slice(0, MANAGER_ASSISTANT_PREVIEW_CHARS - 1)}…`;
}

function managerAssistantEventText(event: ClaudeStreamEvent): string {
  const message = event.message;
  if (!message || typeof message !== "object") return "";
  return managerAssistantContentText((message as { content?: unknown }).content);
}

function managerAssistantToolResultSummary(event: ClaudeStreamEvent): string {
  if (event.type !== "user") return "";
  const message = event.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const text = content
    .filter(
      (block): block is Record<string, unknown> => Boolean(block) && typeof block === "object",
    )
    .filter((block) => block.type === "tool_result")
    .map((block) => managerAssistantContentText(block.content))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 1_200 ? `${text.slice(0, 1_200)}...` : text;
}

function managerAssistantContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(managerAssistantContentText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (record.content !== undefined) return managerAssistantContentText(record.content);
  return "";
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
      return "유휴";
    case "assigned":
      return "배정됨";
    case "waiting":
      return "결과 기다리는 중";
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
        main: "요청 큐에 등록됨",
        ...(position ? { detail: `큐 ${position}번째` } : {}),
      };
    }
    if (status === "running") return { tone: "thinking", main: "관리자 작업 실행 중" };
  }
  if (kind === "run.started") return { tone: "thinking", main: "관리자 작업 시작" };
  if (kind === "claude.event") {
    const action = describeCliActionFromClaudeEvent(content);
    if (action) return { tone: "thinking", main: action };
    return { tone: "thinking", main: "관리자 응답 확인 중" };
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

function managerStatusFromAssistantStreamEvent(
  event: ManagerAssistantStreamEvent,
): ManagerVisibleStatus | null {
  if (event.type === "status") {
    if (event.status.tone !== "warning") return { tone: "thinking", main: "생각 중" };
    return {
      tone: event.status.tone === "warning" ? "warning" : "thinking",
      main: event.status.main,
      ...(event.status.detail ? { detail: event.status.detail } : {}),
    };
  }
  if (event.type === "claude_event") {
    const status = managerStatusFromEnvelope("claude.event", event.event);
    if (status?.tone === "warning") return status;
    return { tone: "thinking", main: "생각 중" };
  }
  if (event.type === "message") {
    return { tone: "thinking", main: "응답 반영 중" };
  }
  if (event.type === "error") {
    return { tone: "warning", main: "Assistant 오류", detail: event.error };
  }
  return null;
}

function managerComposerActionLabel(status: ManagerVisibleStatus, inFlight = false): string {
  const text = status.main.trim();
  if (status.tone === "thinking" && inFlight) return "생각 중";
  if (/오류|error|failed|실패/i.test(text)) return "오류";
  if (/응답|답변/i.test(text) && status.tone === "warning") return "응답 필요";
  if (/승인|approval|permission/i.test(text)) return "승인 대기";
  if (/요청|접수|큐|queued/i.test(text)) return "요청 접수";
  if (/수신|응답|답변|response/i.test(text)) return "응답 확인 중";
  if (/실행|진행|running|thinking/i.test(text)) return "진행 중";
  if (status.tone === "thinking") return "입력 가능";
  if (status.tone === "warning") return "확인 필요";
  return "입력 가능";
}

function managerAssistantVisibleError(error: string): string {
  const trimmed = error.trim();
  if (/manager assistant cli timed out after \d+ms/i.test(trimmed)) {
    return "관리자 응답이 오래 걸리고 있습니다. 답변이 올 때까지 생각 중 상태를 유지합니다.";
  }
  return trimmed || "관리자 Assistant 요청을 완료하지 못했습니다.";
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
