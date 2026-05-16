import type {
  DeviceUpdateEntryInput,
  StoredDeviceUpdateEntry,
} from "./device-update-queue-store.ts";

const DEFAULT_OFFLINE_RETRY_DELAY_MS = 30_000;

export interface DeviceUpdateTarget {
  id: string;
  label: string;
  daemonUrl: string;
}

interface DeviceUpdateAttemptInput {
  target: DeviceUpdateTarget;
  existing?: StoredDeviceUpdateEntry | undefined;
  branch?: string | undefined;
  now?: Date | undefined;
}

interface OfflineDeviceUpdateInput extends DeviceUpdateAttemptInput {
  error: string;
  fallbackCommand: string;
  retryDelayMs?: number;
}

export function buildRunningDeviceUpdateEntry(
  input: DeviceUpdateAttemptInput,
): DeviceUpdateEntryInput {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return {
    ...deviceUpdateBase(input.target),
    state: "running",
    requestedAt: requestedAtForAttempt(input.existing, nowIso),
    attemptCount: nextAttemptCount(input.existing),
    lastAttemptAt: nowIso,
    startedAt: nowIso,
    ...(input.branch ? { expectedBranch: input.branch } : {}),
  };
}

export function buildOfflineDeviceUpdateEntry(
  input: OfflineDeviceUpdateInput,
): DeviceUpdateEntryInput {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return {
    ...deviceUpdateBase(input.target),
    state: "pending_until_device_online",
    requestedAt: requestedAtForAttempt(input.existing, nowIso),
    attemptCount: nextAttemptCount(input.existing),
    lastAttemptAt: nowIso,
    nextRetryAt: new Date(
      now.getTime() + Math.max(0, input.retryDelayMs ?? DEFAULT_OFFLINE_RETRY_DELAY_MS),
    ).toISOString(),
    error: input.error,
    fallbackCommand: input.fallbackCommand,
    retryable: true,
    ...(input.branch ? { expectedBranch: input.branch } : {}),
  };
}

export function requestedAtForAttempt(
  existing: StoredDeviceUpdateEntry | undefined,
  nowIso: string,
): string {
  return existing?.state === "pending_until_device_online" ? existing.requestedAt : nowIso;
}

export function nextAttemptCount(existing: StoredDeviceUpdateEntry | undefined): number {
  return Math.max(0, existing?.attemptCount ?? 0) + 1;
}

function deviceUpdateBase(target: DeviceUpdateTarget): Pick<
  DeviceUpdateEntryInput,
  "deviceId" | "label" | "daemonUrl"
> {
  return {
    deviceId: target.id,
    label: target.label,
    daemonUrl: target.daemonUrl,
  };
}
