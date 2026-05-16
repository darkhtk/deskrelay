import { describe, expect, test } from "bun:test";
import type { ManagerNetworkAddress } from "@deskrelay/shared";
import { buildConnectorNetworkDiagnostics } from "../src/network-diagnostics.ts";

const tailscaleAddress: ManagerNetworkAddress = {
  address: "100.64.0.5",
  interfaceName: "Tailscale",
  family: "IPv4",
  kind: "tailscale",
  internal: false,
  url: "http://100.64.0.5:18091",
};

const lanAddress: ManagerNetworkAddress = {
  address: "192.168.0.20",
  interfaceName: "Ethernet",
  family: "IPv4",
  kind: "lan",
  internal: false,
  url: "http://192.168.0.20:18091",
};

describe("connector network diagnostics", () => {
  test("warns when connector is local-only but remote addresses exist", () => {
    const result = buildConnectorNetworkDiagnostics({
      platform: "linux",
      listening: { host: "127.0.0.1", port: 18091, kind: "local" },
      addresses: [tailscaleAddress],
      runner: () => "100.64.0.5\n",
    });
    expect(result.severity).toBe("warn");
    expect(result.probes).toContainEqual(
      expect.objectContaining({
        id: "daemon.listen-bind",
        state: "warn",
        classification: "local-bind-with-remote-address",
      }),
    );
  });

  test("trusts detected Tailscale interface addresses without shelling out", () => {
    let calls = 0;
    const result = buildConnectorNetworkDiagnostics({
      platform: "linux",
      listening: { host: "0.0.0.0", port: 18091, kind: "unknown" },
      addresses: [tailscaleAddress],
      runner: () => {
        calls += 1;
        throw new Error("runner should not be called for Tailscale detection");
      },
    });
    expect(calls).toBe(0);
    expect(result.severity).toBe("ok");
    expect(result.probes).toContainEqual(
      expect.objectContaining({
        id: "daemon.tailscale",
        state: "ok",
        classification: "tailscale-address-detected",
      }),
    );
  });

  test("skips firewall on non-Windows platforms", () => {
    const result = buildConnectorNetworkDiagnostics({
      platform: "linux",
      listening: { host: "0.0.0.0", port: 18091, kind: "unknown" },
      addresses: [lanAddress],
      runner: () => "",
    });
    expect(result.probes).toContainEqual(
      expect.objectContaining({
        id: "daemon.windows-firewall",
        state: "skipped",
        classification: "non-windows",
      }),
    );
  });

  test("checks Windows firewall rule when connector is remotely reachable", () => {
    const commands: string[] = [];
    const result = buildConnectorNetworkDiagnostics({
      platform: "win32",
      listening: { host: "0.0.0.0", port: 18091, kind: "unknown" },
      addresses: [lanAddress],
      runner: (command, args) => {
        commands.push(`${command} ${args.join(" ")}`);
        return command === "powershell" ? "MISSING" : "";
      },
    });
    expect(commands.some((command) => command.startsWith("powershell "))).toBe(true);
    expect(result.probes).toContainEqual(
      expect.objectContaining({
        id: "daemon.windows-firewall",
        state: "warn",
        classification: "rule-missing",
      }),
    );
  });
});
