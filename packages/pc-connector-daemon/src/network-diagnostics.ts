import { execFileSync } from "node:child_process";
import type {
  ManagerNetworkAddress,
  ManagerNetworkKind,
  ManagerNetworkProbe,
} from "@deskrelay/shared";

export type NetworkDiagnosticRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => string;

export interface ConnectorNetworkDiagnosticInput {
  platform: NodeJS.Platform;
  listening?: { host: string; port: number; kind: ManagerNetworkKind } | undefined;
  addresses: ManagerNetworkAddress[];
  runner?: NetworkDiagnosticRunner | undefined;
}

export interface ConnectorNetworkDiagnosticResult {
  probes: ManagerNetworkProbe[];
  severity: "ok" | "warn" | "error" | "unknown";
  warnings: string[];
}

const COMMAND_TIMEOUT_MS = 1_500;

export function buildConnectorNetworkDiagnostics(
  input: ConnectorNetworkDiagnosticInput,
): ConnectorNetworkDiagnosticResult {
  const runner = input.runner ?? defaultRunner;
  const probes = [
    listenBindProbe(input.listening, input.addresses),
    tailscaleAddressProbe(input.addresses),
    windowsFirewallProbe(input.platform, input.listening, runner),
  ];
  const warnings = probes
    .filter((probe) => probe.state === "warn" || probe.state === "error")
    .map((probe) => probe.hint || probe.error || probe.label)
    .filter(Boolean);
  return {
    probes,
    severity: worstProbeSeverity(probes),
    warnings,
  };
}

function listenBindProbe(
  listening: ConnectorNetworkDiagnosticInput["listening"],
  addresses: ManagerNetworkAddress[],
): ManagerNetworkProbe {
  const externalAddresses = addresses.filter(
    (address) => !address.internal && (address.kind === "tailscale" || address.kind === "lan"),
  );
  if (!listening) {
    return {
      id: "daemon.listen-bind",
      label: "Connector bind address",
      url: "connector://listen",
      ok: false,
      state: "unknown",
      classification: "not-reported",
      error: "Connector has not reported its bind address.",
      hint: "Restart the connector and check whether the HTTP listener starts.",
    };
  }
  if (listening.kind === "local" && externalAddresses.length > 0) {
    return {
      id: "daemon.listen-bind",
      label: "Connector bind address",
      url: `http://${listening.host}:${listening.port}/status`,
      ok: false,
      state: "warn",
      classification: "local-bind-with-remote-address",
      hint:
        "Connector is local-only even though this PC has LAN/Tailscale addresses. Re-register or restart it with listen host 0.0.0.0 for remote access.",
    };
  }
  return {
    id: "daemon.listen-bind",
    label: "Connector bind address",
    url: `http://${formatHostForUrl(listening.host)}:${listening.port}/status`,
    ok: true,
    state: "ok",
    classification: listening.kind === "unknown" ? "all-interfaces-or-unknown" : listening.kind,
    status: 200,
  };
}

function tailscaleAddressProbe(addresses: ManagerNetworkAddress[]): ManagerNetworkProbe {
  const tailscaleAddresses = addresses.filter((address) => address.kind === "tailscale");
  if (tailscaleAddresses.length === 0) {
    return {
      id: "daemon.tailscale",
      label: "Tailscale address",
      url: "tailscale://ip",
      ok: true,
      state: "skipped",
      classification: "no-tailscale-address",
      hint: "No Tailscale address was detected on this PC.",
    };
  }
  return {
    id: "daemon.tailscale",
    label: "Tailscale address",
    url: tailscaleAddresses[0]?.url ?? "tailscale://ip",
    ok: true,
    state: "ok",
    classification: "tailscale-address-detected",
    status: 200,
  };
}

function windowsFirewallProbe(
  platform: NodeJS.Platform,
  listening: ConnectorNetworkDiagnosticInput["listening"],
  runner: NetworkDiagnosticRunner,
): ManagerNetworkProbe {
  if (platform !== "win32") {
    return {
      id: "daemon.windows-firewall",
      label: "Windows Firewall",
      url: "windows-firewall://connector",
      ok: true,
      state: "skipped",
      classification: "non-windows",
      hint: "Windows Firewall does not apply on this platform.",
    };
  }
  if (!listening) {
    return {
      id: "daemon.windows-firewall",
      label: "Windows Firewall",
      url: "windows-firewall://connector",
      ok: false,
      state: "unknown",
      classification: "no-listener",
      error: "Connector port is unknown.",
      hint: "Start the connector before checking firewall state.",
    };
  }
  if (listening.kind === "local") {
    return {
      id: "daemon.windows-firewall",
      label: "Windows Firewall",
      url: `windows-firewall://connector/${listening.port}`,
      ok: true,
      state: "skipped",
      classification: "local-bind",
      hint: "Firewall is not needed for a localhost-only connector.",
    };
  }
  const ruleName = `DeskRelay Connector ${listening.port}`;
  try {
    const script = [
      `$rule = Get-NetFirewallRule -DisplayName '${ruleName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | Select-Object -First 1`,
      "if ($rule) { 'FOUND' } else { 'MISSING' }",
    ].join("; ");
    const output = runner(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeoutMs: COMMAND_TIMEOUT_MS },
    ).trim();
    if (output.includes("FOUND")) {
      return {
        id: "daemon.windows-firewall",
        label: "Windows Firewall",
        url: `windows-firewall://connector/${listening.port}`,
        ok: true,
        state: "ok",
        classification: "rule-present",
      };
    }
    return {
      id: "daemon.windows-firewall",
      label: "Windows Firewall",
      url: `windows-firewall://connector/${listening.port}`,
      ok: false,
      state: "warn",
      classification: "rule-missing",
      error: `${ruleName} inbound allow rule was not found.`,
      hint: `Allow inbound TCP ${listening.port} or rerun the registration command as Administrator.`,
      retrySafe: true,
    };
  } catch (error) {
    return {
      id: "daemon.windows-firewall",
      label: "Windows Firewall",
      url: `windows-firewall://connector/${listening.port}`,
      ok: false,
      state: "warn",
      classification: "rule-check-failed",
      error: errorMessage(error),
      hint: `If remote access fails, allow inbound TCP ${listening.port} or rerun registration as Administrator.`,
      retrySafe: true,
    };
  }
}

function defaultRunner(command: string, args: string[], options: { timeoutMs: number }): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function worstProbeSeverity(probes: ManagerNetworkProbe[]): "ok" | "warn" | "error" | "unknown" {
  if (probes.some((probe) => probe.state === "error")) return "error";
  if (probes.some((probe) => probe.state === "warn")) return "warn";
  if (probes.some((probe) => probe.state === "unknown")) return "unknown";
  return "ok";
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
