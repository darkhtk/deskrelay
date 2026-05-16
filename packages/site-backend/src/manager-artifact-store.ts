import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ManagerArtifact,
  ManagerArtifactKind,
  ManagerArtifactSource,
  ManagerArtifactStatus,
  ManagerArtifactUpdateRequest,
  ManagerArtifactUpsertInput,
} from "@deskrelay/shared";

export interface ManagerArtifactListResult {
  artifacts: ManagerArtifact[];
  inactive: ManagerArtifact[];
}

export interface ManagerArtifactUpsertResult extends ManagerArtifactListResult {
  created: ManagerArtifact[];
  updated: ManagerArtifact[];
  unchanged: ManagerArtifact[];
}

export interface ManagerArtifactStore {
  list(projectId: string): Promise<ManagerArtifactListResult>;
  get(projectId: string, id: string): Promise<ManagerArtifact | undefined>;
  upsertMany(
    projectId: string,
    inputs: ManagerArtifactUpsertInput[],
  ): Promise<ManagerArtifactUpsertResult>;
  update(
    projectId: string,
    id: string,
    patch: ManagerArtifactUpdateRequest,
  ): Promise<ManagerArtifact | undefined>;
}

export function createInMemoryManagerArtifactStore(
  options: { now?: () => Date } = {},
): ManagerArtifactStore {
  const now = options.now ?? (() => new Date());
  const artifactsByProject = new Map<string, ManagerArtifact[]>();

  return {
    async list(projectId) {
      return splitArtifacts(artifactsByProject.get(projectId) ?? []);
    },
    async get(projectId, id) {
      return (artifactsByProject.get(projectId) ?? []).find((artifact) => artifact.id === id);
    },
    async upsertMany(projectId, inputs) {
      const result = upsertArtifacts(
        projectId,
        artifactsByProject.get(projectId) ?? [],
        inputs,
        now(),
      );
      artifactsByProject.set(projectId, result.all);
      return publicUpsertResult(result);
    },
    async update(projectId, id, patch) {
      const current = artifactsByProject.get(projectId) ?? [];
      const index = current.findIndex((artifact) => artifact.id === id);
      if (index < 0) return undefined;
      const updated = patchArtifact(current[index] as ManagerArtifact, patch, now());
      const next = [...current];
      next[index] = updated;
      artifactsByProject.set(projectId, next);
      return updated;
    },
  };
}

export function createJsonManagerArtifactStore(
  directory: string,
  options: { now?: () => Date } = {},
): ManagerArtifactStore {
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  const readConsistent = async (projectId: string) => {
    await queue.catch(() => undefined);
    return await readProjectArtifacts(directory, projectId);
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
      return splitArtifacts(await readConsistent(projectId));
    },

    async get(projectId, id) {
      return (await readConsistent(projectId)).find((artifact) => artifact.id === id);
    },

    async upsertMany(projectId, inputs) {
      return await mutate(async () => {
        const result = upsertArtifacts(
          projectId,
          await readProjectArtifacts(directory, projectId),
          inputs,
          now(),
        );
        await writeProjectArtifacts(directory, projectId, result.all);
        return publicUpsertResult(result);
      });
    },

    async update(projectId, id, patch) {
      return await mutate(async () => {
        const artifacts = await readProjectArtifacts(directory, projectId);
        const index = artifacts.findIndex((artifact) => artifact.id === id);
        if (index < 0) return undefined;
        const updated = patchArtifact(artifacts[index] as ManagerArtifact, patch, now());
        const next = [...artifacts];
        next[index] = updated;
        await writeProjectArtifacts(directory, projectId, next);
        return updated;
      });
    },
  };
}

interface InternalUpsertResult {
  all: ManagerArtifact[];
  created: ManagerArtifact[];
  updated: ManagerArtifact[];
  unchanged: ManagerArtifact[];
}

function upsertArtifacts(
  projectId: string,
  current: ManagerArtifact[],
  inputs: ManagerArtifactUpsertInput[],
  now: Date,
): InternalUpsertResult {
  const timestamp = now.toISOString();
  const next = [...current];
  const created: ManagerArtifact[] = [];
  const updated: ManagerArtifact[] = [];
  const unchanged: ManagerArtifact[] = [];
  const indexByPath = new Map<string, number>();

  for (const [index, artifact] of next.entries()) {
    indexByPath.set(normalizePathKey(artifact.path), index);
  }

  for (const input of dedupeInputs(inputs)) {
    const path = cleanText(input.path);
    if (!path) continue;
    const key = normalizePathKey(path);
    const existingIndex = indexByPath.get(key);

    if (existingIndex === undefined) {
      const artifact = createArtifact(projectId, input, path, timestamp);
      next.push(artifact);
      indexByPath.set(key, next.length - 1);
      created.push(artifact);
      continue;
    }

    const existing = next[existingIndex] as ManagerArtifact;
    const merged = mergeArtifact(existing, input, timestamp);
    next[existingIndex] = merged;
    if (artifactEquals(existing, merged)) {
      unchanged.push(merged);
    } else {
      updated.push(merged);
    }
  }

  return {
    all: sortArtifacts(next),
    created,
    updated,
    unchanged,
  };
}

function createArtifact(
  projectId: string,
  input: ManagerArtifactUpsertInput,
  path: string,
  timestamp: string,
): ManagerArtifact {
  const note = cleanText(input.note);
  const roundId = cleanText(input.roundId);
  const agentId = cleanText(input.agentId);
  const taskId = cleanText(input.taskId);
  return {
    id: `artifact_${randomBytes(10).toString("base64url")}`,
    projectId,
    path,
    kind: isArtifactKind(input.kind) ? input.kind : "unknown",
    status: isArtifactStatus(input.status) ? input.status : "active",
    owner: cleanText(input.owner) ?? "manager",
    source: isArtifactSource(input.source) ? input.source : "browser",
    discoveredAt: timestamp,
    updatedAt: timestamp,
    ...(note ? { note } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function mergeArtifact(
  artifact: ManagerArtifact,
  input: ManagerArtifactUpsertInput,
  timestamp: string,
): ManagerArtifact {
  const status = isInactiveStatus(artifact.status)
    ? artifact.status
    : isArtifactStatus(input.status)
      ? input.status
      : artifact.status;
  const note = input.note !== undefined ? cleanText(input.note) : artifact.note;
  const roundId = input.roundId !== undefined ? cleanText(input.roundId) : artifact.roundId;
  const agentId = input.agentId !== undefined ? cleanText(input.agentId) : artifact.agentId;
  const taskId = input.taskId !== undefined ? cleanText(input.taskId) : artifact.taskId;
  const merged: ManagerArtifact = {
    id: artifact.id,
    projectId: artifact.projectId,
    path: artifact.path,
    kind: isArtifactKind(input.kind) ? input.kind : artifact.kind,
    status,
    owner: cleanText(input.owner) ?? artifact.owner,
    source: isArtifactSource(input.source) ? input.source : artifact.source,
    discoveredAt: artifact.discoveredAt,
    updatedAt: artifact.updatedAt,
    ...(note ? { note } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
  return artifactEquals(artifact, merged) ? artifact : { ...merged, updatedAt: timestamp };
}

function patchArtifact(
  artifact: ManagerArtifact,
  patch: ManagerArtifactUpdateRequest,
  now: Date,
): ManagerArtifact {
  const note =
    patch.note === null
      ? undefined
      : patch.note !== undefined
        ? cleanText(patch.note)
        : artifact.note;
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    path: artifact.path,
    kind: isArtifactKind(patch.kind) ? patch.kind : artifact.kind,
    status: isArtifactStatus(patch.status) ? patch.status : artifact.status,
    owner: patch.owner !== undefined ? cleanText(patch.owner) || artifact.owner : artifact.owner,
    source: artifact.source,
    discoveredAt: artifact.discoveredAt,
    updatedAt: now.toISOString(),
    ...(note ? { note } : {}),
    ...(artifact.roundId ? { roundId: artifact.roundId } : {}),
    ...(artifact.agentId ? { agentId: artifact.agentId } : {}),
    ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
  };
}

async function readProjectArtifacts(
  directory: string,
  projectId: string,
): Promise<ManagerArtifact[]> {
  await mkdir(directory, { recursive: true });
  const path = artifactFilePath(directory, projectId);
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") return "";
    throw error;
  });
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as unknown;
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.artifacts)
      ? parsed.artifacts
      : [];
  return raw
    .map(normalizeArtifact)
    .filter((artifact): artifact is ManagerArtifact => Boolean(artifact));
}

async function writeProjectArtifacts(
  directory: string,
  projectId: string,
  artifacts: ManagerArtifact[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const path = artifactFilePath(directory, projectId);
  const tmp = `${path}.tmp`;
  await writeFile(
    tmp,
    `${JSON.stringify({ artifacts: sortArtifacts(artifacts) }, null, 2)}\n`,
    "utf8",
  );
  await rename(tmp, path);
}

function artifactFilePath(directory: string, projectId: string): string {
  return join(directory, `${encodeURIComponent(projectId)}.json`);
}

function publicUpsertResult(result: InternalUpsertResult): ManagerArtifactUpsertResult {
  return {
    ...splitArtifacts(result.all),
    created: sortArtifacts(result.created),
    updated: sortArtifacts(result.updated),
    unchanged: sortArtifacts(result.unchanged),
  };
}

function splitArtifacts(artifacts: ManagerArtifact[]): ManagerArtifactListResult {
  const sorted = sortArtifacts(artifacts);
  return {
    artifacts: sorted.filter((artifact) => !isInactiveStatus(artifact.status)),
    inactive: sorted.filter((artifact) => isInactiveStatus(artifact.status)),
  };
}

function sortArtifacts(artifacts: ManagerArtifact[]): ManagerArtifact[] {
  return [...artifacts].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.path.localeCompare(right.path) ||
      left.id.localeCompare(right.id),
  );
}

function dedupeInputs(inputs: ManagerArtifactUpsertInput[]): ManagerArtifactUpsertInput[] {
  const byPath = new Map<string, ManagerArtifactUpsertInput>();
  for (const input of inputs) {
    const path = cleanText(input.path);
    if (!path) continue;
    byPath.set(normalizePathKey(path), input);
  }
  return [...byPath.values()];
}

function normalizeArtifact(input: unknown): ManagerArtifact | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (typeof input.projectId !== "string" || !input.projectId.trim()) return null;
  if (typeof input.path !== "string" || !input.path.trim()) return null;
  if (!isArtifactKind(input.kind)) return null;
  if (!isArtifactStatus(input.status)) return null;
  if (!isArtifactSource(input.source)) return null;
  const discoveredAt = cleanText(input.discoveredAt) ?? new Date(0).toISOString();
  const note = cleanText(input.note);
  const roundId = cleanText(input.roundId);
  const agentId = cleanText(input.agentId);
  const taskId = cleanText(input.taskId);
  return {
    id: input.id,
    projectId: input.projectId,
    path: input.path,
    kind: input.kind,
    status: input.status,
    owner: cleanText(input.owner) ?? "manager",
    source: input.source,
    discoveredAt,
    updatedAt: cleanText(input.updatedAt) ?? discoveredAt,
    ...(note ? { note } : {}),
    ...(roundId ? { roundId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

function artifactEquals(left: ManagerArtifact, right: ManagerArtifact): boolean {
  return (
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.path === right.path &&
    left.kind === right.kind &&
    left.status === right.status &&
    left.owner === right.owner &&
    left.source === right.source &&
    left.note === right.note &&
    left.roundId === right.roundId &&
    left.agentId === right.agentId &&
    left.taskId === right.taskId &&
    left.discoveredAt === right.discoveredAt
  );
}

function normalizePathKey(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isInactiveStatus(value: ManagerArtifactStatus): boolean {
  return value === "obsolete" || value === "failed" || value === "missing";
}

function isArtifactStatus(value: unknown): value is ManagerArtifactStatus {
  return (
    value === "active" ||
    value === "draft" ||
    value === "obsolete" ||
    value === "failed" ||
    value === "missing"
  );
}

function isArtifactKind(value: unknown): value is ManagerArtifactKind {
  return (
    value === "protocol" ||
    value === "report" ||
    value === "code" ||
    value === "config" ||
    value === "log" ||
    value === "document" ||
    value === "unknown"
  );
}

function isArtifactSource(value: unknown): value is ManagerArtifactSource {
  return (
    value === "manager" ||
    value === "browser" ||
    value === "worker" ||
    value === "system" ||
    value === "scan"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
