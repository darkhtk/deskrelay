import { describe, expect, test } from "bun:test";
import {
  diagnosticCheckFromStep,
  diagnosticStepFromCheck,
  normalizeDiagnosticStep,
  severityFromDiagnosticStatus,
  statusFromDiagnosticSeverity,
  worstDiagnosticSeverity,
} from "../src/diagnostics.ts";

describe("diagnostics shared model", () => {
  test("maps step status to severity consistently", () => {
    expect(severityFromDiagnosticStatus("ok")).toBe("ok");
    expect(severityFromDiagnosticStatus("repaired")).toBe("warn");
    expect(severityFromDiagnosticStatus("warn")).toBe("warn");
    expect(severityFromDiagnosticStatus("failed")).toBe("error");
    expect(severityFromDiagnosticStatus("pending")).toBe("unknown");
    expect(severityFromDiagnosticStatus("running")).toBe("unknown");
    expect(severityFromDiagnosticStatus("skipped")).toBe("ok");
    expect(statusFromDiagnosticSeverity("error")).toBe("failed");
    expect(statusFromDiagnosticSeverity("warn")).toBe("warn");
    expect(statusFromDiagnosticSeverity("unknown")).toBe("unknown");
    expect(statusFromDiagnosticSeverity("ok")).toBe("ok");
  });

  test("normalizes steps without forcing each producer to repeat severity", () => {
    expect(
      normalizeDiagnosticStep({
        id: "advertised-daemon",
        label: "server-to-connector probe",
        status: "failed",
        summary: "timeout",
        source: "register-self",
      }),
    ).toMatchObject({
      id: "advertised-daemon",
      severity: "error",
      source: "register-self",
    });
  });

  test("converts normalized steps to legacy checks for existing UI routes", () => {
    const check = diagnosticCheckFromStep(
      normalizeDiagnosticStep({
        id: "server-registry",
        label: "server registry",
        status: "warn",
        summary: "device label exists but daemon URL differs",
        action: {
          kind: "copy-command",
          label: "registration command",
          command: "powershell -ExecutionPolicy Bypass -File install-connector.ps1",
          detail: "Rerun registration so the server stores the current daemon URL.",
        },
        lastCheckedAt: "2026-05-11T00:00:00.000Z",
      }),
    );

    expect(check).toEqual({
      id: "server-registry",
      label: "server registry",
      severity: "warn",
      summary: "device label exists but daemon URL differs",
      fixCommand: "Rerun registration so the server stores the current daemon URL.",
      copyCommand: "powershell -ExecutionPolicy Bypass -File install-connector.ps1",
      lastCheckedAt: "2026-05-11T00:00:00.000Z",
    });
  });

  test("converts legacy checks to normalized steps for shared report payloads", () => {
    const step = diagnosticStepFromCheck(
      {
        id: "device.version",
        label: "Server/connector version",
        severity: "warn",
        summary: "server and connector builds differ",
        detail: "server abc; connector def",
        fixCommand: "Run full update.",
        lastCheckedAt: "2026-05-11T00:00:00.000Z",
      },
      "server",
    );

    expect(step).toMatchObject({
      id: "device.version",
      status: "warn",
      severity: "warn",
      source: "server",
      action: {
        kind: "manual",
        detail: "Run full update.",
      },
    });
  });

  test("keeps worst severity compatible with existing diagnostics", () => {
    expect(
      worstDiagnosticSeverity([{ severity: "ok" }, { severity: "unknown" }, { severity: "warn" }]),
    ).toBe("warn");
  });
});
