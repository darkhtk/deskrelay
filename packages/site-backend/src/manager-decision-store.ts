import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ManagerDecision,
  ManagerDecisionAuthor,
  ManagerDecisionCreateRequest,
  ManagerDecisionRevision,
  ManagerDecisionStatus,
  ManagerDecisionUpdateRequest,
} from "@deskrelay/shared";

export interface ManagerDecisionListResult {
  decisions: ManagerDecision[];
  archived: ManagerDecision[];
}

export interface ManagerDecisionStore {
  list(projectId: string): Promise<ManagerDecisionListResult>;
  get(projectId: string, id: string): Promise<ManagerDecision | undefined>;
  create(projectId: string, input: ManagerDecisionCreateRequest): Promise<ManagerDecision>;
  update(
    projectId: string,
    id: string,
    patch: ManagerDecisionUpdateRequest,
  ): Promise<ManagerDecision | undefined>;
}

export function createInMemoryManagerDecisionStore(
  options: { now?: () => Date } = {},
): ManagerDecisionStore {
  const now = options.now ?? (() => new Date());
  const decisionsByProject = new Map<string, ManagerDecision[]>();

  return {
    async list(projectId) {
      return splitDecisions(decisionsByProject.get(projectId) ?? []);
    },
    async get(projectId, id) {
      return (decisionsByProject.get(projectId) ?? []).find((decision) => decision.id === id);
    },
    async create(projectId, input) {
      const decision = createDecision(projectId, input, now());
      decisionsByProject.set(projectId, [...(decisionsByProject.get(projectId) ?? []), decision]);
      return decision;
    },
    async update(projectId, id, patch) {
      const current = decisionsByProject.get(projectId) ?? [];
      const index = current.findIndex((decision) => decision.id === id);
      if (index < 0) return undefined;
      const updated = patchDecision(current[index] as ManagerDecision, patch, now());
      const next = [...current];
      next[index] = updated;
      decisionsByProject.set(projectId, next);
      return updated;
    },
  };
}

export function createJsonManagerDecisionStore(
  directory: string,
  options: { now?: () => Date } = {},
): ManagerDecisionStore {
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  const readConsistent = async (projectId: string) => {
    await queue.catch(() => undefined);
    return await readProjectDecisions(directory, projectId);
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
      return splitDecisions(await readConsistent(projectId));
    },

    async get(projectId, id) {
      return (await readConsistent(projectId)).find((decision) => decision.id === id);
    },

    async create(projectId, input) {
      return await mutate(async () => {
        const decisions = await readProjectDecisions(directory, projectId);
        const decision = createDecision(projectId, input, now());
        await writeProjectDecisions(directory, projectId, [...decisions, decision]);
        return decision;
      });
    },

    async update(projectId, id, patch) {
      return await mutate(async () => {
        const decisions = await readProjectDecisions(directory, projectId);
        const index = decisions.findIndex((decision) => decision.id === id);
        if (index < 0) return undefined;
        const updated = patchDecision(decisions[index] as ManagerDecision, patch, now());
        const next = [...decisions];
        next[index] = updated;
        await writeProjectDecisions(directory, projectId, next);
        return updated;
      });
    },
  };
}

function createDecision(
  projectId: string,
  input: ManagerDecisionCreateRequest,
  now: Date,
): ManagerDecision {
  const createdAt = now.toISOString();
  const rationale = cleanText(input.rationale);
  const roundId = cleanText(input.roundId);
  const agentId = cleanText(input.agentId);
  const taskId = cleanText(input.taskId);
  return {
    id: `decision_${randomBytes(10).toString("base64url")}`,
    projectId,
    title: cleanText(input.title) || "Untitled decision",
    detail: cleanText(input.detail) || "",
    status: isDecisionStatus(input.status) && input.status !== "archived" ? input.status : "active",
    tags: cleanTags(input.tags),
    createdAt,
    updatedAt: createdAt,
    createdBy: isDecisionAuthor(input.createdBy) ? input.createdBy : "browser",
    revisions: [],
    ...(rationale ? { rationale } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function patchDecision(
  decision: ManagerDecision,
  patch: ManagerDecisionUpdateRequest,
  now: Date,
): ManagerDecision {
  const updatedAt = now.toISOString();
  const revision = decisionRevision(decision);
  const rationale =
    patch.rationale === null
      ? undefined
      : patch.rationale !== undefined
        ? cleanText(patch.rationale)
        : decision.rationale;
  const roundId =
    patch.roundId === null
      ? undefined
      : patch.roundId !== undefined
        ? cleanText(patch.roundId)
        : decision.roundId;
  const agentId =
    patch.agentId === null
      ? undefined
      : patch.agentId !== undefined
        ? cleanText(patch.agentId)
        : decision.agentId;
  const taskId =
    patch.taskId === null
      ? undefined
      : patch.taskId !== undefined
        ? cleanText(patch.taskId)
        : decision.taskId;

  return {
    id: decision.id,
    projectId: decision.projectId,
    title: patch.title !== undefined ? cleanText(patch.title) || decision.title : decision.title,
    detail: patch.detail !== undefined ? cleanText(patch.detail) || "" : decision.detail,
    status: isDecisionStatus(patch.status) ? patch.status : decision.status,
    tags: patch.tags !== undefined ? cleanTags(patch.tags) : decision.tags,
    createdAt: decision.createdAt,
    updatedAt,
    createdBy: decision.createdBy,
    revisions: [...decision.revisions, revision],
    ...(rationale ? { rationale } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function decisionRevision(decision: ManagerDecision): ManagerDecisionRevision {
  return {
    id: `decision_rev_${randomBytes(8).toString("base64url")}`,
    title: decision.title,
    detail: decision.detail,
    status: decision.status,
    tags: decision.tags,
    createdAt: decision.updatedAt,
    createdBy: decision.createdBy,
    ...(decision.rationale ? { rationale: decision.rationale } : {}),
    ...(decision.roundId ? { roundId: decision.roundId } : {}),
    ...(decision.agentId ? { agentId: decision.agentId } : {}),
    ...(decision.taskId ? { taskId: decision.taskId } : {}),
  };
}

async function readProjectDecisions(
  directory: string,
  projectId: string,
): Promise<ManagerDecision[]> {
  await mkdir(directory, { recursive: true });
  const path = decisionFilePath(directory, projectId);
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return "";
    throw error;
  });
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as unknown;
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.decisions)
      ? parsed.decisions
      : [];
  return raw
    .map(normalizeDecision)
    .filter((decision): decision is ManagerDecision => Boolean(decision));
}

async function writeProjectDecisions(
  directory: string,
  projectId: string,
  decisions: ManagerDecision[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const path = decisionFilePath(directory, projectId);
  const tmp = `${path}.tmp`;
  await writeFile(
    tmp,
    `${JSON.stringify({ decisions: sortDecisions(decisions) }, null, 2)}\n`,
    "utf8",
  );
  await rename(tmp, path);
}

function decisionFilePath(directory: string, projectId: string): string {
  return join(directory, `${encodeURIComponent(projectId)}.json`);
}

function splitDecisions(decisions: ManagerDecision[]): ManagerDecisionListResult {
  const sorted = sortDecisions(decisions);
  return {
    decisions: sorted.filter((decision) => decision.status !== "archived"),
    archived: sorted.filter((decision) => decision.status === "archived"),
  };
}

function sortDecisions(decisions: ManagerDecision[]): ManagerDecision[] {
  return [...decisions].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

function normalizeDecision(input: unknown): ManagerDecision | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (typeof input.projectId !== "string" || !input.projectId.trim()) return null;
  if (!isDecisionStatus(input.status)) return null;
  const createdAt = cleanText(input.createdAt) ?? new Date(0).toISOString();
  const revisions = Array.isArray(input.revisions)
    ? input.revisions
        .map(normalizeRevision)
        .filter((revision): revision is ManagerDecisionRevision => Boolean(revision))
    : [];
  const rationale = cleanText(input.rationale);
  const roundId = cleanText(input.roundId);
  const agentId = cleanText(input.agentId);
  const taskId = cleanText(input.taskId);
  return {
    id: input.id,
    projectId: input.projectId,
    title: cleanText(input.title) ?? "Untitled decision",
    detail: cleanText(input.detail) ?? "",
    status: input.status,
    tags: cleanTags(input.tags),
    createdAt,
    updatedAt: cleanText(input.updatedAt) ?? createdAt,
    createdBy: isDecisionAuthor(input.createdBy) ? input.createdBy : "browser",
    revisions,
    ...(rationale ? { rationale } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function normalizeRevision(input: unknown): ManagerDecisionRevision | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (!isDecisionStatus(input.status)) return null;
  const createdAt = cleanText(input.createdAt) ?? new Date(0).toISOString();
  const rationale = cleanText(input.rationale);
  const roundId = cleanText(input.roundId);
  const agentId = cleanText(input.agentId);
  const taskId = cleanText(input.taskId);
  return {
    id: input.id,
    title: cleanText(input.title) ?? "Untitled decision",
    detail: cleanText(input.detail) ?? "",
    status: input.status,
    tags: cleanTags(input.tags),
    createdAt,
    createdBy: isDecisionAuthor(input.createdBy) ? input.createdBy : "browser",
    ...(rationale ? { rationale } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    const tag = cleanText(item)?.slice(0, 48);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function isDecisionStatus(value: unknown): value is ManagerDecisionStatus {
  return value === "active" || value === "superseded" || value === "archived";
}

function isDecisionAuthor(value: unknown): value is ManagerDecisionAuthor {
  return value === "manager" || value === "browser" || value === "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
