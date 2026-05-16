import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createJsonDeviceUpdateQueueStore } from "../src/device-update-queue-store.ts";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempQueuePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deskrelay-device-update-queue-"));
  tempDirs.push(dir);
  return join(dir, "queue.json");
}

describe("Json device update queue store", () => {
  test("persists offline update retry metadata across store instances", async () => {
    const filePath = await tempQueuePath();
    const store = createJsonDeviceUpdateQueueStore(filePath);
    await store.upsert({
      deviceId: "dev_remote",
      label: "Remote PC",
      daemonUrl: "http://100.64.1.10:18091",
      state: "pending_until_device_online",
      requestedAt: "2026-05-13T00:00:00.000Z",
      attemptCount: 2,
      lastAttemptAt: "2026-05-13T00:01:00.000Z",
      nextRetryAt: "2026-05-13T00:01:30.000Z",
      expectedBranch: "api-ai-assistant",
      retryable: true,
      error: "cannot reach daemon",
    });

    const reloaded = createJsonDeviceUpdateQueueStore(filePath);
    await expect(reloaded.get("dev_remote")).resolves.toMatchObject({
      deviceId: "dev_remote",
      state: "pending_until_device_online",
      requestedAt: "2026-05-13T00:00:00.000Z",
      attemptCount: 2,
      lastAttemptAt: "2026-05-13T00:01:00.000Z",
      nextRetryAt: "2026-05-13T00:01:30.000Z",
      expectedBranch: "api-ai-assistant",
      retryable: true,
    });
  });

  test("normalizes invalid attempt counts instead of poisoning queue reads", async () => {
    const filePath = await tempQueuePath();
    const store = createJsonDeviceUpdateQueueStore(filePath);
    await store.upsert({
      deviceId: "dev_remote",
      state: "pending_until_device_online",
      requestedAt: "2026-05-13T00:00:00.000Z",
      attemptCount: -4,
    });

    await expect(store.get("dev_remote")).resolves.toMatchObject({
      attemptCount: 0,
    });
  });
});
