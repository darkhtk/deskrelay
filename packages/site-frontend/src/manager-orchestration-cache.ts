import type {
  ManagerAgent,
  ManagerRound,
  ManagerRoundReportResponse,
  ManagerSessionHygieneReport,
  ManagerWorkerRunLedgerResponse,
} from "@deskrelay/shared";
import { MANAGER_ORCHESTRATION_CACHE_PREFIX, browserCacheKey } from "./browser-cache.ts";

export interface ManagerOrchestrationCacheSnapshot {
  agents: ManagerAgent[];
  rounds: ManagerRound[];
  report: ManagerRoundReportResponse | null;
  reportRoundId: string | null;
  workerRuns: ManagerWorkerRunLedgerResponse | null;
  workerRunsRoundId: string | null;
  hygiene: ManagerSessionHygieneReport | null;
  cachedAt: number;
}

type ManagerOrchestrationCachePatch = Partial<Omit<ManagerOrchestrationCacheSnapshot, "cachedAt">>;

const MAX_MANAGER_ORCHESTRATION_CACHE_BYTES = 3 * 1024 * 1024;

function managerOrchestrationCacheKey(): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "local";
  return browserCacheKey(MANAGER_ORCHESTRATION_CACHE_PREFIX, origin);
}

export function readManagerOrchestrationCache(): ManagerOrchestrationCacheSnapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(managerOrchestrationCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManagerOrchestrationCacheSnapshot>;
    if (!Array.isArray(parsed.agents) || !Array.isArray(parsed.rounds)) return null;
    return {
      agents: parsed.agents as ManagerAgent[],
      rounds: parsed.rounds as ManagerRound[],
      report: (parsed.report as ManagerRoundReportResponse | null | undefined) ?? null,
      reportRoundId: typeof parsed.reportRoundId === "string" ? parsed.reportRoundId : null,
      workerRuns: (parsed.workerRuns as ManagerWorkerRunLedgerResponse | null | undefined) ?? null,
      workerRunsRoundId:
        typeof parsed.workerRunsRoundId === "string" ? parsed.workerRunsRoundId : null,
      hygiene: (parsed.hygiene as ManagerSessionHygieneReport | null | undefined) ?? null,
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeManagerOrchestrationCache(
  patch: ManagerOrchestrationCachePatch,
): ManagerOrchestrationCacheSnapshot | null {
  try {
    const previous = readManagerOrchestrationCache();
    const next: ManagerOrchestrationCacheSnapshot = {
      agents: patch.agents ?? previous?.agents ?? [],
      rounds: patch.rounds ?? previous?.rounds ?? [],
      report: "report" in patch ? (patch.report ?? null) : (previous?.report ?? null),
      reportRoundId:
        "reportRoundId" in patch
          ? (patch.reportRoundId ?? null)
          : (previous?.reportRoundId ?? null),
      workerRuns:
        "workerRuns" in patch ? (patch.workerRuns ?? null) : (previous?.workerRuns ?? null),
      workerRunsRoundId:
        "workerRunsRoundId" in patch
          ? (patch.workerRunsRoundId ?? null)
          : (previous?.workerRunsRoundId ?? null),
      hygiene: "hygiene" in patch ? (patch.hygiene ?? null) : (previous?.hygiene ?? null),
      cachedAt: Date.now(),
    };
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_MANAGER_ORCHESTRATION_CACHE_BYTES) return previous ?? null;
    globalThis.localStorage?.setItem(managerOrchestrationCacheKey(), serialized);
    return next;
  } catch {
    return null;
  }
}
