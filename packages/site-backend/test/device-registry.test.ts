import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeviceRegistryError,
  InMemoryDeviceRegistry,
  JsonFileDeviceRegistry,
} from "../src/device-registry.ts";

describe("InMemoryDeviceRegistry", () => {
  test("starts empty", () => {
    expect(new InMemoryDeviceRegistry().list()).toEqual([]);
  });

  test("register returns a device with id, label, registeredAt", () => {
    const r = new InMemoryDeviceRegistry();
    const d = r.register({ daemonUrl: "http://127.0.0.1:18091" });
    expect(d.id.startsWith("dev_")).toBe(true);
    expect(d.label).toBe("127.0.0.1:18091");
    expect(d.daemonUrl).toBe("http://127.0.0.1:18091");
    expect(typeof d.registeredAt).toBe("string");
    expect(r.list()).toEqual([d]);
  });

  test("register normalizes trailing slashes + drops query/hash", () => {
    const r = new InMemoryDeviceRegistry();
    const d = r.register({ daemonUrl: "http://127.0.0.1:18091/?x=1#y" });
    expect(d.daemonUrl).toBe("http://127.0.0.1:18091");
  });

  test("register honors a custom label", () => {
    const r = new InMemoryDeviceRegistry();
    const d = r.register({ daemonUrl: "http://127.0.0.1:1", label: "Office PC" });
    expect(d.label).toBe("Office PC");
  });

  test("register rejects non-http(s) URLs", () => {
    const r = new InMemoryDeviceRegistry();
    expect(() => r.register({ daemonUrl: "ftp://x" })).toThrow(DeviceRegistryError);
  });

  test("register rejects unparsable URLs", () => {
    const r = new InMemoryDeviceRegistry();
    expect(() => r.register({ daemonUrl: "not a url" })).toThrow(DeviceRegistryError);
  });

  test("register refreshes duplicate canonicalized daemonUrl in place", () => {
    const r = new InMemoryDeviceRegistry();
    const first = r.register({ daemonUrl: "http://127.0.0.1:18091", authToken: "old" });
    const second = r.register({
      daemonUrl: "http://127.0.0.1:18091/?x=1#y",
      label: "Updated",
      authToken: "new",
    });
    expect(second.id).toBe(first.id);
    expect(second.label).toBe("Updated");
    expect(second.daemonUrl).toBe("http://127.0.0.1:18091");
    expect(second.authToken).toBe("new");
    expect(r.list()).toHaveLength(1);
  });

  test("get returns the registered device, undefined for unknown id", () => {
    const r = new InMemoryDeviceRegistry();
    const d = r.register({ daemonUrl: "http://x:1" });
    expect(r.get(d.id)).toEqual(d);
    expect(r.get("nope")).toBeUndefined();
  });

  test("unregister returns true on success, false on miss; idempotent", () => {
    const r = new InMemoryDeviceRegistry();
    const d = r.register({ daemonUrl: "http://x:1" });
    expect(r.unregister(d.id)).toBe(true);
    expect(r.unregister(d.id)).toBe(false);
  });
});

describe("JsonFileDeviceRegistry", () => {
  test("persists registered, renamed, and removed devices across instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deskrelay-devices-"));
    try {
      const file = join(dir, "devices.json");
      const first = new JsonFileDeviceRegistry(file);
      const device = first.register({
        daemonUrl: "http://127.0.0.1:18091/",
        label: "Other PC",
        authToken: "daemon-token",
      });
      first.rename(device.id, "Renamed PC");

      const second = new JsonFileDeviceRegistry(file);
      expect(second.list()).toEqual([
        {
          ...device,
          label: "Renamed PC",
          daemonUrl: "http://127.0.0.1:18091",
        },
      ]);

      expect(second.unregister(device.id)).toBe(true);
      expect(new JsonFileDeviceRegistry(file).list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
