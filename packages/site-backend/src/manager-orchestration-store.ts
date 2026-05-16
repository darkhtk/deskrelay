import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ManagerAgent,
  ManagerAgentCreateRequest,
  ManagerAgentStatus,
  ManagerRound,
  ManagerRoundCreateRequest,
  ManagerRoundStatus,
} from "@deskrelay/shared";

interface OrchestrationState {
  agents: ManagerAgent[];
  rounds: ManagerRound[];
}

export type ManagerAgentPatch = Partial<
  Pick<
    ManagerAgent,
    | "label"
    | "projectId"
    | "profile"
    | "status"
    | "cwd"
    | "roundId"
    | "taskId"
    | "sessionId"
    | "lastInstruction"
    | "lastOutput"
    | "lastError"
    | "lastHeartbeatAt"
    | "lastOutputAt"
    | "acknowledgedAt"
    | "acknowledgedBy"
    | "acknowledgedReason"
  >
>;

export type ManagerRoundPatch = Partial<
  Pick<
    ManagerRound,
    | "title"
    | "projectId"
    | "objective"
    | "status"
    | "agentIds"
    | "taskIds"
    | "startedAt"
    | "completedAt"
    | "summary"
    | "error"
    | "acknowledgedAt"
    | "acknowledgedBy"
    | "acknowledgedReason"
  >
>;

export interface ManagerOrchestrationStore {
  listAgents(): Promise<ManagerAgent[]>;
  getAgent(id: string): Promise<ManagerAgent | undefined>;
  createAgent(input: ManagerAgentCreateRequest): Promise<ManagerAgent>;
  updateAgent(id: string, patch: ManagerAgentPatch): Promise<ManagerAgent | undefined>;
  listRounds(): Promise<ManagerRound[]>;
  getRound(id: string): Promise<ManagerRound | undefined>;
  createRound(input: ManagerRoundCreateRequest): Promise<ManagerRound>;
  updateRound(id: string, patch: ManagerRoundPatch): Promise<ManagerRound | undefined>;
}

export function createInMemoryManagerOrchestrationStore(
  options: { now?: () => Date } = {},
): ManagerOrchestrationStore {
  const now = options.now ?? (() => new Date());
  const state: OrchestrationState = { agents: [], rounds: [] };

  return {
    async listAgents() {
      return sortAgents(state.agents);
    },
    async getAgent(id) {
      return state.agents.find((agent) => agent.id === id);
    },
    async createAgent(input) {
      const agent = createAgentRecord(input, now());
      state.agents = sortAgents([agent, ...state.agents]);
      return agent;
    },
    async updateAgent(id, patch) {
      const index = state.agents.findIndex((agent) => agent.id === id);
      if (index < 0) return undefined;
      const updated = patchAgent(state.agents[index] as ManagerAgent, patch, now());
      state.agents = sortAgents([
        ...state.agents.slice(0, index),
        updated,
        ...state.agents.slice(index + 1),
      ]);
      return updated;
    },
    async listRounds() {
      return sortRounds(state.rounds);
    },
    async getRound(id) {
      return state.rounds.find((round) => round.id === id);
    },
    async createRound(input) {
      const round = createRoundRecord(input, now());
      state.rounds = sortRounds([round, ...state.rounds]);
      return round;
    },
    async updateRound(id, patch) {
      const index = state.rounds.findIndex((round) => round.id === id);
      if (index < 0) return undefined;
      const updated = patchRound(state.rounds[index] as ManagerRound, patch, now());
      state.rounds = sortRounds([
        ...state.rounds.slice(0, index),
        updated,
        ...state.rounds.slice(index + 1),
      ]);
      return updated;
    },
  };
}

export function createJsonManagerOrchestrationStore(
  filePath: string,
  options: { maxAgents?: number; maxRounds?: number; now?: () => Date } = {},
): ManagerOrchestrationStore {
  const maxAgents = Math.max(1, options.maxAgents ?? 200);
  const maxRounds = Math.max(1, options.maxRounds ?? 100);
  const now = options.now ?? (() => new Date());
  let queue: Promise<unknown> = Promise.resolve();

  const readConsistent = async () => {
    await queue.catch(() => undefined);
    return await readState(filePath);
  };

  const mutate = async <T>(fn: (state: OrchestrationState) => Promise<T> | T): Promise<T> => {
    const run = queue.then(async () => {
      const state = await readState(filePath);
      return await fn(state);
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  };

  return {
    async listAgents() {
      return sortAgents((await readConsistent()).agents).slice(0, maxAgents);
    },
    async getAgent(id) {
      return (await readConsistent()).agents.find((agent) => agent.id === id);
    },
    async createAgent(input) {
      return await mutate(async (state) => {
        const agent = createAgentRecord(input, now());
        const next = {
          ...state,
          agents: sortAgents([agent, ...state.agents]).slice(0, maxAgents),
        };
        await writeState(filePath, next);
        return agent;
      });
    },
    async updateAgent(id, patch) {
      return await mutate(async (state) => {
        const index = state.agents.findIndex((agent) => agent.id === id);
        if (index < 0) return undefined;
        const updated = patchAgent(state.agents[index] as ManagerAgent, patch, now());
        const agents = [...state.agents];
        agents[index] = updated;
        await writeState(filePath, {
          ...state,
          agents: sortAgents(agents).slice(0, maxAgents),
        });
        return updated;
      });
    },
    async listRounds() {
      return sortRounds((await readConsistent()).rounds).slice(0, maxRounds);
    },
    async getRound(id) {
      return (await readConsistent()).rounds.find((round) => round.id === id);
    },
    async createRound(input) {
      return await mutate(async (state) => {
        const round = createRoundRecord(input, now());
        await writeState(filePath, {
          ...state,
          rounds: sortRounds([round, ...state.rounds]).slice(0, maxRounds),
        });
        return round;
      });
    },
    async updateRound(id, patch) {
      return await mutate(async (state) => {
        const index = state.rounds.findIndex((round) => round.id === id);
        if (index < 0) return undefined;
        const updated = patchRound(state.rounds[index] as ManagerRound, patch, now());
        const rounds = [...state.rounds];
        rounds[index] = updated;
        await writeState(filePath, {
          ...state,
          rounds: sortRounds(rounds).slice(0, maxRounds),
        });
        return updated;
      });
    },
  };
}

function createAgentRecord(input: ManagerAgentCreateRequest, now: Date): ManagerAgent {
  const createdAt = now.toISOString();
  const role = input.role.trim();
  const instruction = input.instruction?.trim();
  return {
    id: `agent_${randomBytes(10).toString("base64url")}`,
    ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
    role,
    label: input.label?.trim() || defaultAgentLabel(role),
    profile: input.profile?.trim() || "claude-code",
    status: instruction ? "assigned" : "idle",
    ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
    ...(input.roundId?.trim() ? { roundId: input.roundId.trim() } : {}),
    ...(instruction ? { lastInstruction: instruction } : {}),
    createdAt,
    updatedAt: createdAt,
  };
}

function patchAgent(agent: ManagerAgent, patch: ManagerAgentPatch, now: Date): ManagerAgent {
  return {
    ...agent,
    ...cleanUndefined(patch),
    updatedAt: now.toISOString(),
  };
}

function createRoundRecord(input: ManagerRoundCreateRequest, now: Date): ManagerRound {
  const createdAt = now.toISOString();
  return {
    id: `round_${randomBytes(10).toString("base64url")}`,
    ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
    title: input.title?.trim() || "Orchestration round",
    objective: input.objective.trim(),
    status: "planned",
    agentIds: [],
    taskIds: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function patchRound(round: ManagerRound, patch: ManagerRoundPatch, now: Date): ManagerRound {
  return {
    ...round,
    ...cleanUndefined(patch),
    updatedAt: now.toISOString(),
  };
}

async function readState(path: string): Promise<OrchestrationState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (isRecord(parsed)) {
      return {
        agents: Array.isArray(parsed.agents)
          ? parsed.agents.map(normalizeAgent).filter(isPresent)
          : [],
        rounds: Array.isArray(parsed.rounds)
          ? parsed.rounds.map(normalizeRound).filter(isPresent)
          : [],
      };
    }
  } catch {
    return { agents: [], rounds: [] };
  }
  return { agents: [], rounds: [] };
}

async function writeState(path: string, state: OrchestrationState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function normalizeAgent(input: unknown): ManagerAgent | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (typeof input.role !== "string" || !input.role.trim()) return null;
  if (!isAgentStatus(input.status)) return null;
  const createdAt = nonEmptyString(input.createdAt) ?? new Date(0).toISOString();
  const cwd = nonEmptyString(input.cwd);
  const projectId = nonEmptyString(input.projectId);
  const roundId = nonEmptyString(input.roundId);
  const taskId = nonEmptyString(input.taskId);
  const sessionId = nonEmptyString(input.sessionId);
  const lastInstruction = nonEmptyString(input.lastInstruction);
  const lastOutput = nonEmptyString(input.lastOutput);
  const lastError = nonEmptyString(input.lastError);
  const lastHeartbeatAt = nonEmptyString(input.lastHeartbeatAt);
  const lastOutputAt = nonEmptyString(input.lastOutputAt);
  const acknowledgedAt = nonEmptyString(input.acknowledgedAt);
  const acknowledgedBy = nonEmptyString(input.acknowledgedBy);
  const acknowledgedReason = nonEmptyString(input.acknowledgedReason);
  return {
    id: input.id,
    ...(projectId ? { projectId } : {}),
    role: input.role,
    label: nonEmptyString(input.label) ?? defaultAgentLabel(input.role),
    profile: nonEmptyString(input.profile) ?? "claude-code",
    status: input.status,
    ...(cwd ? { cwd } : {}),
    ...(roundId ? { roundId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(lastInstruction ? { lastInstruction } : {}),
    ...(lastOutput ? { lastOutput } : {}),
    ...(lastError ? { lastError } : {}),
    ...(lastHeartbeatAt ? { lastHeartbeatAt } : {}),
    ...(lastOutputAt ? { lastOutputAt } : {}),
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
    ...(acknowledgedBy ? { acknowledgedBy } : {}),
    ...(acknowledgedReason ? { acknowledgedReason } : {}),
    createdAt,
    updatedAt: nonEmptyString(input.updatedAt) ?? createdAt,
  };
}

function normalizeRound(input: unknown): ManagerRound | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (!isRoundStatus(input.status)) return null;
  const createdAt = nonEmptyString(input.createdAt) ?? new Date(0).toISOString();
  const projectId = nonEmptyString(input.projectId);
  const startedAt = nonEmptyString(input.startedAt);
  const completedAt = nonEmptyString(input.completedAt);
  const summary = nonEmptyString(input.summary);
  const error = nonEmptyString(input.error);
  const acknowledgedAt = nonEmptyString(input.acknowledgedAt);
  const acknowledgedBy = nonEmptyString(input.acknowledgedBy);
  const acknowledgedReason = nonEmptyString(input.acknowledgedReason);
  return {
    id: input.id,
    ...(projectId ? { projectId } : {}),
    title: nonEmptyString(input.title) ?? "Orchestration round",
    objective: nonEmptyString(input.objective) ?? "",
    status: input.status,
    agentIds: stringArray(input.agentIds),
    taskIds: stringArray(input.taskIds),
    createdAt,
    updatedAt: nonEmptyString(input.updatedAt) ?? createdAt,
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {}),
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
    ...(acknowledgedBy ? { acknowledgedBy } : {}),
    ...(acknowledgedReason ? { acknowledgedReason } : {}),
  };
}

function defaultAgentLabel(role: string): string {
  return `${role.slice(0, 1).toUpperCase()}${role.slice(1)} agent`;
}

function sortAgents(agents: ManagerAgent[]): ManagerAgent[] {
  return [...agents].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

function sortRounds(rounds: ManagerRound[]): ManagerRound[] {
  return [...rounds].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

function isAgentStatus(value: unknown): value is ManagerAgentStatus {
  return (
    value === "idle" ||
    value === "assigned" ||
    value === "running" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "stale"
  );
}

function isRoundStatus(value: unknown): value is ManagerRoundStatus {
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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function cleanUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
