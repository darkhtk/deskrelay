import { render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Landing } from "../src/components/Landing.tsx";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/healthz")) {
      return Response.json({ ok: true, version: "0.0.0", devices: 0 });
    }
    if (url.endsWith("/__deskrelay/local-site-token")) {
      return Response.json({ token: "site-token" });
    }
    if (url.endsWith("/__deskrelay/client-context")) {
      return Response.json({ address: "127.0.0.1", isLocal: true });
    }
    if (url.endsWith("/api/devices")) {
      return Response.json([]);
    }
    if (url.endsWith("/api/self/register-other-pc-command")) {
      return Response.json({
        preferredUrl: "http://100.64.1.2:18193",
        serverPort: 18193,
        connectorPort: 18091,
        siteToken: "site-token",
        urls: [],
        command: "register command",
      });
    }
    if (url.endsWith("/api/self/remove-other-pc-command")) {
      return Response.json({
        preferredUrl: "http://100.64.1.2:18193",
        serverPort: 18193,
        connectorPort: 18091,
        siteToken: "site-token",
        urls: [],
        command:
          "$remover = Join-Path $env:TEMP 'deskrelay-remove-connector.ps1'\npowershell -ExecutionPolicy Bypass -File $remover -Server 'http://100.64.1.2:18193' -SiteToken 'site-token' -Port 18091",
      });
    }
    return Response.json({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Landing manual cleanup notice", () => {
  test("shows a removal command when automatic connector cleanup did not confirm", async () => {
    const { container } = render(() => (
      <Landing
        authed
        onTokenLogin={vi.fn()}
        manualCleanupNotice={{ count: 1, labels: ["Office PC"] }}
      />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("수동 제거 필요");
      expect(container.textContent).toContain("Office PC");
      expect(container.textContent).toContain("powershell -ExecutionPolicy Bypass");
      expect(container.textContent).toContain("deskrelay-remove-connector.ps1");
    });
  });
});
