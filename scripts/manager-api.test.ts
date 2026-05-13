import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./manager-api.ts", import.meta.url));
let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

async function runManagerApi(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, "run", scriptPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("manager-api helper", () => {
  test("passes the site token and returns JSON", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        return Response.json({
          path: new URL(req.url).pathname,
          authorization: req.headers.get("authorization"),
        });
      },
    });

    const result = await runManagerApi(["GET", "/api/manager/system/summary"], {
      DESKRELAY_MANAGER_API_BASE: server.url.origin,
      DESKRELAY_SITE_TOKEN: "test-token",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const body = JSON.parse(result.stdout) as {
      ok?: boolean;
      data?: { path?: string; authorization?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.path).toBe("/api/manager/system/summary");
    expect(body.data?.authorization).toBe("Bearer test-token");
  });

  test("batch preserves individual failures without failing the whole command", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/fail") return Response.json({ error: "boom" }, { status: 500 });
        return Response.json({ path });
      },
    });
    const batchPath = `${import.meta.dir}/manager-api-batch-${Date.now()}.json`;
    await Bun.write(
      batchPath,
      JSON.stringify([
        { id: "ok", method: "GET", path: "/ok" },
        { id: "fail", method: "GET", path: "/fail" },
      ]),
    );
    try {
      const result = await runManagerApi(["batch", "--file", batchPath], {
        DESKRELAY_MANAGER_API_BASE: server.url.origin,
      });

      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout) as {
        ok?: boolean;
        results?: Array<{ id?: string; ok?: boolean; status?: number; error?: string }>;
      };
      expect(body.ok).toBe(false);
      expect(body.results).toHaveLength(2);
      expect(body.results?.find((entry) => entry.id === "ok")?.ok).toBe(true);
      expect(body.results?.find((entry) => entry.id === "fail")).toMatchObject({
        ok: false,
        status: 500,
        error: "HTTP 500",
      });
    } finally {
      await rm(batchPath, { force: true }).catch(() => undefined);
    }
  });
});
