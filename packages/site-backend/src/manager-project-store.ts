import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  ManagerProject,
  ManagerProjectCorruptRecord,
  ManagerProjectCreateRequest,
  ManagerProjectStatus,
  ManagerProjectUpdateRequest,
} from "@deskrelay/shared";

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
  const name = cleanText(input.name) || basename(cwd) || "DeskRelay project";
  const status =
    input.status && input.status !== "archived" && isProjectStatus(input.status)
      ? input.status
      : "planning";
  const goal = cleanText(input.goal) || "";
  const activeRoundId = cleanText(input.activeRoundId);
  return {
    id: `project_${randomBytes(10).toString("base64url")}`,
    name,
    cwd,
    goal,
    status,
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
  return {
    id: input.id,
    name: cleanText(input.name) ?? basename(input.cwd) ?? "DeskRelay project",
    cwd: input.cwd,
    goal: cleanText(input.goal) ?? "",
    status: input.status,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
