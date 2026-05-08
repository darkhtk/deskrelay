// Diagnostics now live in the unified settings dialog via
// ConnectionDiagnostics, not in each DeviceSettingsDialog.

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConnectionDiagnostics } from "../src/components/ConnectionDiagnostics.tsx";
import { t } from "../src/i18n.ts";

const SAMPLE_DEVICE = {
  id: "dev_diag_1",
  label: "Home PC",
  daemonUrl: "http://127.0.0.1:18091",
  registeredAt: "2026-04-30T00:00:00.000Z",
  connectionState: "online",
  lastSeenAt: "2026-04-30T00:01:00.000Z",
};

const SERVER_BUILD = {
  version: "0.0.0",
  commit: "abcdef1234567890",
  shortCommit: "abcdef123456",
  dirty: false,
  source: "git",
};

function diagnosticsResponse(over: Partial<Record<string, unknown>> = {}) {
  return new Response(
    JSON.stringify({
      ok: true,
      startedAt: "2026-04-30T00:00:00.000Z",
      build: SERVER_BUILD,
      listening: { host: "127.0.0.1", port: 18091 },
      behaviors: [{ instanceId: "remote-claude", name: "remote-claude", version: "0.0.1" }],
      brokerStats: { spaces: 0, subscribers: 0, bufferedEvents: 0 },
      workspaceRoots: { mode: "restricted", roots: ["/home/me/proj"] },
      diagnostics: {
        remoteClaudeLoaded: true,
        approvalsHookEnabled: false,
        pendingApprovals: 0,
      },
      ...over,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("ConnectionDiagnostics", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "http://test.local" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders behaviors, workspace mode, and approval flags from /diagnostics", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify([SAMPLE_DEVICE]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}/diagnostics`)) {
        return diagnosticsResponse();
      }
      if (url.endsWith("/healthz")) {
        return new Response(
          JSON.stringify({ ok: true, version: "0.0.0", devices: 1, build: SERVER_BUILD }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const { container } = render(() => (
      <ConnectionDiagnostics initialSelectedDeviceId={SAMPLE_DEVICE.id} />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain(t("conn-diag.claude.loaded", { version: "0.0.1" }));
      expect(container.textContent).toContain("일치");
    });
    expect(container.textContent).toContain("remote-claude@0.0.1");
    expect(container.textContent).toContain("restricted");
    expect(container.textContent).toContain("/home/me/proj");
  });

  test("surfaces fetch errors as inline error text without breaking the panel", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify([SAMPLE_DEVICE]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}/diagnostics`)) {
        return new Response(JSON.stringify({ error: "device offline" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const { container } = render(() => (
      <ConnectionDiagnostics initialSelectedDeviceId={SAMPLE_DEVICE.id} />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain(
        t("conn-diag.daemon.error", { error: "device offline" }),
      );
    });
    expect(container.textContent).toContain("Home PC");
    expect(container.textContent).toContain(t("conn-diag.title"));
  });

  test("Refresh button is rendered and clickable", async () => {
    let diagnosticsCalls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/devices")) {
        return new Response(JSON.stringify([SAMPLE_DEVICE]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}/diagnostics`)) {
        diagnosticsCalls += 1;
        return diagnosticsResponse();
      }
      if (url.endsWith("/healthz")) {
        return new Response(
          JSON.stringify({
            ok: true,
            version: "0.0.0",
            devices: 1,
            build: { ...SERVER_BUILD, commit: "ffffffffffffffff", shortCommit: "ffffffffffff" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const { container } = render(() => (
      <ConnectionDiagnostics initialSelectedDeviceId={SAMPLE_DEVICE.id} />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain(t("conn-diag.claude.loaded", { version: "0.0.1" }));
      expect(container.textContent).toContain("불일치");
    });
    const refresh = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === t("conn-diag.action.refresh"),
    );
    expect(refresh).toBeTruthy();
    if (!refresh) throw new Error("refresh button missing");
    fireEvent.click(refresh);

    await waitFor(() => {
      expect(diagnosticsCalls).toBeGreaterThan(1);
    });
  });
});
