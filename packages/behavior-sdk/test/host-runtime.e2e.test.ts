import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { InProcessSubscriptionBroker } from "@claude-remote/core";
import type { EventEnvelope } from "@claude-remote/shared/event";
import { asSpaceId } from "@claude-remote/shared/space";
import {
  type BehaviorHost,
  BehaviorHostError,
  type BehaviorHostLogRecord,
  loadBehaviorPackage,
  spawnBehaviorHost,
} from "../src/index.ts";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "echo-behavior");

let host: BehaviorHost | undefined;
let broker: InProcessSubscriptionBroker;
let logs: BehaviorHostLogRecord[];
let unexpectedExits: Array<{ code: number | null; signal?: string }>;

beforeEach(() => {
  broker = new InProcessSubscriptionBroker();
  logs = [];
  unexpectedExits = [];
});

afterEach(async () => {
  if (host) await host.shutdown();
  host = undefined;
});

async function spawn(instanceId = "test"): Promise<BehaviorHost> {
  const pkg = await loadBehaviorPackage(FIXTURE_DIR);
  const result = await spawnBehaviorHost({
    pkg,
    broker,
    instanceId,
    bunPath: process.execPath, // current Bun
    onLog: (r) => logs.push(r),
    onUnexpectedExit: (info) => unexpectedExits.push(info),
    requestTimeoutMs: 10_000,
  });
  host = result.host;
  return result.host;
}

describe("BehaviorHost e2e — happy path", () => {
  test("starts, accepts request, returns result, publishes event into broker", async () => {
    const h = await spawn("test-1");

    const received: EventEnvelope[] = [];
    broker.subscribe(asSpaceId("echo.default:test-1"), (e) => received.push(e));

    const result = (await h.request("echo", { message: "hello" })) as {
      ok: boolean;
      length: number;
    };
    expect(result).toEqual({ ok: true, length: 5 });

    // Allow the event notification to flow through stdout.
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe("echoed");
    expect(received[0]?.content).toEqual({ message: "hello" });
    expect(received[0]?.spaceId).toBe("echo.default:test-1" as never);
  });

  test("captures stderr logs as structured records", async () => {
    await spawn("test-logs");
    // start handler emits "echo behavior started" log
    await new Promise((r) => setTimeout(r, 50));
    const startLog = logs.find((l) => l.msg === "echo behavior started");
    expect(startLog).toBeDefined();
    expect(startLog?.level).toBe("info");
    expect(startLog?.instanceId).toBe("test-logs");
  });

  test("can publish to a custom space when behavior overrides spaceId", async () => {
    const h = await spawn("test-custom");
    const customSpace = asSpaceId("echo.custom:bucket");
    const received: EventEnvelope[] = [];
    broker.subscribe(customSpace, (e) => received.push(e));

    await h.request("publish-to", {
      space: customSpace,
      kind: "custom-kind",
      content: { value: 42 },
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe("custom-kind");
    expect(received[0]?.content).toEqual({ value: 42 });
  });
});

describe("BehaviorHost e2e — error handling", () => {
  test("handler throwing surfaces as BehaviorHostError with code -32000", async () => {
    const h = await spawn("test-err");
    let caught: unknown;
    try {
      await h.request("explode", {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BehaviorHostError);
    expect((caught as BehaviorHostError).code).toBe(-32000);
    expect((caught as BehaviorHostError).message).toMatch(/intentional failure/);
  });

  test("unknown method returns -32601 method not found", async () => {
    const h = await spawn("test-method");
    let caught: unknown;
    try {
      await h.request("nope-not-there", {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BehaviorHostError);
    expect((caught as BehaviorHostError).code).toBe(-32601);
  });

  test("shutdown rejects pending requests and prevents new ones", async () => {
    const h = await spawn("test-shutdown");
    await h.shutdown();
    let caught: unknown;
    try {
      await h.request("echo", { message: "after shutdown" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BehaviorHostError);
    expect((caught as BehaviorHostError).message).toMatch(/shutting down/);
  });

  test("shutdown is idempotent", async () => {
    const h = await spawn("test-idem");
    await h.shutdown();
    await h.shutdown(); // should not throw
  });

  test("graceful shutdown does not trigger unexpected-exit callback", async () => {
    const h = await spawn("test-clean-exit");
    await h.request("echo", { message: "ping" });
    await h.shutdown();
    expect(unexpectedExits).toHaveLength(0);
  });
});
