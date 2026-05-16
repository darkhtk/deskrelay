import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ManagerBlocker,
  ManagerBlockerCreateRequest,
  ManagerBlockerRequiredAction,
  ManagerBlockerResolveRequest,
  ManagerBlockerSeverity,
  ManagerBlockerSource,
  ManagerBlockerStatus,
} from "@deskrelay/shared";

export interface ManagerBlockerListResult {
  blockers: ManagerBlocker[];
  resolved: ManagerBlocker[];
}

export interface ManagerBlockerCreateResult {
  blocker: ManagerBlocker;
  created: boolean;
}

export interface ManagerBlockerStore {
  list(projectId: string): Promise<ManagerBlockerListResult>;
  get(projectId: string, id: string): Promise<ManagerBlocker | undefined>;
  create(
    projectId: string,
    input: ManagerBlockerCreateRequest,
  ): Promise<ManagerBlockerCreateResult>;
  resolve(
    projectId: string,
    id: string,
    input?: ManagerBlockerResolveRequest,
  ): Promise<ManagerBlocker | undefined>;
}

export function createInMemoryManagerBlockerStore(
  options: { now?: () => Date } = {},
): ManagerBlockerStore {
  const now = options.now ?? (() => new Date());
  const blockersByProject = new Map<string, ManagerBlocker[]>();

  return {
    async list(projectId) {
      return splitBlockers(blockersByProject.get(projectId) ?? []);
    },
    async get(projectId, id) {
      return (blockersByProject.get(projectId) ?? []).find((blocker) => blocker.id === id);
    },
    async create(projectId, input) {
      const current = blockersByProject.get(projectId) ?? [];
      const existing = findOpenBlockerByDedupeKey(current, input.dedupeKey);
      if (existing) return { blocker: existing, created: false };
      const blocker = createBlocker(projectId, input, now());
      blockersByProject.set(projectId, [...current, blocker]);
      return { blocker, created: true };
    },
    async resolve(projectId, id, input) {
      const current = blockersByProject.get(projectId) ?? [];
      const index = current.findIndex((blocker) => blocker.id === id);
      if (index < 0) return undefined;
      const updated = resolveBlocker(current[index] as ManagerBlocker, input, now());
      const next = [...current];
      next[index] = updated;
      blockersByProject.set(projectId, next);
      return updated;
    },
  };
}

export function createJsonManagerBlockerStore(
  directory: string,
  options: { now?: () => Date } = {},
): ManagerBlockerStore {
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  const readConsistent = async (projectId: string) => {
    await queue.catch(() => undefined);
    return await readProjectBlockers(directory, projectId);
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
    async list(projectId) {
      return splitBlockers(await readConsistent(projectId));
    },

    async get(projectId, id) {
      return (await readConsistent(projectId)).find((blocker) => blocker.id === id);
    },

    async create(projectId, input) {
      return await mutate(async () => {
        const blockers = await readProjectBlockers(directory, projectId);
        const existing = findOpenBlockerByDedupeKey(blockers, input.dedupeKey);
        if (existing) return { blocker: existing, created: false };
        const blocker = createBlocker(projectId, input, now());
        await writeProjectBlockers(directory, projectId, [...blockers, blocker]);
        return { blocker, created: true };
      });
    },

    async resolve(projectId, id, input) {
      return await mutate(async () => {
        const blockers = await readProjectBlockers(directory, projectId);
        const index = blockers.findIndex((blocker) => blocker.id === id);
        if (index < 0) return undefined;
        const updated = resolveBlocker(blockers[index] as ManagerBlocker, input, now());
        const next = [...blockers];
        next[index] = updated;
        await writeProjectBlockers(directory, projectId, next);
        return updated;
      });
    },
  };
}

function createBlocker(
  projectId: string,
  input: ManagerBlockerCreateRequest,
  now: Date,
): ManagerBlocker {
  const createdAt = now.toISOString();
  const detail = cleanText(input.detail);
  const dedupeKey = cleanText(input.dedupeKey);
  const roundId = cleanText(input.roundId);
  const agentId = cleanText(input.agentId);
  const taskId = cleanText(input.taskId);
  return {
    id: `blocker_${randomBytes(10).toString("base64url")}`,
    projectId,
    title: cleanText(input.title) || "Untitled blocker",
    severity: isBlockerSeverity(input.severity) ? input.severity : "warning",
    owner: cleanText(input.owner) || "manager",
    requiredAction: isRequiredAction(input.requiredAction) ? input.requiredAction : "manager",
    status: "open",
    source: isBlockerSource(input.source) ? input.source : "browser",
    createdAt,
    updatedAt: createdAt,
    ...(detail ? { detail } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function resolveBlocker(
  blocker: ManagerBlocker,
  input: ManagerBlockerResolveRequest | undefined,
  now: Date,
): ManagerBlocker {
  const status = input?.status === "dismissed" ? "dismissed" : "resolved";
  const resolution = cleanText(input?.resolution);
  const resolvedAt = blocker.resolvedAt ?? now.toISOString();
  return {
    ...blocker,
    status,
    updatedAt: now.toISOString(),
    resolvedAt,
    ...(resolution ? { resolution } : blocker.resolution ? { resolution: blocker.resolution } : {}),
  };
}

async function readProjectBlockers(
  directory: string,
  projectId: string,
): Promise<ManagerBlocker[]> {
  await mkdir(directory, { recursive: true });
  const path = blockerFilePath(directory, projectId);
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return "";
    throw error;
  });
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as unknown;
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.blockers)
      ? parsed.blockers
      : [];
  return raw.map(normalizeBlocker).filter((blocker): blocker is ManagerBlocker => Boolean(blocker));
}

async function writeProjectBlockers(
  directory: string,
  projectId: string,
  blockers: ManagerBlocker[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const path = blockerFilePath(directory, projectId);
  const tmp = `${path}.tmp`;
  await writeFile(
    tmp,
    `${JSON.stringify({ blockers: sortBlockers(blockers) }, null, 2)}\n`,
    "utf8",
  );
  await rename(tmp, path);
}

function blockerFilePath(directory: string, projectId: string): string {
  return join(directory, `${encodeURIComponent(projectId)}.json`);
}

function splitBlockers(blockers: ManagerBlocker[]): ManagerBlockerListResult {
  const sorted = sortBlockers(blockers);
  return {
    blockers: sorted.filter((blocker) => blocker.status === "open"),
    resolved: sorted.filter((blocker) => blocker.status !== "open"),
  };
}

function sortBlockers(blockers: ManagerBlocker[]): ManagerBlocker[] {
  return [...blockers].sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

function findOpenBlockerByDedupeKey(
  blockers: ManagerBlocker[],
  dedupeKey: unknown,
): ManagerBlocker | undefined {
  const key = cleanText(dedupeKey);
  if (!key) return undefined;
  return blockers.find((blocker) => blocker.status === "open" && blocker.dedupeKey === key);
}

function normalizeBlocker(input: unknown): ManagerBlocker | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (typeof input.projectId !== "string" || !input.projectId.trim()) return null;
  if (!isBlockerSeverity(input.severity)) return null;
  if (!isRequiredAction(input.requiredAction)) return null;
  if (!isBlockerStatus(input.status)) return null;
  const createdAt = cleanText(input.createdAt) ?? new Date(0).toISOString();
  const detail = cleanText(input.detail);
  const dedupeKey = cleanText(input.dedupeKey);
  const resolution = cleanText(input.resolution);
  const resolvedAt = cleanText(input.resolvedAt);
  const roundId = cleanText(input.roundId);
  const agentId = cleanText(input.agentId);
  const taskId = cleanText(input.taskId);
  return {
    id: input.id,
    projectId: input.projectId,
    title: cleanText(input.title) ?? "Untitled blocker",
    severity: input.severity,
    owner: cleanText(input.owner) ?? "manager",
    requiredAction: input.requiredAction,
    status: input.status,
    source: isBlockerSource(input.source) ? input.source : "browser",
    createdAt,
    updatedAt: cleanText(input.updatedAt) ?? createdAt,
    ...(detail ? { detail } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
    ...(resolution ? { resolution } : {}),
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function severityRank(value: ManagerBlockerSeverity): number {
  if (value === "error") return 3;
  if (value === "warning") return 2;
  return 1;
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isBlockerSeverity(value: unknown): value is ManagerBlockerSeverity {
  return value === "info" || value === "warning" || value === "error";
}

function isRequiredAction(value: unknown): value is ManagerBlockerRequiredAction {
  return value === "user" || value === "manager" || value === "worker" || value === "none";
}

function isBlockerStatus(value: unknown): value is ManagerBlockerStatus {
  return value === "open" || value === "resolved" || value === "dismissed";
}

function isBlockerSource(value: unknown): value is ManagerBlockerSource {
  return value === "manager" || value === "browser" || value === "worker" || value === "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
