import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type DiagnosticSeverity,
  type DiagnosticStatus,
  type DiagnosticStep,
  normalizeDiagnosticStep,
} from "@deskrelay/shared";

export interface StoredInstallReport {
  id: string;
  receivedAt: string;
  firstReceivedAt?: string;
  lastReceivedAt?: string;
  repeatCount?: number;
  generatedAt?: string;
  status: "succeeded" | "failed" | "unknown";
  server?: string;
  label?: string;
  reportPath?: string;
  steps: DiagnosticStep[];
}

export interface InstallReportStore {
  list(limit?: number): Promise<StoredInstallReport[]>;
  add(input: unknown): Promise<StoredInstallReport>;
  clear?(): Promise<{ deleted: number }>;
}

export function createJsonInstallReportStore(
  filePath: string,
  options: { maxReports?: number; now?: () => Date } = {},
): InstallReportStore {
  const maxReports = Math.max(1, options.maxReports ?? 20);
  const now = options.now ?? (() => new Date());

  return {
    async list(limit = maxReports) {
      const reports = await readReports(filePath);
      return reports.slice(0, Math.max(1, limit));
    },

    async add(input) {
      const report = normalizeInstallReport(input, now());
      const existing = await readReports(filePath);
      const collapsed = collapseRepeatedFailure(report, existing);
      const next = [collapsed.report, ...collapsed.remaining].slice(0, maxReports);
      await writeReports(filePath, next);
      return collapsed.report;
    },

    async clear() {
      const existing = await readReports(filePath);
      await writeReports(filePath, []);
      return { deleted: existing.length };
    },
  };
}

function collapseRepeatedFailure(
  report: StoredInstallReport,
  existing: StoredInstallReport[],
): { report: StoredInstallReport; remaining: StoredInstallReport[] } {
  const remaining = existing.filter((item) => item.id !== report.id);
  if (report.status !== "failed") return { report, remaining };

  const fingerprint = installReportFingerprint(report);
  const match = remaining.find((item) => item.status === "failed" && installReportFingerprint(item) === fingerprint);
  if (!match) return { report, remaining };

  const firstReceivedAt = match.firstReceivedAt ?? match.receivedAt;
  const repeatCount = Math.max(1, match.repeatCount ?? 1) + 1;
  return {
    report: {
      ...report,
      firstReceivedAt,
      lastReceivedAt: report.receivedAt,
      repeatCount,
    },
    remaining: remaining.filter((item) => item.id !== match.id),
  };
}

function installReportFingerprint(report: StoredInstallReport): string {
  const failureStep =
    report.steps.find((step) => step.severity === "error") ??
    report.steps.find((step) => step.status !== "ok");
  return [
    normalizeFingerprintPart(report.server),
    normalizeFingerprintPart(report.label),
    report.status,
    normalizeFingerprintPart(failureStep?.id),
    normalizeFingerprintPart(failureStep?.summary),
  ].join("|");
}

function normalizeFingerprintPart(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeInstallReport(input: unknown, receivedAt: Date): StoredInstallReport {
  const raw = isRecord(input) ? input : {};
  const steps = Array.isArray(raw.steps) ? raw.steps.map(normalizeReportStep) : [];
  const status =
    raw.status === "succeeded" || raw.status === "failed" ? raw.status : statusFromSteps(steps);
  const generatedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : undefined;
  const idSeed = [
    randomBytes(8).toString("hex"),
    generatedAt,
    typeof raw.label === "string" ? raw.label : "",
    typeof raw.server === "string" ? raw.server : "",
    receivedAt.toISOString(),
  ]
    .filter(Boolean)
    .join(":");

  return {
    id: `install_${Buffer.from(idSeed).toString("base64url").slice(0, 24)}`,
    receivedAt: receivedAt.toISOString(),
    ...(generatedAt ? { generatedAt } : {}),
    status,
    ...(typeof raw.server === "string" ? { server: raw.server } : {}),
    ...(typeof raw.label === "string" ? { label: raw.label } : {}),
    ...(typeof raw.reportPath === "string" ? { reportPath: raw.reportPath } : {}),
    steps,
  };
}

function normalizeReportStep(input: unknown): DiagnosticStep {
  const raw = isRecord(input) ? input : {};
  const status = normalizeStatus(raw.status);
  const severity = normalizeSeverity(raw.severity, status);
  return normalizeDiagnosticStep({
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "installer-step",
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "installer",
    status,
    severity,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}),
    ...(Array.isArray(raw.evidence)
      ? { evidence: raw.evidence.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(typeof raw.action === "string" ? { action: raw.action } : {}),
    ...(typeof raw.retrySafe === "boolean" ? { retrySafe: raw.retrySafe } : {}),
    source: "installer",
    userVisible: raw.userVisible === false ? false : severity !== "ok" || Boolean(raw.action),
  });
}

function normalizeStatus(value: unknown): DiagnosticStatus {
  if (
    value === "ok" ||
    value === "warn" ||
    value === "failed" ||
    value === "skipped" ||
    value === "repaired" ||
    value === "running" ||
    value === "pending" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeSeverity(value: unknown, status: DiagnosticStatus): DiagnosticSeverity {
  if (value === "ok" || value === "warn" || value === "error" || value === "unknown") {
    return value;
  }
  if (status === "failed") return "error";
  if (status === "warn" || status === "repaired") return "warn";
  if (status === "ok" || status === "skipped") return "ok";
  return "unknown";
}

function statusFromSteps(steps: DiagnosticStep[]): "succeeded" | "failed" | "unknown" {
  if (steps.some((step) => step.severity === "error")) return "failed";
  if (steps.length > 0 && steps.every((step) => step.severity === "ok")) return "succeeded";
  return "unknown";
}

async function readReports(path: string): Promise<StoredInstallReport[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (Array.isArray(parsed)) return parsed.filter(isStoredInstallReport);
    if (isRecord(parsed) && Array.isArray(parsed.reports)) {
      return parsed.reports.filter(isStoredInstallReport);
    }
  } catch {
    return [];
  }
  return [];
}

async function writeReports(path: string, reports: StoredInstallReport[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ reports }, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function isStoredInstallReport(value: unknown): value is StoredInstallReport {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.receivedAt === "string" &&
    (value.status === "succeeded" || value.status === "failed" || value.status === "unknown") &&
    Array.isArray(value.steps)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
