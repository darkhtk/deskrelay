import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { UpdateState } from "@deskrelay/shared";
import type { DeskRelayBuildInfo } from "@deskrelay/shared/version";

export interface StoredDeviceUpdateEntry {
  deviceId: string;
  label?: string;
  daemonUrl?: string;
  state: UpdateState;
  requestedAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  warning?: string;
  fallbackCommand?: string;
  recoveryKind?: "branch_mismatch" | "registration_required";
  retryable?: boolean;
  expectedBranch?: string;
  actualBranch?: string;
  daemonStatus?: number;
  before?: Partial<DeskRelayBuildInfo>;
  after?: Partial<DeskRelayBuildInfo>;
  changed?: boolean;
  restartScheduled?: boolean;
  restartRequested?: boolean;
  restartRequestError?: string;
}

export type DeviceUpdateEntryInput = Omit<StoredDeviceUpdateEntry, "updatedAt"> & {
  updatedAt?: string;
};

export interface DeviceUpdateQueueStore {
  list(): Promise<StoredDeviceUpdateEntry[]>;
  get(deviceId: string): Promise<StoredDeviceUpdateEntry | undefined>;
  upsert(input: DeviceUpdateEntryInput): Promise<StoredDeviceUpdateEntry>;
  remove(deviceId: string): Promise<void>;
}

const UPDATE_STATES = new Set<UpdateState>([
  "not_started",
  "queued",
  "running",
  "succeeded",
  "failed",
  "restart_required",
  "pending_until_device_online",
]);

export function createJsonDeviceUpdateQueueStore(
  filePath: string,
  options: { now?: () => Date } = {},
): DeviceUpdateQueueStore {
  const now = options.now ?? (() => new Date());

  return {
    async list() {
      return (await readEntries(filePath)).sort(compareEntries);
    },

    async get(deviceId) {
      return (await readEntries(filePath)).find((entry) => entry.deviceId === deviceId);
    },

    async upsert(input) {
      const entry = normalizeInput(input, now());
      const existing = await readEntries(filePath);
      const next = [entry, ...existing.filter((item) => item.deviceId !== entry.deviceId)].sort(
        compareEntries,
      );
      await writeEntries(filePath, next);
      return entry;
    },

    async remove(deviceId) {
      const existing = await readEntries(filePath);
      await writeEntries(
        filePath,
        existing.filter((entry) => entry.deviceId !== deviceId),
      );
    },
  };
}

async function readEntries(path: string): Promise<StoredDeviceUpdateEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (Array.isArray(parsed)) return parsed.map(normalizeStoredEntry).filter(isPresent);
    if (isRecord(parsed) && Array.isArray(parsed.entries)) {
      return parsed.entries.map(normalizeStoredEntry).filter(isPresent);
    }
  } catch {
    return [];
  }
  return [];
}

async function writeEntries(path: string, entries: StoredDeviceUpdateEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function normalizeInput(input: DeviceUpdateEntryInput, now: Date): StoredDeviceUpdateEntry {
  return {
    deviceId: input.deviceId,
    state: input.state,
    requestedAt: input.requestedAt || now.toISOString(),
    updatedAt: input.updatedAt || now.toISOString(),
    ...(input.label ? { label: input.label } : {}),
    ...(input.daemonUrl ? { daemonUrl: input.daemonUrl } : {}),
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.warning ? { warning: input.warning } : {}),
    ...(input.fallbackCommand ? { fallbackCommand: input.fallbackCommand } : {}),
    ...(input.recoveryKind ? { recoveryKind: input.recoveryKind } : {}),
    ...(typeof input.retryable === "boolean" ? { retryable: input.retryable } : {}),
    ...(input.expectedBranch ? { expectedBranch: input.expectedBranch } : {}),
    ...(input.actualBranch ? { actualBranch: input.actualBranch } : {}),
    ...(typeof input.daemonStatus === "number" ? { daemonStatus: input.daemonStatus } : {}),
    ...(input.before ? { before: input.before } : {}),
    ...(input.after ? { after: input.after } : {}),
    ...(typeof input.changed === "boolean" ? { changed: input.changed } : {}),
    ...(typeof input.restartScheduled === "boolean"
      ? { restartScheduled: input.restartScheduled }
      : {}),
    ...(typeof input.restartRequested === "boolean"
      ? { restartRequested: input.restartRequested }
      : {}),
    ...(input.restartRequestError ? { restartRequestError: input.restartRequestError } : {}),
  };
}

function normalizeStoredEntry(input: unknown): StoredDeviceUpdateEntry | null {
  if (!isRecord(input)) return null;
  if (typeof input.deviceId !== "string" || !input.deviceId.trim()) return null;
  if (!isUpdateState(input.state)) return null;
  const requestedAt =
    typeof input.requestedAt === "string" && input.requestedAt.trim()
      ? input.requestedAt
      : typeof input.updatedAt === "string" && input.updatedAt.trim()
        ? input.updatedAt
        : new Date(0).toISOString();
  const updatedAt =
    typeof input.updatedAt === "string" && input.updatedAt.trim() ? input.updatedAt : requestedAt;

  return {
    deviceId: input.deviceId,
    state: input.state,
    requestedAt,
    updatedAt,
    ...(typeof input.label === "string" ? { label: input.label } : {}),
    ...(typeof input.daemonUrl === "string" ? { daemonUrl: input.daemonUrl } : {}),
    ...(typeof input.startedAt === "string" ? { startedAt: input.startedAt } : {}),
    ...(typeof input.completedAt === "string" ? { completedAt: input.completedAt } : {}),
    ...(typeof input.error === "string" ? { error: input.error } : {}),
    ...(typeof input.warning === "string" ? { warning: input.warning } : {}),
    ...(typeof input.fallbackCommand === "string"
      ? { fallbackCommand: input.fallbackCommand }
      : {}),
    ...(input.recoveryKind === "branch_mismatch" || input.recoveryKind === "registration_required"
      ? { recoveryKind: input.recoveryKind }
      : {}),
    ...(typeof input.retryable === "boolean" ? { retryable: input.retryable } : {}),
    ...(typeof input.expectedBranch === "string" ? { expectedBranch: input.expectedBranch } : {}),
    ...(typeof input.actualBranch === "string" ? { actualBranch: input.actualBranch } : {}),
    ...(typeof input.daemonStatus === "number" ? { daemonStatus: input.daemonStatus } : {}),
    ...(isRecord(input.before) ? { before: input.before as Partial<DeskRelayBuildInfo> } : {}),
    ...(isRecord(input.after) ? { after: input.after as Partial<DeskRelayBuildInfo> } : {}),
    ...(typeof input.changed === "boolean" ? { changed: input.changed } : {}),
    ...(typeof input.restartScheduled === "boolean"
      ? { restartScheduled: input.restartScheduled }
      : {}),
    ...(typeof input.restartRequested === "boolean"
      ? { restartRequested: input.restartRequested }
      : {}),
    ...(typeof input.restartRequestError === "string"
      ? { restartRequestError: input.restartRequestError }
      : {}),
  };
}

function compareEntries(left: StoredDeviceUpdateEntry, right: StoredDeviceUpdateEntry): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.requestedAt.localeCompare(left.requestedAt)
  );
}

function isUpdateState(value: unknown): value is UpdateState {
  return typeof value === "string" && UPDATE_STATES.has(value as UpdateState);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
