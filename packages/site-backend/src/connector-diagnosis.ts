import type { DiagnosticSeverity, ManagerNetworkKind } from "@deskrelay/shared";

export type ConnectorReachabilityKind =
  | "ok"
  | "local-only-url"
  | "token-rejected"
  | "daemon-not-listening"
  | "tailscale-route-or-firewall"
  | "lan-route-or-firewall"
  | "public-route-or-firewall"
  | "route-or-firewall"
  | "http-error"
  | "unknown";

export interface ConnectorReachabilityDiagnosis {
  kind: ConnectorReachabilityKind;
  networkKind: ManagerNetworkKind;
  severity: DiagnosticSeverity;
  summary: string;
  detail: string;
  hint: string;
  retrySafe: boolean;
  userVisible: boolean;
}

export function diagnoseConnectorReachability(input: {
  daemonUrl: string;
  status?: number | undefined;
  error?: string | undefined;
  allowLocalUrl?: boolean | undefined;
}): ConnectorReachabilityDiagnosis {
  const networkKind = connectorNetworkKind(input.daemonUrl);
  const normalizedError = normalizeError(input.error);

  if (input.status === 401) {
    return diagnosis({
      kind: "token-rejected",
      networkKind,
      severity: "error",
      summary: "daemon rejected the saved token",
      detail: "The server reached the connector, but authentication failed.",
      hint: "Re-register this PC so the server stores the current connector token.",
      retrySafe: true,
    });
  }

  if (input.status && input.status >= 400) {
    return diagnosis({
      kind: "http-error",
      networkKind,
      severity: "error",
      summary: `connector returned HTTP ${input.status}`,
      detail: input.error ?? `Unexpected connector response from ${input.daemonUrl}.`,
      hint: "Restart the connector. If the response stays the same, update and re-register this PC.",
      retrySafe: true,
    });
  }

  if (networkKind === "local" && !input.allowLocalUrl) {
    return diagnosis({
      kind: "local-only-url",
      networkKind,
      severity: "error",
      summary: "connector URL is local-only",
      detail:
        "A localhost connector URL only works when the browser server and connector are on the same PC.",
      hint: "Localhost cannot identify another PC. Register the PC with its Tailscale or LAN address.",
      retrySafe: true,
    });
  }

  if (networkKind === "local" && input.error) {
    return diagnosis({
      kind: "daemon-not-listening",
      networkKind,
      severity: "error",
      summary: "local connector is not responding",
      detail: input.error,
      hint: "Start or restart the connector daemon on this PC, then retry.",
      retrySafe: true,
    });
  }

  if (isRefused(normalizedError)) {
    return diagnosis({
      kind: "daemon-not-listening",
      networkKind,
      severity: "error",
      summary: "connector port is not accepting connections",
      detail: input.error ?? "The server reached the host, but the connector port refused the request.",
      hint: "Start or restart the connector daemon on that PC, then retry.",
      retrySafe: true,
    });
  }

  if (isTimeout(normalizedError)) {
    if (networkKind === "tailscale") {
      return diagnosis({
        kind: "tailscale-route-or-firewall",
        networkKind,
        severity: "error",
        summary: "Tailscale path timed out",
        detail:
          input.error ??
          "The server could not reach the connector through the Tailscale address before timeout.",
        hint:
          "Check that both PCs are in the same tailnet, Tailscale incoming connections are allowed, and Windows Firewall allows the connector port.",
        retrySafe: true,
      });
    }
    if (networkKind === "lan") {
      return diagnosis({
        kind: "lan-route-or-firewall",
        networkKind,
        severity: "error",
        summary: "LAN/VPN path timed out",
        detail:
          input.error ??
          "The server could not reach the connector through the LAN/VPN address before timeout.",
        hint:
          "Check that both PCs are on the same LAN/VPN and Windows Firewall allows the connector port.",
        retrySafe: true,
      });
    }
    if (networkKind === "public") {
      return diagnosis({
        kind: "public-route-or-firewall",
        networkKind,
        severity: "error",
        summary: "public connector route timed out",
        detail:
          input.error ??
          "The server could not reach a public-looking connector address before timeout.",
        hint: "Avoid public connector exposure. Prefer Tailscale or LAN, then re-register.",
        retrySafe: true,
      });
    }
  }

  if (input.error) {
    return diagnosis({
      kind: "route-or-firewall",
      networkKind,
      severity: "error",
      summary: "connector is unreachable",
      detail: input.error,
      hint: hintForNetworkKind(networkKind),
      retrySafe: true,
    });
  }

  return diagnosis({
    kind: "unknown",
    networkKind,
    severity: "unknown",
    summary: "connector reachability was not classified",
    detail: `Registered connector URL: ${input.daemonUrl}`,
    hint: hintForNetworkKind(networkKind),
    retrySafe: true,
    userVisible: false,
  });
}

export function connectorNetworkKind(rawUrl: string): ManagerNetworkKind {
  try {
    const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
    return networkKindForHost(host);
  } catch {
    return "unknown";
  }
}

export function networkKindForHost(host: string): ManagerNetworkKind {
  const value = host.toLowerCase();
  if (value === "localhost" || value === "127.0.0.1" || value === "::1") return "local";
  if (value.startsWith("100.") || value.endsWith(".ts.net")) return "tailscale";
  if (
    value.startsWith("10.") ||
    value.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
  ) {
    return "lan";
  }
  return value ? "public" : "unknown";
}

export function hintForNetworkKind(kind: ManagerNetworkKind): string {
  if (kind === "tailscale") {
    return "Check Tailscale on both PCs, incoming Tailscale policy, and Windows Firewall for the connector port.";
  }
  if (kind === "lan") {
    return "Check that both PCs are on the same LAN/VPN and Windows Firewall allows the connector port.";
  }
  if (kind === "local") {
    return "Localhost connector URLs only work from the same PC as the server.";
  }
  if (kind === "public") {
    return "Avoid public connector exposure; prefer Tailscale or LAN and check inbound firewall policy.";
  }
  return "Check the connector URL, network route, and inbound firewall policy.";
}

function diagnosis(
  input: Omit<ConnectorReachabilityDiagnosis, "userVisible"> & {
    userVisible?: boolean | undefined;
  },
): ConnectorReachabilityDiagnosis {
  return {
    ...input,
    userVisible: input.userVisible ?? (input.severity === "error" || input.severity === "warn"),
  };
}

function normalizeError(value: string | undefined): string {
  return (value ?? "").toLowerCase();
}

function isTimeout(error: string): boolean {
  return /timeout|timed out|aborted|abort|etimedout|operation timed out/.test(error);
}

function isRefused(error: string): boolean {
  return /econnrefused|connection refused|actively refused|refused/.test(error);
}
