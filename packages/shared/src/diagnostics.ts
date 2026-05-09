export type DiagnosticSeverity = "ok" | "warn" | "error" | "unknown";

export interface DiagnosticCheck {
  id: string;
  label: string;
  severity: DiagnosticSeverity;
  summary: string;
  detail?: string;
  fixCommand?: string;
  copyCommand?: string;
  lastCheckedAt: string;
}

export interface DiagnosticReport {
  scope: "server" | "device";
  targetId?: string;
  targetLabel?: string;
  generatedAt: string;
  checks: DiagnosticCheck[];
}

export function worstDiagnosticSeverity(
  checks: Array<Pick<DiagnosticCheck, "severity">>,
): DiagnosticSeverity {
  if (checks.some((check) => check.severity === "error")) return "error";
  if (checks.some((check) => check.severity === "warn")) return "warn";
  if (checks.some((check) => check.severity === "unknown")) return "unknown";
  return "ok";
}
