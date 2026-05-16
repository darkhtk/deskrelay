import { describe, expect, test } from "bun:test";
import {
  connectorNetworkKind,
  diagnoseConnectorReachability,
  hintForNetworkKind,
} from "../src/connector-diagnosis.ts";

describe("connector reachability diagnosis", () => {
  test("classifies registered connector URL network kinds", () => {
    expect(connectorNetworkKind("http://127.0.0.1:18091")).toBe("local");
    expect(connectorNetworkKind("http://100.64.0.5:18091")).toBe("tailscale");
    expect(connectorNetworkKind("http://192.168.0.5:18091")).toBe("lan");
    expect(connectorNetworkKind("http://203.0.113.5:18091")).toBe("public");
    expect(connectorNetworkKind("not a url")).toBe("unknown");
  });

  test("separates token rejection from route failures", () => {
    const result = diagnoseConnectorReachability({
      daemonUrl: "http://100.64.0.5:18091",
      status: 401,
    });
    expect(result.kind).toBe("token-rejected");
    expect(result.summary).toContain("token");
    expect(result.retrySafe).toBe(true);
  });

  test("classifies Tailscale timeout as route or firewall", () => {
    const result = diagnoseConnectorReachability({
      daemonUrl: "http://100.64.0.5:18091",
      error: "The operation timed out.",
    });
    expect(result.kind).toBe("tailscale-route-or-firewall");
    expect(result.hint).toContain("Tailscale");
    expect(result.userVisible).toBe(true);
  });

  test("keeps localhost registration failure distinct", () => {
    const result = diagnoseConnectorReachability({
      daemonUrl: "http://127.0.0.1:18091",
      error: "fetch failed",
    });
    expect(result.kind).toBe("local-only-url");
    expect(result.hint).toContain("Localhost");
  });

  test("provides network-kind-specific hints", () => {
    expect(hintForNetworkKind("lan")).toContain("same LAN");
    expect(hintForNetworkKind("public")).toContain("Avoid public");
  });
});
