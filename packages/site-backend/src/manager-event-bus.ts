import type {
  ManagerDecisionUpdateRequest,
  ManagerEvent,
  ManagerEventInput,
} from "@deskrelay/shared";
import type { ManagerDecisionStore } from "./manager-decision-store.ts";
import type {
  ManagerAgentPatch,
  ManagerOrchestrationStore,
  ManagerRoundPatch,
} from "./manager-orchestration-store.ts";
import type { ManagerProjectStore } from "./manager-project-store.ts";
import type { ManagerTaskPatch, ManagerTaskStore } from "./manager-task-store.ts";

export type ManagerEventListener = (event: ManagerEvent) => void;

export interface ManagerEventBus {
  emit(input: ManagerEventInput): ManagerEvent;
  subscribe(listener: ManagerEventListener): () => void;
  recent(afterSeq?: number): ManagerEvent[];
  getLastSeq(): number;
}

export function createManagerEventBus(
  options: { now?: () => Date; maxEvents?: number } = {},
): ManagerEventBus {
  const now = options.now ?? (() => new Date());
  const maxEvents = Math.max(1, options.maxEvents ?? 250);
  const listeners = new Set<ManagerEventListener>();
  let seq = 0;
  let events: ManagerEvent[] = [];

  return {
    emit(input) {
      seq += 1;
      const event: ManagerEvent = {
        ...input,
        id: `manager_evt_${seq}`,
        seq,
        generatedAt: now().toISOString(),
      };
      events = [...events, event].slice(-maxEvents);
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Event delivery must never break the manager mutation that produced it.
        }
      }
      return event;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    recent(afterSeq = 0) {
      return events.filter((event) => event.seq > afterSeq);
    },

    getLastSeq() {
      return seq;
    },
  };
}

export function withManagerTaskEvents(
  store: ManagerTaskStore,
  bus: ManagerEventBus,
): ManagerTaskStore {
  return {
    list(limit) {
      return store.list(limit);
    },
    get(id) {
      return store.get(id);
    },
    async create(input) {
      const task = await store.create(input);
      bus.emit({ type: "task.created", task });
      return task;
    },
    async update(id: string, patch: ManagerTaskPatch) {
      const task = await store.update(id, patch);
      if (task) bus.emit({ type: "task.updated", task });
      return task;
    },
  };
}

export function withManagerOrchestrationEvents(
  store: ManagerOrchestrationStore,
  bus: ManagerEventBus,
): ManagerOrchestrationStore {
  return {
    listAgents() {
      return store.listAgents();
    },
    getAgent(id) {
      return store.getAgent(id);
    },
    async createAgent(input) {
      const agent = await store.createAgent(input);
      bus.emit({ type: "agent.created", agent });
      return agent;
    },
    async updateAgent(id: string, patch: ManagerAgentPatch) {
      const agent = await store.updateAgent(id, patch);
      if (agent) bus.emit({ type: "agent.updated", agent });
      return agent;
    },
    listRounds() {
      return store.listRounds();
    },
    getRound(id) {
      return store.getRound(id);
    },
    async createRound(input) {
      const round = await store.createRound(input);
      bus.emit({ type: "round.created", round });
      return round;
    },
    async updateRound(id: string, patch: ManagerRoundPatch) {
      const round = await store.updateRound(id, patch);
      if (round) bus.emit({ type: "round.updated", round });
      return round;
    },
  };
}

export function withManagerProjectEvents(
  store: ManagerProjectStore,
  bus: ManagerEventBus,
): ManagerProjectStore {
  return {
    list() {
      return store.list();
    },
    get(id) {
      return store.get(id);
    },
    async create(input) {
      const project = await store.create(input);
      bus.emit({ type: "project.created", project });
      return project;
    },
    async update(id, patch) {
      const project = await store.update(id, patch);
      if (project) bus.emit({ type: "project.updated", project });
      return project;
    },
    async archive(id) {
      const project = await store.archive(id);
      if (project) bus.emit({ type: "project.updated", project });
      return project;
    },
  };
}

export function withManagerDecisionEvents(
  store: ManagerDecisionStore,
  bus: ManagerEventBus,
): ManagerDecisionStore {
  return {
    list(projectId) {
      return store.list(projectId);
    },
    get(projectId, id) {
      return store.get(projectId, id);
    },
    async create(projectId, input) {
      const decision = await store.create(projectId, input);
      bus.emit({ type: "decision.created", decision });
      return decision;
    },
    async update(projectId: string, id: string, patch: ManagerDecisionUpdateRequest) {
      const decision = await store.update(projectId, id, patch);
      if (decision) bus.emit({ type: "decision.updated", decision });
      return decision;
    },
  };
}
