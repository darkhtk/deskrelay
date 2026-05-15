import { describe, expect, test } from "bun:test";
import type { ManagerEvent } from "@deskrelay/shared";
import {
  createManagerEventBus,
  withManagerOrchestrationEvents,
  withManagerTaskEvents,
} from "../src/manager-event-bus.ts";
import { createInMemoryManagerOrchestrationStore } from "../src/manager-orchestration-store.ts";
import { createInMemoryManagerTaskStore } from "../src/manager-task-store.ts";

describe("manager event bus", () => {
  test("assigns ordered events and keeps bounded recent history", () => {
    const bus = createManagerEventBus({
      now: () => new Date("2026-05-15T00:00:00.000Z"),
      maxEvents: 2,
    });
    const seen: ManagerEvent[] = [];
    const unsubscribe = bus.subscribe((event) => {
      seen.push(event);
    });

    const first = bus.emit({ type: "heartbeat" });
    bus.emit({ type: "heartbeat" });
    unsubscribe();
    const third = bus.emit({ type: "heartbeat" });

    expect(first.seq).toBe(1);
    expect(third.seq).toBe(3);
    expect(first.generatedAt).toBe("2026-05-15T00:00:00.000Z");
    expect(seen.map((event) => event.seq)).toEqual([1, 2]);
    expect(bus.recent().map((event) => event.seq)).toEqual([2, 3]);
    expect(bus.recent(2).map((event) => event.seq)).toEqual([3]);
    expect(bus.getLastSeq()).toBe(3);
  });

  test("isolates listener failures from mutations", () => {
    const bus = createManagerEventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error("listener failed");
    });
    bus.subscribe((event) => {
      seen.push(event.type);
    });

    const event = bus.emit({ type: "heartbeat" });

    expect(event.seq).toBe(1);
    expect(seen).toEqual(["heartbeat"]);
  });

  test("emits task create and update events", async () => {
    const bus = createManagerEventBus();
    const seen: ManagerEvent[] = [];
    bus.subscribe((event) => {
      seen.push(event);
    });
    const store = withManagerTaskEvents(createInMemoryManagerTaskStore(), bus);

    const task = await store.create({
      kind: "diagnose",
      dryRun: true,
      requestedBy: "system",
      steps: [],
    });
    await store.update(task.id, { state: "running" });
    await store.update("missing", { state: "failed" });

    expect(seen.map((event) => event.type)).toEqual(["task.created", "task.updated"]);
    expect(seen[0]?.type === "task.created" ? seen[0].task.id : undefined).toBe(task.id);
    expect(seen[1]?.type === "task.updated" ? seen[1].task.state : undefined).toBe("running");
  });

  test("emits orchestration round and agent events", async () => {
    const bus = createManagerEventBus();
    const seen: ManagerEvent[] = [];
    bus.subscribe((event) => {
      seen.push(event);
    });
    const store = withManagerOrchestrationEvents(createInMemoryManagerOrchestrationStore(), bus);

    const round = await store.createRound({ objective: "verify event flow" });
    const agent = await store.createAgent({ role: "verifier", roundId: round.id });
    await store.updateAgent(agent.id, { status: "running" });
    await store.updateRound(round.id, { status: "running", agentIds: [agent.id] });

    expect(seen.map((event) => event.type)).toEqual([
      "round.created",
      "agent.created",
      "agent.updated",
      "round.updated",
    ]);
    expect(seen[0]?.type === "round.created" ? seen[0].round.id : undefined).toBe(round.id);
    expect(seen[1]?.type === "agent.created" ? seen[1].agent.roundId : undefined).toBe(round.id);
    expect(seen[2]?.type === "agent.updated" ? seen[2].agent.status : undefined).toBe("running");
    expect(seen[3]?.type === "round.updated" ? seen[3].round.agentIds : undefined).toEqual([
      agent.id,
    ]);
  });
});
