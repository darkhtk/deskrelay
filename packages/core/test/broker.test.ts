import { beforeEach, describe, expect, test } from "bun:test";
import type { EventEnvelope } from "@claude-remote/shared/event";
import { asSpaceId } from "@claude-remote/shared/space";
import { InProcessSubscriptionBroker } from "../src/broker.ts";

const SPACE = asSpaceId("remote_claude.machine:home-pc");
const SPACE2 = asSpaceId("remote_claude.machine:work-pc");

let broker: InProcessSubscriptionBroker;
let nowCounter = 0;

beforeEach(() => {
  nowCounter = 0;
  broker = new InProcessSubscriptionBroker({
    backlogPerSpace: 4,
    now: () => `2026-04-27T00:00:${String(nowCounter++).padStart(2, "0")}.000Z`,
  });
});

describe("InProcessSubscriptionBroker — basic publish/subscribe", () => {
  test("publish stamps id, cursor, createdAt", () => {
    const env = broker.publish({
      spaceId: SPACE,
      kind: "test",
      content: { value: 1 },
    });
    expect(env.id).toBe("0");
    expect(env.cursor).toBe("0");
    expect(env.createdAt).toBe("2026-04-27T00:00:00.000Z");
    expect(env.kind).toBe("test");
    expect(env.content).toEqual({ value: 1 });
  });

  test("ids are monotonic per space, independent across spaces", () => {
    const a1 = broker.publish({ spaceId: SPACE, kind: "x", content: null });
    const a2 = broker.publish({ spaceId: SPACE, kind: "x", content: null });
    const b1 = broker.publish({ spaceId: SPACE2, kind: "x", content: null });
    expect(a1.id).toBe("0");
    expect(a2.id).toBe("1");
    expect(b1.id).toBe("0");
  });

  test("subscriber receives live events after subscribe", () => {
    const received: EventEnvelope[] = [];
    broker.subscribe(SPACE, (e) => received.push(e));
    broker.publish({ spaceId: SPACE, kind: "x", content: 1 });
    broker.publish({ spaceId: SPACE, kind: "x", content: 2 });
    expect(received).toHaveLength(2);
    expect(received[0]?.content).toBe(1);
    expect(received[1]?.content).toBe(2);
  });

  test("subscriber on a different space gets nothing", () => {
    const received: EventEnvelope[] = [];
    broker.subscribe(SPACE2, (e) => received.push(e));
    broker.publish({ spaceId: SPACE, kind: "x", content: 1 });
    expect(received).toHaveLength(0);
  });

  test("multiple subscribers all receive each event in insertion order", () => {
    const fanout: string[] = [];
    broker.subscribe(SPACE, () => fanout.push("a"));
    broker.subscribe(SPACE, () => fanout.push("b"));
    broker.subscribe(SPACE, () => fanout.push("c"));
    broker.publish({ spaceId: SPACE, kind: "x", content: null });
    expect(fanout).toEqual(["a", "b", "c"]);
  });

  test("unsubscribe stops delivery; idempotent", () => {
    const received: number[] = [];
    const sub = broker.subscribe(SPACE, (e) => received.push(e.content as number));
    broker.publish({ spaceId: SPACE, kind: "x", content: 1 });
    sub.unsubscribe();
    sub.unsubscribe(); // idempotent
    broker.publish({ spaceId: SPACE, kind: "x", content: 2 });
    expect(received).toEqual([1]);
  });

  test("subscriber that throws does not break the publish", () => {
    let bGot = 0;
    broker.subscribe(SPACE, () => {
      throw new Error("boom");
    });
    broker.subscribe(SPACE, () => {
      bGot += 1;
    });
    broker.publish({ spaceId: SPACE, kind: "x", content: null });
    expect(bGot).toBe(1);
  });
});

describe("InProcessSubscriptionBroker — backlog + replay", () => {
  test("backlog evicts oldest beyond capacity", () => {
    for (let i = 0; i < 6; i++) {
      broker.publish({ spaceId: SPACE, kind: "x", content: i });
    }
    const buf = broker.backlog(SPACE);
    expect(buf).toHaveLength(4);
    expect(buf.map((e) => e.content)).toEqual([2, 3, 4, 5]);
  });

  test("subscribe with `since` replays events strictly after the cursor", () => {
    for (let i = 0; i < 4; i++) {
      broker.publish({ spaceId: SPACE, kind: "x", content: i });
    }
    const replayed: number[] = [];
    broker.subscribe(SPACE, (e) => replayed.push(e.content as number), {
      since: "1",
    });
    expect(replayed).toEqual([2, 3]);
  });

  test("subscribe with replayBacklog replays existing events without a cursor", () => {
    for (let i = 0; i < 3; i++) {
      broker.publish({ spaceId: SPACE, kind: "x", content: i });
    }
    const got: number[] = [];
    broker.subscribe(SPACE, (e) => got.push(e.content as number), { replayBacklog: true });
    broker.publish({ spaceId: SPACE, kind: "x", content: 3 });
    expect(got).toEqual([0, 1, 2, 3]);
  });

  test("since takes precedence over replayBacklog", () => {
    for (let i = 0; i < 4; i++) {
      broker.publish({ spaceId: SPACE, kind: "x", content: i });
    }
    const got: number[] = [];
    broker.subscribe(SPACE, (e) => got.push(e.content as number), {
      since: "1",
      replayBacklog: true,
    });
    expect(got).toEqual([2, 3]);
  });

  test("subscribe with `since` past current cursor replays nothing", () => {
    broker.publish({ spaceId: SPACE, kind: "x", content: 0 });
    const replayed: number[] = [];
    broker.subscribe(SPACE, (e) => replayed.push(e.content as number), {
      since: "99",
    });
    expect(replayed).toEqual([]);
  });

  test("subscribe with `since` for events evicted from buffer replays only what survives", () => {
    // backlog=4, publish 6 → buffer holds events [2,3,4,5], earlier ones gone
    for (let i = 0; i < 6; i++) {
      broker.publish({ spaceId: SPACE, kind: "x", content: i });
    }
    const replayed: number[] = [];
    broker.subscribe(SPACE, (e) => replayed.push(e.content as number), {
      since: "0",
    });
    // Caller asked for everything after cursor 0, but we only have 2..5 left.
    // This is the documented "best-effort" replay; the caller must reconcile
    // gaps via a snapshot if it cared about completeness.
    expect(replayed).toEqual([2, 3, 4, 5]);
  });

  test("subscribe replays then continues with live events", () => {
    broker.publish({ spaceId: SPACE, kind: "x", content: 0 });
    broker.publish({ spaceId: SPACE, kind: "x", content: 1 });
    const got: number[] = [];
    broker.subscribe(SPACE, (e) => got.push(e.content as number), { since: "0" });
    broker.publish({ spaceId: SPACE, kind: "x", content: 2 });
    expect(got).toEqual([1, 2]);
  });
});

describe("InProcessSubscriptionBroker — diagnostics + validation", () => {
  test("publish rejects invalid spaceId", () => {
    expect(() =>
      broker.publish({
        spaceId: "not-a-space-id" as never,
        kind: "x",
        content: null,
      }),
    ).toThrow(/invalid spaceId/);
  });

  test("subscribe rejects invalid spaceId", () => {
    expect(() => broker.subscribe("nope" as never, () => {})).toThrow(/invalid spaceId/);
  });

  test("subscribe rejects invalid since cursor", () => {
    expect(() => broker.subscribe(SPACE, () => {}, { since: "not-a-number" })).toThrow(
      /invalid cursor/,
    );
  });

  test("stats returns counts across spaces", () => {
    broker.subscribe(SPACE, () => {});
    broker.subscribe(SPACE2, () => {});
    broker.subscribe(SPACE2, () => {});
    broker.publish({ spaceId: SPACE, kind: "x", content: null });
    broker.publish({ spaceId: SPACE2, kind: "x", content: null });
    const s = broker.stats();
    expect(s.spaces).toBe(2);
    expect(s.subscribers).toBe(3);
    expect(s.bufferedEvents).toBe(2);
  });

  test("backlog on unknown space returns empty array", () => {
    expect(broker.backlog(asSpaceId("foo.bar:never"))).toEqual([]);
  });

  test("rejects backlogPerSpace < 1", () => {
    expect(() => new InProcessSubscriptionBroker({ backlogPerSpace: 0 })).toThrow();
  });
});
