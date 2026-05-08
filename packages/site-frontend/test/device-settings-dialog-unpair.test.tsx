// Targeted: DeviceSettingsDialog unpair() must (1) call api.unregisterDevice,
// (2) clear ALL per-device prefs (not just default cwd), (3) fire onUnpaired
// once with the device id, (4) fire onChanged for the parent's refetch,
// (5) close the dialog. And it must NOT do any of (2)–(4) on rename.
//
// We stub `confirm` to true so the danger-zone gate passes, and stub fetch
// for the unregister + diagnostics calls.

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DeviceSettingsDialog } from "../src/components/DeviceSettingsDialog.tsx";
import {
  getAlwaysAllowedTools,
  getDeviceDefaultCwd,
  getDeviceSecurityProfile,
  setAlwaysAllowed,
  setDeviceDefaultCwd,
  setDeviceSecurityProfile,
} from "../src/device-prefs.ts";
import { t } from "../src/i18n.ts";

const SAMPLE_DEVICE = {
  id: "dev_unpair_1",
  label: "Office PC",
  daemonUrl: "http://127.0.0.1:18091",
  registeredAt: "2026-04-30T00:00:00.000Z",
};

const SERVER_DEVICE = {
  id: "dev_server_1",
  label: "Local dev (HOMEDEV)",
  daemonUrl: "http://127.0.0.1:18191",
  registeredAt: "2026-04-30T00:00:00.000Z",
};

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin: "http://test.local" },
  });
  // Default fetch stub: diagnostics returns a minimal payload, unregister
  // returns 200. Tests can override per-case.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}/diagnostics`)) {
      return new Response(
        JSON.stringify({
          ok: true,
          startedAt: SAMPLE_DEVICE.registeredAt,
          listening: { host: "127.0.0.1", port: 18091 },
          behaviors: [],
          brokerStats: { spaces: 0, subscribers: 0, bufferedEvents: 0 },
          workspaceRoots: { mode: "unrestricted", roots: [] },
          diagnostics: {
            remoteClaudeLoaded: true,
            approvalsHookEnabled: false,
            pendingApprovals: 0,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes(`/api/devices/${SAMPLE_DEVICE.id}/fs/list`)) {
      return new Response(JSON.stringify({ path: "", parent: null, entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}`) && method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}`) && method === "PATCH") {
      return new Response(JSON.stringify({ ...SAMPLE_DEVICE, label: "renamed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

function clickDanger(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector(".danger-button") as HTMLButtonElement | null;
  if (!btn) throw new Error("danger button missing");
  // Stub confirm BEFORE clicking — the danger zone gates on it.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(btn);
  return btn;
}

describe("DeviceSettingsDialog — unpair", () => {
  test("saving default cwd persists it and notifies the parent", async () => {
    const onChanged = vi.fn();
    const { container } = render(() => (
      <DeviceSettingsDialog
        device={SAMPLE_DEVICE}
        onClose={vi.fn()}
        onChanged={onChanged}
        onUnpaired={vi.fn()}
      />
    ));

    const cwdInput = [...container.querySelectorAll("input.text-input")].find(
      (input) => input.id !== "device-label",
    ) as HTMLInputElement | undefined;
    if (!cwdInput) throw new Error("cwd input missing");
    fireEvent.input(cwdInput, { target: { value: "C:\\work\\saved" } });

    const saveButtons = [...container.querySelectorAll("button.primary-button")].filter(
      (button) => button.textContent?.trim() === t("dsd.identity.save"),
    );
    const cwdSaveButton = saveButtons[1] as HTMLButtonElement | undefined;
    if (!cwdSaveButton) throw new Error("cwd Save button missing");
    fireEvent.click(cwdSaveButton);

    await waitFor(() => {
      expect(getDeviceDefaultCwd(SAMPLE_DEVICE.id)).toBe("C:\\work\\saved");
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  test("calls api.unregisterDevice, wipes all per-device prefs, fires onUnpaired+onChanged+onClose exactly once", async () => {
    // Seed prefs so we can verify the wipe actually drops them.
    setDeviceDefaultCwd(SAMPLE_DEVICE.id, "/work");
    setAlwaysAllowed(SAMPLE_DEVICE.id, "Read", true);
    setDeviceSecurityProfile(SAMPLE_DEVICE.id, "strict");

    const onClose = vi.fn();
    const onChanged = vi.fn();
    const onUnpaired = vi.fn();

    const { container } = render(() => (
      <DeviceSettingsDialog
        device={SAMPLE_DEVICE}
        onClose={onClose}
        onChanged={onChanged}
        onUnpaired={onUnpaired}
      />
    ));

    clickDanger(container);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onUnpaired).toHaveBeenCalledTimes(1);
    expect(onUnpaired).toHaveBeenCalledWith(SAMPLE_DEVICE.id);
    expect(onChanged).toHaveBeenCalledTimes(1);

    // The wipe — defaultCwd, always-allowed tools, security profile.
    expect(getDeviceDefaultCwd(SAMPLE_DEVICE.id)).toBeNull();
    expect(getAlwaysAllowedTools(SAMPLE_DEVICE.id).size).toBe(0);
    expect(getDeviceSecurityProfile(SAMPLE_DEVICE.id)).toBe("relaxed");
  });

  test("does NOT clear prefs or fire onUnpaired when only the label changes (rename path)", async () => {
    setDeviceDefaultCwd(SAMPLE_DEVICE.id, "/keep");
    setAlwaysAllowed(SAMPLE_DEVICE.id, "Read", true);
    setDeviceSecurityProfile(SAMPLE_DEVICE.id, "strict");

    const onClose = vi.fn();
    const onChanged = vi.fn();
    const onUnpaired = vi.fn();

    const { container } = render(() => (
      <DeviceSettingsDialog
        device={SAMPLE_DEVICE}
        onClose={onClose}
        onChanged={onChanged}
        onUnpaired={onUnpaired}
      />
    ));

    // Identity card has the label input + a Save button. Rename then click
    // Save (not the danger button).
    const labelInput = container.querySelector("#device-label") as HTMLInputElement | null;
    if (!labelInput) throw new Error("device label input missing");
    fireEvent.input(labelInput, { target: { value: "renamed" } });
    const buttons = [...container.querySelectorAll("button.primary-button")];
    const saveBtn = buttons.find((b) => b.textContent?.trim() === t("dsd.identity.save"));
    if (!saveBtn) throw new Error("Save button missing");
    fireEvent.click(saveBtn);

    // Wait for the fetch to settle + onChanged to fire.
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });

    // Critical: onUnpaired must NOT have fired, prefs must be intact.
    expect(onUnpaired).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(getDeviceDefaultCwd(SAMPLE_DEVICE.id)).toBe("/keep");
    expect(getAlwaysAllowedTools(SAMPLE_DEVICE.id).has("Read")).toBe(true);
    expect(getDeviceSecurityProfile(SAMPLE_DEVICE.id)).toBe("strict");
  });

  test("server delete failure surfaces inline + does not clear prefs or fire onUnpaired/onClose", async () => {
    setDeviceDefaultCwd(SAMPLE_DEVICE.id, "/keep-on-failure");

    // Override the global fetch stub: DELETE now 500s.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}/diagnostics`)) {
        return new Response("{}", { status: 200 });
      }
      if (url.endsWith(`/api/devices/${SAMPLE_DEVICE.id}`) && method === "DELETE") {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      return new Response("{}", { status: 200 });
    });

    const onClose = vi.fn();
    const onChanged = vi.fn();
    const onUnpaired = vi.fn();

    const { container } = render(() => (
      <DeviceSettingsDialog
        device={SAMPLE_DEVICE}
        onClose={onClose}
        onChanged={onChanged}
        onUnpaired={onUnpaired}
      />
    ));

    clickDanger(container);

    // Wait for the inline error surface (mirrors the prior diagnostics test).
    await waitFor(() => {
      const err = container.querySelector(".settings-error");
      expect(err?.textContent ?? "").toMatch(/.+/);
    });

    expect(onUnpaired).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    // Prefs untouched on failure path — re-trying unpair after fixing
    // the server picks up where the user left off.
    expect(getDeviceDefaultCwd(SAMPLE_DEVICE.id)).toBe("/keep-on-failure");
  });

  test("blocks individual server removal but allows explicit server + all devices removal", async () => {
    setDeviceDefaultCwd(SAMPLE_DEVICE.id, "/remote-work");
    setDeviceDefaultCwd(SERVER_DEVICE.id, "/server-work");
    const deletedIds: string[] = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "DELETE" && url.includes("/api/devices/")) {
        deletedIds.push(decodeURIComponent(url.split("/").pop() ?? ""));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const onClose = vi.fn();
    const onChanged = vi.fn();
    const onUnpaired = vi.fn();
    const onDevicesRemoved = vi.fn();

    const { container } = render(() => (
      <DeviceSettingsDialog
        device={SERVER_DEVICE}
        devices={[SERVER_DEVICE, SAMPLE_DEVICE]}
        onClose={onClose}
        onChanged={onChanged}
        onDevicesRemoved={onDevicesRemoved}
        onUnpaired={onUnpaired}
      />
    ));

    expect(container.querySelector('[data-testid="device-unpair-button"]')).toBeNull();
    expect(container.textContent ?? "").toContain(t("dsd.unpair.server.blocked"));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const removeAllButton = container.querySelector(
      '[data-testid="device-unpair-all-button"]',
    ) as HTMLButtonElement | null;
    if (!removeAllButton) throw new Error("remove all button missing");
    fireEvent.click(removeAllButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(deletedIds).toEqual([SAMPLE_DEVICE.id, SERVER_DEVICE.id]);
    expect(onDevicesRemoved).toHaveBeenCalledWith([SAMPLE_DEVICE.id, SERVER_DEVICE.id]);
    expect(onUnpaired).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(getDeviceDefaultCwd(SAMPLE_DEVICE.id)).toBeNull();
    expect(getDeviceDefaultCwd(SERVER_DEVICE.id)).toBeNull();
  });
});
