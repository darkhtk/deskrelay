import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ManagerTask,
  ManagerTaskKind,
  ManagerTaskRequestedBy,
  ManagerTaskState,
} from "@deskrelay/shared";
import {
  type DiagnosticStep,
  normalizeDiagnosticStep,
  severityFromDiagnosticStatus,
} from "@deskrelay/shared";

export type ManagerTaskCreateInput = Pick<
  ManagerTask,
  "kind" | "dryRun" | "requestedBy" | "steps"
> & {
  targetId?: string;
  targetLabel?: string;
  params?: Record<string, unknown>;
  result?: unknown;
};

export type ManagerTaskPatch = Partial<
  Pick<
    ManagerTask,
    "state" | "targetLabel" | "startedAt" | "completedAt" | "steps" | "result" | "error"
  >
>;

export interface ManagerTaskStore {
  list(limit?: number): Promise<ManagerTask[]>;
  get(id: string): Promise<ManagerTask | undefined>;
  create(input: ManagerTaskCreateInput): Promise<ManagerTask>;
  update(id: string, patch: ManagerTaskPatch): Promise<ManagerTask | undefined>;
}

export function createInMemoryManagerTaskStore(
  options: { now?: () => Date } = {},
): ManagerTaskStore {
  const now = options.now ?? (() => new Date());
  const tasks = new Map<string, ManagerTask>();

  return {
    async list(limit = 50) {
      return sortTasks([...tasks.values()]).slice(0, clampLimit(limit));
    },
    async get(id) {
      return tasks.get(id);
    },
    async create(input) {
      const task = createTask(input, now());
      tasks.set(task.id, task);
      return task;
    },
    async update(id, patch) {
      const existing = tasks.get(id);
      if (!existing) return undefined;
      const updated = patchTask(existing, patch, now());
      tasks.set(id, updated);
      return updated;
    },
  };
}

export function createJsonManagerTaskStore(
  filePath: string,
  options: { maxTasks?: number; now?: () => Date } = {},
): ManagerTaskStore {
  const maxTasks = Math.max(1, options.maxTasks ?? 200);
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  const readConsistent = async () => {
    await queue.catch(() => undefined);
    return await readTasks(filePath);
  };

  const mutate = async <T>(fn: (tasks: ManagerTask[]) => Promise<T> | T): Promise<T> => {
    const run = queue.then(async () => await fn(await readTasks(filePath)));
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  };

  return {
    async list(limit = 50) {
      return (await readConsistent()).slice(0, clampLimit(limit));
    },

    async get(id) {
      return (await readConsistent()).find((task) => task.id === id);
    },

    async create(input) {
      return await mutate(async (existing) => {
        const task = createTask(input, now());
        await writeTasks(filePath, [task, ...existing].slice(0, maxTasks));
        return task;
      });
    },

    async update(id, patch) {
      return await mutate(async (existing) => {
        const index = existing.findIndex((task) => task.id === id);
        if (index < 0) return undefined;
        const updated = patchTask(existing[index] as ManagerTask, patch, now());
        const next = [...existing];
        next[index] = updated;
        await writeTasks(filePath, sortTasks(next).slice(0, maxTasks));
        return updated;
      });
    },
  };
}

function createTask(input: ManagerTaskCreateInput, now: Date): ManagerTask {
  const createdAt = now.toISOString();
  return {
    id: `task_${randomBytes(12).toString("base64url")}`,
    kind: input.kind,
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.targetLabel ? { targetLabel: input.targetLabel } : {}),
    ...(input.params ? { params: input.params } : {}),
    state: "pending",
    dryRun: input.dryRun,
    requestedBy: input.requestedBy,
    createdAt,
    updatedAt: createdAt,
    steps: input.steps.map(normalizeTaskStep),
    ...(input.result !== undefined ? { result: input.result } : {}),
  };
}

function patchTask(task: ManagerTask, patch: ManagerTaskPatch, now: Date): ManagerTask {
  return {
    ...task,
    ...patch,
    updatedAt: now.toISOString(),
    ...(patch.steps ? { steps: patch.steps.map(normalizeTaskStep) } : {}),
  };
}

function normalizeTaskStep(step: DiagnosticStep): DiagnosticStep {
  return normalizeDiagnosticStep({
    ...step,
    severity: step.severity ?? severityFromDiagnosticStatus(step.status),
    source: step.source ?? "server",
  });
}

async function readTasks(path: string): Promise<ManagerTask[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (Array.isArray(parsed)) return sortTasks(parsed.map(normalizeStoredTask).filter(isPresent));
    if (isRecord(parsed) && Array.isArray(parsed.tasks)) {
      return sortTasks(parsed.tasks.map(normalizeStoredTask).filter(isPresent));
    }
  } catch {
    return [];
  }
  return [];
}

async function writeTasks(path: string, tasks: ManagerTask[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ tasks }, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function normalizeStoredTask(input: unknown): ManagerTask | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (!isManagerTaskKind(input.kind)) return null;
  if (!isManagerTaskState(input.state)) return null;
  const createdAt =
    typeof input.createdAt === "string" && input.createdAt.trim()
      ? input.createdAt
      : new Date(0).toISOString();
  const updatedAt =
    typeof input.updatedAt === "string" && input.updatedAt.trim() ? input.updatedAt : createdAt;
  return {
    id: input.id,
    kind: input.kind,
    ...(typeof input.targetId === "string" ? { targetId: input.targetId } : {}),
    ...(typeof input.targetLabel === "string" ? { targetLabel: input.targetLabel } : {}),
    ...(isRecord(input.params) ? { params: input.params } : {}),
    state: input.state,
    dryRun: input.dryRun !== false,
    requestedBy: isRequestedBy(input.requestedBy) ? input.requestedBy : "browser",
    createdAt,
    updatedAt,
    ...(typeof input.startedAt === "string" ? { startedAt: input.startedAt } : {}),
    ...(typeof input.completedAt === "string" ? { completedAt: input.completedAt } : {}),
    steps: Array.isArray(input.steps) ? input.steps.map(normalizeStoredStep).filter(isPresent) : [],
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(typeof input.error === "string" ? { error: input.error } : {}),
  };
}

function normalizeStoredStep(input: unknown): DiagnosticStep | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || typeof input.label !== "string") return null;
  const status = typeof input.status === "string" ? input.status : "unknown";
  if (!isDiagnosticStatus(status)) return null;
  return normalizeDiagnosticStep({
    id: input.id,
    label: input.label,
    status,
    summary: typeof input.summary === "string" ? input.summary : "",
    ...(typeof input.detail === "string" ? { detail: input.detail } : {}),
    ...(Array.isArray(input.evidence)
      ? { evidence: input.evidence.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(typeof input.action === "string" ? { action: input.action } : {}),
    ...(typeof input.retrySafe === "boolean" ? { retrySafe: input.retrySafe } : {}),
    source: "server",
    ...(typeof input.lastCheckedAt === "string" ? { lastCheckedAt: input.lastCheckedAt } : {}),
    ...(typeof input.userVisible === "boolean" ? { userVisible: input.userVisible } : {}),
  });
}

function sortTasks(tasks: ManagerTask[]): ManagerTask[] {
  return tasks.sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(500, Math.floor(limit)));
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

function isManagerTaskState(value: unknown): value is ManagerTaskState {
  return (
    value === "pending" ||
    value === "running" ||
    value === "blocked" ||
    value === "waiting_for_device" ||
    value === "restart_required" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isRequestedBy(value: unknown): value is ManagerTaskRequestedBy {
  return value === "browser" || value === "manager-assistant" || value === "system";
}

function isDiagnosticStatus(value: unknown): value is DiagnosticStep["status"] {
  return (
    value === "ok" ||
    value === "warn" ||
    value === "failed" ||
    value === "skipped" ||
    value === "repaired" ||
    value === "running" ||
    value === "pending" ||
    value === "unknown"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
