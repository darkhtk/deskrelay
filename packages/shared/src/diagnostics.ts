export type DiagnosticSeverity = "ok" | "warn" | "error" | "unknown";

export type DiagnosticStatus =
  | "ok"
  | "warn"
  | "failed"
  | "skipped"
  | "repaired"
  | "running"
  | "pending"
  | "unknown";

export type DiagnosticSource =
  | "installer"
  | "register-self"
  | "doctor"
  | "server"
  | "daemon"
  | "frontend"
  | "updater"
  | "test";

export type DiagnosticActionKind =
  | "retry"
  | "repair"
  | "open-log"
  | "copy-command"
  | "manual"
  | "none";

export interface DiagnosticAction {
  kind: DiagnosticActionKind;
  label: string;
  command?: string;
  detail?: string;
  destructive?: boolean;
}

export interface DiagnosticEvidence {
  label?: string;
  value: string;
}

export interface DiagnosticStep {
  id: string;
  label: string;
  status: DiagnosticStatus;
  severity: DiagnosticSeverity;
  summary: string;
  detail?: string;
  evidence?: Array<string | DiagnosticEvidence>;
  action?: string | DiagnosticAction;
  retrySafe?: boolean;
  source?: DiagnosticSource;
  lastCheckedAt?: string;
}

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
  steps?: DiagnosticStep[];
}

export function worstDiagnosticSeverity(
  checks: Array<Pick<DiagnosticCheck, "severity">>,
): DiagnosticSeverity {
  if (checks.some((check) => check.severity === "error")) return "error";
  if (checks.some((check) => check.severity === "warn")) return "warn";
  if (checks.some((check) => check.severity === "unknown")) return "unknown";
  return "ok";
}

export function severityFromDiagnosticStatus(status: DiagnosticStatus): DiagnosticSeverity {
  if (status === "failed") return "error";
  if (status === "warn" || status === "repaired") return "warn";
  if (status === "unknown" || status === "pending" || status === "running") return "unknown";
  return "ok";
}

export function statusFromDiagnosticSeverity(severity: DiagnosticSeverity): DiagnosticStatus {
  if (severity === "error") return "failed";
  if (severity === "warn") return "warn";
  if (severity === "unknown") return "unknown";
  return "ok";
}

export function normalizeDiagnosticStep(
  step: Omit<DiagnosticStep, "severity"> & { severity?: DiagnosticSeverity },
): DiagnosticStep {
  return {
    ...step,
    severity: step.severity ?? severityFromDiagnosticStatus(step.status),
  };
}

export function diagnosticCheckFromStep(step: DiagnosticStep): DiagnosticCheck {
  const action = typeof step.action === "string" ? step.action : step.action?.detail;
  const command =
    typeof step.action === "object" && step.action.kind === "copy-command"
      ? step.action.command
      : undefined;
  return {
    id: step.id,
    label: step.label,
    severity: step.severity,
    summary: step.summary,
    ...(step.detail ? { detail: step.detail } : {}),
    ...(action ? { fixCommand: action } : {}),
    ...(command ? { copyCommand: command } : {}),
    lastCheckedAt: step.lastCheckedAt ?? new Date(0).toISOString(),
  };
}

export function diagnosticStepFromCheck(
  check: DiagnosticCheck,
  source?: DiagnosticSource,
): DiagnosticStep {
  return normalizeDiagnosticStep({
    id: check.id,
    label: check.label,
    status: statusFromDiagnosticSeverity(check.severity),
    severity: check.severity,
    summary: check.summary,
    ...(check.detail ? { detail: check.detail } : {}),
    ...(check.fixCommand
      ? {
          action: {
            kind: check.copyCommand ? "copy-command" : "manual",
            label: check.copyCommand ? "Copy command" : "Next action",
            detail: check.fixCommand,
            ...(check.copyCommand ? { command: check.copyCommand } : {}),
          } satisfies DiagnosticAction,
        }
      : {}),
    ...(source ? { source } : {}),
    lastCheckedAt: check.lastCheckedAt,
  });
}
