import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Device } from "../src/api.ts";
import { DeviceShell } from "../src/components/DeviceShell.tsx";
import { t } from "../src/i18n.ts";

const LOCAL_DEVICE = {
  id: "dev_local",
  label: "Local desktop",
  daemonUrl: "http://127.0.0.1:18091",
  registeredAt: "2026-04-30T00:00:00.000Z",
};

const TAILSCALE_DEVICE = {
  id: "dev_tail",
  label: "Travel laptop",
  daemonUrl: "http://100.64.0.2:18091",
  registeredAt: "2026-04-30T00:01:00.000Z",
};

const SERVER_DEVICE = {
  id: "dev_server",
  label: "Local dev (HOMEDEV)",
  daemonUrl: "http://127.0.0.1:18191",
  registeredAt: "2026-04-30T00:02:00.000Z",
};

const originalClipboard = navigator.clipboard;

function stubDeviceFetch(devices: Device[], onDelete?: (id: string) => Response): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/devices") && method === "GET") {
      return new Response(JSON.stringify(devices), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const deleteMatch = url.match(/\/api\/devices\/([^/]+)$/);
    if (deleteMatch && method === "DELETE") {
      return onDelete?.(deleteMatch[1] ?? "") ?? new Response(JSON.stringify({ ok: true }));
    }
    if (url.includes("/fs/list") || url.includes("/fs/roots")) {
      return new Response(JSON.stringify({ path: "", parent: null, entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin: "http://test.local" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  localStorage.clear();
});

describe("DeviceShell self-host device management UX", () => {
  test("lists devices and switches the selected settings panel locally", async () => {
    stubDeviceFetch([LOCAL_DEVICE, TAILSCALE_DEVICE]);

    const { container } = render(() => <DeviceShell />);

    await waitFor(() => {
      expect(container.textContent).toContain("Local desktop (Local)");
      expect(container.textContent).toContain("Travel laptop (Tailscale)");
      expect(container.querySelector("#device-label")).toBeTruthy();
    });

    const laptopButton = [...container.querySelectorAll(".settings-list-item-main")].find(
      (button) => button.textContent?.includes("Travel laptop"),
    ) as HTMLButtonElement | undefined;
    if (!laptopButton) throw new Error("laptop device button missing");
    fireEvent.click(laptopButton);

    await waitFor(() => {
      const selected = container.querySelector(
        '.settings-list-item-main[aria-pressed="true"]',
      ) as HTMLButtonElement | null;
      expect(selected?.textContent).toContain("Travel laptop");
      expect((container.querySelector("#device-label") as HTMLInputElement | null)?.value).toBe(
        TAILSCALE_DEVICE.label,
      );
    });
  });

  test("keeps other-PC registration commands out of the settings device tab", async () => {
    stubDeviceFetch([LOCAL_DEVICE]);

    const { container } = render(() => <DeviceShell />);

    await waitFor(() => {
      expect(container.textContent).toContain("Local desktop");
    });

    expect(container.textContent).not.toContain(t("ds.add.command.title"));
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(container.querySelector('input[placeholder="daemon token"]')).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });

  test("locks server-device removal but still allows removing a registered connector", async () => {
    let listedDevices: Device[] = [SERVER_DEVICE, TAILSCALE_DEVICE];
    let deleteCalls = 0;
    stubDeviceFetch(listedDevices, (id) => {
      deleteCalls += 1;
      listedDevices = listedDevices.filter((device) => device.id !== id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(() => <DeviceShell />);

    await waitFor(() => {
      expect(container.textContent).toContain("HOMEDEV (Server)");
      expect(container.textContent).toContain(t("ds.devices.server.locked"));
      expect(container.textContent).toContain("Travel laptop");
    });

    const remove = [...container.querySelectorAll(".danger-button")].find(
      (button) => button.textContent?.trim() === t("ds.devices.remove"),
    ) as HTMLButtonElement | undefined;
    if (!remove) throw new Error("registered connector remove button missing");
    fireEvent.click(remove);

    await waitFor(() => {
      expect(deleteCalls).toBe(1);
      expect(container.textContent).not.toContain("Travel laptop");
      expect(container.textContent).toContain("HOMEDEV (Server)");
    });
  });

  test("surfaces manual cleanup when connector cleanup fails during removal", async () => {
    const onManualCleanupRequired = vi.fn();
    stubDeviceFetch(
      [LOCAL_DEVICE],
      () =>
        new Response(
          JSON.stringify({
            ok: true,
            cleanup: { ok: false, error: "connector offline", manualCommand: "remove command" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(() => (
      <DeviceShell onManualCleanupRequired={onManualCleanupRequired} />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Local desktop");
    });

    const remove = container.querySelector(".danger-button") as HTMLButtonElement | null;
    if (!remove) throw new Error("remove button missing");
    fireEvent.click(remove);

    await waitFor(() => {
      expect(onManualCleanupRequired).toHaveBeenCalledWith([
        {
          id: LOCAL_DEVICE.id,
          label: LOCAL_DEVICE.label,
          daemonUrl: LOCAL_DEVICE.daemonUrl,
          cleanup: { ok: false, error: "connector offline", manualCommand: "remove command" },
        },
      ]);
      expect(container.textContent).not.toContain("Local desktop");
    });
  });

  test("removes a device optimistically and ignores duplicate remove clicks", async () => {
    let listedDevices: Device[] = [LOCAL_DEVICE];
    let deleteCalls = 0;
    stubDeviceFetch(listedDevices, (id) => {
      deleteCalls += 1;
      listedDevices = listedDevices.filter((device) => device.id !== id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(() => <DeviceShell />);

    await waitFor(() => {
      expect(container.textContent).toContain(LOCAL_DEVICE.label);
    });

    const remove = container.querySelector(".danger-button") as HTMLButtonElement | null;
    if (!remove) throw new Error("remove button missing");
    fireEvent.click(remove);
    fireEvent.click(remove);

    await waitFor(() => {
      expect(deleteCalls).toBe(1);
      expect(container.textContent).not.toContain(LOCAL_DEVICE.label);
    });
  });
});
