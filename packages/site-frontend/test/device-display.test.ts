import { describe, expect, test } from "vitest";
import { deviceDisplayName, deviceDisplayRole } from "../src/device-display.ts";

describe("device display role", () => {
  test("marks the self-host server connector", () => {
    const device = {
      label: "HOMEDEV",
      daemonUrl: "http://127.0.0.1:18191",
    };
    expect(deviceDisplayRole(device)).toBe("Server");
    expect(deviceDisplayName(device)).toBe("HOMEDEV (Server)");
    expect(
      deviceDisplayName({
        label: "Local dev (HOMEDEV)",
        daemonUrl: "http://127.0.0.1:18191",
      }),
    ).toBe("HOMEDEV (Server)");
  });

  test("marks Tailscale, LAN, local, and remote devices", () => {
    expect(
      deviceDisplayName({ label: "DESKTOP-8GHUPS5", daemonUrl: "http://100.67.105.67:18091" }),
    ).toBe("DESKTOP-8GHUPS5 (Tailscale)");
    expect(deviceDisplayName({ label: "OFFICE", daemonUrl: "http://192.168.0.20:18091" })).toBe(
      "OFFICE (LAN)",
    );
    expect(deviceDisplayName({ label: "LOCAL", daemonUrl: "http://127.0.0.1:18091" })).toBe(
      "LOCAL (Local)",
    );
    expect(deviceDisplayName({ label: "HOSTED", daemonUrl: "https://example.com:18091" })).toBe(
      "HOSTED (Remote)",
    );
  });

  test("does not duplicate an existing suffix", () => {
    const device = {
      label: "HOMEDEV (Server)",
      daemonUrl: "http://127.0.0.1:18191",
    };
    expect(deviceDisplayName(device)).toBe("HOMEDEV (Server)");
  });
});
