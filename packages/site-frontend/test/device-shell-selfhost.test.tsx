import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DeviceShell } from "../src/components/DeviceShell.tsx";

const OLD_DEVICE = {
  id: "dev_old",
  label: "Old desktop",
  daemonUrl: "http://127.0.0.1:18091",
  registeredAt: "2026-04-30T00:00:00.000Z",
};

const NEW_DEVICE = {
  id: "dev_new",
  label: "New laptop",
  daemonUrl: "http://127.0.0.1:18092",
  registeredAt: "2026-04-30T00:01:00.000Z",
};

const originalClipboard = navigator.clipboard;

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

describe("DeviceShell self-host registration UX", () => {
  test("selects a newly registered device without requiring a manual refresh", async () => {
    let listedDevices = [OLD_DEVICE];
    const onDevicesChanged = vi.fn();
    const onDeviceSelected = vi.fn();
    let postedBody: unknown;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify(listedDevices), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/devices") && method === "POST") {
        postedBody = JSON.parse(String(init?.body ?? "{}"));
        listedDevices = [OLD_DEVICE, NEW_DEVICE];
        return new Response(JSON.stringify(NEW_DEVICE), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/fs/list") || url.includes("/fs/roots")) {
        return new Response(JSON.stringify({ path: "", parent: null, entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <DeviceShell onDevicesChanged={onDevicesChanged} onDeviceSelected={onDeviceSelected} />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Old desktop");
    });

    const urlInput = container.querySelector('input[type="url"]') as HTMLInputElement | null;
    const labelInput = container.querySelector(
      'input[placeholder="Label"]',
    ) as HTMLInputElement | null;
    const tokenInput = container.querySelector(
      'input[placeholder="daemon token"]',
    ) as HTMLInputElement | null;
    if (!urlInput || !labelInput || !tokenInput) throw new Error("add device inputs missing");

    fireEvent.input(urlInput, { target: { value: NEW_DEVICE.daemonUrl } });
    fireEvent.input(labelInput, { target: { value: NEW_DEVICE.label } });
    fireEvent.input(tokenInput, { target: { value: "daemon-token-2" } });

    const addButton = [...container.querySelectorAll("button")].find((button) =>
      /add device/i.test(button.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
    if (!addButton) throw new Error("add device button missing");
    fireEvent.click(addButton);

    await waitFor(() => {
      const selected = container.querySelector(
        '.settings-list-item-main[aria-pressed="true"]',
      ) as HTMLButtonElement | null;
      expect(selected?.textContent).toContain(NEW_DEVICE.label);
      expect(onDevicesChanged).toHaveBeenCalled();
      expect(onDeviceSelected).toHaveBeenCalledWith(NEW_DEVICE.id);
      expect(postedBody).toEqual({
        daemonUrl: NEW_DEVICE.daemonUrl,
        label: NEW_DEVICE.label,
        authToken: "daemon-token-2",
      });
      expect(container.textContent).toContain("connected and ready");
    });
  });

  test("copies the generated other-PC registration command from settings", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([OLD_DEVICE]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/self/register-other-pc-command") && method === "GET") {
        return new Response(
          JSON.stringify({
            preferredUrl: "http://100.64.0.1:18193",
            urls: [{ kind: "Tailscale", url: "http://100.64.0.1:18193" }],
            command: "powershell register command",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/fs/list") || url.includes("/fs/roots")) {
        return new Response(JSON.stringify({ path: "", parent: null, entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => <DeviceShell />);

    await waitFor(() => {
      expect(container.textContent).toContain("Register another PC by copy-paste");
    });

    const copyButton = [...container.querySelectorAll("button")].find((button) =>
      /copy registration command/i.test(button.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
    if (!copyButton) throw new Error("copy command button missing");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("powershell register command");
      expect(container.textContent).toContain("Registration command copied");
      expect(container.querySelector("textarea")).toBeNull();
    });
  });

  test("selects another PC when the copied registration command finishes", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    let listedDevices = [OLD_DEVICE];
    const onDevicesChanged = vi.fn();
    const onDeviceSelected = vi.fn();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify(listedDevices), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/self/register-other-pc-command") && method === "GET") {
        return new Response(
          JSON.stringify({
            preferredUrl: "http://100.64.0.1:18193",
            urls: [{ kind: "Tailscale", url: "http://100.64.0.1:18193" }],
            command: "powershell register command",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/fs/list") || url.includes("/fs/roots")) {
        return new Response(JSON.stringify({ path: "", parent: null, entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => (
      <DeviceShell onDevicesChanged={onDevicesChanged} onDeviceSelected={onDeviceSelected} />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Register another PC by copy-paste");
    });

    const copyButton = [...container.querySelectorAll("button")].find((button) =>
      /copy registration command/i.test(button.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
    if (!copyButton) throw new Error("copy command button missing");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("powershell register command");
      expect(container.textContent).toContain("Waiting for the other PC to register");
    });

    listedDevices = [OLD_DEVICE, NEW_DEVICE];

    await waitFor(
      () => {
        const selected = container.querySelector(
          '.settings-list-item-main[aria-pressed="true"]',
        ) as HTMLButtonElement | null;
        expect(selected?.textContent).toContain(NEW_DEVICE.label);
        expect(onDevicesChanged).toHaveBeenCalled();
        expect(onDeviceSelected).toHaveBeenCalledWith(NEW_DEVICE.id);
        expect(container.textContent).toContain("New laptop (Local) registered and selected.");
      },
      { timeout: 2500 },
    );
  });

  test("copies the generated other-PC removal command from settings", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify([OLD_DEVICE]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/self/remove-other-pc-command") && method === "GET") {
        return new Response(
          JSON.stringify({
            preferredUrl: "http://100.64.0.1:18193",
            urls: [{ kind: "Tailscale", url: "http://100.64.0.1:18193" }],
            command: "powershell remove command",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/fs/list") || url.includes("/fs/roots")) {
        return new Response(JSON.stringify({ path: "", parent: null, entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const { container } = render(() => <DeviceShell />);

    await waitFor(() => {
      expect(container.textContent).toContain("Register another PC by copy-paste");
    });

    const copyButton = [...container.querySelectorAll("button")].find((button) =>
      /copy removal command/i.test(button.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
    if (!copyButton) throw new Error("copy removal command button missing");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("powershell remove command");
      expect(container.textContent).toContain("Removal command copied");
      expect(container.querySelector("textarea")).toBeNull();
    });
  });

  test("removes a device optimistically and ignores duplicate remove clicks", async () => {
    let listedDevices = [OLD_DEVICE];
    let deleteCalls = 0;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/devices") && method === "GET") {
        return new Response(JSON.stringify(listedDevices), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/devices/${OLD_DEVICE.id}`) && method === "DELETE") {
        deleteCalls += 1;
        listedDevices = [];
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/fs/list") || url.includes("/fs/roots")) {
        return new Response(JSON.stringify({ path: "", parent: null, entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(() => <DeviceShell />);

    await waitFor(() => {
      expect(container.textContent).toContain(OLD_DEVICE.label);
    });

    const remove = container.querySelector(".danger-button") as HTMLButtonElement | null;
    if (!remove) throw new Error("remove button missing");
    fireEvent.click(remove);
    fireEvent.click(remove);

    await waitFor(() => {
      expect(deleteCalls).toBe(1);
      expect(container.textContent).not.toContain(OLD_DEVICE.label);
    });
  });
});
