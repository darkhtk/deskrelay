import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  ManagerCommandFlowStage,
  ManagerProject,
  ManagerProjectCharter,
  ManagerProjectCorruptRecord,
  ManagerProjectCreateRequest,
  ManagerProjectDirectionChange,
  ManagerProjectFinalReview,
  ManagerProjectStatus,
  ManagerProjectUpdateRequest,
  ManagerWizardIntentAction,
  ManagerWizardIntentEvent,
  ManagerWizardIntentEventInput,
  ManagerWizardIntentEventKind,
  ManagerWizardIntentImpact,
} from "@deskrelay/shared";

const MAX_WIZARD_EVENTS_PER_PROJECT = 40;

export interface ManagerProjectListResult {
  projects: ManagerProject[];
  archived: ManagerProject[];
  corrupt: ManagerProjectCorruptRecord[];
}

export interface ManagerProjectStore {
  list(): Promise<ManagerProjectListResult>;
  get(id: string): Promise<ManagerProject | undefined>;
  create(input: ManagerProjectCreateRequest): Promise<ManagerProject>;
  update(id: string, patch: ManagerProjectUpdateRequest): Promise<ManagerProject | undefined>;
  archive(id: string): Promise<ManagerProject | undefined>;
}

export function createInMemoryManagerProjectStore(
  options: { now?: () => Date } = {},
): ManagerProjectStore {
  const now = options.now ?? (() => new Date());
  const projects = new Map<string, ManagerProject>();

  return {
    async list() {
      return {
        projects: sortProjects(
          [...projects.values()].filter((project) => project.status !== "archived"),
        ),
        archived: sortProjects(
          [...projects.values()].filter((project) => project.status === "archived"),
        ),
        corrupt: [],
      };
    },
    async get(id) {
      return projects.get(id);
    },
    async create(input) {
      const project = createProject(input, now());
      projects.set(project.id, project);
      return project;
    },
    async update(id, patch) {
      const current = projects.get(id);
      if (!current) return undefined;
      const updated = patchProject(current, patch, now());
      projects.set(id, updated);
      return updated;
    },
    async archive(id) {
      const current = projects.get(id);
      if (!current) return undefined;
      const archived = patchProject(current, { status: "archived" }, now());
      projects.set(id, archived);
      return archived;
    },
  };
}

export function createJsonManagerProjectStore(
  directory: string,
  options: { maxProjects?: number; now?: () => Date } = {},
): ManagerProjectStore {
  const maxProjects = Math.max(1, options.maxProjects ?? 200);
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  const readConsistent = async () => {
    await queue.catch(() => undefined);
    return await readProjects(directory, maxProjects);
  };

  const mutate = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = queue.then(async () => await fn());
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  };

  return {
    async list() {
      return await readConsistent();
    },

    async get(id) {
      return findProject(await readConsistent(), id);
    },

    async create(input) {
      return await mutate(async () => {
        const project = createProject(input, now());
        await writeProject(directory, project);
        return project;
      });
    },

    async update(id, patch) {
      return await mutate(async () => {
        const current = findProject(await readProjects(directory, maxProjects), id);
        if (!current) return undefined;
        const updated = patchProject(current, patch, now());
        await writeProject(directory, updated);
        return updated;
      });
    },

    async archive(id) {
      return await mutate(async () => {
        const current = findProject(await readProjects(directory, maxProjects), id);
        if (!current) return undefined;
        const archived = patchProject(
          current,
          {
            status: "archived",
          },
          now(),
        );
        await writeProject(directory, archived);
        return archived;
      });
    },
  };
}

function createProject(input: ManagerProjectCreateRequest, now: Date): ManagerProject {
  const createdAt = now.toISOString();
  const cwd = normalizeCwd(input.cwd);
  const id = `project_${randomBytes(10).toString("base64url")}`;
  const name = cleanText(input.name) || basename(cwd) || "DeskRelay project";
  const status =
    input.status && input.status !== "archived" && isProjectStatus(input.status)
      ? input.status
      : "planning";
  const goal = cleanText(input.goal) || "";
  const activeRoundId = cleanText(input.activeRoundId);
  const flowStage =
    input.flowStage && input.flowStage !== "archived" && isCommandFlowStage(input.flowStage)
      ? input.flowStage
      : status === "planning"
        ? "draft"
        : commandFlowStageFromStatus(status);
  const charter = normalizeCharter(input.charter, {
    goal,
    updatedAt: createdAt,
    updatedBy: "browser",
  });
  const wizardEvents = input.wizardEvent
    ? normalizeWizardIntentEvents([input.wizardEvent], id, createdAt, "new")
    : [];
  return {
    id,
    name,
    cwd,
    goal,
    status,
    flowStage,
    charter,
    ...(wizardEvents.length ? { wizardEvents } : {}),
    createdAt,
    updatedAt: createdAt,
    ...(activeRoundId ? { activeRoundId } : {}),
  };
}

function patchProject(
  project: ManagerProject,
  patch: ManagerProjectUpdateRequest,
  now: Date,
): ManagerProject {
  const cwd = patch.cwd !== undefined ? normalizeCwd(patch.cwd) : project.cwd;
  const name = patch.name !== undefined ? cleanText(patch.name) || project.name : project.name;
  const goal = patch.goal !== undefined ? cleanText(patch.goal) || "" : project.goal;
  const status =
    patch.status !== undefined && isProjectStatus(patch.status) ? patch.status : project.status;
  const flowStage =
    patch.flowStage !== undefined && isCommandFlowStage(patch.flowStage)
      ? patch.flowStage
      : patch.status !== undefined
        ? commandFlowStageFromStatus(status)
        : project.flowStage;
  const charter =
    patch.charter === null
      ? undefined
      : patch.charter !== undefined
        ? normalizeCharter(
            {
              ...(project.charter ?? defaultCharter(project.goal, project.updatedAt, "system")),
              ...patch.charter,
            },
            {
              goal,
              updatedAt: now.toISOString(),
              updatedBy: patch.charter.updatedBy ?? "browser",
            },
          )
        : project.charter;
  const lastDirectionChange =
    patch.lastDirectionChange === null
      ? undefined
      : patch.lastDirectionChange !== undefined
        ? normalizeDirectionChange(patch.lastDirectionChange)
        : project.lastDirectionChange;
  const finalReview =
    patch.finalReview === null
      ? undefined
      : patch.finalReview !== undefined
        ? normalizeFinalReview(patch.finalReview)
        : project.finalReview;
  const wizardEvents = patch.wizardEvent
    ? appendWizardIntentEvent(
        project.wizardEvents,
        project.id,
        patch.wizardEvent,
        now.toISOString(),
      )
    : project.wizardEvents;
  const activeRoundId =
    patch.activeRoundId === null
      ? undefined
      : patch.activeRoundId !== undefined
        ? cleanText(patch.activeRoundId)
        : project.activeRoundId;
  const summary =
    patch.summary === null
      ? undefined
      : patch.summary !== undefined
        ? cleanText(patch.summary)
        : project.summary;
  const error =
    patch.error === null
      ? undefined
      : patch.error !== undefined
        ? cleanText(patch.error)
        : project.error;
  const archivedAt = status === "archived" ? (project.archivedAt ?? now.toISOString()) : undefined;
  return {
    id: project.id,
    name,
    cwd,
    goal,
    status,
    ...(flowStage ? { flowStage } : {}),
    ...(charter ? { charter } : {}),
    ...(wizardEvents?.length ? { wizardEvents } : {}),
    ...(lastDirectionChange ? { lastDirectionChange } : {}),
    ...(finalReview ? { finalReview } : {}),
    createdAt: project.createdAt,
    updatedAt: now.toISOString(),
    ...(activeRoundId ? { activeRoundId } : {}),
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {}),
    ...(archivedAt ? { archivedAt } : {}),
  };
}

async function readProjects(
  directory: string,
  maxProjects: number,
): Promise<ManagerProjectListResult> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const projects: ManagerProject[] = [];
  const archived: ManagerProject[] = [];
  const corrupt: ManagerProjectCorruptRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join(directory, entry.name);
    const id = entry.name.replace(/\.json$/i, "");
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      const project = normalizeProject(parsed);
      if (!project) {
        corrupt.push({ id, path, error: "invalid project record" });
        continue;
      }
      if (project.status === "archived") archived.push(project);
      else projects.push(project);
    } catch (error) {
      corrupt.push({
        id,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    projects: sortProjects(projects).slice(0, maxProjects),
    archived: sortProjects(archived).slice(0, maxProjects),
    corrupt,
  };
}

async function writeProject(directory: string, project: ManagerProject): Promise<void> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${project.id}.json`);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function normalizeProject(input: unknown): ManagerProject | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (typeof input.cwd !== "string" || !input.cwd.trim()) return null;
  if (!isProjectStatus(input.status)) return null;
  const createdAt = cleanText(input.createdAt) ?? new Date(0).toISOString();
  const activeRoundId = cleanText(input.activeRoundId);
  const summary = cleanText(input.summary);
  const archivedAt = cleanText(input.archivedAt);
  const error = cleanText(input.error);
  const charter = normalizeCharter(input.charter, {
    goal: cleanText(input.goal) ?? "",
    updatedAt: cleanText(input.updatedAt) ?? createdAt,
    updatedBy: "system",
  });
  const flowStage = isCommandFlowStage(input.flowStage)
    ? input.flowStage
    : commandFlowStageFromStatus(input.status);
  const lastDirectionChange = normalizeDirectionChange(input.lastDirectionChange);
  const finalReview = normalizeFinalReview(input.finalReview);
  const wizardEvents = normalizeWizardIntentEvents(
    input.wizardEvents,
    input.id,
    createdAt,
    "stored",
  );
  return {
    id: input.id,
    name: cleanText(input.name) ?? basename(input.cwd) ?? "DeskRelay project",
    cwd: input.cwd,
    goal: cleanText(input.goal) ?? "",
    status: input.status,
    flowStage,
    charter,
    ...(wizardEvents.length ? { wizardEvents } : {}),
    ...(lastDirectionChange ? { lastDirectionChange } : {}),
    ...(finalReview ? { finalReview } : {}),
    createdAt,
    updatedAt: cleanText(input.updatedAt) ?? createdAt,
    ...(activeRoundId ? { activeRoundId } : {}),
    ...(summary ? { summary } : {}),
    ...(archivedAt ? { archivedAt } : {}),
    ...(error ? { error } : {}),
  };
}

function findProject(result: ManagerProjectListResult, id: string): ManagerProject | undefined {
  return [...result.projects, ...result.archived].find((project) => project.id === id);
}

function sortProjects(projects: ManagerProject[]): ManagerProject[] {
  return [...projects].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

function normalizeCwd(value: string): string {
  const cwd = value.trim();
  if (!cwd) throw new Error("project cwd is required");
  return resolve(cwd);
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isProjectStatus(value: unknown): value is ManagerProjectStatus {
  return (
    value === "planning" ||
    value === "running" ||
    value === "blocked" ||
    value === "reviewing" ||
    value === "completed" ||
    value === "archived"
  );
}

function isCommandFlowStage(value: unknown): value is ManagerCommandFlowStage {
  return (
    value === "draft" ||
    value === "protocol_ready" ||
    value === "ready_to_start" ||
    value === "running" ||
    value === "review" ||
    value === "replanning" ||
    value === "completed" ||
    value === "archived"
  );
}

function commandFlowStageFromStatus(status: ManagerProjectStatus): ManagerCommandFlowStage {
  if (status === "archived") return "archived";
  if (status === "completed") return "completed";
  if (status === "reviewing") return "review";
  if (status === "running") return "running";
  if (status === "blocked") return "replanning";
  return "draft";
}

function defaultCharter(
  goal: string,
  updatedAt: string,
  updatedBy: ManagerProjectCharter["updatedBy"],
): ManagerProjectCharter {
  return {
    goal,
    scope: "",
    nonGoals: "",
    constraints: "",
    successCriteria: "",
    preferredApproach: "",
    verificationPlan: "",
    userCheckpoints: "",
    finalDeliverables: "",
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };
}

function normalizeCharter(
  value: unknown,
  defaults: {
    goal: string;
    updatedAt: string;
    updatedBy: ManagerProjectCharter["updatedBy"];
  },
): ManagerProjectCharter {
  const record = isRecord(value) ? value : {};
  const updatedBy =
    record.updatedBy === "browser" ||
    record.updatedBy === "manager" ||
    record.updatedBy === "system"
      ? record.updatedBy
      : defaults.updatedBy;
  return {
    goal: cleanText(record.goal) ?? defaults.goal,
    scope: cleanText(record.scope) ?? "",
    nonGoals: cleanText(record.nonGoals) ?? "",
    constraints: cleanText(record.constraints) ?? "",
    successCriteria: cleanText(record.successCriteria) ?? "",
    preferredApproach: cleanText(record.preferredApproach) ?? "",
    verificationPlan: cleanText(record.verificationPlan) ?? "",
    userCheckpoints: cleanText(record.userCheckpoints) ?? "",
    finalDeliverables: cleanText(record.finalDeliverables) ?? "",
    updatedAt: cleanText(record.updatedAt) ?? defaults.updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };
}

function appendWizardIntentEvent(
  current: ManagerWizardIntentEvent[] | undefined,
  projectId: string,
  input: ManagerWizardIntentEventInput,
  createdAt: string,
): ManagerWizardIntentEvent[] {
  return normalizeWizardIntentEvents([...(current ?? []), input], projectId, createdAt, "mixed");
}

function normalizeWizardIntentEvents(
  value: unknown,
  projectId: string,
  createdAt: string,
  mode: "new" | "stored" | "mixed",
): ManagerWizardIntentEvent[] {
  const inputs = Array.isArray(value) ? value : [];
  const events = inputs
    .map((item) => normalizeWizardIntentEvent(item, projectId, createdAt, mode))
    .filter((item): item is ManagerWizardIntentEvent => Boolean(item));
  return events
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_WIZARD_EVENTS_PER_PROJECT);
}

function normalizeWizardIntentEvent(
  value: unknown,
  projectId: string,
  createdAt: string,
  mode: "new" | "stored" | "mixed",
): ManagerWizardIntentEvent | undefined {
  if (!isRecord(value)) return undefined;
  const kind = normalizeWizardIntentKind(value.kind);
  if (!kind) return undefined;
  const fields = normalizeWizardIntentFields(value.fields);
  const note = cleanText(value.note);
  if (fields.length === 0 && !note) return undefined;
  const storedId = cleanText(value.id);
  const eventCreatedAt =
    mode !== "new" && typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt.trim()
      : createdAt;
  const roundId = cleanText(value.roundId);
  const acknowledgedAt = cleanText(value.acknowledgedAt);
  return {
    id: storedId ?? `wizard_evt_${randomBytes(8).toString("base64url")}`,
    projectId,
    ...(roundId ? { roundId } : {}),
    source: "wizard",
    changedBy: "human",
    kind,
    fields,
    impact: normalizeWizardIntentImpact(value.impact) ?? "medium",
    managerAction: normalizeWizardIntentAction(value.managerAction) ?? "refresh-readiness",
    ...(note ? { note: note.slice(0, 1_000) } : {}),
    createdAt: eventCreatedAt,
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
  };
}

function normalizeWizardIntentFields(value: unknown): ManagerWizardIntentEvent["fields"] {
  if (!Array.isArray(value)) return [];
  const fields: ManagerWizardIntentEvent["fields"] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const field = cleanText(item.field);
    const after = cleanText(item.after);
    if (!field || !after || seen.has(field)) continue;
    seen.add(field);
    const before = cleanText(item.before);
    fields.push({
      field: field.slice(0, 120),
      ...(before ? { before: before.slice(0, 1_000) } : {}),
      after: after.slice(0, 2_000),
    });
    if (fields.length >= 20) break;
  }
  return fields;
}

function normalizeWizardIntentKind(value: unknown): ManagerWizardIntentEventKind | undefined {
  return value === "charter-applied" ||
    value === "direction-change-requested" ||
    value === "checkpoint-requested" ||
    value === "protocol-source-changed" ||
    value === "readiness-refresh-requested"
    ? value
    : undefined;
}

function normalizeWizardIntentImpact(value: unknown): ManagerWizardIntentImpact | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "unknown"
    ? value
    : undefined;
}

function normalizeWizardIntentAction(value: unknown): ManagerWizardIntentAction | undefined {
  return value === "record" ||
    value === "refresh-readiness" ||
    value === "continue" ||
    value === "replan" ||
    value === "pause" ||
    value === "ask-human"
    ? value
    : undefined;
}

function normalizeDirectionChange(value: unknown): ManagerProjectDirectionChange | undefined {
  if (!isRecord(value)) return undefined;
  const requestedChange = cleanText(value.requestedChange);
  if (!requestedChange) return undefined;
  const changedBy =
    value.changedBy === "browser" || value.changedBy === "manager" || value.changedBy === "system"
      ? value.changedBy
      : "browser";
  const decisionId = cleanText(value.decisionId);
  const nextRoundId = cleanText(value.nextRoundId);
  return {
    previousDirection: cleanText(value.previousDirection) ?? "",
    requestedChange,
    impact: cleanText(value.impact) ?? "",
    affectedProtocol: cleanText(value.affectedProtocol) ?? "",
    affectedArtifacts: cleanText(value.affectedArtifacts) ?? "",
    ...(decisionId ? { decisionId } : {}),
    ...(nextRoundId ? { nextRoundId } : {}),
    changedAt: cleanText(value.changedAt) ?? new Date(0).toISOString(),
    changedBy,
  };
}

function normalizeFinalReview(value: unknown): ManagerProjectFinalReview | undefined {
  if (!isRecord(value)) return undefined;
  const summary = cleanText(value.summary);
  if (!summary) return undefined;
  const completedBy =
    value.completedBy === "browser" ||
    value.completedBy === "manager" ||
    value.completedBy === "system"
      ? value.completedBy
      : "browser";
  return {
    summary,
    goalMatched: value.goalMatched === true,
    acceptedByUser: value.acceptedByUser === true,
    remainingRisks: cleanText(value.remainingRisks) ?? "",
    verificationEvidence: cleanText(value.verificationEvidence) ?? "",
    artifacts: stringArray(value.artifacts),
    completedAt: cleanText(value.completedAt) ?? new Date(0).toISOString(),
    completedBy,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
