import { describe, expect, test } from "vitest";
import type { Device } from "../src/api.ts";
import { deriveConnectionStatus } from "../src/connection-status.ts";

const onlineDevice: Device = {
  id: "dev_1",
  label: "homedev",
  daemonUrl: "relay://dev_1",
  registeredAt: "2026-05-04T00:00:00.000Z",
  connectionState: "online",
};

const offlineDevice: Device = {
  ...onlineDevice,
  connectionState: "offline",
};

const base = {
  devices: [onlineDevice],
  devicesLoading: false,
  activeDevice: onlineDevice,
  behaviorsLoading: false,
  hasRemoteClaude: true,
  running: false,
  activityLabel: null,
  approvalWaiting: false,
  hasError: false,
};

describe("deriveConnectionStatus", () => {
  test("uses explicit no-device and offline states", () => {
    expect(
      deriveConnectionStatus({
        ...base,
        devices: [],
        activeDevice: null,
      }).kind,
    ).toBe("not_installed");

    expect(
      deriveConnectionStatus({
        ...base,
        activeDevice: offlineDevice,
      }).kind,
    ).toBe("selected_device_offline");
  });

  test("separates behavior readiness from generic offline", () => {
    const status = deriveConnectionStatus({
      ...base,
      hasRemoteClaude: false,
    });

    expect(status.kind).toBe("behavior_not_ready");
    expect(status.action).toBe("diagnostics");
  });

  test("prioritizes active run and approval states over idle online", () => {
    expect(
      deriveConnectionStatus({
        ...base,
        running: true,
        activityLabel: "Reading files",
      }).kind,
    ).toBe("tool_running");

    expect(
      deriveConnectionStatus({
        ...base,
        running: true,
        activityLabel: "Waiting for permission approval",
        approvalWaiting: true,
      }).kind,
    ).toBe("approval_waiting");
  });

  test("falls back to online idle only after actionable states are clear", () => {
    const status = deriveConnectionStatus(base);

    expect(status.kind).toBe("online");
    expect(status.action).toBeUndefined();
  });
});
