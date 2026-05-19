import type {
  ManagerAgent,
  ManagerArtifactListResponse,
  ManagerArtifactUpdateRequest,
  ManagerAssistantChatContext,
  ManagerAssistantStatusReportResponse,
  ManagerBlockerCreateRequest,
  ManagerBlockerListResponse,
  ManagerBlockerResolveRequest,
  ManagerCommandFlowResponse,
  ManagerDecisionCreateRequest,
  ManagerDecisionListResponse,
  ManagerDecisionUpdateRequest,
  ManagerDirectionChangeRequest,
  ManagerOrchestrationAction,
  ManagerOrchestrationSnapshot,
  ManagerProject,
  ManagerProjectCharterUpdateRequest,
  ManagerProjectCompleteRequest,
  ManagerProjectCreateRequest,
  ManagerProjectHygieneReport,
  ManagerProjectListResponse,
  ManagerOrchestrationSnapshotResponse,
  ManagerProjectOverviewResponse,
  ManagerProjectStartRequest,
  ManagerProposedAction,
  ManagerProtocolResponse,
  ManagerProtocolUpdateRequest,
  ManagerRound,
  ManagerRoundAgentAssignment,
  ManagerRoundHealthGateResponse,
  ManagerRoundReviewRequest,
  ManagerSessionHygieneReport,
  ManagerStateViewResponse,
  ManagerTask,
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
import { t } from "../i18n.ts";
import {
  type ManagerEventConnectionState,
  createManagerEventSubscription,
  isManagerOrchestrationEvent,
} from "../manager-events.ts";
import {
  readManagerOrchestrationCache,
  writeManagerOrchestrationCache,
} from "../manager-orchestration-cache.ts";
import {
  readSelectedManagerProjectId,
  writeSelectedManagerProjectId,
} from "../manager-project-selection.ts";
import { ManagerAssistant } from "./ManagerAssistant.tsx";
import { ManagerOrchestrationPanel } from "./ManagerOrchestrationPanel.tsx";

export function resolveSelectedManagerProject(
  response: ManagerProjectListResponse | null | undefined,
  selectedProjectId: string | null,
): ManagerProject | null {
  if (!response || !selectedProjectId) return null;
  return (
    response.projects.find((project) => project.id === selectedProjectId) ??
    response.archived.find((project) => project.id === selectedProjectId) ??
    null
  );
}

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
  const [projectHygieneCleanupBusy, setProjectHygieneCleanupBusy] = createSignal(false);
  const [acknowledgeBusy, setAcknowledgeBusy] = createSignal(false);
  const [managerActionBusy, setManagerActionBusy] = createSignal(false);
  const [observeBusy, setObserveBusy] = createSignal(false);
  const [observedTask, setObservedTask] = createSignal<ManagerTaskObservationResponse | null>(null);
  const [selectedProjectId, setSelectedProjectId] = createSignal(readSelectedManagerProjectId());
  const [projectActionBusy, setProjectActionBusy] = createSignal(false);
  const [projectFolderOpenBusy, setProjectFolderOpenBusy] = createSignal(false);
  const [projectFolderOpenError, setProjectFolderOpenError] = createSignal<string | null>(null);
  const [projectFolderOpenStatus, setProjectFolderOpenStatus] = createSignal<string | null>(null);
  const [decisionActionBusy, setDecisionActionBusy] = createSignal(false);
  const [blockerActionBusy, setBlockerActionBusy] = createSignal(false);
  const [artifactActionBusy, setArtifactActionBusy] = createSignal(false);
  const [protocolActionBusy, setProtocolActionBusy] = createSignal(false);
  const [flowActionBusy, setFlowActionBusy] = createSignal(false);
  const [approvalActionBusy, setApprovalActionBusy] = createSignal(false);
  const [approvalActionStatus, setApprovalActionStatus] = createSignal<string | null>(null);
  const [approvalActionError, setApprovalActionError] = createSignal<string | null>(null);
  const [suppressedApprovalActionKeys, setSuppressedApprovalActionKeys] = createSignal<
    Record<string, true>
  >({});
  const [cachedSnapshot, setCachedSnapshot] = createSignal(readManagerOrchestrationCache());
  const [eventState, setEventState] = createSignal<ManagerEventConnectionState>("connecting");
  const [eventStateDetail, setEventStateDetail] = createSignal<string | null>(null);
  let eventRefreshTimer: number | undefined;

  const [orchestration] = createResource(
    () => ({ seq: refreshSeq(), projectId: selectedProjectId() }),
    async (input): Promise<{ agents: ManagerAgent[]; rounds: ManagerRound[] } | null> => {
      try {
        const [agents, rounds] = input.projectId
          ? await Promise.all([
              api.managerProjectAgents(input.projectId),
              api.managerProjectRounds(input.projectId),
            ])
          : await Promise.all([api.managerAgents(), api.managerRounds()]);
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
        try {
          const [agents, rounds] = await Promise.all([api.managerAgents(), api.managerRounds()]);
          return { agents: agents.agents, rounds: rounds.rounds };
        } catch {
          return null;
        }
      }
    },
  );

  const [managerProjects, { refetch: refetchManagerProjects }] = createResource(
    () => refreshSeq(),
    async () => {
      try {
        return await api.managerProjects();
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

  const [assistantStatus] = createResource(
    () => refreshSeq(),
    async (): Promise<ManagerAssistantStatusReportResponse | null> => {
      try {
        return await api.managerAssistantStatus(8);
      } catch {
        return null;
      }
    },
  );

  const visibleHygiene = createMemo(() => sessionHygiene() ?? cachedSnapshot()?.hygiene ?? null);
  const selectedProject = createMemo<ManagerProject | null>(() => {
    return resolveSelectedManagerProject(managerProjects(), selectedProjectId());
  });
  const currentProjectId = createMemo(() => selectedProject()?.id ?? null);
  const activeRound = createMemo(() => {
    const rounds = visibleOrchestration()?.rounds ?? [];
    const projectRoundId = selectedProject()?.activeRoundId;
    return (
      (projectRoundId ? rounds.find((round) => round.id === projectRoundId) : undefined) ??
      pickActiveRound(rounds)
    );
  });

  const [projectOverview] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
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

  const [projectCommandFlow] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
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

  const [projectOrchestrationSnapshot] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerOrchestrationSnapshotResponse | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectOrchestration(input.projectId);
      } catch {
        return null;
      }
    },
  );

  const [projectHygiene, { refetch: refetchProjectHygiene }] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerProjectHygieneReport | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectHygiene(input.projectId);
      } catch {
        return null;
      }
    },
  );

  const [projectDecisions] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerDecisionListResponse | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectDecisions(input.projectId);
      } catch {
        return null;
      }
    },
  );

  const [projectBlockers] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerBlockerListResponse | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectBlockers(input.projectId);
      } catch {
        return null;
      }
    },
  );

  const [projectArtifacts] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerArtifactListResponse | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectArtifacts(input.projectId);
      } catch {
        return null;
      }
    },
  );

  const [projectProtocol] = createResource(
    () => {
      const projectId = currentProjectId();
      const seq = refreshSeq();
      return projectId ? { projectId, seq } : null;
    },
    async (input): Promise<ManagerProtocolResponse | null> => {
      if (!input) return null;
      try {
        return await api.managerProjectProtocol(input.projectId);
      } catch {
        return null;
      }
    },
  );

  const managerAssistantContext = createMemo<ManagerAssistantChatContext | null>(() => {
    const context: ManagerAssistantChatContext = { ...(props.context ?? {}) };
    const project = selectedProject();
    if (project) {
      context.projectId = project.id;
      context.projectName = project.name;
      context.projectStatus = project.status;
      context.projectCwd = project.cwd;
      if (project.goal.trim()) context.projectGoal = project.goal;
    }
    const round = projectOverview()?.activeRound ?? activeRound();
    if (round) {
      context.activeRoundId = round.id;
      context.activeRoundTitle = round.title;
      context.activeRoundStatus = round.status;
    }
    const commandFlow = projectCommandFlow();
    if (commandFlow) {
      context.projectCommandFlow = [
        `stage=${commandFlow.readiness.stage}; ready=${commandFlow.readiness.ready ? "yes" : "no"}`,
        `next=${commandFlow.nextAction.kind}: ${commandFlow.nextAction.label}`,
        ...(commandFlow.readiness.userCheckRequired ? ["user check required"] : []),
        ...commandFlow.readiness.warnings.slice(0, 3).map((warning) => `warning: ${warning}`),
      ];
    }
    const protocol = projectProtocol()?.protocol;
    if (protocol) {
      const presentFiles = protocol.files
        .filter((file) => file.status === "present")
        .map((file) => file.path);
      context.projectProtocol = [
        `version=${protocol.version}; files=${presentFiles.length ? presentFiles.join(", ") : "none"}`,
        ...protocol.activeRules.slice(0, 4).map((rule) => `rule: ${rule}`),
        ...(protocol.latestChange ? [`latest change: ${protocol.latestChange.summary}`] : []),
      ];
      if (protocol.warnings.length) {
        context.projectWarnings = [
          ...(context.projectWarnings ?? []),
          ...protocol.warnings.slice(0, 2),
        ];
      }
    }
    return Object.keys(context).length ? context : null;
  });

  createEffect(() => {
    const currentId = selectedProjectId();
    const response = managerProjects();
    if (!currentId || !response) return;
    if (!resolveSelectedManagerProject(response, currentId)) {
      setSelectedProjectId(null);
      writeSelectedManagerProjectId(null);
    }
  });
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
      const projectId = currentProjectId();
      const seq = refreshSeq();
      return round ? { id: round.id, projectId, seq } : null;
    },
    async (input): Promise<ManagerWorkerRunLedgerResponse | null> => {
      if (!input) return null;
      try {
        const ledger = input.projectId
          ? await api.managerProjectRuns(input.projectId)
          : await api.managerRoundWorkerRuns(input.id);
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
        if (event.type === "project.created") {
          setSelectedProjectId(event.project.id);
          writeSelectedManagerProjectId(event.project.id);
        }
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

  createEffect(() => {
    const refreshVisibleWorkspace = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setRefreshSeq((seq) => seq + 1);
      void refetchManagerProjects();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleWorkspace();
    };
    window.addEventListener("focus", refreshVisibleWorkspace);
    window.addEventListener("pageshow", refreshVisibleWorkspace);
    document.addEventListener("visibilitychange", onVisibilityChange);
    onCleanup(() => {
      window.removeEventListener("focus", refreshVisibleWorkspace);
      window.removeEventListener("pageshow", refreshVisibleWorkspace);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });
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

  async function cleanupProjectHygiene() {
    const projectId = currentProjectId();
    if (!projectId || projectHygieneCleanupBusy()) return;
    setProjectHygieneCleanupBusy(true);
    try {
      await api.cleanupManagerProjectHygiene(projectId);
      await refetchProjectHygiene();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setProjectHygieneCleanupBusy(false);
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

  async function createManagerProject(input: ManagerProjectCreateRequest) {
    if (projectActionBusy()) return;
    setProjectActionBusy(true);
    try {
      const response = await api.createManagerProject(input);
      setSelectedProjectId(response.project.id);
      writeSelectedManagerProjectId(response.project.id);
      await refetchManagerProjects();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setProjectActionBusy(false);
    }
  }

  function selectManagerProject(projectId: string | null) {
    setProjectFolderOpenError(null);
    setProjectFolderOpenStatus(null);
    setApprovalActionStatus(null);
    setApprovalActionError(null);
    setSuppressedApprovalActionKeys({});
    setSelectedProjectId(projectId);
    writeSelectedManagerProjectId(projectId);
  }

  async function openManagerProjectFolder(projectId: string) {
    if (projectFolderOpenBusy()) return;
    setProjectFolderOpenBusy(true);
    setProjectFolderOpenError(null);
    setProjectFolderOpenStatus(null);
    try {
      const response = await api.openManagerProjectFolder(projectId);
      setProjectFolderOpenStatus(
        t("manager.orchestration.project.open-folder-done", { cwd: response.cwd }),
      );
    } catch (error) {
      setProjectFolderOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectFolderOpenBusy(false);
    }
  }

  async function archiveManagerProject(projectId: string) {
    if (projectActionBusy()) return;
    setProjectActionBusy(true);
    try {
      await api.archiveManagerProject(projectId);
      if (selectedProjectId() === projectId || selectedProject()?.id === projectId) {
        setSelectedProjectId(null);
        writeSelectedManagerProjectId(null);
      }
      await refetchManagerProjects();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setProjectActionBusy(false);
    }
  }

  async function createProjectDecision(input: ManagerDecisionCreateRequest) {
    const projectId = currentProjectId();
    if (!projectId || decisionActionBusy()) return;
    setDecisionActionBusy(true);
    try {
      await api.createManagerProjectDecision(projectId, input);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setDecisionActionBusy(false);
    }
  }

  async function updateProjectDecision(decisionId: string, input: ManagerDecisionUpdateRequest) {
    const projectId = currentProjectId();
    if (!projectId || decisionActionBusy()) return;
    setDecisionActionBusy(true);
    try {
      await api.updateManagerProjectDecision(projectId, decisionId, input);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setDecisionActionBusy(false);
    }
  }

  async function createProjectBlocker(input: ManagerBlockerCreateRequest) {
    const projectId = currentProjectId();
    if (!projectId || blockerActionBusy()) return;
    setBlockerActionBusy(true);
    try {
      await api.createManagerProjectBlocker(projectId, input);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setBlockerActionBusy(false);
    }
  }

  async function resolveProjectBlocker(
    blockerId: string,
    input: ManagerBlockerResolveRequest = {},
  ) {
    const projectId = currentProjectId();
    if (!projectId || blockerActionBusy()) return;
    setBlockerActionBusy(true);
    try {
      await api.resolveManagerProjectBlocker(projectId, blockerId, input);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setBlockerActionBusy(false);
    }
  }

  async function scanProjectArtifacts() {
    const projectId = currentProjectId();
    if (!projectId || artifactActionBusy()) return;
    setArtifactActionBusy(true);
    try {
      await api.scanManagerProjectArtifacts(projectId);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setArtifactActionBusy(false);
    }
  }

  async function updateProjectArtifact(artifactId: string, input: ManagerArtifactUpdateRequest) {
    const projectId = currentProjectId();
    if (!projectId || artifactActionBusy()) return;
    setArtifactActionBusy(true);
    try {
      await api.updateManagerProjectArtifact(projectId, artifactId, input);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setArtifactActionBusy(false);
    }
  }

  async function scanProjectProtocol() {
    const projectId = currentProjectId();
    if (!projectId || protocolActionBusy()) return;
    setProtocolActionBusy(true);
    try {
      await api.scanManagerProjectProtocol(projectId);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setProtocolActionBusy(false);
    }
  }

  async function updateProjectProtocol(input: ManagerProtocolUpdateRequest) {
    const projectId = currentProjectId();
    if (!projectId || protocolActionBusy()) return;
    setProtocolActionBusy(true);
    try {
      await api.updateManagerProjectProtocol(projectId, input);
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setProtocolActionBusy(false);
    }
  }

  async function updateProjectCharter(input: ManagerProjectCharterUpdateRequest) {
    const projectId = currentProjectId();
    if (!projectId || flowActionBusy()) return;
    setFlowActionBusy(true);
    try {
      await api.updateManagerProjectCharter(projectId, input);
      await refetchManagerProjects();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setFlowActionBusy(false);
    }
  }

  async function prepareProjectFlow() {
    const projectId = currentProjectId();
    if (!projectId || flowActionBusy()) return;
    setFlowActionBusy(true);
    try {
      await api.prepareManagerProject(projectId);
      await refetchManagerProjects();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setFlowActionBusy(false);
    }
  }

  async function startProjectFlow(input: ManagerProjectStartRequest) {
    const projectId = currentProjectId();
    if (!projectId || flowActionBusy()) return;
    setFlowActionBusy(true);
    try {
      await api.startManagerProject(projectId, input);
      await refetchManagerProjects();
      mutateManagerState(await api.managerState());
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setFlowActionBusy(false);
    }
  }

  async function reviewProjectRound(roundId: string, input: ManagerRoundReviewRequest) {
    const projectId = currentProjectId();
    if (!projectId || flowActionBusy()) return;
    setFlowActionBusy(true);
    try {
      await api.reviewManagerProjectRound(projectId, roundId, input);
      await refetchManagerProjects();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setFlowActionBusy(false);
    }
  }

  async function changeProjectDirection(input: ManagerDirectionChangeRequest) {
    const projectId = currentProjectId();
    if (!projectId || flowActionBusy()) return;
    setFlowActionBusy(true);
    try {
      await api.changeManagerProjectDirection(projectId, input);
      await refetchManagerProjects();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setFlowActionBusy(false);
    }
  }

  async function completeProjectFlow(input: ManagerProjectCompleteRequest) {
    const projectId = currentProjectId();
    if (!projectId || flowActionBusy()) return;
    setFlowActionBusy(true);
    try {
      await api.completeManagerProject(projectId, input);
      await refetchManagerProjects();
      setRefreshSeq((seq) => seq + 1);
    } finally {
      setFlowActionBusy(false);
    }
  }

  async function refreshAfterApprovalAction(): Promise<void> {
    const [state] = await Promise.allSettled([api.managerState(), refetchManagerProjects()]);
    if (state.status === "fulfilled") mutateManagerState(state.value);
    setRefreshSeq((seq) => seq + 1);
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

  async function approveProposedAction(action: ManagerProposedAction) {
    if (approvalActionBusy()) return;
    const projectId = action.projectId || currentProjectId();
    if (!projectId) {
      setApprovalActionError(t("manager.orchestration.approval.error.no-project"));
      return;
    }
    if (projectId !== currentProjectId()) {
      setSelectedProjectId(projectId);
      writeSelectedManagerProjectId(projectId);
    }
    setApprovalActionBusy(true);
    setApprovalActionError(null);
    setApprovalActionStatus(t("manager.orchestration.approval.preflight"));
    try {
      const preflight = await preflightApprovalAction(action, projectId);
      if (!preflight.ok) {
        if (preflight.suppressActionKeys?.length) {
          suppressApprovalActions(preflight.suppressActionKeys);
        }
        await refreshAfterApprovalAction();
        setApprovalActionStatus(preflight.message);
        return;
      }
      setApprovalActionStatus(
        t("manager.orchestration.approval.running", {
          action: t(`manager.orchestration.proposed-action.${preflight.action.type}`),
        }),
      );
      if (approvalActionRunsInBackground(preflight.action)) {
        const actionLabel = t(`manager.orchestration.proposed-action.${preflight.action.type}`);
        const suppressionKeys = approvalActionSuppressionKeys(action, preflight.action);
        const actionPromise = runApprovedProposedAction(preflight.action, projectId);
        suppressApprovalActions(suppressionKeys);
        setApprovalActionStatus(
          t("manager.orchestration.approval.started", {
            action: actionLabel,
          }),
        );
        setRefreshSeq((seq) => seq + 1);
        void actionPromise
          .then(async () => {
            await refreshAfterApprovalAction();
            setApprovalActionStatus(t("manager.orchestration.approval.done"));
          })
          .catch((error) => {
            unsuppressApprovalActions(suppressionKeys);
            setApprovalActionStatus(null);
            setApprovalActionError(
              t("manager.orchestration.approval.error.failed", {
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          });
        return;
      }
      await runApprovedProposedAction(preflight.action, projectId);
      suppressApprovalActions(approvalActionSuppressionKeys(action, preflight.action));
      await refreshAfterApprovalAction();
      setApprovalActionStatus(t("manager.orchestration.approval.done"));
    } catch (error) {
      setApprovalActionStatus(null);
      setApprovalActionError(
        t("manager.orchestration.approval.error.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setApprovalActionBusy(false);
    }
  }

  async function preflightApprovalAction(
    action: ManagerProposedAction,
    projectId: string,
  ): Promise<
    | { ok: true; action: ManagerProposedAction; commandFlow: ManagerCommandFlowResponse }
    | { ok: false; message: string; suppressActionKeys?: string[] }
  > {
    const commandFlow = await api.managerProjectCommandFlow(projectId);
    if (
      commandFlow.project.status === "completed" ||
      commandFlow.project.flowStage === "completed"
    ) {
      return { ok: false, message: t("manager.orchestration.approval.error.completed-project") };
    }

    const actionRoundId = payloadString(action.payload, "roundId") ?? action.roundId;
    const currentRoundId = commandFlow.activeRound?.id ?? commandFlow.project.activeRoundId;
    if (actionRoundId && currentRoundId && currentRoundId !== actionRoundId) {
      return { ok: false, message: t("manager.orchestration.approval.error.stale-round") };
    }

    const currentSnapshot = await readManagerOrchestrationSnapshotForPreflight(projectId);
    const freshAction =
      findFreshApprovalAction(commandFlow, action) ??
      findFreshSnapshotApprovalAction(currentSnapshot, action);
    if (!freshAction) {
      await cleanupStaleApprovalAction(action, commandFlow);
      return {
        ok: false,
        message: t("manager.orchestration.approval.stale-action-cleaned"),
        suppressActionKeys: approvalActionSuppressionKeys(action),
      };
    }

    if (freshAction.type !== "retry_task") return { ok: true, action: freshAction, commandFlow };

    const taskId = payloadString(freshAction.payload, "taskId") ?? freshAction.taskId;
    if (!taskId) return { ok: false, message: t("manager.orchestration.approval.error.no-task") };

    const task = await readManagerTaskForPreflight(taskId);
    if (!task) {
      await cleanupStaleApprovalAction(freshAction, commandFlow);
      return {
        ok: false,
        message: t("manager.orchestration.approval.stale-task-missing"),
        suppressActionKeys: approvalActionSuppressionKeys(action, freshAction),
      };
    }
    if (task.state === "succeeded") {
      await cleanupStaleApprovalAction(freshAction, commandFlow);
      return {
        ok: false,
        message: t("manager.orchestration.approval.stale-task-succeeded"),
        suppressActionKeys: approvalActionSuppressionKeys(action, freshAction),
      };
    }
    if (task.state === "pending" || task.state === "running") {
      return {
        ok: false,
        message: t("manager.orchestration.approval.stale-task-active", {
          state: managerTaskStateLabel(task.state),
        }),
        suppressActionKeys: approvalActionSuppressionKeys(action, freshAction),
      };
    }

    return { ok: true, action: freshAction, commandFlow };
  }

  async function readManagerOrchestrationSnapshotForPreflight(
    projectId: string,
  ): Promise<ManagerOrchestrationSnapshot | null> {
    try {
      return (await api.managerProjectOrchestration(projectId)).snapshot;
    } catch {
      return null;
    }
  }

  async function readManagerTaskForPreflight(taskId: string): Promise<ManagerTask | null> {
    try {
      return await api.managerTask(taskId);
    } catch {
      return null;
    }
  }

  function suppressApprovalActions(keys: string[]) {
    setSuppressedApprovalActionKeys((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = true;
      return next;
    });
  }

  function unsuppressApprovalActions(keys: string[]) {
    setSuppressedApprovalActionKeys((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  async function cleanupStaleApprovalAction(
    action: ManagerProposedAction,
    commandFlow: ManagerCommandFlowResponse,
  ): Promise<void> {
    const roundId =
      payloadString(action.payload, "roundId") ?? action.roundId ?? commandFlow.activeRound?.id;
    if (!roundId) return;
    try {
      await api.repairManagerRound(roundId);
    } catch {
      // A fresh command-flow refresh still clears client-side stale suggestions when the server agrees.
    }
  }

  async function runApprovedProposedAction(
    action: ManagerProposedAction,
    projectId: string,
  ): Promise<void> {
    switch (action.type) {
      case "wait":
        await refreshManagerStateNow();
        return;
      case "prepare_project":
        await api.prepareManagerProject(projectId);
        return;
      case "scan_protocol":
        await api.scanManagerProjectProtocol(projectId);
        return;
      case "inspect_task": {
        const taskId = payloadString(action.payload, "taskId") ?? action.taskId;
        if (!taskId) throw new Error(t("manager.orchestration.approval.error.no-task"));
        await inspectManagerTask(taskId);
        return;
      }
      case "retry_task": {
        const taskId = payloadString(action.payload, "taskId") ?? action.taskId;
        if (!taskId) throw new Error(t("manager.orchestration.approval.error.no-task"));
        await retryManagerTask(taskId);
        return;
      }
      case "repair_round": {
        const roundId = payloadString(action.payload, "roundId") ?? action.roundId;
        if (!roundId) throw new Error(t("manager.orchestration.approval.error.no-round"));
        await repairManagerRound(roundId);
        return;
      }
      case "review_round": {
        const roundId = payloadString(action.payload, "roundId") ?? action.roundId;
        if (!roundId) throw new Error(t("manager.orchestration.approval.error.no-round"));
        const summary = payloadString(action.payload, "summary");
        const nextObjective = payloadString(action.payload, "nextObjective");
        await api.reviewManagerProjectRound(projectId, roundId, {
          action: managerReviewAction(payloadString(action.payload, "action")) ?? "accept",
          ...(summary ? { summary } : {}),
          ...(nextObjective ? { nextObjective } : {}),
        });
        return;
      }
      case "start_next_round": {
        const phase = managerStartPhase(payloadString(action.payload, "phase"));
        const assignments = payloadRoundAssignments(action.payload);
        await api.startManagerProject(projectId, {
          objective:
            payloadString(action.payload, "objective") ??
            selectedProject()?.goal ??
            t("manager.orchestration.flow.default-round-objective"),
          ...(phase ? { phase } : {}),
          dryRun: payloadBoolean(action.payload, "dryRun") ?? false,
          ...(assignments ? { assignments } : {}),
        });
        return;
      }
      case "start_toolchain_setup": {
        const phase = managerStartPhase(payloadString(action.payload, "phase")) ?? "verification";
        const assignments = payloadRoundAssignments(action.payload);
        await api.startManagerProject(projectId, {
          objective:
            payloadString(action.payload, "objective") ??
            t("manager.orchestration.approval.default-toolchain-setup"),
          phase,
          dryRun: payloadBoolean(action.payload, "dryRun") ?? false,
          ...(assignments ? { assignments } : {}),
        });
        return;
      }
      case "direction_change": {
        const impact = payloadString(action.payload, "impact");
        const currentRoundAction = managerDirectionRoundAction(
          payloadString(action.payload, "currentRoundAction"),
        );
        const nextObjective = payloadString(action.payload, "nextObjective");
        await api.changeManagerProjectDirection(projectId, {
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
          await api.reviewManagerProjectRound(projectId, roundId, {
            action: "user_check_required",
            summary,
          });
          return;
        }
        await api.createManagerProjectBlocker(projectId, {
          title: t("manager.orchestration.approval.default-user-check-title"),
          detail: summary,
          severity: "warning",
          requiredAction: "user",
          source: "manager",
        });
        return;
      }
      case "complete_project":
        await api.completeManagerProject(projectId, {
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

  return (
    <div
      class="manager-workspace"
      style={{ "--assistant-width": `${props.assistantWidth}px` } as JSX.CSSProperties}
    >
      <section class="manager-workspace-board" aria-label="Orchestration workspace">
        <ManagerOrchestrationPanel
          standalone
          projects={managerProjects()?.projects ?? []}
          archivedProjects={managerProjects()?.archived ?? []}
          selectedProject={selectedProject()}
          commandFlow={projectCommandFlow()}
          orchestrationSnapshot={projectOrchestrationSnapshot()?.snapshot ?? null}
          orchestrationSnapshotLoading={projectOrchestrationSnapshot.loading}
          projectOverview={projectOverview()}
          projectLoading={managerProjects.loading}
          projectBusy={projectActionBusy()}
          projectFolderBusy={projectFolderOpenBusy()}
          projectFolderError={projectFolderOpenError()}
          projectFolderStatus={projectFolderOpenStatus()}
          flowBusy={flowActionBusy() || projectCommandFlow.loading}
          decisions={projectDecisions()?.decisions ?? []}
          archivedDecisions={projectDecisions()?.archived ?? []}
          decisionBusy={decisionActionBusy()}
          blockers={projectBlockers()?.blockers ?? []}
          resolvedBlockers={projectBlockers()?.resolved ?? []}
          blockerBusy={blockerActionBusy()}
          artifacts={projectArtifacts()?.artifacts ?? []}
          inactiveArtifacts={projectArtifacts()?.inactive ?? []}
          artifactBusy={artifactActionBusy()}
          protocol={projectProtocol()?.protocol ?? null}
          protocolBusy={protocolActionBusy() || projectProtocol.loading}
          rounds={visibleOrchestration()?.rounds ?? []}
          agents={visibleOrchestration()?.agents ?? []}
          report={visibleActiveRoundReport()}
          health={visibleRoundHealth()?.gate}
          workerRuns={visibleWorkerRuns()?.runs ?? []}
          assistantStatusReports={assistantStatus()?.reports ?? []}
          hygiene={visibleHygiene()}
          projectHygiene={projectHygiene()}
          state={managerState()}
          observedTask={observedTask()}
          eventState={eventState()}
          eventStateDetail={eventStateDetail()}
          observeBusy={observeBusy()}
          hygieneLoading={sessionHygiene.loading}
          hygieneCleanupBusy={hygieneCleanupBusy()}
          projectHygieneLoading={projectHygiene.loading}
          projectHygieneCleanupBusy={projectHygieneCleanupBusy()}
          acknowledgeBusy={acknowledgeBusy()}
          actionBusy={managerActionBusy() || approvalActionBusy()}
          approvalActionBusy={approvalActionBusy()}
          approvalActionStatus={approvalActionStatus()}
          approvalActionError={approvalActionError()}
          suppressedApprovalActionKeys={Object.keys(suppressedApprovalActionKeys())}
          onRefreshHygiene={() => void refetchSessionHygiene()}
          onCleanupHygiene={() => void cleanupSessionHygiene()}
          onRefreshProjectHygiene={() => void refetchProjectHygiene()}
          onCleanupProjectHygiene={() => void cleanupProjectHygiene()}
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
          onSelectProject={(projectId) => selectManagerProject(projectId)}
          onCreateProject={(input) => void createManagerProject(input)}
          onArchiveProject={(projectId) => void archiveManagerProject(projectId)}
          onOpenProjectFolder={(projectId) => void openManagerProjectFolder(projectId)}
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
          context={managerAssistantContext()}
          devices={props.devices ?? []}
          showOrchestrationPanel={false}
        />
      </aside>
    </div>
  );
};

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function payloadRoundAssignments(
  payload: Record<string, unknown>,
): ManagerRoundAgentAssignment[] | undefined {
  const value = payload.assignments;
  if (!Array.isArray(value)) return undefined;
  const assignments = value.flatMap((item): ManagerRoundAgentAssignment[] => {
    if (!isPayloadRecord(item)) return [];
    const role = payloadString(item, "role");
    const prompt = payloadString(item, "prompt");
    if (!role || !prompt) return [];
    const agentId = payloadString(item, "agentId");
    const label = payloadString(item, "label");
    const profile = payloadString(item, "profile");
    const cwd = payloadString(item, "cwd");
    const timeoutMs = Number(item.timeoutMs);
    return [
      {
        role: role as ManagerRoundAgentAssignment["role"],
        prompt,
        ...(agentId ? { agentId } : {}),
        ...(label ? { label } : {}),
        ...(profile ? { profile } : {}),
        ...(cwd ? { cwd } : {}),
        ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
      },
    ];
  });
  return assignments.length ? assignments : undefined;
}

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function approvalActionRunsInBackground(action: ManagerProposedAction): boolean {
  return action.type === "start_next_round" || action.type === "start_toolchain_setup";
}

function findFreshApprovalAction(
  commandFlow: ManagerCommandFlowResponse,
  staleAction: ManagerProposedAction,
): ManagerProposedAction | undefined {
  const approvalActions = commandFlow.judgments.flatMap((judgment) =>
    judgment.proposedActions.filter((action) => action.requiresApproval),
  );
  return (
    approvalActions.find((action) => action.id === staleAction.id) ??
    approvalActions.find(
      (action) =>
        action.type === staleAction.type &&
        action.projectId === staleAction.projectId &&
        proposedActionTargetId(action) === proposedActionTargetId(staleAction) &&
        proposedActionRoundId(action) === proposedActionRoundId(staleAction),
    )
  );
}

function findFreshSnapshotApprovalAction(
  snapshot: ManagerOrchestrationSnapshot | null,
  staleAction: ManagerProposedAction,
): ManagerProposedAction | undefined {
  const approvalActions =
    snapshot?.approvalActions.filter(
      (action) => action.requiresApproval && action.status === "available",
    ) ?? [];
  const freshAction =
    approvalActions.find((action) => action.id === staleAction.id) ??
    approvalActions.find(
      (action) =>
        action.type === staleAction.type &&
        action.target.projectId === staleAction.projectId &&
        snapshotActionTargetId(action) === proposedActionTargetId(staleAction) &&
        snapshotActionRoundId(action) === proposedActionRoundId(staleAction),
    );
  return freshAction ? proposedActionFromSnapshotAction(freshAction) : undefined;
}

function proposedActionFromSnapshotAction(action: ManagerOrchestrationAction): ManagerProposedAction {
  return {
    id: action.id,
    projectId: action.target.projectId,
    ...(action.target.roundId ? { roundId: action.target.roundId } : {}),
    ...(action.target.taskId ? { taskId: action.target.taskId } : {}),
    ...(action.target.agentId ? { agentId: action.target.agentId } : {}),
    type: action.type,
    risk: action.risk,
    requiresApproval: action.requiresApproval,
    title: action.title,
    rationale: action.description || action.title,
    payload: {
      ...action.payload,
      ...(action.target.roundId ? { roundId: action.target.roundId } : {}),
      ...(action.target.taskId ? { taskId: action.target.taskId } : {}),
      ...(action.target.agentId ? { agentId: action.target.agentId } : {}),
    },
    evidenceIds: action.evidenceIds,
    agentResultIds: [],
    protocolTraceIds: [],
  };
}

function proposedActionTargetId(action: ManagerProposedAction): string {
  return (
    payloadString(action.payload, "taskId") ??
    action.taskId ??
    payloadString(action.payload, "agentId") ??
    action.agentId ??
    ""
  );
}

function proposedActionRoundId(action: ManagerProposedAction): string {
  return payloadString(action.payload, "roundId") ?? action.roundId ?? "";
}

function snapshotActionTargetId(action: ManagerOrchestrationAction): string {
  return action.target.taskId ?? action.target.agentId ?? "";
}

function snapshotActionRoundId(action: ManagerOrchestrationAction): string {
  return action.target.roundId ?? "";
}

function approvalActionSuppressionKeys(...actions: ManagerProposedAction[]): string[] {
  return [...new Set(actions.map((action) => proposedActionApprovalKey(action)))];
}

function proposedActionApprovalKey(action: ManagerProposedAction): string {
  return [
    action.type,
    action.projectId,
    proposedActionRoundId(action),
    proposedActionTargetId(action) || action.id,
  ].join(":");
}

function managerTaskStateLabel(state: ManagerTask["state"]): string {
  return t(`manager.orchestration.status.${state}`);
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
