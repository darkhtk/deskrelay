import { describe, expect, test } from "bun:test";
import {
  buildOfflineDeviceUpdateEntry,
  buildRunningDeviceUpdateEntry,
} from "../src/device-update-workflow.ts";

const target = {
  id: "dev_remote",
  label: "Remote PC",
  daemonUrl: "http://100.64.1.10:18091",
};

describe("device update workflow", () => {
  test("starts a fresh update attempt with branch intent metadata", () => {
    expect(
      buildRunningDeviceUpdateEntry({
        target,
        branch: "api-ai-assistant",
        now: new Date("2026-05-13T00:00:00.000Z"),
      }),
    ).toMatchObject({
      deviceId: "dev_remote",
      state: "running",
      requestedAt: "2026-05-13T00:00:00.000Z",
      attemptCount: 1,
      lastAttemptAt: "2026-05-13T00:00:00.000Z",
      startedAt: "2026-05-13T00:00:00.000Z",
      expectedBranch: "api-ai-assistant",
    });
  });

  test("keeps original request time while retrying an offline update", () => {
    const entry = buildOfflineDeviceUpdateEntry({
      target,
      existing: {
        deviceId: target.id,
        state: "pending_until_device_online",
        requestedAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:30.000Z",
        attemptCount: 2,
      },
      branch: "api-ai-assistant",
      now: new Date("2026-05-13T00:01:00.000Z"),
      retryDelayMs: 15_000,
      error: "cannot reach daemon",
      fallbackCommand: "register",
    });

    expect(entry).toMatchObject({
      state: "pending_until_device_online",
      requestedAt: "2026-05-13T00:00:00.000Z",
      attemptCount: 3,
      lastAttemptAt: "2026-05-13T00:01:00.000Z",
      nextRetryAt: "2026-05-13T00:01:15.000Z",
      expectedBranch: "api-ai-assistant",
      retryable: true,
    });
  });
});
