import { describe, expect, test } from "bun:test";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { runCli } from "../src/cli.ts";
import type { CliClient } from "../src/client.ts";

interface Capture {
  out: string;
  err: string;
  exitCode: number;
}

function makeFakeClient(overrides: Record<string, unknown> = {}): CliClient {
  const stub = {
    status: async () => ({
      ok: true,
      startedAt: "2026-04-27T00:00:00Z",
      listening: { host: "127.0.0.1", port: 18091 },
      behaviors: [
        { instanceId: "echo", name: "echo", version: "0.0.1", loadedAt: "2026-04-27T00:00:00Z" },
      ],
      brokerStats: { spaces: 1, subscribers: 0, bufferedEvents: 0 },
    }),
    listBehaviors: async () => [
      { instanceId: "echo", name: "echo", version: "0.0.1", loadedAt: "2026-04-27T00:00:00Z" },
    ],
    loadBehavior: async (_dir: string, instanceId?: string) => ({
      instanceId: instanceId ?? "echo",
      loadedAt: "2026-04-27T00:00:00Z",
    }),
    unloadBehavior: async () => ({ ok: true as const }),
    requestBehavior: async (_id: string, _method: string) => ({ result: { ok: true } }),
    streamEvents: async function* () {
      yield { kind: "echoed", content: { message: "hi" } };
    },
    ...overrides,
  };
  return stub as unknown as CliClient;
}

async function run(argv: string[], client: CliClient = makeFakeClient()): Promise<Capture> {
  let out = "";
  let err = "";
  const r = await runCli(argv, {
    client,
    stdout: (line) => {
      out += line;
    },
    stderr: (line) => {
      err += line;
    },
  });
  return { out, err, exitCode: r.exitCode };
}

describe("runCli — top-level", () => {
  test("--help prints usage and exits 0", async () => {
    const c = await run(["--help"]);
    expect(c.exitCode).toBe(0);
    expect(c.out).toMatch(/Usage:/);
  });

  test("no command emits error + usage with exit 2", async () => {
    const c = await run([]);
    expect(c.exitCode).toBe(2);
    expect(c.err).toMatch(/command required/);
  });

  test("unknown command exits 2", async () => {
    const c = await run(["bogus"]);
    expect(c.exitCode).toBe(2);
    expect(c.err).toMatch(/unknown command/);
  });

  test("--base-url is silently consumed (handled by bin)", async () => {
    const c = await run(["--base-url", "http://example", "status"]);
    expect(c.exitCode).toBe(0);
  });
});

describe("status command", () => {
  test("human output mentions broker + behaviors", async () => {
    const c = await run(["status"]);
    expect(c.exitCode).toBe(0);
    expect(c.out).toMatch(/daemon ok=true/);
    expect(c.out).toMatch(/echo@0\.0\.1/);
  });

  test("--json emits the raw status object", async () => {
    const c = await run(["status", "--json"]);
    expect(c.exitCode).toBe(0);
    const parsed = JSON.parse(c.out);
    expect(parsed.ok).toBe(true);
  });
});

describe("behaviors subcommands", () => {
  test("list (human) shows instanceId tab name@version", async () => {
    const c = await run(["behaviors", "list"]);
    expect(c.exitCode).toBe(0);
    expect(c.out).toMatch(/echo\techo@0\.0\.1/);
  });

  test("list with no behaviors shows placeholder", async () => {
    const client = makeFakeClient({ listBehaviors: async () => [] });
    const c = await run(["behaviors", "list"], client);
    expect(c.out).toMatch(/no behaviors loaded/);
  });

  test("load requires packageDir", async () => {
    const c = await run(["behaviors", "load"]);
    expect(c.exitCode).toBe(2);
    expect(c.err).toMatch(/packageDir/);
  });

  test("load with --instance forwards the id", async () => {
    const seen: { dir?: string; id?: string } = {};
    const client = makeFakeClient({
      loadBehavior: async (dir: string, id?: string) => {
        seen.dir = dir;
        if (id !== undefined) seen.id = id;
        return { instanceId: id ?? "echo", loadedAt: "x" };
      },
    });
    const c = await run(["behaviors", "load", "/some/dir", "--instance", "alpha"], client);
    expect(c.exitCode).toBe(0);
    expect(seen).toEqual({ dir: "/some/dir", id: "alpha" });
  });

  test("call with valid JSON params", async () => {
    const seen: { method?: string; params?: unknown } = {};
    const client = makeFakeClient({
      requestBehavior: async (_id: string, method: string, params?: unknown) => {
        seen.method = method;
        seen.params = params;
        return { result: { ok: true } };
      },
    });
    const c = await run(["behaviors", "call", "echo", "echo", '{"message":"hi"}'], client);
    expect(c.exitCode).toBe(0);
    expect(seen).toEqual({ method: "echo", params: { message: "hi" } });
  });

  test("call with invalid JSON params exits 2", async () => {
    const c = await run(["behaviors", "call", "echo", "echo", "{bad"]);
    expect(c.exitCode).toBe(2);
    expect(c.err).toMatch(/invalid JSON params/);
  });

  test("call missing arguments exits 2", async () => {
    const c = await run(["behaviors", "call", "echo"]);
    expect(c.exitCode).toBe(2);
  });

  test("call surfaces behavior error as exit 1", async () => {
    const client = makeFakeClient({
      requestBehavior: async () => ({
        error: { code: -32000, message: "boom" },
      }),
    });
    const c = await run(["behaviors", "call", "echo", "explode"], client);
    expect(c.exitCode).toBe(1);
    expect(c.err).toMatch(/code=-32000/);
  });

  test("unload requires instanceId", async () => {
    const c = await run(["behaviors", "unload"]);
    expect(c.exitCode).toBe(2);
  });

  test("unload (human) confirms", async () => {
    const c = await run(["behaviors", "unload", "echo"]);
    expect(c.exitCode).toBe(0);
    expect(c.out).toMatch(/unloaded echo/);
  });
});

describe("unpair command", () => {
  // The CLI delegates to removeDeviceIdentity from the daemon package,
  // which honors CR_IDENTITY_DIR. Pointing it at a tmpdir lets us drive
  // the real implementation deterministically.
  function withFreshIdentityDir(): string {
    const { mkdtempSync } = nodeFs;
    const dir = mkdtempSync(nodePath.join(nodeOs.tmpdir(), "cr-cli-unpair-"));
    process.env.CR_IDENTITY_DIR = dir;
    return dir;
  }

  test("help mentions unpair as a top-level command", async () => {
    const c = await run(["--help"]);
    expect(c.out).toMatch(/unpair\s+forget local pairing/);
  });

  test("unpair on a never-paired host reports already-unpaired (idempotent)", async () => {
    withFreshIdentityDir();
    const c = await run(["unpair"]);
    expect(c.exitCode).toBe(0);
    expect(c.out).toMatch(/already unpaired/);
  });

  test("unpair removes identity.json + key file and reports both as cleaned", async () => {
    const dir = withFreshIdentityDir();
    nodeFs.mkdirSync(nodePath.join(dir, "keys"), { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(dir, "identity.json"),
      JSON.stringify({
        deviceId: "dev_e2e",
        siteUrl: "https://site.example",
        publicKey: "pk",
        keyHandle: "kh-e2e",
        pairedAt: "2026-04-30T00:00:00Z",
      }),
    );
    nodeFs.writeFileSync(nodePath.join(dir, "keys", "kh-e2e.bin"), Buffer.from([1, 2, 3]));

    const c = await run(["unpair"]);
    expect(c.exitCode).toBe(0);
    expect(c.out).toMatch(/unpaired locally/);
    expect(c.out).toMatch(/identity.json removed: yes/);
    expect(c.out).toMatch(/private key removed: yes/);
    // Files actually gone — not just a happy print.
    expect(nodeFs.existsSync(nodePath.join(dir, "identity.json"))).toBe(false);
    expect(nodeFs.existsSync(nodePath.join(dir, "keys", "kh-e2e.bin"))).toBe(false);
  });

  test("--json mode emits the structured RemoveDeviceIdentityResult", async () => {
    withFreshIdentityDir();
    const c = await run(["--json", "unpair"]);
    expect(c.exitCode).toBe(0);
    const parsed = JSON.parse(c.out.trim());
    expect(parsed).toEqual({ identityRemoved: false, keyRemoved: false });
  });
});

describe("events tail", () => {
  test("emits NDJSON for each event from the stream", async () => {
    const c = await run(["events", "tail", "echo.default:echo"]);
    expect(c.exitCode).toBe(0);
    const lines = c.out.trim().split("\n");
    expect(lines).toHaveLength(1);
    const first = lines[0];
    if (!first) throw new Error("unreachable");
    expect(JSON.parse(first).kind).toBe("echoed");
  });

  test("requires spaceId", async () => {
    const c = await run(["events", "tail"]);
    expect(c.exitCode).toBe(2);
  });
});
