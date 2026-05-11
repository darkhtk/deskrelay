// Diagnostics now live in the unified settings dialog via
// ConnectionDiagnostics, not in each DeviceSettingsDialog.

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
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

  test("renders workspace mode and approval flags without legacy behavior listing", async () => {
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
      expect(container.textContent).toContain("restricted");
    });
    expect(container.textContent).not.toContain("remote-claude@0.0.1");
    expect(container.textContent).toContain("/home/me/proj");
  });

  test("always shows the current high-level connection state", async () => {
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
      if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}/doctor`)) {
        return new Response(JSON.stringify({ checks: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/self/install-reports?limit=5")) {
        return new Response(JSON.stringify({ reports: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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
      expect(container.textContent).toContain("Server");
      expect(container.textContent).toContain("Device");
      expect(container.textContent).toContain("Connector");
      expect(container.textContent).toContain("Site");
      expect(container.textContent).toContain("Version");
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".connection-diagnostics-metric .tone-ok").length).toBe(5);
    });
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
      expect(diagnosticsCalls).toBeGreaterThan(0);
    });
    const refresh = container.querySelector<HTMLButtonElement>(
      ".connection-diagnostics-actions button",
    );
    expect(refresh).toBeTruthy();
    if (!refresh) throw new Error("refresh button missing");
    fireEvent.click(refresh);

    await waitFor(() => {
      expect(diagnosticsCalls).toBeGreaterThan(1);
    });
  });

  test("refreshes version diagnostics when the devices revision changes in place", async () => {
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
        return diagnosticsResponse({
          build:
            diagnosticsCalls === 1
              ? { ...SERVER_BUILD, commit: "oldoldoldoldold", shortCommit: "oldoldoldold" }
              : SERVER_BUILD,
        });
      }
      if (url.endsWith("/healthz")) {
        return new Response(
          JSON.stringify({ ok: true, version: "0.0.0", devices: 1, build: SERVER_BUILD }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const Harness = () => {
      const [revision, setRevision] = createSignal(0);
      return (
        <>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            bump revision
          </button>
          <ConnectionDiagnostics
            initialSelectedDeviceId={SAMPLE_DEVICE.id}
            devicesRevision={revision()}
          />
        </>
      );
    };

    const { getByText } = render(() => <Harness />);

    await waitFor(() => {
      expect(diagnosticsCalls).toBeGreaterThan(0);
    });

    fireEvent.click(getByText("bump revision"));

    await waitFor(() => {
      expect(diagnosticsCalls).toBeGreaterThan(1);
    });
  });

  test("shows only actionable installer report steps", async () => {
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
      if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}/doctor`)) {
        return new Response(JSON.stringify({ checks: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/self/install-reports?limit=5")) {
        return new Response(
          JSON.stringify({
            reports: [
              {
                id: "install_1",
                receivedAt: "2026-05-11T00:00:00.000Z",
                status: "failed",
                label: "Remote PC",
                steps: [
                  {
                    id: "repo",
                    label: "DeskRelay repo",
                    status: "ok",
                    severity: "ok",
                    summary: "repo is clean",
                    userVisible: false,
                  },
                  {
                    id: "firewall",
                    label: "Windows Firewall",
                    status: "failed",
                    severity: "error",
                    summary: "inbound port is blocked",
                    userVisible: true,
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
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
      expect(container.textContent).toContain("Windows Firewall");
    });
    expect(container.textContent).toContain("inbound port is blocked");
    expect(container.textContent).not.toContain("repo is clean");
  });
});
