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
      const next = [report, ...existing.filter((item) => item.id !== report.id)].slice(
        0,
        maxReports,
      );
      await writeReports(filePath, next);
      return report;
    },
  };
}

function normalizeInstallReport(input: unknown, receivedAt: Date): StoredInstallReport {
  const raw = isRecord(input) ? input : {};
  const steps = Array.isArray(raw.steps) ? raw.steps.map(normalizeReportStep) : [];
  const status =
    raw.status === "succeeded" || raw.status === "failed" ? raw.status : statusFromSteps(steps);
  const generatedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : undefined;
  const idSeed = [
    generatedAt,
    typeof raw.label === "string" ? raw.label : "",
    typeof raw.server === "string" ? raw.server : "",
    receivedAt.toISOString(),
    randomBytes(4).toString("hex"),
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
