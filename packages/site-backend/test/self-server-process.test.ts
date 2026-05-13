import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPowerShellSelfServerProcessController } from "../src/self-server-process.ts";

const originalConnectorPort = process.env.CR_CONNECTOR_PORT;
const originalSitePort = process.env.CR_SITE_PORT;
const originalFrontendUrl = process.env.CR_DEV_FRONTEND_URL;

afterEach(() => {
  restoreEnv("CR_CONNECTOR_PORT", originalConnectorPort);
  restoreEnv("CR_SITE_PORT", originalSitePort);
  restoreEnv("CR_DEV_FRONTEND_URL", originalFrontendUrl);
});

describe("self server process status", () => {
  test("marks stale component pids instead of reporting them as healthy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deskrelay-process-status-"));
    try {
      const processFile = join(dir, "dev-processes.json");
      process.env.CR_CONNECTOR_PORT = "65530";
      writeFileSync(
        processFile,
        `\uFEFF${JSON.stringify([{ name: "daemon", pid: 999999, log: join(dir, "daemon.log") }])}`,
        "utf8",
      );

      const controller = createPowerShellSelfServerProcessController({
        repoRoot: process.cwd(),
        root: dir,
        processFile,
      });
      const status = await controller.status();

      expect(status.components).toHaveLength(1);
      expect(status.components?.[0]?.name).toBe("daemon");
      expect(status.components?.[0]?.alive).toBe(false);
      expect(status.components?.[0]?.detail).toBe("recorded pid is not running");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports when a live component also has a reachable local listener", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deskrelay-process-status-listener-"));
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("ok"),
    });
    try {
      const processFile = join(dir, "dev-processes.json");
      process.env.CR_SITE_PORT = String(server.port);
      writeFileSync(
        processFile,
        JSON.stringify([{ name: "site-backend", pid: process.pid, log: join(dir, "site.log") }]),
        "utf8",
      );

      const controller = createPowerShellSelfServerProcessController({
        repoRoot: process.cwd(),
        root: dir,
        processFile,
      });
      const status = await controller.status();

      expect(status.components?.[0]?.alive).toBe(true);
      expect(status.components?.[0]?.detail).toContain(`127.0.0.1:${server.port}`);
      expect(status.components?.[0]?.detail).toContain("reachable");
    } finally {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
