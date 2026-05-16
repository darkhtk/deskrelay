import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManagerProtocolMetadata, ManagerProtocolUpdateRequest } from "@deskrelay/shared";

export interface ManagerProtocolStore {
  get(projectId: string): Promise<ManagerProtocolMetadata | undefined>;
  update(projectId: string, patch: ManagerProtocolUpdateRequest): Promise<ManagerProtocolMetadata>;
}

export function createInMemoryManagerProtocolStore(
  options: { now?: () => Date } = {},
): ManagerProtocolStore {
  const now = options.now ?? (() => new Date());
  const rows = new Map<string, ManagerProtocolMetadata>();

  return {
    async get(projectId) {
      return rows.get(projectId);
    },
    async update(projectId, patch) {
      const next = patchProtocolMetadata(rows.get(projectId), projectId, patch, now());
      rows.set(projectId, next);
      return next;
    },
  };
}

export function createJsonManagerProtocolStore(
  directory: string,
  options: { now?: () => Date } = {},
): ManagerProtocolStore {
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  const readConsistent = async (projectId: string) => {
    await queue.catch(() => undefined);
    return await readProtocolMetadata(directory, projectId);
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
    async get(projectId) {
      return await readConsistent(projectId);
    },
    async update(projectId, patch) {
      return await mutate(async () => {
        const next = patchProtocolMetadata(
          await readProtocolMetadata(directory, projectId),
          projectId,
          patch,
          now(),
        );
        await writeProtocolMetadata(directory, next);
        return next;
      });
    },
  };
}

function patchProtocolMetadata(
  current: ManagerProtocolMetadata | undefined,
  projectId: string,
  patch: ManagerProtocolUpdateRequest,
  now: Date,
): ManagerProtocolMetadata {
  const updatedAt = now.toISOString();
  const base: ManagerProtocolMetadata = current ?? {
    projectId,
    version: "unversioned",
    activeRules: [],
    updatedAt,
  };
  const next: ManagerProtocolMetadata = {
    ...base,
    updatedAt,
  };
  if (typeof patch.version === "string") {
    const version = patch.version.trim();
    next.version = version || "unversioned";
  }
  if (Array.isArray(patch.activeRules)) {
    next.activeRules = normalizeRules(patch.activeRules);
  }
  if (patch.latestChange === null) {
    const { latestChange: _latestChange, ...withoutLatestChange } = next;
    return withoutLatestChange;
  }
  if (patch.latestChange && typeof patch.latestChange.summary === "string") {
    const summary = patch.latestChange.summary.trim();
    if (summary) {
      next.latestChange = {
        summary,
        changedAt: updatedAt,
        ...(typeof patch.latestChange.decisionId === "string" &&
        patch.latestChange.decisionId.trim()
          ? { decisionId: patch.latestChange.decisionId.trim().slice(0, 200) }
          : {}),
        ...(typeof patch.latestChange.roundId === "string" && patch.latestChange.roundId.trim()
          ? { roundId: patch.latestChange.roundId.trim().slice(0, 200) }
          : {}),
      };
    }
  }
  return next;
}

function normalizeRules(values: string[]): string[] {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const value of values) {
    const rule = value.trim().replace(/\s+/g, " ");
    if (!rule || seen.has(rule)) continue;
    seen.add(rule);
    rules.push(rule.slice(0, 500));
    if (rules.length >= 20) break;
  }
  return rules;
}

async function readProtocolMetadata(
  directory: string,
  projectId: string,
): Promise<ManagerProtocolMetadata | undefined> {
  try {
    const raw = JSON.parse(await readFile(protocolPath(directory, projectId), "utf8")) as unknown;
    return normalizeProtocolMetadata(raw, projectId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function normalizeProtocolMetadata(
  value: unknown,
  projectId: string,
): ManagerProtocolMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const updatedAt =
    typeof input.updatedAt === "string" ? input.updatedAt : new Date(0).toISOString();
  const metadata: ManagerProtocolMetadata = {
    projectId,
    version:
      typeof input.version === "string" && input.version.trim()
        ? input.version.trim().slice(0, 120)
        : "unversioned",
    activeRules: Array.isArray(input.activeRules)
      ? normalizeRules(input.activeRules.filter((rule): rule is string => typeof rule === "string"))
      : [],
    updatedAt,
  };
  if (input.latestChange && typeof input.latestChange === "object") {
    const change = input.latestChange as Record<string, unknown>;
    const summary = typeof change.summary === "string" ? change.summary.trim() : "";
    if (summary) {
      metadata.latestChange = {
        summary: summary.slice(0, 1_000),
        changedAt: typeof change.changedAt === "string" ? change.changedAt : metadata.updatedAt,
        ...(typeof change.decisionId === "string" && change.decisionId.trim()
          ? { decisionId: change.decisionId.trim().slice(0, 200) }
          : {}),
        ...(typeof change.roundId === "string" && change.roundId.trim()
          ? { roundId: change.roundId.trim().slice(0, 200) }
          : {}),
      };
    }
  }
  return metadata;
}

async function writeProtocolMetadata(
  directory: string,
  metadata: ManagerProtocolMetadata,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const target = protocolPath(directory, metadata.projectId);
  const tmp = `${target}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

function protocolPath(directory: string, projectId: string): string {
  return join(directory, `${projectId.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}
