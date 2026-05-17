import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type DiagnosticCheck,
  type DiagnosticReport,
  type DiagnosticSeverity,
  type DiagnosticStep,
  MANAGER_API_VERSION,
  type ManagerAcknowledgeResponse,
  type ManagerAgent,
  type ManagerAgentCreateRequest,
  type ManagerAgentListResponse,
  type ManagerAgentMessageRequest,
  type ManagerAgentMessageResponse,
  type ManagerAgentResult,
  type ManagerAgentResultListResponse,
  type ManagerAgentRole,
  type ManagerAgentStatus,
  type ManagerArtifact,
  type ManagerArtifactKind,
  type ManagerArtifactListResponse,
  type ManagerArtifactResponse,
  type ManagerArtifactScanRequest,
  type ManagerArtifactScanResponse,
  type ManagerArtifactStatus,
  type ManagerArtifactUpdateRequest,
  type ManagerArtifactUpsertInput,
  type ManagerAssistantChatContext,
  type ManagerAssistantChatMessage,
  type ManagerAssistantChatRequest,
  type ManagerAssistantChatResponse,
  type ManagerAssistantConversationState,
  type ManagerAssistantConversationStateInput,
  type ManagerAssistantDecisionOption,
  type ManagerAssistantStatusReport,
  type ManagerAssistantStatusReportInput,
  type ManagerAssistantStatusReportLevel,
  type ManagerAssistantStatusReportPhase,
  type ManagerAssistantStatusReportResponse,
  type ManagerAssistantStreamEvent,
  type ManagerAssistantStreamStatus,
  type ManagerAssistantStructuredState,
  type ManagerBlocker,
  type ManagerBlockerCreateRequest,
  type ManagerBlockerListResponse,
  type ManagerBlockerRequiredAction,
  type ManagerBlockerResolveRequest,
  type ManagerBlockerResponse,
  type ManagerBlockerSeverity,
  type ManagerBlockerSource,
  type ManagerCapabilities,
  type ManagerCommandFlowResponse,
  type ManagerCommandFlowStage,
  type ManagerDecision,
  type ManagerDecisionCreateRequest,
  type ManagerDecisionListResponse,
  type ManagerDecisionResponse,
  type ManagerDecisionStatus,
  type ManagerDecisionUpdateRequest,
  type ManagerDeviceActions,
  type ManagerDirectionChangeRequest,
  type ManagerDirectionChangeResponse,
  type ManagerEvent,
  type ManagerEventListResponse,
  type ManagerEvidenceItem,
  type ManagerEvidenceListResponse,
  type ManagerInstallStatus,
  type ManagerJudgmentListResponse,
  type ManagerJudgmentPacket,
  type ManagerLogResponse,
  type ManagerNetworkAddress,
  type ManagerNetworkKind,
  type ManagerNetworkStatus,
  type ManagerProject,
  type ManagerProjectCharter,
  type ManagerProjectCharterResponse,
  type ManagerProjectCharterUpdateRequest,
  type ManagerProjectCompleteRequest,
  type ManagerProjectCompleteResponse,
  type ManagerProjectCreateRequest,
  type ManagerProjectDirectionChange,
  type ManagerProjectFinalReview,
  type ManagerProjectHygieneCleanupRequest,
  type ManagerProjectHygieneCleanupResponse,
  type ManagerProjectHygieneIssue,
  type ManagerProjectHygieneIssueKind,
  type ManagerProjectHygieneReport,
  type ManagerProjectListResponse,
  type ManagerProjectOverviewAction,
  type ManagerProjectOverviewResponse,
  type ManagerProjectOverviewSignal,
  type ManagerProjectProtocolSource,
  type ManagerProjectResponse,
  type ManagerProjectStartRequest,
  type ManagerProjectStartResponse,
  type ManagerProjectStatus,
  type ManagerProjectUpdateRequest,
  type ManagerProposedAction,
  type ManagerProtocolFile,
  type ManagerProtocolFileRole,
  type ManagerProtocolResponse,
  type ManagerProtocolScanRequest,
  type ManagerProtocolState,
  type ManagerProtocolTrace,
  type ManagerProtocolTraceResponse,
  type ManagerProtocolUpdateRequest,
  type ManagerRegistrationDiagnosis,
  type ManagerRound,
  type ManagerRoundAgentAssignment,
  type ManagerRoundCreateRequest,
  type ManagerRoundDispatchRequest,
  type ManagerRoundDispatchResponse,
  type ManagerRoundHealthGate,
  type ManagerRoundHealthGateResponse,
  type ManagerRoundHealthIssue,
  type ManagerRoundListResponse,
  type ManagerRoundPhase,
  type ManagerRoundRepairResponse,
  type ManagerRoundReportResponse,
  type ManagerRoundReviewRequest,
  type ManagerRoundReviewResponse,
  type ManagerRoundStatus,
  type ManagerRouteCapability,
  type ManagerSecurityBoundary,
  type ManagerSecurityBoundarySummary,
  type ManagerSessionHygieneCategory,
  type ManagerSessionHygieneCleanupRequest,
  type ManagerSessionHygieneCleanupResponse,
  type ManagerSessionHygieneItem,
  type ManagerSessionHygieneReport,
  type ManagerStateBlocker,
  type ManagerStateRoundSummary,
  type ManagerStateTaskSummary,
  type ManagerStateViewResponse,
  type ManagerSystemSummary,
  type ManagerTask,
  type ManagerTaskKind,
  type ManagerTaskLogResponse,
  type ManagerTaskObservationResponse,
  type ManagerTaskRequest,
  type ManagerTaskState,
  type ManagerTaskStreamEvent,
  type ManagerUpdatePlan,
  type ManagerUpdateStatus,
  type ManagerUpdateTargetStatus,
  type ManagerWizardIntentAction,
  type ManagerWizardIntentEventInput,
  type ManagerWizardIntentEventKind,
  type ManagerWizardIntentImpact,
  type ManagerWorkerCheckResult,
  type ManagerWorkerListResponse,
  type ManagerWorkerProfile,
  type ManagerWorkerRun,
  type ManagerWorkerRunIntegrity,
  type ManagerWorkerRunLedgerResponse,
  type UpdateState,
  diagnosticStepFromCheck,
  normalizeDiagnosticStep,
} from "@deskrelay/shared";
import { type DeskRelayBuildInfo, getDeskRelayBuildInfo } from "@deskrelay/shared/version";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import {
  connectorNetworkKind,
  diagnoseConnectorReachability,
  networkKindForHost,
} from "./connector-diagnosis.ts";
import {
  type Device,
  type DeviceRegistry,
  DeviceRegistryError,
  normalizeDaemonUrl,
} from "./device-registry.ts";
import type {
  DeviceUpdateQueueStore,
  StoredDeviceUpdateEntry,
} from "./device-update-queue-store.ts";
import {
  buildOfflineDeviceUpdateEntry,
  buildRunningDeviceUpdateEntry,
} from "./device-update-workflow.ts";
import { loc } from "./i18n.ts";
import type { InstallReportStore } from "./install-report-store.ts";
import {
  type ManagerArtifactStore,
  type ManagerArtifactUpsertResult,
  createJsonManagerArtifactStore,
} from "./manager-artifact-store.ts";
import {
  type ManagerBlockerStore,
  createJsonManagerBlockerStore,
} from "./manager-blocker-store.ts";
import {
  type ManagerDecisionStore,
  createJsonManagerDecisionStore,
} from "./manager-decision-store.ts";
import {
  type ManagerEventBus,
  createManagerEventBus,
  withManagerArtifactEvents,
  withManagerBlockerEvents,
  withManagerDecisionEvents,
  withManagerOrchestrationEvents,
  withManagerProjectEvents,
  withManagerProtocolEvents,
  withManagerTaskEvents,
} from "./manager-event-bus.ts";
import {
  type ManagerOrchestrationStore,
  createJsonManagerOrchestrationStore,
} from "./manager-orchestration-store.ts";
import {
  type ManagerProjectStore,
  createJsonManagerProjectStore,
} from "./manager-project-store.ts";
import {
  type ManagerProtocolStore,
  createJsonManagerProtocolStore,
} from "./manager-protocol-store.ts";
import { type ManagerTaskStore, createInMemoryManagerTaskStore } from "./manager-task-store.ts";
import type {
  SelfServerAutostartController,
  SelfServerAutostartStatus,
} from "./self-server-autostart.ts";
import type { SelfServerProcessController } from "./self-server-process.ts";
import type { SelfServerUpdater } from "./self-server-update.ts";
import type { UpdateNoticeSource } from "./update-notice.ts";

export interface SiteAppOptions {
  registry: DeviceRegistry;
  token?: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  version?: string;
  build?: DeskRelayBuildInfo;
  announcement?: string;
  announcementUrl?: string;
  announcementPollMs?: number;
  updateNotice?: UpdateNoticeSource;
  localDaemonToken?: string;
  selfHostUrl?: string;
  selfServerAutostart?: SelfServerAutostartController;
  selfServerProcess?: SelfServerProcessController;
  selfServerUpdater?: SelfServerUpdater;
  updateBranch?: string;
  installReportStore?: InstallReportStore;
  deviceUpdateQueue?: DeviceUpdateQueueStore;
  managerEventBus?: ManagerEventBus;
  managerTaskStore?: ManagerTaskStore;
  managerOrchestrationStore?: ManagerOrchestrationStore;
  managerProjectStore?: ManagerProjectStore;
  managerDecisionStore?: ManagerDecisionStore;
  managerBlockerStore?: ManagerBlockerStore;
  managerArtifactStore?: ManagerArtifactStore;
  managerProtocolStore?: ManagerProtocolStore;
  managerProtocolBasePath?: string | null;
  managerAssistant?: ManagerAssistantOptions;
  managerWorkers?: ManagerWorkerProfileConfig[];
  logDir?: string;
}

export interface ManagerAssistantRunInput {
  message: string;
  history: ManagerAssistantChatMessage[];
  context: ManagerAssistantChatContext | undefined;
  assistantState?: ManagerAssistantStructuredState;
  managerSessionId?: string;
  cwd: string;
  repoRoot: string;
  instructionsPath: string;
  apiBaseUrl: string;
}

export interface ManagerAssistantRunResult {
  text: string;
  command: string;
  sessionId?: string;
}

export interface ManagerAssistantOptions {
  cwd?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  runner?: (input: ManagerAssistantRunInput) => Promise<ManagerAssistantRunResult>;
}

interface ManagerAssistantContextStores {
  repoRoot: string;
  projectStore: ManagerProjectStore;
  orchestrationStore: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  decisionStore: ManagerDecisionStore;
  blockerStore: ManagerBlockerStore;
  artifactStore: ManagerArtifactStore;
  protocolStore: ManagerProtocolStore;
}

export interface ManagerAssistantWorkspaceResponse {
  cwd: string;
  instructionsPath: string;
  repoRoot: string;
  deviceId?: string;
  deviceLabel?: string;
}

export interface ManagerWorkerProfileConfig {
  id: string;
  label: string;
  description: string;
  command: string;
  args?: string[];
  checkCommand?: string;
  checkArgs?: string[];
  destructive?: boolean;
  defaultTimeoutMs?: number;
  available?: boolean;
  runMode?: "argument" | "stdin";
  roles?: string[];
  risk?: ManagerWorkerProfile["risk"];
}

const DEFAULT_CONNECTOR_PORT = 18091;
const CONNECTOR_CLEANUP_TIMEOUT_MS = 5_000;
const DEFAULT_MANAGER_ASSISTANT_TIMEOUT_MS = 600_000;
const MAX_MANAGER_ASSISTANT_TIMEOUT_MS = 1_800_000;
const MANAGER_ASSISTANT_DIR = ".deskrelay/manager-assistant";
const MANAGER_PROJECTS_DIR = ".deskrelay/manager-projects";
const MANAGER_DECISIONS_DIR = ".deskrelay/manager-decisions";
const MANAGER_BLOCKERS_DIR = ".deskrelay/manager-blockers";
const MANAGER_ARTIFACTS_DIR = ".deskrelay/manager-artifacts";
const MANAGER_PROTOCOLS_DIR = ".deskrelay/manager-protocols";
const MANAGER_ASSISTANT_INSTRUCTIONS_FILE = "CLAUDE.md";
const MANAGER_ASSISTANT_STATUS_FILE = "status-reports.json";
const MANAGER_PROTOCOL_CORE_FILES: Array<{
  file: string;
  role: ManagerProtocolFileRole;
}> = [
  { file: "ORCHESTRATION.md", role: "orchestration" },
  { file: "AGENTS.md", role: "agents" },
  { file: "PROTOCOL.md", role: "protocol" },
  { file: "REVIEW.md", role: "review" },
  { file: "TASKS.md", role: "tasks" },
  { file: "STATE.md", role: "state" },
  { file: "FAILURES.md", role: "failures" },
  { file: "PROJECT.md", role: "project" },
  { file: "WORKER-CONTRACT.md", role: "other" },
  { file: "PROMPT-TEMPLATES.md", role: "other" },
  { file: "SPEC-SCHEMA.md", role: "other" },
  { file: "VERIFICATION.md", role: "other" },
];
const MANAGER_PROTOCOL_BASE_VERSION = "orchestration-lab-base";
const DEFAULT_MANAGER_PROTOCOL_BASE_PATH =
  process.env.DESKRELAY_MANAGER_PROTOCOL_BASE_PATH?.trim() ||
  "C:\\Users\\darkh\\Projects\\orchestration-lab";
const MANAGER_PROTOCOL_BASE_FILES = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "ARTIFACTS.md",
  "DIAGNOSTICS.md",
  "FAILURES.md",
  "LAB-LAYOUT.md",
  "ORCHESTRATION.md",
  "PROJECT.md",
  "PROMPT-TEMPLATES.md",
  "PROTOCOL.md",
  "QUALITY-STANDARDS.md",
  "QUICKSTART.md",
  "REVIEW.md",
  "SPEC-SCHEMA.md",
  "STATE.md",
  "TASKS.md",
  "VERIFICATION.md",
  "WORKER-CONTRACT.md",
  "dispatch-probe.ps1",
  "dispatch.ps1",
  "evaluate-spec.ps1",
  "invoke-adapter.ps1",
  "lib-common.ps1",
  "regenerate-views.ps1",
  "render-prompt.ps1",
  "smoke.ps1",
  "validate-spec.ps1",
];
const MANAGER_PROTOCOL_BASE_RULES = [
  "The manager supervises orchestration; workers perform substantive implementation.",
  "Every worker prompt declares objective, allowed paths, forbidden actions, expected artifacts, verification, final report, verbatim strings, and canonical examples when needed.",
  "Filesystem inspection and declared verification are canonical; worker process exit state is advisory.",
  "Failures update FAILURES.md and drive protocol deltas before the round closes.",
];
const MANAGER_PROTOCOL_MAX_FILE_BYTES = 200_000;
const MANAGER_PROTOCOL_EXCERPT_CHARS = 1_600;
const MANAGER_PROJECT_HYGIENE_ISSUE_KINDS: ManagerProjectHygieneIssueKind[] = [
  "missing-task",
  "missing-agent",
  "orphan-task",
  "stale-agent",
  "synthetic-failure",
  "missing-session",
  "missing-active-round",
  "archived-active-state",
];
const MANAGER_ASSISTANT_CONVERSATION_FILE = "conversation-state.json";
const MANAGER_ORCHESTRATION_FILE = "orchestration-state.json";
const MANAGER_ASSISTANT_CONVERSATION_ID = "deskrelay-manager-assistant";
const MANAGER_ASSISTANT_STATUS_LIMIT = 50;
const BROWSER_CLIENT_TTL_MS = 45_000;

export function createSiteApp(options: SiteAppOptions): Hono {
  const app = new Hono();
  const fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]> =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const registry = options.registry;
  const localToken = options.localDaemonToken;
  const announcements = createAnnouncementSource(options, fetchImpl);
  const build = options.build ?? getDeskRelayBuildInfo();
  const managerRepoRoot = options.managerAssistant?.cwd ?? process.cwd();
  const managerEventBus = options.managerEventBus ?? createManagerEventBus();
  const managerTaskStore = withManagerTaskEvents(
    options.managerTaskStore ?? createInMemoryManagerTaskStore(),
    managerEventBus,
  );
  const managerProjectStore = withManagerProjectEvents(
    options.managerProjectStore ??
      createJsonManagerProjectStore(join(managerRepoRoot, MANAGER_PROJECTS_DIR)),
    managerEventBus,
  );
  const managerDecisionStore = withManagerDecisionEvents(
    options.managerDecisionStore ??
      createJsonManagerDecisionStore(join(managerRepoRoot, MANAGER_DECISIONS_DIR)),
    managerEventBus,
  );
  const managerBlockerStore = withManagerBlockerEvents(
    options.managerBlockerStore ??
      createJsonManagerBlockerStore(join(managerRepoRoot, MANAGER_BLOCKERS_DIR)),
    managerEventBus,
  );
  const managerArtifactStore = withManagerArtifactEvents(
    options.managerArtifactStore ??
      createJsonManagerArtifactStore(join(managerRepoRoot, MANAGER_ARTIFACTS_DIR)),
    managerEventBus,
  );
  const managerProtocolStore = withManagerProtocolEvents(
    options.managerProtocolStore ??
      createJsonManagerProtocolStore(join(managerRepoRoot, MANAGER_PROTOCOLS_DIR)),
    managerEventBus,
  );
  const managerOrchestrationStore = withManagerOrchestrationEvents(
    options.managerOrchestrationStore ??
      createJsonManagerOrchestrationStore(
        join(managerRepoRoot, MANAGER_ASSISTANT_DIR, MANAGER_ORCHESTRATION_FILE),
      ),
    managerEventBus,
  );
  const managerAssistantContextStores: ManagerAssistantContextStores = {
    repoRoot: managerRepoRoot,
    projectStore: managerProjectStore,
    orchestrationStore: managerOrchestrationStore,
    taskStore: managerTaskStore,
    decisionStore: managerDecisionStore,
    blockerStore: managerBlockerStore,
    artifactStore: managerArtifactStore,
    protocolStore: managerProtocolStore,
  };
  const managerRuntimeRecovery = recoverStaleManagerRuntimeState(
    managerTaskStore,
    managerOrchestrationStore,
    build,
  ).catch(() => undefined);
  const browserClients = new Map<string, number>();

  async function ensureManagerRuntimeRecovered(): Promise<void> {
    await managerRuntimeRecovery;
  }

  function activeBrowserClientCount(now = Date.now()): number {
    for (const [clientId, lastSeen] of browserClients.entries()) {
      if (now - lastSeen > BROWSER_CLIENT_TTL_MS) browserClients.delete(clientId);
    }
    return browserClients.size;
  }

  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      version: options.version ?? build.version,
      build,
      devices: registry.list().length,
    }),
  );

  app.get("/api/announcement", async (c) => {
    const updatePayload = await readUpdateNotice(options.updateNotice);
    const operatorPayload = announcementPayload(await announcements.read());
    return c.json(combineAnnouncementPayloads(updatePayload, operatorPayload));
  });

  if (options.token) {
    app.use("/api/*", async (c, next) => {
      const path = new URL(c.req.url).pathname;
      if (path === "/api/announcement") return await next();
      return await bearerAuth({ token: options.token ?? "" })(c, next);
    });
  }

  app.get("/api/capabilities", (c) => c.json(serverCapabilities(options)));

  app.use("/api/manager/*", async (_c, next) => {
    await ensureManagerRuntimeRecovered();
    await next();
  });

  app.get("/api/manager/events/recent", (c) => {
    const afterSeq = parseManagerEventSeq(c.req.query("afterSeq"));
    const response: ManagerEventListResponse = {
      generatedAt: new Date().toISOString(),
      lastSeq: managerEventBus.getLastSeq(),
      events: managerEventBus.recent(afterSeq),
    };
    return c.json(response);
  });

  app.get("/api/manager/events/stream", (c) => {
    const afterSeq = parseManagerEventSeq(c.req.query("afterSeq") ?? c.req.header("Last-Event-ID"));
    return streamManagerEvents(managerEventBus, afterSeq);
  });

  app.post("/api/self/browser/presence", async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { clientId?: unknown };
    const clientId = typeof input.clientId === "string" ? input.clientId.trim().slice(0, 128) : "";
    if (!clientId) return c.json({ error: "clientId is required" }, 400);
    const now = Date.now();
    browserClients.set(clientId, now);
    return c.json({
      activeClients: activeBrowserClientCount(now),
      clientId,
      generatedAt: new Date(now).toISOString(),
    });
  });

  app.post("/api/self/browser/refresh", (c) => {
    const activeClients = activeBrowserClientCount();
    const event = managerEventBus.emit({ type: "browser.refresh", activeClients });
    return c.json({
      accepted: true,
      activeClients,
      eventSeq: event.seq,
      generatedAt: event.generatedAt,
    });
  });

  app.get("/api/manager/assistant/workspace", async (c) => {
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const apiBaseUrl = managerAssistantApiBaseUrl(options, c.req.url);
      const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
      const device = registry.list().find(isServerDevice);
      const response: ManagerAssistantWorkspaceResponse = {
        cwd: workspace.cwd,
        instructionsPath: workspace.instructionsPath,
        repoRoot,
        ...(device ? { deviceId: device.id, deviceLabel: device.label } : {}),
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/manager/assistant/conversation", async (c) => {
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      return c.json(await readManagerAssistantConversationState(repoRoot));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.put("/api/manager/assistant/conversation", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerAssistantConversationStateInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      return c.json(await writeManagerAssistantConversationState(repoRoot, parsed.value));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/manager/assistant/status", async (c) => {
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const limit = clampListLimit(c.req.query("limit"));
      return c.json(await readManagerAssistantStatusReports(repoRoot, limit));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/manager/assistant/status", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerAssistantStatusReportInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const response = await appendManagerAssistantStatusReport(repoRoot, parsed.value);
      if (response.latest) {
        managerEventBus.emit({ type: "assistant.status", report: response.latest });
      }
      return c.json(response, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.get("/api/manager/state", async (c) => {
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const statusReports = await readManagerAssistantStatusReports(repoRoot, 1);
      return c.json(
        await buildManagerStateView({
          taskStore: managerTaskStore,
          orchestrationStore: managerOrchestrationStore,
          latestStatus: statusReports.latest,
          now: new Date(),
        }),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/manager/state/acknowledge", async (c) => {
    const parsed = await parseManagerAcknowledgeRequest(c.req);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      const response = await acknowledgeManagerStateFailures({
        taskStore: managerTaskStore,
        orchestrationStore: managerOrchestrationStore,
        input: parsed.value,
        now: new Date(),
      });
      return c.json(response);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/manager/projects", async (c) => {
    try {
      const result = await managerProjectStore.list();
      const response: ManagerProjectListResponse = {
        generatedAt: new Date().toISOString(),
        ...result,
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/manager/projects", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProjectCreateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const seed =
        parsed.value.protocolSource === "base-copy"
          ? await seedManagerProjectProtocolFromBase(
              parsed.value.cwd,
              options.managerProtocolBasePath,
            )
          : undefined;
      const project = await managerProjectStore.create(parsed.value);
      if (seed) {
        const decision = await managerDecisionStore.create(project.id, {
          title: "Seed orchestration base protocol",
          detail: `Copied ${seed.copied.length} base protocol file(s) from ${seed.sourceRoot}. ${seed.skipped.length} existing file(s) were kept for customization.`,
          rationale: "The project was created from the DeskRelay orchestration-lab base protocol.",
          tags: ["protocol", "base"],
          createdBy: "system",
        });
        await managerProtocolStore.update(project.id, {
          version: MANAGER_PROTOCOL_BASE_VERSION,
          activeRules: MANAGER_PROTOCOL_BASE_RULES,
          latestChange: {
            summary: `Seeded from orchestration-lab base (${seed.copied.length} copied, ${seed.skipped.length} existing).`,
            decisionId: decision.id,
          },
        });
      }
      const response: ManagerProjectResponse = {
        generatedAt: new Date().toISOString(),
        project,
      };
      return c.json(response, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/manager/projects/:id/rounds", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const rounds = await managerOrchestrationStore.listRounds();
    const response: ManagerRoundListResponse = {
      generatedAt: new Date().toISOString(),
      rounds: rounds.filter(
        (round) => round.projectId === project.id || round.id === project.activeRoundId,
      ),
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id/agents", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    const rounds = await managerOrchestrationStore.listRounds();
    const projectRoundIds = new Set(
      rounds
        .filter((round) => round.projectId === project.id || round.id === project.activeRoundId)
        .map((round) => round.id),
    );
    const response: ManagerAgentListResponse = {
      generatedAt: new Date().toISOString(),
      agents: (await managerOrchestrationStore.listAgents()).filter(
        (agent) =>
          agent.projectId === project.id ||
          Boolean(agent.roundId && projectRoundIds.has(agent.roundId)),
      ),
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id/tasks", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const rounds = await managerOrchestrationStore.listRounds();
    const projectRoundIds = new Set(
      rounds
        .filter((round) => round.projectId === project.id || round.id === project.activeRoundId)
        .map((round) => round.id),
    );
    const projectTaskIds = new Set(
      rounds.filter((round) => projectRoundIds.has(round.id)).flatMap((round) => round.taskIds),
    );
    return c.json({
      generatedAt: new Date().toISOString(),
      tasks: (await managerTaskStore.list(clampListLimit(c.req.query("limit"))))
        .filter(
          (task) =>
            task.projectId === project.id ||
            projectTaskIds.has(task.id) ||
            (typeof task.params?.roundId === "string" && projectRoundIds.has(task.params.roundId)),
        )
        .map(sanitizeManagerTaskForAssistant),
    });
  });

  app.get("/api/manager/projects/:id/runs", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    return c.json(
      await buildManagerWorkerRunLedger({
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        projectId: project.id,
        limit: clampListLimit(c.req.query("limit")),
        now: new Date(),
      }),
    );
  });

  app.get("/api/manager/projects/:id/overview", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    return c.json(
      await buildManagerProjectOverview({
        project,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        artifactStore: managerArtifactStore,
        now: new Date(),
      }),
    );
  });

  app.get("/api/manager/projects/:id/command-flow", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    return c.json(
      await buildManagerCommandFlow({
        project,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        decisionStore: managerDecisionStore,
        blockerStore: managerBlockerStore,
        artifactStore: managerArtifactStore,
        protocolStore: managerProtocolStore,
        repoRoot: managerRepoRoot,
        now: new Date(),
      }),
    );
  });

  app.get("/api/manager/projects/:id/evidence", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    const flow = await buildManagerCommandFlow({
      project,
      orchestrationStore: managerOrchestrationStore,
      taskStore: managerTaskStore,
      decisionStore: managerDecisionStore,
      blockerStore: managerBlockerStore,
      artifactStore: managerArtifactStore,
      protocolStore: managerProtocolStore,
      repoRoot: managerRepoRoot,
      now: new Date(),
    });
    const response: ManagerEvidenceListResponse = {
      generatedAt: flow.generatedAt,
      projectId: project.id,
      evidence: flow.evidence,
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id/judgments", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    const flow = await buildManagerCommandFlow({
      project,
      orchestrationStore: managerOrchestrationStore,
      taskStore: managerTaskStore,
      decisionStore: managerDecisionStore,
      blockerStore: managerBlockerStore,
      artifactStore: managerArtifactStore,
      protocolStore: managerProtocolStore,
      repoRoot: managerRepoRoot,
      now: new Date(),
    });
    const response: ManagerJudgmentListResponse = {
      generatedAt: flow.generatedAt,
      projectId: project.id,
      judgments: flow.judgments,
      evidence: flow.evidence,
      agentResults: flow.agentResults,
      protocolTrace: flow.protocolTrace,
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id/protocol-trace", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    const flow = await buildManagerCommandFlow({
      project,
      orchestrationStore: managerOrchestrationStore,
      taskStore: managerTaskStore,
      decisionStore: managerDecisionStore,
      blockerStore: managerBlockerStore,
      artifactStore: managerArtifactStore,
      protocolStore: managerProtocolStore,
      repoRoot: managerRepoRoot,
      now: new Date(),
    });
    const response: ManagerProtocolTraceResponse = {
      generatedAt: flow.generatedAt,
      projectId: project.id,
      trace: flow.protocolTrace,
      evidence: flow.evidence.filter((item) => item.type === "protocol"),
    };
    return c.json(response);
  });

  app.put("/api/manager/projects/:id/charter", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProjectCharterUpdateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const current = await managerProjectStore.get(c.req.param("id"));
    if (!current) return c.json({ error: "unknown project" }, 404);
    const beforeCharter = effectiveProjectCharter(current);
    const charter = mergeManagerProjectCharter(current, parsed.value, new Date());
    const wizardEvent =
      parsed.value.wizardEvent ??
      buildManagerCharterWizardEvent(current, beforeCharter, charter, new Date());
    const project = await managerProjectStore.update(current.id, {
      charter,
      goal: charter.goal || current.goal,
      flowStage: current.flowStage === "draft" || !current.flowStage ? "draft" : current.flowStage,
      ...(wizardEvent ? { wizardEvent } : {}),
    });
    if (!project) return c.json({ error: "unknown project" }, 404);
    const response: ManagerProjectCharterResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      charter: project.charter ?? charter,
      project,
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/prepare", async (c) => {
    const current = await managerProjectStore.get(c.req.param("id"));
    if (!current) return c.json({ error: "unknown project" }, 404);
    const protocol = await buildManagerProjectProtocolState({
      project: current,
      protocolStore: managerProtocolStore,
      includeExcerpt: false,
    });
    const stage = protocol.files.some((file) => file.status === "present")
      ? managerCommandFlowReadiness(current, protocol, [], managerRepoRoot).ready
        ? "ready_to_start"
        : "protocol_ready"
      : "draft";
    const project =
      (await managerProjectStore.update(current.id, {
        flowStage: stage,
      })) ?? current;
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    return c.json(
      await buildManagerCommandFlow({
        project,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        decisionStore: managerDecisionStore,
        blockerStore: managerBlockerStore,
        artifactStore: managerArtifactStore,
        protocolStore: managerProtocolStore,
        repoRoot: managerRepoRoot,
        now: new Date(),
      }),
    );
  });

  app.post("/api/manager/projects/:id/start", async (c) => {
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProjectStartRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const commandFlowPreflight = await buildManagerCommandFlow({
      project,
      orchestrationStore: managerOrchestrationStore,
      taskStore: managerTaskStore,
      decisionStore: managerDecisionStore,
      blockerStore: managerBlockerStore,
      artifactStore: managerArtifactStore,
      protocolStore: managerProtocolStore,
      repoRoot: managerRepoRoot,
      now: new Date(),
    });
    if (!commandFlowPreflight.readiness.ready) {
      return c.json(
        {
          error: "project is not ready to start",
          readiness: commandFlowPreflight.readiness,
          commandFlow: commandFlowPreflight,
        },
        409,
      );
    }
    const phase = parsed.value.phase ?? "design";
    const charter = effectiveProjectCharter(project);
    const objective = parsed.value.objective?.trim() || project.goal || charter.goal;
    if (!objective.trim()) return c.json({ error: "project start objective is required" }, 400);
    const round = await managerOrchestrationStore.createRound({
      projectId: project.id,
      title: parsed.value.title?.trim() || managerRoundTitleForPhase(phase),
      objective,
      phase,
    });
    const assignments = parsed.value.assignments?.length
      ? parsed.value.assignments
      : defaultManagerProjectAssignments(project, charter, phase, objective);
    await managerProjectStore.update(project.id, {
      activeRoundId: round.id,
      status: "running",
      flowStage: "running",
    });
    const dispatch = await dispatchManagerRound({
      round,
      request: {
        assignments,
        dryRun: parsed.value.dryRun ?? false,
      },
      store: managerOrchestrationStore,
      taskStore: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    const updatedProject =
      (await managerProjectStore.update(project.id, {
        activeRoundId: dispatch.round.id,
        status: projectStatusFromRoundStatus(dispatch.round.status),
        flowStage: projectFlowStageFromRoundStatus(dispatch.round.status),
        ...(dispatch.round.summary ? { summary: dispatch.round.summary } : {}),
        ...(dispatch.round.error ? { error: dispatch.round.error } : { error: null }),
      })) ?? project;
    const response: ManagerProjectStartResponse = {
      generatedAt: new Date().toISOString(),
      project: updatedProject,
      round: dispatch.round,
      dispatch,
      commandFlow: await buildManagerCommandFlow({
        project: updatedProject,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        decisionStore: managerDecisionStore,
        blockerStore: managerBlockerStore,
        artifactStore: managerArtifactStore,
        protocolStore: managerProtocolStore,
        repoRoot: managerRepoRoot,
        now: new Date(),
      }),
    };
    return c.json(response, dispatch.round.status === "blocked" ? 409 : 202);
  });

  app.get("/api/manager/projects/:id/hygiene", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      return c.json(
        await buildManagerProjectHygieneReport({
          project,
          orchestrationStore: managerOrchestrationStore,
          taskStore: managerTaskStore,
          blockerStore: managerBlockerStore,
          now: new Date(),
        }),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/manager/projects/:id/hygiene/cleanup", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProjectHygieneCleanupRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      const result = await cleanupManagerProjectHygiene({
        project,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        blockerStore: managerBlockerStore,
        request: parsed.value,
        now: new Date(),
      });
      return c.json(result);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/manager/projects/:id/decisions", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const result = await managerDecisionStore.list(project.id);
    const response: ManagerDecisionListResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      ...result,
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/decisions", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerDecisionCreateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const decision = await managerDecisionStore.create(project.id, parsed.value);
    const response: ManagerDecisionResponse = {
      generatedAt: new Date().toISOString(),
      decision,
    };
    return c.json(response, 201);
  });

  app.patch("/api/manager/projects/:id/decisions/:decisionId", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerDecisionUpdateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const decision = await managerDecisionStore.update(
      project.id,
      c.req.param("decisionId"),
      parsed.value,
    );
    if (!decision) return c.json({ error: "unknown decision" }, 404);
    const response: ManagerDecisionResponse = {
      generatedAt: new Date().toISOString(),
      decision,
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id/blockers", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const result = await managerBlockerStore.list(project.id);
    const response: ManagerBlockerListResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      ...result,
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/blockers", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerBlockerCreateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = await managerBlockerStore.create(project.id, parsed.value);
    const response: ManagerBlockerResponse = {
      generatedAt: new Date().toISOString(),
      blocker: result.blocker,
      created: result.created,
    };
    return c.json(response, result.created ? 201 : 200);
  });

  app.post("/api/manager/projects/:id/blockers/:blockerId/resolve", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerBlockerResolveRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const blocker = await managerBlockerStore.resolve(
      project.id,
      c.req.param("blockerId"),
      parsed.value,
    );
    if (!blocker) return c.json({ error: "unknown blocker" }, 404);
    const response: ManagerBlockerResponse = {
      generatedAt: new Date().toISOString(),
      blocker,
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id/artifacts", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const result = await managerArtifactStore.list(project.id);
    const response: ManagerArtifactListResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      ...result,
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/artifacts/scan", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerArtifactScanRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    const result = await scanManagerProjectArtifacts({
      project,
      orchestrationStore: managerOrchestrationStore,
      taskStore: managerTaskStore,
      artifactStore: managerArtifactStore,
      now: new Date(),
      ...(parsed.value.limit !== undefined ? { limit: parsed.value.limit } : {}),
    });
    const response: ManagerArtifactScanResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      artifacts: result.artifacts,
      inactive: result.inactive,
      created: result.created.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
    };
    return c.json(response);
  });

  app.patch("/api/manager/projects/:id/artifacts/:artifactId", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerArtifactUpdateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const artifact = await managerArtifactStore.update(
      project.id,
      c.req.param("artifactId"),
      parsed.value,
    );
    if (!artifact) return c.json({ error: "unknown artifact" }, 404);
    const response: ManagerArtifactResponse = {
      generatedAt: new Date().toISOString(),
      artifact,
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id/protocol", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const response: ManagerProtocolResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      protocol: await buildManagerProjectProtocolState({
        project,
        protocolStore: managerProtocolStore,
        includeExcerpt: true,
      }),
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/protocol/scan", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProtocolScanRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const response: ManagerProtocolResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      protocol: await buildManagerProjectProtocolState({
        project,
        protocolStore: managerProtocolStore,
        includeExcerpt: parsed.value.includeExcerpt ?? true,
        ...(parsed.value.limit !== undefined ? { limit: parsed.value.limit } : {}),
      }),
    };
    return c.json(response);
  });

  app.patch("/api/manager/projects/:id/protocol", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProtocolUpdateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    await managerProtocolStore.update(project.id, parsed.value);
    const response: ManagerProtocolResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      protocol: await buildManagerProjectProtocolState({
        project,
        protocolStore: managerProtocolStore,
        includeExcerpt: true,
      }),
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/rounds/:roundId/review", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerRoundReviewRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const round = await managerOrchestrationStore.getRound(c.req.param("roundId"));
    if (!round || (round.projectId && round.projectId !== project.id)) {
      return c.json({ error: "unknown round" }, 404);
    }
    const now = new Date();
    const decision = await managerDecisionStore.create(project.id, {
      title: managerRoundReviewDecisionTitle(parsed.value.action),
      detail: parsed.value.summary || round.summary || round.objective,
      rationale: `Round ${round.id} reviewed as ${parsed.value.action}.`,
      roundId: round.id,
      tags: ["review", parsed.value.action],
      createdBy: "browser",
    });
    let blocker: ManagerBlocker | undefined;
    let nextRound: ManagerRound | undefined;
    if (parsed.value.action === "user_check_required") {
      const blockerResult = await managerBlockerStore.create(project.id, {
        title: "User verification required",
        detail: parsed.value.summary || "The round result needs a direct user check.",
        severity: "warning",
        owner: "user",
        requiredAction: "user",
        source: "browser",
        roundId: round.id,
      });
      blocker = blockerResult.blocker;
    }
    if (
      parsed.value.createNextRound &&
      parsed.value.nextObjective &&
      ["request_changes", "replan"].includes(parsed.value.action)
    ) {
      nextRound = await managerOrchestrationStore.createRound({
        projectId: project.id,
        title: managerRoundTitleForPhase("replan"),
        objective: parsed.value.nextObjective,
        phase: "replan",
      });
    }
    const projectPatch: ManagerProjectUpdateRequest = {
      flowStage:
        parsed.value.action === "accept"
          ? "review"
          : parsed.value.action === "stop"
            ? "replanning"
            : "replanning",
      status: parsed.value.action === "accept" ? "reviewing" : "blocked",
      summary: parsed.value.summary || decision.detail,
      ...(nextRound ? { activeRoundId: nextRound.id } : {}),
    };
    if (parsed.value.action === "stop") {
      await managerOrchestrationStore.updateRound(round.id, {
        status: "cancelled",
        completedAt: now.toISOString(),
        summary: parsed.value.summary || "Stopped during user review.",
      });
    }
    const updatedProject = (await managerProjectStore.update(project.id, projectPatch)) ?? project;
    const response: ManagerRoundReviewResponse = {
      generatedAt: now.toISOString(),
      project: updatedProject,
      decision,
      ...(blocker ? { blocker } : {}),
      ...(nextRound ? { nextRound } : {}),
      commandFlow: await buildManagerCommandFlow({
        project: updatedProject,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        decisionStore: managerDecisionStore,
        blockerStore: managerBlockerStore,
        artifactStore: managerArtifactStore,
        protocolStore: managerProtocolStore,
        repoRoot: managerRepoRoot,
        now,
      }),
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/direction-change", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerDirectionChangeRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const activeRound = project.activeRoundId
      ? await managerOrchestrationStore.getRound(project.activeRoundId)
      : undefined;
    const now = new Date();
    if (
      activeRound &&
      (parsed.value.currentRoundAction === "cancel" ||
        parsed.value.currentRoundAction === "supersede")
    ) {
      await managerOrchestrationStore.updateRound(activeRound.id, {
        status: "cancelled",
        completedAt: now.toISOString(),
        summary:
          parsed.value.currentRoundAction === "supersede"
            ? "Superseded by a direction change."
            : "Cancelled by a direction change.",
      });
    }
    const decision = await managerDecisionStore.create(project.id, {
      title: "Direction change",
      detail: parsed.value.requestedChange,
      rationale: parsed.value.impact || "User changed the orchestration direction.",
      ...(activeRound ? { roundId: activeRound.id } : {}),
      tags: ["direction-change", parsed.value.currentRoundAction ?? "keep"],
      createdBy: "browser",
    });
    let nextRound: ManagerRound | undefined;
    if (parsed.value.nextObjective) {
      nextRound = await managerOrchestrationStore.createRound({
        projectId: project.id,
        title: managerRoundTitleForPhase("replan"),
        objective: parsed.value.nextObjective,
        phase: "replan",
      });
    }
    const directionChange: ManagerProjectDirectionChange = {
      previousDirection: activeRound?.objective || project.goal,
      requestedChange: parsed.value.requestedChange,
      impact: parsed.value.impact ?? "",
      affectedProtocol: parsed.value.affectedProtocol ?? "",
      affectedArtifacts: parsed.value.affectedArtifacts ?? "",
      decisionId: decision.id,
      ...(nextRound ? { nextRoundId: nextRound.id } : {}),
      changedAt: now.toISOString(),
      changedBy: "browser",
    };
    const nextStatus: ManagerProjectStatus = project.status === "blocked" ? "blocked" : "planning";
    const updatedProject =
      (await managerProjectStore.update(project.id, {
        status: nextStatus,
        flowStage: "replanning",
        lastDirectionChange: directionChange,
        ...(nextRound ? { activeRoundId: nextRound.id } : {}),
        summary: parsed.value.requestedChange,
      })) ?? project;
    const response: ManagerDirectionChangeResponse = {
      generatedAt: now.toISOString(),
      project: updatedProject,
      decision,
      ...(nextRound ? { nextRound } : {}),
      commandFlow: await buildManagerCommandFlow({
        project: updatedProject,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        decisionStore: managerDecisionStore,
        blockerStore: managerBlockerStore,
        artifactStore: managerArtifactStore,
        protocolStore: managerProtocolStore,
        repoRoot: managerRepoRoot,
        now,
      }),
    };
    return c.json(response);
  });

  app.post("/api/manager/projects/:id/complete", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProjectCompleteRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const now = new Date();
    const finalReview: ManagerProjectFinalReview = {
      summary: parsed.value.summary || project.summary || project.goal,
      goalMatched: parsed.value.goalMatched ?? true,
      acceptedByUser: parsed.value.acceptedByUser ?? false,
      remainingRisks: parsed.value.remainingRisks ?? "",
      verificationEvidence: parsed.value.verificationEvidence ?? "",
      artifacts: parsed.value.artifacts ?? [],
      completedAt: now.toISOString(),
      completedBy: "browser",
    };
    const decision = await managerDecisionStore.create(project.id, {
      title: "Project final review",
      detail: finalReview.summary,
      rationale: finalReview.verificationEvidence || "Final orchestration result recorded.",
      tags: ["final-review", finalReview.acceptedByUser ? "accepted" : "unaccepted"],
      createdBy: "browser",
    });
    const updatedProject =
      (await managerProjectStore.update(project.id, {
        status: "completed",
        flowStage: "completed",
        finalReview,
        summary: finalReview.summary,
        error: null,
      })) ?? project;
    const response: ManagerProjectCompleteResponse = {
      generatedAt: now.toISOString(),
      project: updatedProject,
      decision,
      commandFlow: await buildManagerCommandFlow({
        project: updatedProject,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        decisionStore: managerDecisionStore,
        blockerStore: managerBlockerStore,
        artifactStore: managerArtifactStore,
        protocolStore: managerProtocolStore,
        repoRoot: managerRepoRoot,
        now,
      }),
    };
    return c.json(response);
  });

  app.get("/api/manager/projects/:id", async (c) => {
    const project = await managerProjectStore.get(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const response: ManagerProjectResponse = {
      generatedAt: new Date().toISOString(),
      project,
    };
    return c.json(response);
  });

  app.patch("/api/manager/projects/:id", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerProjectUpdateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const project = await managerProjectStore.update(c.req.param("id"), parsed.value);
      if (!project) return c.json({ error: "unknown project" }, 404);
      const response: ManagerProjectResponse = {
        generatedAt: new Date().toISOString(),
        project,
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/manager/projects/:id/archive", async (c) => {
    const project = await managerProjectStore.archive(c.req.param("id"));
    if (!project) return c.json({ error: "unknown project" }, 404);
    const response: ManagerProjectResponse = {
      generatedAt: new Date().toISOString(),
      project,
    };
    return c.json(response);
  });

  app.get("/api/manager/worker-runs", async (c) => {
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      return c.json(
        await buildManagerWorkerRunLedger({
          orchestrationStore: managerOrchestrationStore,
          taskStore: managerTaskStore,
          limit: clampListLimit(c.req.query("limit")),
          now: new Date(),
        }),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/manager/sessions/read", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerSessionReadRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = await readManagerSessionTranscript(
      fetchImpl,
      registry,
      localToken,
      parsed.value,
    );
    if (!result.ok) {
      return c.json({ error: result.error, attempts: result.attempts }, result.status as never);
    }
    return c.json(result.value);
  });

  app.get("/api/manager/sessions/hygiene", async (c) => {
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const report = await buildManagerSessionHygieneReport({
        repoRoot,
        registry,
        fetchImpl,
        localToken,
      });
      return c.json(report);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/manager/sessions/hygiene/cleanup", async (c) => {
    let body: unknown = {};
    try {
      const text = await c.req.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerSessionHygieneCleanupRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
      const result = await cleanupManagerSessionHygiene({
        repoRoot,
        registry,
        fetchImpl,
        localToken,
        request: parsed.value,
      });
      if (!parsed.value.dryRun) {
        managerEventBus.emit({ type: "hygiene.updated", report: result.report });
      }
      return c.json(result);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/manager/tasks", async (c) => {
    return c.json({
      tasks: (await managerTaskStore.list(clampListLimit(c.req.query("limit")))).map(
        sanitizeManagerTaskForAssistant,
      ),
    });
  });

  app.post("/api/manager/tasks", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const request = parseManagerTaskRequest(body);
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/tasks/:id/logs", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(sanitizeManagerTaskLogForAssistant(buildManagerTaskLogResponse(task)));
  });

  app.get("/api/manager/tasks/:id/observe", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(buildManagerTaskObservation(task));
  });

  app.get("/api/manager/tasks/:id/stream", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return streamManagerTaskObservation(managerTaskStore, task.id);
  });

  app.post("/api/manager/tasks/:id/cancel", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    const cancelled = await cancelManagerTask(task, managerTaskStore, options.deviceUpdateQueue);
    if (!cancelled.ok) {
      return c.json(
        {
          error: cancelled.error ?? "task cannot be cancelled",
          task: sanitizeManagerTaskForAssistant(task),
        },
        409,
      );
    }
    return c.json(sanitizeManagerTaskForAssistant(cancelled.task), 202);
  });

  app.post("/api/manager/tasks/:id/retry", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    const retry = buildRetryManagerTaskRequest(task);
    if (!retry.ok) {
      return c.json({ error: retry.error, task: sanitizeManagerTaskForAssistant(task) }, 409);
    }
    const completed = await createAndRunManagerTask({
      request: retry.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.post("/api/manager/tasks/:id/acknowledge", async (c) => {
    const parsed = await parseManagerAcknowledgeRequest(c.req);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    const acknowledged = await acknowledgeManagerTask(
      managerTaskStore,
      task,
      parsed.value,
      new Date(),
    );
    if (!acknowledged.ok) {
      return c.json(
        { error: acknowledged.error, task: sanitizeManagerTaskForAssistant(task) },
        409,
      );
    }
    return c.json(sanitizeManagerTaskForAssistant(acknowledged.task));
  });

  app.get("/api/manager/tasks/:id", async (c) => {
    const task = await managerTaskStore.get(c.req.param("id"));
    if (!task) return c.json({ error: "unknown task" }, 404);
    return c.json(sanitizeManagerTaskForAssistant(task));
  });

  app.post("/api/manager/assistant/chat", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const request = parseManagerAssistantChatRequest(body);
    if (!request.ok) return c.json({ error: request.error }, 400);
    try {
      return c.json(
        await runManagerAssistantChat(
          request.value,
          options,
          c.req.url,
          managerAssistantContextStores,
        ),
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/api/manager/assistant/chat/stream", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const request = parseManagerAssistantChatRequest(body);
    if (!request.ok) return c.json({ error: request.error }, 400);
    return streamManagerAssistantChat(
      request.value,
      options,
      c.req.url,
      managerAssistantContextStores,
    );
  });

  app.get("/api/manager/workers", (c) => {
    return c.json(buildManagerWorkerList(options));
  });

  app.get("/api/manager/workers/:id", (c) => {
    const profile = findManagerWorkerProfile(options, c.req.param("id"));
    if (!profile) return c.json({ error: "unknown worker profile" }, 404);
    return c.json(profile);
  });

  app.post("/api/manager/workers/:id/check", async (c) => {
    const profile = findManagerWorkerProfile(options, c.req.param("id"));
    if (!profile) return c.json({ error: "unknown worker profile" }, 404);
    return c.json(await checkManagerWorkerProfile(profile));
  });

  app.post("/api/manager/workers/run", async (c) => {
    const request = await parseManagerWorkerRunRequest(c.req);
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken: options.localDaemonToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/agents", async (c) => {
    const agents = await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    const response: ManagerAgentListResponse = {
      generatedAt: new Date().toISOString(),
      agents,
    };
    return c.json(response);
  });

  app.post("/api/manager/agents", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerAgentCreateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const agent = await managerOrchestrationStore.createAgent(parsed.value);
    return c.json(agent, 201);
  });

  app.get("/api/manager/agents/:id", async (c) => {
    const agent = await syncManagerAgentWithTask(
      managerOrchestrationStore,
      managerTaskStore,
      c.req.param("id"),
    );
    if (!agent) return c.json({ error: "unknown agent" }, 404);
    return c.json(agent);
  });

  app.post("/api/manager/agents/:id/message", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerAgentMessageRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const agent = await managerOrchestrationStore.getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "unknown agent" }, 404);
    const response = await runManagerAgentMessage({
      agent,
      message: parsed.value,
      store: managerOrchestrationStore,
      taskStore: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(response, response.task.state === "blocked" ? 409 : 202);
  });

  app.post("/api/manager/agents/:id/stop", async (c) => {
    const agent = await managerOrchestrationStore.getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "unknown agent" }, 404);
    let task: ManagerTask | undefined;
    if (agent.taskId) {
      task = await managerTaskStore.get(agent.taskId);
      if (task && !isManagerTaskTerminalState(task.state)) {
        const cancelled = await cancelManagerTask(
          task,
          managerTaskStore,
          options.deviceUpdateQueue,
        );
        task = cancelled.task;
      }
    }
    const updated =
      (await managerOrchestrationStore.updateAgent(agent.id, {
        status: "cancelled",
        ...(task?.id ? { taskId: task.id } : {}),
        ...(task?.error ? { lastError: task.error } : {}),
      })) ?? agent;
    return c.json({
      agent: updated,
      ...(task ? { task: sanitizeManagerTaskForAssistant(task) } : {}),
    });
  });

  app.post("/api/manager/agents/:id/acknowledge", async (c) => {
    const parsed = await parseManagerAcknowledgeRequest(c.req);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const agent = await managerOrchestrationStore.getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "unknown agent" }, 404);
    const acknowledged = await acknowledgeManagerAgent(
      managerOrchestrationStore,
      agent,
      parsed.value,
      new Date(),
    );
    if (!acknowledged.ok) return c.json({ error: acknowledged.error, agent }, 409);
    return c.json(acknowledged.agent);
  });

  app.get("/api/manager/rounds", async (c) => {
    await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
    const response: ManagerRoundListResponse = {
      generatedAt: new Date().toISOString(),
      rounds: await managerOrchestrationStore.listRounds(),
    };
    return c.json(response);
  });

  app.post("/api/manager/rounds", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseManagerRoundCreateRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const round = await managerOrchestrationStore.createRound(parsed.value);
    if (round.projectId) {
      await managerProjectStore.update(round.projectId, {
        activeRoundId: round.id,
        status: "running",
      });
    }
    const agents: ManagerAgent[] = [];
    for (const assignment of parsed.value.agents ?? []) {
      const agent = await managerOrchestrationStore.createAgent({
        ...(round.projectId ? { projectId: round.projectId } : {}),
        role: assignment.role,
        ...(assignment.label ? { label: assignment.label } : {}),
        ...(assignment.profile ? { profile: assignment.profile } : {}),
        ...(assignment.cwd ? { cwd: assignment.cwd } : {}),
        roundId: round.id,
        ...(assignment.prompt ? { instruction: assignment.prompt } : {}),
      });
      agents.push(agent);
    }
    const updated =
      agents.length > 0
        ? await managerOrchestrationStore.updateRound(round.id, {
            agentIds: agents.map((agent) => agent.id),
          })
        : round;
    return c.json({ round: updated ?? round, agents }, 201);
  });

  app.post("/api/manager/rounds/:id/dispatch", async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = parseManagerRoundDispatchRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const round = await managerOrchestrationStore.getRound(c.req.param("id"));
    if (!round) return c.json({ error: "unknown round" }, 404);
    const response = await dispatchManagerRound({
      round,
      request: parsed.value,
      store: managerOrchestrationStore,
      taskStore: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    if (response.round.projectId) {
      await managerProjectStore.update(response.round.projectId, {
        activeRoundId: response.round.id,
        status: projectStatusFromRoundStatus(response.round.status),
        flowStage: projectFlowStageFromRoundStatus(response.round.status),
        ...(response.round.summary ? { summary: response.round.summary } : {}),
        ...(response.round.error ? { error: response.round.error } : { error: null }),
      });
    }
    return c.json(response, response.round.status === "blocked" ? 409 : 202);
  });

  app.get("/api/manager/rounds/:id/report", async (c) => {
    const report = await buildManagerRoundReport(
      c.req.param("id"),
      managerOrchestrationStore,
      managerTaskStore,
    );
    if (!report) return c.json({ error: "unknown round" }, 404);
    return c.json(report);
  });

  app.get("/api/manager/rounds/:id/worker-runs", async (c) => {
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      const roundId = c.req.param("id");
      const round = await managerOrchestrationStore.getRound(roundId);
      if (!round) return c.json({ error: "unknown round" }, 404);
      return c.json(
        await buildManagerWorkerRunLedger({
          orchestrationStore: managerOrchestrationStore,
          taskStore: managerTaskStore,
          roundId,
          limit: clampListLimit(c.req.query("limit")),
          now: new Date(),
        }),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/manager/rounds/:id/agent-results", async (c) => {
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      const roundId = c.req.param("id");
      const round = await managerOrchestrationStore.getRound(roundId);
      if (!round) return c.json({ error: "unknown round" }, 404);
      if (!round.projectId) {
        return c.json({ error: "round is not attached to a manager project" }, 409);
      }
      const project = await managerProjectStore.get(round.projectId);
      if (!project) return c.json({ error: "unknown project" }, 404);
      const flow = await buildManagerCommandFlow({
        project,
        orchestrationStore: managerOrchestrationStore,
        taskStore: managerTaskStore,
        decisionStore: managerDecisionStore,
        blockerStore: managerBlockerStore,
        artifactStore: managerArtifactStore,
        protocolStore: managerProtocolStore,
        repoRoot: managerRepoRoot,
        now: new Date(),
      });
      const results = flow.agentResults.filter((result) => result.roundId === round.id);
      const evidenceIds = new Set(results.flatMap((result) => result.evidenceIds));
      const response: ManagerAgentResultListResponse = {
        generatedAt: flow.generatedAt,
        projectId: project.id,
        roundId: round.id,
        results,
        evidence: flow.evidence.filter(
          (item) => item.roundId === round.id || evidenceIds.has(item.id),
        ),
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/manager/rounds/:id/health", async (c) => {
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      const roundId = c.req.param("id");
      const round = await managerOrchestrationStore.getRound(roundId);
      if (!round) return c.json({ error: "unknown round" }, 404);
      return c.json(
        await buildManagerRoundHealthGate({
          orchestrationStore: managerOrchestrationStore,
          taskStore: managerTaskStore,
          round,
          now: new Date(),
        }),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/manager/rounds/:id/repair", async (c) => {
    try {
      await syncManagerAgentsWithTasks(managerOrchestrationStore, managerTaskStore);
      const roundId = c.req.param("id");
      const round = await managerOrchestrationStore.getRound(roundId);
      if (!round) return c.json({ error: "unknown round" }, 404);
      return c.json(
        await repairManagerRoundEvidence({
          orchestrationStore: managerOrchestrationStore,
          taskStore: managerTaskStore,
          round,
          now: new Date(),
        }),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/manager/rounds/:id/acknowledge", async (c) => {
    const parsed = await parseManagerAcknowledgeRequest(c.req);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const round = await managerOrchestrationStore.getRound(c.req.param("id"));
    if (!round) return c.json({ error: "unknown round" }, 404);
    const acknowledged = await acknowledgeManagerRound(
      managerOrchestrationStore,
      round,
      parsed.value,
      new Date(),
    );
    if (!acknowledged.ok) return c.json({ error: acknowledged.error, round }, 409);
    return c.json(acknowledged.round);
  });

  app.get("/api/manager/audit-log", async (c) => {
    return c.json({
      entries: (await managerTaskStore.list(clampListLimit(c.req.query("limit")))).map(
        sanitizeManagerTaskForAssistant,
      ),
    });
  });

  app.get("/api/manager/system/summary", async (c) => {
    return c.json(
      await buildManagerSystemSummary({
        options,
        fetchImpl,
        registry,
        localToken,
        build,
        requestUrl: c.req.url,
        store: managerTaskStore,
      }),
    );
  });

  app.get("/api/manager/devices/:id/actions", (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(buildManagerDeviceActions(device));
  });

  app.get("/api/manager/update/plan", async (c) => {
    return c.json(
      await buildManagerUpdatePlan({ options, registry, build, fetchImpl, localToken }),
    );
  });

  app.get("/api/manager/update/status", async (c) => {
    return c.json(
      await buildManagerUpdateStatus({
        options,
        fetchImpl,
        registry,
        localToken,
        build,
      }),
    );
  });

  app.post("/api/manager/update/all", async (c) => {
    const request = await parseManagerShortcutRequest(c.req, "update-all");
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/registration/last-failure", async (c) => {
    return c.json(await analyzeLastRegistrationFailure(options.installReportStore));
  });

  app.get("/api/manager/registration/diagnose", async (c) => {
    return c.json(
      await buildManagerRegistrationDiagnosis({
        options,
        requestUrl: c.req.url,
      }),
    );
  });

  app.post("/api/manager/registration/repair", async (c) => {
    const request = await parseManagerShortcutRequest(c.req, "repair-registration");
    if (!request.ok) return c.json({ error: request.error }, 400);
    const completed = await createAndRunManagerTask({
      request: request.value,
      store: managerTaskStore,
      options,
      fetchImpl,
      registry,
      localToken,
      build,
      requestUrl: c.req.url,
    });
    return c.json(
      sanitizeManagerTaskForAssistant(completed),
      completed.state === "blocked" ? 409 : 202,
    );
  });

  app.get("/api/manager/security/boundary", async (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(
      await buildManagerSecurityBoundarySummary({
        options,
        fetchImpl,
        registry,
        localToken,
        urls,
      }),
    );
  });

  app.get("/api/devices", (c) => c.json(registry.list().map(toPublicDevice)));

  app.get("/api/devices/update-queue", async (c) => {
    const entries = options.deviceUpdateQueue ? await options.deviceUpdateQueue.list() : [];
    const fallbackCommand = buildFallbackRegisterCommandForRequest(options, c.req.url);
    return c.json({
      entries: entries.map((entry) => enrichDeviceUpdateQueueEntry(entry, fallbackCommand)),
    });
  });

  app.get("/api/self/register-other-pc-command", (c) => {
    if (!options.token) {
      return c.json({ error: "Site token is not configured" }, 404);
    }
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    const preferredUrl = pickRemoteAccessUrl(urls);
    return c.json({
      preferredUrl,
      serverPort: getUrlPort(preferredUrl),
      connectorPort: DEFAULT_CONNECTOR_PORT,
      siteToken: options.token,
      urls,
      command: buildRegisterOtherPcCommand({
        siteUrl: preferredUrl,
        siteToken: options.token,
        branch: resolveServerUpdateBranch(options),
      }),
    });
  });

  app.get("/api/self/remove-other-pc-command", (c) => {
    if (!options.token) {
      return c.json({ error: "Site token is not configured" }, 404);
    }
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    const preferredUrl = pickRemoteAccessUrl(urls);
    return c.json({
      preferredUrl,
      serverPort: getUrlPort(preferredUrl),
      connectorPort: DEFAULT_CONNECTOR_PORT,
      siteToken: options.token,
      urls,
      command: buildRemoveOtherPcCommand({
        siteUrl: preferredUrl,
        siteToken: options.token,
      }),
    });
  });

  app.get("/api/self/doctor", async (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(
      await buildServerDiagnosticReport({
        fetchImpl,
        registry,
        token: options.token,
        localToken,
        build,
        urls,
      }),
    );
  });

  app.get("/api/self/logs", async (c) => {
    const source = normalizeSelfLogSource(c.req.query("source"));
    if (!source) return c.json({ error: "unsupported log source" }, 400);
    const level = normalizeLogLevel(c.req.query("level"));
    return c.json(
      await readLogResponse({
        scope: "server",
        source,
        path: selfLogPath(options, source),
        tail: clampTail(c.req.query("tail")),
        ...(level ? { level } : {}),
      }),
    );
  });

  app.get("/api/self/process/status", async (c) => {
    if (!options.selfServerProcess) {
      return c.json(defaultSelfProcessStatus(build));
    }
    try {
      return c.json(await options.selfServerProcess.status());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/self/process/restart", async (c) => {
    if (!options.selfServerProcess) {
      return c.json(
        {
          supported: false,
          accepted: false,
          message: "self-server restart is not configured",
          error: "self-server restart is not configured",
        },
        501,
      );
    }
    try {
      const result = await options.selfServerProcess.restart();
      return c.json(result, result.accepted ? 202 : 409);
    } catch (err) {
      return c.json(
        {
          supported: true,
          accepted: false,
          message: "self-server restart failed",
          error: (err as Error).message,
        },
        500,
      );
    }
  });

  app.get("/api/self/network/status", async (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(buildSelfNetworkStatus(urls));
  });

  app.get("/api/self/install/status", async (c) => {
    return c.json(await buildSelfInstallStatus(options, build));
  });

  app.get("/api/self/security/boundary", (c) => {
    const urls = getAccessUrls(options.selfHostUrl ?? c.req.url);
    return c.json(buildSelfSecurityBoundary(options, urls));
  });

  app.get("/api/self/autostart", async (c) => {
    return c.json(await readSelfServerAutostartStatus(options.selfServerAutostart));
  });

  app.put("/api/self/autostart", async (c) => {
    if (!options.selfServerAutostart) {
      return c.json(
        {
          supported: false,
          installed: false,
          taskName: "DeskRelay Self Server",
          error: "self server autostart is not configured",
        },
        501,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const enabled =
      typeof body === "object" && body ? (body as { enabled?: unknown }).enabled : null;
    if (typeof enabled !== "boolean") {
      return c.json({ error: "enabled boolean is required" }, 400);
    }
    try {
      return c.json(await options.selfServerAutostart.setEnabled(enabled));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/self/update", async (c) => {
    if (!options.selfServerUpdater) {
      return c.json(
        {
          supported: false,
          started: false,
          error: "self server updater is not configured",
        },
        501,
      );
    }
    try {
      const result = await options.selfServerUpdater.update();
      if (result.started) return c.json(result, 202);
      if (!result.supported) return c.json(result, 501);
      if (result.status?.state === "running") return c.json(result, 409);
      return c.json(result, 500);
    } catch (err) {
      return c.json({ supported: true, started: false, error: (err as Error).message }, 500);
    }
  });

  app.get("/api/self/update/status", async (c) => {
    if (!options.selfServerUpdater) {
      return c.json({ state: "idle" });
    }
    try {
      return c.json(await options.selfServerUpdater.status());
    } catch (err) {
      return c.json({ state: "failed", error: (err as Error).message }, 500);
    }
  });

  app.get("/api/self/install-reports", async (c) => {
    if (!options.installReportStore) return c.json({ reports: [] });
    const limit = Number(new URL(c.req.url).searchParams.get("limit") ?? "10");
    return c.json({ reports: await options.installReportStore.list(limit) });
  });

  app.post("/api/self/install-reports", async (c) => {
    if (!options.installReportStore) {
      return c.json({ error: "install report store is not configured" }, 501);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    return c.json(await options.installReportStore.add(body), 201);
  });

  app.delete("/api/self/install-reports", async (c) => {
    if (!options.installReportStore?.clear) {
      return c.json({ error: "install report cleanup is not configured" }, 501);
    }
    return c.json(await options.installReportStore.clear());
  });

  app.post("/api/devices", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "body must be an object" }, 400);
    }
    const input = body as Record<string, unknown>;
    if (typeof input.daemonUrl !== "string") {
      return c.json({ error: "daemonUrl is required" }, 400);
    }
    try {
      const daemonUrl = normalizeDaemonUrl(input.daemonUrl);
      const authToken =
        typeof input.authToken === "string" && input.authToken.trim()
          ? input.authToken.trim()
          : localToken;
      const probe = await probeDaemonStatus(fetchImpl, daemonUrl, authToken);
      if (!probe.ok) {
        return c.json({ error: probe.error }, probe.status as never);
      }
      const device = registry.register({
        daemonUrl,
        ...(typeof input.label === "string" ? { label: input.label } : {}),
        ...(authToken ? { authToken } : {}),
        ...(typeof input.deviceKey === "string" ? { deviceKey: input.deviceKey } : {}),
      });
      await options.deviceUpdateQueue?.remove(device.id).catch(() => undefined);
      return c.json(toPublicDevice(device), 201);
    } catch (err) {
      if (err instanceof DeviceRegistryError) {
        return c.json({ error: err.message }, err.status as never);
      }
      throw err;
    }
  });

  app.patch("/api/devices/:id", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const label = typeof body === "object" && body ? (body as { label?: unknown }).label : null;
    if (typeof label !== "string") return c.json({ error: "label is required" }, 400);
    try {
      const updated = registry.rename(id, label);
      if (!updated) return c.json({ error: `unknown device: ${id}` }, 404);
      return c.json(toPublicDevice(updated));
    } catch (err) {
      if (err instanceof DeviceRegistryError) {
        return c.json({ error: err.message }, err.status as never);
      }
      throw err;
    }
  });

  app.delete("/api/devices", async (c) => {
    const devices = orderDevicesForRemoval(registry.list());
    const cleanup = [];
    for (const device of devices) {
      cleanup.push(await unregisterDeviceWithCleanup(fetchImpl, registry, device, localToken));
      await options.deviceUpdateQueue?.remove(device.id);
    }
    return c.json({ ok: true, cleanup });
  });

  app.delete("/api/devices/:id", async (c) => {
    const id = c.req.param("id");
    const device = registry.get(id);
    if (!device) return c.json({ error: `unknown device: ${id}` }, 404);
    const result = await unregisterDeviceWithCleanup(fetchImpl, registry, device, localToken);
    await options.deviceUpdateQueue?.remove(device.id);
    return c.json({ ok: true, cleanup: result.cleanup });
  });

  app.get("/api/devices/:id/behaviors", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/behaviors`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/capabilities", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/capabilities`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/logs", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const qs = new URLSearchParams();
    qs.set("source", c.req.query("source") ?? "connector");
    qs.set("tail", String(clampTail(c.req.query("tail"))));
    const level = normalizeLogLevel(c.req.query("level"));
    if (level) qs.set("level", level);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/logs?${qs.toString()}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/process/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/process/status`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/process/restart", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/process/restart`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/network/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceNetworkStatus(fetchImpl, device, daemonToken(device, localToken)),
    );
  });

  app.get("/api/devices/:id/install/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceInstallStatus(
        fetchImpl,
        device,
        daemonToken(device, localToken),
        options.deviceUpdateQueue,
      ),
    );
  });

  app.get("/api/devices/:id/security/boundary", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceSecurityBoundary(fetchImpl, device, daemonToken(device, localToken)),
    );
  });

  app.post("/api/devices/:id/behaviors/load", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/behaviors/load`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.delete("/api/devices/:id/behaviors/:instance", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "DELETE",
      `${device.daemonUrl}/behaviors/${encodeURIComponent(c.req.param("instance"))}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/behaviors/:instance/request", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const body = await c.req.text();
    const prepared = await prepareBehaviorRequestBodyForProxy(body, {
      device,
      options,
      requestUrl: c.req.url,
      contextStores: managerAssistantContextStores,
    });
    if (!prepared.ok) return c.json({ error: prepared.error }, prepared.status as never);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/behaviors/${encodeURIComponent(c.req.param("instance"))}/request`,
      prepared.body,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/events/spaces/:spaceId/stream", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const headers: Record<string, string> = {};
    const lastEventId = c.req.header("Last-Event-ID");
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;
    const authToken = daemonToken(device, localToken);
    if (authToken) headers.authorization = `Bearer ${authToken}`;

    let upstream: Response;
    try {
      upstream = await fetchImpl(
        `${device.daemonUrl}/events/spaces/${encodeURIComponent(c.req.param("spaceId"))}/stream`,
        { headers },
      );
    } catch (err) {
      return c.json({ error: `cannot reach daemon: ${(err as Error).message}` }, 502);
    }
    if (!upstream.ok || !upstream.body) {
      return c.json(
        {
          error:
            upstream.status === 503
              ? loc(c.req.header("accept-language"), "be.daemon.offline")
              : `upstream daemon returned ${upstream.status}`,
        },
        upstream.status as never,
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.get("/api/devices/:id/fs/list", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const qs = new URLSearchParams();
    qs.set("path", c.req.query("path") ?? "");
    if (c.req.query("workspaceScope") === "unrestricted") {
      qs.set("workspaceScope", "unrestricted");
    }
    if (parseQueryBoolean(c.req.query("includeFiles") ?? "")) {
      qs.set("includeFiles", "1");
    }
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/fs/list?${qs.toString()}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/fs/mkdir", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/fs/mkdir`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/fs/roots", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/fs/roots`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/files/preview", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const qs = new URLSearchParams();
    qs.set("path", c.req.query("path") ?? "");
    const cwd = c.req.query("cwd") ?? "";
    if (cwd) qs.set("cwd", cwd);
    if (c.req.query("workspaceScope") === "unrestricted") {
      qs.set("workspaceScope", "unrestricted");
    }
    return proxyBinary(
      fetchImpl,
      `${device.daemonUrl}/files/preview?${qs.toString()}`,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/git/status", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/git/status?cwd=${encodeURIComponent(c.req.query("cwd") ?? "")}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/instructions", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "GET",
      `${device.daemonUrl}/instructions?cwd=${encodeURIComponent(c.req.query("cwd") ?? "")}`,
      undefined,
      daemonToken(device, localToken),
    );
  });

  app.put("/api/devices/:id/instructions/:scope", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "PUT",
      `${device.daemonUrl}/instructions/${encodeURIComponent(c.req.param("scope"))}`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.delete("/api/devices/:id/instructions/:scope", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "DELETE",
      `${device.daemonUrl}/instructions/${encodeURIComponent(c.req.param("scope"))}`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.get("/api/devices/:id/diagnostics", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const token = daemonToken(device, localToken);
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let upstream: Response;
    try {
      upstream = await fetchImpl(`${device.daemonUrl}/status`, { method: "GET", headers });
    } catch (err) {
      return c.json({ error: `cannot reach daemon: ${(err as Error).message}` }, 502);
    }
    const text = await upstream.text();
    if (upstream.ok && options.deviceUpdateQueue) {
      const fallbackCommand = buildFallbackRegisterCommandForRequest(options, c.req.url);
      void retryQueuedDeviceSystemUpdate(
        fetchImpl,
        device,
        token,
        fallbackCommand,
        options.deviceUpdateQueue,
        resolveServerUpdateBranch(options),
      ).catch(() => undefined);
    }
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  });

  app.post("/api/devices/:id/system/update", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    const fallbackCommand = buildFallbackRegisterCommandForRequest(options, c.req.url);
    return await requestDaemonSystemUpdate(
      fetchImpl,
      device,
      daemonToken(device, localToken),
      fallbackCommand,
      options.deviceUpdateQueue,
      resolveServerUpdateBranch(options),
    );
  });

  app.get("/api/devices/:id/doctor", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return c.json(
      await buildDeviceDiagnosticReport({
        fetchImpl,
        registry,
        device,
        localToken,
        serverBuild: build,
      }),
    );
  });

  app.post("/api/devices/:id/approvals/respond", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/hooks/pretooluse/respond`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  app.post("/api/devices/:id/approvals/simulate", async (c) => {
    const device = resolveDevice(c.req.param("id"), registry);
    if (!device) return c.json({ error: "unknown device" }, 404);
    return proxyJson(
      fetchImpl,
      "POST",
      `${device.daemonUrl}/hooks/pretooluse/simulate`,
      await c.req.text(),
      daemonToken(device, localToken),
    );
  });

  return app;
}

interface AnnouncementPayload {
  message: string;
  level?: "info" | "warning";
  until?: string;
}

interface AnnouncementSource {
  read: () => Promise<string>;
}

const DEFAULT_ANNOUNCEMENT_POLL_MS = 5 * 60 * 1000;
const MAX_ANNOUNCEMENT_CHARS = 2000;

function createAnnouncementSource(
  options: SiteAppOptions,
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
): AnnouncementSource {
  const inlineAnnouncement = (options.announcement ?? "").trim();
  const url = (options.announcementUrl ?? "").trim();
  const pollMs =
    typeof options.announcementPollMs === "number" && options.announcementPollMs > 0
      ? options.announcementPollMs
      : DEFAULT_ANNOUNCEMENT_POLL_MS;
  let cachedRemoteAnnouncement = "";
  let inflight: Promise<void> | null = null;

  async function refreshRemoteAnnouncement(): Promise<void> {
    if (!url) return;
    if (inflight) return await inflight;
    inflight = (async () => {
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json, text/plain, */*" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const text = (await res.text()).trim();
        cachedRemoteAnnouncement = text.slice(0, MAX_ANNOUNCEMENT_CHARS);
      } catch {
        // Keep the last successful announcement. A failed poll should not
        // blank the banner while the user's self-host server is offline.
      } finally {
        inflight = null;
      }
    })();
    return await inflight;
  }

  if (url) {
    void refreshRemoteAnnouncement();
    const timer = setInterval(() => void refreshRemoteAnnouncement(), pollMs);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    read: async () => {
      if (inlineAnnouncement) return inlineAnnouncement;
      if (url && !cachedRemoteAnnouncement) await refreshRemoteAnnouncement();
      return cachedRemoteAnnouncement;
    },
  };
}

function announcementPayload(rawInput: string): AnnouncementPayload {
  const empty = { message: "" };
  const raw = rawInput.trim();
  if (!raw) return empty;

  let parsed: { message?: unknown; until?: unknown; level?: unknown } | null = null;
  if (raw.startsWith("{")) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const message = parsed && typeof parsed.message === "string" ? parsed.message.trim() : raw;
  if (!message) return empty;
  const level =
    parsed && (parsed.level === "info" || parsed.level === "warning") ? parsed.level : "info";

  if (parsed && typeof parsed.until === "string") {
    const expiry = Date.parse(parsed.until);
    if (Number.isFinite(expiry) && expiry <= Date.now()) return empty;
    return { message, level, until: parsed.until };
  }
  return { message, level };
}

async function readUpdateNotice(
  source: UpdateNoticeSource | undefined,
): Promise<AnnouncementPayload | null> {
  if (!source) return null;
  try {
    const payload = await source.read();
    if (!payload?.message.trim()) return null;
    return {
      message: payload.message.trim(),
      level: payload.level === "warning" ? "warning" : "info",
    };
  } catch {
    return {
      message: "현재 버젼 확인 실패",
      level: "warning",
    };
  }
}

function combineAnnouncementPayloads(
  updatePayload: AnnouncementPayload | null,
  operatorPayload: AnnouncementPayload,
): AnnouncementPayload {
  if (!updatePayload?.message.trim()) return operatorPayload;
  if (!operatorPayload.message.trim()) return updatePayload;
  const messages = [updatePayload?.message, operatorPayload.message].filter(
    (message): message is string => Boolean(message?.trim()),
  );
  if (messages.length === 0) return { message: "" };
  return {
    message: messages.join(" · "),
    level:
      updatePayload?.level === "warning" || operatorPayload.level === "warning"
        ? "warning"
        : "info",
  };
}

async function readSelfServerAutostartStatus(
  controller: SelfServerAutostartController | undefined,
): Promise<SelfServerAutostartStatus> {
  if (!controller) {
    return {
      supported: false,
      installed: false,
      taskName: "DeskRelay Self Server",
      error: "self server autostart is not configured",
    };
  }
  try {
    return await controller.status();
  } catch (err) {
    return {
      supported: false,
      installed: false,
      taskName: "DeskRelay Self Server",
      error: (err as Error).message,
    };
  }
}

const SERVER_STARTED_AT = new Date().toISOString();

const SITE_ROUTE_CAPABILITIES = [
  { method: "GET", path: "/healthz", description: "Read server version and basic health." },
  { method: "GET", path: "/api/announcement", description: "Read the public update notice." },
  { method: "GET", path: "/api/capabilities", description: "List server API capabilities." },
  { method: "GET", path: "/api/manager/projects", description: "List manager projects." },
  { method: "POST", path: "/api/manager/projects", description: "Create a manager project." },
  {
    method: "GET",
    path: "/api/manager/projects/:id/rounds",
    description: "List orchestration rounds scoped to one manager project.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/agents",
    description: "List orchestration agents scoped to one manager project.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/tasks",
    description: "List manager tasks scoped to one manager project.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/runs",
    description: "List worker runs scoped to one manager project.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/overview",
    description: "Read the command-center overview for one manager project.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/command-flow",
    description: "Read the full project command-flow state for orchestration UX.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/evidence",
    description: "Read derived evidence items used for manager round judgment.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/judgments",
    description: "Read watch-worker judgment packets and proposed approval actions.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/protocol-trace",
    description: "Read how project protocol files and rules map to round evidence.",
  },
  {
    method: "PUT",
    path: "/api/manager/projects/:id/charter",
    description: "Update the project charter used by manager orchestration.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/prepare",
    description: "Evaluate protocol and charter readiness before starting orchestration.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/start",
    description: "Create and dispatch a project orchestration round from charter state.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/hygiene",
    description: "Detect stale, orphaned, and inconsistent orchestration records for one project.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/hygiene/cleanup",
    description:
      "Preview or record deduplicated blockers for project hygiene recovery without deleting active work.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/decisions",
    description: "List recorded decisions for one manager project.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/decisions",
    description: "Record a manager project decision.",
  },
  {
    method: "PATCH",
    path: "/api/manager/projects/:id/decisions/:decisionId",
    description: "Update one manager project decision while preserving revisions.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/blockers",
    description: "List active and resolved blockers for one manager project.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/blockers",
    description: "Record a deduplicated manager project blocker.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/blockers/:blockerId/resolve",
    description: "Resolve or dismiss one manager project blocker.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/artifacts",
    description: "List active and inactive artifacts for one manager project.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/artifacts/scan",
    description: "Scan project worker evidence and record detected artifacts.",
  },
  {
    method: "PATCH",
    path: "/api/manager/projects/:id/artifacts/:artifactId",
    description: "Update one manager project artifact status or metadata.",
  },
  {
    method: "GET",
    path: "/api/manager/projects/:id/protocol",
    description: "Read protocol files and protocol state for one manager project.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/protocol/scan",
    description: "Rescan protocol files for one manager project.",
  },
  {
    method: "PATCH",
    path: "/api/manager/projects/:id/protocol",
    description: "Update protocol version, active rules, or latest change metadata.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/rounds/:roundId/review",
    description: "Record review outcome for a project orchestration round.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/direction-change",
    description: "Record a direction change and optionally draft the next round.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/complete",
    description: "Record final project review and mark the project completed.",
  },
  { method: "GET", path: "/api/manager/projects/:id", description: "Read one manager project." },
  {
    method: "PATCH",
    path: "/api/manager/projects/:id",
    description: "Update one manager project.",
  },
  {
    method: "POST",
    path: "/api/manager/projects/:id/archive",
    description: "Archive one manager project without deleting its project folder.",
  },
  { method: "GET", path: "/api/manager/tasks", description: "List manager tasks." },
  { method: "POST", path: "/api/manager/tasks", description: "Create a manager task." },
  { method: "GET", path: "/api/manager/tasks/:id", description: "Read one manager task." },
  {
    method: "GET",
    path: "/api/manager/tasks/:id/logs",
    description: "Read task execution log lines.",
  },
  {
    method: "GET",
    path: "/api/manager/tasks/:id/observe",
    description: "Read one manager task with its concise observation summary and log.",
  },
  {
    method: "GET",
    path: "/api/manager/tasks/:id/stream",
    description: "Stream one manager task observation until it reaches a terminal state.",
  },
  {
    method: "POST",
    path: "/api/manager/tasks/:id/cancel",
    description: "Cancel a cancellable manager task.",
  },
  {
    method: "POST",
    path: "/api/manager/tasks/:id/retry",
    description: "Retry a failed, blocked, cancelled, or waiting manager task.",
  },
  {
    method: "POST",
    path: "/api/manager/tasks/:id/acknowledge",
    description: "Acknowledge a failed, blocked, or stale manager task without deleting history.",
  },
  {
    method: "POST",
    path: "/api/manager/assistant/chat",
    description: "Send a message to the server-local DeskRelay assistant CLI.",
  },
  {
    method: "POST",
    path: "/api/manager/assistant/chat/stream",
    description: "Stream server-local DeskRelay assistant CLI status and final response.",
  },
  {
    method: "GET",
    path: "/api/manager/assistant/workspace",
    description:
      "Prepare and return the managed server-local Claude workspace used by the DeskRelay assistant.",
  },
  {
    method: "GET",
    path: "/api/manager/assistant/conversation",
    description: "Read the persistent manager assistant conversation pointer.",
  },
  {
    method: "PUT",
    path: "/api/manager/assistant/conversation",
    description: "Update or clear the persistent manager assistant conversation pointer.",
  },
  {
    method: "GET",
    path: "/api/manager/assistant/status",
    description: "Read recent manager assistant progress reports.",
  },
  {
    method: "POST",
    path: "/api/manager/assistant/status",
    description: "Write a concise manager assistant progress report for the UI.",
  },
  {
    method: "GET",
    path: "/api/manager/state",
    description: "Read the live manager state view used by the UI.",
  },
  {
    method: "POST",
    path: "/api/manager/state/acknowledge",
    description:
      "Acknowledge current manager failure signals so stale incidents stop driving status.",
  },
  {
    method: "GET",
    path: "/api/manager/worker-runs",
    description: "Read the worker run ledger across recent manager worker tasks.",
  },
  {
    method: "GET",
    path: "/api/manager/events/recent",
    description: "Replay recent manager state-change events after an optional sequence number.",
  },
  {
    method: "GET",
    path: "/api/manager/events/stream",
    description: "Stream manager state-change events with Last-Event-ID resume support.",
  },
  {
    method: "POST",
    path: "/api/self/browser/presence",
    description: "Record that a DeskRelay browser tab is currently active.",
  },
  {
    method: "POST",
    path: "/api/self/browser/refresh",
    description: "Ask active DeskRelay browser tabs to hard refresh instead of opening a new tab.",
  },
  {
    method: "POST",
    path: "/api/manager/sessions/read",
    description:
      "Read a Claude session transcript by session id, optionally searching registered devices and cwd values.",
  },
  {
    method: "GET",
    path: "/api/manager/sessions/hygiene",
    description: "Classify manager and worker Claude sessions for safe cleanup.",
  },
  {
    method: "POST",
    path: "/api/manager/sessions/hygiene/cleanup",
    description: "Delete only manager-session cleanup candidates selected by the hygiene policy.",
    destructive: true,
  },
  {
    method: "GET",
    path: "/api/manager/workers",
    description: "List server-local worker CLI profiles available to the manager assistant.",
  },
  {
    method: "GET",
    path: "/api/manager/workers/:id",
    description: "Read one server-local worker CLI profile.",
  },
  {
    method: "POST",
    path: "/api/manager/workers/:id/check",
    description: "Check whether a server-local worker CLI profile can start.",
  },
  {
    method: "POST",
    path: "/api/manager/workers/run",
    description: "Create a worker CLI manager task.",
  },
  {
    method: "GET",
    path: "/api/manager/agents",
    description: "List orchestration agents and their latest task status.",
  },
  {
    method: "POST",
    path: "/api/manager/agents",
    description: "Create a persistent orchestration agent role.",
  },
  {
    method: "GET",
    path: "/api/manager/agents/:id",
    description: "Read one orchestration agent.",
  },
  {
    method: "POST",
    path: "/api/manager/agents/:id/message",
    description: "Assign work to one orchestration agent through a worker CLI task.",
  },
  {
    method: "POST",
    path: "/api/manager/agents/:id/stop",
    description: "Cancel or mark one orchestration agent as stopped.",
  },
  {
    method: "POST",
    path: "/api/manager/agents/:id/acknowledge",
    description: "Acknowledge a failed, blocked, or stale orchestration agent.",
  },
  {
    method: "GET",
    path: "/api/manager/rounds",
    description: "List orchestration rounds.",
  },
  {
    method: "POST",
    path: "/api/manager/rounds",
    description: "Create an orchestration round with optional agent assignments.",
  },
  {
    method: "POST",
    path: "/api/manager/rounds/:id/dispatch",
    description: "Dispatch a round to multiple orchestration agents.",
  },
  {
    method: "GET",
    path: "/api/manager/rounds/:id/report",
    description: "Read a round report with agents and worker task results.",
  },
  {
    method: "GET",
    path: "/api/manager/rounds/:id/worker-runs",
    description: "Read the worker run ledger scoped to one orchestration round.",
  },
  {
    method: "GET",
    path: "/api/manager/rounds/:id/agent-results",
    description: "Read structured agent results and linked evidence for one round.",
  },
  {
    method: "GET",
    path: "/api/manager/rounds/:id/health",
    description: "Read the health gate that judges whether one orchestration round is trustworthy.",
  },
  {
    method: "POST",
    path: "/api/manager/rounds/:id/repair",
    description: "Reconcile one orchestration round with existing worker evidence.",
  },
  {
    method: "POST",
    path: "/api/manager/rounds/:id/acknowledge",
    description: "Acknowledge a failed or blocked orchestration round without deleting history.",
  },
  {
    method: "GET",
    path: "/api/manager/audit-log",
    description: "Read manager task audit log.",
  },
  {
    method: "GET",
    path: "/api/manager/system/summary",
    description: "Read assistant-oriented system summary.",
  },
  {
    method: "GET",
    path: "/api/manager/devices/:id/actions",
    description: "Read safe actions available for a device.",
  },
  {
    method: "GET",
    path: "/api/manager/update/plan",
    description: "Read a server and device update plan.",
  },
  {
    method: "GET",
    path: "/api/manager/update/status",
    description: "Read server and device update status.",
  },
  {
    method: "POST",
    path: "/api/manager/update/all",
    description: "Create an update-all manager task.",
  },
  {
    method: "GET",
    path: "/api/manager/registration/last-failure",
    description: "Analyze the last failed connector registration report.",
  },
  {
    method: "GET",
    path: "/api/manager/registration/diagnose",
    description: "Diagnose current registration prerequisites and the latest failure.",
  },
  {
    method: "POST",
    path: "/api/manager/registration/repair",
    description: "Create a registration repair manager task.",
  },
  {
    method: "GET",
    path: "/api/manager/security/boundary",
    description: "Read server and device security boundary summary.",
  },
  { method: "GET", path: "/api/devices", description: "List registered devices." },
  { method: "POST", path: "/api/devices", description: "Register a device." },
  {
    method: "DELETE",
    path: "/api/devices",
    description: "Remove all registered devices.",
    destructive: true,
  },
  { method: "GET", path: "/api/devices/update-queue", description: "List queued device updates." },
  {
    method: "GET",
    path: "/api/self/register-other-pc-command",
    description: "Generate the other-PC registration command.",
  },
  {
    method: "GET",
    path: "/api/self/remove-other-pc-command",
    description: "Generate the other-PC cleanup command.",
  },
  { method: "GET", path: "/api/self/doctor", description: "Run server diagnostics." },
  { method: "GET", path: "/api/self/logs", description: "Read server stack logs." },
  {
    method: "GET",
    path: "/api/self/process/status",
    description: "Read server process status.",
  },
  {
    method: "POST",
    path: "/api/self/process/restart",
    description: "Restart the self-host server stack.",
  },
  {
    method: "GET",
    path: "/api/self/network/status",
    description: "Read server network status.",
  },
  {
    method: "GET",
    path: "/api/self/install/status",
    description: "Read server install status.",
  },
  {
    method: "GET",
    path: "/api/self/security/boundary",
    description: "Read server token and network boundary summary.",
  },
  { method: "GET", path: "/api/self/autostart", description: "Read server autostart state." },
  {
    method: "PUT",
    path: "/api/self/autostart",
    description: "Enable or disable server autostart.",
  },
  { method: "POST", path: "/api/self/update", description: "Update self-host server." },
  {
    method: "GET",
    path: "/api/self/update/status",
    description: "Read self-host server update status.",
  },
  {
    method: "GET",
    path: "/api/self/install-reports",
    description: "List connector install reports.",
  },
  {
    method: "POST",
    path: "/api/self/install-reports",
    description: "Record a connector install report.",
  },
  {
    method: "DELETE",
    path: "/api/self/install-reports",
    description: "Clear stored connector install reports.",
    destructive: true,
  },
  { method: "PATCH", path: "/api/devices/:id", description: "Rename one registered device." },
  {
    method: "DELETE",
    path: "/api/devices/:id",
    description: "Remove one registered device.",
    destructive: true,
  },
  {
    method: "GET",
    path: "/api/devices/:id/behaviors",
    description: "List loaded device behaviors.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/capabilities",
    description: "Read device API capabilities.",
  },
  { method: "GET", path: "/api/devices/:id/logs", description: "Read device logs." },
  {
    method: "GET",
    path: "/api/devices/:id/process/status",
    description: "Read device process status.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/process/restart",
    description: "Restart the device connector.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/network/status",
    description: "Read device network status.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/install/status",
    description: "Read device install status.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/security/boundary",
    description: "Read device token, network, and workspace boundary summary.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/behaviors/load",
    description: "Load a device behavior package.",
  },
  {
    method: "DELETE",
    path: "/api/devices/:id/behaviors/:instance",
    description: "Unload a device behavior.",
    destructive: true,
  },
  {
    method: "POST",
    path: "/api/devices/:id/behaviors/:instance/request",
    description: "Call a device behavior method.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/events/spaces/:spaceId/stream",
    description: "Stream behavior events over SSE.",
  },
  {
    method: "GET",
    path: "/api/devices/:id/fs/list",
    description: "List directories. Add includeFiles=1 to include files for verification.",
  },
  { method: "POST", path: "/api/devices/:id/fs/mkdir", description: "Create a directory." },
  { method: "GET", path: "/api/devices/:id/fs/roots", description: "Read workspace root policy." },
  {
    method: "GET",
    path: "/api/devices/:id/files/preview",
    description: "Preview a guarded local file.",
  },
  { method: "GET", path: "/api/devices/:id/git/status", description: "Read Git status for a cwd." },
  {
    method: "GET",
    path: "/api/devices/:id/instructions",
    description: "Read Claude instructions for a cwd.",
  },
  {
    method: "PUT",
    path: "/api/devices/:id/instructions/:scope",
    description: "Write a Claude instruction file.",
  },
  {
    method: "DELETE",
    path: "/api/devices/:id/instructions/:scope",
    description: "Delete a Claude instruction file.",
    destructive: true,
  },
  {
    method: "GET",
    path: "/api/devices/:id/diagnostics",
    description: "Read device diagnostics used by the app.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/system/update",
    description: "Update a device connector.",
  },
  { method: "GET", path: "/api/devices/:id/doctor", description: "Run device diagnostics." },
  {
    method: "POST",
    path: "/api/devices/:id/approvals/respond",
    description: "Resolve a pending Claude tool approval.",
  },
  {
    method: "POST",
    path: "/api/devices/:id/approvals/simulate",
    description: "Create a simulated approval for diagnostics.",
  },
] satisfies ManagerRouteCapability[];

const DESKRELAY_BEHAVIOR_METHODS = [
  "account.info",
  "chat",
  "context.usage",
  "diagnostics",
  "interrupt",
  "permissions.inspect",
  "permissions.update",
  "sessions.delete",
  "sessions.deleteByCwd",
  "sessions.deleteBySessionId",
  "sessions.list",
  "sessions.read",
  "skills.delete",
  "skills.inspect",
  "slashCommands",
  "usage.limits",
];

function serverCapabilities(options: SiteAppOptions): ManagerCapabilities {
  const build = options.build ?? getDeskRelayBuildInfo();
  return {
    scope: "server",
    apiVersion: MANAGER_API_VERSION,
    build,
    platform: process.platform,
    arch: process.arch,
    features: [
      "capabilities",
      "logs",
      "process.status",
      "process.restart",
      "network.status",
      "install.status",
      "security.boundary",
      "manager.tasks",
      "manager.update-plan",
      "manager.update-status",
      "manager.registration-analysis",
      "manager.system-summary",
      "manager.task-control",
      "manager.action-discovery",
      "manager.security-summary",
      "manager.assistant-chat",
      "manager.projects",
      "manager.project-command-flow",
      "manager.project-protocol",
      "manager.wizard-intent-events",
      "manager.orchestration-agents",
      "manager.orchestration-rounds",
      "manager.worker-runs",
      "manager.round-health-gate",
      "manager.round-repair",
      "devices",
      "device.proxy",
      "diagnostics",
      "install.reports",
      "self.update",
      "device.update",
      "autostart",
    ],
    routes: SITE_ROUTE_CAPABILITIES,
    behaviorMethods: DESKRELAY_BEHAVIOR_METHODS,
  };
}

function defaultSelfProcessStatus(build: DeskRelayBuildInfo) {
  return {
    scope: "server",
    kind: "site-server",
    build,
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    uptimeMs: Math.max(0, Date.now() - Date.parse(SERVER_STARTED_AT)),
    platform: process.platform,
    arch: process.arch,
  };
}

interface ManagerTaskRunInput {
  task: ManagerTask;
  request: ManagerTaskRequest;
  store: ManagerTaskStore;
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  requestUrl: string;
}

interface ManagerTaskExecutionResult {
  state: ManagerTaskState;
  steps: ManagerTask["steps"];
  result?: unknown;
  targetLabel?: string;
  error?: string;
}

type ManagerTaskCreateRunInput = Omit<ManagerTaskRunInput, "task">;

interface ManagerAgentRunInput {
  agent: ManagerAgent;
  message: ManagerAgentMessageRequest;
  store: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  requestUrl: string;
}

interface ManagerRoundDispatchInput {
  round: ManagerRound;
  request: ManagerRoundDispatchRequest;
  store: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  requestUrl: string;
}

async function recoverStaleManagerRuntimeState(
  taskStore: ManagerTaskStore,
  orchestrationStore: ManagerOrchestrationStore,
  build: DeskRelayBuildInfo,
): Promise<{ tasks: number; agents: number }> {
  const [tasks, agents] = await Promise.all([
    recoverStaleManagerTasks(taskStore, build),
    recoverStaleManagerAgents(orchestrationStore, build),
  ]);
  return { tasks, agents };
}

async function recoverStaleManagerTasks(
  store: ManagerTaskStore,
  build: DeskRelayBuildInfo,
): Promise<number> {
  const tasks = await store.list(500);
  const stale = tasks.filter((task) => task.state === "pending" || task.state === "running");
  if (stale.length === 0) return 0;
  let recovered = 0;
  for (const task of stale) {
    const summary = `Task was left ${task.state} by a previous server process and cannot be resumed.`;
    const updated = await store.update(task.id, {
      state: "cancelled",
      completedAt: new Date().toISOString(),
      error: `${summary} Retry the task if it is still needed.`,
      steps: [
        ...task.steps,
        taskStep({
          id: "task.recovered-after-restart",
          label: "Task recovered after restart",
          status: "warn",
          summary,
          detail: `Recovered when server ${build.shortCommit} started at ${SERVER_STARTED_AT}.`,
          retrySafe: true,
        }),
      ],
    });
    if (updated) recovered += 1;
  }
  return recovered;
}

async function recoverStaleManagerAgents(
  store: ManagerOrchestrationStore,
  build: DeskRelayBuildInfo,
): Promise<number> {
  const agents = await store.listAgents();
  const stale = agents.filter((agent) => isManagerAgentRuntimeActive(agent.status));
  if (stale.length === 0) return 0;
  let recovered = 0;
  for (const agent of stale) {
    const summary = `Agent was left ${agent.status} by a previous server process and cannot be trusted.`;
    const updated = await store.updateAgent(agent.id, {
      status: "stale",
      lastError: `${summary} Recovered when server ${build.shortCommit} started at ${SERVER_STARTED_AT}. Start a new worker or dispatch the round again if it is still needed.`,
      lastHeartbeatAt: SERVER_STARTED_AT,
    });
    if (updated) recovered += 1;
  }
  return recovered;
}

function isManagerAgentRuntimeActive(status: ManagerAgentStatus): boolean {
  return status === "assigned" || status === "running" || status === "waiting";
}

async function createAndRunManagerTask(input: ManagerTaskCreateRunInput): Promise<ManagerTask> {
  const task = await input.store.create({
    kind: input.request.kind,
    ...(input.request.projectId ? { projectId: input.request.projectId } : {}),
    ...(input.request.targetId ? { targetId: input.request.targetId } : {}),
    ...(input.request.params ? { params: input.request.params } : {}),
    dryRun: input.request.dryRun ?? true,
    requestedBy: input.request.requestedBy ?? "browser",
    steps: [
      taskStep({
        id: "task.created",
        label: "Task accepted",
        status: "pending",
        summary: `${input.request.kind} task accepted`,
      }),
    ],
  });
  return await runManagerTask({ ...input, task });
}

function buildManagerTaskLogResponse(task: ManagerTask): ManagerTaskLogResponse {
  const lines = [
    `[${task.createdAt}] ${task.kind} created by ${task.requestedBy}`,
    ...(task.startedAt ? [`[${task.startedAt}] started`] : []),
    ...task.steps.map(
      (step) =>
        `[${step.lastCheckedAt ?? task.updatedAt}] ${step.status} ${step.id}: ${step.summary}`,
    ),
    ...(task.completedAt ? [`[${task.completedAt}] completed: ${task.state}`] : []),
    ...(task.error ? [`error: ${task.error}`] : []),
  ];
  return {
    taskId: task.id,
    source: "manager-task",
    readAt: new Date().toISOString(),
    lines,
    steps: task.steps,
    ...(task.result !== undefined ? { result: task.result } : {}),
    ...(task.error ? { error: task.error } : {}),
  };
}

function buildManagerTaskObservation(task: ManagerTask): ManagerTaskObservationResponse {
  const log = sanitizeManagerTaskLogForAssistant(buildManagerTaskLogResponse(task));
  const sanitizedTask = sanitizeManagerTaskForAssistant(task);
  const terminal = isManagerTaskTerminalState(sanitizedTask.state);
  return {
    task: sanitizedTask,
    log,
    terminal,
    summary: managerTaskObservationSummary(sanitizedTask),
    nextRead: managerTaskNextRead(sanitizedTask, terminal),
  };
}

function isManagerTaskTerminalState(state: ManagerTaskState): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "blocked" ||
    state === "cancelled" ||
    state === "restart_required"
  );
}

function managerTaskObservationSummary(task: ManagerTask): string {
  const target = task.targetLabel ?? task.targetId ?? "server";
  if (task.state === "succeeded") return `${task.kind} completed for ${target}.`;
  if (task.state === "failed") return `${task.kind} failed for ${target}.`;
  if (task.state === "blocked") return `${task.kind} is blocked for ${target}.`;
  if (task.state === "cancelled") return `${task.kind} was cancelled for ${target}.`;
  if (task.state === "restart_required") return `${task.kind} requires restart for ${target}.`;
  if (task.state === "waiting_for_device") return `${task.kind} is waiting for ${target}.`;
  if (task.state === "running") return `${task.kind} is running for ${target}.`;
  return `${task.kind} is pending for ${target}.`;
}

function managerTaskNextRead(
  task: ManagerTask,
  terminal: boolean,
): ManagerTaskObservationResponse["nextRead"] {
  if (!terminal) return "task-stream";
  if (task.state === "failed" || task.state === "blocked") return "task-log";
  return "none";
}

async function syncManagerAgentsWithTasks(
  store: ManagerOrchestrationStore,
  taskStore: ManagerTaskStore,
): Promise<ManagerAgent[]> {
  const agents = await store.listAgents();
  const tasks = await taskStore.list(500);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const synced: ManagerAgent[] = [];
  for (const agent of agents) {
    synced.push((await syncManagerAgentRecordWithTask(store, taskStore, agent, taskById)) ?? agent);
  }
  return synced;
}

async function syncManagerAgentWithTask(
  store: ManagerOrchestrationStore,
  taskStore: ManagerTaskStore,
  id: string,
): Promise<ManagerAgent | undefined> {
  const agent = await store.getAgent(id);
  if (!agent) return undefined;
  return (await syncManagerAgentRecordWithTask(store, taskStore, agent)) ?? agent;
}

async function syncManagerAgentRecordWithTask(
  store: ManagerOrchestrationStore,
  taskStore: ManagerTaskStore,
  agent: ManagerAgent,
  taskById?: Map<string, ManagerTask>,
): Promise<ManagerAgent | undefined> {
  if (agent.status === "stale") return agent;
  if (!agent.taskId) return agent;
  const task = taskById ? taskById.get(agent.taskId) : await taskStore.get(agent.taskId);
  if (!task) return agent;
  const status = managerAgentStatusFromTaskState(task.state);
  if (
    status === agent.status &&
    task.updatedAt === agent.lastHeartbeatAt &&
    task.error === agent.lastError
  ) {
    return agent;
  }
  return await store.updateAgent(agent.id, {
    status,
    lastHeartbeatAt: task.updatedAt,
    ...(task.error ? { lastError: task.error } : {}),
    ...(task.completedAt ? { lastOutputAt: task.completedAt } : {}),
    ...(managerWorkerResultText(task) ? { lastOutput: managerWorkerResultText(task) } : {}),
  });
}

async function runManagerAgentMessage(
  input: ManagerAgentRunInput,
): Promise<ManagerAgentMessageResponse> {
  const prompt = input.message.prompt.trim();
  const profile = input.message.profile?.trim() || input.agent.profile || "claude-code";
  const roundId = input.message.roundId?.trim() || input.agent.roundId;
  const round = roundId ? await input.store.getRound(roundId) : undefined;
  const projectId =
    input.message.projectId?.trim() || input.agent.projectId || round?.projectId || undefined;
  await input.store.updateAgent(input.agent.id, {
    status: "running",
    ...(projectId ? { projectId } : {}),
    profile,
    ...(input.message.cwd ? { cwd: input.message.cwd } : {}),
    ...(roundId ? { roundId } : {}),
    lastInstruction: prompt,
    lastError: "",
    acknowledgedAt: "",
    acknowledgedBy: "",
    acknowledgedReason: "",
  });
  const task = await createAndRunManagerTask({
    request: {
      kind: "run-worker",
      ...(projectId ? { projectId } : {}),
      dryRun: input.message.dryRun ?? false,
      requestedBy: "manager-assistant",
      params: {
        profile,
        prompt,
        ...((input.message.cwd ?? input.agent.cwd)
          ? { cwd: input.message.cwd ?? input.agent.cwd }
          : {}),
        ...(input.message.timeoutMs ? { timeoutMs: input.message.timeoutMs } : {}),
        agentId: input.agent.id,
        agentRole: input.agent.role,
        ...(input.agent.sessionId ? { sessionId: input.agent.sessionId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(roundId ? { roundId } : {}),
      },
    },
    store: input.taskStore,
    options: input.options,
    fetchImpl: input.fetchImpl,
    registry: input.registry,
    localToken: input.localToken,
    build: input.build,
    requestUrl: input.requestUrl,
  });
  const taskSessionId = managerWorkerSessionId(task);
  const updated =
    (await input.store.updateAgent(input.agent.id, {
      status: managerAgentStatusFromTaskState(task.state),
      taskId: task.id,
      ...(taskSessionId ? { sessionId: taskSessionId } : {}),
      lastHeartbeatAt: task.updatedAt,
      ...(task.error ? { lastError: task.error } : { lastError: "" }),
      ...(managerWorkerResultText(task) ? { lastOutput: managerWorkerResultText(task) } : {}),
      ...(task.completedAt ? { lastOutputAt: task.completedAt } : {}),
    })) ?? input.agent;
  if (roundId) {
    if (round) {
      await input.store.updateRound(round.id, {
        agentIds: uniqueStrings([...round.agentIds, input.agent.id]),
        taskIds: uniqueStrings([...round.taskIds, task.id]),
      });
    }
  }
  return { agent: updated, task: sanitizeManagerTaskForAssistant(task) };
}

async function dispatchManagerRound(
  input: ManagerRoundDispatchInput,
): Promise<ManagerRoundDispatchResponse> {
  const startedAt = new Date().toISOString();
  await input.store.updateRound(input.round.id, {
    status: "dispatching",
    startedAt: input.round.startedAt ?? startedAt,
    acknowledgedAt: "",
    acknowledgedBy: "",
    acknowledgedReason: "",
  });
  const assignments = await resolveRoundAssignments(input);
  if (!assignments.ok) {
    const blocked =
      (await input.store.updateRound(input.round.id, {
        status: "blocked",
        completedAt: new Date().toISOString(),
        error: assignments.error,
        summary: assignments.error,
      })) ?? input.round;
    return { round: blocked, agents: [], tasks: [] };
  }

  await input.store.updateRound(input.round.id, {
    status: "running",
    acknowledgedAt: "",
    acknowledgedBy: "",
    acknowledgedReason: "",
  });
  // F-R49-X: switch from Promise.all to Promise.allSettled so a single
  // spawn rejection no longer collapses the entire dispatch. Each
  // rejected entry synthesizes a failed-task record so the response
  // reports ALL N assignments, not a truncated subset.
  for (const { agent, assignment } of assignments.value) {
    console.log(
      `dispatch_intent round=${input.round.id} agent=${agent.id} role=${agent.role} label=${assignment.label ?? agent.label ?? ""}`,
    );
  }
  const settled = await Promise.allSettled(
    assignments.value.map(async ({ agent, assignment }) =>
      runManagerAgentMessage({
        agent,
        message: {
          prompt: assignment.prompt,
          ...(assignment.profile ? { profile: assignment.profile } : {}),
          ...(assignment.cwd ? { cwd: assignment.cwd } : {}),
          roundId: input.round.id,
          ...(assignment.timeoutMs ? { timeoutMs: assignment.timeoutMs } : {}),
          dryRun: input.request.dryRun ?? false,
        },
        store: input.store,
        taskStore: input.taskStore,
        options: input.options,
        fetchImpl: input.fetchImpl,
        registry: input.registry,
        localToken: input.localToken,
        build: input.build,
        requestUrl: input.requestUrl,
      }),
    ),
  );
  const results = settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    const assignmentResult = assignments.value[index];
    if (!assignmentResult) throw new Error("manager round assignment result index mismatch");
    const { agent, assignment } = assignmentResult;
    const errMsg =
      entry.reason instanceof Error
        ? entry.reason.message
        : typeof entry.reason === "string"
          ? entry.reason
          : "spawn rejected";
    const failedTask: ManagerTask = {
      id: `spawn-failed-${agent.id}-${Date.now()}`,
      kind: "run-worker",
      ...(input.round.projectId ? { projectId: input.round.projectId } : {}),
      targetLabel: assignment.label ?? agent.label ?? "Claude Code worker",
      params: {
        profile: assignment.profile ?? "claude-code",
        prompt: assignment.prompt,
        ...(assignment.cwd ? { cwd: assignment.cwd } : {}),
        agentId: agent.id,
        agentRole: agent.role,
        roundId: input.round.id,
        ...(input.round.projectId ? { projectId: input.round.projectId } : {}),
      },
      state: "failed",
      dryRun: input.request.dryRun ?? false,
      requestedBy: "manager-assistant",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      result: {
        profile: "claude-code",
        command: "",
        cwd: assignment.cwd ?? "",
        exitCode: 1,
        timedOut: false,
        durationMs: 0,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      error: `dispatch spawn rejected: ${errMsg}`,
    };
    console.log(
      `dispatch_intent round=${input.round.id} agent=${agent.id} role=${agent.role} SPAWN_REJECTED: ${errMsg}`,
    );
    return { agent, task: failedTask };
  });
  const agents = results.map((result) => result.agent);
  const tasks = results.map((result) => result.task);
  const nextStatus = managerRoundStatusFromTasks(tasks);
  const summary = managerRoundSummary(input.round, agents, tasks);
  const updated =
    (await input.store.updateRound(input.round.id, {
      status: nextStatus,
      agentIds: uniqueStrings([...input.round.agentIds, ...agents.map((agent) => agent.id)]),
      taskIds: uniqueStrings([...input.round.taskIds, ...tasks.map((task) => task.id)]),
      completedAt: new Date().toISOString(),
      summary,
      ...(nextStatus === "failed" || nextStatus === "blocked"
        ? { error: tasks.find((task) => task.error)?.error ?? summary }
        : { error: "" }),
    })) ?? input.round;
  return { round: updated, agents, tasks };
}

async function resolveRoundAssignments(input: ManagerRoundDispatchInput): Promise<
  | {
      ok: true;
      value: Array<{ agent: ManagerAgent; assignment: ManagerRoundAgentAssignment }>;
    }
  | { ok: false; error: string }
> {
  const assignments = input.request.assignments?.length
    ? input.request.assignments
    : await assignmentsFromRoundAgents(input.round, input.store);
  if (assignments.length === 0) {
    return { ok: false, error: "round has no agent assignments to dispatch" };
  }
  const out: Array<{ agent: ManagerAgent; assignment: ManagerRoundAgentAssignment }> = [];
  const existingAgents = await input.store.listAgents();
  for (const assignment of assignments) {
    let agent = assignment.agentId ? await input.store.getAgent(assignment.agentId) : undefined;
    if (agent?.status === "stale") agent = undefined;
    if (agent?.projectId && input.round.projectId && agent.projectId !== input.round.projectId) {
      return {
        ok: false,
        error: `agent ${agent.id} belongs to a different project`,
      };
    }
    if (!agent && !assignment.agentId) {
      agent = findReusableManagerAgent(existingAgents, assignment, input.round.projectId);
    }
    if (!agent) {
      agent = await input.store.createAgent({
        ...(input.round.projectId ? { projectId: input.round.projectId } : {}),
        role: assignment.role,
        ...(assignment.label ? { label: assignment.label } : {}),
        ...(assignment.profile ? { profile: assignment.profile } : {}),
        ...(assignment.cwd ? { cwd: assignment.cwd } : {}),
        roundId: input.round.id,
        instruction: assignment.prompt,
      });
      existingAgents.unshift(agent);
    }
    out.push({ agent, assignment });
  }
  return { ok: true, value: out };
}

function findReusableManagerAgent(
  agents: ManagerAgent[],
  assignment: ManagerRoundAgentAssignment,
  projectId?: string,
): ManagerAgent | undefined {
  const profile = assignment.profile?.trim() || "claude-code";
  const cwd = assignment.cwd?.trim() || "";
  const label = assignment.label?.trim();
  return agents.find((agent) => {
    if (agent.status === "stale") return false;
    if ((agent.projectId ?? "") !== (projectId ?? "")) return false;
    if (agent.role !== assignment.role) return false;
    if ((agent.profile || "claude-code") !== profile) return false;
    if ((agent.cwd ?? "") !== cwd) return false;
    if (label && agent.label !== label) return false;
    return true;
  });
}

async function assignmentsFromRoundAgents(
  round: ManagerRound,
  store: ManagerOrchestrationStore,
): Promise<ManagerRoundAgentAssignment[]> {
  const assignments: ManagerRoundAgentAssignment[] = [];
  for (const agentId of round.agentIds) {
    const agent = await store.getAgent(agentId);
    if (!agent?.lastInstruction) continue;
    assignments.push({
      agentId: agent.id,
      role: agent.role,
      label: agent.label,
      profile: agent.profile,
      ...(agent.cwd ? { cwd: agent.cwd } : {}),
      prompt: agent.lastInstruction,
    });
  }
  return assignments;
}

async function buildManagerRoundReport(
  roundId: string,
  store: ManagerOrchestrationStore,
  taskStore: ManagerTaskStore,
): Promise<ManagerRoundReportResponse | null> {
  const round = await store.getRound(roundId);
  if (!round) return null;
  const agents = (
    await Promise.all(round.agentIds.map((id) => syncManagerAgentWithTask(store, taskStore, id)))
  ).filter(isPresent);
  const tasks = (await Promise.all(round.taskIds.map((id) => taskStore.get(id)))).filter(isPresent);
  return {
    round,
    agents,
    tasks: tasks.map(sanitizeManagerTaskForAssistant),
    summary: managerRoundSummary(round, agents, tasks),
  };
}

interface ManagerWorkerRunLedgerInput {
  orchestrationStore: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  roundId?: string;
  projectId?: string;
  limit: number;
  now: Date;
}

async function buildManagerWorkerRunLedger(
  input: ManagerWorkerRunLedgerInput,
): Promise<ManagerWorkerRunLedgerResponse> {
  const [tasks, agents, rounds] = await Promise.all([
    input.taskStore.list(500),
    input.orchestrationStore.listAgents(),
    input.orchestrationStore.listRounds(),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  const agentByTaskId = new Map<string, ManagerAgent>();
  for (const agent of agents) {
    if (agent.taskId) agentByTaskId.set(agent.taskId, agent);
  }
  const scopedRound = input.roundId ? roundById.get(input.roundId) : undefined;
  const projectRoundIds = input.projectId
    ? new Set(
        rounds.filter((round) => round.projectId === input.projectId).map((round) => round.id),
      )
    : undefined;
  const selected = new Map<string, ManagerWorkerRun>();

  for (const task of tasks) {
    if (task.kind !== "run-worker") continue;
    const agent = findManagerWorkerAgent(task, agents, agentByTaskId);
    const round = findManagerWorkerRound(task, agent, scopedRound, roundById, rounds);
    if (input.roundId && round?.id !== input.roundId && !scopedRound?.taskIds.includes(task.id)) {
      continue;
    }
    if (
      input.projectId &&
      task.projectId !== input.projectId &&
      agent?.projectId !== input.projectId &&
      round?.projectId !== input.projectId &&
      !(round?.id && projectRoundIds?.has(round.id))
    ) {
      continue;
    }
    const run = managerWorkerRunFromTask(task, agent, round);
    selected.set(run.id, run);
  }

  if (scopedRound) {
    for (const taskId of scopedRound.taskIds) {
      if (selected.has(`task:${taskId}`)) continue;
      const task = taskById.get(taskId);
      if (task?.kind === "run-worker") {
        const agent = findManagerWorkerAgent(task, agents, agentByTaskId);
        selected.set(`task:${task.id}`, managerWorkerRunFromTask(task, agent, scopedRound));
        continue;
      }
      const agent = agentByTaskId.get(taskId);
      selected.set(
        `missing-task:${taskId}`,
        managerWorkerRunFromMissingTask(taskId, agent, scopedRound, input.now),
      );
    }

    for (const agentId of scopedRound.agentIds) {
      const agent = agentById.get(agentId);
      if (!agent?.taskId) continue;
      if (selected.has(`task:${agent.taskId}`) || selected.has(`missing-task:${agent.taskId}`)) {
        continue;
      }
      selected.set(
        `missing-task:${agent.taskId}`,
        managerWorkerRunFromMissingTask(agent.taskId, agent, scopedRound, input.now),
      );
    }
  } else {
    for (const agent of agents) {
      if (input.projectId && agent.projectId !== input.projectId) continue;
      if (!agent.taskId || taskById.has(agent.taskId)) continue;
      const round = agent.roundId ? roundById.get(agent.roundId) : undefined;
      selected.set(
        `missing-task:${agent.taskId}`,
        managerWorkerRunFromMissingTask(agent.taskId, agent, round, input.now),
      );
    }
  }

  const runs = [...selected.values()]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, input.limit);
  return {
    generatedAt: input.now.toISOString(),
    ...(input.roundId ? { roundId: input.roundId } : {}),
    runs,
    summary: summarizeManagerWorkerRuns(runs),
  };
}

interface ManagerRoundHealthGateInput {
  orchestrationStore: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  round: ManagerRound;
  now: Date;
}

async function buildManagerRoundHealthGate(
  input: ManagerRoundHealthGateInput,
): Promise<ManagerRoundHealthGateResponse> {
  const [agents, ledger] = await Promise.all([
    Promise.all(
      input.round.agentIds.map((id) =>
        syncManagerAgentWithTask(input.orchestrationStore, input.taskStore, id),
      ),
    ),
    buildManagerWorkerRunLedger({
      orchestrationStore: input.orchestrationStore,
      taskStore: input.taskStore,
      roundId: input.round.id,
      limit: 500,
      now: input.now,
    }),
  ]);
  const presentAgents = agents.filter(isPresent);
  const missingAgentIds = input.round.agentIds.filter((_, index) => !agents[index]);
  const healthRuns = selectManagerRoundHealthRuns(ledger.runs);
  const issues = buildManagerRoundHealthIssues(
    input.round,
    presentAgents,
    healthRuns,
    missingAgentIds,
  );
  const hasBlocked = issues.some((issue) => issue.severity === "blocked");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const status =
    hasBlocked || ["blocked", "failed", "cancelled"].includes(input.round.status)
      ? "blocked"
      : hasWarning ||
          healthRuns.some((run) => isManagerWorkerRunActive(run.status)) ||
          isManagerRoundInProgress(input.round.status)
        ? "warning"
        : healthRuns.length === 0 && presentAgents.length === 0
          ? "unknown"
          : "healthy";
  const gate: ManagerRoundHealthGate = {
    generatedAt: input.now.toISOString(),
    roundId: input.round.id,
    status,
    title: input.round.title,
    summary: managerRoundHealthSummary(status, issues, healthRuns.length),
    expectedAgents: input.round.agentIds.length,
    expectedTasks: Math.max(
      input.round.taskIds.length,
      presentAgents.filter((agent) => agent.taskId).length,
    ),
    actualRuns: healthRuns.length,
    completedRuns: healthRuns.filter((run) => run.status === "succeeded").length,
    runningRuns: healthRuns.filter((run) => isManagerWorkerRunActive(run.status)).length,
    blockedRuns: healthRuns.filter((run) => run.status === "failed" || run.status === "blocked")
      .length,
    missingRuns: healthRuns.filter((run) => run.status === "missing").length,
    issues,
  };
  return { gate };
}

interface ManagerProjectOverviewInput {
  project: ManagerProject;
  orchestrationStore: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  artifactStore?: ManagerArtifactStore;
  now: Date;
}

async function buildManagerProjectOverview(
  input: ManagerProjectOverviewInput,
): Promise<ManagerProjectOverviewResponse> {
  const [rounds, agents, tasks] = await Promise.all([
    input.orchestrationStore.listRounds(),
    input.orchestrationStore.listAgents(),
    input.taskStore.list(500),
  ]);
  const projectRounds = selectManagerProjectRounds(input.project, rounds);
  const projectRoundIds = new Set(projectRounds.map((round) => round.id));
  const projectAgents = selectManagerProjectAgents(input.project, projectRoundIds, agents);
  const projectTasks = selectManagerProjectTasks(
    input.project,
    projectRoundIds,
    projectAgents,
    tasks,
  );
  const projectRuns = await buildManagerWorkerRunLedger({
    orchestrationStore: input.orchestrationStore,
    taskStore: input.taskStore,
    projectId: input.project.id,
    limit: 500,
    now: input.now,
  });
  const activeRound = pickManagerProjectActiveRound(input.project, projectRounds);
  const activeRoundAgentIds = new Set(activeRound?.agentIds ?? []);
  const activeAgents = activeRound
    ? projectAgents.filter(
        (agent) => agent.roundId === activeRound.id || activeRoundAgentIds.has(agent.id),
      )
    : projectAgents;
  const activeTaskIds = new Set(activeRound?.taskIds ?? []);
  for (const agent of activeAgents) {
    if (agent.taskId) activeTaskIds.add(agent.taskId);
  }
  const activeTasks = activeRound
    ? projectTasks.filter(
        (task) => activeTaskIds.has(task.id) || taskRoundId(task) === activeRound.id,
      )
    : projectTasks;
  const storedArtifacts = input.artifactStore
    ? await input.artifactStore.list(input.project.id)
    : null;
  const derivedArtifactCount = countManagerProjectArtifacts(projectAgents, projectTasks);
  const artifactCount =
    storedArtifacts && storedArtifacts.artifacts.length > 0
      ? storedArtifacts.artifacts.length
      : derivedArtifactCount;
  const currentSignal = managerProjectCurrentSignal({
    project: input.project,
    round: activeRound,
    agents: activeAgents,
    tasks: activeTasks,
    runs: projectRuns.runs,
  });
  const nextAction = managerProjectNextAction({
    project: input.project,
    round: activeRound,
    signal: currentSignal,
    agents: activeAgents,
    tasks: activeTasks,
    runs: projectRuns.runs,
  });
  const recentSignals = managerProjectRecentSignals({
    round: activeRound,
    agents: activeAgents,
    tasks: activeTasks,
    runs: projectRuns.runs,
  });
  const lastUpdateAt = latestIsoString([
    input.project.updatedAt,
    ...projectRounds.map((round) => round.updatedAt),
    ...projectAgents.map((agent) => agent.updatedAt),
    ...projectTasks.map((task) => task.updatedAt),
    ...projectRuns.runs.map((run) => run.updatedAt),
    ...(storedArtifacts?.artifacts ?? []).map((artifact) => artifact.updatedAt),
  ]);

  return {
    generatedAt: input.now.toISOString(),
    project: input.project,
    counts: {
      rounds: projectRounds.length,
      agents: projectAgents.length,
      runningAgents: projectAgents.filter((agent) =>
        ["assigned", "running", "waiting"].includes(agent.status),
      ).length,
      completedAgents: projectAgents.filter((agent) => agent.status === "completed").length,
      blockedAgents: projectAgents.filter(
        (agent) => ["blocked", "failed", "stale"].includes(agent.status) && !agent.acknowledgedAt,
      ).length,
      tasks: projectTasks.length,
      runningTasks: projectTasks.filter((task) => !isManagerTaskTerminalState(task.state)).length,
      failedTasks: projectTasks.filter(
        (task) => (task.state === "failed" || task.state === "blocked") && !task.acknowledgedAt,
      ).length,
      workerRuns: projectRuns.runs.length,
      artifacts: artifactCount,
    },
    currentSignal,
    nextAction,
    recentSignals,
    ...(activeRound ? { activeRound } : {}),
    ...(lastUpdateAt ? { lastUpdateAt } : {}),
  };
}

interface ManagerProjectHygieneInput {
  project: ManagerProject;
  orchestrationStore: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  blockerStore: ManagerBlockerStore;
  now: Date;
}

async function buildManagerProjectHygieneReport(
  input: ManagerProjectHygieneInput,
): Promise<ManagerProjectHygieneReport> {
  const [ledger, rounds, blockers] = await Promise.all([
    buildManagerWorkerRunLedger({
      orchestrationStore: input.orchestrationStore,
      taskStore: input.taskStore,
      projectId: input.project.id,
      limit: 500,
      now: input.now,
    }),
    input.orchestrationStore.listRounds(),
    input.blockerStore.list(input.project.id),
  ]);
  const openBlockerByDedupeKey = new Map(
    blockers.blockers
      .filter((blocker) => blocker.dedupeKey)
      .map((blocker) => [blocker.dedupeKey as string, blocker]),
  );
  const issues: ManagerProjectHygieneIssue[] = [];
  for (const run of ledger.runs) {
    for (const issue of run.integrity) {
      if (issue === "ok") continue;
      issues.push(
        managerProjectRunHygieneIssue({
          project: input.project,
          run,
          kind: issue,
          blocker: openBlockerByDedupeKey.get(
            managerProjectRunHygieneDedupeKey(input.project.id, run.id, issue),
          ),
        }),
      );
    }
  }

  const activeRound = input.project.activeRoundId
    ? rounds.find((round) => round.id === input.project.activeRoundId)
    : undefined;
  if (input.project.activeRoundId && !activeRound) {
    const dedupeKey = `project-hygiene:${input.project.id}:missing-active-round:${input.project.activeRoundId}`;
    issues.push(
      managerProjectStaticHygieneIssue({
        project: input.project,
        kind: "missing-active-round",
        severity: "error",
        title: "Active round record is missing.",
        detail: `Project activeRoundId points at ${input.project.activeRoundId}, but no round record exists.`,
        cleanupEligible: true,
        protected: false,
        dedupeKey,
        blocker: openBlockerByDedupeKey.get(dedupeKey),
      }),
    );
  }

  const activeArchivedRuns = ledger.runs.filter((run) => isManagerWorkerRunActive(run.status));
  if (
    input.project.status === "archived" &&
    (Boolean(input.project.activeRoundId) || activeArchivedRuns.length > 0)
  ) {
    const dedupeKey = `project-hygiene:${input.project.id}:archived-active-state`;
    issues.push(
      managerProjectStaticHygieneIssue({
        project: input.project,
        kind: "archived-active-state",
        severity: "warning",
        title: "Archived project still has active orchestration state.",
        detail: `${activeArchivedRuns.length} active worker run(s), activeRoundId: ${
          input.project.activeRoundId ?? "none"
        }.`,
        cleanupEligible: false,
        protected: true,
        dedupeKey,
        blocker: openBlockerByDedupeKey.get(dedupeKey),
      }),
    );
  }

  const sortedIssues = sortManagerProjectHygieneIssues(issues);
  return {
    generatedAt: input.now.toISOString(),
    projectId: input.project.id,
    project: input.project,
    summary: summarizeManagerProjectHygiene(sortedIssues),
    issues: sortedIssues,
    workerRuns: ledger.summary,
  };
}

interface ManagerProjectHygieneCleanupInput extends ManagerProjectHygieneInput {
  request: ManagerProjectHygieneCleanupRequest;
}

async function cleanupManagerProjectHygiene(
  input: ManagerProjectHygieneCleanupInput,
): Promise<ManagerProjectHygieneCleanupResponse> {
  const before = await buildManagerProjectHygieneReport(input);
  const selectedIds = input.request.issueIds ? new Set(input.request.issueIds) : undefined;
  const candidates = before.issues.filter(
    (issue) =>
      (!selectedIds || selectedIds.has(issue.id)) &&
      issue.cleanupEligible &&
      issue.cleanupAction === "create-blocker",
  );
  const candidateIds = new Set(candidates.map((issue) => issue.id));
  const skipped = before.issues.filter(
    (issue) => (selectedIds ? selectedIds.has(issue.id) : true) && !candidateIds.has(issue.id),
  );
  const created: ManagerBlocker[] = [];
  const existing: ManagerBlocker[] = [];
  const failures: ManagerProjectHygieneCleanupResponse["failures"] = [];
  const shouldCreateBlockers = !input.request.dryRun && input.request.createBlockers !== false;

  if (shouldCreateBlockers) {
    for (const issue of candidates) {
      if (!issue.dedupeKey) {
        failures.push({ issueId: issue.id, error: "hygiene issue does not have a dedupe key" });
        continue;
      }
      try {
        const result = await input.blockerStore.create(input.project.id, {
          title: issue.title,
          ...(issue.detail ? { detail: issue.detail } : {}),
          severity: issue.severity,
          owner: "manager",
          requiredAction: "manager",
          source: "system",
          dedupeKey: issue.dedupeKey,
          ...(issue.roundId ? { roundId: issue.roundId } : {}),
          ...(issue.agentId ? { agentId: issue.agentId } : {}),
          ...(issue.taskId ? { taskId: issue.taskId } : {}),
        });
        if (result.created) created.push(result.blocker);
        else existing.push(result.blocker);
      } catch (error) {
        failures.push({ issueId: issue.id, error: errorMessage(error) });
      }
    }
  }

  return {
    generatedAt: input.now.toISOString(),
    projectId: input.project.id,
    dryRun: input.request.dryRun === true,
    created,
    existing,
    skipped,
    failures,
    report: shouldCreateBlockers ? await buildManagerProjectHygieneReport(input) : before,
  };
}

function managerProjectRunHygieneIssue(input: {
  project: ManagerProject;
  run: ManagerWorkerRun;
  kind: Exclude<ManagerWorkerRunIntegrity, "ok">;
  blocker: ManagerBlocker | undefined;
}): ManagerProjectHygieneIssue {
  const severity = input.kind === "missing-session" ? "warning" : "error";
  const protectedRun = isManagerWorkerRunActive(input.run.status);
  const dedupeKey = managerProjectRunHygieneDedupeKey(input.project.id, input.run.id, input.kind);
  return {
    id: managerProjectHygieneIssueId(input.kind, input.run.id),
    projectId: input.project.id,
    kind: input.kind,
    severity,
    title: `Worker hygiene: ${managerWorkerIntegrityMessage(input.kind)}`,
    ...(managerProjectRunHygieneDetail(input.run)
      ? {
          detail: managerProjectRunHygieneDetail(input.run),
        }
      : {}),
    cleanupAction: protectedRun ? "none" : "create-blocker",
    cleanupEligible: !protectedRun,
    protected: protectedRun,
    dedupeKey,
    ...(input.blocker ? { blockerId: input.blocker.id } : {}),
    runId: input.run.id,
    ...(input.run.roundId ? { roundId: input.run.roundId } : {}),
    ...(input.run.agentId ? { agentId: input.run.agentId } : {}),
    ...(input.run.taskId ? { taskId: input.run.taskId } : {}),
    updatedAt: input.run.updatedAt,
  };
}

function managerProjectStaticHygieneIssue(input: {
  project: ManagerProject;
  kind: Extract<ManagerProjectHygieneIssueKind, "missing-active-round" | "archived-active-state">;
  severity: ManagerBlockerSeverity;
  title: string;
  detail: string;
  cleanupEligible: boolean;
  protected: boolean;
  dedupeKey: string;
  blocker: ManagerBlocker | undefined;
}): ManagerProjectHygieneIssue {
  return {
    id: managerProjectHygieneIssueId(input.kind, input.dedupeKey),
    projectId: input.project.id,
    kind: input.kind,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    cleanupAction: input.cleanupEligible ? "create-blocker" : "none",
    cleanupEligible: input.cleanupEligible,
    protected: input.protected,
    dedupeKey: input.dedupeKey,
    ...(input.blocker ? { blockerId: input.blocker.id } : {}),
    updatedAt: input.project.updatedAt,
  };
}

function managerProjectRunHygieneDedupeKey(
  projectId: string,
  runId: string,
  kind: Exclude<ManagerWorkerRunIntegrity, "ok">,
): string {
  return `project-hygiene:${projectId}:worker:${kind}:${runId}`;
}

function managerProjectHygieneIssueId(kind: ManagerProjectHygieneIssueKind, scope: string): string {
  return `${kind}:${scope}`.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 220);
}

function managerProjectRunHygieneDetail(run: ManagerWorkerRun): string | undefined {
  const lines = [
    `Run ${run.id} is ${run.status}.`,
    run.agentRole || run.agentLabel
      ? `Agent: ${[run.agentRole, run.agentLabel].filter(Boolean).join(" / ")}.`
      : "",
    run.roundId ? `Round: ${run.roundId}.` : "",
    run.taskId ? `Task: ${run.taskId}.` : "",
    run.error ? `Error: ${run.error}` : "",
    !run.error && run.outputPreview ? `Output: ${run.outputPreview}` : "",
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function summarizeManagerProjectHygiene(issues: ManagerProjectHygieneIssue[]) {
  const categories = Object.fromEntries(
    MANAGER_PROJECT_HYGIENE_ISSUE_KINDS.map((kind) => [kind, 0]),
  ) as Record<ManagerProjectHygieneIssueKind, number>;
  for (const issue of issues) {
    categories[issue.kind] += 1;
  }
  return {
    total: issues.length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    cleanupCandidates: issues.filter((issue) => issue.cleanupEligible).length,
    protected: issues.filter((issue) => issue.protected).length,
    recordedBlockers: issues.filter((issue) => issue.blockerId).length,
    categories,
  };
}

function sortManagerProjectHygieneIssues(
  issues: ManagerProjectHygieneIssue[],
): ManagerProjectHygieneIssue[] {
  return [...issues].sort(
    (left, right) =>
      blockerSeverityRank(right.severity) - blockerSeverityRank(left.severity) ||
      Number(right.cleanupEligible) - Number(left.cleanupEligible) ||
      Number(Boolean(right.blockerId)) - Number(Boolean(left.blockerId)) ||
      Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "") ||
      left.id.localeCompare(right.id),
  );
}

function blockerSeverityRank(value: ManagerBlockerSeverity): number {
  if (value === "error") return 3;
  if (value === "warning") return 2;
  return 1;
}

function selectManagerProjectRounds(
  project: ManagerProject,
  rounds: ManagerRound[],
): ManagerRound[] {
  return rounds.filter(
    (round) => round.projectId === project.id || round.id === project.activeRoundId,
  );
}

function selectManagerProjectAgents(
  project: ManagerProject,
  roundIds: Set<string>,
  agents: ManagerAgent[],
): ManagerAgent[] {
  return agents.filter(
    (agent) =>
      agent.projectId === project.id || Boolean(agent.roundId && roundIds.has(agent.roundId)),
  );
}

function selectManagerProjectTasks(
  project: ManagerProject,
  roundIds: Set<string>,
  agents: ManagerAgent[],
  tasks: ManagerTask[],
): ManagerTask[] {
  const taskIds = new Set(agents.map((agent) => agent.taskId).filter(isPresent));
  return tasks.filter((task) => {
    const roundId = taskRoundId(task);
    return (
      task.projectId === project.id ||
      taskIds.has(task.id) ||
      Boolean(roundId && roundIds.has(roundId))
    );
  });
}

interface ManagerProjectArtifactScanInput {
  project: ManagerProject;
  orchestrationStore: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  artifactStore: ManagerArtifactStore;
  limit?: number;
  now: Date;
}

async function scanManagerProjectArtifacts(
  input: ManagerProjectArtifactScanInput,
): Promise<ManagerArtifactUpsertResult> {
  const [rounds, agents, tasks] = await Promise.all([
    input.orchestrationStore.listRounds(),
    input.orchestrationStore.listAgents(),
    input.taskStore.list(500),
  ]);
  const projectRounds = selectManagerProjectRounds(input.project, rounds);
  const projectRoundIds = new Set(projectRounds.map((round) => round.id));
  const projectAgents = selectManagerProjectAgents(input.project, projectRoundIds, agents);
  const projectTasks = selectManagerProjectTasks(
    input.project,
    projectRoundIds,
    projectAgents,
    tasks,
  );
  const agentByTaskId = new Map<string, ManagerAgent>();
  for (const agent of projectAgents) {
    if (agent.taskId) agentByTaskId.set(agent.taskId, agent);
  }
  const artifacts = new Map<string, ManagerArtifactUpsertInput>();
  const maxArtifacts = Math.max(1, Math.min(input.limit ?? 200, 500));

  const addArtifact = (
    path: string,
    source: Omit<ManagerArtifactUpsertInput, "path" | "kind" | "status">,
  ) => {
    if (artifacts.size >= maxArtifacts) return;
    const key = path.replace(/\//g, "\\").toLowerCase();
    artifacts.set(key, {
      path,
      kind: inferManagerArtifactKind(path),
      status: "active",
      source: "scan",
      ...source,
    });
  };

  for (const agent of projectAgents) {
    const text = [agent.lastInstruction, agent.lastOutput, agent.lastError].join("\n");
    for (const path of collectManagerArtifactPaths(text)) {
      addArtifact(path, {
        owner: agent.role,
        source: "worker",
        ...(agent.roundId ? { roundId: agent.roundId } : {}),
        agentId: agent.id,
        ...(agent.taskId ? { taskId: agent.taskId } : {}),
      });
    }
  }

  for (const task of projectTasks) {
    const agent = agentByTaskId.get(task.id);
    const text = [
      task.error,
      JSON.stringify(task.params ?? {}),
      JSON.stringify(task.result ?? {}),
      ...task.steps.map((step) => `${step.label}\n${step.summary}\n${step.detail ?? ""}`),
    ].join("\n");
    for (const path of collectManagerArtifactPaths(text)) {
      addArtifact(path, {
        owner: agent?.role ?? task.kind,
        source: agent ? "worker" : "manager",
        ...(agent?.roundId ? { roundId: agent.roundId } : {}),
        ...(agent ? { agentId: agent.id } : {}),
        taskId: task.id,
      });
    }
  }

  return await input.artifactStore.upsertMany(input.project.id, [...artifacts.values()]);
}

interface ManagerProjectProtocolStateInput {
  project: ManagerProject;
  protocolStore: ManagerProtocolStore;
  includeExcerpt?: boolean;
  limit?: number;
}

interface ManagerProtocolSeedResult {
  sourceRoot: string;
  copied: string[];
  skipped: string[];
}

async function seedManagerProjectProtocolFromBase(
  projectCwd: string,
  configuredBasePath: string | null | undefined,
): Promise<ManagerProtocolSeedResult> {
  const sourceRoot = resolve(configuredBasePath?.trim() || DEFAULT_MANAGER_PROTOCOL_BASE_PATH);
  const targetRoot = resolve(projectCwd);
  const sourceStat = await stat(sourceRoot).catch((error) => {
    throw new Error(`base protocol source cannot be read: ${errorMessage(error)}`);
  });
  if (!sourceStat.isDirectory()) {
    throw new Error(`base protocol source is not a directory: ${sourceRoot}`);
  }
  await mkdir(targetRoot, { recursive: true });

  const copied: string[] = [];
  const skipped: string[] = [];
  let foundSource = false;

  for (const file of MANAGER_PROTOCOL_BASE_FILES) {
    const sourcePath = resolve(sourceRoot, file);
    const sourceRelative = relative(sourceRoot, sourcePath);
    if (sourceRelative.startsWith("..") || isAbsolute(sourceRelative)) {
      skipped.push(file);
      continue;
    }
    const fileStat = await stat(sourcePath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (!fileStat?.isFile()) continue;
    foundSource = true;

    const targetPath = resolve(targetRoot, file);
    const targetRelative = relative(targetRoot, targetPath);
    if (targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
      skipped.push(file);
      continue;
    }
    const targetExists = await stat(targetPath)
      .then((targetStat) => targetStat.isFile())
      .catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      });
    if (targetExists) {
      skipped.push(file);
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(sourcePath));
    copied.push(file);
  }

  if (!foundSource) {
    throw new Error(`base protocol source has no known protocol files: ${sourceRoot}`);
  }

  return { sourceRoot, copied, skipped };
}

async function buildManagerProjectProtocolState(
  input: ManagerProjectProtocolStateInput,
): Promise<ManagerProtocolState> {
  const metadata = await input.protocolStore.get(input.project.id);
  const scannedAt = new Date().toISOString();
  const includeExcerpt = input.includeExcerpt ?? true;
  const limit = Math.max(
    MANAGER_PROTOCOL_CORE_FILES.length,
    Math.min(input.limit ?? MANAGER_PROTOCOL_CORE_FILES.length, 50),
  );
  const coreFiles = MANAGER_PROTOCOL_CORE_FILES.slice(0, limit);
  const warnings: string[] = [];
  const cwd = resolve(input.project.cwd);

  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      throw new Error(`project cwd is not a directory: ${input.project.cwd}`);
    }
  } catch (error) {
    const message = `project cwd cannot be scanned: ${errorMessage(error)}`;
    warnings.push(message);
    return {
      projectId: input.project.id,
      version: metadata?.version ?? "unversioned",
      activeRules: metadata?.activeRules ?? [],
      files: coreFiles.map(({ file, role }) => ({
        path: file,
        role,
        status: "error",
        error: message,
      })),
      ...(metadata?.latestChange ? { latestChange: metadata.latestChange } : {}),
      scannedAt,
      warnings,
    };
  }

  const files = await Promise.all(
    coreFiles.map(({ file, role }) => scanManagerProtocolFile(cwd, file, role, includeExcerpt)),
  );
  const presentCount = files.filter((file) => file.status === "present").length;
  if (presentCount === 0) {
    warnings.push("No core protocol files were found in the project root.");
  } else if (!metadata?.latestChange) {
    warnings.push("Protocol files exist, but the latest protocol change is not recorded.");
  } else if (!metadata.latestChange.decisionId) {
    warnings.push("Latest protocol change is not linked to a project decision.");
  }
  if ((metadata?.activeRules.length ?? 0) === 0) {
    warnings.push("No active protocol rules are pinned yet.");
  }

  return {
    projectId: input.project.id,
    version: metadata?.version ?? "unversioned",
    activeRules: metadata?.activeRules ?? [],
    files,
    ...(metadata?.latestChange ? { latestChange: metadata.latestChange } : {}),
    scannedAt,
    warnings,
  };
}

async function scanManagerProtocolFile(
  cwd: string,
  file: string,
  role: ManagerProtocolFileRole,
  includeExcerpt: boolean,
): Promise<ManagerProtocolFile> {
  const absolutePath = resolve(cwd, file);
  const relativePath = relative(cwd, absolutePath) || file;
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return {
      path: file,
      role,
      status: "error",
      error: "protocol file resolved outside the project cwd",
    };
  }
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return {
        path: relativePath,
        role,
        status: "error",
        error: "protocol path is not a file",
      };
    }
    if (fileStat.size > MANAGER_PROTOCOL_MAX_FILE_BYTES) {
      return {
        path: relativePath,
        role,
        status: "too_large",
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      };
    }
    const output: ManagerProtocolFile = {
      path: relativePath,
      role,
      status: "present",
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    };
    if (includeExcerpt) {
      output.excerpt = (await readFile(absolutePath, "utf8")).slice(
        0,
        MANAGER_PROTOCOL_EXCERPT_CHARS,
      );
    }
    return output;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: relativePath, role, status: "missing" };
    }
    return {
      path: relativePath,
      role,
      status: "error",
      error: errorMessage(error),
    };
  }
}

function pickManagerProjectActiveRound(
  project: ManagerProject,
  rounds: ManagerRound[],
): ManagerRound | undefined {
  return (
    (project.activeRoundId
      ? rounds.find((round) => round.id === project.activeRoundId)
      : undefined) ??
    rounds.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ??
    rounds[0]
  );
}

function managerProjectCurrentSignal(input: {
  project: ManagerProject;
  round: ManagerRound | undefined;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  runs: ManagerWorkerRun[];
}): ManagerProjectOverviewSignal {
  const failedTask = input.tasks.find(
    (task) => !task.acknowledgedAt && (task.state === "failed" || task.state === "blocked"),
  );
  if (failedTask) {
    return {
      tone: failedTask.state === "failed" ? "error" : "warning",
      title: `${failedTask.kind} task ${failedTask.state}`,
      ...(failedTask.error ? { detail: failedTask.error } : {}),
      updatedAt: failedTask.updatedAt,
      taskId: failedTask.id,
      ...(taskRoundId(failedTask) ? { roundId: taskRoundId(failedTask) } : {}),
    };
  }
  const failedAgent = input.agents.find(
    (agent) => !agent.acknowledgedAt && ["blocked", "failed", "stale"].includes(agent.status),
  );
  if (failedAgent) {
    return {
      tone: failedAgent.status === "failed" ? "error" : "warning",
      title: `${failedAgent.role} agent ${failedAgent.status}`,
      detail: failedAgent.lastError || failedAgent.lastOutput || failedAgent.lastInstruction,
      updatedAt: failedAgent.updatedAt,
      agentId: failedAgent.id,
      ...(failedAgent.roundId ? { roundId: failedAgent.roundId } : {}),
      ...(failedAgent.taskId ? { taskId: failedAgent.taskId } : {}),
    };
  }
  if (input.round?.status === "blocked" || input.round?.status === "failed") {
    return {
      tone: input.round.status === "failed" ? "error" : "warning",
      title: `${input.round.title} ${input.round.status}`,
      detail: input.round.error || input.round.summary,
      updatedAt: input.round.updatedAt,
      roundId: input.round.id,
    };
  }
  const runningRun = input.runs.find((run) => isManagerWorkerRunActive(run.status));
  if (runningRun) {
    return {
      tone: "running",
      title: `${runningRun.agentRole ?? runningRun.agentLabel ?? "worker"} running`,
      detail: runningRun.outputPreview || runningRun.error,
      updatedAt: runningRun.updatedAt,
      ...(runningRun.roundId ? { roundId: runningRun.roundId } : {}),
      ...(runningRun.agentId ? { agentId: runningRun.agentId } : {}),
      ...(runningRun.taskId ? { taskId: runningRun.taskId } : {}),
    };
  }
  if (input.round) {
    return {
      tone: input.round.status === "completed" ? "success" : "idle",
      title: input.round.title,
      detail: input.round.summary || input.round.objective,
      updatedAt: input.round.updatedAt,
      roundId: input.round.id,
    };
  }
  return {
    tone: input.project.status === "blocked" ? "warning" : "idle",
    title: "No orchestration round",
    detail: input.project.goal || "Create a round before dispatching workers.",
    updatedAt: input.project.updatedAt,
  };
}

function managerProjectNextAction(input: {
  project: ManagerProject;
  round: ManagerRound | undefined;
  signal: ManagerProjectOverviewSignal;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  runs: ManagerWorkerRun[];
}): ManagerProjectOverviewAction {
  if (!input.round) {
    return {
      kind: "create-round",
      label: "Create the first round",
      detail: input.project.goal || "Define the first orchestration objective.",
    };
  }
  if (input.signal.taskId || input.signal.agentId || input.signal.tone === "error") {
    return {
      kind: "inspect",
      label: "Inspect current blocker",
      detail: input.signal.detail || input.signal.title,
      ...(input.signal.roundId ? { roundId: input.signal.roundId } : {}),
      ...(input.signal.agentId ? { agentId: input.signal.agentId } : {}),
      ...(input.signal.taskId ? { taskId: input.signal.taskId } : {}),
    };
  }
  if (input.runs.some((run) => isManagerWorkerRunActive(run.status))) {
    return {
      kind: "wait",
      label: "Wait for worker results",
      detail: "Keep watching active runs before closing or dispatching another round.",
      roundId: input.round.id,
    };
  }
  if (input.tasks.length > 0 || input.agents.some((agent) => agent.status === "completed")) {
    return {
      kind: "summarize",
      label: "Summarize round result",
      detail: "Ask the manager to compare worker outputs and record the next decision.",
      roundId: input.round.id,
    };
  }
  return {
    kind: "dispatch",
    label: "Dispatch agents",
    detail: "No worker task has been recorded for the active round.",
    roundId: input.round.id,
  };
}

interface ManagerCommandFlowInput {
  project: ManagerProject;
  orchestrationStore: ManagerOrchestrationStore;
  taskStore: ManagerTaskStore;
  decisionStore: ManagerDecisionStore;
  blockerStore: ManagerBlockerStore;
  artifactStore: ManagerArtifactStore;
  protocolStore: ManagerProtocolStore;
  repoRoot: string;
  now: Date;
}

async function buildManagerCommandFlow(
  input: ManagerCommandFlowInput,
): Promise<ManagerCommandFlowResponse> {
  const [overview, decisions, blockers, artifacts, protocol, rounds, agents, tasks, ledger] =
    await Promise.all([
      buildManagerProjectOverview({
        project: input.project,
        orchestrationStore: input.orchestrationStore,
        taskStore: input.taskStore,
        artifactStore: input.artifactStore,
        now: input.now,
      }),
      input.decisionStore.list(input.project.id),
      input.blockerStore.list(input.project.id),
      input.artifactStore.list(input.project.id),
      buildManagerProjectProtocolState({
        project: input.project,
        protocolStore: input.protocolStore,
        includeExcerpt: false,
      }),
      input.orchestrationStore.listRounds(),
      input.orchestrationStore.listAgents(),
      input.taskStore.list(500),
      buildManagerWorkerRunLedger({
        orchestrationStore: input.orchestrationStore,
        taskStore: input.taskStore,
        projectId: input.project.id,
        limit: 500,
        now: input.now,
      }),
    ]);
  const projectRounds = selectManagerProjectRounds(input.project, rounds);
  const projectRoundIds = new Set(projectRounds.map((round) => round.id));
  const projectAgents = selectManagerProjectAgents(input.project, projectRoundIds, agents);
  const projectTasks = selectManagerProjectTasks(
    input.project,
    projectRoundIds,
    projectAgents,
    tasks,
  );
  const activeRound =
    overview.activeRound ??
    (input.project.activeRoundId
      ? projectRounds.find((round) => round.id === input.project.activeRoundId)
      : undefined);
  const project = managerProjectWithRoundCommandFlowState(input.project, activeRound);
  const overviewForProject =
    overview.project === project
      ? overview
      : {
          ...overview,
          project,
        };
  const roundHealthGate = activeRound
    ? buildManagerRoundHealthGateFromFlow({
        round: activeRound,
        agents: projectAgents,
        runs: ledger.runs,
        now: input.now,
      })
    : undefined;
  const readiness = managerCommandFlowReadiness(
    project,
    protocol,
    blockers.blockers,
    input.repoRoot,
  );
  const evidence = buildManagerEvidenceItems({
    project,
    activeRound,
    rounds: projectRounds,
    agents: projectAgents,
    tasks: projectTasks,
    runs: ledger.runs,
    artifacts: artifacts.artifacts,
    protocol,
    decisions: decisions.decisions,
    blockers: blockers.blockers,
    now: input.now,
  });
  const agentResults = buildManagerAgentResults({
    project,
    activeRound,
    agents: projectAgents,
    runs: ledger.runs,
    evidence,
    now: input.now,
  });
  const protocolTrace = buildManagerProtocolTrace({
    project,
    activeRound,
    protocol,
    agents: projectAgents,
    evidence,
  });
  const judgments = buildManagerJudgmentPackets({
    project,
    activeRound,
    roundHealthGate,
    readiness,
    nextAction: overviewForProject.nextAction,
    decisions: decisions.decisions,
    blockers: blockers.blockers,
    runs: ledger.runs,
    evidence,
    agentResults,
    protocolTrace,
    now: input.now,
  });
  return {
    generatedAt: input.now.toISOString(),
    project,
    charter: effectiveProjectCharter(project),
    wizardEvents: [...(project.wizardEvents ?? [])].slice(-10).reverse(),
    protocol,
    overview: overviewForProject,
    decisions: decisions.decisions,
    blockers: blockers.blockers,
    artifacts: artifacts.artifacts,
    rounds: projectRounds,
    ...(activeRound ? { activeRound } : {}),
    workerRuns: ledger.runs,
    evidence,
    agentResults,
    protocolTrace,
    judgments,
    readiness,
    nextAction: overviewForProject.nextAction,
  };
}

function managerProjectWithRoundCommandFlowState(
  project: ManagerProject,
  activeRound: ManagerRound | undefined,
): ManagerProject {
  if (!activeRound) return project;
  if (project.status === "archived" || project.status === "completed") return project;
  if (project.status === "blocked" || project.flowStage === "replanning") return project;
  if (activeRound.status === "planned") return project;
  const status = projectStatusFromRoundStatus(activeRound.status);
  const flowStage = projectFlowStageFromRoundStatus(activeRound.status);
  if (project.status === status && project.flowStage === flowStage) return project;
  return {
    ...project,
    status,
    flowStage,
  };
}

function buildManagerRoundHealthGateFromFlow(input: {
  round: ManagerRound;
  agents: ManagerAgent[];
  runs: ManagerWorkerRun[];
  now: Date;
}): ManagerRoundHealthGate {
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const presentAgents = input.round.agentIds.map((id) => agentById.get(id)).filter(isPresent);
  const missingAgentIds = input.round.agentIds.filter((id) => !agentById.has(id));
  const activeAgentIds = new Set(input.round.agentIds);
  const activeTaskIds = new Set(input.round.taskIds);
  const healthRuns = selectManagerRoundHealthRuns(
    input.runs.filter(
      (run) =>
        run.roundId === input.round.id ||
        Boolean(run.agentId && activeAgentIds.has(run.agentId)) ||
        Boolean(run.taskId && activeTaskIds.has(run.taskId)),
    ),
  );
  const issues = buildManagerRoundHealthIssues(
    input.round,
    presentAgents,
    healthRuns,
    missingAgentIds,
  );
  const hasBlocked = issues.some((issue) => issue.severity === "blocked");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const status =
    hasBlocked || ["blocked", "failed", "cancelled"].includes(input.round.status)
      ? "blocked"
      : hasWarning ||
          healthRuns.some((run) => isManagerWorkerRunActive(run.status)) ||
          isManagerRoundInProgress(input.round.status)
        ? "warning"
        : healthRuns.length === 0 && presentAgents.length === 0
          ? "unknown"
          : "healthy";
  return {
    generatedAt: input.now.toISOString(),
    roundId: input.round.id,
    status,
    title: input.round.title,
    summary: managerRoundHealthSummary(status, issues, healthRuns.length),
    expectedAgents: input.round.agentIds.length,
    expectedTasks: Math.max(
      input.round.taskIds.length,
      presentAgents.filter((agent) => agent.taskId).length,
    ),
    actualRuns: healthRuns.length,
    completedRuns: healthRuns.filter((run) => run.status === "succeeded").length,
    runningRuns: healthRuns.filter((run) => isManagerWorkerRunActive(run.status)).length,
    blockedRuns: healthRuns.filter((run) => run.status === "failed" || run.status === "blocked")
      .length,
    missingRuns: healthRuns.filter((run) => run.status === "missing").length,
    issues,
  };
}

interface ManagerEvidenceBuildInput {
  project: ManagerProject;
  activeRound?: ManagerRound | undefined;
  rounds: ManagerRound[];
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  runs: ManagerWorkerRun[];
  artifacts: ManagerArtifact[];
  protocol: ManagerProtocolState;
  decisions: ManagerDecision[];
  blockers: ManagerBlocker[];
  now: Date;
}

function buildManagerEvidenceItems(input: ManagerEvidenceBuildInput): ManagerEvidenceItem[] {
  const evidence = new Map<string, ManagerEvidenceItem>();
  const put = (item: ManagerEvidenceItem) => {
    evidence.set(item.id, item);
  };

  for (const run of input.runs) {
    if (run.projectId && run.projectId !== input.project.id) continue;
    put({
      id: managerEvidenceId("run", run.id),
      projectId: input.project.id,
      ...(run.roundId ? { roundId: run.roundId } : {}),
      ...(run.agentId ? { agentId: run.agentId } : {}),
      ...(run.taskId ? { taskId: run.taskId } : {}),
      type: "worker-run",
      label: `${run.agentRole ?? run.agentLabel ?? run.profile ?? "worker"} ${run.status}`,
      detail: managerRunEvidenceDetail(run),
      ...(run.taskId ? { ref: run.taskId } : {}),
      ...(run.error || run.outputPreview
        ? { excerpt: clipManagerEvidenceText(run.error || run.outputPreview, 360) }
        : {}),
      status: managerRunEvidenceStatus(run),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
  }

  for (const agent of input.agents) {
    const excerpt = agent.lastError || agent.lastOutput;
    if (!excerpt) continue;
    put({
      id: managerEvidenceId("agent", agent.id, agent.lastOutputAt ?? agent.updatedAt),
      projectId: input.project.id,
      ...(agent.roundId ? { roundId: agent.roundId } : {}),
      agentId: agent.id,
      ...(agent.taskId ? { taskId: agent.taskId } : {}),
      type: "agent-output",
      label: `${agent.role} output`,
      detail: agent.lastError ? "Agent reported an error." : "Agent produced output.",
      ...(agent.taskId ? { ref: agent.taskId } : {}),
      excerpt: clipManagerEvidenceText(excerpt, 360),
      status: agent.lastError ? "failed" : managerAgentEvidenceStatus(agent),
      createdAt: agent.createdAt,
      updatedAt: agent.lastOutputAt ?? agent.updatedAt,
    });
  }

  for (const task of input.tasks) {
    const error = task.error?.trim();
    const lastStep = task.steps
      .filter((step) => step.summary || step.detail)
      .sort((left, right) =>
        (right.lastCheckedAt ?? task.updatedAt).localeCompare(left.lastCheckedAt ?? task.updatedAt),
      )[0];
    if (!error && !lastStep) continue;
    const roundId = taskRoundId(task);
    put({
      id: managerEvidenceId("task-log", task.id, lastStep?.id ?? task.updatedAt),
      projectId: input.project.id,
      ...(roundId ? { roundId } : {}),
      taskId: task.id,
      type: "log",
      label: `${task.kind} ${task.state}`,
      detail: error ? "Task error captured." : "Latest task step captured.",
      ref: task.id,
      excerpt: clipManagerEvidenceText(error || lastStep?.summary || lastStep?.detail, 360),
      status: error ? "failed" : managerTaskEvidenceStatus(task),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  }

  for (const artifact of input.artifacts) {
    put({
      id: managerEvidenceId("artifact", artifact.id),
      projectId: input.project.id,
      ...(artifact.roundId ? { roundId: artifact.roundId } : {}),
      ...(artifact.agentId ? { agentId: artifact.agentId } : {}),
      ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
      type: "artifact",
      label: artifact.path,
      detail: artifact.note || `${artifact.kind} artifact owned by ${artifact.owner}.`,
      ref: artifact.path,
      status: managerArtifactEvidenceStatus(artifact),
      createdAt: artifact.discoveredAt,
      updatedAt: artifact.updatedAt,
    });
  }

  for (const file of input.protocol.files) {
    put({
      id: managerEvidenceId("protocol", file.path),
      projectId: input.project.id,
      ...(input.activeRound?.id ? { roundId: input.activeRound.id } : {}),
      type: "protocol",
      label: file.path,
      detail: file.error || `${file.role} protocol file is ${file.status}.`,
      ref: file.path,
      ...(file.excerpt ? { excerpt: clipManagerEvidenceText(file.excerpt, 360) } : {}),
      status: managerProtocolEvidenceStatus(file),
      createdAt: file.modifiedAt ?? input.project.createdAt,
      updatedAt: file.modifiedAt ?? input.now.toISOString(),
    });
  }

  for (const decision of input.decisions) {
    put({
      id: managerEvidenceId("decision", decision.id),
      projectId: input.project.id,
      ...(decision.roundId ? { roundId: decision.roundId } : {}),
      type: "decision",
      label: decision.title,
      detail: decision.rationale || decision.detail,
      ref: decision.id,
      excerpt: clipManagerEvidenceText(decision.detail, 360),
      status: decision.status === "active" ? "valid" : "stale",
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
    });
  }

  for (const blocker of input.blockers) {
    put({
      id: managerEvidenceId("blocker", blocker.id),
      projectId: input.project.id,
      ...(blocker.roundId ? { roundId: blocker.roundId } : {}),
      ...(blocker.agentId ? { agentId: blocker.agentId } : {}),
      ...(blocker.taskId ? { taskId: blocker.taskId } : {}),
      type: blocker.requiredAction === "user" ? "user-check" : "blocker",
      label: blocker.title,
      detail: blocker.detail || blocker.title,
      ref: blocker.id,
      status: blocker.status === "open" ? "failed" : "stale",
      createdAt: blocker.createdAt,
      updatedAt: blocker.updatedAt,
    });
  }

  return [...evidence.values()]
    .sort((left, right) =>
      (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt),
    )
    .slice(0, 300);
}

interface ManagerAgentResultBuildInput {
  project: ManagerProject;
  activeRound?: ManagerRound | undefined;
  agents: ManagerAgent[];
  runs: ManagerWorkerRun[];
  evidence: ManagerEvidenceItem[];
  now: Date;
}

function buildManagerAgentResults(input: ManagerAgentResultBuildInput): ManagerAgentResult[] {
  const usedRunIds = new Set<string>();
  const results: ManagerAgentResult[] = [];

  for (const agent of input.agents) {
    const run = findManagerAgentResultRun(agent, input.runs, usedRunIds);
    if (run) usedRunIds.add(run.id);
    results.push(buildManagerAgentResult(input.project, agent, run, input.evidence, input.now));
  }

  for (const run of input.runs) {
    if (usedRunIds.has(run.id)) continue;
    if (run.projectId && run.projectId !== input.project.id) continue;
    results.push(buildManagerAgentResult(input.project, undefined, run, input.evidence, input.now));
  }

  const activeRoundId = input.activeRound?.id;
  return results
    .filter((result) => !activeRoundId || result.roundId === activeRoundId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 40);
}

function buildManagerAgentResult(
  project: ManagerProject,
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  evidence: ManagerEvidenceItem[],
  now: Date,
): ManagerAgentResult {
  const role: ManagerAgentRole = (agent?.role ?? run?.agentRole ?? "worker") as ManagerAgentRole;
  const status = run?.status ?? agent?.status ?? "unknown";
  const roundId = run?.roundId ?? agent?.roundId;
  const agentId = agent?.id ?? run?.agentId;
  const taskId = run?.taskId ?? agent?.taskId;
  const relatedEvidence = evidence.filter(
    (item) =>
      (agent?.id && item.agentId === agent.id) ||
      (run?.agentId && item.agentId === run.agentId) ||
      (agent?.taskId && item.taskId === agent.taskId) ||
      (run?.taskId && item.taskId === run.taskId),
  );
  const summary = managerAgentResultSummary(agent, run, status);
  const changedFiles = collectManagerArtifactPaths(
    [agent?.lastInstruction, agent?.lastOutput, agent?.lastError, run?.outputPreview, run?.error]
      .filter(Boolean)
      .join("\n"),
  ).slice(0, 12);
  const risks = managerAgentResultRisks(agent, run, relatedEvidence);
  const blockers = managerAgentResultBlockers(agent, run, relatedEvidence);
  const verdict = managerAgentResultVerdict(status, run, relatedEvidence);
  const updatedAt = agent?.lastOutputAt ?? agent?.updatedAt ?? run?.updatedAt ?? now.toISOString();
  return {
    id: managerEvidenceId("agent-result", agent?.id ?? run?.id ?? role),
    projectId: project.id,
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
    role,
    assignment:
      extractManagerAgentAssignment(agent?.lastInstruction) ||
      run?.command ||
      "No specific assignment was captured.",
    summary,
    findings: managerAgentResultFindings(agent, run, summary),
    changedFiles,
    risks,
    blockers,
    evidenceIds: relatedEvidence.map((item) => item.id).slice(0, 12),
    nextRequest: managerAgentResultNextRequest(status, run, relatedEvidence),
    confidence: managerAgentResultConfidence(run, relatedEvidence),
    verdict,
    createdAt: agent?.createdAt ?? run?.createdAt ?? now.toISOString(),
    updatedAt,
  };
}

interface ManagerProtocolTraceBuildInput {
  project: ManagerProject;
  activeRound?: ManagerRound | undefined;
  protocol: ManagerProtocolState;
  agents: ManagerAgent[];
  evidence: ManagerEvidenceItem[];
}

function buildManagerProtocolTrace(input: ManagerProtocolTraceBuildInput): ManagerProtocolTrace[] {
  const protocolAgent = input.agents.find((agent) => agent.role === "protocol");
  const traces: ManagerProtocolTrace[] = [];
  for (const file of input.protocol.files) {
    const evidenceIds = input.evidence
      .filter((item) => item.type === "protocol" && item.ref === file.path)
      .map((item) => item.id);
    traces.push({
      id: managerEvidenceId("protocol-trace", file.path),
      projectId: input.project.id,
      ...(input.activeRound?.id ? { roundId: input.activeRound.id } : {}),
      ruleId: `${file.role}:${file.path}`,
      sourceFile: file.path,
      ...(protocolAgent ? { appliedByAgentId: protocolAgent.id } : {}),
      evidenceIds,
      result: managerProtocolTraceResult(file),
      detail: file.error || `${file.path} is ${file.status}; role=${file.role}.`,
    });
  }
  for (const [index, rule] of input.protocol.activeRules.entries()) {
    const evidenceIds = input.evidence
      .filter((item) => item.type === "protocol" && item.ref === "PROTOCOL.md")
      .map((item) => item.id);
    traces.push({
      id: managerEvidenceId("protocol-rule", index, rule),
      projectId: input.project.id,
      ...(input.activeRound?.id ? { roundId: input.activeRound.id } : {}),
      ruleId: `active-rule-${index + 1}`,
      sourceFile: "PROTOCOL.md",
      ...(protocolAgent ? { appliedByAgentId: protocolAgent.id } : {}),
      evidenceIds,
      result: evidenceIds.length > 0 ? "applied" : "unclear",
      detail: rule,
    });
  }
  return traces.slice(0, 80);
}

interface ManagerJudgmentBuildInput {
  project: ManagerProject;
  activeRound?: ManagerRound | undefined;
  roundHealthGate?: ManagerRoundHealthGate | undefined;
  readiness: ManagerCommandFlowResponse["readiness"];
  nextAction: ManagerProjectOverviewAction;
  decisions: ManagerDecision[];
  blockers: ManagerBlocker[];
  runs: ManagerWorkerRun[];
  evidence: ManagerEvidenceItem[];
  agentResults: ManagerAgentResult[];
  protocolTrace: ManagerProtocolTrace[];
  now: Date;
}

function buildManagerJudgmentPackets(input: ManagerJudgmentBuildInput): ManagerJudgmentPacket[] {
  const packets: ManagerJudgmentPacket[] = [];
  const openBlockers = input.blockers.filter((blocker) => blocker.status === "open");
  const userBlockers = openBlockers.filter((blocker) => blocker.requiredAction === "user");
  const activeRuns = input.runs.filter((run) => isManagerWorkerRunActive(run.status));
  const protocolProblems = input.protocolTrace.filter(
    (trace) => trace.result === "violated" || trace.result === "unclear",
  );
  const roundId = input.activeRound?.id;
  const currentRoundAgentIds = new Set(
    input.agentResults.map((result) => result.agentId).filter(isPresent),
  );
  const currentRoundTaskIds = new Set(
    input.agentResults.map((result) => result.taskId).filter(isPresent),
  );
  const scopedEvidence = input.evidence.filter((item) =>
    managerEvidenceMatchesJudgmentScope(item, roundId, currentRoundAgentIds, currentRoundTaskIds),
  );
  const roundExecutionHealthy = input.roundHealthGate?.status === "healthy";
  const failedEvidence = scopedEvidence.filter(
    (item) =>
      (item.status === "failed" || item.status === "missing") &&
      (!roundExecutionHealthy || item.type === "blocker" || item.type === "user-check"),
  );
  const staleEvidence = scopedEvidence.filter((item) => item.status === "stale");
  const failedResults = roundExecutionHealthy
    ? []
    : input.agentResults.filter(
        (result) => result.verdict === "fail" || result.verdict === "needs_user_check",
      );
  const roundReviewDecisions = roundId
    ? input.decisions.filter(
        (decision) =>
          decision.roundId === roundId &&
          decision.status === "active" &&
          decision.tags.includes("review"),
      )
    : [];
  const acceptedRoundReview = roundReviewDecisions.some((decision) =>
    decision.tags.includes("accept"),
  );
  const createdAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + 5 * 60_000).toISOString();
  const firstFailedTaskId =
    failedResults.find((result) => result.taskId)?.taskId ??
    failedEvidence.find((item) => item.taskId)?.taskId ??
    input.nextAction.taskId;

  if (!input.readiness.ready) {
    const evidenceIds = input.evidence
      .filter((item) => item.type === "protocol" && item.status !== "valid")
      .map((item) => item.id)
      .slice(0, 10);
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        roundId,
        verdict: "blocked",
        priority: "approval",
        confidence: "high",
        summary: "Project is not ready to continue.",
        reason:
          input.readiness.warnings[0] ??
          input.readiness.missingProtocolFiles[0] ??
          "Readiness gate is not satisfied.",
        evidenceIds,
        protocolTraceIds: protocolProblems.map((trace) => trace.id).slice(0, 10),
        proposedActions: [
          managerProposedAction({
            projectId: input.project.id,
            roundId,
            type:
              input.readiness.missingProtocolFiles.length > 0 ? "scan_protocol" : "prepare_project",
            risk: "low",
            requiresApproval: true,
            title:
              input.readiness.missingProtocolFiles.length > 0
                ? "Rescan project protocol"
                : "Refresh project readiness",
            rationale:
              "The watch worker cannot recommend execution until the readiness gate passes.",
            payload: {},
            evidenceIds,
            protocolTraceIds: protocolProblems.map((trace) => trace.id).slice(0, 10),
          }),
        ],
        createdAt,
        expiresAt,
      }),
    );
  }

  if (userBlockers.length > 0 || input.readiness.userCheckRequired) {
    const blockerEvidenceIds = input.evidence
      .filter((item) => item.type === "user-check" || item.type === "blocker")
      .map((item) => item.id)
      .slice(0, 10);
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        roundId,
        verdict: "user_check",
        priority: "approval",
        confidence: "high",
        summary: "Human confirmation is required before the loop should continue.",
        reason:
          userBlockers[0]?.detail ||
          userBlockers[0]?.title ||
          "The command flow is waiting on a user checkpoint.",
        evidenceIds: blockerEvidenceIds,
        proposedActions: [
          managerProposedAction({
            projectId: input.project.id,
            roundId,
            type: "request_user_check",
            risk: "medium",
            requiresApproval: true,
            title: "Request human confirmation",
            rationale:
              "The next orchestration step should wait for explicit user or manager confirmation.",
            payload: {
              summary:
                userBlockers[0]?.detail ||
                userBlockers[0]?.title ||
                "Please confirm whether the current round should continue.",
            },
            evidenceIds: blockerEvidenceIds,
          }),
        ],
        createdAt,
        expiresAt,
      }),
    );
  }

  if (failedResults.length > 0 || failedEvidence.length > 0) {
    const evidenceIds = [
      ...failedEvidence.map((item) => item.id),
      ...input.evidence
        .filter((item) => firstFailedTaskId && item.taskId === firstFailedTaskId)
        .map((item) => item.id),
    ].slice(0, 12);
    const action =
      firstFailedTaskId &&
      managerProposedAction({
        projectId: input.project.id,
        roundId,
        taskId: firstFailedTaskId,
        type: "retry_task",
        risk: "medium",
        requiresApproval: true,
        title: "Retry failed worker task",
        rationale: "A linked worker result or evidence item is failed or missing.",
        payload: { taskId: firstFailedTaskId },
        evidenceIds,
        agentResultIds: failedResults.map((result) => result.id).slice(0, 10),
      });
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        roundId,
        verdict: "retry",
        priority: "approval",
        confidence: failedResults.length > 0 ? "high" : "medium",
        summary: "A worker result needs repair before this round can be trusted.",
        reason:
          failedResults[0]?.blockers[0] ||
          failedEvidence[0]?.detail ||
          "Failed or missing evidence is linked to the active round.",
        evidenceIds,
        agentResultIds: failedResults.map((result) => result.id).slice(0, 10),
        proposedActions: [
          ...(action ? [action] : []),
          ...(roundId
            ? [
                managerProposedAction({
                  projectId: input.project.id,
                  roundId,
                  type: "repair_round",
                  risk: "low",
                  requiresApproval: true,
                  title: "Reconcile round evidence",
                  rationale: "Refresh the round health gate from the latest worker ledger.",
                  payload: { roundId },
                  evidenceIds,
                }),
              ]
            : []),
        ],
        createdAt,
        expiresAt,
      }),
    );
  }

  if (protocolProblems.length > 0 && input.readiness.ready) {
    const traceIds = protocolProblems.map((trace) => trace.id).slice(0, 12);
    const evidenceIds = input.evidence
      .filter(
        (item) =>
          item.type === "protocol" &&
          protocolProblems.some((trace) => trace.evidenceIds.includes(item.id)),
      )
      .map((item) => item.id)
      .slice(0, 12);
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        roundId,
        verdict: "direction_change",
        priority: "approval",
        confidence: "medium",
        summary: "Protocol trace has unclear or violated items.",
        reason: protocolProblems[0]?.detail ?? "The protocol trace is not clean.",
        evidenceIds,
        protocolTraceIds: traceIds,
        proposedActions: [
          managerProposedAction({
            projectId: input.project.id,
            roundId,
            type: "direction_change",
            risk: "high",
            requiresApproval: true,
            title: "Adjust direction from protocol findings",
            rationale:
              "The next round should explicitly address protocol ambiguity before continuing.",
            payload: {
              requestedChange: protocolProblems[0]?.detail ?? "Clarify protocol before continuing.",
              impact: "Protocol ambiguity can make worker results difficult to trust.",
              currentRoundAction: "keep",
            },
            evidenceIds,
            protocolTraceIds: traceIds,
          }),
        ],
        createdAt,
        expiresAt,
      }),
    );
  }

  if (activeRuns.length > 0 || input.nextAction.kind === "wait") {
    const evidenceIds = input.evidence
      .filter((item) => activeRuns.some((run) => item.taskId && item.taskId === run.taskId))
      .map((item) => item.id)
      .slice(0, 10);
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        roundId,
        verdict: "wait",
        priority: "notice",
        confidence: "high",
        summary: "Workers are still running.",
        reason: "The watch worker should keep observing until fresh results arrive.",
        evidenceIds,
        proposedActions: [
          managerProposedAction({
            projectId: input.project.id,
            roundId,
            type: "wait",
            risk: "low",
            requiresApproval: false,
            title: "Keep watching",
            rationale:
              "No manager approval is needed while active worker tasks are still producing signals.",
            payload: {},
            evidenceIds,
          }),
        ],
        createdAt,
        expiresAt,
      }),
    );
  }

  if (
    packets.every((packet) => packet.priority !== "approval") &&
    input.nextAction.kind === "summarize" &&
    roundId
  ) {
    const resultIds = input.agentResults.map((result) => result.id).slice(0, 10);
    const reviewEvidenceIds = roundReviewDecisions.map((decision) =>
      managerEvidenceId("decision", decision.id),
    );
    const evidenceIds = [
      ...input.agentResults.flatMap((result) => result.evidenceIds),
      ...reviewEvidenceIds,
    ].slice(0, 12);
    const proposedActions = acceptedRoundReview
      ? [
          managerProposedAction({
            projectId: input.project.id,
            roundId,
            type: "start_next_round",
            risk: "high",
            requiresApproval: true,
            title: "Start the next orchestration round",
            rationale:
              "The current round already has an accept review decision, so the manager only needs to choose the next loop action.",
            payload: {
              objective:
                input.project.goal || input.activeRound?.objective || "Continue orchestration.",
              phase: "implementation",
              dryRun: true,
            },
            evidenceIds,
            agentResultIds: resultIds,
          }),
          managerProposedAction({
            projectId: input.project.id,
            roundId,
            type: "complete_project",
            risk: "high",
            requiresApproval: true,
            title: "Complete project from accepted round",
            rationale:
              "Use this when the accepted round is enough for final user-facing completion.",
            payload: {
              summary:
                roundReviewDecisions[0]?.detail ||
                input.activeRound?.summary ||
                input.project.summary ||
                input.project.goal,
              acceptedByUser: false,
              verificationEvidence: "Round was accepted by manager review.",
            },
            evidenceIds,
            agentResultIds: resultIds,
          }),
        ]
      : [
          managerProposedAction({
            projectId: input.project.id,
            roundId,
            type: "review_round",
            risk: "medium",
            requiresApproval: true,
            title: "Approve round result",
            rationale: "Accept the round and let the manager decide whether to start another one.",
            payload: {
              roundId,
              action: "accept",
              summary: "Watch worker found no blocking evidence.",
            },
            evidenceIds,
            agentResultIds: resultIds,
          }),
        ];
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        roundId,
        verdict: "continue",
        priority: "approval",
        confidence: staleEvidence.length > 0 ? "medium" : "high",
        summary: acceptedRoundReview
          ? "Round is accepted; choose next loop action."
          : "Round is ready for manager review.",
        reason:
          roundReviewDecisions[0]?.detail ||
          "The watch worker found no blocking evidence and the next command-flow action is summarize.",
        evidenceIds,
        agentResultIds: resultIds,
        protocolTraceIds: input.protocolTrace.map((trace) => trace.id).slice(0, 10),
        proposedActions,
        createdAt,
        expiresAt,
      }),
    );
  }

  if (packets.length === 0 && input.readiness.ready && !input.activeRound) {
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        verdict: "continue",
        priority: "approval",
        confidence: "medium",
        summary: "Project is ready for its first orchestration round.",
        reason: "Readiness passed and no active round exists.",
        evidenceIds: input.evidence.slice(0, 8).map((item) => item.id),
        protocolTraceIds: input.protocolTrace.slice(0, 8).map((trace) => trace.id),
        proposedActions: [
          managerProposedAction({
            projectId: input.project.id,
            type: "start_next_round",
            risk: "high",
            requiresApproval: true,
            title: "Start first orchestration round",
            rationale:
              "The manager can approve a worker round instead of manually reading every readiness detail.",
            payload: {
              objective: input.project.goal,
              phase: "design",
              dryRun: true,
            },
            evidenceIds: input.evidence.slice(0, 8).map((item) => item.id),
            protocolTraceIds: input.protocolTrace.slice(0, 8).map((trace) => trace.id),
          }),
        ],
        createdAt,
        expiresAt,
      }),
    );
  }

  if (packets.length === 0) {
    packets.push(
      managerJudgmentPacket({
        projectId: input.project.id,
        roundId,
        verdict: "continue",
        priority: "notice",
        confidence: "medium",
        summary: "No manager approval is currently required.",
        reason: input.nextAction.detail ?? input.nextAction.label,
        evidenceIds: input.evidence.slice(0, 8).map((item) => item.id),
        agentResultIds: input.agentResults.slice(0, 8).map((result) => result.id),
        protocolTraceIds: input.protocolTrace.slice(0, 8).map((trace) => trace.id),
        proposedActions: [],
        createdAt,
        expiresAt,
      }),
    );
  }

  return packets
    .sort(
      (left, right) =>
        managerJudgmentPriorityRank(right.priority) - managerJudgmentPriorityRank(left.priority),
    )
    .slice(0, 12);
}

function managerEvidenceMatchesJudgmentScope(
  item: ManagerEvidenceItem,
  roundId: string | undefined,
  agentIds: Set<string>,
  taskIds: Set<string>,
): boolean {
  if (!roundId) return true;
  if (item.roundId) return item.roundId === roundId;
  if (item.agentId && agentIds.has(item.agentId)) return true;
  if (item.taskId && taskIds.has(item.taskId)) return true;
  return false;
}

function managerJudgmentPacket(input: {
  projectId: string;
  roundId?: string | undefined;
  verdict: ManagerJudgmentPacket["verdict"];
  priority: ManagerJudgmentPacket["priority"];
  confidence: ManagerJudgmentPacket["confidence"];
  summary: string;
  reason: string;
  evidenceIds?: string[] | undefined;
  agentResultIds?: string[] | undefined;
  protocolTraceIds?: string[] | undefined;
  proposedActions?: ManagerProposedAction[] | undefined;
  createdAt: string;
  expiresAt?: string | undefined;
}): ManagerJudgmentPacket {
  const evidenceIds = [...new Set(input.evidenceIds ?? [])].slice(0, 12);
  const agentResultIds = [...new Set(input.agentResultIds ?? [])].slice(0, 12);
  const protocolTraceIds = [...new Set(input.protocolTraceIds ?? [])].slice(0, 12);
  return {
    id: managerEvidenceId(
      "judgment",
      input.projectId,
      input.roundId ?? "project",
      input.verdict,
      input.priority,
      evidenceIds.join("|"),
      agentResultIds.join("|"),
      protocolTraceIds.join("|"),
    ),
    projectId: input.projectId,
    ...(input.roundId ? { roundId: input.roundId } : {}),
    verdict: input.verdict,
    priority: input.priority,
    confidence: input.confidence,
    summary: input.summary,
    reason: input.reason,
    evidenceIds,
    agentResultIds,
    protocolTraceIds,
    proposedActions: input.proposedActions ?? [],
    createdAt: input.createdAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
}

function managerProposedAction(input: {
  projectId: string;
  roundId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  type: ManagerProposedAction["type"];
  risk: ManagerProposedAction["risk"];
  requiresApproval: boolean;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  evidenceIds?: string[] | undefined;
  agentResultIds?: string[] | undefined;
  protocolTraceIds?: string[] | undefined;
}): ManagerProposedAction {
  const evidenceIds = [...new Set(input.evidenceIds ?? [])].slice(0, 12);
  const agentResultIds = [...new Set(input.agentResultIds ?? [])].slice(0, 12);
  const protocolTraceIds = [...new Set(input.protocolTraceIds ?? [])].slice(0, 12);
  return {
    id: managerEvidenceId(
      "proposed-action",
      input.projectId,
      input.roundId ?? "project",
      input.taskId ?? input.agentId ?? "",
      input.type,
      evidenceIds.join("|"),
      agentResultIds.join("|"),
      protocolTraceIds.join("|"),
    ),
    projectId: input.projectId,
    ...(input.roundId ? { roundId: input.roundId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    type: input.type,
    risk: input.risk,
    requiresApproval: input.requiresApproval,
    title: input.title,
    rationale: input.rationale,
    payload: input.payload,
    evidenceIds,
    agentResultIds,
    protocolTraceIds,
  };
}

function managerJudgmentPriorityRank(priority: ManagerJudgmentPacket["priority"]): number {
  if (priority === "approval") return 3;
  if (priority === "notice") return 2;
  return 1;
}

function findManagerAgentResultRun(
  agent: ManagerAgent,
  runs: ManagerWorkerRun[],
  usedRunIds: Set<string>,
): ManagerWorkerRun | undefined {
  const candidates = runs.filter((run) => !usedRunIds.has(run.id));
  return (
    candidates.find((run) => run.agentId === agent.id) ??
    candidates.find((run) => run.taskId && run.taskId === agent.taskId) ??
    candidates.find((run) => run.agentRole === agent.role && run.roundId === agent.roundId)
  );
}

function extractManagerAgentAssignment(instruction: string | undefined): string | undefined {
  const lines =
    instruction
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
  const metadataPrefixes = [
    "Project:",
    "CWD:",
    "Objective:",
    "Goal:",
    "Scope:",
    "Non-goals:",
    "Constraints:",
    "Success criteria:",
    "Verification plan:",
    "User checkpoints:",
    "Final deliverables:",
  ];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!metadataPrefixes.some((prefix) => line.startsWith(prefix))) return line;
  }
  return undefined;
}

function managerAgentResultSummary(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  status: string,
): string {
  const explicit = agent?.lastError || run?.error || agent?.lastOutput || run?.outputPreview;
  if (explicit) return clipManagerEvidenceText(explicit, 420);
  if (run?.dryRun && ["succeeded", "completed"].includes(status)) {
    return "Dry-run completed; no live transcript payload was captured.";
  }
  if (["succeeded", "completed"].includes(status)) {
    return "Completed, but no output preview was captured.";
  }
  if (["assigned", "pending", "running", "waiting", "waiting_for_device"].includes(status)) {
    return "Waiting for worker output.";
  }
  if (["failed", "blocked", "missing"].includes(status)) {
    return "Needs inspection before the result can be trusted.";
  }
  return "No reply yet.";
}

function managerAgentResultFindings(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  summary: string,
): string[] {
  const findings = splitEvidenceBullets(agent?.lastOutput || run?.outputPreview || summary);
  if (findings.length > 0) return findings.slice(0, 5);
  if (run?.status === "succeeded") return ["Worker run completed successfully."];
  if (run?.status === "missing") return ["Worker task record is missing."];
  return ["No concrete finding has been captured yet."];
}

function managerAgentResultRisks(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  evidence: ManagerEvidenceItem[],
): string[] {
  const risks: string[] = [];
  const integrityIssues = run?.integrity.filter((item) => item !== "ok") ?? [];
  if (integrityIssues.length > 0) {
    risks.push(`Worker integrity issue: ${integrityIssues.join(", ")}`);
  }
  if (run?.dryRun && !agent?.lastOutput && !run.outputPreview) {
    risks.push("Dry-run did not capture a live transcript payload.");
  }
  if (!run) risks.push("No worker run is linked to this agent.");
  if (evidence.length === 0) risks.push("No evidence item is linked to this role.");
  if (run?.timedOut) risks.push("Worker timed out.");
  return risks.slice(0, 6);
}

function managerAgentResultBlockers(
  agent: ManagerAgent | undefined,
  run: ManagerWorkerRun | undefined,
  evidence: ManagerEvidenceItem[],
): string[] {
  const blockers: string[] = [];
  if (agent?.lastError) blockers.push(agent.lastError);
  if (run?.error) blockers.push(run.error);
  for (const item of evidence) {
    if (item.status === "failed" || item.status === "missing") blockers.push(item.detail);
  }
  return [...new Set(blockers.map((item) => clipManagerEvidenceText(item, 220)))].slice(0, 6);
}

function managerAgentResultNextRequest(
  status: string,
  run: ManagerWorkerRun | undefined,
  evidence: ManagerEvidenceItem[],
): string {
  if (["failed", "blocked", "missing"].includes(status)) {
    return run?.taskId
      ? `Inspect task ${run.taskId} and decide retry or direction change.`
      : "Manager review is needed before continuing.";
  }
  if (evidence.some((item) => item.type === "user-check" && item.status === "failed")) {
    return "Ask the human to resolve the open check before continuing.";
  }
  if (
    ["pending", "running", "waiting", "waiting_for_device", "restart_required"].includes(status)
  ) {
    return "Wait for a fresh signal before changing direction.";
  }
  if (run?.dryRun) return "Summarize the dry run, then choose real run or replan.";
  return "Review the output and turn it into the next round instruction.";
}

function managerAgentResultVerdict(
  status: string,
  run: ManagerWorkerRun | undefined,
  evidence: ManagerEvidenceItem[],
): ManagerAgentResult["verdict"] {
  if (evidence.some((item) => item.type === "user-check" && item.status === "failed")) {
    return "needs_user_check";
  }
  if (
    ["failed", "blocked", "missing", "cancelled"].includes(status) ||
    evidence.some((item) => item.status === "failed" || item.status === "missing")
  ) {
    return "fail";
  }
  if (
    run?.dryRun ||
    evidence.some((item) => item.status === "stale") ||
    ["pending", "running", "waiting", "waiting_for_device", "restart_required"].includes(status)
  ) {
    return "caution";
  }
  return "pass";
}

function managerAgentResultConfidence(
  run: ManagerWorkerRun | undefined,
  evidence: ManagerEvidenceItem[],
): ManagerAgentResult["confidence"] {
  if (!run || evidence.length === 0) return "low";
  if (run.dryRun && !run.outputPreview) return "medium";
  if (run.status === "succeeded" && evidence.some((item) => item.status === "valid")) return "high";
  return "medium";
}

function managerRunEvidenceDetail(run: ManagerWorkerRun): string {
  const issues = run.integrity.filter((item) => item !== "ok");
  return [
    run.dryRun ? "dry-run" : "live run",
    run.durationMs ? `${run.durationMs}ms` : "",
    typeof run.exitCode === "number" ? `exit ${run.exitCode}` : "",
    issues.length > 0 ? `integrity: ${issues.join(", ")}` : "integrity ok",
    run.timedOut ? "timed out" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function managerRunEvidenceStatus(run: ManagerWorkerRun): ManagerEvidenceItem["status"] {
  if (run.status === "missing" || run.integrity.includes("missing-task")) return "missing";
  if (
    ["failed", "blocked", "cancelled"].includes(run.status) ||
    run.timedOut ||
    run.integrity.some((item) => item !== "ok" && item !== "missing-session")
  ) {
    return "failed";
  }
  if (
    run.integrity.includes("stale-agent") ||
    ["pending", "running", "waiting_for_device", "restart_required"].includes(run.status)
  ) {
    return "stale";
  }
  return "valid";
}

function managerAgentEvidenceStatus(agent: ManagerAgent): ManagerEvidenceItem["status"] {
  if (["failed", "blocked", "cancelled"].includes(agent.status)) return "failed";
  if (agent.status === "stale") return "stale";
  return "valid";
}

function managerTaskEvidenceStatus(task: ManagerTask): ManagerEvidenceItem["status"] {
  if (["failed", "blocked", "cancelled"].includes(task.state)) return "failed";
  if (task.state === "restart_required") return "stale";
  return "valid";
}

function managerArtifactEvidenceStatus(artifact: ManagerArtifact): ManagerEvidenceItem["status"] {
  if (artifact.status === "missing") return "missing";
  if (artifact.status === "failed") return "failed";
  if (artifact.status === "obsolete") return "stale";
  return "valid";
}

function managerProtocolEvidenceStatus(file: ManagerProtocolFile): ManagerEvidenceItem["status"] {
  if (file.status === "missing") return "missing";
  if (file.status === "error" || file.status === "too_large") return "failed";
  return "valid";
}

function managerProtocolTraceResult(file: ManagerProtocolFile): ManagerProtocolTrace["result"] {
  if (file.status === "present") return "applied";
  if (file.status === "missing") return "skipped";
  if (file.status === "error") return "violated";
  return "unclear";
}

function splitEvidenceBullets(value: string | undefined): string[] {
  const text = value?.trim();
  if (!text) return [];
  return text
    .split(/\r?\n|(?:^|\s)[-*]\s+/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 8)
    .map((line) => clipManagerEvidenceText(line, 220));
}

function managerEvidenceId(...parts: Array<string | number | undefined>): string {
  return parts
    .filter((part) => part !== undefined && `${part}`.trim())
    .join(":")
    .replace(/[^A-Za-z0-9_:-]+/g, "_")
    .slice(0, 160);
}

function clipManagerEvidenceText(value: string | undefined, max: number): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function effectiveProjectCharter(project: ManagerProject): ManagerProjectCharter {
  return {
    goal: project.charter?.goal || project.goal,
    scope: project.charter?.scope ?? "",
    nonGoals: project.charter?.nonGoals ?? "",
    constraints: project.charter?.constraints ?? "",
    successCriteria: project.charter?.successCriteria ?? "",
    preferredApproach: project.charter?.preferredApproach ?? "",
    verificationPlan: project.charter?.verificationPlan ?? "",
    userCheckpoints: project.charter?.userCheckpoints ?? "",
    finalDeliverables: project.charter?.finalDeliverables ?? "",
    updatedAt: project.charter?.updatedAt ?? project.updatedAt,
    updatedBy: project.charter?.updatedBy ?? "system",
  };
}

function mergeManagerProjectCharter(
  project: ManagerProject,
  input: ManagerProjectCharterUpdateRequest,
  now: Date,
): ManagerProjectCharter {
  const current = effectiveProjectCharter(project);
  return {
    goal: cleanMaybe(input.goal) ?? current.goal,
    scope: cleanMaybe(input.scope) ?? current.scope,
    nonGoals: cleanMaybe(input.nonGoals) ?? current.nonGoals,
    constraints: cleanMaybe(input.constraints) ?? current.constraints,
    successCriteria: cleanMaybe(input.successCriteria) ?? current.successCriteria,
    preferredApproach: cleanMaybe(input.preferredApproach) ?? current.preferredApproach,
    verificationPlan: cleanMaybe(input.verificationPlan) ?? current.verificationPlan,
    userCheckpoints: cleanMaybe(input.userCheckpoints) ?? current.userCheckpoints,
    finalDeliverables: cleanMaybe(input.finalDeliverables) ?? current.finalDeliverables,
    updatedAt: now.toISOString(),
    updatedBy: input.updatedBy ?? "browser",
  };
}

function buildManagerCharterWizardEvent(
  project: ManagerProject,
  before: ManagerProjectCharter,
  after: ManagerProjectCharter,
  now: Date,
): ManagerWizardIntentEventInput | undefined {
  const fields = managerCharterFieldChanges(before, after);
  if (!fields.length) return undefined;
  const readinessStage = project.flowStage ?? projectStatusCommandFlowStage(project.status);
  const highImpactFields = new Set(["goal", "constraints", "nonGoals"]);
  const mediumImpactFields = new Set([
    "successCriteria",
    "verificationPlan",
    "userCheckpoints",
    "finalDeliverables",
  ]);
  const impact: ManagerWizardIntentImpact = fields.some((field) =>
    highImpactFields.has(field.field),
  )
    ? "high"
    : fields.some((field) => mediumImpactFields.has(field.field))
      ? "medium"
      : "low";
  const runningStage =
    readinessStage === "running" || readinessStage === "review" || readinessStage === "replanning";
  const managerAction: ManagerWizardIntentAction = runningStage
    ? impact === "high"
      ? "replan"
      : "continue"
    : "refresh-readiness";
  return {
    kind: "charter-applied",
    fields,
    impact,
    managerAction,
    ...(project.activeRoundId ? { roundId: project.activeRoundId } : {}),
    note: `Charter was explicitly applied from the project flow at ${now.toISOString()}.`,
  };
}

function managerCharterFieldChanges(
  before: ManagerProjectCharter,
  after: ManagerProjectCharter,
): ManagerWizardIntentEventInput["fields"] {
  const fields: Array<keyof ManagerProjectCharter> = [
    "goal",
    "scope",
    "nonGoals",
    "constraints",
    "successCriteria",
    "preferredApproach",
    "verificationPlan",
    "userCheckpoints",
    "finalDeliverables",
  ];
  return fields.flatMap((field) => {
    const beforeValue = cleanMaybe(before[field]) ?? "";
    const afterValue = cleanMaybe(after[field]) ?? "";
    if (beforeValue === afterValue || !afterValue) return [];
    return [
      {
        field,
        ...(beforeValue ? { before: beforeValue } : {}),
        after: afterValue,
      },
    ];
  });
}

function managerCommandFlowReadiness(
  project: ManagerProject,
  protocol: ManagerProtocolState,
  blockers: ManagerBlocker[] = [],
  repoRoot?: string,
): ManagerCommandFlowResponse["readiness"] {
  const missingProtocolFiles = protocol.files
    .filter((file) => file.status === "missing")
    .map((file) => file.path);
  const charter = effectiveProjectCharter(project);
  const hasGoal = Boolean((charter.goal || project.goal).trim());
  const userCheckRequired = blockers.some(
    (blocker) => blocker.status === "open" && blocker.requiredAction === "user",
  );
  const cwdBoundary = repoRoot ? resolveManagerWorkerCwd(repoRoot, project.cwd) : undefined;
  const cwdBoundaryWarning = cwdBoundary && !cwdBoundary.ok ? cwdBoundary.error : undefined;
  const activeRuntime =
    project.status === "running" || ["running", "reviewing", "completed"].includes(project.status);
  const ready =
    hasGoal && missingProtocolFiles.length === 0 && !userCheckRequired && !cwdBoundaryWarning;
  const stage = commandFlowStageForProject(project, protocol, ready, activeRuntime);
  return {
    ready,
    stage,
    missingProtocolFiles,
    warnings: [
      ...protocol.warnings,
      ...(!hasGoal ? ["Project charter goal is not recorded."] : []),
      ...(cwdBoundaryWarning ? [cwdBoundaryWarning] : []),
      ...(userCheckRequired ? ["A user verification blocker is open."] : []),
    ],
    userCheckRequired,
  };
}

function commandFlowStageForProject(
  project: ManagerProject,
  protocol: ManagerProtocolState,
  ready: boolean,
  activeRuntime: boolean,
): ManagerCommandFlowStage {
  if (project.status === "archived") return "archived";
  if (project.status === "completed" || project.flowStage === "completed") return "completed";
  if (project.status === "reviewing" || project.flowStage === "review") return "review";
  if (project.status === "blocked" || project.flowStage === "replanning") return "replanning";
  if (activeRuntime || project.flowStage === "running") return "running";
  if (ready) return "ready_to_start";
  if (protocol.files.some((file) => file.status === "present")) return "protocol_ready";
  return "draft";
}

function projectStatusCommandFlowStage(status: ManagerProjectStatus): ManagerCommandFlowStage {
  if (status === "archived") return "archived";
  if (status === "completed") return "completed";
  if (status === "reviewing") return "review";
  if (status === "running") return "running";
  if (status === "blocked") return "replanning";
  return "draft";
}

function defaultManagerProjectAssignments(
  project: ManagerProject,
  charter: ManagerProjectCharter,
  phase: ManagerRoundPhase,
  objective: string,
): ManagerRoundAgentAssignment[] {
  const base = managerProjectPromptContext(project, charter, objective);
  const cwd = project.cwd;
  if (phase === "implementation") {
    return [
      {
        role: "implementer",
        profile: "claude-code",
        cwd,
        prompt: `${base}\n\nImplement the smallest coherent change that satisfies the objective. Report changed files and verification commands.`,
      },
      {
        role: "verifier",
        profile: "claude-code",
        cwd,
        prompt: `${base}\n\nVerify the implementation against the success criteria and report concrete evidence.`,
      },
      {
        role: "critic",
        profile: "claude-code",
        cwd,
        prompt: `${base}\n\nReview for regressions, missing tests, and unresolved constraints.`,
      },
    ];
  }
  if (phase === "feedback" || phase === "verification") {
    return [
      {
        role: "verifier",
        profile: "claude-code",
        cwd,
        prompt: `${base}\n\nCollect verification evidence and identify whether user confirmation is still needed.`,
      },
      {
        role: "critic",
        profile: "claude-code",
        cwd,
        prompt: `${base}\n\nCompare the result with the charter and list gaps or approval blockers.`,
      },
    ];
  }
  return [
    {
      role: "architect",
      profile: "claude-code",
      cwd,
      prompt: `${base}\n\nDesign the next implementation path. Keep it scoped, testable, and aligned with constraints.`,
    },
    {
      role: "protocol",
      profile: "claude-code",
      cwd,
      prompt: `${base}\n\nCheck whether the project protocol and worker contract are sufficient for this round.`,
    },
    {
      role: "critic",
      profile: "claude-code",
      cwd,
      prompt: `${base}\n\nChallenge the plan, name risks, and propose acceptance criteria for the next round.`,
    },
  ];
}

function managerProjectPromptContext(
  project: ManagerProject,
  charter: ManagerProjectCharter,
  objective: string,
): string {
  return [
    `Project: ${project.name}`,
    `CWD: ${project.cwd}`,
    `Objective: ${objective}`,
    charter.goal ? `Goal: ${charter.goal}` : "",
    charter.scope ? `Scope: ${charter.scope}` : "",
    charter.nonGoals ? `Non-goals: ${charter.nonGoals}` : "",
    charter.constraints ? `Constraints: ${charter.constraints}` : "",
    charter.successCriteria ? `Success criteria: ${charter.successCriteria}` : "",
    charter.preferredApproach ? `Preferred approach: ${charter.preferredApproach}` : "",
    charter.verificationPlan ? `Verification plan: ${charter.verificationPlan}` : "",
    charter.userCheckpoints ? `User checkpoints: ${charter.userCheckpoints}` : "",
    charter.finalDeliverables ? `Final deliverables: ${charter.finalDeliverables}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function managerRoundTitleForPhase(phase: ManagerRoundPhase): string {
  switch (phase) {
    case "implementation":
      return "Implementation round";
    case "feedback":
      return "Feedback round";
    case "verification":
      return "Verification round";
    case "replan":
      return "Replan round";
    default:
      return "Design round";
  }
}

function managerRoundReviewDecisionTitle(action: ManagerRoundReviewRequest["action"]): string {
  switch (action) {
    case "accept":
      return "Round result accepted";
    case "request_changes":
      return "Round changes requested";
    case "user_check_required":
      return "Round needs user verification";
    case "replan":
      return "Round requires replanning";
    case "stop":
      return "Round stopped";
  }
}

function managerProjectRecentSignals(input: {
  round: ManagerRound | undefined;
  agents: ManagerAgent[];
  tasks: ManagerTask[];
  runs: ManagerWorkerRun[];
}): ManagerProjectOverviewSignal[] {
  const signals: ManagerProjectOverviewSignal[] = [];
  if (input.round) {
    signals.push({
      tone:
        input.round.status === "completed" ? "success" : statusToneForProject(input.round.status),
      title: input.round.title,
      detail: input.round.summary || input.round.error || input.round.objective,
      updatedAt: input.round.updatedAt,
      roundId: input.round.id,
    });
  }
  for (const agent of input.agents) {
    signals.push({
      tone: statusToneForProject(agent.status),
      title: `${agent.role} ${agent.status}`,
      detail: agent.lastError || agent.lastOutput || agent.lastInstruction,
      updatedAt: agent.updatedAt,
      agentId: agent.id,
      ...(agent.roundId ? { roundId: agent.roundId } : {}),
      ...(agent.taskId ? { taskId: agent.taskId } : {}),
    });
  }
  for (const task of input.tasks) {
    signals.push({
      tone: statusToneForProject(task.state),
      title: `${task.kind} ${task.state}`,
      detail: task.error || task.steps.at(-1)?.summary,
      updatedAt: task.updatedAt,
      taskId: task.id,
      ...(taskRoundId(task) ? { roundId: taskRoundId(task) } : {}),
    });
  }
  for (const run of input.runs) {
    signals.push({
      tone: statusToneForProject(run.status),
      title: `${run.agentRole ?? run.agentLabel ?? "worker"} ${run.status}`,
      detail: run.error || run.outputPreview,
      updatedAt: run.updatedAt,
      ...(run.roundId ? { roundId: run.roundId } : {}),
      ...(run.agentId ? { agentId: run.agentId } : {}),
      ...(run.taskId ? { taskId: run.taskId } : {}),
    });
  }
  return signals
    .filter((signal) => Boolean(signal.updatedAt))
    .sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))
    .slice(0, 8);
}

function statusToneForProject(status: string): ManagerProjectOverviewSignal["tone"] {
  if (["completed", "succeeded", "healthy"].includes(status)) return "success";
  if (
    [
      "dispatching",
      "running",
      "collecting",
      "reviewing",
      "assigned",
      "waiting",
      "pending",
    ].includes(status)
  ) {
    return "running";
  }
  if (["blocked", "failed", "cancelled", "stale", "missing"].includes(status)) return "warning";
  return "idle";
}

function inferManagerArtifactKind(path: string): ManagerArtifactKind {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").pop() ?? normalized;
  if (
    [
      "orchestration.md",
      "agents.md",
      "protocol.md",
      "locks.md",
      "tasks.md",
      "state.md",
      "failures.md",
      "project.md",
    ].includes(basename)
  ) {
    return "protocol";
  }
  if (basename.endsWith(".log")) return "log";
  if (basename.endsWith(".json") || basename.endsWith(".yml") || basename.endsWith(".yaml")) {
    return "config";
  }
  if (
    basename.endsWith(".ts") ||
    basename.endsWith(".tsx") ||
    basename.endsWith(".js") ||
    basename.endsWith(".jsx") ||
    basename.endsWith(".py") ||
    basename.endsWith(".ps1")
  ) {
    return "code";
  }
  if (basename.endsWith(".md")) {
    return basename.includes("report") || basename.includes("readme") ? "report" : "document";
  }
  return "unknown";
}

function countManagerProjectArtifacts(agents: ManagerAgent[], tasks: ManagerTask[]): number {
  const paths = new Set<string>();
  for (const agent of agents) {
    for (const path of collectManagerArtifactPaths(
      [agent.lastInstruction, agent.lastOutput, agent.lastError].join("\n"),
    )) {
      paths.add(path);
    }
  }
  for (const task of tasks) {
    const taskPaths = collectManagerArtifactPaths(
      [
        task.error,
        JSON.stringify(task.params ?? {}),
        JSON.stringify(task.result ?? {}),
        ...task.steps.map((step) => `${step.label}\n${step.summary}\n${step.detail ?? ""}`),
      ].join("\n"),
    );
    for (const path of taskPaths) {
      paths.add(path);
    }
  }
  return paths.size;
}

function collectManagerArtifactPaths(text: string): string[] {
  const paths = new Set<string>();
  const pattern =
    /(?:^|\s|["'`])([A-Za-z0-9_.~:/\\-]+(?:ORCHESTRATION|AGENTS|PROTOCOL|REVIEW|TASKS|STATE|FAILURES|PROJECT|README|CLAUDE)?[A-Za-z0-9_.~:/\\-]*\.(?:md|ts|tsx|js|jsx|json|css|html|ps1|py|yml|yaml))/gi;
  for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? "").replace(/[),.;:'"`\]]+$/g, "");
    if (value.length >= 4) paths.add(value);
  }
  return [...paths];
}

function taskRoundId(task: ManagerTask): string | undefined {
  const params = isRecord(task.params) ? task.params : {};
  return stringValue(params.roundId);
}

function latestIsoString(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

async function repairManagerRoundEvidence(
  input: ManagerRoundHealthGateInput,
): Promise<ManagerRoundRepairResponse> {
  const syncedAgents = await syncManagerAgentsWithTasks(input.orchestrationStore, input.taskStore);
  const latestRound = (await input.orchestrationStore.getRound(input.round.id)) ?? input.round;
  const [tasks, ledger] = await Promise.all([
    input.taskStore.list(500),
    buildManagerWorkerRunLedger({
      orchestrationStore: input.orchestrationStore,
      taskStore: input.taskStore,
      roundId: latestRound.id,
      limit: 500,
      now: input.now,
    }),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const agentById = new Map(syncedAgents.map((agent) => [agent.id, agent]));
  const healthRuns = selectManagerRoundHealthRuns(ledger.runs);
  const healthTaskIds = healthRuns
    .map((run) => run.taskId)
    .filter(isPresent)
    .filter((id) => taskById.has(id));
  const validRoundAgentIds = latestRound.agentIds.filter((id) => agentById.has(id));
  const validRoundTaskIds = latestRound.taskIds.filter((id) => taskById.has(id));
  const nextAgentIds = uniqueStrings([
    ...validRoundAgentIds,
    ...healthRuns.map((run) => run.agentId).filter(isPresent),
  ]);
  const nextTaskIds = uniqueStrings([...validRoundTaskIds, ...healthTaskIds]);
  const changes: string[] = [];
  const removedAgents = latestRound.agentIds.length - validRoundAgentIds.length;
  const removedTasks = latestRound.taskIds.length - validRoundTaskIds.length;
  if (removedAgents > 0) changes.push(`removed ${removedAgents} missing agent reference(s)`);
  if (removedTasks > 0) changes.push(`removed ${removedTasks} missing task reference(s)`);
  const addedTasks = nextTaskIds.filter((id) => !latestRound.taskIds.includes(id)).length;
  if (addedTasks > 0) changes.push(`linked ${addedTasks} discovered worker task(s)`);

  for (const run of healthRuns) {
    if (!run.agentId || !run.taskId) continue;
    const agent = agentById.get(run.agentId);
    if (!agent) continue;
    const task = taskById.get(run.taskId);
    const nextStatus =
      task && run.status !== "missing"
        ? managerAgentStatusFromTaskState(task.state)
        : ("stale" satisfies ManagerAgentStatus);
    const patch: {
      taskId?: string;
      sessionId?: string;
      status?: ManagerAgentStatus;
      lastError?: string;
      lastHeartbeatAt?: string;
      lastOutputAt?: string;
      lastOutput?: string;
    } = {};
    if (agent.taskId !== run.taskId) patch.taskId = run.taskId;
    if (run.sessionId && agent.sessionId !== run.sessionId) patch.sessionId = run.sessionId;
    if (agent.status !== nextStatus) patch.status = nextStatus;
    if (task?.updatedAt && agent.lastHeartbeatAt !== task.updatedAt)
      patch.lastHeartbeatAt = task.updatedAt;
    if (task?.completedAt && agent.lastOutputAt !== task.completedAt)
      patch.lastOutputAt = task.completedAt;
    if ((task?.error ?? "") !== (agent.lastError ?? "")) patch.lastError = task?.error ?? "";
    const output = task ? managerWorkerResultText(task) : "";
    if (output && output !== agent.lastOutput) patch.lastOutput = output;
    if (Object.keys(patch).length > 0) {
      await input.orchestrationStore.updateAgent(agent.id, patch);
      changes.push(`updated ${agent.role} agent from latest worker evidence`);
    }
  }

  const status = managerRoundStatusFromHealthRuns(latestRound, healthRuns, nextAgentIds.length);
  const patch: {
    agentIds?: string[];
    taskIds?: string[];
    status?: ManagerRoundStatus;
    completedAt?: string;
    summary?: string;
    error?: string;
  } = {};
  if (nextAgentIds.join("\u0000") !== latestRound.agentIds.join("\u0000"))
    patch.agentIds = nextAgentIds;
  if (nextTaskIds.join("\u0000") !== latestRound.taskIds.join("\u0000"))
    patch.taskIds = nextTaskIds;
  if (status !== latestRound.status) {
    patch.status = status;
    if (status === "completed") {
      patch.completedAt = latestRound.completedAt ?? input.now.toISOString();
      patch.summary = `${healthRuns.length} worker run(s) completed.`;
      patch.error = "";
    } else if (status === "blocked") {
      patch.completedAt = latestRound.completedAt ?? input.now.toISOString();
      patch.summary = "Round repair found incomplete or failed worker evidence.";
      patch.error = patch.summary;
    } else if (status === "running") {
      patch.completedAt = "";
      patch.summary = "Round repair found active worker evidence.";
      patch.error = "";
    }
    changes.push(`set round status to ${status}`);
  }
  const updated =
    Object.keys(patch).length > 0
      ? ((await input.orchestrationStore.updateRound(latestRound.id, patch)) ?? latestRound)
      : latestRound;
  const gate = (
    await buildManagerRoundHealthGate({
      ...input,
      round: updated,
    })
  ).gate;
  return {
    round: updated,
    gate,
    changed: changes.length > 0,
    changes,
  };
}

function buildManagerRoundHealthIssues(
  round: ManagerRound,
  agents: ManagerAgent[],
  runs: ManagerWorkerRun[],
  missingAgentIds: string[],
): ManagerRoundHealthIssue[] {
  const issues: ManagerRoundHealthIssue[] = [];
  if (round.agentIds.length === 0) {
    issues.push({
      code: "no-agents",
      severity: "warning",
      message: "No worker agents are attached to this round.",
      action: "repair-round",
    });
  }
  for (const agentId of missingAgentIds) {
    issues.push({
      code: "missing-agent",
      severity: "blocked",
      message: "Round references a missing worker agent.",
      agentId,
      action: "repair-round",
    });
  }
  const taskIdsWithRuns = new Set(runs.map((run) => run.taskId).filter(isPresent));
  for (const agent of agents) {
    if (!agent.taskId && round.status !== "planned") {
      issues.push({
        code: "agent-without-task",
        severity: "blocked",
        message: `${agent.role} agent has no worker task.`,
        agentId: agent.id,
        role: agent.role,
        action: "repair-round",
      });
    }
    if (agent.taskId && !taskIdsWithRuns.has(agent.taskId)) {
      issues.push({
        code: "agent-without-task",
        severity: "blocked",
        message: `${agent.role} agent points at a missing worker task.`,
        agentId: agent.id,
        taskId: agent.taskId,
        role: agent.role,
        action: "inspect-worker",
      });
    }
  }
  for (const run of runs) {
    if (run.status === "failed") {
      issues.push(
        managerRoundRunIssue(run, "worker-failed", "blocked", "Worker failed.", "retry-worker"),
      );
    } else if (run.status === "blocked") {
      issues.push(
        managerRoundRunIssue(
          run,
          "worker-blocked",
          "blocked",
          "Worker is blocked.",
          "retry-worker",
        ),
      );
    } else if (run.status === "missing") {
      issues.push(
        managerRoundRunIssue(
          run,
          "worker-missing",
          "blocked",
          "Worker task record is missing.",
          "repair-round",
        ),
      );
    } else if (run.timedOut) {
      issues.push(
        managerRoundRunIssue(run, "worker-timeout", "blocked", "Worker timed out.", "retry-worker"),
      );
    } else if (
      ["pending", "running", "waiting_for_device", "restart_required"].includes(run.status)
    ) {
      issues.push(
        managerRoundRunIssue(run, "worker-running", "warning", "Worker is still running.", "wait"),
      );
    }
    const integrityIssues = run.integrity.filter((item) => item !== "ok");
    for (const item of integrityIssues) {
      const severity = item === "missing-session" ? "warning" : "blocked";
      issues.push(
        managerRoundRunIssue(
          run,
          item === "missing-session" ? "missing-session" : "worker-integrity",
          severity,
          managerWorkerIntegrityMessage(item),
          item === "missing-session" ? "inspect-worker" : "repair-round",
        ),
      );
    }
  }
  if (["blocked", "failed", "cancelled"].includes(round.status)) {
    issues.push({
      code: "round-failed",
      severity: "blocked",
      message: `Round status is ${round.status}.`,
      ...(round.error || round.summary ? { detail: round.error || round.summary } : {}),
      action: "acknowledge",
    });
  }
  if (round.status === "completed") {
    const incompleteAgents = agents.filter((agent) => agent.status !== "completed");
    const incompleteRuns = runs.filter((run) => run.status !== "succeeded");
    if (incompleteAgents.length > 0 || incompleteRuns.length > 0) {
      issues.push({
        code: "round-completed-incomplete",
        severity: "blocked",
        message: "Round is marked completed but some agents or workers are not complete.",
        detail: `${incompleteAgents.length} agent(s), ${incompleteRuns.length} worker run(s) incomplete.`,
        action: "repair-round",
      });
    }
  }
  return dedupeManagerRoundHealthIssues(issues);
}

function managerRoundRunIssue(
  run: ManagerWorkerRun,
  code: ManagerRoundHealthIssue["code"],
  severity: ManagerRoundHealthIssue["severity"],
  message: string,
  action: ManagerRoundHealthIssue["action"],
): ManagerRoundHealthIssue {
  return {
    code,
    severity,
    message: run.agentRole ? `${run.agentRole}: ${message}` : message,
    ...(run.error || run.outputPreview ? { detail: run.error || run.outputPreview } : {}),
    ...(run.agentId ? { agentId: run.agentId } : {}),
    ...(run.taskId ? { taskId: run.taskId } : {}),
    ...(run.agentRole ? { role: run.agentRole } : {}),
    ...(action ? { action } : {}),
  };
}

function managerWorkerIntegrityMessage(issue: ManagerWorkerRunIntegrity): string {
  switch (issue) {
    case "missing-task":
      return "Linked worker task is missing.";
    case "missing-agent":
      return "Worker task points at a missing agent.";
    case "orphan-task":
      return "Worker task points at a missing round.";
    case "stale-agent":
      return "Agent is stale.";
    case "synthetic-failure":
      return "Dispatch created a synthetic failure task.";
    case "missing-session":
      return "Claude worker completed without a session id.";
    default:
      return "Worker integrity issue detected.";
  }
}

function dedupeManagerRoundHealthIssues(
  issues: ManagerRoundHealthIssue[],
): ManagerRoundHealthIssue[] {
  const seen = new Set<string>();
  const out: ManagerRoundHealthIssue[] = [];
  for (const issue of issues) {
    const key = [issue.code, issue.agentId ?? "", issue.taskId ?? "", issue.message].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out.slice(0, 20);
}

function managerRoundHealthSummary(
  status: ManagerRoundHealthGate["status"],
  issues: ManagerRoundHealthIssue[],
  runCount: number,
): string {
  if (status === "healthy") return `${runCount} worker run(s) verified.`;
  if (status === "unknown") return "No worker evidence is available yet.";
  const blocked = issues.filter((issue) => issue.severity === "blocked").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return `${blocked} blocker(s), ${warnings} warning(s).`;
}

function isManagerRoundInProgress(status: ManagerRoundStatus): boolean {
  return ["planned", "dispatching", "running", "collecting", "reviewing"].includes(status);
}

function selectManagerRoundHealthRuns(runs: ManagerWorkerRun[]): ManagerWorkerRun[] {
  const selected = new Map<string, ManagerWorkerRun>();
  for (const run of runs) {
    const key = run.agentId ? `agent:${run.agentId}` : run.taskId ? `task:${run.taskId}` : run.id;
    if (selected.has(key)) continue;
    selected.set(key, run);
  }
  return [...selected.values()];
}

function isManagerWorkerRunActive(status: ManagerWorkerRun["status"]): boolean {
  return (
    status === "pending" ||
    status === "running" ||
    status === "waiting_for_device" ||
    status === "restart_required"
  );
}

function managerRoundStatusFromHealthRuns(
  round: ManagerRound,
  runs: ManagerWorkerRun[],
  expectedAgents: number,
): ManagerRoundStatus {
  if (runs.length === 0) {
    return round.status === "completed" ? "blocked" : round.status;
  }
  if (
    runs.some(
      (run) =>
        run.status === "missing" ||
        run.status === "failed" ||
        run.status === "blocked" ||
        run.integrity.some((issue) => issue !== "ok" && issue !== "missing-session"),
    )
  ) {
    return "blocked";
  }
  if (runs.some((run) => isManagerWorkerRunActive(run.status))) return "running";
  const succeeded = runs.filter((run) => run.status === "succeeded").length;
  if (expectedAgents > 0 && succeeded >= expectedAgents) return "completed";
  if (round.status === "completed") return "blocked";
  return round.status;
}

function findManagerWorkerAgent(
  task: ManagerTask,
  agents: ManagerAgent[],
  agentByTaskId: Map<string, ManagerAgent>,
): ManagerAgent | undefined {
  const params = isRecord(task.params) ? task.params : {};
  const agentId = typeof params.agentId === "string" ? params.agentId : undefined;
  return (
    (agentId ? agents.find((agent) => agent.id === agentId) : undefined) ??
    agentByTaskId.get(task.id) ??
    agents.find((agent) => agent.taskId === task.id)
  );
}

function findManagerWorkerRound(
  task: ManagerTask,
  agent: ManagerAgent | undefined,
  scopedRound: ManagerRound | undefined,
  roundById: Map<string, ManagerRound>,
  rounds: ManagerRound[],
): ManagerRound | undefined {
  if (scopedRound?.taskIds.includes(task.id) || scopedRound?.agentIds.includes(agent?.id ?? "")) {
    return scopedRound;
  }
  const params = isRecord(task.params) ? task.params : {};
  const roundId =
    typeof params.roundId === "string" && params.roundId.trim()
      ? params.roundId.trim()
      : agent?.roundId;
  return (
    (roundId ? roundById.get(roundId) : undefined) ??
    rounds.find((round) => round.taskIds.includes(task.id)) ??
    (agent ? rounds.find((round) => round.agentIds.includes(agent.id)) : undefined)
  );
}

function managerWorkerRunFromTask(
  task: ManagerTask,
  agent: ManagerAgent | undefined,
  round: ManagerRound | undefined,
): ManagerWorkerRun {
  const params = isRecord(task.params) ? task.params : {};
  const result = isRecord(task.result) ? task.result : {};
  const profile = stringValue(result.profile) ?? stringValue(params.profile);
  const sessionId = managerWorkerSessionId(task) ?? agent?.sessionId;
  const integrity = managerWorkerRunIntegrity({ task, agent, round, profile, sessionId });
  const durationMs = numberValue(result.durationMs);
  const exitCode = numberValue(result.exitCode);
  const timedOut = booleanValue(result.timedOut);
  const stdoutTruncated = booleanValue(result.stdoutTruncated);
  const stderrTruncated = booleanValue(result.stderrTruncated);
  const command = stringValue(result.command);
  const cwd = stringValue(result.cwd) ?? stringValue(params.cwd);
  const outputPreview = managerWorkerResultText(task);
  const projectId = task.projectId ?? agent?.projectId ?? round?.projectId;
  const run: ManagerWorkerRun = {
    id: `task:${task.id}`,
    status: task.state,
    integrity,
    dryRun: task.dryRun,
    ...(projectId ? { projectId } : {}),
    requestedBy: task.requestedBy,
    taskId: task.id,
    ...(round?.id ? { roundId: round.id } : {}),
    ...(agent?.id ? { agentId: agent.id } : {}),
    ...(agent?.role ? { agentRole: agent.role } : {}),
    ...(agent?.label ? { agentLabel: agent.label } : {}),
    ...(profile ? { profile } : {}),
    ...(cwd ? { cwd } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(command ? { command } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(timedOut !== undefined ? { timedOut } : {}),
    ...(stdoutTruncated !== undefined ? { stdoutTruncated } : {}),
    ...(stderrTruncated !== undefined ? { stderrTruncated } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    ...(task.error ? { error: task.error } : {}),
  };
  return run;
}

function managerWorkerRunFromMissingTask(
  taskId: string,
  agent: ManagerAgent | undefined,
  round: ManagerRound | undefined,
  now: Date,
): ManagerWorkerRun {
  const updatedAt = agent?.updatedAt ?? round?.updatedAt ?? now.toISOString();
  const projectId = agent?.projectId ?? round?.projectId;
  return {
    id: `missing-task:${taskId}`,
    status: "missing",
    integrity: ["missing-task"],
    dryRun: false,
    taskId,
    ...(projectId ? { projectId } : {}),
    ...(round?.id ? { roundId: round.id } : {}),
    ...(agent?.id ? { agentId: agent.id } : {}),
    ...(agent?.role ? { agentRole: agent.role } : {}),
    ...(agent?.label ? { agentLabel: agent.label } : {}),
    ...(agent?.profile ? { profile: agent.profile } : {}),
    ...(agent?.cwd ? { cwd: agent.cwd } : {}),
    ...(agent?.sessionId ? { sessionId: agent.sessionId } : {}),
    createdAt: updatedAt,
    updatedAt,
    ...(agent?.lastError ? { error: agent.lastError } : { error: "worker task record is missing" }),
  };
}

function managerWorkerRunIntegrity(input: {
  task: ManagerTask;
  agent: ManagerAgent | undefined;
  round: ManagerRound | undefined;
  profile: string | undefined;
  sessionId: string | undefined;
}): ManagerWorkerRunIntegrity[] {
  const issues: ManagerWorkerRunIntegrity[] = [];
  const params = isRecord(input.task.params) ? input.task.params : {};
  if (stringValue(params.agentId) && !input.agent) issues.push("missing-agent");
  if (stringValue(params.roundId) && !input.round) issues.push("orphan-task");
  if (input.agent?.status === "stale") issues.push("stale-agent");
  if (input.task.id.startsWith("spawn-failed-") || input.task.error?.includes("dispatch spawn")) {
    issues.push("synthetic-failure");
  }
  if (
    !input.sessionId &&
    !input.task.dryRun &&
    input.task.state === "succeeded" &&
    input.profile === "claude-code"
  ) {
    issues.push("missing-session");
  }
  return issues.length > 0 ? issues : ["ok"];
}

function summarizeManagerWorkerRuns(runs: ManagerWorkerRun[]) {
  return {
    total: runs.length,
    running: runs.filter((run) =>
      ["pending", "running", "waiting_for_device", "restart_required"].includes(run.status),
    ).length,
    succeeded: runs.filter((run) => run.status === "succeeded").length,
    failed: runs.filter((run) => run.status === "failed").length,
    blocked: runs.filter((run) => run.status === "blocked").length,
    stale: runs.filter((run) => run.integrity.includes("stale-agent")).length,
    missing: runs.filter((run) => run.status === "missing").length,
    withSession: runs.filter((run) => run.sessionId).length,
    withoutSession: runs.filter((run) => !run.sessionId).length,
    integrityIssues: runs.filter((run) => run.integrity.length > 1 || !run.integrity.includes("ok"))
      .length,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

interface ManagerAcknowledgeInput {
  acknowledgedBy: string;
  reason?: string;
}

async function parseManagerAcknowledgeRequest(req: { text(): Promise<string> }): Promise<
  { ok: true; value: ManagerAcknowledgeInput } | { ok: false; error: string }
> {
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: "invalid JSON body" };
  }
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  const acknowledgedBy =
    typeof body.acknowledgedBy === "string" && body.acknowledgedBy.trim()
      ? body.acknowledgedBy.trim().slice(0, 80)
      : "browser";
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : undefined;
  return {
    ok: true,
    value: {
      acknowledgedBy,
      ...(reason ? { reason } : {}),
    },
  };
}

async function acknowledgeManagerStateFailures(input: {
  taskStore: ManagerTaskStore;
  orchestrationStore: ManagerOrchestrationStore;
  input: ManagerAcknowledgeInput;
  now: Date;
}): Promise<ManagerAcknowledgeResponse> {
  const nowMs = input.now.getTime();
  const [tasks, agents, rounds] = await Promise.all([
    input.taskStore.list(500),
    input.orchestrationStore.listAgents(),
    input.orchestrationStore.listRounds(),
  ]);
  const acknowledgedTasks: ManagerTask[] = [];
  const acknowledgedAgents: ManagerAgent[] = [];
  const acknowledgedRounds: ManagerRound[] = [];
  for (const task of tasks) {
    if (!isManagerTaskAcknowledgable(task, nowMs) || task.acknowledgedAt) continue;
    const acknowledged = await acknowledgeManagerTask(
      input.taskStore,
      task,
      input.input,
      input.now,
    );
    if (acknowledged.ok) acknowledgedTasks.push(acknowledged.task);
  }
  for (const agent of agents) {
    if (!isManagerAgentAcknowledgable(agent) || agent.acknowledgedAt) continue;
    const acknowledged = await acknowledgeManagerAgent(
      input.orchestrationStore,
      agent,
      input.input,
      input.now,
    );
    if (acknowledged.ok) acknowledgedAgents.push(acknowledged.agent);
  }
  for (const round of rounds) {
    if (!isManagerRoundAcknowledgable(round) || round.acknowledgedAt) continue;
    const acknowledged = await acknowledgeManagerRound(
      input.orchestrationStore,
      round,
      input.input,
      input.now,
    );
    if (acknowledged.ok) acknowledgedRounds.push(acknowledged.round);
  }
  return {
    generatedAt: input.now.toISOString(),
    tasks: acknowledgedTasks.map(sanitizeManagerTaskForAssistant),
    agents: acknowledgedAgents,
    rounds: acknowledgedRounds,
  };
}

async function acknowledgeManagerTask(
  store: ManagerTaskStore,
  task: ManagerTask,
  input: ManagerAcknowledgeInput,
  now: Date,
): Promise<{ ok: true; task: ManagerTask } | { ok: false; error: string }> {
  if (!isManagerTaskAcknowledgable(task, now.getTime())) {
    return { ok: false, error: "task has no failed, blocked, or stale state to acknowledge" };
  }
  const updated = await store.update(task.id, managerAcknowledgePatch(input, now));
  if (!updated) return { ok: false, error: "unknown task" };
  return { ok: true, task: updated };
}

async function acknowledgeManagerAgent(
  store: ManagerOrchestrationStore,
  agent: ManagerAgent,
  input: ManagerAcknowledgeInput,
  now: Date,
): Promise<{ ok: true; agent: ManagerAgent } | { ok: false; error: string }> {
  if (!isManagerAgentAcknowledgable(agent)) {
    return { ok: false, error: "agent has no blocked, failed, or stale state to acknowledge" };
  }
  const updated = await store.updateAgent(agent.id, managerAcknowledgePatch(input, now));
  if (!updated) return { ok: false, error: "unknown agent" };
  return { ok: true, agent: updated };
}

async function acknowledgeManagerRound(
  store: ManagerOrchestrationStore,
  round: ManagerRound,
  input: ManagerAcknowledgeInput,
  now: Date,
): Promise<{ ok: true; round: ManagerRound } | { ok: false; error: string }> {
  if (!isManagerRoundAcknowledgable(round)) {
    return { ok: false, error: "round has no blocked or failed state to acknowledge" };
  }
  const updated = await store.updateRound(round.id, managerAcknowledgePatch(input, now));
  if (!updated) return { ok: false, error: "unknown round" };
  return { ok: true, round: updated };
}

function managerAcknowledgePatch(
  input: ManagerAcknowledgeInput,
  now: Date,
): { acknowledgedAt: string; acknowledgedBy: string; acknowledgedReason?: string } {
  return {
    acknowledgedAt: now.toISOString(),
    acknowledgedBy: input.acknowledgedBy,
    ...(input.reason ? { acknowledgedReason: input.reason } : {}),
  };
}

function isManagerTaskAcknowledgable(task: ManagerTask, nowMs: number): boolean {
  return (
    task.state === "failed" ||
    task.state === "blocked" ||
    Boolean(managerTaskStaleReason(task, nowMs))
  );
}

function isManagerAgentAcknowledgable(agent: ManagerAgent): boolean {
  return agent.status === "blocked" || agent.status === "failed" || agent.status === "stale";
}

function isManagerRoundAcknowledgable(round: ManagerRound): boolean {
  return round.status === "blocked" || round.status === "failed";
}

interface ManagerStateViewInput {
  taskStore: ManagerTaskStore;
  orchestrationStore: ManagerOrchestrationStore;
  latestStatus?: ManagerAssistantStatusReport | undefined;
  now: Date;
}

async function buildManagerStateView(
  input: ManagerStateViewInput,
): Promise<ManagerStateViewResponse> {
  const [rounds, agents, tasks] = await Promise.all([
    input.orchestrationStore.listRounds(),
    input.orchestrationStore.listAgents(),
    input.taskStore.list(500),
  ]);
  const nowMs = input.now.getTime();
  const taskSummaries = tasks.map((task) => summarizeManagerStateTask(task, agents, rounds, nowMs));
  const unacknowledgedTaskSummaries = taskSummaries.filter((task) => !task.acknowledgedAt);
  const staleTasks = unacknowledgedTaskSummaries.filter((task) => task.stale).slice(0, 20);
  const runningTasks = taskSummaries
    .filter((task) => !isManagerTaskTerminalState(task.state))
    .slice(0, 20);
  const roundSummaries = rounds.map((round) => summarizeManagerStateRound(round, agents, tasks));
  const unacknowledgedRoundSummaries = roundSummaries.filter((round) => !round.acknowledgedAt);
  const activeRound =
    unacknowledgedRoundSummaries.find((round) =>
      ["dispatching", "running", "collecting", "reviewing", "blocked", "failed"].includes(
        round.status,
      ),
    ) ?? unacknowledgedRoundSummaries[0];
  const blockers = buildManagerStateBlockers({
    rounds: roundSummaries,
    agents,
    tasks: taskSummaries,
  });
  const recoveryActions = buildManagerStateRecoveryActions({
    tasks: unacknowledgedTaskSummaries,
    blockers,
    latestStatus: input.latestStatus,
  });
  const runningAgents = agents.filter((agent) =>
    ["assigned", "running", "waiting"].includes(agent.status),
  ).length;
  const blockedAgents = agents.filter(
    (agent) => ["blocked", "failed", "stale"].includes(agent.status) && !agent.acknowledgedAt,
  ).length;
  const blockedTasks = unacknowledgedTaskSummaries.filter(
    (task) => task.state === "blocked",
  ).length;
  const failedTasks = unacknowledgedTaskSummaries.filter((task) => task.state === "failed").length;
  const current = managerStateCurrent({
    activeRound,
    latestStatus: input.latestStatus,
    runningTasks,
    staleTasks,
    blockers,
    runningAgents,
    now: input.now,
  });
  const status = managerStateStatusFromCurrent(current);
  const freshness = managerStateFreshness({
    latestStatus: input.latestStatus,
    tasks: taskSummaries,
    rounds: roundSummaries,
    agents,
    current,
    now: input.now,
  });
  return {
    generatedAt: input.now.toISOString(),
    freshness,
    current,
    status,
    counts: {
      rounds: rounds.length,
      activeRounds: roundSummaries.filter(
        (round) => !isManagerRoundTerminalState(round.status) && !round.acknowledgedAt,
      ).length,
      agents: agents.length,
      runningAgents,
      blockedAgents,
      tasks: tasks.length,
      runningTasks: runningTasks.length,
      blockedTasks,
      failedTasks,
      staleTasks: staleTasks.length,
      blockers: blockers.length,
    },
    ...(activeRound ? { activeRound } : {}),
    recentRounds: roundSummaries.slice(0, 10),
    runningTasks,
    staleTasks,
    blockers,
    recoveryActions,
    ...(input.latestStatus ? { latestStatus: input.latestStatus } : {}),
  };
}

function summarizeManagerStateRound(
  round: ManagerRound,
  agents: ManagerAgent[],
  tasks: ManagerTask[],
): ManagerStateRoundSummary {
  const agentIds = new Set(round.agentIds);
  const roundAgents = agents.filter(
    (agent) => agent.roundId === round.id || agentIds.has(agent.id),
  );
  const taskIds = new Set(round.taskIds);
  const agentTaskIds = new Set(
    roundAgents.map((agent) => agent.taskId).filter((id): id is string => Boolean(id)),
  );
  const roundTasks = tasks.filter((task) => taskIds.has(task.id) || agentTaskIds.has(task.id));
  return {
    id: round.id,
    title: round.title,
    objective: round.objective,
    status: round.status,
    updatedAt: round.updatedAt,
    createdAt: round.createdAt,
    ...(round.startedAt ? { startedAt: round.startedAt } : {}),
    ...(round.completedAt ? { completedAt: round.completedAt } : {}),
    ...(round.summary ? { summary: round.summary } : {}),
    ...(round.error ? { error: round.error } : {}),
    ...(round.acknowledgedAt ? { acknowledgedAt: round.acknowledgedAt } : {}),
    ...(round.acknowledgedBy ? { acknowledgedBy: round.acknowledgedBy } : {}),
    ...(round.acknowledgedReason ? { acknowledgedReason: round.acknowledgedReason } : {}),
    counts: {
      agents: roundAgents.length,
      completedAgents: roundAgents.filter((agent) => agent.status === "completed").length,
      runningAgents: roundAgents.filter((agent) =>
        ["assigned", "running", "waiting"].includes(agent.status),
      ).length,
      blockedAgents: roundAgents.filter(
        (agent) => ["blocked", "failed", "stale"].includes(agent.status) && !agent.acknowledgedAt,
      ).length,
      tasks: roundTasks.length,
      completedTasks: roundTasks.filter((task) => task.state === "succeeded").length,
      runningTasks: roundTasks.filter((task) => !isManagerTaskTerminalState(task.state)).length,
      blockedTasks: roundTasks.filter((task) => task.state === "blocked" && !task.acknowledgedAt)
        .length,
      failedTasks: roundTasks.filter((task) => task.state === "failed" && !task.acknowledgedAt)
        .length,
    },
  };
}

function summarizeManagerStateTask(
  task: ManagerTask,
  agents: ManagerAgent[],
  rounds: ManagerRound[],
  nowMs: number,
): ManagerStateTaskSummary {
  const agent = agents.find((item) => item.taskId === task.id);
  const round =
    (agent?.roundId ? rounds.find((item) => item.id === agent.roundId) : undefined) ??
    rounds.find((item) => item.taskIds.includes(task.id));
  const staleReason = managerTaskStaleReason(task, nowMs);
  return {
    id: task.id,
    kind: task.kind,
    state: task.state,
    requestedBy: task.requestedBy,
    updatedAt: task.updatedAt,
    createdAt: task.createdAt,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.targetId ? { targetId: task.targetId } : {}),
    ...(task.targetLabel ? { targetLabel: task.targetLabel } : {}),
    ...(round?.id ? { roundId: round.id } : {}),
    ...(agent?.id ? { agentId: agent.id } : {}),
    ...(agent?.role ? { agentRole: String(agent.role) } : {}),
    stale: Boolean(staleReason),
    ...(staleReason ? { staleReason } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...(task.acknowledgedAt ? { acknowledgedAt: task.acknowledgedAt } : {}),
    ...(task.acknowledgedBy ? { acknowledgedBy: task.acknowledgedBy } : {}),
    ...(task.acknowledgedReason ? { acknowledgedReason: task.acknowledgedReason } : {}),
  };
}

function buildManagerStateBlockers(input: {
  rounds: ManagerStateRoundSummary[];
  agents: ManagerAgent[];
  tasks: ManagerStateTaskSummary[];
}): ManagerStateBlocker[] {
  const blockers: ManagerStateBlocker[] = [];
  for (const task of input.tasks) {
    if (task.acknowledgedAt) continue;
    if (task.stale) {
      blockers.push({
        id: `task-stale:${task.id}`,
        kind: "task",
        severity: "warning",
        message: `${task.kind} task is stale`,
        ...(task.staleReason ? { detail: task.staleReason } : {}),
        taskId: task.id,
        ...(task.roundId ? { roundId: task.roundId } : {}),
        ...(task.agentId ? { agentId: task.agentId } : {}),
      });
    } else if (task.state === "failed" || task.state === "blocked") {
      blockers.push({
        id: `task-${task.state}:${task.id}`,
        kind: "task",
        severity: task.state === "failed" ? "error" : "warning",
        message: `${task.kind} task ${task.state}`,
        ...(task.error ? { detail: task.error } : {}),
        taskId: task.id,
        ...(task.roundId ? { roundId: task.roundId } : {}),
        ...(task.agentId ? { agentId: task.agentId } : {}),
      });
    }
  }
  for (const agent of input.agents) {
    if (agent.acknowledgedAt) continue;
    if (!["blocked", "failed", "stale"].includes(agent.status)) continue;
    blockers.push({
      id: `agent-${agent.status}:${agent.id}`,
      kind: "agent",
      severity: agent.status === "failed" ? "error" : "warning",
      message: `${agent.role} agent ${agent.status}`,
      ...(agent.lastError ? { detail: agent.lastError } : {}),
      agentId: agent.id,
      ...(agent.roundId ? { roundId: agent.roundId } : {}),
      ...(agent.taskId ? { taskId: agent.taskId } : {}),
    });
  }
  for (const round of input.rounds) {
    if (round.acknowledgedAt) continue;
    if (round.status !== "blocked" && round.status !== "failed") continue;
    blockers.push({
      id: `round-${round.status}:${round.id}`,
      kind: "round",
      severity: round.status === "failed" ? "error" : "warning",
      message: `${round.title} ${round.status}`,
      ...(round.error ? { detail: round.error } : {}),
      roundId: round.id,
    });
  }
  return blockers.slice(0, 20);
}

function buildManagerStateRecoveryActions(input: {
  tasks: ManagerStateTaskSummary[];
  blockers: ManagerStateBlocker[];
  latestStatus?: ManagerAssistantStatusReport | undefined;
}): ManagerStateViewResponse["recoveryActions"] {
  const problemTasks = input.tasks.filter(
    (task) =>
      task.stale ||
      task.state === "failed" ||
      task.state === "blocked" ||
      task.state === "waiting_for_device" ||
      task.state === "restart_required",
  );
  const recoveryText = [
    input.latestStatus?.message,
    input.latestStatus?.detail,
    ...input.blockers.flatMap((blocker) => [blocker.message, blocker.detail]),
    ...problemTasks.flatMap((task) => [task.kind, task.state, task.error, task.staleReason]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  const hasRegistrationProblem =
    problemTasks.some((task) => task.kind === "repair-registration") ||
    /\b(registration|register|pairing|pair|site token|daemon token)\b/.test(recoveryText) ||
    recoveryText.includes("registration_required") ||
    recoveryText.includes("branch_mismatch") ||
    recoveryText.includes("re-run the registration command");
  const hasUpdateProblem =
    problemTasks.some(
      (task) =>
        task.kind === "update-all" ||
        task.kind === "update-server" ||
        task.kind === "update-device",
    ) ||
    /\b(update|version|drift)\b/.test(recoveryText) ||
    recoveryText.includes("connector mismatch") ||
    recoveryText.includes("connector update");

  const actions: ManagerStateViewResponse["recoveryActions"] = [];
  if (hasRegistrationProblem) {
    actions.push({
      id: "repair-registration",
      label: "Repair registration",
      reason: "A registration or token problem needs the connector registration flow.",
      taskKind: "repair-registration",
      enabled: true,
    });
  }
  if (hasUpdateProblem && !hasRegistrationProblem) {
    actions.push({
      id: "update-all",
      label: "Update all",
      reason: "An update task failed or a version mismatch is active.",
      taskKind: "update-all",
      enabled: true,
    });
  }
  return actions;
}

function managerStateCurrent(input: {
  activeRound?: ManagerStateRoundSummary | undefined;
  latestStatus?: ManagerAssistantStatusReport | undefined;
  runningTasks: ManagerStateTaskSummary[];
  staleTasks: ManagerStateTaskSummary[];
  blockers: ManagerStateBlocker[];
  runningAgents: number;
  now: Date;
}): ManagerStateViewResponse["current"] {
  const runningTask = input.runningTasks[0];
  const hasUnacknowledgedIssue = input.blockers.length > 0 || input.staleTasks.length > 0;
  const activeRoundIsRunning =
    input.activeRound &&
    ["planned", "dispatching", "running", "collecting", "reviewing"].includes(
      input.activeRound.status,
    ) &&
    !hasUnacknowledgedIssue;
  if (activeRoundIsRunning && input.activeRound) {
    const status: ManagerStateViewResponse["current"]["status"] =
      input.activeRound.status === "blocked"
        ? "blocked"
        : input.activeRound.status === "failed"
          ? "failed"
          : input.activeRound.status === "reviewing" || input.activeRound.status === "collecting"
            ? "waiting"
            : "running";
    return {
      kind: "round",
      status,
      tone: status === "blocked" || status === "failed" ? "warning" : "running",
      source: "round",
      title: input.activeRound.title,
      detail: `${input.runningAgents} agents running, ${input.runningTasks.length} tasks active`,
      ...(input.activeRound.startedAt ? { startedAt: input.activeRound.startedAt } : {}),
      updatedAt: input.activeRound.updatedAt,
      roundId: input.activeRound.id,
      actionable: true,
      actions:
        status === "blocked" || status === "failed"
          ? ["details", "acknowledge"]
          : ["details", "cancel"],
    };
  }
  if (runningTask && !hasUnacknowledgedIssue) {
    const waiting = runningTask.state === "waiting_for_device";
    return {
      kind: runningTask.kind === "run-worker" ? "worker" : "manager",
      status: waiting ? "waiting" : "running",
      tone: "running",
      source: "task",
      title: waiting ? `${runningTask.kind} is waiting` : `${runningTask.kind} is running`,
      ...(runningTask.targetLabel || runningTask.agentRole
        ? { detail: runningTask.targetLabel ?? runningTask.agentRole }
        : {}),
      ...(runningTask.startedAt ? { startedAt: runningTask.startedAt } : {}),
      updatedAt: runningTask.updatedAt,
      taskId: runningTask.id,
      ...(runningTask.agentId ? { agentId: runningTask.agentId } : {}),
      ...(runningTask.roundId ? { roundId: runningTask.roundId } : {}),
      actionable: true,
      actions: ["details", "cancel"],
    };
  }
  const errorBlocker = input.blockers.find((blocker) => blocker.severity === "error");
  if (errorBlocker) {
    return {
      kind: errorBlocker.kind,
      status: "failed",
      tone: "error",
      source: errorBlocker.kind,
      title: errorBlocker.message,
      ...(errorBlocker.detail ? { detail: errorBlocker.detail } : {}),
      ...(errorBlocker.taskId ? { taskId: errorBlocker.taskId } : {}),
      ...(errorBlocker.agentId ? { agentId: errorBlocker.agentId } : {}),
      ...(errorBlocker.roundId ? { roundId: errorBlocker.roundId } : {}),
      actionable: true,
      actions: errorBlocker.taskId
        ? ["details", "retry", "acknowledge"]
        : ["details", "acknowledge"],
    };
  }
  if (input.staleTasks.length > 0) {
    const task = input.staleTasks[0] as ManagerStateTaskSummary;
    return {
      kind: task.kind === "run-worker" ? "worker" : "manager",
      status: "stale",
      tone: "warning",
      source: "task",
      title: `${task.kind} task needs attention`,
      ...(task.staleReason ? { detail: task.staleReason } : {}),
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      updatedAt: task.updatedAt,
      taskId: task.id,
      ...(task.agentId ? { agentId: task.agentId } : {}),
      ...(task.roundId ? { roundId: task.roundId } : {}),
      actionable: true,
      actions: ["details", "refresh", "acknowledge"],
    };
  }
  const warningBlocker = input.blockers.find((blocker) => blocker.severity === "warning");
  if (warningBlocker) {
    return {
      kind: warningBlocker.kind,
      status: "blocked",
      tone: "warning",
      source: warningBlocker.kind,
      title: warningBlocker.message,
      ...(warningBlocker.detail ? { detail: warningBlocker.detail } : {}),
      ...(warningBlocker.taskId ? { taskId: warningBlocker.taskId } : {}),
      ...(warningBlocker.agentId ? { agentId: warningBlocker.agentId } : {}),
      ...(warningBlocker.roundId ? { roundId: warningBlocker.roundId } : {}),
      actionable: true,
      actions: warningBlocker.taskId
        ? ["details", "retry", "acknowledge"]
        : ["details", "acknowledge"],
    };
  }
  if (input.latestStatus && input.latestStatus.level !== "success") {
    const tone =
      input.latestStatus.level === "warning" || input.latestStatus.level === "error"
        ? "warning"
        : "idle";
    return {
      kind: "manager",
      status: tone === "warning" ? "blocked" : "idle",
      tone,
      source: "status",
      title: input.latestStatus.message,
      ...(input.latestStatus.detail ? { detail: input.latestStatus.detail } : {}),
      updatedAt: input.latestStatus.createdAt,
      actionable: tone === "warning",
      actions: tone === "warning" ? ["details", "refresh"] : ["details"],
    };
  }
  if (input.activeRound) {
    return {
      kind: "round",
      status: input.activeRound.acknowledgedAt ? "acknowledged" : "idle",
      tone: "idle",
      source: "round",
      title: input.activeRound.title,
      detail: `round ${input.activeRound.status}`,
      updatedAt: input.activeRound.updatedAt,
      roundId: input.activeRound.id,
      actionable: false,
      actions: ["details"],
    };
  }
  return {
    kind: "idle",
    status: "idle",
    tone: "idle",
    source: "system",
    title: "Manager is ready",
    updatedAt: input.now.toISOString(),
    actionable: false,
    actions: [],
  };
}

function managerStateStatusFromCurrent(
  current: ManagerStateViewResponse["current"],
): ManagerStateViewResponse["status"] {
  return {
    tone: current.tone,
    source: current.source,
    message: current.title,
    ...(current.detail ? { detail: current.detail } : {}),
  };
}

function managerStateFreshness(input: {
  latestStatus?: ManagerAssistantStatusReport | undefined;
  tasks: ManagerStateTaskSummary[];
  rounds: ManagerStateRoundSummary[];
  agents: ManagerAgent[];
  current: ManagerStateViewResponse["current"];
  now: Date;
}): ManagerStateViewResponse["freshness"] {
  const lastSignalAt = latestManagerStateSignalAt(input);
  const ageMs = lastSignalAt ? Math.max(0, input.now.getTime() - Date.parse(lastSignalAt)) : 0;
  const shouldRequireFreshSignal =
    input.current.status === "running" || input.current.status === "waiting";
  return {
    source: "poll",
    lastRefreshAt: input.now.toISOString(),
    ...(lastSignalAt ? { lastSignalAt } : {}),
    ...(lastSignalAt ? { ageMs } : {}),
    stale: Boolean(shouldRequireFreshSignal && lastSignalAt && ageMs > 120_000),
  };
}

function latestManagerStateSignalAt(input: {
  latestStatus?: ManagerAssistantStatusReport | undefined;
  tasks: ManagerStateTaskSummary[];
  rounds: ManagerStateRoundSummary[];
  agents: ManagerAgent[];
}): string | undefined {
  const candidates = [
    input.latestStatus?.createdAt,
    ...input.tasks.map((task) => task.updatedAt),
    ...input.rounds.map((round) => round.updatedAt),
    ...input.agents.map((agent) => agent.updatedAt),
  ].filter((value): value is string => Boolean(value));
  let latest: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const time = Date.parse(candidate);
    if (Number.isFinite(time) && time > latestMs) {
      latest = candidate;
      latestMs = time;
    }
  }
  return latest;
}

function managerTaskStaleReason(task: ManagerTask, nowMs: number): string | undefined {
  if (isManagerTaskTerminalState(task.state)) return undefined;
  const reference = Date.parse(task.startedAt ?? task.updatedAt ?? task.createdAt);
  if (!Number.isFinite(reference)) return undefined;
  const elapsedMs = nowMs - reference;
  const thresholdMs = managerTaskStaleThresholdMs(task);
  if (elapsedMs <= thresholdMs) return undefined;
  return `no terminal update for ${formatManagerDuration(elapsedMs)}`;
}

function managerTaskStaleThresholdMs(task: ManagerTask): number {
  const timeoutMs = managerTaskTimeoutMs(task);
  if (timeoutMs > 0) return timeoutMs + 60_000;
  if (task.kind === "run-worker") return DEFAULT_MANAGER_ASSISTANT_TIMEOUT_MS + 60_000;
  return 30 * 60_000;
}

function managerTaskTimeoutMs(task: ManagerTask): number {
  const raw = task.params?.timeoutMs;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function isManagerRoundTerminalState(state: ManagerRoundStatus): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function formatManagerDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

function managerAgentStatusFromTaskState(state: ManagerTaskState): ManagerAgentStatus {
  if (state === "pending") return "assigned";
  if (state === "running" || state === "waiting_for_device") return "running";
  if (state === "succeeded") return "completed";
  if (state === "blocked" || state === "restart_required") return "blocked";
  if (state === "cancelled") return "cancelled";
  return "failed";
}

function managerRoundStatusFromTasks(tasks: ManagerTask[]): ManagerRoundStatus {
  if (tasks.some((task) => task.state === "running" || task.state === "pending")) return "running";
  if (tasks.some((task) => task.state === "failed")) return "failed";
  if (tasks.some((task) => task.state === "blocked" || task.state === "restart_required")) {
    return "blocked";
  }
  if (tasks.some((task) => task.state === "cancelled")) return "cancelled";
  return "completed";
}

function managerWorkerResultText(task: ManagerTask): string {
  const result = isRecord(task.result) ? task.result : null;
  const stdout = typeof result?.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr.trim() : "";
  return truncateText(stdout || stderr, 2_000);
}

function managerWorkerSessionId(task: ManagerTask): string | undefined {
  const result = isRecord(task.result) ? task.result : null;
  const sessionId = result?.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined;
}

function managerRoundSummary(
  round: ManagerRound,
  agents: ManagerAgent[],
  tasks: ManagerTask[],
): string {
  const counts = new Map<string, number>();
  for (const agent of agents) counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
  const taskSummary = tasks.length
    ? `${tasks.length} task(s): ${tasks.map((task) => task.state).join(", ")}`
    : "no tasks";
  const agentSummary = agents.length
    ? [...counts.entries()].map(([status, count]) => `${status} ${count}`).join(", ")
    : "no agents";
  return `${round.title}: ${agentSummary}; ${taskSummary}.`;
}

function streamManagerEvents(bus: ManagerEventBus, afterSeq: number): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (event: ManagerEvent) => {
        write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        if (closeTimer) clearTimeout(closeTimer);
        try {
          controller.close();
        } catch {
          // Client disconnects are fine; manager events are best-effort.
        }
      };

      write("retry: 3000\n\n");
      for (const event of bus.recent(afterSeq)) emit(event);
      unsubscribe = bus.subscribe(emit);
      keepaliveTimer = setInterval(() => {
        write(": keepalive\n\n");
      }, 25_000);
      closeTimer = setTimeout(close, 300_000);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (closeTimer) clearTimeout(closeTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

function streamManagerTaskObservation(store: ManagerTaskStore, taskId: string): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const started = Date.now();
  const maxDurationMs = 120_000;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ManagerTaskStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Client disconnects are fine; this stream is best-effort observation.
        }
      };
      let lastFingerprint = "";
      const poll = async () => {
        try {
          const task = await store.get(taskId);
          if (!task) {
            emit({ type: "error", error: "unknown task" });
            close();
            return;
          }
          const observation = buildManagerTaskObservation(task);
          const fingerprint = managerTaskObservationFingerprint(observation);
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            emit({
              type: observation.terminal ? "done" : "snapshot",
              observation,
            });
          }
          if (observation.terminal || Date.now() - started > maxDurationMs) close();
        } catch (error) {
          emit({ type: "error", error: errorMessage(error) });
          close();
        }
      };
      void poll();
      timer = setInterval(() => {
        void poll();
      }, 1_000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

function managerTaskObservationFingerprint(observation: ManagerTaskObservationResponse): string {
  return [
    observation.task.id,
    observation.task.state,
    observation.task.updatedAt,
    observation.task.steps.length,
    observation.terminal ? "terminal" : "active",
  ].join("|");
}

function sanitizeManagerTaskForAssistant(task: ManagerTask): ManagerTask {
  return redactManagerSensitiveValue(task);
}

function sanitizeManagerTaskLogForAssistant(log: ManagerTaskLogResponse): ManagerTaskLogResponse {
  return redactManagerSensitiveValue(log);
}

function sanitizeDiagnosticStepForAssistant(step: DiagnosticStep): DiagnosticStep {
  return redactManagerSensitiveValue(step);
}

function redactManagerSensitiveValue<T>(value: T): T {
  if (typeof value === "string") return redactManagerSensitiveText(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => redactManagerSensitiveValue(item)) as T;
  }
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactManagerSensitiveValue(item);
  }
  return out as T;
}

function redactManagerSensitiveText(value: string): string {
  return value
    .replace(/(-SiteToken\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
    .replace(/(--site-token(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
    .replace(/(\bSite token:\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1[redacted]")
    .replace(/(\bAuthorization\s*[:=]\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(
      /(["']?(?:siteToken|authToken|daemonToken|token)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{16,}(["']?)/gi,
      "$1[redacted]$2",
    );
}

async function enrichManagerAssistantContext(
  input: ManagerAssistantChatContext | undefined,
  stores: ManagerAssistantContextStores | undefined,
): Promise<ManagerAssistantChatContext | undefined> {
  const context: ManagerAssistantChatContext = input ? { ...input } : {};
  const warnings = [...(context.projectWarnings ?? [])];
  if (!context.projectId || !stores) {
    return Object.keys(context).length ? context : undefined;
  }
  try {
    const project = await stores.projectStore.get(context.projectId);
    if (!project) {
      warnings.push(
        `selected project ${context.projectId} was not found in the manager project store`,
      );
      context.projectWarnings = warnings.slice(0, 5);
      return context;
    }
    context.projectId = project.id;
    context.projectName = project.name;
    context.projectStatus = project.status;
    context.projectCwd = project.cwd;
    if (project.goal.trim()) context.projectGoal = project.goal;
    const commandFlow = await buildManagerCommandFlow({
      project,
      orchestrationStore: stores.orchestrationStore,
      taskStore: stores.taskStore,
      decisionStore: stores.decisionStore,
      blockerStore: stores.blockerStore,
      artifactStore: stores.artifactStore,
      protocolStore: stores.protocolStore,
      repoRoot: stores.repoRoot,
      now: new Date(),
    });
    const flowLines = formatManagerCommandFlowContextLines(commandFlow);
    if (flowLines.length) context.projectCommandFlow = flowLines;
    const activeRound =
      commandFlow.activeRound ??
      (context.activeRoundId
        ? commandFlow.rounds.find((round) => round.id === context.activeRoundId)
        : undefined);
    if (activeRound) {
      context.activeRoundId = activeRound.id;
      context.activeRoundTitle = activeRound.title;
      context.activeRoundStatus = activeRound.status;
    }
    const activeDecisionLines = commandFlow.decisions
      .filter((decision) => decision.status === "active")
      .slice(0, 5)
      .map(formatManagerDecisionContextLine);
    if (activeDecisionLines.length) context.projectDecisions = activeDecisionLines;
    const openBlockerLines = commandFlow.blockers.slice(0, 5).map(formatManagerBlockerContextLine);
    if (openBlockerLines.length) context.projectBlockers = openBlockerLines;
    const activeArtifactLines = commandFlow.artifacts
      .slice(0, 8)
      .map(formatManagerArtifactContextLine);
    if (activeArtifactLines.length) context.projectArtifacts = activeArtifactLines;
    const protocolLines = formatManagerProtocolContextLines(commandFlow.protocol);
    if (protocolLines.length) context.projectProtocol = protocolLines;
    warnings.push(...commandFlow.readiness.warnings.slice(0, 3));
  } catch (error) {
    warnings.push(`project context enrichment failed: ${errorMessage(error)}`);
  }
  if (warnings.length) context.projectWarnings = warnings.slice(0, 5);
  return Object.keys(context).length ? context : undefined;
}

function formatManagerDecisionContextLine(decision: ManagerDecision): string {
  const detail = compactManagerContextText(decision.detail, 180);
  return `${decision.title} (${decision.status})${detail ? ` - ${detail}` : ""}`;
}

function formatManagerBlockerContextLine(blocker: ManagerBlocker): string {
  const detail = compactManagerContextText(blocker.detail ?? "", 160);
  return `${blocker.title} (${blocker.severity}, action=${blocker.requiredAction}, owner=${blocker.owner})${
    detail ? ` - ${detail}` : ""
  }`;
}

function formatManagerArtifactContextLine(artifact: ManagerArtifact): string {
  const note = compactManagerContextText(artifact.note ?? "", 120);
  return `${artifact.path} (${artifact.kind}, ${artifact.status}, owner=${artifact.owner})${
    note ? ` - ${note}` : ""
  }`;
}

function formatManagerCommandFlowContextLines(flow: ManagerCommandFlowResponse): string[] {
  const lines = [
    `stage=${flow.readiness.stage}; ready=${flow.readiness.ready ? "yes" : "no"}`,
    `next=${flow.nextAction.kind}: ${flow.nextAction.label}`,
  ];
  if (flow.activeRound) {
    lines.push(
      `active round=${flow.activeRound.id}; title=${flow.activeRound.title}; status=${flow.activeRound.status}; phase=${flow.activeRound.phase}`,
    );
  }
  if (flow.readiness.userCheckRequired) lines.push("user check required");
  lines.push(
    ...flow.wizardEvents
      .slice(0, 3)
      .map(
        (event) =>
          `wizard ${event.impact}: ${event.kind}; action=${event.managerAction}; fields=${event.fields
            .map((field) => field.field)
            .join(", ")}${event.roundId ? `; round=${event.roundId}` : ""}`,
      ),
  );
  lines.push(...flow.readiness.warnings.slice(0, 3).map((warning) => `warning: ${warning}`));
  return lines;
}

function formatManagerProtocolContextLines(protocol: ManagerProtocolState): string[] {
  const presentFiles = protocol.files
    .filter((file) => file.status === "present")
    .map((file) => file.path);
  const lines = [
    `version=${protocol.version}; files=${presentFiles.length ? presentFiles.join(", ") : "none"}`,
  ];
  if (protocol.activeRules.length) {
    lines.push(...protocol.activeRules.slice(0, 4).map((rule) => `rule: ${rule}`));
  }
  if (protocol.latestChange) {
    const change = protocol.latestChange;
    lines.push(
      `latest change: ${change.summary}${
        change.decisionId ? ` (decision ${change.decisionId})` : ""
      }${change.roundId ? ` (round ${change.roundId})` : ""}`,
    );
  }
  return lines;
}

function compactManagerContextText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxLength
    ? `${compact.slice(0, Math.max(0, maxLength - 3))}...`
    : compact;
}

async function runManagerAssistantChat(
  request: ManagerAssistantChatRequest,
  options: SiteAppOptions,
  requestUrl: string,
  contextStores?: ManagerAssistantContextStores,
): Promise<ManagerAssistantChatResponse> {
  const started = Date.now();
  const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
  const apiBaseUrl = managerAssistantApiBaseUrl(options, requestUrl);
  const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
  const cwd = options.managerAssistant?.runner ? repoRoot : workspace.cwd;
  const history = normalizeAssistantHistory(request.history);
  const context = await enrichManagerAssistantContext(request.context, contextStores);
  const runner =
    options.managerAssistant?.runner ??
    ((input: ManagerAssistantRunInput) => runDefaultManagerAssistantCli(input, options));
  const input: ManagerAssistantRunInput = {
    message: request.message.trim(),
    history,
    context,
    cwd,
    repoRoot,
    instructionsPath: workspace.instructionsPath,
    apiBaseUrl,
  };
  if (request.assistantState?.sessionId) input.managerSessionId = request.assistantState.sessionId;
  if (request.assistantState) input.assistantState = request.assistantState;
  const result = await runner(input);
  if (result.sessionId) {
    await writeManagerAssistantConversationState(repoRoot, {
      sessionId: result.sessionId,
      cwd,
    });
  }
  return {
    cwd,
    command: result.command,
    durationMs: Date.now() - started,
    message: {
      id: `assistant_${randomBytes(10).toString("base64url")}`,
      role: "assistant",
      text: result.text,
      createdAt: new Date().toISOString(),
    },
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
  };
}

function streamManagerAssistantChat(
  request: ManagerAssistantChatRequest,
  options: SiteAppOptions,
  requestUrl: string,
  contextStores?: ManagerAssistantContextStores,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ManagerAssistantStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      void (async () => {
        const started = Date.now();
        try {
          emit(
            managerAssistantStatusEvent({
              phase: "preparing",
              tone: "thinking",
              main: "요청 준비 중",
              detail: "선택 컨텍스트 확인",
            }),
          );
          const repoRoot = options.managerAssistant?.cwd ?? process.cwd();
          const apiBaseUrl = managerAssistantApiBaseUrl(options, requestUrl);
          const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
          const cwd = options.managerAssistant?.runner ? repoRoot : workspace.cwd;
          const history = normalizeAssistantHistory(request.history);
          const context = await enrichManagerAssistantContext(request.context, contextStores);
          const input: ManagerAssistantRunInput = {
            message: request.message.trim(),
            history,
            context,
            cwd,
            repoRoot,
            instructionsPath: workspace.instructionsPath,
            apiBaseUrl,
          };
          if (request.assistantState?.sessionId) {
            input.managerSessionId = request.assistantState.sessionId;
          }
          if (request.assistantState) input.assistantState = request.assistantState;
          const runner = options.managerAssistant?.runner;
          const result = runner
            ? await runCustomManagerAssistantRunner(input, runner, emit)
            : await runDefaultManagerAssistantCliStream(input, options, emit);
          if (result.sessionId) {
            await writeManagerAssistantConversationState(repoRoot, {
              sessionId: result.sessionId,
              cwd,
            });
          }
          emit({
            type: "message",
            cwd,
            command: result.command,
            durationMs: Date.now() - started,
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
            message: {
              id: `assistant_${randomBytes(10).toString("base64url")}`,
              role: "assistant",
              text: result.text,
              createdAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          emit({ type: "error", error: errorMessage(error) });
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // The client may already have closed the SSE connection.
            }
          }
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

async function runCustomManagerAssistantRunner(
  input: ManagerAssistantRunInput,
  runner: (input: ManagerAssistantRunInput) => Promise<ManagerAssistantRunResult>,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<ManagerAssistantRunResult> {
  emit(
    managerAssistantStatusEvent({
      phase: "running",
      tone: "thinking",
      main: "Assistant 실행 중",
      detail: "테스트 runner",
    }),
  );
  const result = await runner(input);
  emit(
    managerAssistantStatusEvent({
      phase: "finalizing",
      tone: "thinking",
      main: "결과 정리 중",
    }),
  );
  return result;
}

async function runDefaultManagerAssistantCli(
  input: ManagerAssistantRunInput,
  options: SiteAppOptions,
): Promise<ManagerAssistantRunResult> {
  const assistantOptions = options.managerAssistant;
  const command =
    assistantOptions?.command ?? process.env.DESKRELAY_MANAGER_ASSISTANT_CLI ?? "claude";
  const args = managerAssistantSessionArgs(
    buildManagerAssistantCliArgs(
      command,
      assistantOptions?.args ??
        parseManagerAssistantArgs(process.env.DESKRELAY_MANAGER_ASSISTANT_ARGS),
    ),
    input.managerSessionId,
  );
  const timeoutMs = managerAssistantTimeoutMs(assistantOptions);
  const prompt = buildManagerAssistantPrompt(input);
  const invocation = await prepareManagerAssistantInvocation(command, args, prompt);
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([invocation.command, ...invocation.argv], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: invocation.stdin,
      env: {
        ...process.env,
        ...(options.token ? { DESKRELAY_SITE_TOKEN: options.token } : {}),
        DESKRELAY_MANAGER_API_BASE: input.apiBaseUrl,
        DESKRELAY_MANAGER_ASSISTANT: "1",
        DESKRELAY_MANAGER_ASSISTANT_INSTRUCTIONS: input.instructionsPath,
        DESKRELAY_REPOSITORY_ROOT: input.repoRoot,
      },
    });
  } catch (error) {
    throw new Error(`Could not start manager assistant CLI (${command}): ${errorMessage(error)}`);
  }

  try {
    invocation.writeInput?.(proc);
    const stdout = readManagerAssistantStdout(proc.stdout, () => undefined);
    const stderr = readManagerAssistantStderr(proc.stderr, () => undefined);
    const exitCode = await withTimeout(proc.exited, timeoutMs, () => {
      proc.kill();
    });
    const [stdoutResult, err] = await Promise.all([stdout, stderr]);
    if (exitCode !== 0) {
      throw new Error(
        `Manager assistant CLI exited with code ${exitCode}${err.trim() ? `: ${err.trim()}` : ""}`,
      );
    }
    const finalText = chooseManagerAssistantFinalText(stdoutResult, err);
    if (!finalText.ok) throw new Error(finalText.error);
    return {
      text: finalText.text,
      command: invocation.displayCommand,
      ...(stdoutResult.sessionId ? { sessionId: stdoutResult.sessionId } : {}),
    };
  } finally {
    await invocation.cleanup?.();
  }
}

async function runDefaultManagerAssistantCliStream(
  input: ManagerAssistantRunInput,
  options: SiteAppOptions,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<ManagerAssistantRunResult> {
  const assistantOptions = options.managerAssistant;
  const command =
    assistantOptions?.command ?? process.env.DESKRELAY_MANAGER_ASSISTANT_CLI ?? "claude";
  const baseArgs =
    assistantOptions?.args ??
    parseManagerAssistantArgs(process.env.DESKRELAY_MANAGER_ASSISTANT_ARGS);
  const args = managerAssistantSessionArgs(
    buildManagerAssistantCliArgs(command, baseArgs),
    input.managerSessionId,
  );
  const timeoutMs = managerAssistantTimeoutMs(assistantOptions);
  const prompt = buildManagerAssistantPrompt(input);
  const invocation = await prepareManagerAssistantInvocation(command, args, prompt);
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  emit(
    managerAssistantStatusEvent({
      phase: "running",
      tone: "thinking",
      main: "Claude CLI 시작 중",
      detail: "관리 assistant",
    }),
  );
  try {
    proc = Bun.spawn([invocation.command, ...invocation.argv], {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: invocation.stdin,
      env: {
        ...process.env,
        ...(options.token ? { DESKRELAY_SITE_TOKEN: options.token } : {}),
        DESKRELAY_MANAGER_API_BASE: input.apiBaseUrl,
        DESKRELAY_MANAGER_ASSISTANT: "1",
        DESKRELAY_MANAGER_ASSISTANT_INSTRUCTIONS: input.instructionsPath,
        DESKRELAY_REPOSITORY_ROOT: input.repoRoot,
      },
    });
  } catch (error) {
    throw new Error(`Could not start manager assistant CLI (${command}): ${errorMessage(error)}`);
  }

  try {
    invocation.writeInput?.(proc);
    const stdout = readManagerAssistantStdout(proc.stdout, emit);
    const stderr = readManagerAssistantStderr(proc.stderr, emit);
    const exitCode = await withTimeout(proc.exited, timeoutMs, () => {
      proc.kill();
    });
    const [stdoutResult, stderrText] = await Promise.all([stdout, stderr]);
    if (exitCode !== 0) {
      throw new Error(
        `Manager assistant CLI exited with code ${exitCode}${
          stderrText.trim() ? `: ${stderrText.trim()}` : ""
        }`,
      );
    }
    const finalText = chooseManagerAssistantFinalText(stdoutResult, stderrText);
    if (!finalText.ok) throw new Error(finalText.error);
    emit(
      managerAssistantStatusEvent({
        phase: "finalizing",
        tone: "thinking",
        main: "결과 정리 중",
      }),
    );
    return {
      text: finalText.text,
      command: invocation.displayCommand,
      ...(stdoutResult.sessionId ? { sessionId: stdoutResult.sessionId } : {}),
    };
  } finally {
    await invocation.cleanup?.();
  }
}

interface ManagerAssistantCliInvocation {
  command: string;
  argv: string[];
  stdin: "pipe" | "ignore";
  displayCommand: string;
  writeInput?: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => void;
  cleanup?: () => Promise<void>;
}

async function prepareManagerAssistantInvocation(
  command: string,
  args: string[],
  prompt: string,
): Promise<ManagerAssistantCliInvocation> {
  if (process.platform === "win32" && isDefaultClaudeCommand(command)) {
    const payloadPath = join(
      tmpdir(),
      `deskrelay-manager-payload-${Date.now()}-${randomBytes(6).toString("hex")}.jsonl`,
    );
    const cmdPath = join(
      tmpdir(),
      `deskrelay-manager-${Date.now()}-${randomBytes(6).toString("hex")}.cmd`,
    );
    const argv = managerAssistantStructuredInputArgs(args);
    await writeFile(payloadPath, `${claudeStructuredPromptPayload(prompt)}\n`, "utf8");
    await writeFile(
      cmdPath,
      [
        "@echo off",
        "chcp 65001 >NUL",
        `${[command, ...argv].map(cmdQuote).join(" ")} < ${cmdQuote(payloadPath)}`,
        "exit /b %ERRORLEVEL%",
        "",
      ].join("\r\n"),
      "utf8",
    );
    return {
      command: "cmd.exe",
      argv: ["/d", "/s", "/c", cmdPath],
      stdin: "ignore",
      displayCommand: `${command} ${args.join(" ")}`.trim(),
      cleanup: async () => {
        await Promise.all([
          removeManagerAssistantTempFileBestEffort(payloadPath),
          removeManagerAssistantTempFileBestEffort(cmdPath),
        ]);
      },
    };
  }

  const argv = managerAssistantStructuredInputArgs(args);
  return {
    command,
    argv,
    stdin: "pipe",
    displayCommand: `${command} ${args.join(" ")}`.trim(),
    writeInput: (proc) => writeClaudeStructuredPrompt(proc, prompt),
  };
}

async function removeManagerAssistantTempFileBestEffort(path: string): Promise<void> {
  const retryDelaysMs = [0, 100, 500, 1_500];
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      await rm(path, { force: true });
      return;
    } catch (error) {
      if (!isRetryableTempCleanupError(error)) break;
    }
  }

  const timer = setTimeout(() => {
    void rm(path, { force: true }).catch(() => undefined);
  }, 5_000);
  timer.unref?.();
}

function isRetryableTempCleanupError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDefaultClaudeCommand(command: string): boolean {
  const normalized = command
    .trim()
    .replaceAll("\\", "/")
    .toLowerCase()
    .replace(/^"+|"+$/g, "");
  const basename = normalized.split("/").pop() ?? normalized;
  return basename === "claude" || basename === "claude.cmd" || basename === "claude.exe";
}

function managerAssistantSessionArgs(args: string[], sessionId: string | undefined): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--resume" || arg === "-r" || arg === "--session-id") {
      index += 1;
      continue;
    }
    if (arg === "--continue" || arg === "-c" || arg === "--fork-session") continue;
    if (arg.startsWith("--resume=") || arg.startsWith("--session-id=") || arg.startsWith("-r=")) {
      continue;
    }
    normalized.push(arg);
  }
  if (sessionId?.trim()) normalized.push("--resume", sessionId.trim());
  return normalized;
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildManagerAssistantCliArgs(command: string, args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--output-format") {
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output-format=")) continue;
    normalized.push(arg);
  }
  const printable = managerAssistantPrintArgs(command, normalized);
  if (!printable.includes("--verbose")) printable.push("--verbose");
  printable.push("--output-format", "stream-json");
  return managerAssistantPermissionArgs(managerAssistantWindowsToolSafetyArgs(command, printable));
}

function managerAssistantPrintArgs(command: string, args: string[]): string[] {
  if (!isDefaultClaudeCommand(command) || managerAssistantHasPrintArg(args)) return args;
  return ["-p", ...args];
}

function managerAssistantHasPrintArg(args: string[]): boolean {
  return args.some((arg) => arg === "-p" || arg === "--print" || arg.startsWith("--print="));
}

function managerAssistantWindowsToolSafetyArgs(command: string, args: string[]): string[] {
  if (process.platform !== "win32" || !isDefaultClaudeCommand(command)) return args;
  const normalized: string[] = [];
  let hasBashDisallow = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    normalized.push(arg);
    if (arg === "--disallowedTools" || arg === "--disallowed-tools") {
      const next = args[index + 1];
      if (typeof next === "string" && /\bBash\b/i.test(next)) hasBashDisallow = true;
      continue;
    }
    if (
      (arg.startsWith("--disallowedTools=") || arg.startsWith("--disallowed-tools=")) &&
      /\bBash\b/i.test(arg)
    ) {
      hasBashDisallow = true;
    }
  }
  return hasBashDisallow ? normalized : [...normalized, "--disallowedTools", "Bash"];
}

function managerAssistantStructuredInputArgs(args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--input-format") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--input-format=")) continue;
    normalized.push(arg);
  }
  normalized.push("--input-format", "stream-json");
  return normalized;
}

function writeClaudeStructuredPrompt(
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
  prompt: string,
): void {
  proc.stdin.write(`${claudeStructuredPromptPayload(prompt)}\n`);
  proc.stdin.end();
}

function claudeStructuredPromptPayload(prompt: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  });
}

function managerAssistantPermissionArgs(args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--permission-mode") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--permission-mode=")) continue;
    normalized.push(arg);
  }
  normalized.push("--permission-mode", "bypassPermissions");
  return normalized;
}

function managerAssistantTimeoutMs(options: ManagerAssistantOptions | undefined): number {
  const configured =
    options?.timeoutMs ??
    Number(
      process.env.DESKRELAY_MANAGER_ASSISTANT_TIMEOUT_MS ?? DEFAULT_MANAGER_ASSISTANT_TIMEOUT_MS,
    );
  if (!Number.isFinite(configured)) return DEFAULT_MANAGER_ASSISTANT_TIMEOUT_MS;
  return Math.max(5_000, Math.min(MAX_MANAGER_ASSISTANT_TIMEOUT_MS, Math.floor(configured)));
}

interface ManagerAssistantStdoutResult {
  resultText: string;
  assistantText: string;
  assistantTextAfterToolResult: string;
  rawText: string;
  sessionId: string;
  sawToolUse: boolean;
  sawToolResult: boolean;
  sawSyntheticToolArtifact: boolean;
}

async function readManagerAssistantStdout(
  stream: ReadableStream<Uint8Array>,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<ManagerAssistantStdoutResult> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  let resultText = "";
  let assistantText = "";
  let assistantTextAfterToolResult = "";
  let rawText = "";
  let sessionId = "";
  let sawToolUse = false;
  let sawToolResult = false;
  let sawSyntheticToolArtifact = false;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      rawText += `${trimmed}\n`;
      if (containsManagerAssistantToolTranscriptArtifact(trimmed)) {
        sawSyntheticToolArtifact = true;
      }
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      rawText += `${trimmed}\n`;
      if (containsManagerAssistantToolTranscriptArtifact(trimmed)) {
        sawSyntheticToolArtifact = true;
      }
      return;
    }
    if (typeof parsed.session_id === "string" && parsed.session_id.trim()) {
      sessionId = parsed.session_id.trim();
    }
    emit({ type: "claude_event", event: parsed });
    const status = managerAssistantStatusFromClaudeEvent(parsed);
    if (status) emit(managerAssistantStatusEvent(status));
    const blocks = managerAssistantMessageBlocks(parsed);
    if (blocks.some((block) => block.type === "tool_use")) {
      sawToolUse = true;
    }
    if (parsed.type === "user" && blocks.some((block) => block.type === "tool_result")) {
      sawToolResult = true;
    }
    const result = managerAssistantResultTextFromEvent(parsed);
    if (result) {
      resultText = result;
      if (containsManagerAssistantToolTranscriptArtifact(result)) {
        sawSyntheticToolArtifact = true;
      }
    }
    const text = managerAssistantAssistantTextFromEvent(parsed);
    if (text) {
      assistantText += `${text}\n`;
      if (sawToolResult) assistantTextAfterToolResult += `${text}\n`;
      if (containsManagerAssistantToolTranscriptArtifact(text)) {
        sawSyntheticToolArtifact = true;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      consumeLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  const trailing = `${buffer}${decoder.decode()}`.trim();
  if (trailing) consumeLine(trailing);
  return {
    resultText,
    assistantText,
    assistantTextAfterToolResult,
    rawText,
    sessionId,
    sawToolUse,
    sawToolResult,
    sawSyntheticToolArtifact,
  };
}

async function readManagerAssistantStderr(
  stream: ReadableStream<Uint8Array>,
  emit: (event: ManagerAssistantStreamEvent) => void,
): Promise<string> {
  const text = await new Response(stream).text();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) {
    emit(
      managerAssistantStatusEvent({
        phase: "running",
        tone: "warning",
        main: "CLI 메시지 수신",
        detail: truncateForStatus(firstLine),
      }),
    );
  }
  return text;
}

function chooseManagerAssistantFinalText(
  stdoutResult: ManagerAssistantStdoutResult,
  stderrText: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const resultText = sanitizeManagerAssistantText(stdoutResult.resultText);
  const assistantAfterTool = sanitizeManagerAssistantText(
    stdoutResult.assistantTextAfterToolResult,
  );
  const assistantText = sanitizeManagerAssistantText(stdoutResult.assistantText);
  const rawText = sanitizeManagerAssistantText(stdoutResult.rawText);
  const stderr = sanitizeManagerAssistantText(stderrText);
  const incompleteToolTranscript =
    stdoutResult.sawSyntheticToolArtifact && !stdoutResult.sawToolResult && !assistantAfterTool;

  if (incompleteToolTranscript) {
    return {
      ok: false,
      error:
        "Manager assistant started a tool call but did not complete a final response. Retry the request.",
    };
  }

  if (resultText) return { ok: true, text: resultText };
  if (assistantAfterTool) return { ok: true, text: assistantAfterTool };
  if (!stdoutResult.sawToolUse && assistantText) return { ok: true, text: assistantText };
  if (rawText) return { ok: true, text: rawText };
  if (stderr) return { ok: true, text: stderr };
  return { ok: false, error: "Manager assistant CLI returned no output." };
}

function sanitizeManagerAssistantText(value: string): string {
  const lines = value.replace(/\0/g, "").split(/\r?\n/);
  const sanitized: string[] = [];
  let removedToolTranscriptLine = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (isManagerAssistantToolTranscriptLine(trimmed)) {
      removedToolTranscriptLine = true;
      continue;
    }
    if (removedToolTranscriptLine && /^[A-Z][A-Za-z0-9_-]{0,20}:\s*$/.test(trimmed)) {
      continue;
    }
    sanitized.push(line);
    removedToolTranscriptLine = false;
  }
  return sanitized
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function containsManagerAssistantToolTranscriptArtifact(value: string): boolean {
  return value.split(/\r?\n/).some((line) => isManagerAssistantToolTranscriptLine(line.trim()));
}

function isManagerAssistantToolTranscriptLine(line: string): boolean {
  if (!line.startsWith("[") || !line.endsWith("]")) return false;
  if (!/\b(?:Call|Calls|Calling|Use|Uses|Using)\b/i.test(line)) return false;
  return /(?:->|→)/.test(line) || /\b(?:Bash|Read|Grep|Glob|Edit|Write|Task)\b/i.test(line);
}

function managerAssistantStatusEvent(
  status: ManagerAssistantStreamStatus,
): ManagerAssistantStreamEvent {
  return { type: "status", status };
}

function managerAssistantStatusFromClaudeEvent(
  event: Record<string, unknown>,
): ManagerAssistantStreamStatus | null {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "system") {
    return { phase: "running", tone: "thinking", main: "CLI 초기화 중" };
  }
  if (type === "result") {
    return { phase: "finalizing", tone: "thinking", main: "결과 정리 중" };
  }
  if (type === "assistant") {
    const tool = managerAssistantToolUseFromEvent(event);
    if (tool) {
      return {
        phase: tool.detail?.startsWith("DeskRelay API") ? "api" : "tool",
        tone: "thinking",
        main: tool.detail?.startsWith("DeskRelay API")
          ? "DeskRelay API 호출 중"
          : `도구 실행 중: ${tool.name}`,
        ...(tool.detail ? { detail: tool.detail } : {}),
      };
    }
    const blocks = managerAssistantMessageBlocks(event);
    if (blocks.some((block) => block.type === "thinking")) {
      return { phase: "running", tone: "thinking", main: "판단 중" };
    }
    if (blocks.some((block) => block.type === "text")) {
      return { phase: "running", tone: "thinking", main: "응답 작성 중" };
    }
  }
  if (
    type === "user" &&
    managerAssistantMessageBlocks(event).some((block) => block.type === "tool_result")
  ) {
    return { phase: "running", tone: "thinking", main: "도구 결과 확인 중" };
  }
  return null;
}

function managerAssistantToolUseFromEvent(
  event: Record<string, unknown>,
): { name: string; detail?: string } | null {
  for (const block of managerAssistantMessageBlocks(event)) {
    if (block.type !== "tool_use") continue;
    const name = typeof block.name === "string" && block.name.trim() ? block.name.trim() : "tool";
    const detail = managerAssistantToolDetail(name, block.input);
    return detail ? { name, detail } : { name };
  }
  return null;
}

function managerAssistantMessageBlocks(
  event: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const message = isRecord(event.message) ? event.message : null;
  const content = message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

function managerAssistantToolDetail(name: string, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const command = typeof input.command === "string" ? input.command : "";
  if (!command) return undefined;
  const apiMatch = command.match(/\/api\/[A-Za-z0-9_./:-]+/);
  if (apiMatch) return `DeskRelay API ${apiMatch[0]}`;
  if (name.toLowerCase() === "bash") return "명령 실행";
  return undefined;
}

function managerAssistantResultTextFromEvent(event: Record<string, unknown>): string {
  if (event.type !== "result") return "";
  return typeof event.result === "string" ? event.result : "";
}

function managerAssistantAssistantTextFromEvent(event: Record<string, unknown>): string {
  if (event.type !== "assistant") return "";
  const parts: string[] = [];
  for (const block of managerAssistantMessageBlocks(event)) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function truncateForStatus(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

export function buildManagerAssistantPrompt(input: ManagerAssistantRunInput): string {
  const browserContext = formatManagerAssistantBrowserContext(input.context);
  const asciiSafeRequest = asciiSafeJsonString(input.message);
  const pendingDecision = isShortManagerAssistantReply(input.message)
    ? formatManagerAssistantPendingDecision(input.assistantState?.pendingDecision)
    : "";
  const shortReplyHint = pendingDecision
    ? [
        "## Short Reply Resolution",
        "The current user request is short or ambiguous. Resolve it against the active Claude session first.",
        pendingDecision,
        "Accept numeric, lettered, ordinal, and affirmative replies when they clearly map to the pending decision or the last assistant reply.",
      ].join("\n")
    : "";
  return [
    browserContext ? `## Current Browser Context\n${browserContext}` : "",
    shortReplyHint,
    `## Current User Request\n${input.message}`,
    [
      "## Current User Request ASCII-Safe Copy",
      asciiSafeRequest,
      "If the raw request above appears as question marks, mojibake, or otherwise corrupted, decode this JSON string and use it as the source of truth for intent.",
    ].join("\n"),
    "## Response Requirements\nAnswer only the current user request. Use the active Claude session for conversation memory. Use observed facts for operational claims.",
    [
      "## Role Selection Reminder",
      "- First classify the request intent, then choose the matching role profile from the managed instructions.",
      "- Possible role profiles include status reporter, diagnostician, operator, developer supervisor, session analyst, guide, and safety steward.",
      "- Keep the role internal unless naming it helps the user understand the result.",
      "- If the request blends roles, start with the least risky read-only role, then escalate only when the user's intent requires action.",
      "- For development or orchestration work, do not become the implementer. Supervise `claude-code` worker tasks and verify their outputs.",
      "- If the user says continue, proceed, keep going, or loop, run the managed Autonomous Supervision Loop instead of returning only a plan.",
    ].join("\n"),
    [
      "## Project Context Rule",
      "- For orchestration or project-management work, the Current Browser Context's current project is the primary operating scope.",
      "- If the request is about project flow, read `GET /api/manager/projects/:id/command-flow` before choosing prepare/start/review/direction-change/complete.",
      "- Treat command-flow `wizardEvents` as semantic human intent changes; ignore unsaved wizard typing, but react to high-impact applied events before dispatching more work.",
      "- If a current project id is present, verify it with manager project APIs before destructive or broad mutations.",
      "- If no current project is present and the request needs project scope, create or select a manager project before launching rounds, workers, decisions, blockers, or artifacts.",
      "- If browser-selected cwd/session and current project cwd disagree, inspect first and report the mismatch instead of guessing.",
    ].join("\n"),
    [
      "## Autonomous Loop Reminder",
      "- A loop is real only if you execute observable steps in this turn or create observable manager tasks.",
      "- For launched tasks, observe with `GET /api/manager/tasks/:id/observe`; if still active, continue with `GET /api/manager/tasks/:id/stream`.",
      "- If a step fails, classify the failing layer and try one smallest safe alternate path before reporting blocked.",
      "- Do not say supervision will continue in the background unless an active task id exists.",
    ].join("\n"),
    [
      "## Per-Turn Tool Constraints",
      "- This server is Windows.",
      "- Do not use Bash for DeskRelay manager API calls.",
      "- For simple read-only GET observations, prefer `Set-Location $env:DESKRELAY_REPOSITORY_ROOT; bun run scripts/manager-api.ts batch-get name=/api/path`.",
      "- For JSON mutation or dry-run bodies, prefer `--body-file` to avoid shell quoting failures.",
    ].join("\n"),
    [
      "## Progress Reporting",
      "- For multi-step or multi-round work, write short progress reports with `POST /api/manager/assistant/status`.",
      "- Report at round start, round completion, blocker discovery, and before switching strategy.",
      "- Keep each report short: one current state sentence plus the next action.",
      '- Body shape: `{ "phase": "observing|deciding|acting|verifying|blocked|reporting|done", "level": "info|success|warning|error", "round": "R8", "scope": "orchestration", "message": "...", "detail": "..." }`.',
      "- Use `bun run scripts/manager-api.ts POST /api/manager/assistant/status --body-file <json-file>` from the repository root.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function asciiSafeJsonString(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (char) =>
    char
      .split("")
      .map((part) => `\\u${part.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join(""),
  );
}

function isShortManagerAssistantReply(value: string): boolean {
  const compact = value.trim();
  if (!compact) return false;
  if (compact.length <= 12) return true;
  return /^(응|네|그래|좋아|진행|그걸로|첫|두|세|1번|2번|3번|a|b|c)$/i.test(compact);
}

function formatManagerAssistantPendingDecision(
  pendingDecision: ManagerAssistantStructuredState["pendingDecision"] | undefined,
): string {
  if (!pendingDecision?.options.length) return "";
  const lines: string[] = [];
  lines.push("- pending decision:");
  if (pendingDecision.prompt) lines.push(`  prompt: ${pendingDecision.prompt}`);
  for (const option of pendingDecision.options) {
    lines.push(`  ${option.key}. ${option.label}${option.detail ? ` - ${option.detail}` : ""}`);
  }
  return lines.join("\n");
}

interface ManagerAssistantWorkspace {
  cwd: string;
  instructionsPath: string;
}

async function ensureManagerAssistantWorkspace(
  repoRoot: string,
  apiBaseUrl: string,
): Promise<ManagerAssistantWorkspace> {
  const cwd = join(repoRoot, MANAGER_ASSISTANT_DIR);
  const instructionsPath = join(cwd, MANAGER_ASSISTANT_INSTRUCTIONS_FILE);
  await mkdir(cwd, { recursive: true });
  await chmod(instructionsPath, 0o600).catch(() => undefined);
  await writeFile(
    instructionsPath,
    buildManagedManagerAssistantInstructions({ repoRoot, apiBaseUrl }),
    "utf8",
  );
  await chmod(instructionsPath, 0o444).catch(() => undefined);
  return { cwd, instructionsPath };
}

async function readManagerAssistantConversationState(
  repoRoot: string,
): Promise<ManagerAssistantConversationState> {
  const filePath = join(repoRoot, MANAGER_ASSISTANT_DIR, MANAGER_ASSISTANT_CONVERSATION_FILE);
  const stored = await readStoredManagerAssistantConversationState(filePath);
  return {
    generatedAt: new Date().toISOString(),
    conversationId: MANAGER_ASSISTANT_CONVERSATION_ID,
    ...stored,
  };
}

async function writeManagerAssistantConversationState(
  repoRoot: string,
  input: ManagerAssistantConversationStateInput,
): Promise<ManagerAssistantConversationState> {
  const dir = join(repoRoot, MANAGER_ASSISTANT_DIR);
  const filePath = join(dir, MANAGER_ASSISTANT_CONVERSATION_FILE);
  await mkdir(dir, { recursive: true });
  const current = input.reset ? {} : await readStoredManagerAssistantConversationState(filePath);
  let next: Omit<ManagerAssistantConversationState, "generatedAt"> = {
    conversationId: MANAGER_ASSISTANT_CONVERSATION_ID,
    ...current,
    updatedAt: new Date().toISOString(),
  };
  if (input.sessionId === null) {
    const { sessionId: _sessionId, ...rest } = next;
    next = rest;
  } else if (typeof input.sessionId === "string") {
    const sessionId = input.sessionId.trim();
    if (sessionId) next.sessionId = sessionId.slice(0, 200);
  }
  if (input.cwd === null) {
    const { cwd: _cwd, ...rest } = next;
    next = rest;
  } else if (typeof input.cwd === "string") {
    const cwd = input.cwd.trim();
    if (cwd) next.cwd = cwd.slice(0, 2_000);
  }
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return {
    generatedAt: new Date().toISOString(),
    ...next,
  };
}

async function readStoredManagerAssistantConversationState(
  filePath: string,
): Promise<Partial<Omit<ManagerAssistantConversationState, "generatedAt">>> {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw error;
  }
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) return {};
    const state: Partial<Omit<ManagerAssistantConversationState, "generatedAt">> = {
      conversationId: MANAGER_ASSISTANT_CONVERSATION_ID,
    };
    if (typeof parsed.sessionId === "string" && parsed.sessionId.trim()) {
      state.sessionId = parsed.sessionId.trim().slice(0, 200);
    }
    if (typeof parsed.cwd === "string" && parsed.cwd.trim()) {
      state.cwd = parsed.cwd.trim().slice(0, 2_000);
    }
    if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
      state.updatedAt = parsed.updatedAt.trim();
    }
    return state;
  } catch {
    return {};
  }
}

async function readManagerAssistantStatusReports(
  repoRoot: string,
  limit = MANAGER_ASSISTANT_STATUS_LIMIT,
): Promise<ManagerAssistantStatusReportResponse> {
  const filePath = join(repoRoot, MANAGER_ASSISTANT_DIR, MANAGER_ASSISTANT_STATUS_FILE);
  const reports = await readStoredManagerAssistantStatusReports(filePath);
  const clipped = reports.slice(0, Math.max(1, Math.min(MANAGER_ASSISTANT_STATUS_LIMIT, limit)));
  return {
    generatedAt: new Date().toISOString(),
    reports: clipped,
    ...(clipped[0] ? { latest: clipped[0] } : {}),
  };
}

async function appendManagerAssistantStatusReport(
  repoRoot: string,
  input: ManagerAssistantStatusReportInput,
): Promise<ManagerAssistantStatusReportResponse> {
  const dir = join(repoRoot, MANAGER_ASSISTANT_DIR);
  const filePath = join(dir, MANAGER_ASSISTANT_STATUS_FILE);
  await mkdir(dir, { recursive: true });
  const reports = await readStoredManagerAssistantStatusReports(filePath);
  const now = new Date().toISOString();
  const report: ManagerAssistantStatusReport = {
    id: `report_${randomBytes(10).toString("base64url")}`,
    createdAt: now,
    phase: input.phase ?? "reporting",
    level: input.level ?? "info",
    message: input.message.trim().slice(0, 500),
    ...(input.detail?.trim() ? { detail: input.detail.trim().slice(0, 1_000) } : {}),
    ...(input.round?.trim() ? { round: input.round.trim().slice(0, 40) } : {}),
    ...(input.scope?.trim() ? { scope: input.scope.trim().slice(0, 80) } : {}),
  };
  const next = [report, ...reports].slice(0, MANAGER_ASSISTANT_STATUS_LIMIT);
  await writeFile(filePath, `${JSON.stringify({ reports: next }, null, 2)}\n`, "utf8");
  return {
    generatedAt: now,
    reports: next,
    latest: report,
  };
}

async function readStoredManagerAssistantStatusReports(
  filePath: string,
): Promise<ManagerAssistantStatusReport[]> {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text) as { reports?: unknown } | unknown[];
    const raw = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { reports?: unknown }).reports)
        ? (parsed as { reports: unknown[] }).reports
        : [];
    return raw.filter(isManagerAssistantStatusReport);
  } catch {
    return [];
  }
}

function isManagerAssistantStatusReport(value: unknown): value is ManagerAssistantStatusReport {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    isManagerAssistantStatusPhase(value.phase) &&
    isManagerAssistantStatusLevel(value.level) &&
    typeof value.message === "string"
  );
}

function parseManagerAssistantStatusReportInput(
  value: unknown,
): { ok: true; value: ManagerAssistantStatusReportInput } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message) return { ok: false, error: "message is required" };
  const phase = typeof value.phase === "string" ? value.phase : undefined;
  if (phase !== undefined && !isManagerAssistantStatusPhase(phase)) {
    return { ok: false, error: "invalid phase" };
  }
  const level = typeof value.level === "string" ? value.level : undefined;
  if (level !== undefined && !isManagerAssistantStatusLevel(level)) {
    return { ok: false, error: "invalid level" };
  }
  const input: ManagerAssistantStatusReportInput = { message };
  if (phase) input.phase = phase;
  if (level) input.level = level;
  if (typeof value.detail === "string" && value.detail.trim()) input.detail = value.detail.trim();
  if (typeof value.round === "string" && value.round.trim()) input.round = value.round.trim();
  if (typeof value.scope === "string" && value.scope.trim()) input.scope = value.scope.trim();
  return { ok: true, value: input };
}

function parseManagerAssistantConversationStateInput(
  value: unknown,
): { ok: true; value: ManagerAssistantConversationStateInput } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "body must be an object" };
  const input: ManagerAssistantConversationStateInput = {};
  if (typeof value.reset === "boolean") input.reset = value.reset;
  if (value.sessionId === null) {
    input.sessionId = null;
  } else if (typeof value.sessionId === "string") {
    input.sessionId = value.sessionId.trim();
  } else if (value.sessionId !== undefined) {
    return { ok: false, error: "sessionId must be a string or null" };
  }
  if (value.cwd === null) {
    input.cwd = null;
  } else if (typeof value.cwd === "string") {
    input.cwd = value.cwd.trim();
  } else if (value.cwd !== undefined) {
    return { ok: false, error: "cwd must be a string or null" };
  }
  return { ok: true, value: input };
}

function isManagerAssistantStatusPhase(value: unknown): value is ManagerAssistantStatusReportPhase {
  return (
    value === "observing" ||
    value === "deciding" ||
    value === "acting" ||
    value === "verifying" ||
    value === "blocked" ||
    value === "reporting" ||
    value === "done"
  );
}

function isManagerAssistantStatusLevel(value: unknown): value is ManagerAssistantStatusReportLevel {
  return value === "info" || value === "success" || value === "warning" || value === "error";
}

function buildManagerWorkerList(options: SiteAppOptions): ManagerWorkerListResponse {
  return {
    generatedAt: new Date().toISOString(),
    profiles: buildManagerWorkerProfiles(options),
  };
}

function buildManagerWorkerProfiles(options: SiteAppOptions): ManagerWorkerProfile[] {
  const configured = options.managerWorkers?.length ? options.managerWorkers : undefined;
  const defaultClaudeWorkerCommand = process.env.DESKRELAY_MANAGER_WORKER_CLAUDE_CLI ?? "claude";
  const profiles: ManagerWorkerProfileConfig[] = configured ?? [
    {
      id: "claude-code",
      label: "Claude Code worker",
      description:
        "Runs a separate Claude CLI process for implementation, verification, and repo work.",
      command: defaultClaudeWorkerCommand,
      args: managerAssistantStructuredInputArgs(
        buildManagerAssistantCliArgs(
          defaultClaudeWorkerCommand,
          parseManagerAssistantArgs(process.env.DESKRELAY_MANAGER_WORKER_CLAUDE_ARGS),
        ),
      ),
      checkArgs: ["--version"],
      destructive: true,
      defaultTimeoutMs: 600_000,
      available: true,
      runMode: "stdin" as const,
      roles: ["implementation", "verification", "repo"],
      risk: "destructive" as const,
    },
    {
      id: "powershell",
      label: "PowerShell worker",
      description:
        "Runs server-local PowerShell commands for inspection, repair scripts, and maintenance.",
      command: process.env.DESKRELAY_MANAGER_WORKER_POWERSHELL_CLI ?? "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"],
      checkArgs: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      destructive: true,
      defaultTimeoutMs: 300_000,
      available: true,
      runMode: "argument" as const,
      roles: ["inspection", "maintenance", "scripts"],
      risk: "system" as const,
    },
  ];
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    description: profile.description,
    command: profile.command,
    args: profile.args ?? [],
    checkCommand: profile.checkCommand ?? profile.command,
    checkArgs: profile.checkArgs ?? defaultManagerWorkerCheckArgs(profile.command),
    available: profile.available !== false,
    destructive: profile.destructive !== false,
    defaultTimeoutMs: clampWorkerTimeoutMs(profile.defaultTimeoutMs ?? 600_000),
    runMode: profile.runMode ?? "argument",
    roles: profile.roles ?? [],
    risk: profile.risk ?? (profile.destructive === false ? "read" : "destructive"),
  }));
}

function findManagerWorkerProfile(
  options: SiteAppOptions,
  id: string,
): ManagerWorkerProfile | undefined {
  return buildManagerWorkerProfiles(options).find((profile) => profile.id === id);
}

function defaultManagerWorkerCheckArgs(command: string): string[] {
  const lower = command.toLowerCase();
  if (lower.endsWith("powershell") || lower.endsWith("powershell.exe") || lower.endsWith("pwsh")) {
    return ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"];
  }
  return ["--version"];
}

interface ManagerWorkerParams {
  profile: string;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  sessionId?: string;
}

function parseManagerWorkerParams(
  input: unknown,
): { ok: true; value: ManagerWorkerParams } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "worker params must be an object" };
  const profile =
    typeof input.profile === "string" && input.profile.trim()
      ? input.profile.trim()
      : "claude-code";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "worker prompt is required" };
  if (prompt.length > 40_000) return { ok: false, error: "worker prompt is too long" };
  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;
  const timeoutMs = Number(input.timeoutMs);
  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.trim()
      ? input.sessionId.trim()
      : undefined;
  return {
    ok: true,
    value: {
      profile,
      prompt,
      ...(cwd ? { cwd } : {}),
      ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
  };
}

function resolveManagerWorkerCwd(
  repoRoot: string,
  cwd: string | undefined,
): { ok: true; value: string } | { ok: false; error: string } {
  const root = resolve(repoRoot);
  const candidate = cwd ? (isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd)) : root;
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: `worker cwd must stay inside the server repository: ${root}` };
  }
  return { ok: true, value: candidate };
}

interface ManagerWorkerCliRunInput {
  profile: ManagerWorkerProfile;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  apiBaseUrl: string;
  repoRoot: string;
  token: string | undefined;
  sessionId?: string;
}

interface ManagerWorkerCliRunResult {
  profile: string;
  command: string;
  cwd: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  sessionId?: string;
}

async function runManagerWorkerCli(
  input: ManagerWorkerCliRunInput,
): Promise<ManagerWorkerCliRunResult> {
  const started = Date.now();
  const args = profileUsesClaudeStructuredInput(input.profile)
    ? managerAssistantSessionArgs(input.profile.args, input.sessionId)
    : input.profile.args;
  const argv = input.profile.runMode === "stdin" ? [...args] : [...args, input.prompt];
  const proc = Bun.spawn([input.profile.command, ...argv], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: {
      ...process.env,
      ...(input.token ? { DESKRELAY_SITE_TOKEN: input.token } : {}),
      DESKRELAY_MANAGER_API_BASE: input.apiBaseUrl,
      DESKRELAY_MANAGER_WORKER: "1",
      DESKRELAY_REPOSITORY_ROOT: input.repoRoot,
    },
  });
  if (input.profile.runMode === "stdin") {
    proc.stdin.write(managerWorkerStdinPayload(input.profile, input.prompt));
  }
  proc.stdin.end();
  const stdout = readLimitedText(proc.stdout, 2_000_000);
  const stderr = readLimitedText(proc.stderr, 500_000);
  let timedOut = false;
  const exitCode = await withTimeout(proc.exited, input.timeoutMs, () => {
    timedOut = true;
    proc.kill();
  });
  const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
  const sessionId = extractClaudeSessionIdFromJsonLines(stdoutResult.text);
  return {
    profile: input.profile.id,
    command: managerWorkerCommandPreview(input.profile),
    cwd: input.cwd,
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    stdout: sanitizeManagerAssistantText(stdoutResult.text),
    stderr: sanitizeManagerAssistantText(stderrResult.text),
    stdoutTruncated: stdoutResult.truncated,
    stderrTruncated: stderrResult.truncated,
    ...(sessionId ? { sessionId } : {}),
  };
}

async function checkManagerWorkerProfile(
  profile: ManagerWorkerProfile,
): Promise<ManagerWorkerCheckResult> {
  const started = Date.now();
  const command = profile.checkCommand || profile.command;
  const args = profile.checkArgs.length
    ? profile.checkArgs
    : defaultManagerWorkerCheckArgs(command);
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: process.env,
    });
    const stdout = readLimitedText(proc.stdout, 100_000);
    const stderr = readLimitedText(proc.stderr, 100_000);
    let timedOut = false;
    const exitCode = await withTimeout(proc.exited, 5_000, () => {
      timedOut = true;
      proc.kill();
    });
    const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
    return {
      profile: profile.id,
      command,
      args,
      available: exitCode === 0 && !timedOut,
      exitCode,
      timedOut,
      durationMs: Date.now() - started,
      stdout: sanitizeManagerAssistantText(stdoutResult.text),
      stderr: sanitizeManagerAssistantText(stderrResult.text),
      stdoutTruncated: stdoutResult.truncated,
      stderrTruncated: stderrResult.truncated,
    };
  } catch (error) {
    return {
      profile: profile.id,
      command,
      args,
      available: false,
      timedOut: false,
      durationMs: Date.now() - started,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function managerWorkerCommandPreview(profile: ManagerWorkerProfile): string {
  const promptMarker = profile.runMode === "stdin" ? "<prompt via stdin>" : "<prompt>";
  return `${profile.command} ${[...profile.args, promptMarker].join(" ")}`.trim();
}

function managerWorkerStdinPayload(profile: ManagerWorkerProfile, prompt: string): string {
  return profileUsesClaudeStructuredInput(profile)
    ? `${claudeStructuredPromptPayload(prompt)}\n`
    : prompt;
}

function profileUsesClaudeStructuredInput(profile: Pick<ManagerWorkerProfile, "args">): boolean {
  for (let index = 0; index < profile.args.length; index += 1) {
    const arg = profile.args[index];
    if (arg === "--input-format" && profile.args[index + 1] === "stream-json") return true;
    if (arg === "--input-format=stream-json") return true;
  }
  return false;
}

function extractClaudeSessionIdFromJsonLines(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const sessionId = parsed.session_id ?? parsed.sessionId;
    if (typeof sessionId === "string" && sessionId.trim()) return sessionId.trim();
  }
  return undefined;
}

async function readLimitedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      continue;
    }
    const next = value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(next);
    total += next.byteLength;
    if (next.byteLength < value.byteLength) truncated = true;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const suffix = truncated ? "\n[output truncated]\n" : "";
  return { text: `${new TextDecoder().decode(bytes)}${suffix}`, truncated };
}

function clampWorkerTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) return 600_000;
  return Math.max(5_000, Math.min(1_800_000, Math.floor(value)));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function managerAssistantApiBaseUrl(options: SiteAppOptions, requestUrl: string): string {
  return new URL(options.selfHostUrl ?? requestUrl).origin;
}

function formatRouteCapabilitiesForInstructions(routes: ManagerRouteCapability[]): string[] {
  return routes.map((route) => {
    const destructive = route.destructive ? " destructive" : "";
    return `- \`${route.method} ${route.path}\`${destructive} - ${route.description}`;
  });
}

function buildManagedManagerAssistantInstructions(input: {
  repoRoot: string;
  apiBaseUrl: string;
}): string {
  const routeLines = formatRouteCapabilitiesForInstructions(SITE_ROUTE_CAPABILITIES);
  const behaviorMethodLines = DESKRELAY_BEHAVIOR_METHODS.map((method) => `- \`${method}\``);
  return [
    "# DeskRelay Manager Assistant",
    "",
    "This is a managed instruction file generated by the DeskRelay server.",
    "Do not ask the user to edit this file. The browser instruction editor must not expose it.",
    "",
    "## Role",
    "",
    "- You are the DeskRelay administrator and supervisor assistant.",
    "- You help the user inspect, diagnose, update, repair, and operate this self-host DeskRelay instance.",
    "- You should not merely explain when the user asks for operational help. Understand the intent, inspect the system, act when appropriate, verify the result, and report observed facts.",
    "- Operate generically. Do not rely on hard-coded phrases; classify intent, scope, required context, and available capabilities before choosing a tool.",
    "- You run on the server PC. Treat this as a local developer tool, not a hosted SaaS product.",
    "- Answer in Korean unless the user explicitly asks for another language.",
    "- Do not claim that you ran an API call, command, update, restart, or repair unless you actually did.",
    "- Treat browser-provided history as memory only, not as a transcript to continue.",
    "- Do not output artificial conversation labels such as `User:`, `Assistant:`, `A:`, or `B:` unless the user explicitly asks for that format.",
    "- Separate planned checks from observed facts. A bracketed checklist is not evidence that the check ran.",
    "",
    "## Supervisor Boundary",
    "",
    "- You are a supervisor, not the primary implementer.",
    "- For development, refactor, documentation, protocol, test, or orchestration-framework work, your job is to define the objective, delegate to workers, inspect results, verify evidence, and update the user.",
    "- Do not write the main project artifacts yourself. Do not use PowerShell as your primary authoring tool for implementation or protocol work.",
    "- PowerShell is for inspection, diagnostics, small mechanical checks, fixture setup, and independent verification. It is not a substitute for a worker agent.",
    "- If no suitable worker is available, report the task as blocked instead of silently doing the worker's job yourself.",
    "- If you must make a tiny emergency bookkeeping edit yourself, label it as manager bookkeeping, keep it minimal, and do not count that as worker execution.",
    "",
    "## Development Round Completion Gate",
    "",
    "A development or orchestration round is not complete unless all of these are true:",
    "",
    "1. At least one non-dry-run `claude-code` worker task was launched for the substantive development, documentation, protocol, or test work.",
    "2. The worker prompt contained role, objective, allowed paths, forbidden actions, expected artifacts, and verification criteria.",
    "3. You read the worker task result or logs after completion.",
    "4. You independently verified the resulting files, tests, protocol state, or failure classification.",
    "5. You reported the worker task id(s), observed result, verification evidence, and remaining risk.",
    "",
    "If the work only used your own reasoning, direct file edits, or PowerShell scripts, describe it as supervisor inspection or mechanical verification, not as orchestration success.",
    "",
    "## Manager Project Context",
    "",
    "- For orchestration and project-management work, the selected manager project is the primary operating scope.",
    "- Browser context may include the selected project id, cwd, command-flow stage, next action, active round, open blockers, active decisions, protocol state, and active artifacts. Treat it as a navigation hint, then verify with manager project APIs before mutation.",
    "- For project flow work, read `GET /api/manager/projects/:id/command-flow` first; it is the canonical UX state for draft -> protocol ready -> ready to start -> running -> review -> replanning -> completed.",
    "- `wizardEvents` in command-flow are explicit human-applied intent changes from the wizard. They are signal, not raw UI activity; high-impact events may require replan, pause, or human confirmation before more worker dispatch.",
    "- If no project is selected but the user's request needs project scope, create or select a manager project before launching rounds, workers, decisions, blockers, or artifacts.",
    "- If the selected session/cwd and selected project cwd disagree, inspect and report the mismatch instead of guessing.",
    "",
    "## Common Behavior Contract",
    "",
    "- Always infer intent before choosing tools. The user may ask for status, diagnosis, development, operation, planning, explanation, or cleanup.",
    "- Prefer the smallest useful observation first. Do not read session transcripts, logs, files, or large payloads unless the role and intent need them.",
    "- Treat all operational claims as evidence-backed. State what you observed, where it came from, and what remains uncertain.",
    "- When action is required, act through the narrowest DeskRelay API or worker task that matches the scope.",
    "- Verify every mutation. A successful API response is not enough if a follow-up status read can confirm the visible result.",
    "- Keep the user informed through progress reports during multi-step work, but keep the final answer concise.",
    "- Avoid asking the user to provide IDs, logs, or copied text when selected browser context or manager APIs can retrieve them.",
    "- Ask one concise clarification question only when the missing detail changes the target, safety boundary, or destructive scope.",
    "- Do not claim an autonomous loop is still running after your response ends unless you created an observable manager task that continues outside the response.",
    "",
    "## Role Profiles",
    "",
    "Use exactly one primary profile at a time. You may switch profiles as the task evolves, but report the switch when it matters.",
    "",
    "### Status Reporter",
    "",
    "- Use for: `status`, `what is happening`, `is it connected`, `what changed`, update progress, worker progress.",
    "- Use read-only APIs first: system summary, update status, device list, diagnostics, task list/logs, assistant status reports.",
    "- Do not mutate state. Do not read full session transcripts unless the user asks about a specific conversation.",
    "- Answer with: current state, evidence source, user-visible next action if any.",
    "",
    "### Diagnostician",
    "",
    "- Use for: errors, timeouts, missing devices, stale state, failed registration, failed update, strange assistant behavior.",
    "- Reproduce through APIs where possible. Classify the failure layer: browser, server, connector, daemon, Claude CLI, workspace, network, permission, or repository.",
    "- Prefer structured diagnostics and recent logs over speculation.",
    "- End with a ranked cause list and the smallest safe repair path.",
    "",
    "### Operator",
    "",
    "- Use for: restart, update, repair, re-register, clear cache, remove a device, run a command, apply a known fix.",
    "- Diagnose before mutation unless the user explicitly requests a direct operation and the target is unambiguous.",
    "- Use dry-run where available for broad operations. For destructive operations, require explicit target confirmation unless already provided.",
    "- Verify after action and report success, partial success, or failure with the next safe step.",
    "",
    "### Developer Supervisor",
    "",
    "- Use for: implementation, refactor, tests, documentation, orchestration framework work, multi-agent coordination.",
    "- Create or inspect the plan, define scope, choose worker profiles, delegate substantial execution to `claude-code` workers, then verify outputs yourself.",
    "- Worker prompts must include objective, allowed paths, forbidden actions, expected artifacts, and verification commands.",
    "- Do not directly implement the worker's assigned files. Do not use PowerShell as the main author of implementation, protocol, or documentation artifacts.",
    "- Use PowerShell only to inspect state, run quick checks, create temporary fixtures, or verify worker output.",
    "- Do not close a development round without a non-dry-run `claude-code` worker result unless you explicitly report the round as blocked.",
    "- Maintain project protocols and Markdown coordination files only inside the user's requested workspace, never inside the manager-assistant system folder.",
    "",
    "### Session Analyst",
    "",
    "- Use for: summarize selected conversation, analyze a transcript, inspect an image/session issue, compare messages, continue a selected session.",
    "- Resolve selected device/session/cwd from browser context first. Then read only the needed session content with `POST /api/manager/sessions/read`.",
    "- Do not claim selected context is missing until you checked the browser context and available manager/session APIs.",
    "- Summaries and analysis must be based on retrieved transcript data, not memory guesses.",
    "- For manager session cleanup, first call `GET /api/manager/sessions/hygiene` and treat its `managerCwd` value as a scope hint: it only enumerates the manager-assistant cwd. Hygiene categories never include the current manager conversation. Use `POST /api/manager/sessions/hygiene/cleanup` only for cleanup candidates reported by that API.",
    "- For project orchestration recovery, first call `GET /api/manager/projects/:id/hygiene`. Use `POST /api/manager/projects/:id/hygiene/cleanup` with `dryRun: true` to preview, then run it only for reported candidates; it records deduplicated blockers and never deletes active tasks or runs.",
    "- After any successful cleanup, refresh and verify the new state BEFORE replying to the user: (a) re-call `GET /api/manager/sessions/hygiene` and confirm `cleanupCandidates: 0` for the categories you targeted, (b) call the device behavior `sessions.list` on the active device to catch sessions in other cwds the hygiene policy does not see (e.g. worker transcripts, orphan project slugs), and (c) report deleted / preserved counts plus any residual non-current sessions. Do not declare the cleanup done until both APIs agree with what you intended to remove.",
    "",
    "### Guide",
    "",
    "- Use for: architecture questions, how-to, planning, tradeoff discussion, manual instructions.",
    "- Do not mutate state. Use APIs only if current state would materially change the answer.",
    "- Prefer practical, command-ready guidance. Mention risks and verification steps when relevant.",
    "",
    "### Safety Steward",
    "",
    "- Use whenever a request touches deletion, uninstall, token reset, public exposure, workspace root broadening, security policy, or all-device operations.",
    "- Surface the boundary and blast radius clearly.",
    "- Confirm destructive scope unless the user already named the exact destructive action and target.",
    "- Prefer reversible operations and backup/rollback instructions when available.",
    "",
    "## Orchestration Lab Integration",
    "",
    "If the operator is invoking the manager-assistant from inside an orchestration lab workspace (default known path: C:\\Users\\darkh\\Projects\\orchestration-lab; other paths may exist as long as they contain ORCHESTRATION.md, PROTOCOL.md, AGENTS.md, ARTIFACTS.md, FAILURES.md, STATE.md, TASKS.md, REVIEW.md at top level), the lab's PROTOCOL.md is the PRIMARY contract and this DeskRelay-level guide is SECONDARY. Before any action:",
    "",
    "- Read the lab's `runtime/<latest>/manifest.json` to determine the current `round_id` and `in_flight_round`.",
    "- Read the lab's PROTOCOL.md ## Round Lifecycle and ## Worker Prompt Schema sections.",
    "- New rounds open under `lab/runtime/<round_id>/` with `spec.json` + `pre-snapshot.json` + `audit.log` per the lab contract.",
    "- Worker dispatch goes through the WorkerSpec adapter contract defined in `WORKER-CONTRACT.md`; native `claude-code` is the default adapter post-F2.",
    "- Verification is filesystem-canonical (hash diff vs pre-snapshot, Select-String for verbatim_strings, V08/V09); the round closes only when `verify.json.summary.fail == 0`.",
    "- Session cleanup at round close: call device behavior `sessions.deleteByCwd` for the worker cwd (the lab contract's `sessions.deleteByCwd` round_close rule).",
    "",
    "The lab supersedes this guide on any contradiction. If both apply, lab wins; the manager should log the divergence in the lab's FAILURES.md with `layer=protocol`.",
    "",
    "## Intent First",
    "",
    "Before using any DeskRelay API or local command, infer the user's intent clearly.",
    "Classify the request into one of these categories:",
    "",
    "1. Status inquiry - the user wants to know current state. Use read-only APIs only.",
    "2. Diagnosis - the user reports something broken or suspicious. Use read-only status, diagnostics, logs, and failure analysis APIs first.",
    "3. Repair - the user wants a broken state fixed. Diagnose first, then use the smallest matching repair/update/restart API. Verify after action.",
    "4. Configuration change - the user wants settings, permissions, instructions, workspace roots, cache, or behavior changed. Read current config first, change only the requested scope, then verify.",
    "5. Destructive operation - deletion, uninstall, token reset, broad cleanup, or removal. Ask for confirmation unless the user explicitly requested that exact destructive action.",
    "6. Explanation or planning only - the user asks how, why, what should we do, or asks for a plan. Do not mutate state. Use APIs only if current factual state is needed.",
    "",
    "Use this operating loop:",
    "",
    "```text",
    "Understand Intent -> Choose Scope -> Read State -> Decide -> Act If Needed -> Verify -> Report",
    "```",
    "",
    "Affected scopes are: server, current device, selected device, selected session, browser, repository, or all devices.",
    "",
    "For every request, follow this internal action contract:",
    "",
    "```text",
    "Intent -> Scope -> Needed context -> Read APIs -> Mutation API if any -> Verification -> User-facing result",
    "```",
    "",
    "The browser context is only a reference snapshot. It may contain selected device/session/cwd ids, but it does not contain full session text, logs, files, or command output.",
    "Use lazy reads: read large data only when the user's intent requires that data.",
    "If the user refers to the selected/current conversation, chat, or session, use the browser-provided selected device/session/cwd first. Do not ask the user to paste text or provide IDs when selected context is available.",
    "Read the selected session only for requests that require session content, such as summarize, analyze this conversation, inspect this error, continue this session, or compare messages.",
    "To inspect a selected Claude session, call `POST /api/manager/sessions/read` with the selected `deviceId`, `sessionId`, and `cwd` when present. If `cwd` is absent, the API searches session lists to resolve it.",
    "For device/server/update/registration/security questions, do not read session content unless the user specifically asks about the selected session.",
    "If the intent or scope is ambiguous, ask one concise clarification question before mutating anything.",
    "",
    "## Autonomous Supervision Loop",
    "",
    "When the user asks you to continue, proceed, loop, supervise autonomously, or keep going, run a bounded supervision loop inside the current assistant turn as far as available APIs and task time allow.",
    "",
    "Use this round model:",
    "",
    "```text",
    "R<N>: classify intent -> read state -> choose next task -> launch/delegate if needed -> observe result -> verify -> decide continue/stop",
    "```",
    "",
    "- Start each multi-round operation by posting a progress report with the round id, scope, and immediate next action.",
    "- If a worker or manager task is launched, do not stop at the launch response. Observe it with `GET /api/manager/tasks/:id/observe`, then follow with `GET /api/manager/tasks/:id/stream` if it is still running or waiting.",
    "- If a task fails, classify the failure layer and try the smallest safe alternate path before reporting blocked.",
    "- If a selected remote device is unreachable, switch to a safe reachable scope only when the user request allows it; otherwise report the unreachable device as the blocker.",
    "- Continue rounds until you reach terminal success, a safety boundary that needs explicit confirmation, a repeated blocker with no safe alternate path, or a tool/time limit.",
    "- Do not end with only a plan when the user asked you to proceed and the next safe action is available.",
    "- Do not pretend background supervision continues after the response. If no observable task remains active, report the exact completed/blocked state.",
    "",
    "## Generic Decision Rules",
    "",
    "- Status inquiry: use summary/status/diagnostic read APIs and avoid session reads.",
    "- Selected session work: use `POST /api/manager/sessions/read` with the selected device/session/cwd when available; summarize or analyze from observed events.",
    "- Remote Claude work: inspect target device state and cwd; call the `chat` behavior with `message`, `cwd`, and optional `sessionId` only when the user asked to send work.",
    "- For remote worker prompts where exact generated filenames or commands matter, prefer ASCII-only operational prompts. Answer the DeskRelay user in Korean afterward.",
    "- Configuration change: read current config first, mutate only the requested scope, then re-read.",
    "- Repair/update/restart: diagnose first, run the smallest matching task/API, then verify task and resulting state.",
    "- Non-destructive scaffolding, file listing, file preview, status reads, and creation of requested project files inside the selected allowed workspace do not need another confirmation after the user says to proceed.",
    "- Destructive work: ask for confirmation unless the user explicitly requested the exact deletion/removal target.",
    "- Planning/explanation: do not mutate state unless the user clearly asks you to proceed.",
    "",
    "## Worker Delegation",
    "",
    "- You are the supervisor. Answer questions, choose scope, inspect state, decide whether work is needed, and verify results yourself.",
    "- Delegate substantial implementation, repo edits, test runs, documentation edits, and multi-step repair work to a worker CLI instead of pretending you performed the work inline.",
    "- Use `GET /api/manager/workers` to discover worker profiles.",
    "- Use `GET /api/manager/agents` and `GET /api/manager/rounds` to observe persistent orchestration state.",
    "- Use `POST /api/manager/agents` to create role agents such as architect, protocol, verifier, critic, implementer, or documenter.",
    "- Use `POST /api/manager/rounds` and `POST /api/manager/rounds/:id/dispatch` when the user wants multi-agent orchestration. A real orchestration round should dispatch at least two non-dry-run agents unless it is intentionally blocked.",
    "- Use `POST /api/manager/workers/:id/check` before non-dry-run delegation unless that worker was checked recently in the same task.",
    '- Use `POST /api/manager/workers/run` or `POST /api/manager/tasks` with `kind: "run-worker"` to launch a worker task.',
    "- Worker prompts must include the exact objective, allowed scope, files/modules to touch, forbidden actions, verification commands, and the expected final report.",
    "- Use `dryRun: true` first when you are deciding whether delegation is appropriate. Use `dryRun: false` only after the user asked to proceed or the requested operation clearly implies execution.",
    "- After worker completion, read the task result/logs, verify the changed state yourself, and report observed facts. Do not blindly trust the worker's conclusion.",
    "- For orchestration work, keep the worker prompts focused on execution and verification while you retain protocol judgment, task ordering, failure classification, and user reporting.",
    "",
    "## Result Observation Policy",
    "",
    "- Default to the narrowest observation source that matches the thing you just caused.",
    "- If you just answered directly as the manager assistant, use your current response. Do not read any Claude session transcript.",
    "- If you created a manager task or worker task, observe that task by id with `GET /api/manager/tasks/:id/observe`.",
    "- If the task is still running or waiting, use `GET /api/manager/tasks/:id/stream` to follow that task until it changes or completes.",
    "- Use `GET /api/manager/tasks/:id/logs` only when the observation summary is insufficient, failed, or blocked.",
    "- Use `POST /api/manager/sessions/read` only when the user asks about a selected/explicit Claude conversation, transcript, message history, image in a conversation, or when debugging session storage itself.",
    "- Do not read broad conversation transcripts to find the answer to your own manager task. Task observation is the primary source for work you launched.",
    "- For tasks you launched, prefer task observation over re-reading manager chat history. Use session transcript APIs only when the subject is a Claude conversation, not the manager's own work queue.",
    "- If observation reports `running`, `waiting`, or an incomplete result, continue observation before summarizing unless the user asked only for a snapshot.",
    "",
    "## Failure Escalation Policy",
    "",
    "Every failure report must classify the failing layer before recommending action.",
    "",
    "Use these layers:",
    "",
    "```text",
    "browser -> server -> registry -> connector -> daemon -> Claude CLI -> worker CLI -> workspace -> permission -> network -> repository",
    "```",
    "",
    "- Record the evidence source: API route, task id, diagnostic field, process status, log path, or worker report.",
    "- Decide whether the failure is retryable, needs repair, needs user confirmation, or is a hard blocker.",
    "- Prefer one smallest safe retry or alternate path before asking the user to intervene.",
    "- If a repair is available through a manager API, use that API instead of giving manual commands.",
    "- If the user cannot act on a detail, keep it out of the user-facing answer and keep it as internal diagnostic evidence.",
    "- If the same failure repeats after a safe retry, stop the loop and report the repeated evidence instead of looping blindly.",
    "",
    "## Progress Reports",
    "",
    "- For long-running, multi-step, or multi-round work, post concise progress reports so the browser can show the user what is happening.",
    "- Use `POST /api/manager/assistant/status` at round start, after launching a task, after observing a terminal task result, at round completion, at blocker discovery, and before changing strategy.",
    "- Keep reports short: one current state sentence and, when useful, one next action.",
    "- Valid phases: observing, deciding, acting, verifying, blocked, reporting, done.",
    "- Valid levels: info, success, warning, error.",
    "- Example body:",
    "",
    "```json",
    '{ "phase": "acting", "level": "info", "round": "R3", "scope": "orchestration", "message": "Worker A is writing the protocol draft.", "detail": "Next: verify output and update FAILURES.md." }',
    "```",
    "",
    "## Local Context",
    "",
    `- Repository root: ${input.repoRoot}`,
    `- Manager API base URL: ${input.apiBaseUrl}`,
    "- Site token is available only as the `DESKRELAY_SITE_TOKEN` environment variable.",
    "- Manager API base URL is also available as `DESKRELAY_MANAGER_API_BASE`.",
    "- Repository root is also available as `DESKRELAY_REPOSITORY_ROOT`.",
    "- Manager filesystem scope is `unrestricted`; it is also available as `DESKRELAY_MANAGER_WORKSPACE_SCOPE`.",
    "",
    "## API Usage",
    "",
    "Do not call APIs reflexively. Use an API only when it helps satisfy the identified intent.",
    "For every API call, know what question it answers, whether it is read-only or mutating, which scope it affects, and what result would change the next action.",
    "Use the DeskRelay HTTP API for operational facts instead of guessing.",
    "For authenticated `/api/*` calls, send `Authorization: Bearer $DESKRELAY_SITE_TOKEN` when the token exists.",
    "`GET /api/capabilities` is the live source of truth for route and behavior-method discovery.",
    "When behavior methods or route shapes are uncertain, discover capabilities before calling them.",
    "- Prefer the repository helper for DeskRelay API calls: `bun run scripts/manager-api.ts GET /api/manager/system/summary` from the repository root.",
    "- For multiple simple read-only GET checks, do not launch parallel shell tool calls. Use `bun run scripts/manager-api.ts batch-get summary=/api/manager/system/summary workers=/api/manager/workers` so one failed request is returned as a structured result instead of cancelling the whole observation.",
    "- For complex batches that need methods, bodies, or query strings, use `bun run scripts/manager-api.ts batch --file <requests.json>` or `bun run scripts/manager-api.ts batch --requests '<json-array>'`.",
    "- For POST, PUT, PATCH, or DELETE calls with JSON bodies, prefer `--body-file <request.json>` over inline shell JSON when quoting is not trivial.",
    "- The manager API helper reads `DESKRELAY_MANAGER_API_BASE` and `DESKRELAY_SITE_TOKEN` from the environment. Do not manually assemble Authorization headers in Bash or PowerShell unless the helper cannot satisfy the task.",
    "- Do not treat a device registry `connectionState: online` value as proof that the server can reach that connector. For operational decisions, confirm with `/api/devices/:id/doctor`, `/process/status`, or the specific API needed for the task.",
    '- The manager is not constrained by the user\'s configured workspace roots. For manager-owned filesystem inspection, call `/api/devices/:id/fs/list?workspaceScope=unrestricted&includeFiles=1`. For manager-owned directory creation, include `{ "workspaceScope": "unrestricted" }` in `/api/devices/:id/fs/mkdir` bodies. For manager-owned file preview, call `/api/devices/:id/files/preview?workspaceScope=unrestricted` with the path and optional cwd query params.',
    "When verifying generated files, call `/api/devices/:id/fs/list?workspaceScope=unrestricted&includeFiles=1` for the target directory. The default list is directory-only for the cwd picker.",
    "Use `/api/devices/:id/files/preview?workspaceScope=unrestricted` for manager-owned guarded image or UTF-8 text/Markdown previews. If a file type is unsupported, report that limitation rather than claiming the file was read.",
    "Avoid calling `POST /api/manager/assistant/chat` or `POST /api/manager/assistant/chat/stream` from inside the assistant unless you are deliberately testing the assistant endpoint.",
    "",
    "## Tool and Shell Policy",
    "",
    "- The server PC is Windows. Prefer PowerShell for local commands and HTTP calls.",
    "- For DeskRelay API calls, use `bun run scripts/manager-api.ts ...` before considering raw shell HTTP commands.",
    "- Do not use Bash for `scripts/manager-api.ts` calls on Windows. Run the helper from the repository root with PowerShell semantics.",
    "- Do not use parallel tool calls for shell commands that call DeskRelay APIs, build auth headers, create temp files, mutate state, or depend on shared process state.",
    "- Parallel observation is allowed only through a helper or API that preserves each result independently, such as `manager-api.ts batch`.",
    "- Do not put PowerShell syntax inside Bash. If a command uses `$env:`, hashtables, `Invoke-RestMethod`, or `ConvertTo-Json`, it must run in PowerShell.",
    "- Use Bash only when the command is explicitly shell-portable or a Unix shell is actually required.",
    "- For code/text search in this project, use PowerShell `Select-String` or targeted file reads. Do not rely on `rg`.",
    "- Prefer `Invoke-RestMethod` for JSON APIs and `Invoke-WebRequest` for previews or non-JSON responses.",
    "- If a command fails, do not blindly retry in another shell. Classify the failure first and report the command, endpoint, status, and likely cause.",
    "",
    "PowerShell example:",
    "",
    "```powershell",
    "$headers = @{}",
    'if ($env:DESKRELAY_SITE_TOKEN) { $headers.Authorization = "Bearer $env:DESKRELAY_SITE_TOKEN" }',
    'Invoke-RestMethod -Headers $headers "$env:DESKRELAY_MANAGER_API_BASE/api/manager/system/summary"',
    "```",
    "",
    "## Full HTTP API Surface",
    "",
    ...routeLines,
    "",
    "## Device Behavior Methods",
    "",
    "Call these through `POST /api/devices/:id/behaviors/:instance/request` with `{ method, params }`.",
    "The standard Claude behavior instance is usually `remote-claude`, but inspect `/api/devices/:id/behaviors` first.",
    "",
    ...behaviorMethodLines,
    "",
    "Common payload examples:",
    "",
    "```json",
    '{ "method": "sessions.list", "params": {} }',
    '{ "method": "sessions.read", "params": { "sessionId": "..." } }',
    '{ "method": "chat", "params": { "message": "...", "cwd": "..." } }',
    '{ "method": "chat", "params": { "message": "...", "cwd": "...", "sessionId": "..." } }',
    '{ "method": "interrupt", "params": {} }',
    '{ "method": "permissions.inspect", "params": { "cwd": "..." } }',
    '{ "method": "permissions.update", "params": { "mode": "auto" } }',
    "```",
    "",
    "## Write/Task APIs",
    "",
    "- Prefer `dryRun: true` first for manager task shortcuts when available.",
    "- Ask the user before destructive or disruptive actions unless the user already gave explicit instruction.",
    "- Do not ask again after a short reply that clearly resolves a pending decision, such as `go`, `진행`, `해`, `1`, `A`, or a named option.",
    "- If the user explicitly requested the exact mutating action, perform the smallest matching API call and verify afterward.",
    '- Manager task body: `{ "kind": "diagnose|update-server|update-device|update-all|restart-server|restart-device|repair-registration|run-worker", "targetId": "optional-device-id", "dryRun": true, "requestedBy": "manager-assistant", "params": {} }`.',
    '- Shortcut task bodies accept `{ "dryRun": true, "requestedBy": "manager-assistant" }` when supported.',
    '- Worker run body: `{ "profile": "claude-code", "prompt": "objective/scope/verification", "cwd": ".", "timeoutMs": 600000, "dryRun": false, "requestedBy": "manager-assistant" }`.',
    '- Agent body: `{ "role": "architect|implementer|verifier|critic|protocol|documenter", "profile": "claude-code", "cwd": "optional", "instruction": "optional" }`.',
    '- Round dispatch body: `{ "dryRun": false, "assignments": [{ "role": "architect", "profile": "claude-code", "prompt": "role-specific objective", "cwd": "." }] }`.',
    "",
    "## Safety Rules",
    "",
    "- Never print full Site tokens or daemon tokens in the answer.",
    "- If an API response contains a token-bearing registration or cleanup command, do not paste that command back into chat. Say that the command is available in the UI or command file, and redact token values as `[redacted]` in any diagnostic summary.",
    "- Do not expose connector daemon tokens; `/api/devices` intentionally omits them.",
    "- Summarize large logs; quote only the relevant lines.",
    "- If a command or API call fails, report the failing endpoint/command and the exact status or error.",
    "- When the user asks for status, use read APIs first and answer from observed data.",
    "- When the user asks for a repair/update, inspect current state, explain the intended action, then run the smallest matching API.",
    "- For destructive actions, report the exact target before acting and never broaden the target on your own.",
    "- After any mutation, re-read the relevant state and report whether the system actually changed.",
    "",
  ].join("\n");
}

function parseManagerAssistantArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return ["-p"];
  return raw
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(`Manager assistant CLI timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cancelManagerTask(
  task: ManagerTask,
  store: ManagerTaskStore,
  queue: DeviceUpdateQueueStore | undefined,
): Promise<{ ok: true; task: ManagerTask } | { ok: false; task: ManagerTask; error: string }> {
  const cancellable =
    task.state === "pending" ||
    task.state === "running" ||
    (task.state === "waiting_for_device" &&
      task.kind === "update-device" &&
      Boolean(task.targetId));
  if (!cancellable) {
    return {
      ok: false,
      task,
      error: `Task is already ${task.state}.`,
    };
  }
  if (task.state === "waiting_for_device" && task.targetId) {
    await queue?.remove(task.targetId).catch(() => undefined);
  }
  const updated =
    (await store.update(task.id, {
      state: "cancelled",
      completedAt: new Date().toISOString(),
      steps: [
        ...task.steps,
        taskStep({
          id: "task.cancelled",
          label: "Task cancelled",
          status: "skipped",
          summary: "Task was cancelled by request.",
        }),
      ],
    })) ?? task;
  return { ok: true, task: updated };
}

function buildRetryManagerTaskRequest(
  task: ManagerTask,
): { ok: true; value: ManagerTaskRequest } | { ok: false; error: string } {
  if (task.state === "pending" || task.state === "running") {
    return { ok: false, error: `cannot retry a ${task.state} task` };
  }
  if (task.state === "succeeded") {
    return { ok: false, error: "cannot retry a succeeded task" };
  }
  return {
    ok: true,
    value: {
      kind: task.kind,
      ...(task.projectId ? { projectId: task.projectId } : {}),
      ...(task.targetId ? { targetId: task.targetId } : {}),
      ...(task.params ? { params: task.params } : {}),
      dryRun: task.dryRun,
      requestedBy: "manager-assistant",
    },
  };
}

async function runManagerTask(input: ManagerTaskRunInput): Promise<ManagerTask> {
  const startedAt = new Date().toISOString();
  const started = await input.store.update(input.task.id, {
    state: "running",
    startedAt,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "task.running",
        label: "Task running",
        status: "running",
        summary: "Task execution started.",
      }),
    ],
  });
  const task = started ?? input.task;
  try {
    const execution = await executeManagerTask({ ...input, task });
    return (
      (await input.store.update(task.id, {
        state: execution.state,
        ...(execution.targetLabel ? { targetLabel: execution.targetLabel } : {}),
        ...(execution.state !== "running" ? { completedAt: new Date().toISOString() } : {}),
        steps: execution.steps,
        ...(execution.result !== undefined ? { result: execution.result } : {}),
        ...(execution.error ? { error: execution.error } : {}),
      })) ?? task
    );
  } catch (err) {
    return (
      (await input.store.update(task.id, {
        state: "failed",
        completedAt: new Date().toISOString(),
        error: (err as Error).message,
        steps: [
          ...task.steps,
          taskStep({
            id: "task.failed",
            label: "Task failed",
            status: "failed",
            summary: (err as Error).message,
          }),
        ],
      })) ?? task
    );
  }
}

async function executeManagerTask(input: ManagerTaskRunInput): Promise<ManagerTaskExecutionResult> {
  switch (input.request.kind) {
    case "diagnose":
      return await executeDiagnoseTask(input);
    case "update-server":
      return await executeUpdateServerTask(input);
    case "update-device":
      return await executeUpdateDeviceTask(input);
    case "update-all":
      return await executeUpdateAllTask(input);
    case "restart-server":
      return await executeRestartServerTask(input);
    case "restart-device":
      return await executeRestartDeviceTask(input);
    case "repair-registration":
      return await executeRepairRegistrationTask(input);
    case "run-worker":
      return await executeRunWorkerTask(input);
  }
}

async function executeDiagnoseTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const urls = getAccessUrls(input.options.selfHostUrl ?? input.requestUrl);
  const reports = [
    await buildServerDiagnosticReport({
      fetchImpl: input.fetchImpl,
      registry: input.registry,
      token: input.options.token,
      localToken: input.localToken,
      build: input.build,
      urls,
    }),
  ];
  for (const device of input.registry.list()) {
    reports.push(
      await buildDeviceDiagnosticReport({
        fetchImpl: input.fetchImpl,
        registry: input.registry,
        device,
        localToken: input.localToken,
        serverBuild: input.build,
      }),
    );
  }
  const diagnosticSteps = reports.flatMap((report) => report.steps ?? []);
  return {
    state: "succeeded",
    steps: [
      ...input.task.steps,
      taskStep({
        id: "diagnose.completed",
        label: "Diagnostics completed",
        status: "ok",
        summary: `Collected diagnostics for server and ${Math.max(0, reports.length - 1)} device(s).`,
      }),
      ...diagnosticSteps,
    ],
    result: { reports },
  };
}

async function executeUpdateServerTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  if (input.request.dryRun !== false) {
    return dryRunTask(input, "server.update.plan", "Server update would be requested.");
  }
  if (!input.options.selfServerUpdater) {
    return blockedTask(
      input,
      "server.update.unconfigured",
      "Self server updater is not configured.",
    );
  }
  const status = await input.options.selfServerUpdater.status().catch((err) => ({
    state: "failed",
    error: (err as Error).message,
  }));
  if (status.state === "running") {
    return blockedTask(input, "server.update.already-running", "Server update is already running.");
  }
  const result = await input.options.selfServerUpdater.update();
  const state = result.started
    ? "running"
    : result.status?.state === "failed"
      ? "failed"
      : result.supported
        ? "failed"
        : "blocked";
  return {
    state,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "server.update.requested",
        label: "Server update",
        status: result.started ? "running" : result.supported ? "failed" : "failed",
        summary: result.started
          ? "Server update process started."
          : result.error || "Server update could not be started.",
      }),
    ],
    result,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function executeUpdateDeviceTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const device = resolveManagerTargetDevice(input);
  if (!device.ok) return device.result;
  if (input.request.dryRun !== false) {
    return dryRunTask(
      input,
      "device.update.plan",
      `Connector update would be requested for ${device.value.label}.`,
      device.value.label,
    );
  }
  const response = await requestDaemonSystemUpdate(
    input.fetchImpl,
    device.value,
    daemonToken(device.value, input.localToken),
    buildFallbackRegisterCommandForRequest(input.options, input.requestUrl),
    input.options.deviceUpdateQueue,
    resolveServerUpdateBranch(input.options),
  );
  const payload = await readJsonResponse(response);
  const state = stateFromDeviceUpdateResponse(response.status, payload);
  const summary =
    updateSummaryFromPayload(payload) ?? `Device update returned HTTP ${response.status}.`;
  return {
    state,
    targetLabel: device.value.label,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "device.update.requested",
        label: "Device update",
        status:
          state === "failed"
            ? "failed"
            : state === "waiting_for_device"
              ? "pending"
              : state === "running"
                ? "running"
                : "ok",
        summary,
      }),
    ],
    result: payload,
    ...(state === "failed" ? { error: summary } : {}),
  };
}

async function executeUpdateAllTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  if (input.request.dryRun !== false) {
    const plan = await buildManagerUpdatePlan({
      options: input.options,
      registry: input.registry,
      build: input.build,
      fetchImpl: input.fetchImpl,
      localToken: input.localToken,
    });
    return {
      state: "succeeded",
      steps: [
        ...input.task.steps,
        taskStep({
          id: "update-all.plan",
          label: "Update plan",
          status: "ok",
          summary: `Update plan contains ${plan.items.length} item(s).`,
        }),
      ],
      result: plan,
    };
  }

  const results: unknown[] = [];
  const steps = [...input.task.steps];
  for (const device of input.registry.list()) {
    const deviceResult = await executeUpdateDeviceTask({
      ...input,
      request: { ...input.request, kind: "update-device", targetId: device.id, dryRun: false },
    });
    results.push(deviceResult.result);
    steps.push(...deviceResult.steps.slice(input.task.steps.length));
  }

  const serverResult = await executeUpdateServerTask({
    ...input,
    request: { ...input.request, kind: "update-server", dryRun: false },
  });
  results.push(serverResult.result);
  steps.push(...serverResult.steps.slice(input.task.steps.length));

  const states = steps.filter((step) => step.id !== "task.created").map((step) => step.status);
  const state: ManagerTaskState = states.includes("failed")
    ? "failed"
    : states.includes("pending")
      ? "waiting_for_device"
      : states.includes("running")
        ? "running"
        : "succeeded";
  return {
    state,
    steps,
    result: { results },
    ...(state === "failed" ? { error: "One or more update steps failed." } : {}),
  };
}

async function executeRestartServerTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  if (input.request.dryRun !== false) {
    return dryRunTask(input, "server.restart.plan", "Server restart would be requested.");
  }
  if (!input.options.selfServerProcess) {
    return blockedTask(
      input,
      "server.restart.unconfigured",
      "Self server restart is not configured.",
    );
  }
  const result = await input.options.selfServerProcess.restart();
  return {
    state: result.accepted ? "succeeded" : "blocked",
    steps: [
      ...input.task.steps,
      taskStep({
        id: "server.restart.requested",
        label: "Server restart",
        status: result.accepted ? "ok" : "failed",
        summary: result.message,
      }),
    ],
    result,
    ...(result.error ? { error: result.error } : {}),
  };
}

async function executeRestartDeviceTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const device = resolveManagerTargetDevice(input);
  if (!device.ok) return device.result;
  if (input.request.dryRun !== false) {
    return dryRunTask(
      input,
      "device.restart.plan",
      `Connector restart would be requested for ${device.value.label}.`,
      device.value.label,
    );
  }
  const response = await proxyJson(
    input.fetchImpl,
    "POST",
    `${device.value.daemonUrl}/process/restart`,
    undefined,
    daemonToken(device.value, input.localToken),
  );
  const payload = await readJsonResponse(response);
  const accepted = response.status === 202 || (isRecord(payload) && payload.accepted === true);
  const summary =
    isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `Restart returned HTTP ${response.status}.`;
  return {
    state: accepted ? "succeeded" : response.ok ? "blocked" : "failed",
    targetLabel: device.value.label,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "device.restart.requested",
        label: "Device restart",
        status: accepted ? "ok" : "failed",
        summary,
      }),
    ],
    result: payload,
    ...(!accepted ? { error: summary } : {}),
  };
}

async function executeRepairRegistrationTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const analysis = await analyzeLastRegistrationFailure(input.options.installReportStore);
  if (!analysis.found) {
    return blockedTask(
      input,
      "registration.no-failure",
      "No failed registration report was found.",
    );
  }
  if (input.request.dryRun !== false) {
    return {
      state: "succeeded",
      steps: [
        ...input.task.steps,
        taskStep({
          id: "registration.analysis",
          label: "Registration failure analysis",
          status: analysis.retrySafe ? "warn" : "failed",
          summary: analysis.classification ?? "Registration failure classified.",
          ...(analysis.action ? { action: analysis.action } : {}),
        }),
      ],
      result: analysis,
    };
  }
  return {
    state: "blocked",
    steps: [
      ...input.task.steps,
      taskStep({
        id: "registration.repair.blocked",
        label: "Registration repair",
        status: "failed",
        summary:
          "Automatic registration repair is not enabled yet. Use the suggested action from the analysis.",
        ...(analysis.action ? { action: analysis.action } : {}),
      }),
    ],
    result: analysis,
    error: "automatic registration repair is not implemented",
  };
}

async function executeRunWorkerTask(
  input: ManagerTaskRunInput,
): Promise<ManagerTaskExecutionResult> {
  const params = parseManagerWorkerParams(input.request.params);
  if (!params.ok) return blockedTask(input, "worker.params.invalid", params.error);

  const profiles = buildManagerWorkerProfiles(input.options);
  const profile = profiles.find((item) => item.id === params.value.profile);
  if (!profile) {
    return blockedTask(
      input,
      "worker.profile.unknown",
      `Unknown worker profile: ${params.value.profile}.`,
    );
  }
  if (!profile.available) {
    return blockedTask(
      input,
      "worker.profile.unavailable",
      `Worker profile is unavailable: ${profile.id}.`,
    );
  }

  const cwd = resolveManagerWorkerCwd(
    input.options.managerAssistant?.cwd ?? process.cwd(),
    params.value.cwd,
  );
  if (!cwd.ok) return blockedTask(input, "worker.cwd.invalid", cwd.error);

  const commandPreview = managerWorkerCommandPreview(profile);
  if (input.request.dryRun !== false) {
    return {
      state: "succeeded",
      targetLabel: profile.label,
      steps: [
        ...input.task.steps,
        taskStep({
          id: "worker.plan",
          label: "Worker planned",
          status: "ok",
          summary: `${profile.label} would run in ${cwd.value}.`,
          evidence: [commandPreview],
        }),
      ],
      result: {
        dryRun: true,
        profile: profile.id,
        cwd: cwd.value,
        command: commandPreview,
        promptPreview: truncateText(params.value.prompt, 500),
      },
    };
  }

  const check = await checkManagerWorkerProfile(profile);
  if (!check.available) {
    return {
      state: "blocked",
      targetLabel: profile.label,
      steps: [
        ...input.task.steps,
        taskStep({
          id: "worker.check.failed",
          label: "Worker unavailable",
          status: "failed",
          summary:
            check.error ??
            (check.timedOut
              ? `${profile.label} did not respond to its check command.`
              : `${profile.label} check exited with code ${check.exitCode ?? "unknown"}.`),
          evidence: [
            `${check.command} ${check.args.join(" ")}`.trim(),
            ...(check.stderr ? [truncateText(check.stderr, 500)] : []),
          ],
        }),
      ],
      result: check,
      error:
        check.error ??
        (check.timedOut
          ? `${profile.label} check timed out.`
          : `${profile.label} is not available.`),
    };
  }

  const timeoutMs = clampWorkerTimeoutMs(params.value.timeoutMs ?? profile.defaultTimeoutMs);
  const started = Date.now();
  const result = await runManagerWorkerCli({
    profile,
    prompt: params.value.prompt,
    cwd: cwd.value,
    timeoutMs,
    apiBaseUrl: managerAssistantApiBaseUrl(input.options, input.requestUrl),
    repoRoot: input.options.managerAssistant?.cwd ?? process.cwd(),
    token: input.options.token,
    ...(params.value.sessionId ? { sessionId: params.value.sessionId } : {}),
  });
  const succeeded = result.exitCode === 0 && !result.timedOut;
  const summary = result.timedOut
    ? `${profile.label} timed out after ${timeoutMs}ms.`
    : succeeded
      ? `${profile.label} completed in ${Date.now() - started}ms.`
      : `${profile.label} exited with code ${result.exitCode}.`;
  return {
    state: succeeded ? "succeeded" : "failed",
    targetLabel: profile.label,
    steps: [
      ...input.task.steps,
      taskStep({
        id: "worker.completed",
        label: "Worker CLI",
        status: succeeded ? "ok" : "failed",
        summary,
        evidence: [commandPreview, `cwd: ${cwd.value}`],
      }),
    ],
    result,
    ...(!succeeded ? { error: summary } : {}),
  };
}

function dryRunTask(
  input: ManagerTaskRunInput,
  id: string,
  summary: string,
  targetLabel?: string,
): ManagerTaskExecutionResult {
  return {
    state: "succeeded",
    ...(targetLabel ? { targetLabel } : {}),
    steps: [
      ...input.task.steps,
      taskStep({
        id,
        label: "Dry run",
        status: "ok",
        summary,
      }),
    ],
    result: { dryRun: true },
  };
}

function blockedTask(
  input: ManagerTaskRunInput,
  id: string,
  summary: string,
): ManagerTaskExecutionResult {
  return {
    state: "blocked",
    steps: [
      ...input.task.steps,
      taskStep({
        id,
        label: "Blocked",
        status: "failed",
        summary,
      }),
    ],
    error: summary,
  };
}

function resolveManagerTargetDevice(
  input: ManagerTaskRunInput,
): { ok: true; value: Device } | { ok: false; result: ManagerTaskExecutionResult } {
  const targetId = input.request.targetId;
  if (!targetId) {
    return {
      ok: false,
      result: blockedTask(input, "device.target.missing", "targetId is required for this task."),
    };
  }
  const device = input.registry.get(targetId);
  if (!device) {
    return {
      ok: false,
      result: blockedTask(input, "device.target.unknown", `unknown device: ${targetId}`),
    };
  }
  return { ok: true, value: device };
}

async function buildManagerUpdatePlan(input: {
  options: SiteAppOptions;
  registry: DeviceRegistry;
  build: DeskRelayBuildInfo;
  fetchImpl?: NonNullable<SiteAppOptions["fetchImpl"]>;
  localToken?: string | undefined;
  probeDevices?: boolean;
}): Promise<ManagerUpdatePlan> {
  const generatedAt = new Date().toISOString();
  const items: ManagerUpdatePlan["items"] = [];
  const serverUpdate = input.options.selfServerUpdater
    ? await input.options.selfServerUpdater.status().catch((err) => ({
        state: "failed",
        error: (err as Error).message,
      }))
    : undefined;
  const serverUpdateAvailable =
    isRecord(serverUpdate) &&
    "updateAvailable" in serverUpdate &&
    serverUpdate.updateAvailable === true;
  const serverUpdateState =
    isRecord(serverUpdate) && typeof serverUpdate.state === "string"
      ? serverUpdate.state
      : undefined;
  items.push({
    scope: "server",
    targetLabel: "DeskRelay server",
    action: serverUpdate
      ? serverUpdateState === "running"
        ? "blocked"
        : serverUpdateAvailable
          ? "update"
          : "none"
      : "unknown",
    ...(serverUpdateState ? { state: serverUpdateState } : {}),
    reason: serverUpdate
      ? serverUpdateState === "running"
        ? "Server update is already running."
        : serverUpdateAvailable
          ? "Remote update is available."
          : "No server update is currently reported."
      : "Server updater is not configured.",
  });

  const queueEntries = input.options.deviceUpdateQueue
    ? await input.options.deviceUpdateQueue.list().catch(() => [])
    : [];
  for (const device of input.registry.list()) {
    const queued = queueEntries.find((entry) => entry.deviceId === device.id);
    if (input.probeDevices === false) {
      items.push(managerUpdatePlanItemWithoutDeviceProbe(device, queued));
      continue;
    }
    const installStatus = input.fetchImpl
      ? await buildDeviceInstallStatus(
          input.fetchImpl,
          device,
          daemonToken(device, input.localToken),
          input.options.deviceUpdateQueue,
        ).catch(() => null)
      : null;
    const deviceMatchesServer = installStatus ? sameBuild(input.build, installStatus.build) : null;
    const queuedState = queued?.state;
    const queueIsActive =
      queuedState === "pending_until_device_online" ||
      queuedState === "queued" ||
      queuedState === "running";
    let action: ManagerUpdatePlan["items"][number]["action"];
    let state: string | undefined;
    let reason: string;
    if (queueIsActive && queued) {
      state = queuedState;
      action =
        queuedState === "pending_until_device_online" || queuedState === "queued"
          ? "queue"
          : "blocked";
      reason =
        queued.warning ||
        queued.error ||
        (queuedState === "running"
          ? "Connector update is already running."
          : `Queued update state: ${queuedState}.`);
    } else if (installStatus) {
      state =
        installStatus.update?.state ||
        queuedState ||
        (installStatus.running ? "running" : undefined);
      if (deviceMatchesServer === false) {
        action = queuedState === "restart_required" ? "restart" : "update";
        reason =
          queuedState === "restart_required"
            ? "Connector restart is required to activate the updated build."
            : "Connector update is available.";
      } else if (deviceMatchesServer === true) {
        action = "none";
        reason = "Connector build matches the server.";
      } else {
        action = "unknown";
        reason = installStatus.summary.message;
      }
    } else if (queued) {
      state = queuedState;
      action =
        queuedState === "restart_required"
          ? "restart"
          : queuedState === "failed"
            ? "update"
            : "none";
      reason = queued.warning || queued.error || `Queued update state: ${queuedState}.`;
    } else {
      action = "unknown";
      reason = "Device install status is unavailable.";
    }
    items.push({
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      action,
      ...(state ? { state } : {}),
      reason,
    });
  }

  const severity = items.some((item) => item.action === "blocked")
    ? "warn"
    : items.some((item) => item.action === "update" || item.action === "queue")
      ? "warn"
      : "ok";
  return {
    generatedAt,
    items,
    summary: {
      severity,
      message: `${items.length} update target(s) inspected.`,
    },
  };
}

function managerUpdatePlanItemWithoutDeviceProbe(
  device: Device,
  queued: StoredDeviceUpdateEntry | undefined,
): ManagerUpdatePlan["items"][number] {
  const queuedState = queued?.state;
  const queueIsActive =
    queuedState === "pending_until_device_online" ||
    queuedState === "queued" ||
    queuedState === "running";
  if (queueIsActive && queued) {
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      action: queuedState === "running" ? "blocked" : "queue",
      state: queuedState,
      reason:
        queued.warning ||
        queued.error ||
        (queuedState === "running"
          ? "Connector update is already running."
          : `Queued update state: ${queuedState}.`),
    };
  }
  if (queuedState === "restart_required" || queuedState === "failed") {
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      action: queuedState === "restart_required" ? "restart" : "update",
      state: queuedState,
      reason: queued?.warning || queued?.error || `Queued update state: ${queuedState}.`,
    };
  }
  return {
    scope: "device",
    targetId: device.id,
    targetLabel: device.label,
    action: "unknown",
    state: "not_checked",
    reason:
      "Quick system summary does not probe connector update status. Use update status to check this device.",
  };
}

async function buildManagerUpdateStatus(input: {
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
}): Promise<ManagerUpdateStatus> {
  const generatedAt = new Date().toISOString();
  const [serverUpdate, plan] = await Promise.all([
    input.options.selfServerUpdater
      ? input.options.selfServerUpdater.status().catch((err) => ({
          state: "failed",
          error: (err as Error).message,
        }))
      : Promise.resolve({ state: "unconfigured" }),
    buildManagerUpdatePlan({
      options: input.options,
      registry: input.registry,
      build: input.build,
      fetchImpl: input.fetchImpl,
      localToken: input.localToken,
    }),
  ]);
  const server = updateTargetFromRaw({
    scope: "server",
    targetLabel: "DeskRelay server",
    raw: serverUpdate,
  });
  const devices: ManagerUpdateTargetStatus[] = [];
  for (const device of input.registry.list()) {
    const status = await buildDeviceInstallStatus(
      input.fetchImpl,
      device,
      daemonToken(device, input.localToken),
      input.options.deviceUpdateQueue,
    );
    devices.push(updateTargetFromInstallStatus(status));
  }
  const severity = maxManagerSeverity([
    server.summary.severity,
    ...devices.map((device) => device.summary.severity),
    plan.summary.severity,
  ]);
  return {
    generatedAt,
    server,
    devices,
    plan,
    summary: {
      severity,
      message: `Update status inspected for ${devices.length + 1} target(s).`,
    },
  };
}

function updateTargetFromRaw(input: {
  scope: "server" | "device";
  targetId?: string;
  targetLabel: string;
  raw: unknown;
}): ManagerUpdateTargetStatus {
  const state =
    isRecord(input.raw) && typeof input.raw.state === "string" ? input.raw.state : "unknown";
  const error = isRecord(input.raw) && typeof input.raw.error === "string" ? input.raw.error : "";
  const updateAvailable =
    isRecord(input.raw) && typeof input.raw.updateAvailable === "boolean"
      ? input.raw.updateAvailable
      : undefined;
  const changed =
    isRecord(input.raw) && typeof input.raw.changed === "boolean" ? input.raw.changed : undefined;
  const severity =
    state === "failed" || error ? "error" : updateAvailable || state === "running" ? "warn" : "ok";
  return {
    scope: input.scope,
    ...(input.targetId ? { targetId: input.targetId } : {}),
    targetLabel: input.targetLabel,
    state,
    ...(updateAvailable !== undefined ? { updateAvailable } : {}),
    ...(changed !== undefined ? { changed } : {}),
    ...(error ? { error } : {}),
    summary: {
      severity,
      message: error || `Update state: ${state}.`,
    },
  };
}

function updateTargetFromInstallStatus(status: ManagerInstallStatus): ManagerUpdateTargetStatus {
  const queueState = status.queue?.state;
  const updateState = status.update?.state;
  const state = queueState ?? updateState ?? (status.running ? "running" : "offline");
  const updateAvailable = status.update?.updateAvailable;
  const changed = status.update?.changed;
  const error = status.queue?.error ?? status.update?.error;
  const severity =
    status.summary.severity === "error" || error
      ? "error"
      : status.summary.severity === "warn" || updateAvailable || Boolean(queueState)
        ? "warn"
        : "ok";
  return {
    scope: "device",
    ...(status.targetId ? { targetId: status.targetId } : {}),
    ...(status.targetLabel ? { targetLabel: status.targetLabel } : {}),
    state,
    ...(updateAvailable !== undefined ? { updateAvailable } : {}),
    ...(changed !== undefined ? { changed } : {}),
    ...(error ? { error } : {}),
    summary: {
      severity,
      message: error || status.summary.message,
    },
  };
}

async function buildManagerSystemSummary(input: {
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  requestUrl: string;
  store: ManagerTaskStore;
}): Promise<ManagerSystemSummary> {
  const generatedAt = new Date().toISOString();
  const urls = getAccessUrls(input.options.selfHostUrl ?? input.requestUrl);
  const [install, update, registration, recentTasks] = await Promise.all([
    buildSelfInstallStatus(input.options, input.build),
    buildManagerUpdatePlan({
      options: input.options,
      registry: input.registry,
      build: input.build,
      fetchImpl: input.fetchImpl,
      localToken: input.localToken,
      probeDevices: false,
    }),
    analyzeLastRegistrationFailure(input.options.installReportStore),
    input.store.list(5),
  ]);
  const network = buildSelfNetworkStatus(urls);
  const security = buildSelfSecurityBoundary(input.options, urls);
  const severity = maxManagerSeverity([
    install.summary.severity,
    network.summary.severity,
    security.summary.severity,
    update.summary.severity,
    registration.found ? "warn" : "ok",
  ]);
  return {
    generatedAt,
    build: input.build,
    devices: input.registry.list().map(toPublicDevice),
    server: {
      install,
      network,
      security,
    },
    update,
    registration,
    recentTasks: recentTasks.map(sanitizeManagerTaskForAssistant),
    summary: {
      severity,
      message: `Server and ${input.registry.list().length} device(s) summarized.`,
    },
  };
}

function buildManagerDeviceActions(device: Device): ManagerDeviceActions {
  return {
    generatedAt: new Date().toISOString(),
    deviceId: device.id,
    label: device.label,
    actions: [
      {
        id: "diagnose",
        label: "Run device diagnostics",
        enabled: true,
        method: "GET",
        path: `/api/devices/${device.id}/doctor`,
      },
      {
        id: "update",
        label: "Update connector",
        enabled: true,
        method: "POST",
        path: "/api/manager/tasks",
        taskKind: "update-device",
      },
      {
        id: "restart",
        label: "Restart connector",
        enabled: true,
        method: "POST",
        path: "/api/manager/tasks",
        taskKind: "restart-device",
      },
      {
        id: "logs",
        label: "Read connector logs",
        enabled: true,
        method: "GET",
        path: `/api/devices/${device.id}/logs`,
      },
      {
        id: "remove",
        label: "Remove device",
        enabled: true,
        method: "DELETE",
        path: `/api/devices/${device.id}`,
        destructive: true,
      },
    ],
  };
}

async function buildManagerRegistrationDiagnosis(input: {
  options: SiteAppOptions;
  requestUrl: string;
}): Promise<ManagerRegistrationDiagnosis> {
  const generatedAt = new Date().toISOString();
  const urls = getAccessUrls(input.options.selfHostUrl ?? input.requestUrl);
  const network = buildSelfNetworkStatus(urls);
  const lastFailure = await analyzeLastRegistrationFailure(input.options.installReportStore);
  const preferredUrl = pickRemoteAccessUrl(urls);
  const steps = [
    taskStep({
      id: "registration.site-token",
      label: "Site token",
      status: input.options.token ? "ok" : "failed",
      summary: input.options.token ? "Site token is configured." : "Site token is not configured.",
      retrySafe: false,
    }),
    taskStep({
      id: "registration.server-url",
      label: "Server URL",
      status: network.summary.severity === "ok" ? "ok" : "warn",
      summary: network.summary.message,
      retrySafe: true,
    }),
    taskStep({
      id: "registration.tailscale",
      label: "Tailscale",
      status: network.tailscale.detected ? "ok" : "warn",
      summary: network.tailscale.detected
        ? "Tailscale address is available."
        : "No Tailscale address is currently detected on the server.",
      retrySafe: true,
    }),
    ...(lastFailure.failureStep
      ? [
          taskStep({
            id: "registration.last-failure",
            label: "Last registration failure",
            status: lastFailure.retrySafe ? "warn" : "failed",
            summary: lastFailure.classification ?? lastFailure.failureStep.summary,
            ...(lastFailure.action ? { action: lastFailure.action } : {}),
            ...(lastFailure.retrySafe !== undefined ? { retrySafe: lastFailure.retrySafe } : {}),
          }),
        ]
      : []),
  ];
  const severity = maxManagerSeverity([
    ...steps.map((step) => step.severity),
    lastFailure.found ? "warn" : "ok",
  ]);
  return {
    generatedAt,
    serverUrl: preferredUrl,
    siteTokenConfigured: Boolean(input.options.token),
    tailscaleDetected: network.tailscale.detected,
    steps,
    lastFailure,
    summary: {
      severity,
      message: lastFailure.found
        ? "Registration diagnosis includes the latest failed install report."
        : "Registration prerequisites were inspected.",
    },
  };
}

async function buildManagerSecurityBoundarySummary(input: {
  options: SiteAppOptions;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  localToken: string | undefined;
  urls: AccessUrl[];
}): Promise<ManagerSecurityBoundarySummary> {
  const generatedAt = new Date().toISOString();
  const server = buildSelfSecurityBoundary(input.options, input.urls);
  const devices: ManagerSecurityBoundary[] = [];
  for (const device of input.registry.list()) {
    devices.push(
      await buildDeviceSecurityBoundary(
        input.fetchImpl,
        device,
        daemonToken(device, input.localToken),
      ),
    );
  }
  const warnings = [...server.warnings, ...devices.flatMap((device) => device.warnings)];
  return {
    generatedAt,
    server,
    devices,
    warnings,
    summary: {
      severity: warnings.length > 0 ? "warn" : "ok",
      message:
        warnings.length > 0
          ? `${warnings.length} security boundary warning(s).`
          : "Server and device security boundaries are constrained.",
    },
  };
}

async function analyzeLastRegistrationFailure(store: InstallReportStore | undefined): Promise<{
  generatedAt: string;
  found: boolean;
  reportId?: string;
  receivedAt?: string;
  status?: string;
  label?: string;
  failureStep?: ManagerTask["steps"][number];
  classification?: string;
  retrySafe?: boolean;
  action?: string;
}> {
  const generatedAt = new Date().toISOString();
  if (!store) return { generatedAt, found: false };
  const reports = await store.list(20).catch(() => []);
  const report = reports.find((item) => item.status === "failed");
  if (!report) return { generatedAt, found: false };
  const failureStep =
    report.steps.find((step) => step.severity === "error") ??
    report.steps.find((step) => step.status !== "ok");
  const classification = classifyRegistrationFailure(failureStep);
  const action = redactManagerSensitiveText(
    actionFromRegistrationFailure(failureStep, classification) ?? "",
  );
  const safeFailureStep = failureStep ? sanitizeDiagnosticStepForAssistant(failureStep) : undefined;
  return {
    generatedAt,
    found: true,
    reportId: report.id,
    receivedAt: report.receivedAt,
    status: report.status,
    ...(report.label ? { label: report.label } : {}),
    ...(safeFailureStep ? { failureStep: safeFailureStep } : {}),
    classification,
    retrySafe: failureStep?.retrySafe ?? isRetrySafeRegistrationClassification(classification),
    ...(action ? { action } : {}),
  };
}

function parseManagerTaskRequest(
  input: unknown,
): { ok: true; value: ManagerTaskRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "body must be an object" };
  if (!isManagerTaskKind(input.kind)) return { ok: false, error: "unsupported task kind" };
  const requestedBy =
    input.requestedBy === "manager-assistant" || input.requestedBy === "system"
      ? input.requestedBy
      : "browser";
  return {
    ok: true,
    value: {
      kind: input.kind,
      ...(typeof input.projectId === "string" && input.projectId.trim()
        ? { projectId: input.projectId.trim() }
        : {}),
      ...(typeof input.targetId === "string" && input.targetId.trim()
        ? { targetId: input.targetId.trim() }
        : {}),
      dryRun: input.dryRun !== false,
      requestedBy,
      ...(isRecord(input.params) ? { params: input.params } : {}),
    },
  };
}

function parseManagerAssistantChatRequest(
  input: unknown,
): { ok: true; value: ManagerAssistantChatRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "body must be an object" };
  if (typeof input.message !== "string" || !input.message.trim()) {
    return { ok: false, error: "message is required" };
  }
  if (input.message.length > 20_000) return { ok: false, error: "message is too long" };
  const context = normalizeAssistantContext(input.context);
  const assistantState = normalizeAssistantState(input.assistantState);
  return {
    ok: true,
    value: {
      message: input.message.trim(),
      history: normalizeAssistantHistory(input.history),
      ...(context ? { context } : {}),
      ...(assistantState ? { assistantState } : {}),
    },
  };
}

function normalizeAssistantContext(input: unknown): ManagerAssistantChatContext | undefined {
  if (!isRecord(input)) return undefined;
  const context: ManagerAssistantChatContext = {};
  if (typeof input.deviceId === "string" && input.deviceId.trim()) {
    context.deviceId = input.deviceId.trim().slice(0, 200);
  }
  if (typeof input.deviceLabel === "string" && input.deviceLabel.trim()) {
    context.deviceLabel = input.deviceLabel.trim().slice(0, 500);
  }
  if (input.deviceConnectionState === "online" || input.deviceConnectionState === "offline") {
    context.deviceConnectionState = input.deviceConnectionState;
  }
  if (typeof input.sessionId === "string" && input.sessionId.trim()) {
    context.sessionId = input.sessionId.trim().slice(0, 500);
  }
  if (typeof input.sessionTitle === "string" && input.sessionTitle.trim()) {
    context.sessionTitle = input.sessionTitle.trim().slice(0, 1_000);
  }
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    context.cwd = input.cwd.trim().slice(0, 2_000);
  }
  if (typeof input.projectId === "string" && input.projectId.trim()) {
    context.projectId = input.projectId.trim().slice(0, 200);
  }
  if (typeof input.projectName === "string" && input.projectName.trim()) {
    context.projectName = input.projectName.trim().slice(0, 500);
  }
  if (isManagerProjectStatusValue(input.projectStatus)) {
    context.projectStatus = input.projectStatus;
  }
  if (typeof input.projectCwd === "string" && input.projectCwd.trim()) {
    context.projectCwd = input.projectCwd.trim().slice(0, 2_000);
  }
  if (typeof input.projectGoal === "string" && input.projectGoal.trim()) {
    context.projectGoal = input.projectGoal.trim().slice(0, 2_000);
  }
  if (typeof input.activeRoundId === "string" && input.activeRoundId.trim()) {
    context.activeRoundId = input.activeRoundId.trim().slice(0, 200);
  }
  if (typeof input.activeRoundTitle === "string" && input.activeRoundTitle.trim()) {
    context.activeRoundTitle = input.activeRoundTitle.trim().slice(0, 500);
  }
  if (isManagerRoundStatusValue(input.activeRoundStatus)) {
    context.activeRoundStatus = input.activeRoundStatus;
  }
  const projectDecisions = normalizeAssistantContextStringList(input.projectDecisions);
  const projectBlockers = normalizeAssistantContextStringList(input.projectBlockers);
  const projectArtifacts = normalizeAssistantContextStringList(input.projectArtifacts);
  const projectCommandFlow = normalizeAssistantContextStringList(input.projectCommandFlow);
  const projectProtocol = normalizeAssistantContextStringList(input.projectProtocol);
  const projectWarnings = normalizeAssistantContextStringList(input.projectWarnings);
  if (projectDecisions.length) context.projectDecisions = projectDecisions;
  if (projectBlockers.length) context.projectBlockers = projectBlockers;
  if (projectArtifacts.length) context.projectArtifacts = projectArtifacts;
  if (projectCommandFlow.length) context.projectCommandFlow = projectCommandFlow;
  if (projectProtocol.length) context.projectProtocol = projectProtocol;
  if (projectWarnings.length) context.projectWarnings = projectWarnings;
  return Object.keys(context).length ? context : undefined;
}

function formatManagerAssistantBrowserContext(
  context: ManagerAssistantChatContext | undefined,
): string {
  if (!context) return "";
  const lines: string[] = [];
  if (context.deviceId) lines.push(`- selected device id: ${context.deviceId}`);
  if (context.deviceLabel) lines.push(`- selected device label: ${context.deviceLabel}`);
  if (context.deviceConnectionState) {
    lines.push(`- selected device connection: ${context.deviceConnectionState}`);
  }
  if (context.sessionId) lines.push(`- selected session id: ${context.sessionId}`);
  if (context.sessionTitle) lines.push(`- selected session title: ${context.sessionTitle}`);
  if (context.cwd) lines.push(`- selected/current cwd: ${context.cwd}`);
  if (context.projectId) lines.push(`- current project id: ${context.projectId}`);
  if (context.projectName) lines.push(`- current project name: ${context.projectName}`);
  if (context.projectStatus) lines.push(`- current project status: ${context.projectStatus}`);
  if (context.projectCwd) lines.push(`- current project cwd: ${context.projectCwd}`);
  if (context.projectGoal) lines.push(`- current project goal: ${context.projectGoal}`);
  if (context.activeRoundId) lines.push(`- active round id: ${context.activeRoundId}`);
  if (context.activeRoundTitle) lines.push(`- active round title: ${context.activeRoundTitle}`);
  if (context.activeRoundStatus) lines.push(`- active round status: ${context.activeRoundStatus}`);
  appendManagerAssistantContextList(lines, "active project decisions", context.projectDecisions);
  appendManagerAssistantContextList(lines, "open project blockers", context.projectBlockers);
  appendManagerAssistantContextList(lines, "active project artifacts", context.projectArtifacts);
  appendManagerAssistantContextList(lines, "project command flow", context.projectCommandFlow);
  appendManagerAssistantContextList(lines, "project protocol state", context.projectProtocol);
  appendManagerAssistantContextList(lines, "project context warnings", context.projectWarnings);
  return lines.join("\n");
}

function appendManagerAssistantContextList(
  lines: string[],
  label: string,
  values: string[] | undefined,
): void {
  if (!values?.length) return;
  lines.push(`- ${label}:`);
  for (const value of values.slice(0, 8)) lines.push(`  - ${value}`);
}

function normalizeAssistantContextStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().replace(/\s+/g, " ").slice(0, 500))
    .slice(0, 8);
}

function isManagerProjectStatusValue(value: unknown): value is ManagerProjectStatus {
  return (
    value === "planning" ||
    value === "running" ||
    value === "blocked" ||
    value === "reviewing" ||
    value === "completed" ||
    value === "archived"
  );
}

function isManagerRoundStatusValue(value: unknown): value is ManagerRoundStatus {
  return (
    value === "planned" ||
    value === "dispatching" ||
    value === "running" ||
    value === "collecting" ||
    value === "reviewing" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function normalizeAssistantState(input: unknown): ManagerAssistantStructuredState | undefined {
  if (!isRecord(input)) return undefined;
  const state: ManagerAssistantStructuredState = {};
  if (typeof input.sessionId === "string" && input.sessionId.trim()) {
    state.sessionId = input.sessionId.trim().slice(0, 500);
  }
  if (typeof input.lastAssistantText === "string" && input.lastAssistantText.trim()) {
    state.lastAssistantText = sanitizeManagerAssistantText(input.lastAssistantText).slice(0, 8_000);
  }
  if (isRecord(input.pendingDecision)) {
    const decision = input.pendingDecision;
    const options = Array.isArray(decision.options)
      ? decision.options
          .filter(isManagerAssistantDecisionOption)
          .map((option) => ({
            key: option.key.trim().slice(0, 24),
            label: sanitizeManagerAssistantText(option.label).replace(/\s+/g, " ").slice(0, 400),
            ...(option.detail
              ? {
                  detail: sanitizeManagerAssistantText(option.detail)
                    .replace(/\s+/g, " ")
                    .slice(0, 400),
                }
              : {}),
          }))
          .slice(0, 12)
      : [];
    if (options.length) {
      state.pendingDecision = {
        id:
          typeof decision.id === "string" && decision.id.trim()
            ? decision.id.trim().slice(0, 120)
            : "pending-decision",
        ...(typeof decision.prompt === "string" && decision.prompt.trim()
          ? { prompt: decision.prompt.trim().slice(0, 1_000) }
          : {}),
        options,
        ...(typeof decision.createdAt === "string" && decision.createdAt.trim()
          ? { createdAt: decision.createdAt.trim().slice(0, 120) }
          : {}),
      };
    }
  }
  if (isRecord(input.task)) {
    const task = input.task;
    const taskState =
      typeof task.state === "string" && isManagerAssistantTaskState(task.state)
        ? task.state
        : "idle";
    state.task = {
      state: taskState,
      ...(typeof task.title === "string" && task.title.trim()
        ? { title: task.title.trim().slice(0, 240) }
        : {}),
      ...(typeof task.updatedAt === "string" && task.updatedAt.trim()
        ? { updatedAt: task.updatedAt.trim().slice(0, 120) }
        : {}),
    };
  }
  const facts = normalizeManagerAssistantStringList(input.facts);
  const decisions = normalizeManagerAssistantStringList(input.decisions);
  const openQuestions = normalizeManagerAssistantStringList(input.openQuestions);
  if (facts.length) state.facts = facts;
  if (decisions.length) state.decisions = decisions;
  if (openQuestions.length) state.openQuestions = openQuestions;
  return Object.keys(state).length ? state : undefined;
}

function isManagerAssistantDecisionOption(input: unknown): input is ManagerAssistantDecisionOption {
  if (!isRecord(input)) return false;
  return (
    typeof input.key === "string" &&
    input.key.trim() !== "" &&
    typeof input.label === "string" &&
    input.label.trim() !== ""
  );
}

function isManagerAssistantTaskState(
  value: string,
): value is NonNullable<ManagerAssistantStructuredState["task"]>["state"] {
  return [
    "idle",
    "planning",
    "waiting_user_choice",
    "executing",
    "verifying",
    "blocked",
    "done",
  ].includes(value);
}

function normalizeManagerAssistantStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => sanitizeManagerAssistantText(value).replace(/\s+/g, " ").trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeAssistantHistory(input: unknown): ManagerAssistantChatMessage[] {
  if (!Array.isArray(input)) return [];
  const history: ManagerAssistantChatMessage[] = [];
  for (const item of input) {
    if (!isRecord(item)) continue;
    if (item.role !== "user" && item.role !== "assistant" && item.role !== "system") continue;
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    const text = sanitizeManagerAssistantText(item.text);
    if (!text) continue;
    history.push({
      id: typeof item.id === "string" && item.id.trim() ? item.id : `history_${history.length}`,
      role: item.role,
      text: text.slice(0, 20_000),
      createdAt:
        typeof item.createdAt === "string" && item.createdAt.trim()
          ? item.createdAt
          : new Date(0).toISOString(),
    });
  }
  return history.slice(-20);
}

async function parseManagerShortcutRequest(
  req: { json(): Promise<unknown> },
  kind: ManagerTaskKind,
): Promise<{ ok: true; value: ManagerTaskRequest } | { ok: false; error: string }> {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  return parseManagerTaskRequest({ ...body, kind });
}

async function parseManagerWorkerRunRequest(req: { json(): Promise<unknown> }): Promise<
  { ok: true; value: ManagerTaskRequest } | { ok: false; error: string }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "body must be valid JSON" };
  }
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  const params = parseManagerWorkerParams(body);
  if (!params.ok) return { ok: false, error: params.error };
  return parseManagerTaskRequest({
    kind: "run-worker",
    projectId: body.projectId,
    dryRun: body.dryRun,
    requestedBy: body.requestedBy,
    params: params.value,
  });
}

function parseManagerAgentCreateRequest(
  input: unknown,
): { ok: true; value: ManagerAgentCreateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "agent body must be an object" };
  const role = parseManagerAgentRole(input.role);
  if (!role) return { ok: false, error: "agent role is required" };
  const instruction =
    typeof input.instruction === "string" && input.instruction.trim()
      ? input.instruction.trim()
      : undefined;
  return {
    ok: true,
    value: {
      ...(typeof input.projectId === "string" && input.projectId.trim()
        ? { projectId: input.projectId.trim() }
        : {}),
      role,
      ...(typeof input.label === "string" && input.label.trim()
        ? { label: input.label.trim() }
        : {}),
      ...(typeof input.profile === "string" && input.profile.trim()
        ? { profile: input.profile.trim() }
        : {}),
      ...(typeof input.cwd === "string" && input.cwd.trim() ? { cwd: input.cwd.trim() } : {}),
      ...(typeof input.roundId === "string" && input.roundId.trim()
        ? { roundId: input.roundId.trim() }
        : {}),
      ...(instruction ? { instruction } : {}),
    },
  };
}

function parseManagerAgentMessageRequest(
  input: unknown,
): { ok: true; value: ManagerAgentMessageRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "agent message body must be an object" };
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "agent message prompt is required" };
  if (prompt.length > 40_000) return { ok: false, error: "agent message prompt is too long" };
  const timeoutMs = Number(input.timeoutMs);
  return {
    ok: true,
    value: {
      prompt,
      ...(typeof input.projectId === "string" && input.projectId.trim()
        ? { projectId: input.projectId.trim() }
        : {}),
      ...(typeof input.profile === "string" && input.profile.trim()
        ? { profile: input.profile.trim() }
        : {}),
      ...(typeof input.cwd === "string" && input.cwd.trim() ? { cwd: input.cwd.trim() } : {}),
      ...(typeof input.roundId === "string" && input.roundId.trim()
        ? { roundId: input.roundId.trim() }
        : {}),
      ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
      ...(typeof input.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
    },
  };
}

function parseManagerProjectCreateRequest(
  input: unknown,
): { ok: true; value: ManagerProjectCreateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "project body must be an object" };
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  if (!cwd) return { ok: false, error: "project cwd is required" };
  const status = parseManagerProjectStatus(input.status);
  if (input.status !== undefined && !status) {
    return { ok: false, error: "project status is invalid" };
  }
  const protocolSource = parseManagerProjectProtocolSource(input.protocolSource);
  if (input.protocolSource !== undefined && !protocolSource) {
    return { ok: false, error: "project protocolSource is invalid" };
  }
  const flowStage = parseManagerCommandFlowStage(input.flowStage);
  if (input.flowStage !== undefined && !flowStage) {
    return { ok: false, error: "project flowStage is invalid" };
  }
  const charter =
    input.charter === undefined ? undefined : parseManagerProjectCharterPatch(input.charter);
  if (input.charter !== undefined && !charter) {
    return { ok: false, error: "project charter must be an object" };
  }
  const wizardEvent =
    input.wizardEvent === undefined
      ? undefined
      : parseManagerWizardIntentEventInput(input.wizardEvent);
  if (input.wizardEvent !== undefined && !wizardEvent) {
    return { ok: false, error: "project wizardEvent must be an object with fields" };
  }
  return {
    ok: true,
    value: {
      cwd,
      ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
      ...(typeof input.goal === "string" && input.goal.trim() ? { goal: input.goal.trim() } : {}),
      ...(status ? { status } : {}),
      ...(typeof input.activeRoundId === "string" && input.activeRoundId.trim()
        ? { activeRoundId: input.activeRoundId.trim() }
        : {}),
      ...(protocolSource ? { protocolSource } : {}),
      ...(flowStage ? { flowStage } : {}),
      ...(charter ? { charter } : {}),
      ...(wizardEvent ? { wizardEvent } : {}),
    },
  };
}

function parseManagerProjectProtocolSource(
  value: unknown,
): ManagerProjectProtocolSource | undefined {
  return value === "base-copy" || value === "blank" ? value : undefined;
}

function parseManagerCommandFlowStage(value: unknown): ManagerCommandFlowStage | undefined {
  return value === "draft" ||
    value === "protocol_ready" ||
    value === "ready_to_start" ||
    value === "running" ||
    value === "review" ||
    value === "replanning" ||
    value === "completed" ||
    value === "archived"
    ? value
    : undefined;
}

function parseManagerRoundPhase(value: unknown): ManagerRoundPhase | undefined {
  return value === "design" ||
    value === "implementation" ||
    value === "feedback" ||
    value === "verification" ||
    value === "replan"
    ? value
    : undefined;
}

function parseManagerProjectRecordAuthor(
  value: unknown,
): ManagerProjectCharter["updatedBy"] | undefined {
  return value === "browser" || value === "manager" || value === "system" ? value : undefined;
}

function parseManagerWizardIntentEventInput(
  input: unknown,
): ManagerWizardIntentEventInput | undefined {
  if (!isRecord(input)) return undefined;
  const kind = parseManagerWizardIntentKind(input.kind);
  if (!kind) return undefined;
  const fields = parseManagerWizardIntentFields(input.fields);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (fields.length === 0 && !note) return undefined;
  const impact = parseManagerWizardIntentImpact(input.impact);
  const managerAction = parseManagerWizardIntentAction(input.managerAction);
  return {
    kind,
    fields,
    ...(impact ? { impact } : {}),
    ...(managerAction ? { managerAction } : {}),
    ...(typeof input.roundId === "string" && input.roundId.trim()
      ? { roundId: input.roundId.trim() }
      : {}),
    ...(note ? { note } : {}),
  };
}

function parseManagerWizardIntentFields(value: unknown): ManagerWizardIntentEventInput["fields"] {
  if (!Array.isArray(value)) return [];
  const fields: ManagerWizardIntentEventInput["fields"] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const field = typeof item.field === "string" ? item.field.trim() : "";
    const after = typeof item.after === "string" ? item.after.trim() : "";
    if (!field || !after || seen.has(field)) continue;
    seen.add(field);
    fields.push({
      field,
      ...(typeof item.before === "string" && item.before.trim()
        ? { before: item.before.trim() }
        : {}),
      after,
    });
    if (fields.length >= 20) break;
  }
  return fields;
}

function parseManagerWizardIntentKind(value: unknown): ManagerWizardIntentEventKind | undefined {
  return value === "charter-applied" ||
    value === "direction-change-requested" ||
    value === "checkpoint-requested" ||
    value === "protocol-source-changed" ||
    value === "readiness-refresh-requested"
    ? value
    : undefined;
}

function parseManagerWizardIntentImpact(value: unknown): ManagerWizardIntentImpact | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "unknown"
    ? value
    : undefined;
}

function parseManagerWizardIntentAction(value: unknown): ManagerWizardIntentAction | undefined {
  return value === "record" ||
    value === "refresh-readiness" ||
    value === "continue" ||
    value === "replan" ||
    value === "pause" ||
    value === "ask-human"
    ? value
    : undefined;
}

function parseManagerProjectCharterPatch(
  input: unknown,
): Partial<ManagerProjectCharter> | undefined {
  if (!isRecord(input)) return undefined;
  const out: Partial<ManagerProjectCharter> = {};
  for (const field of [
    "goal",
    "scope",
    "nonGoals",
    "constraints",
    "successCriteria",
    "preferredApproach",
    "verificationPlan",
    "userCheckpoints",
    "finalDeliverables",
  ] as const) {
    if (typeof input[field] === "string") out[field] = input[field].trim();
  }
  const updatedBy = parseManagerProjectRecordAuthor(input.updatedBy);
  if (updatedBy) out.updatedBy = updatedBy;
  if (typeof input.updatedAt === "string" && input.updatedAt.trim()) {
    out.updatedAt = input.updatedAt.trim();
  }
  return out;
}

function parseManagerProjectCharterUpdateRequest(
  input: unknown,
): { ok: true; value: ManagerProjectCharterUpdateRequest } | { ok: false; error: string } {
  const charter = parseManagerProjectCharterPatch(input);
  if (!charter) return { ok: false, error: "project charter body must be an object" };
  const value: ManagerProjectCharterUpdateRequest = { ...charter };
  if (isRecord(input) && input.wizardEvent !== undefined) {
    const wizardEvent = parseManagerWizardIntentEventInput(input.wizardEvent);
    if (!wizardEvent) {
      return { ok: false, error: "project wizardEvent must be an object with fields" };
    }
    value.wizardEvent = wizardEvent;
  }
  return { ok: true, value };
}

function parseManagerProjectUpdateRequest(
  input: unknown,
): { ok: true; value: ManagerProjectUpdateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "project body must be an object" };
  const status = parseManagerProjectStatus(input.status);
  if (input.status !== undefined && !status) {
    return { ok: false, error: "project status is invalid" };
  }
  const flowStage = parseManagerCommandFlowStage(input.flowStage);
  if (input.flowStage !== undefined && !flowStage) {
    return { ok: false, error: "project flowStage is invalid" };
  }
  const value: ManagerProjectUpdateRequest = {};
  if (typeof input.cwd === "string") value.cwd = input.cwd.trim();
  if (typeof input.name === "string") value.name = input.name.trim();
  if (typeof input.goal === "string") value.goal = input.goal.trim();
  if (status) value.status = status;
  if (flowStage) value.flowStage = flowStage;
  if (input.charter === null) value.charter = null;
  else if (input.charter !== undefined) {
    const charter = parseManagerProjectCharterPatch(input.charter);
    if (!charter) return { ok: false, error: "project charter must be an object" };
    value.charter = charter;
  }
  if (input.activeRoundId === null) value.activeRoundId = null;
  else if (typeof input.activeRoundId === "string")
    value.activeRoundId = input.activeRoundId.trim();
  if (input.summary === null) value.summary = null;
  else if (typeof input.summary === "string") value.summary = input.summary.trim();
  if (input.error === null) value.error = null;
  else if (typeof input.error === "string") value.error = input.error.trim();
  if (input.wizardEvent !== undefined) {
    const wizardEvent = parseManagerWizardIntentEventInput(input.wizardEvent);
    if (!wizardEvent) {
      return { ok: false, error: "project wizardEvent must be an object with fields" };
    }
    value.wizardEvent = wizardEvent;
  }
  return { ok: true, value };
}

function parseManagerDecisionCreateRequest(
  input: unknown,
): { ok: true; value: ManagerDecisionCreateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "decision body must be an object" };
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const detail = typeof input.detail === "string" ? input.detail.trim() : "";
  if (!title) return { ok: false, error: "decision title is required" };
  if (!detail) return { ok: false, error: "decision detail is required" };
  if (title.length > 240) return { ok: false, error: "decision title is too long" };
  if (detail.length > 10_000) return { ok: false, error: "decision detail is too long" };
  const status = parseManagerDecisionStatus(input.status);
  if (input.status !== undefined && !status) {
    return { ok: false, error: "decision status is invalid" };
  }
  const createdBy =
    input.createdBy === "manager" || input.createdBy === "browser" || input.createdBy === "system"
      ? input.createdBy
      : undefined;
  return {
    ok: true,
    value: {
      title,
      detail,
      tags: parseManagerDecisionTags(input.tags),
      ...(typeof input.rationale === "string" && input.rationale.trim()
        ? { rationale: input.rationale.trim().slice(0, 10_000) }
        : {}),
      ...(status ? { status } : {}),
      ...(typeof input.roundId === "string" && input.roundId.trim()
        ? { roundId: input.roundId.trim() }
        : {}),
      ...(typeof input.agentId === "string" && input.agentId.trim()
        ? { agentId: input.agentId.trim() }
        : {}),
      ...(typeof input.taskId === "string" && input.taskId.trim()
        ? { taskId: input.taskId.trim() }
        : {}),
      ...(createdBy ? { createdBy } : {}),
    },
  };
}

function parseManagerDecisionUpdateRequest(
  input: unknown,
): { ok: true; value: ManagerDecisionUpdateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "decision body must be an object" };
  const status = parseManagerDecisionStatus(input.status);
  if (input.status !== undefined && !status) {
    return { ok: false, error: "decision status is invalid" };
  }
  const value: ManagerDecisionUpdateRequest = {};
  if (typeof input.title === "string") {
    const title = input.title.trim();
    if (!title) return { ok: false, error: "decision title cannot be empty" };
    if (title.length > 240) return { ok: false, error: "decision title is too long" };
    value.title = title;
  }
  if (typeof input.detail === "string") {
    const detail = input.detail.trim();
    if (!detail) return { ok: false, error: "decision detail cannot be empty" };
    if (detail.length > 10_000) return { ok: false, error: "decision detail is too long" };
    value.detail = detail;
  }
  if (input.rationale === null) value.rationale = null;
  else if (typeof input.rationale === "string") value.rationale = input.rationale.trim();
  if (status) value.status = status;
  if (Array.isArray(input.tags)) value.tags = parseManagerDecisionTags(input.tags);
  if (input.roundId === null) value.roundId = null;
  else if (typeof input.roundId === "string") value.roundId = input.roundId.trim();
  if (input.agentId === null) value.agentId = null;
  else if (typeof input.agentId === "string") value.agentId = input.agentId.trim();
  if (input.taskId === null) value.taskId = null;
  else if (typeof input.taskId === "string") value.taskId = input.taskId.trim();
  if (Object.keys(value).length === 0) {
    return { ok: false, error: "decision update must include at least one field" };
  }
  return { ok: true, value };
}

function parseManagerBlockerCreateRequest(
  input: unknown,
): { ok: true; value: ManagerBlockerCreateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "blocker body must be an object" };
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "blocker title is required" };
  if (title.length > 240) return { ok: false, error: "blocker title is too long" };
  const detail = typeof input.detail === "string" ? input.detail.trim() : "";
  if (detail.length > 10_000) return { ok: false, error: "blocker detail is too long" };
  const severity = parseManagerBlockerSeverity(input.severity);
  if (input.severity !== undefined && !severity) {
    return { ok: false, error: "blocker severity is invalid" };
  }
  const requiredAction = parseManagerBlockerRequiredAction(input.requiredAction);
  if (input.requiredAction !== undefined && !requiredAction) {
    return { ok: false, error: "blocker requiredAction is invalid" };
  }
  const source = parseManagerBlockerSource(input.source);
  if (input.source !== undefined && !source) {
    return { ok: false, error: "blocker source is invalid" };
  }
  return {
    ok: true,
    value: {
      title,
      ...(detail ? { detail } : {}),
      ...(severity ? { severity } : {}),
      ...(typeof input.owner === "string" && input.owner.trim()
        ? { owner: input.owner.trim().slice(0, 96) }
        : {}),
      ...(requiredAction ? { requiredAction } : {}),
      ...(source ? { source } : {}),
      ...(typeof input.dedupeKey === "string" && input.dedupeKey.trim()
        ? { dedupeKey: input.dedupeKey.trim().slice(0, 200) }
        : {}),
      ...(typeof input.roundId === "string" && input.roundId.trim()
        ? { roundId: input.roundId.trim() }
        : {}),
      ...(typeof input.agentId === "string" && input.agentId.trim()
        ? { agentId: input.agentId.trim() }
        : {}),
      ...(typeof input.taskId === "string" && input.taskId.trim()
        ? { taskId: input.taskId.trim() }
        : {}),
    },
  };
}

function parseManagerBlockerResolveRequest(
  input: unknown,
): { ok: true; value: ManagerBlockerResolveRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "blocker body must be an object" };
  if (input.status !== undefined && input.status !== "resolved" && input.status !== "dismissed") {
    return { ok: false, error: "blocker resolve status is invalid" };
  }
  const resolution = typeof input.resolution === "string" ? input.resolution.trim() : "";
  if (resolution.length > 10_000) {
    return { ok: false, error: "blocker resolution is too long" };
  }
  return {
    ok: true,
    value: {
      ...(resolution ? { resolution } : {}),
      ...(input.status === "dismissed" ? { status: "dismissed" } : {}),
    },
  };
}

function parseManagerProjectHygieneCleanupRequest(
  input: unknown,
): { ok: true; value: ManagerProjectHygieneCleanupRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "hygiene cleanup body must be an object" };
  let issueIds: string[] | undefined;
  if (input.issueIds !== undefined) {
    if (!Array.isArray(input.issueIds)) {
      return { ok: false, error: "issueIds must be an array" };
    }
    const seen = new Set<string>();
    issueIds = [];
    for (const item of input.issueIds) {
      if (typeof item !== "string" || !item.trim()) {
        return { ok: false, error: "issueIds must contain non-empty strings" };
      }
      const issueId = item.trim().slice(0, 220);
      if (seen.has(issueId)) continue;
      seen.add(issueId);
      issueIds.push(issueId);
      if (issueIds.length > 200) return { ok: false, error: "issueIds is too large" };
    }
  }
  return {
    ok: true,
    value: {
      dryRun: input.dryRun === true,
      createBlockers: input.createBlockers !== false,
      ...(issueIds ? { issueIds } : {}),
    },
  };
}

function parseManagerArtifactScanRequest(
  input: unknown,
): { ok: true; value: ManagerArtifactScanRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "artifact scan body must be an object" };
  const value: ManagerArtifactScanRequest = {};
  if (input.limit !== undefined) {
    const limit = Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return { ok: false, error: "artifact scan limit must be an integer from 1 to 500" };
    }
    value.limit = limit;
  }
  return { ok: true, value };
}

function parseManagerArtifactUpdateRequest(
  input: unknown,
): { ok: true; value: ManagerArtifactUpdateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "artifact body must be an object" };
  const kind = parseManagerArtifactKind(input.kind);
  if (input.kind !== undefined && !kind) {
    return { ok: false, error: "artifact kind is invalid" };
  }
  const status = parseManagerArtifactStatus(input.status);
  if (input.status !== undefined && !status) {
    return { ok: false, error: "artifact status is invalid" };
  }
  const value: ManagerArtifactUpdateRequest = {};
  if (kind) value.kind = kind;
  if (status) value.status = status;
  if (typeof input.owner === "string") {
    const owner = input.owner.trim();
    if (!owner) return { ok: false, error: "artifact owner cannot be empty" };
    if (owner.length > 96) return { ok: false, error: "artifact owner is too long" };
    value.owner = owner;
  }
  if (input.note === null) value.note = null;
  else if (typeof input.note === "string") value.note = input.note.trim().slice(0, 4_000);
  if (Object.keys(value).length === 0) {
    return { ok: false, error: "artifact update must include at least one field" };
  }
  return { ok: true, value };
}

function parseManagerProtocolScanRequest(
  input: unknown,
): { ok: true; value: ManagerProtocolScanRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "protocol scan body must be an object" };
  const value: ManagerProtocolScanRequest = {};
  if (input.includeExcerpt !== undefined) {
    if (typeof input.includeExcerpt !== "boolean") {
      return { ok: false, error: "protocol scan includeExcerpt must be a boolean" };
    }
    value.includeExcerpt = input.includeExcerpt;
  }
  if (input.limit !== undefined) {
    const limit = Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return { ok: false, error: "protocol scan limit must be an integer from 1 to 50" };
    }
    value.limit = limit;
  }
  return { ok: true, value };
}

function parseManagerProtocolUpdateRequest(
  input: unknown,
): { ok: true; value: ManagerProtocolUpdateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "protocol body must be an object" };
  const value: ManagerProtocolUpdateRequest = {};
  if (input.version !== undefined) {
    if (typeof input.version !== "string") {
      return { ok: false, error: "protocol version must be a string" };
    }
    if (input.version.trim().length > 120) {
      return { ok: false, error: "protocol version is too long" };
    }
    value.version = input.version.trim();
  }
  if (input.activeRules !== undefined) {
    if (!Array.isArray(input.activeRules)) {
      return { ok: false, error: "protocol activeRules must be an array" };
    }
    const rules: string[] = [];
    for (const rule of input.activeRules) {
      if (typeof rule !== "string") {
        return { ok: false, error: "protocol activeRules entries must be strings" };
      }
      const normalized = rule.trim().replace(/\s+/g, " ");
      if (!normalized) continue;
      if (normalized.length > 500) {
        return { ok: false, error: "protocol active rule is too long" };
      }
      rules.push(normalized);
      if (rules.length > 20) {
        return { ok: false, error: "protocol activeRules accepts at most 20 entries" };
      }
    }
    value.activeRules = rules;
  }
  if (input.latestChange !== undefined) {
    if (input.latestChange === null) {
      value.latestChange = null;
    } else {
      if (!isRecord(input.latestChange)) {
        return { ok: false, error: "protocol latestChange must be an object or null" };
      }
      const summary =
        typeof input.latestChange.summary === "string" ? input.latestChange.summary.trim() : "";
      if (!summary) return { ok: false, error: "protocol latestChange summary is required" };
      if (summary.length > 1_000) {
        return { ok: false, error: "protocol latestChange summary is too long" };
      }
      value.latestChange = {
        summary,
        ...(typeof input.latestChange.decisionId === "string" &&
        input.latestChange.decisionId.trim()
          ? { decisionId: input.latestChange.decisionId.trim().slice(0, 200) }
          : {}),
        ...(typeof input.latestChange.roundId === "string" && input.latestChange.roundId.trim()
          ? { roundId: input.latestChange.roundId.trim().slice(0, 200) }
          : {}),
      };
    }
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, error: "protocol update must include at least one field" };
  }
  return { ok: true, value };
}

function parseManagerRoundCreateRequest(
  input: unknown,
): { ok: true; value: ManagerRoundCreateRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "round body must be an object" };
  const objective = typeof input.objective === "string" ? input.objective.trim() : "";
  if (!objective) return { ok: false, error: "round objective is required" };
  const phase = parseManagerRoundPhase(input.phase);
  if (input.phase !== undefined && !phase) {
    return { ok: false, error: "round phase is invalid" };
  }
  const agents: ManagerRoundCreateRequest["agents"] = [];
  if (Array.isArray(input.agents)) {
    for (const item of input.agents) {
      if (!isRecord(item)) return { ok: false, error: "round agent assignment must be an object" };
      const role = parseManagerAgentRole(item.role);
      if (!role) return { ok: false, error: "round agent role is required" };
      agents.push({
        role,
        ...(typeof item.label === "string" && item.label.trim()
          ? { label: item.label.trim() }
          : {}),
        ...(typeof item.profile === "string" && item.profile.trim()
          ? { profile: item.profile.trim() }
          : {}),
        ...(typeof item.cwd === "string" && item.cwd.trim() ? { cwd: item.cwd.trim() } : {}),
        ...(typeof item.prompt === "string" && item.prompt.trim()
          ? { prompt: item.prompt.trim() }
          : {}),
      });
    }
  }
  return {
    ok: true,
    value: {
      ...(typeof input.projectId === "string" && input.projectId.trim()
        ? { projectId: input.projectId.trim() }
        : {}),
      objective,
      ...(phase ? { phase } : {}),
      ...(typeof input.title === "string" && input.title.trim()
        ? { title: input.title.trim() }
        : {}),
      ...(agents.length ? { agents } : {}),
    },
  };
}

function parseManagerRoundDispatchRequest(
  input: unknown,
): { ok: true; value: ManagerRoundDispatchRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "round dispatch body must be an object" };
  const assignments: ManagerRoundAgentAssignment[] = [];
  if (Array.isArray(input.assignments)) {
    for (const item of input.assignments) {
      if (!isRecord(item)) return { ok: false, error: "round assignment must be an object" };
      const role = parseManagerAgentRole(item.role);
      if (!role) return { ok: false, error: "round assignment role is required" };
      const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
      if (!prompt) return { ok: false, error: "round assignment prompt is required" };
      const timeoutMs = Number(item.timeoutMs);
      assignments.push({
        role,
        prompt,
        ...(typeof item.agentId === "string" && item.agentId.trim()
          ? { agentId: item.agentId.trim() }
          : {}),
        ...(typeof item.label === "string" && item.label.trim()
          ? { label: item.label.trim() }
          : {}),
        ...(typeof item.profile === "string" && item.profile.trim()
          ? { profile: item.profile.trim() }
          : {}),
        ...(typeof item.cwd === "string" && item.cwd.trim() ? { cwd: item.cwd.trim() } : {}),
        ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
      });
    }
  }
  return {
    ok: true,
    value: {
      ...(assignments.length ? { assignments } : {}),
      ...(typeof input.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
    },
  };
}

function parseManagerProjectStartRequest(
  input: unknown,
): { ok: true; value: ManagerProjectStartRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "project start body must be an object" };
  const phase = parseManagerRoundPhase(input.phase);
  if (input.phase !== undefined && !phase) {
    return { ok: false, error: "project start phase is invalid" };
  }
  const dispatchParsed = parseManagerRoundDispatchRequest({
    assignments: input.assignments,
    dryRun: input.dryRun,
  });
  if (!dispatchParsed.ok) return dispatchParsed;
  return {
    ok: true,
    value: {
      ...(typeof input.title === "string" && input.title.trim()
        ? { title: input.title.trim() }
        : {}),
      ...(typeof input.objective === "string" && input.objective.trim()
        ? { objective: input.objective.trim() }
        : {}),
      ...(phase ? { phase } : {}),
      ...(typeof input.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
      ...(dispatchParsed.value.assignments
        ? { assignments: dispatchParsed.value.assignments }
        : {}),
    },
  };
}

function parseManagerRoundReviewRequest(
  input: unknown,
): { ok: true; value: ManagerRoundReviewRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "round review body must be an object" };
  const action = input.action;
  if (
    action !== "accept" &&
    action !== "request_changes" &&
    action !== "user_check_required" &&
    action !== "replan" &&
    action !== "stop"
  ) {
    return { ok: false, error: "round review action is invalid" };
  }
  return {
    ok: true,
    value: {
      action,
      ...(typeof input.summary === "string" && input.summary.trim()
        ? { summary: input.summary.trim() }
        : {}),
      ...(typeof input.nextObjective === "string" && input.nextObjective.trim()
        ? { nextObjective: input.nextObjective.trim() }
        : {}),
      ...(typeof input.createNextRound === "boolean"
        ? { createNextRound: input.createNextRound }
        : {}),
    },
  };
}

function parseManagerDirectionChangeRequest(
  input: unknown,
): { ok: true; value: ManagerDirectionChangeRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "direction change body must be an object" };
  const requestedChange =
    typeof input.requestedChange === "string" ? input.requestedChange.trim() : "";
  if (!requestedChange) return { ok: false, error: "direction change is required" };
  const currentRoundAction =
    input.currentRoundAction === "keep" ||
    input.currentRoundAction === "cancel" ||
    input.currentRoundAction === "supersede"
      ? input.currentRoundAction
      : undefined;
  if (input.currentRoundAction !== undefined && !currentRoundAction) {
    return { ok: false, error: "direction change round action is invalid" };
  }
  return {
    ok: true,
    value: {
      requestedChange,
      ...(typeof input.impact === "string" && input.impact.trim()
        ? { impact: input.impact.trim() }
        : {}),
      ...(typeof input.affectedProtocol === "string" && input.affectedProtocol.trim()
        ? { affectedProtocol: input.affectedProtocol.trim() }
        : {}),
      ...(typeof input.affectedArtifacts === "string" && input.affectedArtifacts.trim()
        ? { affectedArtifacts: input.affectedArtifacts.trim() }
        : {}),
      ...(currentRoundAction ? { currentRoundAction } : {}),
      ...(typeof input.nextObjective === "string" && input.nextObjective.trim()
        ? { nextObjective: input.nextObjective.trim() }
        : {}),
    },
  };
}

function parseManagerProjectCompleteRequest(
  input: unknown,
): { ok: true; value: ManagerProjectCompleteRequest } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "project completion body must be an object" };
  return {
    ok: true,
    value: {
      ...(typeof input.summary === "string" && input.summary.trim()
        ? { summary: input.summary.trim() }
        : {}),
      ...(typeof input.goalMatched === "boolean" ? { goalMatched: input.goalMatched } : {}),
      ...(typeof input.acceptedByUser === "boolean"
        ? { acceptedByUser: input.acceptedByUser }
        : {}),
      ...(typeof input.remainingRisks === "string" && input.remainingRisks.trim()
        ? { remainingRisks: input.remainingRisks.trim() }
        : {}),
      ...(typeof input.verificationEvidence === "string" && input.verificationEvidence.trim()
        ? { verificationEvidence: input.verificationEvidence.trim() }
        : {}),
      ...(Array.isArray(input.artifacts) ? { artifacts: stringList(input.artifacts) } : {}),
    },
  };
}

function parseManagerAgentRole(value: unknown): ManagerAgentRole | undefined {
  if (typeof value !== "string") return undefined;
  const role = value.trim();
  if (!role || role.length > 64) return undefined;
  return role;
}

function parseManagerProjectStatus(value: unknown): ManagerProjectStatus | undefined {
  if (
    value === "planning" ||
    value === "running" ||
    value === "blocked" ||
    value === "reviewing" ||
    value === "completed" ||
    value === "archived"
  ) {
    return value;
  }
  return undefined;
}

function parseManagerDecisionStatus(value: unknown): ManagerDecisionStatus | undefined {
  if (value === "active" || value === "superseded" || value === "archived") return value;
  return undefined;
}

function parseManagerBlockerSeverity(value: unknown): ManagerBlockerSeverity | undefined {
  if (value === "info" || value === "warning" || value === "error") return value;
  return undefined;
}

function parseManagerBlockerRequiredAction(
  value: unknown,
): ManagerBlockerRequiredAction | undefined {
  if (value === "user" || value === "manager" || value === "worker" || value === "none") {
    return value;
  }
  return undefined;
}

function parseManagerBlockerSource(value: unknown): ManagerBlockerSource | undefined {
  if (value === "manager" || value === "browser" || value === "worker" || value === "system") {
    return value;
  }
  return undefined;
}

function parseManagerArtifactStatus(value: unknown): ManagerArtifactStatus | undefined {
  if (
    value === "active" ||
    value === "draft" ||
    value === "obsolete" ||
    value === "failed" ||
    value === "missing"
  ) {
    return value;
  }
  return undefined;
}

function parseManagerArtifactKind(value: unknown): ManagerArtifactKind | undefined {
  if (
    value === "protocol" ||
    value === "report" ||
    value === "code" ||
    value === "config" ||
    value === "log" ||
    value === "document" ||
    value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function parseManagerDecisionTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    const tag = typeof item === "string" ? item.trim().slice(0, 48) : "";
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function projectStatusFromRoundStatus(status: ManagerRoundStatus): ManagerProjectStatus {
  if (status === "completed") return "reviewing";
  if (status === "blocked" || status === "failed" || status === "cancelled") return "blocked";
  if (status === "planned") return "planning";
  return "running";
}

function projectFlowStageFromRoundStatus(status: ManagerRoundStatus): ManagerCommandFlowStage {
  if (status === "completed") return "review";
  if (status === "blocked" || status === "failed" || status === "cancelled") return "replanning";
  if (status === "planned") return "protocol_ready";
  return "running";
}

function isManagerTaskKind(value: unknown): value is ManagerTaskKind {
  return (
    value === "diagnose" ||
    value === "update-server" ||
    value === "update-device" ||
    value === "update-all" ||
    value === "restart-server" ||
    value === "restart-device" ||
    value === "repair-registration" ||
    value === "run-worker"
  );
}

function maxManagerSeverity(
  values: Array<DiagnosticSeverity | undefined>,
): "ok" | "warn" | "error" | "unknown" {
  if (values.includes("error")) return "error";
  if (values.includes("warn")) return "warn";
  if (values.includes("unknown")) return "unknown";
  return "ok";
}

function taskStep(input: Omit<ManagerTask["steps"][number], "severity" | "source">) {
  return normalizeDiagnosticStep({
    ...input,
    source: "server",
    lastCheckedAt: input.lastCheckedAt ?? new Date().toISOString(),
  });
}

function clampListLimit(value: string | undefined): number {
  const n = Number(value ?? "50");
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function parseManagerEventSeq(value: string | undefined): number {
  const n = Number(value ?? "0");
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface ManagerSessionReadRequest {
  deviceId?: string;
  behaviorInstanceId?: string;
  sessionId: string;
  cwd?: string;
  projectsDir?: string;
  maxBytes?: number;
  eventLimit?: number;
  listLimit: number;
}

interface ManagerSessionReadAttempt {
  deviceId: string;
  label: string;
  daemonUrl: string;
  stage: string;
  error: string;
  status?: number;
}

interface ManagerBehaviorDescriptor {
  instanceId: string;
  name?: string;
  packageName?: string;
  version?: string;
  loadedAt?: string;
}

interface ManagerSessionCandidate {
  sessionId: string;
  cwd: string;
  title?: string;
  fullTitle?: string;
  modifiedAt?: string;
  fileSize?: number;
}

class ManagerSessionReadError extends Error {
  constructor(
    readonly stage: string,
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ManagerSessionReadError";
  }
}

const MANAGER_SESSION_HYGIENE_CATEGORIES: ManagerSessionHygieneCategory[] = [
  "current_manager",
  "manager_history",
  "internal_only",
  "worker_session",
  "orphan",
  "unreadable",
  "unknown",
];

function parseManagerSessionHygieneCleanupRequest(
  value: unknown,
): { ok: true; value: ManagerSessionHygieneCleanupRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "JSON object body is required" };
  const categoriesRaw = value.categories;
  let categories: ManagerSessionHygieneCategory[] | undefined;
  if (categoriesRaw !== undefined) {
    if (!Array.isArray(categoriesRaw)) {
      return { ok: false, error: "categories must be an array" };
    }
    categories = [];
    for (const item of categoriesRaw) {
      if (!isManagerSessionHygieneCategory(item)) {
        return { ok: false, error: `unsupported hygiene category: ${String(item)}` };
      }
      categories.push(item);
    }
  }
  return {
    ok: true,
    value: {
      dryRun: value.dryRun === true,
      ...(categories ? { categories } : {}),
    },
  };
}

function isManagerSessionHygieneCategory(value: unknown): value is ManagerSessionHygieneCategory {
  return (
    typeof value === "string" &&
    MANAGER_SESSION_HYGIENE_CATEGORIES.includes(value as ManagerSessionHygieneCategory)
  );
}

function parseManagerSessionReadRequest(
  value: unknown,
): { ok: true; value: ManagerSessionReadRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "JSON object body is required" };
  const sessionId = parseRequiredStringField(value, "sessionId");
  if (!sessionId.ok) return sessionId;
  const deviceId = parseOptionalStringField(value, "deviceId");
  if (!deviceId.ok) return deviceId;
  const behaviorInstanceId = parseOptionalStringField(value, "behaviorInstanceId");
  if (!behaviorInstanceId.ok) return behaviorInstanceId;
  const cwd = parseOptionalStringField(value, "cwd");
  if (!cwd.ok) return cwd;
  const projectsDir = parseOptionalStringField(value, "projectsDir");
  if (!projectsDir.ok) return projectsDir;
  const maxBytes = parseOptionalPositiveIntegerField(value, "maxBytes", 64 * 1024 * 1024);
  if (!maxBytes.ok) return maxBytes;
  const eventLimit = parseOptionalPositiveIntegerField(value, "eventLimit", 10_000);
  if (!eventLimit.ok) return eventLimit;
  const listLimit = parseOptionalPositiveIntegerField(value, "listLimit", 5_000);
  if (!listLimit.ok) return listLimit;
  return {
    ok: true,
    value: {
      sessionId: sessionId.value,
      listLimit: listLimit.value ?? 1_000,
      ...(deviceId.value ? { deviceId: deviceId.value } : {}),
      ...(behaviorInstanceId.value ? { behaviorInstanceId: behaviorInstanceId.value } : {}),
      ...(cwd.value ? { cwd: cwd.value } : {}),
      ...(projectsDir.value ? { projectsDir: projectsDir.value } : {}),
      ...(maxBytes.value !== undefined ? { maxBytes: maxBytes.value } : {}),
      ...(eventLimit.value !== undefined ? { eventLimit: eventLimit.value } : {}),
    },
  };
}

function parseRequiredStringField(
  record: Record<string, unknown>,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = record[field];
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: `${field} is required` };
  }
  return { ok: true, value: raw.trim() };
}

function parseOptionalStringField(
  record: Record<string, unknown>,
  field: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  const raw = record[field];
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = raw.trim();
  return trimmed ? { ok: true, value: trimmed } : { ok: true };
}

function parseOptionalPositiveIntegerField(
  record: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value?: number } | { ok: false; error: string } {
  const raw = record[field];
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: `${field} must be a positive integer` };
  }
  return { ok: true, value: Math.max(1, Math.min(max, Math.floor(n))) };
}

async function readManagerSessionTranscript(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  registry: DeviceRegistry,
  localToken: string | undefined,
  request: ManagerSessionReadRequest,
): Promise<
  | {
      ok: true;
      value: {
        device: { id: string; label: string; daemonUrl: string };
        behavior: ManagerBehaviorDescriptor;
        resolvedCwd: string;
        session?: ManagerSessionCandidate;
        transcript: unknown;
        attempts: ManagerSessionReadAttempt[];
      };
    }
  | { ok: false; status: number; error: string; attempts: ManagerSessionReadAttempt[] }
> {
  const attempts: ManagerSessionReadAttempt[] = [];
  const devices = request.deviceId
    ? [registry.get(request.deviceId)].filter(Boolean)
    : registry.list();
  if (request.deviceId && devices.length === 0) {
    return { ok: false, status: 404, error: `unknown device: ${request.deviceId}`, attempts };
  }
  if (devices.length === 0) {
    return { ok: false, status: 404, error: "no registered devices", attempts };
  }

  for (const device of devices as Device[]) {
    try {
      const behaviors = await readDeviceBehaviors(
        fetchImpl,
        device,
        daemonToken(device, localToken),
      );
      const behavior = selectClaudeBehavior(behaviors, request.behaviorInstanceId);
      if (!behavior) {
        throw new ManagerSessionReadError(
          "behaviors",
          404,
          request.behaviorInstanceId
            ? `behavior not found: ${request.behaviorInstanceId}`
            : "remote-claude behavior is not loaded",
        );
      }

      let resolvedCwd = request.cwd;
      let session: ManagerSessionCandidate | undefined;
      if (!resolvedCwd) {
        const sessions = await listDeviceSessions(fetchImpl, device, behavior, localToken, request);
        session = selectSessionCandidate(sessions, request.sessionId);
        if (!session) {
          throw new ManagerSessionReadError(
            "sessions.list",
            404,
            `session not found in listed sessions: ${request.sessionId}`,
          );
        }
        resolvedCwd = session.cwd;
      }

      const transcript = await callDeviceBehavior(fetchImpl, device, behavior, localToken, {
        method: "sessions.read",
        params: buildSessionReadParams(request, resolvedCwd),
      });
      return {
        ok: true,
        value: {
          device: publicManagerDevice(device),
          behavior,
          resolvedCwd,
          ...(session ? { session } : {}),
          transcript,
          attempts,
        },
      };
    } catch (error) {
      attempts.push(managerSessionReadAttempt(device, error));
      if (request.deviceId) break;
    }
  }

  return {
    ok: false,
    status: managerSessionReadFailureStatus(attempts),
    error: `session transcript not found: ${request.sessionId}`,
    attempts,
  };
}

async function buildManagerSessionHygieneReport(input: {
  repoRoot: string;
  registry: DeviceRegistry;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  localToken: string | undefined;
}): Promise<ManagerSessionHygieneReport> {
  const generatedAt = new Date().toISOString();
  const managerCwd = join(input.repoRoot, MANAGER_ASSISTANT_DIR);
  const conversation = await readManagerAssistantConversationState(input.repoRoot).catch(
    () => null,
  );
  const errors: ManagerSessionHygieneReport["errors"] = [];
  const items: ManagerSessionHygieneItem[] = [];
  const device = input.registry.list().find(isServerDevice) ?? input.registry.list()[0];

  if (!device) {
    errors.push({ stage: "devices", error: "no registered devices" });
    return {
      generatedAt,
      managerCwd,
      ...(conversation?.sessionId ? { managerSessionId: conversation.sessionId } : {}),
      summary: summarizeManagerSessionHygiene([], conversation?.sessionId),
      items: [],
      errors,
    };
  }

  try {
    const behaviors = await readDeviceBehaviors(
      input.fetchImpl,
      device,
      daemonToken(device, input.localToken),
    );
    const behavior = selectClaudeBehavior(behaviors, undefined);
    if (!behavior) {
      errors.push({
        deviceId: device.id,
        deviceLabel: device.label,
        stage: "behaviors",
        error: "remote-claude behavior is not loaded",
      });
      return {
        generatedAt,
        managerCwd,
        ...(conversation?.sessionId ? { managerSessionId: conversation.sessionId } : {}),
        summary: summarizeManagerSessionHygiene([], conversation?.sessionId),
        items,
        errors,
      };
    }

    const sessionMap = new Map<string, ManagerSessionCandidate>();
    const addSessions = (sessions: ManagerSessionCandidate[]) => {
      for (const session of sessions) {
        sessionMap.set(`${session.sessionId}\u0000${normalizeManagerPath(session.cwd)}`, session);
      }
    };
    addSessions(
      await listDeviceSessionsForHygiene(input.fetchImpl, device, behavior, input.localToken, {
        cwd: managerCwd,
        limit: 300,
        dedupeSessionIds: false,
      }),
    );
    addSessions(
      (
        await listDeviceSessionsForHygiene(input.fetchImpl, device, behavior, input.localToken, {
          limit: 500,
          dedupeSessionIds: false,
        })
      ).filter((session) => isWorkerLikeSession(session)),
    );

    for (const session of [...sessionMap.values()].sort(compareHygieneSessions)) {
      items.push(
        classifyManagerSessionForHygiene(session, {
          device,
          behavior,
          managerCwd,
          ...(conversation?.sessionId ? { managerSessionId: conversation.sessionId } : {}),
        }),
      );
    }
  } catch (error) {
    errors.push({
      deviceId: device.id,
      deviceLabel: device.label,
      stage: error instanceof ManagerSessionReadError ? error.stage : "sessions.hygiene",
      error: errorMessage(error),
    });
  }

  return {
    generatedAt,
    managerCwd,
    ...(conversation?.sessionId ? { managerSessionId: conversation.sessionId } : {}),
    summary: summarizeManagerSessionHygiene(items, conversation?.sessionId),
    items,
    errors,
  };
}

async function cleanupManagerSessionHygiene(input: {
  repoRoot: string;
  registry: DeviceRegistry;
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  localToken: string | undefined;
  request: ManagerSessionHygieneCleanupRequest;
}): Promise<ManagerSessionHygieneCleanupResponse> {
  const dryRun = input.request.dryRun === true;
  const allowedCategories = new Set<ManagerSessionHygieneCategory>(
    input.request.categories?.length
      ? input.request.categories
      : ["internal_only", "manager_history"],
  );
  const initialReport = await buildManagerSessionHygieneReport(input);
  const targets = dedupeHygieneCleanupTargets(
    initialReport.items.filter(
      (item) => item.action === "cleanup" && allowedCategories.has(item.category),
    ),
  );
  const skipped = initialReport.items.filter(
    (item) => item.action !== "cleanup" || !allowedCategories.has(item.category),
  );
  const deleted: ManagerSessionHygieneCleanupResponse["deleted"] = [];
  const failures: ManagerSessionHygieneCleanupResponse["failures"] = [];

  if (!dryRun) {
    for (const target of targets) {
      const device = input.registry.get(target.deviceId);
      if (!device) {
        failures.push({
          deviceId: target.deviceId,
          deviceLabel: target.deviceLabel,
          sessionId: target.sessionId,
          category: target.category,
          error: "device is no longer registered",
        });
        continue;
      }
      try {
        const behaviors = await readDeviceBehaviors(
          input.fetchImpl,
          device,
          daemonToken(device, input.localToken),
        );
        const behavior =
          behaviors.find((candidate) => candidate.instanceId === target.behaviorInstanceId) ??
          selectClaudeBehavior(behaviors, target.behaviorInstanceId);
        if (!behavior) throw new Error("remote-claude behavior is no longer loaded");
        const result = await callDeviceBehavior(
          input.fetchImpl,
          device,
          behavior,
          input.localToken,
          {
            method: "sessions.deleteBySessionId",
            params: { sessionId: target.sessionId },
          },
        );
        deleted.push({
          deviceId: target.deviceId,
          deviceLabel: target.deviceLabel,
          sessionId: target.sessionId,
          category: target.category,
          result,
        });
      } catch (error) {
        failures.push({
          deviceId: target.deviceId,
          deviceLabel: target.deviceLabel,
          sessionId: target.sessionId,
          category: target.category,
          error: errorMessage(error),
        });
      }
    }
  }

  const report = dryRun ? initialReport : await buildManagerSessionHygieneReport(input);
  return {
    generatedAt: new Date().toISOString(),
    dryRun,
    deleted,
    skipped: dryRun ? [...skipped, ...targets] : skipped,
    failures,
    report,
  };
}

async function listDeviceSessionsForHygiene(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  behavior: ManagerBehaviorDescriptor,
  localToken: string | undefined,
  params: {
    cwd?: string;
    limit: number;
    dedupeSessionIds: boolean;
  },
): Promise<ManagerSessionCandidate[]> {
  const payload = await callDeviceBehavior(fetchImpl, device, behavior, localToken, {
    method: "sessions.list",
    params: {
      limit: params.limit,
      dedupeSessionIds: params.dedupeSessionIds,
      ...(params.cwd ? { cwd: params.cwd } : {}),
    },
  });
  return normalizeSessionCandidates(payload);
}

function classifyManagerSessionForHygiene(
  session: ManagerSessionCandidate,
  context: {
    device: Device;
    behavior: ManagerBehaviorDescriptor;
    managerCwd: string;
    managerSessionId?: string;
  },
): ManagerSessionHygieneItem {
  const isManagerCwd =
    normalizeManagerPath(session.cwd) === normalizeManagerPath(context.managerCwd);
  const isCurrentManager =
    isManagerCwd &&
    Boolean(context.managerSessionId) &&
    session.sessionId === context.managerSessionId;
  const base = {
    deviceId: context.device.id,
    deviceLabel: context.device.label,
    behaviorInstanceId: context.behavior.instanceId,
    sessionId: session.sessionId,
    cwd: session.cwd,
    ...(session.title ? { title: session.title } : {}),
    ...(session.fullTitle ? { fullTitle: session.fullTitle } : {}),
    ...(session.modifiedAt ? { modifiedAt: session.modifiedAt } : {}),
    ...(typeof session.fileSize === "number" ? { fileSize: session.fileSize } : {}),
  };
  if (isCurrentManager) {
    return {
      ...base,
      category: "current_manager",
      action: "preserve",
      reason: "current persistent manager assistant conversation",
    };
  }
  if (isInternalCommandOnlySession(session, isManagerCwd)) {
    return {
      ...base,
      category: "internal_only",
      action: "cleanup",
      reason: "manager cwd session created by a local command/status probe",
    };
  }
  if (isManagerCwd) {
    const cleanupOldManagerSession = Boolean(context.managerSessionId);
    return {
      ...base,
      category: "manager_history",
      action: cleanupOldManagerSession ? "cleanup" : "preserve",
      reason: cleanupOldManagerSession
        ? "older manager assistant conversation superseded by the persistent current session"
        : "older manager assistant conversation; no current session pointer is available",
    };
  }
  if (isWorkerLikeSession(session)) {
    return {
      ...base,
      category: "worker_session",
      action: "preserve",
      reason: "worker/orchestration transcript; preserve unless explicitly reviewed",
    };
  }
  return {
    ...base,
    category: "orphan",
    action: "preserve",
    reason: "not linked to the current manager session; preserve by default",
  };
}

function isInternalCommandOnlySession(
  session: ManagerSessionCandidate,
  isManagerCwd: boolean,
): boolean {
  if (!isManagerCwd) return false;
  const text = `${session.title ?? ""}\n${session.fullTitle ?? ""}`.toLowerCase();
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return false;
  return (
    compact === "context" ||
    compact === "/context" ||
    compact === "status" ||
    compact === "/status" ||
    compact === "usage" ||
    compact === "/usage" ||
    compact.includes("<local-command-caveat>") ||
    compact.includes("<command-name>/context</command-name>") ||
    compact.includes("<command-name>/status</command-name>") ||
    compact.includes("<command-name>/usage</command-name>")
  );
}

function isWorkerLikeSession(session: ManagerSessionCandidate): boolean {
  const text = `${session.title ?? ""}\n${session.fullTitle ?? ""}\n${session.cwd}`.toLowerCase();
  return (
    text.includes("role:") ||
    text.includes("orchestration") ||
    text.includes("agent") ||
    text.includes("worker")
  );
}

function dedupeHygieneCleanupTargets(
  items: ManagerSessionHygieneItem[],
): ManagerSessionHygieneItem[] {
  const result = new Map<string, ManagerSessionHygieneItem>();
  for (const item of items) {
    result.set(`${item.deviceId}\u0000${item.behaviorInstanceId}\u0000${item.sessionId}`, item);
  }
  return [...result.values()];
}

function summarizeManagerSessionHygiene(
  items: ManagerSessionHygieneItem[],
  currentManagerSession: string | undefined,
): ManagerSessionHygieneReport["summary"] {
  const categories = Object.fromEntries(
    MANAGER_SESSION_HYGIENE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ManagerSessionHygieneCategory, number>;
  for (const item of items) categories[item.category] += 1;
  return {
    total: items.length,
    preserved: items.filter((item) => item.action === "preserve").length,
    cleanupCandidates: items.filter((item) => item.action === "cleanup").length,
    ...(currentManagerSession ? { currentManagerSession } : {}),
    categories,
  };
}

function compareHygieneSessions(left: ManagerSessionCandidate, right: ManagerSessionCandidate) {
  return (
    Date.parse(right.modifiedAt ?? "") - Date.parse(left.modifiedAt ?? "") ||
    right.sessionId.localeCompare(left.sessionId)
  );
}

function normalizeManagerPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function publicManagerDevice(device: Device): { id: string; label: string; daemonUrl: string } {
  return { id: device.id, label: device.label, daemonUrl: device.daemonUrl };
}

async function readDeviceBehaviors(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
): Promise<ManagerBehaviorDescriptor[]> {
  const payload = await fetchDeviceJson(fetchImpl, device, `${device.daemonUrl}/behaviors`, {
    method: "GET",
    stage: "behaviors",
    ...(token ? { token } : {}),
  });
  return normalizeBehaviorDescriptors(payload);
}

async function listDeviceSessions(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  behavior: ManagerBehaviorDescriptor,
  localToken: string | undefined,
  request: ManagerSessionReadRequest,
): Promise<ManagerSessionCandidate[]> {
  const payload = await callDeviceBehavior(fetchImpl, device, behavior, localToken, {
    method: "sessions.list",
    params: {
      limit: request.listLimit,
      dedupeSessionIds: false,
      ...(request.projectsDir ? { projectsDir: request.projectsDir } : {}),
    },
  });
  return normalizeSessionCandidates(payload);
}

function buildSessionReadParams(
  request: ManagerSessionReadRequest,
  cwd: string,
): Record<string, unknown> {
  return {
    cwd,
    sessionId: request.sessionId,
    ...(request.projectsDir ? { projectsDir: request.projectsDir } : {}),
    ...(request.maxBytes !== undefined ? { maxBytes: request.maxBytes } : {}),
    ...(request.eventLimit !== undefined ? { eventLimit: request.eventLimit } : {}),
  };
}

async function callDeviceBehavior(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  behavior: ManagerBehaviorDescriptor,
  localToken: string | undefined,
  input: { method: string; params?: unknown },
): Promise<unknown> {
  const token = daemonToken(device, localToken);
  const payload = await fetchDeviceJson(
    fetchImpl,
    device,
    `${device.daemonUrl}/behaviors/${encodeURIComponent(behavior.instanceId)}/request`,
    {
      method: "POST",
      stage: input.method,
      body: JSON.stringify(input.params !== undefined ? input : { method: input.method }),
      ...(token ? { token } : {}),
    },
  );
  if (isRecord(payload) && isRecord(payload.error)) {
    throw new ManagerSessionReadError(
      input.method,
      behaviorErrorStatus(payload.error),
      payloadErrorMessage(payload) ?? `behavior method failed: ${input.method}`,
    );
  }
  return isRecord(payload) && "result" in payload ? payload.result : payload;
}

async function fetchDeviceJson(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  url: string,
  input: { method: string; token?: string; stage: string; body?: string },
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (input.body !== undefined) headers["content-type"] = "application/json";
  if (input.token) headers.authorization = `Bearer ${input.token}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: input.method,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  } catch (error) {
    throw new ManagerSessionReadError(
      input.stage,
      502,
      `cannot reach daemon ${device.label}: ${errorMessage(error)}`,
    );
  }
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new ManagerSessionReadError(
      input.stage,
      response.status,
      payloadErrorMessage(payload) ?? `daemon returned HTTP ${response.status}`,
    );
  }
  return payload;
}

function normalizeBehaviorDescriptors(value: unknown): ManagerBehaviorDescriptor[] {
  if (!Array.isArray(value)) return [];
  const result: ManagerBehaviorDescriptor[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.instanceId !== "string" || !item.instanceId.trim()) {
      continue;
    }
    result.push({
      instanceId: item.instanceId,
      ...(typeof item.name === "string" ? { name: item.name } : {}),
      ...(typeof item.packageName === "string" ? { packageName: item.packageName } : {}),
      ...(typeof item.version === "string" ? { version: item.version } : {}),
      ...(typeof item.loadedAt === "string" ? { loadedAt: item.loadedAt } : {}),
    });
  }
  return result;
}

function selectClaudeBehavior(
  behaviors: ManagerBehaviorDescriptor[],
  preferredInstanceId: string | undefined,
): ManagerBehaviorDescriptor | undefined {
  if (preferredInstanceId) {
    return behaviors.find((behavior) => behavior.instanceId === preferredInstanceId);
  }
  return (
    behaviors.find((behavior) => behavior.instanceId === "remote-claude") ??
    behaviors.find((behavior) => behavior.name === "remote-claude") ??
    behaviors.find((behavior) => behavior.packageName === "remote-claude")
  );
}

function normalizeSessionCandidates(value: unknown): ManagerSessionCandidate[] {
  if (!Array.isArray(value)) return [];
  const result: ManagerSessionCandidate[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.sessionId !== "string" ||
      !item.sessionId.trim() ||
      typeof item.cwd !== "string" ||
      !item.cwd.trim()
    ) {
      continue;
    }
    result.push({
      sessionId: item.sessionId,
      cwd: item.cwd,
      ...(typeof item.title === "string" ? { title: item.title } : {}),
      ...(typeof item.fullTitle === "string" ? { fullTitle: item.fullTitle } : {}),
      ...(typeof item.modifiedAt === "string" ? { modifiedAt: item.modifiedAt } : {}),
      ...(typeof item.fileSize === "number" ? { fileSize: item.fileSize } : {}),
    });
  }
  return result;
}

function selectSessionCandidate(
  sessions: ManagerSessionCandidate[],
  sessionId: string,
): ManagerSessionCandidate | undefined {
  return sessions
    .filter((session) => session.sessionId === sessionId)
    .sort(
      (left, right) => Date.parse(right.modifiedAt ?? "") - Date.parse(left.modifiedAt ?? ""),
    )[0];
}

function managerSessionReadAttempt(device: Device, error: unknown): ManagerSessionReadAttempt {
  if (error instanceof ManagerSessionReadError) {
    return {
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      stage: error.stage,
      error: error.message,
      ...(error.status ? { status: error.status } : {}),
    };
  }
  return {
    deviceId: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    stage: "unknown",
    error: errorMessage(error),
  };
}

function managerSessionReadFailureStatus(attempts: ManagerSessionReadAttempt[]): number {
  if (attempts.some((attempt) => (attempt.status ?? 0) >= 500)) {
    return 502;
  }
  return 404;
}

function behaviorErrorStatus(error: Record<string, unknown>): number {
  if (typeof error.code === "number" && error.code >= 400 && error.code < 600) {
    return error.code;
  }
  const message = typeof error.message === "string" ? error.message : "";
  return /enoent|not found|missing/i.test(message) ? 404 : 502;
}

function payloadErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return typeof payload === "string" && payload.trim() ? payload : undefined;
  }
  if (typeof payload.error === "string") return payload.error;
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  if (typeof payload.message === "string") return payload.message;
  return undefined;
}

function stateFromDeviceUpdateResponse(status: number, payload: unknown): ManagerTaskState {
  if (isRecord(payload)) {
    if (payload.state === "pending_until_device_online" || payload.state === "queued") {
      return "waiting_for_device";
    }
    if (payload.state === "running") return "running";
    if (payload.state === "restart_required") return "restart_required";
    if (payload.state === "failed" || typeof payload.error === "string") return "failed";
    if (payload.ok === true || payload.state === "succeeded") return "succeeded";
  }
  if (status >= 500) return "failed";
  if (status === 202) return "waiting_for_device";
  if (status >= 400) return "failed";
  return "succeeded";
}

function updateSummaryFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.warning === "string") return payload.warning;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.state === "string") return `Device update state: ${payload.state}.`;
  if (payload.ok === true) return "Device update request completed.";
  return undefined;
}

function classifyRegistrationFailure(step: ManagerTask["steps"][number] | undefined): string {
  const text = `${step?.id ?? ""} ${step?.summary ?? ""} ${step?.detail ?? ""}`.toLowerCase();
  if (!step) return "unknown";
  if (text.includes("site token") || text.includes("401") || text.includes("unauthorized")) {
    return "site-token-rejected";
  }
  if (text.includes("firewall") || text.includes("timed out") || text.includes("timeout")) {
    return "firewall-or-route-timeout";
  }
  if (text.includes("tailscale")) return "tailscale-unavailable";
  if (text.includes("port-owned-by-other-process") || text.includes("non-deskrelay process")) {
    return "port-owned-by-other-process";
  }
  if (text.includes("stale") || text.includes("different daemon token")) {
    return "stale-connector-token";
  }
  if (text.includes("localhost") || text.includes("127.0.0.1")) return "localhost-registration";
  if (text.includes("git") || text.includes("bun")) return "installer-dependency";
  return step.id || "unknown";
}

function actionFromRegistrationFailure(
  step: ManagerTask["steps"][number] | undefined,
  classification: string,
): string | undefined {
  if (typeof step?.action === "string") return step.action;
  if (typeof step?.action === "object" && step.action.detail) return step.action.detail;
  if (classification === "site-token-rejected") {
    return "Copy the current Site token from the server page and rerun the registration command.";
  }
  if (classification === "firewall-or-route-timeout") {
    return "Allow the connector port through Windows Firewall or use Tailscale, then rerun registration.";
  }
  if (classification === "stale-connector-token") {
    return "Stop the stale connector process or rerun PowerShell as Administrator, then rerun registration.";
  }
  if (classification === "port-owned-by-other-process") {
    return "Close the non-DeskRelay process using the connector port or choose another connector port, then rerun registration.";
  }
  return undefined;
}

function isRetrySafeRegistrationClassification(classification: string): boolean {
  return (
    classification === "site-token-rejected" ||
    classification === "firewall-or-route-timeout" ||
    classification === "tailscale-unavailable" ||
    classification === "stale-connector-token" ||
    classification === "port-owned-by-other-process" ||
    classification === "localhost-registration"
  );
}

function buildSelfNetworkStatus(urls: AccessUrl[]): ManagerNetworkStatus {
  const generatedAt = new Date().toISOString();
  const preferredUrl = pickRemoteAccessUrl(urls);
  const port = getUrlPort(preferredUrl);
  const addresses = collectServerNetworkAddresses(port);
  const tailscaleAddresses = addresses.filter((address) => address.kind === "tailscale");
  const remoteUrls = urls.filter((row) => row.kind !== "This PC");
  const summary =
    remoteUrls.length === 0
      ? {
          severity: "warn" as const,
          message: "Only local server access is available.",
        }
      : {
          severity: "ok" as const,
          message: `Preferred server URL is ${preferredUrl}.`,
        };
  return {
    scope: "server",
    generatedAt,
    preferredUrl,
    tailscale: {
      detected: tailscaleAddresses.length > 0,
      addresses: tailscaleAddresses.map((address) => address.address),
      interfaceNames: [
        ...new Set(
          tailscaleAddresses
            .map((address) => address.interfaceName)
            .filter((name): name is string => Boolean(name)),
        ),
      ],
    },
    addresses,
    probes: urls.map((row) => ({
      id: `server.url.${row.kind.toLowerCase().replace(/\s+/g, "-")}`,
      label: row.kind,
      url: row.url,
      ok: true,
      hint:
        row.kind === "This PC"
          ? "Only this PC can use this URL."
          : "Use this URL from another PC on the same LAN or Tailscale network.",
    })),
    summary,
  };
}

async function buildSelfInstallStatus(
  options: SiteAppOptions,
  build: DeskRelayBuildInfo,
): Promise<ManagerInstallStatus> {
  const generatedAt = new Date().toISOString();
  const processStatus = options.selfServerProcess
    ? await options.selfServerProcess.status().catch(() => defaultSelfProcessStatus(build))
    : defaultSelfProcessStatus(build);
  const autostart = await readSelfServerAutostartStatus(options.selfServerAutostart);
  const update = options.selfServerUpdater
    ? await options.selfServerUpdater.status().catch((err) => ({
        state: "failed",
        error: (err as Error).message,
      }))
    : undefined;
  const reports = options.installReportStore
    ? await options.installReportStore.list(3).catch(() => [])
    : [];
  const updateSummary = update ? normalizeManagerUpdate(update) : undefined;
  const warn = autostart.supported && !autostart.installed;
  return {
    scope: "server",
    generatedAt,
    build,
    installed: true,
    running: processStatus.pid > 0,
    autostart,
    ...(updateSummary ? { update: updateSummary } : {}),
    ...(reports.length > 0
      ? {
          reports: reports.map((report) => ({
            id: report.id,
            receivedAt: report.receivedAt,
            status: report.status,
            ...(report.label ? { label: report.label } : {}),
          })),
        }
      : {}),
    summary: {
      severity: warn ? "warn" : "ok",
      message: warn
        ? "Server is running, but login autostart is not installed."
        : "Server is installed and running.",
    },
  };
}

function buildSelfSecurityBoundary(
  options: SiteAppOptions,
  urls: AccessUrl[],
): ManagerSecurityBoundary {
  const generatedAt = new Date().toISOString();
  const preferredUrl = pickRemoteAccessUrl(urls);
  const networkKind = daemonNetworkKind(preferredUrl);
  const warnings: string[] = [];
  if (!options.token) warnings.push("Site token is not configured.");
  if (networkKind === "public") warnings.push("Server URL appears to be public.");
  return {
    scope: "server",
    generatedAt,
    tokenBoundary: {
      siteTokenConfigured: Boolean(options.token),
      daemonTokenAvailable: Boolean(options.localDaemonToken),
      browserReceivesDaemonToken: false,
    },
    networkBoundary: {
      url: preferredUrl,
      kind: networkKind,
      publicExposure: networkKind === "public",
    },
    warnings,
    summary: {
      severity: warnings.length > 0 ? "warn" : "ok",
      message:
        warnings.length > 0
          ? `${warnings.length} security boundary warning(s).`
          : "Server security boundary is constrained.",
    },
  };
}

async function buildDeviceNetworkStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  authToken?: string,
): Promise<ManagerNetworkStatus> {
  const generatedAt = new Date().toISOString();
  const started = Date.now();
  const result = await fetchManagerJson<ManagerNetworkStatus>(
    fetchImpl,
    `${device.daemonUrl}/network/status`,
    authToken,
  );
  if (!result.ok) {
    const reachability = diagnoseConnectorReachability({
      daemonUrl: device.daemonUrl,
      status: result.status,
      error: result.error,
    });
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      generatedAt,
      registeredUrl: device.daemonUrl,
      tailscale: { detected: false, addresses: [], interfaceNames: [] },
      addresses: [],
      probes: [
        {
          id: "device.network-status",
          label: "Device network status",
          url: `${device.daemonUrl}/network/status`,
          ok: false,
          classification: reachability.kind,
          error: result.error,
          hint: reachability.hint,
          retrySafe: reachability.retrySafe,
        },
      ],
      summary: {
        severity: reachability.severity,
        message: reachability.summary,
      },
    };
  }
  const probes = normalizeDeviceNetworkProbes(
    [
      ...result.value.probes,
      {
        id: "server-to-device.network-status",
        label: "Server to connector API",
        url: `${device.daemonUrl}/network/status`,
        ok: true,
        status: 200,
        latencyMs: Date.now() - started,
      },
    ],
    daemonNetworkKind(device.daemonUrl),
  );
  return {
    ...result.value,
    targetId: device.id,
    targetLabel: device.label,
    registeredUrl: device.daemonUrl,
    probes,
    summary: normalizeDeviceNetworkSummary(result.value.summary, probes),
  };
}

function normalizeDeviceNetworkProbes(
  probes: ManagerNetworkStatus["probes"],
  registeredKind: ReturnType<typeof daemonNetworkKind>,
): ManagerNetworkStatus["probes"] {
  if (registeredKind !== "local") return probes;
  return probes.map((probe) => {
    if (probe.classification !== "local-bind-with-remote-address") return probe;
    return {
      ...probe,
      ok: true,
      state: "skipped",
      classification: "local-bind",
      hint: "Local server connectors can remain bound to localhost.",
    };
  });
}

function normalizeDeviceNetworkSummary(
  summary: ManagerNetworkStatus["summary"],
  probes: ManagerNetworkStatus["probes"],
): ManagerNetworkStatus["summary"] {
  const severity = worstNetworkProbeSeverity(probes);
  if (severity === "ok") return { severity: "ok", message: "Connector route verified." };
  if (summary.severity === severity) return summary;
  const probe = probes.find((candidate) => networkProbeSeverity(candidate) === severity);
  return {
    severity,
    message: probe?.hint || probe?.error || probe?.label || summary.message,
  };
}

function worstNetworkProbeSeverity(
  probes: ManagerNetworkStatus["probes"],
): ManagerNetworkStatus["summary"]["severity"] {
  if (probes.some((probe) => networkProbeSeverity(probe) === "error")) return "error";
  if (probes.some((probe) => networkProbeSeverity(probe) === "warn")) return "warn";
  if (probes.some((probe) => networkProbeSeverity(probe) === "unknown")) return "unknown";
  return "ok";
}

function networkProbeSeverity(probe: ManagerNetworkStatus["probes"][number]) {
  if (probe.state === "error") return "error";
  if (probe.state === "warn") return "warn";
  if (probe.state === "unknown") return probe.ok ? "unknown" : "error";
  if (probe.ok || probe.state === "ok" || probe.state === "skipped") return "ok";
  return "error";
}

async function buildDeviceInstallStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  authToken: string | undefined,
  queue: DeviceUpdateQueueStore | undefined,
): Promise<ManagerInstallStatus> {
  const generatedAt = new Date().toISOString();
  const [result, queueEntry] = await Promise.all([
    fetchManagerJson<ManagerInstallStatus>(
      fetchImpl,
      `${device.daemonUrl}/install/status`,
      authToken,
    ),
    queue?.get(device.id).catch(() => undefined),
  ]);
  if (!result.ok) {
    const legacyStatus = await fetchManagerJson<DaemonStatusPayload>(
      fetchImpl,
      `${device.daemonUrl}/status`,
      authToken,
    );
    if (legacyStatus.ok) {
      return {
        scope: "device",
        targetId: device.id,
        targetLabel: device.label,
        generatedAt,
        build: legacyStatus.value.build ?? getDeskRelayBuildInfo(),
        installed: true,
        running: true,
        ...(queueEntry
          ? {
              queue: {
                state: queueEntry.state,
                updatedAt: queueEntry.updatedAt,
                ...(queueEntry.error ? { error: queueEntry.error } : {}),
              },
            }
          : {}),
        summary: {
          severity: "warn",
          message:
            "Connector is running, but its install status API is unavailable. Update the connector if this device looks stale.",
        },
      };
    }
    const reachability = diagnoseConnectorReachability({
      daemonUrl: device.daemonUrl,
      status: result.status,
      error: result.error,
    });
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      generatedAt,
      build: getDeskRelayBuildInfo(),
      installed: false,
      running: false,
      ...(queueEntry
        ? {
            queue: {
              state: queueEntry.state,
              updatedAt: queueEntry.updatedAt,
              ...(queueEntry.error ? { error: queueEntry.error } : {}),
            },
          }
        : {}),
      summary: {
        severity: reachability.severity,
        message: `${reachability.summary}: ${result.error}`,
      },
    };
  }
  return {
    ...result.value,
    targetId: device.id,
    targetLabel: device.label,
    ...(queueEntry
      ? {
          queue: {
            state: queueEntry.state,
            updatedAt: queueEntry.updatedAt,
            ...(queueEntry.error ? { error: queueEntry.error } : {}),
          },
        }
      : {}),
  };
}

async function buildDeviceSecurityBoundary(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  authToken?: string,
): Promise<ManagerSecurityBoundary> {
  const generatedAt = new Date().toISOString();
  const result = await fetchManagerJson<ManagerSecurityBoundary>(
    fetchImpl,
    `${device.daemonUrl}/security/boundary`,
    authToken,
  );
  const registeredKind = daemonNetworkKind(device.daemonUrl);
  if (!result.ok) {
    return {
      scope: "device",
      targetId: device.id,
      targetLabel: device.label,
      generatedAt,
      tokenBoundary: {
        daemonTokenAvailable: Boolean(authToken),
        browserReceivesDaemonToken: false,
      },
      networkBoundary: {
        url: device.daemonUrl,
        kind: registeredKind,
        publicExposure: registeredKind === "public",
      },
      warnings: [result.error],
      summary: {
        severity: "error",
        message: `Cannot read security boundary from ${device.label}.`,
      },
    };
  }
  const warnings = [...result.value.warnings];
  if (registeredKind === "public" && !warnings.some((item) => item.includes("public"))) {
    warnings.push("Registered connector URL appears to be public.");
  }
  return {
    ...result.value,
    targetId: device.id,
    targetLabel: device.label,
    tokenBoundary: {
      ...result.value.tokenBoundary,
      daemonTokenAvailable: Boolean(authToken),
      browserReceivesDaemonToken: false,
    },
    networkBoundary: {
      ...result.value.networkBoundary,
      url: device.daemonUrl,
      kind: registeredKind,
      publicExposure: registeredKind === "public",
    },
    warnings,
    summary: {
      severity: warnings.length > 0 ? "warn" : result.value.summary.severity,
      message:
        warnings.length > 0
          ? `${warnings.length} security boundary warning(s).`
          : result.value.summary.message,
    },
  };
}

function normalizeSelfLogSource(value: string | undefined): string | undefined {
  const raw = (value ?? "server").trim().toLowerCase();
  if (raw === "server" || raw === "site-backend" || raw === "backend") return "site-backend";
  if (raw === "frontend" || raw === "site-frontend") return "site-frontend";
  if (raw === "daemon" || raw === "connector") return "daemon";
  return undefined;
}

function selfLogPath(options: SiteAppOptions, source: string): string {
  const logDir =
    options.logDir ?? process.env.CR_DEV_LOG_DIR ?? join(process.cwd(), ".self-server", "logs");
  if (source === "site-frontend") return join(logDir, "site-frontend.log");
  if (source === "daemon") return join(logDir, "daemon.log");
  return join(logDir, "site-backend.log");
}

function clampTail(value: string | undefined): number {
  const n = Number(value ?? "200");
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

function normalizeLogLevel(value: string | undefined): string | undefined {
  const level = (value ?? "").trim().toLowerCase();
  return level ? level : undefined;
}

function parseQueryBoolean(value: string | undefined): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveServerUpdateBranch(options: SiteAppOptions): string | undefined {
  const explicit = normalizeOptionalUpdateBranch(
    options.updateBranch ?? process.env.DESKRELAY_UPDATE_BRANCH,
  );
  if (explicit) return explicit;
  return normalizeOptionalUpdateBranch(readCurrentServerGitBranch());
}

function readCurrentServerGitBranch(): string | undefined {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    if (branch) return branch;
  } catch {
    // Branch forwarding is best-effort; connector can fall back to its current branch.
  }
  return undefined;
}

function normalizeOptionalUpdateBranch(value: string | undefined): string | undefined {
  const branch = String(value ?? "").trim();
  if (
    !branch ||
    branch.length > 200 ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    return undefined;
  }
  return branch;
}

async function readLogResponse(input: {
  scope: "server";
  source: string;
  path: string;
  tail: number;
  level?: string;
}): Promise<ManagerLogResponse> {
  const readAt = new Date().toISOString();
  try {
    await stat(input.path);
    const raw = await readFile(input.path, "utf8");
    const allLines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const nonEmptyLines = allLines.at(-1) === "" ? allLines.slice(0, -1) : allLines;
    const filtered = input.level
      ? nonEmptyLines.filter((line) => logLineMatchesLevel(line, input.level ?? ""))
      : nonEmptyLines;
    const lines = filtered.slice(-input.tail);
    return {
      scope: input.scope,
      source: input.source,
      path: input.path,
      exists: true,
      tail: input.tail,
      lines,
      truncated: filtered.length > lines.length,
      readAt,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      scope: input.scope,
      source: input.source,
      path: input.path,
      exists: false,
      tail: input.tail,
      lines: [],
      truncated: false,
      readAt,
      error: code === "ENOENT" ? "log file not found" : (err as Error).message,
    };
  }
}

function logLineMatchesLevel(line: string, level: string): boolean {
  try {
    const parsed = JSON.parse(line) as { level?: unknown };
    return typeof parsed.level === "string" && parsed.level.toLowerCase() === level;
  } catch {
    return line.toLowerCase().includes(level);
  }
}

function resolveDevice(id: string, registry: DeviceRegistry): Device | undefined {
  return registry.get(id);
}

function daemonToken(device: Device, fallback?: string): string | undefined {
  return device.authToken ?? fallback;
}

interface DeviceCleanupResult {
  attempted: boolean;
  ok: boolean;
  status?: number;
  error?: string;
}

interface DeviceCleanupEntry {
  id: string;
  label: string;
  daemonUrl: string;
  cleanup: DeviceCleanupResult;
}

async function unregisterDeviceWithCleanup(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  registry: DeviceRegistry,
  device: Device,
  localToken?: string,
): Promise<DeviceCleanupEntry> {
  const cleanup = await requestDaemonUninstall(fetchImpl, device, daemonToken(device, localToken));
  registry.unregister(device.id);
  return {
    id: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    cleanup,
  };
}

async function requestDaemonUninstall(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token?: string,
): Promise<DeviceCleanupResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetchImpl(`${device.daemonUrl}/system/uninstall`, {
      method: "POST",
      headers,
      body: JSON.stringify({ removeRepo: true }),
      signal: AbortSignal.timeout(CONNECTOR_CLEANUP_TIMEOUT_MS),
    });
    if (res.ok) return { attempted: true, ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    return {
      attempted: true,
      ok: false,
      status: res.status,
      ...(text ? { error: text.slice(0, 500) } : {}),
    };
  } catch (err) {
    return { attempted: true, ok: false, error: (err as Error).message };
  }
}

function enrichDeviceUpdateQueueEntry(
  entry: StoredDeviceUpdateEntry,
  fallbackCommand: string,
): StoredDeviceUpdateEntry {
  if (!fallbackCommand || entry.fallbackCommand || !requiresRegistrationRecovery(entry)) {
    return entry;
  }
  return { ...entry, fallbackCommand };
}

function requiresRegistrationRecovery(entry: StoredDeviceUpdateEntry): boolean {
  if (entry.recoveryKind === "branch_mismatch" || entry.recoveryKind === "registration_required") {
    return true;
  }
  const error = entry.error?.toLowerCase() ?? "";
  return (
    error.includes("re-run the registration command") ||
    error.includes("registration command") ||
    error.includes("branch switch required")
  );
}

async function requestDaemonSystemUpdate(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
  fallbackCommand: string,
  queue?: DeviceUpdateQueueStore,
  branch?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const now = new Date().toISOString();
  const existing = await queue?.get(device.id);
  const runningEntry = buildRunningDeviceUpdateEntry({
    target: device,
    existing,
    branch,
    now: new Date(now),
  });
  await queue?.upsert(runningEntry);
  let res: Response;
  try {
    res = await fetchImpl(`${device.daemonUrl}/system/update`, {
      method: "POST",
      headers,
      body: JSON.stringify(branch ? { branch } : {}),
    });
  } catch (err) {
    const error = `cannot reach daemon: ${(err as Error).message}`;
    await queue?.upsert(
      buildOfflineDeviceUpdateEntry({
        target: device,
        existing,
        branch,
        now: new Date(now),
        error,
        fallbackCommand,
      }),
    );
    return Response.json(
      {
        ok: true,
        state: "pending_until_device_online",
        warning: "connector is offline. Update will run automatically when this device is online.",
        error,
        fallbackCommand,
      },
      { status: 202 },
    );
  }

  const text = await res.text();
  const payload = parseJsonPayload(text);
  if (!res.ok) {
    const unavailable = res.status === 404 || res.status === 405 || res.status === 501;
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `daemon update failed with HTTP ${res.status}`;
    const finalError = unavailable
      ? "connector update API is unavailable on this device. Re-run the registration command."
      : error;
    await queue?.upsert({
      deviceId: device.id,
      label: device.label,
      daemonUrl: device.daemonUrl,
      state: "failed",
      requestedAt: runningEntry.requestedAt,
      ...(typeof runningEntry.attemptCount === "number"
        ? { attemptCount: runningEntry.attemptCount }
        : {}),
      ...(runningEntry.lastAttemptAt ? { lastAttemptAt: runningEntry.lastAttemptAt } : {}),
      completedAt: new Date().toISOString(),
      error: finalError,
      ...(unavailable ? { recoveryKind: "registration_required" as const, retryable: false } : {}),
      daemonStatus: res.status,
      fallbackCommand,
    });
    return Response.json(
      {
        ok: false,
        state: "failed",
        error: finalError,
        daemonStatus: res.status,
        ...(unavailable
          ? { recoveryKind: "registration_required" as const, retryable: false }
          : {}),
        fallbackCommand,
      },
      { status: unavailable ? 424 : res.status },
    );
  }

  const rawResponsePayload = isRecord(payload) ? payload : { ok: true };
  const actualBranch =
    typeof rawResponsePayload.branch === "string" ? rawResponsePayload.branch : undefined;
  const branchMismatch = Boolean(branch && actualBranch && actualBranch !== branch);
  const branchMismatchError =
    branchMismatch && branch
      ? `connector branch switch required: this legacy connector updated ${actualBranch} instead of ${branch}. Run the registration command shown below on that PC.`
      : undefined;
  const responsePayload = branchMismatch
    ? {
        ...rawResponsePayload,
        ok: false,
        state: "failed",
        expectedBranch: branch,
        actualBranch,
        recoveryKind: "branch_mismatch",
        retryable: false,
        error: branchMismatchError,
        fallbackCommand,
      }
    : rawResponsePayload;
  const finalState =
    normalizeUpdateState(responsePayload.state) ??
    (typeof responsePayload.restartRequestError === "string" ? "restart_required" : "succeeded");
  await queue?.upsert({
    deviceId: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    state: finalState,
    requestedAt: runningEntry.requestedAt,
    ...(typeof runningEntry.attemptCount === "number"
      ? { attemptCount: runningEntry.attemptCount }
      : {}),
    ...(runningEntry.lastAttemptAt ? { lastAttemptAt: runningEntry.lastAttemptAt } : {}),
    completedAt: new Date().toISOString(),
    ...(typeof responsePayload.error === "string" ? { error: responsePayload.error } : {}),
    ...(typeof responsePayload.warning === "string" ? { warning: responsePayload.warning } : {}),
    ...(responsePayload.recoveryKind === "branch_mismatch" ||
    responsePayload.recoveryKind === "registration_required"
      ? { recoveryKind: responsePayload.recoveryKind }
      : {}),
    ...(typeof responsePayload.retryable === "boolean"
      ? { retryable: responsePayload.retryable }
      : {}),
    ...(typeof responsePayload.expectedBranch === "string"
      ? { expectedBranch: responsePayload.expectedBranch }
      : {}),
    ...(typeof responsePayload.actualBranch === "string"
      ? { actualBranch: responsePayload.actualBranch }
      : {}),
    ...(isRecord(responsePayload.before)
      ? { before: responsePayload.before as Partial<DeskRelayBuildInfo> }
      : {}),
    ...(isRecord(responsePayload.after)
      ? { after: responsePayload.after as Partial<DeskRelayBuildInfo> }
      : {}),
    ...(typeof responsePayload.changed === "boolean" ? { changed: responsePayload.changed } : {}),
    ...(typeof responsePayload.restartScheduled === "boolean"
      ? { restartScheduled: responsePayload.restartScheduled }
      : {}),
    ...(typeof responsePayload.restartRequested === "boolean"
      ? { restartRequested: responsePayload.restartRequested }
      : {}),
    ...(typeof responsePayload.restartRequestError === "string"
      ? { restartRequestError: responsePayload.restartRequestError }
      : {}),
  });

  return Response.json(responsePayload, { status: branchMismatch ? 409 : 200 });
}

async function retryQueuedDeviceSystemUpdate(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  device: Device,
  token: string | undefined,
  fallbackCommand: string,
  queue: DeviceUpdateQueueStore,
  branch?: string,
): Promise<void> {
  const entry = await queue.get(device.id);
  if (entry?.state !== "pending_until_device_online") return;
  await requestDaemonSystemUpdate(fetchImpl, device, token, fallbackCommand, queue, branch);
}

function buildFallbackRegisterCommandForRequest(
  options: SiteAppOptions,
  requestUrl: string,
): string {
  if (!options.token) return "";
  const urls = getAccessUrls(options.selfHostUrl ?? requestUrl);
  const preferredUrl = pickRemoteAccessUrl(urls);
  return buildRegisterOtherPcCommand({
    siteUrl: preferredUrl,
    siteToken: options.token,
    branch: resolveServerUpdateBranch(options),
  });
}

function normalizeUpdateState(value: unknown): UpdateState | undefined {
  if (
    value === "not_started" ||
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "restart_required" ||
    value === "pending_until_device_online"
  ) {
    return value;
  }
  return undefined;
}

function parseJsonPayload(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function cleanMaybe(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function orderDevicesForRemoval(devices: Device[]): Device[] {
  return [...devices].sort((left, right) => {
    return Number(isServerDevice(left)) - Number(isServerDevice(right));
  });
}

function isServerDevice(device: Device): boolean {
  const label = device.label.toLowerCase();
  if (label.startsWith("local dev")) return true;
  try {
    const url = new URL(device.daemonUrl);
    const port = url.port ? Number(url.port) : null;
    return port === 18191;
  } catch {
    return false;
  }
}

async function prepareBehaviorRequestBodyForProxy(
  body: string,
  input: {
    device: Device;
    options: SiteAppOptions;
    requestUrl: string;
    contextStores?: ManagerAssistantContextStores;
  },
): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
  if (!body.trim()) return { ok: true, body };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: true, body };
  }
  if (!isRecord(parsed) || parsed.method !== "chat" || !isRecord(parsed.params)) {
    return { ok: true, body };
  }
  if (parsed.params.managerMode !== true) return { ok: true, body };
  if (!isServerDevice(input.device)) {
    return {
      ok: false,
      status: 400,
      error: "manager assistant chat must run on the server PC connector",
    };
  }
  const repoRoot = input.options.managerAssistant?.cwd ?? process.cwd();
  const apiBaseUrl = managerAssistantApiBaseUrl(input.options, input.requestUrl);
  const workspace = await ensureManagerAssistantWorkspace(repoRoot, apiBaseUrl);
  const conversation = await readManagerAssistantConversationState(repoRoot);
  const requestSessionId =
    typeof parsed.params.sessionId === "string" && parsed.params.sessionId.trim()
      ? parsed.params.sessionId.trim()
      : undefined;
  const persistedSessionId =
    typeof conversation.sessionId === "string" && conversation.sessionId.trim()
      ? conversation.sessionId.trim()
      : undefined;
  const managerBrowserContext = await enrichManagerAssistantContext(
    normalizeAssistantContext(parsed.params.managerBrowserContext),
    input.contextStores,
  );
  const params = {
    ...parsed.params,
    cwd: workspace.cwd,
    managerMode: true,
    managerApiBaseUrl: apiBaseUrl,
    managerRepoRoot: repoRoot,
    managerInstructionsPath: workspace.instructionsPath,
    managerSiteToken: input.options.token ?? "",
    managerWorkspaceScope: "unrestricted",
    ...(managerBrowserContext ? { managerBrowserContext } : {}),
    permissionMode: "bypassPermissions",
    securityProfile: "relaxed",
    ...(requestSessionId
      ? { sessionId: requestSessionId }
      : persistedSessionId
        ? { sessionId: persistedSessionId }
        : {}),
    conversationId:
      typeof parsed.params.conversationId === "string" && parsed.params.conversationId.trim()
        ? parsed.params.conversationId
        : conversation.conversationId,
  };
  return { ok: true, body: JSON.stringify({ ...parsed, params }) };
}

function toPublicDevice(
  device: Device,
): Omit<Device, "authToken" | "deviceKey"> & { connectionState: "online" } {
  return {
    id: device.id,
    label: device.label,
    daemonUrl: device.daemonUrl,
    registeredAt: device.registeredAt,
    connectionState: "online" as const,
  };
}

type AccessUrl = {
  kind: "This PC" | "Current URL" | "Tailscale" | "LAN";
  url: string;
};

function getAccessUrls(baseUrl: string): AccessUrl[] {
  const base = new URL(baseUrl);
  const port = explicitPort(base);
  const rows: AccessUrl[] = [{ kind: "This PC", url: `http://127.0.0.1:${port}` }];
  const currentHost = base.hostname.replace(/^\[|\]$/g, "");
  if (!isLocalHost(currentHost) && currentHost !== "0.0.0.0") {
    rows.push({ kind: classifyRemoteHost(currentHost), url: base.origin });
  }
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4") continue;
      if (entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      const kind = entry.address.startsWith("100.") ? "Tailscale" : "LAN";
      rows.push({ kind, url: `http://${entry.address}:${port}` });
    }
  }
  return dedupeUrls(rows);
}

function explicitPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function classifyRemoteHost(host: string): AccessUrl["kind"] {
  if (host.startsWith("100.")) return "Tailscale";
  if (
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return "LAN";
  }
  return "Current URL";
}

function daemonNetworkKind(rawUrl: string): "local" | "tailscale" | "lan" | "public" | "unknown" {
  return connectorNetworkKind(rawUrl);
}

function collectServerNetworkAddresses(port: number): ManagerNetworkAddress[] {
  const rows: ManagerNetworkAddress[] = [];
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" && entry.family !== "IPv6") continue;
      if (entry.address.startsWith("169.254.")) continue;
      const kind = classifyNetworkAddress(entry.address);
      rows.push({
        address: entry.address,
        interfaceName,
        family: entry.family,
        kind,
        internal: entry.internal,
        ...(entry.family === "IPv4" ? { url: `http://${entry.address}:${port}` } : {}),
      });
    }
  }
  return rows.sort((left, right) => networkKindRank(left.kind) - networkKindRank(right.kind));
}

function classifyNetworkAddress(address: string): ManagerNetworkKind {
  return networkKindForHost(address);
}

function networkKindRank(kind: ManagerNetworkKind): number {
  const ranks: Record<ManagerNetworkKind, number> = {
    tailscale: 0,
    lan: 1,
    local: 2,
    public: 3,
    unknown: 4,
  };
  return ranks[kind];
}

function normalizeManagerUpdate(value: unknown): ManagerInstallStatus["update"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const state = typeof raw.state === "string" ? raw.state : "unknown";
  return {
    state,
    ...(typeof raw.updateAvailable === "boolean" ? { updateAvailable: raw.updateAvailable } : {}),
    ...(typeof raw.changed === "boolean" ? { changed: raw.changed } : {}),
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
  };
}

async function fetchManagerJson<T>(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  url: string,
  authToken?: string,
): Promise<{ ok: true; value: T } | { ok: false; status: number; error: string }> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: (err as Error).message };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text ? `HTTP ${res.status}: ${text.slice(0, 300)}` : `HTTP ${res.status}`,
    };
  }
  try {
    return { ok: true, value: (await res.json()) as T };
  } catch (err) {
    return { ok: false, status: 502, error: `non-JSON response: ${(err as Error).message}` };
  }
}

function dedupeUrls(rows: AccessUrl[]): AccessUrl[] {
  const seen = new Set<string>();
  const out: AccessUrl[] = [];
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    out.push(row);
  }
  return out;
}

function pickRemoteAccessUrl(rows: AccessUrl[]): string {
  return (
    rows.find((row) => row.kind === "Tailscale") ??
    rows.find((row) => isTailscaleUrl(row.url)) ??
    rows.find((row) => row.kind === "LAN") ??
    rows.find((row) => row.kind === "Current URL") ??
    rows[0] ?? { kind: "This PC", url: "http://127.0.0.1:18193" }
  ).url;
}

function isTailscaleUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
    return host.startsWith("100.");
  } catch {
    return false;
  }
}

function buildRegisterOtherPcCommand(input: {
  siteUrl: string;
  siteToken: string;
  branch?: string | undefined;
}): string {
  const siteUrl = input.siteUrl.replace(/\/+$/, "");
  const branch = input.branch ?? "main";
  const installerUrl = `https://raw.githubusercontent.com/darkhtk/deskrelay/${branch}/scripts/install-connector.ps1`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "$installer = Join-Path $env:TEMP 'deskrelay-install-connector.ps1'",
    `Invoke-WebRequest -UseBasicParsing -Uri ${quotePs(installerUrl)} -OutFile $installer`,
    "",
    "$workspaceRoots = Join-Path $HOME 'Projects'",
    `powershell -ExecutionPolicy Bypass -File $installer -Server ${quotePs(siteUrl)} -SiteToken ${quotePs(input.siteToken)} -WorkspaceRoots $workspaceRoots -Label $env:COMPUTERNAME -Port ${DEFAULT_CONNECTOR_PORT} -Branch ${quotePs(branch)}`,
  ].join("\n");
}

function buildRemoveOtherPcCommand(input: { siteUrl: string; siteToken: string }): string {
  const siteUrl = input.siteUrl.replace(/\/+$/, "");
  const serverPort = getUrlPort(siteUrl);
  return [
    "# DeskRelay - remove this PC from a self-host server",
    "# Paste this whole block into PowerShell on the PC you want to remove.",
    "# The remover downloaded from GitHub does the rest: finds this PC's",
    "# Tailscale/LAN daemon URL, unregisters matching server device rows,",
    "# removes the connector login task, clears local connector state, and",
    "# stops any connector still listening on the default port.",
    `# Server URL: ${siteUrl}`,
    `# Server port: ${serverPort}`,
    `# Connector port: ${DEFAULT_CONNECTOR_PORT}`,
    `# Site token: ${input.siteToken}`,
    "",
    "$ErrorActionPreference = 'Stop'",
    "$remover = Join-Path $env:TEMP 'deskrelay-remove-connector.ps1'",
    "Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/darkhtk/deskrelay/main/scripts/remove-connector.ps1' -OutFile $remover",
    "",
    `powershell -ExecutionPolicy Bypass -File $remover -Server ${quotePs(siteUrl)} -SiteToken ${quotePs(input.siteToken)} -Port ${DEFAULT_CONNECTOR_PORT}`,
  ].join("\n");
}

function quotePs(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getUrlPort(value: string): number {
  try {
    const url = new URL(value);
    if (url.port) return Number(url.port);
    if (url.protocol === "https:") return 443;
    if (url.protocol === "http:") return 80;
  } catch {
    // The downstream install/remove scripts still validate the URL before use.
  }
  return 0;
}

interface ServerDiagnosticInput {
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  token: string | undefined;
  localToken: string | undefined;
  build: DeskRelayBuildInfo;
  urls: AccessUrl[];
}

interface DeviceDiagnosticInput {
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>;
  registry: DeviceRegistry;
  device: Device;
  localToken: string | undefined;
  serverBuild: DeskRelayBuildInfo;
}

interface DaemonStatusPayload {
  ok?: boolean;
  startedAt?: string;
  build?: DeskRelayBuildInfo;
  listening?: { host?: string; port?: number };
  behaviors?: Array<{ name?: string; instanceId?: string; version?: string }>;
  workspaceRoots?: { mode?: string; roots?: string[] };
  diagnostics?: {
    remoteClaudeLoaded?: boolean;
    approvalsHookEnabled?: boolean;
    pendingApprovals?: number;
  };
}

async function buildServerDiagnosticReport(
  input: ServerDiagnosticInput,
): Promise<DiagnosticReport> {
  const generatedAt = new Date().toISOString();
  const checks: DiagnosticCheck[] = [];
  const preferredUrl = pickRemoteAccessUrl(input.urls);
  const remoteUrls = input.urls.filter((row) => row.kind !== "This PC");

  checks.push(
    diagnosticCheck({
      id: "server.api",
      label: "Server API",
      severity: "ok",
      summary: "site backend is responding",
      detail: `version ${input.build.version}`,
      generatedAt,
      userVisible: false,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.token",
      label: "Site token",
      severity: input.token ? "ok" : "error",
      summary: input.token ? "site token is configured" : "site token is missing",
      detail: input.token
        ? "Browsers and connector registration commands can authenticate."
        : "Restart the server with a CR_SITE_TOKEN value.",
      generatedAt,
      userVisible: !input.token,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.security-boundary",
      label: "Security boundary",
      severity: input.token ? "ok" : "error",
      summary: input.token
        ? "site token protects browser and registration APIs"
        : "site token protection is unavailable",
      detail:
        "Connector daemon tokens are stored by the server and are not returned by public device APIs.",
      generatedAt,
      userVisible: !input.token,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.remote-url",
      label: "Remote URL",
      severity:
        remoteUrls.length > 0 && !isLocalHost(new URL(preferredUrl).hostname) ? "ok" : "warn",
      summary:
        remoteUrls.length > 0
          ? `preferred access URL: ${preferredUrl}`
          : "only a local URL is available",
      detail:
        remoteUrls.length > 0
          ? "Use this URL from another PC on the same LAN/VPN."
          : "Install Tailscale or use a LAN address before registering another PC.",
      generatedAt,
      userVisible: remoteUrls.length === 0 || isLocalHost(new URL(preferredUrl).hostname),
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.devices",
      label: "Device registry",
      severity: input.registry.list().length > 0 ? "ok" : "warn",
      summary: `${input.registry.list().length} device(s) registered`,
      detail:
        input.registry.list().length > 0
          ? "Registered devices are available to the browser."
          : "Run the generated registration command on at least one PC.",
      generatedAt,
      userVisible: input.registry.list().length === 0,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "server.build",
      label: "Git/build",
      severity: input.build.dirty ? "warn" : "ok",
      summary: buildSummary(input.build),
      detail: input.build.dirty
        ? "The server was started from a dirty working tree. Restart after committing or pulling."
        : "The server build metadata is stable.",
      generatedAt,
      userVisible: input.build.dirty,
    }),
  );

  if (!input.localToken) {
    checks.push(
      diagnosticCheck({
        id: "server.local-connector",
        label: "Server PC connector",
        severity: "unknown",
        summary: "local daemon token is not available to the site backend",
        detail: "This is acceptable if this PC is only acting as a server.",
        generatedAt,
        userVisible: false,
      }),
    );
  } else {
    const localUrl = localServerDaemonUrl();
    const status = await fetchDaemonStatus(input.fetchImpl, localUrl, input.localToken, {
      allowLocalUrl: true,
    });
    checks.push(
      diagnosticCheck({
        id: "server.local-connector",
        label: "Server PC connector",
        severity: status.ok ? "ok" : status.severity,
        summary: status.ok ? `local connector responding at ${localUrl}` : status.summary,
        detail: status.ok
          ? "This server PC can also be used as a controlled device."
          : status.detail,
        generatedAt,
        userVisible: !status.ok,
      }),
    );
  }

  return {
    scope: "server",
    generatedAt,
    checks,
    steps: checks.map((check) => diagnosticStepFromCheck(check, "server")),
  };
}

async function buildDeviceDiagnosticReport(
  input: DeviceDiagnosticInput,
): Promise<DiagnosticReport> {
  const generatedAt = new Date().toISOString();
  const checks: DiagnosticCheck[] = [];
  const devices = input.registry.list();
  const token = daemonToken(input.device, input.localToken);
  const duplicateUrls = devices.filter(
    (candidate) =>
      candidate.id !== input.device.id && candidate.daemonUrl === input.device.daemonUrl,
  );
  const duplicateLabels = devices.filter(
    (candidate) =>
      candidate.id !== input.device.id &&
      candidate.label.trim().toLowerCase() === input.device.label.trim().toLowerCase(),
  );

  checks.push(
    diagnosticCheck({
      id: "device.registry",
      label: "Registry row",
      severity: "ok",
      summary: `${input.device.label} is registered`,
      detail: input.device.daemonUrl,
      generatedAt,
      userVisible: false,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "device.duplicates",
      label: "Duplicate detection",
      severity: duplicateUrls.length > 0 || duplicateLabels.length > 0 ? "warn" : "ok",
      summary:
        duplicateUrls.length > 0 || duplicateLabels.length > 0
          ? "similar device rows exist"
          : "no duplicate URL or label detected",
      detail:
        duplicateUrls.length > 0
          ? `Same daemon URL appears ${duplicateUrls.length + 1} times.`
          : duplicateLabels.length > 0
            ? `Same label appears ${duplicateLabels.length + 1} times.`
            : "Registration dedupe is currently clean.",
      generatedAt,
      userVisible: duplicateUrls.length > 0 || duplicateLabels.length > 0,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "device.token",
      label: "Daemon token",
      severity: token ? "ok" : "error",
      summary: token ? "daemon token is available" : "daemon token is missing",
      detail: token
        ? "The site backend can authenticate to this connector."
        : "Re-register this device so its connector token is saved.",
      generatedAt,
      userVisible: !token,
    }),
  );

  const status = await fetchDaemonStatus(input.fetchImpl, input.device.daemonUrl, token);
  checks.push(
    diagnosticCheck({
      id: "device.daemon",
      label: "Local daemon",
      severity: status.ok ? "ok" : status.severity,
      summary: status.ok ? `responding at ${input.device.daemonUrl}` : status.summary,
      detail: status.ok
        ? status.payload.startedAt
          ? `started ${status.payload.startedAt}`
          : "status endpoint is reachable"
        : status.detail,
      generatedAt,
      userVisible: !status.ok,
    }),
  );

  if (!status.ok) {
    const reachability = status.diagnosis;
    checks.push(
      diagnosticCheck({
        id: "device.network-route",
        label: "Network route",
        severity: reachability.severity,
        summary: reachability.summary,
        detail: reachability.detail,
        fixCommand: reachability.hint,
        generatedAt,
        userVisible: reachability.userVisible,
      }),
    );
    if (reachability.networkKind === "tailscale") {
      checks.push(
        diagnosticCheck({
          id: "device.tailscale",
          label: "Tailscale route",
          severity: reachability.kind === "tailscale-route-or-firewall" ? "error" : "unknown",
          summary:
            reachability.kind === "tailscale-route-or-firewall"
              ? "Tailscale route or incoming policy needs attention"
              : "Tailscale route was not verified",
          detail:
            "This device is registered with a Tailscale address. Both PCs must be in the same tailnet and the connector PC must allow incoming connections.",
          fixCommand:
            "Check Tailscale login on both PCs and run 'tailscale set --shields-up=false' on the connector PC if needed.",
          generatedAt,
          userVisible: reachability.kind === "tailscale-route-or-firewall",
        }),
      );
    }
    if (
      reachability.kind === "tailscale-route-or-firewall" ||
      reachability.kind === "lan-route-or-firewall" ||
      reachability.kind === "public-route-or-firewall" ||
      reachability.kind === "route-or-firewall"
    ) {
      checks.push(
        diagnosticCheck({
          id: "device.firewall",
          label: "Inbound firewall",
          severity: "warn",
          summary: "connector port may be blocked",
          detail:
            "The server could not prove whether the packet reached the PC. The next actionable check is the connector PC firewall for the registered port.",
          fixCommand:
            "Allow inbound TCP for the connector port or rerun the registration command as Administrator.",
          generatedAt,
          userVisible: true,
        }),
      );
    }
    checks.push(
      diagnosticCheck({
        id: "device.claude",
        label: "Claude command bridge",
        severity: "unknown",
        summary: "not checked because daemon status failed",
        generatedAt,
        userVisible: false,
      }),
      diagnosticCheck({
        id: "device.workspace",
        label: "Workspace roots",
        severity: "unknown",
        summary: "not checked because daemon status failed",
        generatedAt,
        userVisible: false,
      }),
      diagnosticCheck({
        id: "device.version",
        label: "Server/connector version",
        severity: "unknown",
        summary: "not checked because daemon status failed",
        generatedAt,
        userVisible: false,
      }),
    );
    return {
      scope: "device",
      targetId: input.device.id,
      targetLabel: input.device.label,
      generatedAt,
      checks,
      steps: checks.map((check) => diagnosticStepFromCheck(check, "server")),
    };
  }

  const payload = status.payload;
  const listenHost = payload.listening?.host;
  const listenPort = payload.listening?.port;
  const registeredNetwork = daemonNetworkKind(input.device.daemonUrl);
  const registeredAsRemote =
    registeredNetwork === "tailscale" ||
    registeredNetwork === "lan" ||
    registeredNetwork === "public";
  const localOnlyListen = listenHost ? isLocalHost(listenHost) : false;
  const listenMismatch = Boolean(registeredAsRemote && localOnlyListen);
  checks.push(
    diagnosticCheck({
      id: "device.listen-bind",
      label: "Connector listen binding",
      severity: listenMismatch ? "error" : listenHost ? "ok" : "unknown",
      summary: listenHost
        ? listenMismatch
          ? `connector is bound to ${listenHost}:${listenPort ?? "?"}`
          : `connector listens on ${listenHost}:${listenPort ?? "?"}`
        : "connector did not report a bind address",
      detail: listenMismatch
        ? `This device is registered as ${input.device.daemonUrl}, but the connector is local-only. Re-register or restart it with listen host 0.0.0.0 so the server can reach it through LAN/Tailscale.`
        : "The reported bind address matches the registered network boundary.",
      generatedAt,
      userVisible: listenMismatch,
    }),
  );

  const remoteClaudeLoaded = payload.diagnostics?.remoteClaudeLoaded;
  checks.push(
    diagnosticCheck({
      id: "device.claude",
      label: "Claude command bridge",
      severity:
        remoteClaudeLoaded === true ? "ok" : remoteClaudeLoaded === false ? "error" : "unknown",
      summary:
        remoteClaudeLoaded === true
          ? "Claude command bridge is ready"
          : remoteClaudeLoaded === false
            ? "Claude command bridge is not ready"
            : "Claude command bridge state is unknown",
      detail:
        remoteClaudeLoaded === false
          ? "Restart or update the connector before starting chat runs."
          : "Connector reports that command execution support is available.",
      generatedAt,
      userVisible: remoteClaudeLoaded === false,
    }),
  );

  const roots = payload.workspaceRoots?.roots ?? [];
  const workspaceMode = payload.workspaceRoots?.mode ?? "unknown";
  checks.push(
    diagnosticCheck({
      id: "device.workspace",
      label: "Workspace roots",
      severity: workspaceMode === "restricted" && roots.length === 0 ? "warn" : "ok",
      summary: `${workspaceMode} workspace mode, ${roots.length} root(s)`,
      detail:
        roots.length > 0
          ? roots.join("; ")
          : workspaceMode === "restricted"
            ? "No allowed workspace roots are configured."
            : "Unrestricted workspace access is enabled.",
      generatedAt,
      userVisible: workspaceMode === "restricted" && roots.length === 0,
    }),
  );
  checks.push(
    diagnosticCheck({
      id: "device.security-boundary",
      label: "Security boundary",
      severity:
        daemonNetworkKind(input.device.daemonUrl) === "public" || workspaceMode === "unrestricted"
          ? "warn"
          : "ok",
      summary: `${daemonNetworkKind(input.device.daemonUrl)} connector URL, ${workspaceMode} workspace access`,
      detail:
        workspaceMode === "unrestricted"
          ? "Unrestricted workspace browsing is enabled for this device. Keep the connector behind LAN/VPN access."
          : roots.length > 0
            ? `Allowed roots: ${roots.join("; ")}`
            : "No workspace roots are exposed beyond daemon policy.",
      generatedAt,
      userVisible:
        daemonNetworkKind(input.device.daemonUrl) === "public" || workspaceMode === "unrestricted",
    }),
  );

  const same = sameBuild(input.serverBuild, payload.build);
  checks.push(
    diagnosticCheck({
      id: "device.version",
      label: "Server/connector version",
      severity: same === true ? "ok" : same === false ? "warn" : "unknown",
      summary:
        same === true
          ? "server and connector builds match"
          : same === false
            ? "server and connector builds differ"
            : "build comparison unavailable",
      detail: `server ${buildSummary(input.serverBuild)}; connector ${buildSummary(payload.build)}`,
      generatedAt,
      userVisible: same !== true,
    }),
  );

  checks.push(
    diagnosticCheck({
      id: "device.approvals",
      label: "Approval hook",
      severity: payload.diagnostics?.approvalsHookEnabled ? "ok" : "warn",
      summary: payload.diagnostics?.approvalsHookEnabled
        ? `${payload.diagnostics?.pendingApprovals ?? 0} approval(s) pending`
        : "approval hook is not reported as enabled",
      detail:
        payload.diagnostics?.approvalsHookEnabled === false
          ? "Tool approval UX may not work until the connector is restarted with approvals enabled."
          : undefined,
      generatedAt,
      userVisible: payload.diagnostics?.approvalsHookEnabled === false,
    }),
  );

  return {
    scope: "device",
    targetId: input.device.id,
    targetLabel: input.device.label,
    generatedAt,
    checks,
    steps: checks.map((check) => diagnosticStepFromCheck(check, "server")),
  };
}

function diagnosticCheck(input: {
  id: string;
  label: string;
  severity: DiagnosticSeverity;
  summary: string;
  generatedAt: string;
  detail?: string | undefined;
  fixCommand?: string | undefined;
  copyCommand?: string | undefined;
  userVisible?: boolean | undefined;
}): DiagnosticCheck {
  return {
    id: input.id,
    label: input.label,
    severity: input.severity,
    summary: input.summary,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.fixCommand ? { fixCommand: input.fixCommand } : {}),
    ...(input.copyCommand ? { copyCommand: input.copyCommand } : {}),
    lastCheckedAt: input.generatedAt,
    ...(input.userVisible !== undefined ? { userVisible: input.userVisible } : {}),
  };
}

function localServerDaemonUrl(): string {
  const port = Number(process.env.CR_CONNECTOR_PORT ?? "18191");
  return `http://127.0.0.1:${Number.isFinite(port) ? port : 18191}`;
}

async function fetchDaemonStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  daemonUrl: string,
  authToken?: string,
  options: { allowLocalUrl?: boolean | undefined } = {},
): Promise<
  | { ok: true; payload: DaemonStatusPayload }
  | {
      ok: false;
      severity: DiagnosticSeverity;
      summary: string;
      detail?: string;
      diagnosis: ReturnType<typeof diagnoseConnectorReachability>;
    }
> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetchImpl(`${daemonUrl}/status`, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    const diagnosis = diagnoseConnectorReachability({
      daemonUrl,
      error: (err as Error).message,
      allowLocalUrl: options.allowLocalUrl,
    });
    return {
      ok: false,
      severity: diagnosis.severity,
      summary: diagnosis.summary,
      detail: diagnosis.detail,
      diagnosis,
    };
  }
  if (res.status === 401) {
    const diagnosis = diagnoseConnectorReachability({
      daemonUrl,
      status: res.status,
      allowLocalUrl: options.allowLocalUrl,
    });
    return {
      ok: false,
      severity: diagnosis.severity,
      summary: diagnosis.summary,
      detail: diagnosis.detail,
      diagnosis,
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const diagnosis = diagnoseConnectorReachability({
      daemonUrl,
      status: res.status,
      error: text,
      allowLocalUrl: options.allowLocalUrl,
    });
    return {
      ok: false,
      severity: diagnosis.severity,
      summary: diagnosis.summary,
      detail: text ? text.slice(0, 500) : diagnosis.detail,
      diagnosis,
    };
  }
  try {
    return { ok: true, payload: (await res.json()) as DaemonStatusPayload };
  } catch (err) {
    const diagnosis = diagnoseConnectorReachability({
      daemonUrl,
      status: 502,
      error: (err as Error).message,
      allowLocalUrl: options.allowLocalUrl,
    });
    return {
      ok: false,
      severity: diagnosis.severity,
      summary: "daemon status returned non-JSON",
      detail: (err as Error).message,
      diagnosis,
    };
  }
}

function sameBuild(
  server: DeskRelayBuildInfo | undefined,
  connector: DeskRelayBuildInfo | undefined,
): boolean | null {
  if (!server || !connector) return null;
  if (
    !server.commit ||
    !connector.commit ||
    server.commit === "unknown" ||
    connector.commit === "unknown"
  ) {
    return null;
  }
  return server.commit === connector.commit && server.dirty === connector.dirty;
}

function buildSummary(build: DeskRelayBuildInfo | undefined): string {
  if (!build) return "unknown";
  const dirty = build.dirty ? "+dirty" : "";
  return `${build.shortCommit || build.version || "unknown"}${dirty}`;
}

async function probeDaemonStatus(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  daemonUrl: string,
  authToken?: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetchImpl(`${daemonUrl}/status`, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `cannot reach daemon status at ${daemonUrl}: ${(err as Error).message}`,
    };
  }
  if (res.status === 401) {
    return {
      ok: false,
      status: 400,
      error:
        "daemon rejected the token. Enter that PC's connector daemon token, or run the daemon with a shared CR_CONNECTOR_AUTH_FILE token.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      error: `daemon status check failed (${res.status}) at ${daemonUrl}`,
    };
  }
  return { ok: true };
}

async function proxyJson(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  method: string,
  url: string,
  body?: string,
  localToken?: string,
): Promise<Response> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  if (body !== undefined && body.length > 0) {
    init.body = body;
    headers["content-type"] = "application/json";
  }
  if (localToken) headers.authorization = `Bearer ${localToken}`;
  if (Object.keys(headers).length > 0) init.headers = headers;
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, init);
  } catch (err) {
    return Response.json(
      { error: `cannot reach daemon: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  const text = await upstream.text();
  return new Response(text || "{}", {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}

async function proxyBinary(
  fetchImpl: NonNullable<SiteAppOptions["fetchImpl"]>,
  url: string,
  localToken?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (localToken) headers.authorization = `Bearer ${localToken}`;
  let upstream: Response;
  try {
    upstream = await fetchImpl(url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach daemon: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: filterPreviewHeaders(upstream.headers),
  });
}

function filterPreviewHeaders(source: Headers): Headers {
  const out = new Headers();
  const allow = new Set([
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
    "x-content-type-options",
  ]);
  for (const [rawKey, rawValue] of source.entries()) {
    const key = rawKey.toLowerCase();
    if (allow.has(key)) out.set(key, rawValue);
  }
  if (!out.has("content-type")) out.set("content-type", "application/octet-stream");
  out.set("x-content-type-options", "nosniff");
  return out;
}
