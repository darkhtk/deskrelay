// M1.3 — full integration: spawn the daemon binary, drive it through the
// CLI binary, verify the round-trip works end-to-end through real
// processes, real HTTP, real subprocess IPC.
//
// This is the "no fakes" test: if anything in the daemon stdio handling,
// the HTTP API, the CliClient transport, the CLI dispatcher, or the
// behavior-sdk subprocess wiring breaks, this test fails.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStateFile } from "@claude-remote/pc-connector-daemon";
import { type Subprocess, spawn } from "bun";

const ROOT = join(import.meta.dir, "..", "..", "..");
const DAEMON_BIN = join(ROOT, "packages", "pc-connector-daemon", "src", "bin.ts");
const CLI_BIN = join(ROOT, "packages", "pc-connector-cli", "src", "bin.ts");
const ECHO_PKG = join(ROOT, "packages", "behaviors", "echo");

let stateDir: string;
let stateFile: string;
let authFile: string;

interface RunningDaemon {
  proc: Subprocess<"ignore", "pipe", "pipe">;
  baseUrl: string;
}

let daemon: RunningDaemon | undefined;

async function startDaemon(): Promise<RunningDaemon> {
  // Pick a random ephemeral port to avoid collisions across test runs.
  const port = 18100 + Math.floor(Math.random() * 800);
  const proc = spawn({
    cmd: [process.execPath, "run", DAEMON_BIN],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CR_CONNECTOR_PORT: String(port),
      CR_CONNECTOR_HOST: "127.0.0.1",
      // Isolate state file per test run so concurrent runs don't collide.
      CR_CONNECTOR_STATE_FILE: stateFile,
      // Same isolation for the per-machine auth token. Without this,
      // every parallel test run would share ~/.local/state/.../auth.json
      // and could race on first-write.
      CR_CONNECTOR_AUTH_FILE: authFile,
      // The integration tests assert the registry shape, so don't
      // auto-load remote-claude here.
      CR_CONNECTOR_DISABLE_AUTOLOAD: "1",
    },
  });

  // Wait for "listening" line on stdout.
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), 500),
      ),
    ]);
    if (done) break;
    if (value) buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("listening")) break;
  }
  reader.releaseLock();
  if (!buffer.includes("listening")) {
    proc.kill();
    throw new Error(`daemon did not start. stdout so far: ${buffer}`);
  }
  return { proc, baseUrl: `http://127.0.0.1:${port}` };
}

async function runCli(
  args: string[],
  baseUrl: string | undefined,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const fullArgs =
    baseUrl !== undefined
      ? [process.execPath, "run", CLI_BIN, "--base-url", baseUrl, ...args]
      : [process.execPath, "run", CLI_BIN, ...args];
  const proc = spawn({
    cmd: fullArgs,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Make sure CLI auto-discovery uses the same isolated state file
      // and the same auth-token file the daemon wrote.
      CR_CONNECTOR_STATE_FILE: stateFile,
      CR_CONNECTOR_AUTH_FILE: authFile,
      // Don't accidentally inherit a CR_CONNECTOR_URL from outer shell.
      CR_CONNECTOR_URL: "",
    },
  });
  const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdoutBytes, stderr: stderrBytes, exitCode };
}

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "cr-conn-int-"));
  stateFile = join(stateDir, "daemon.json");
  authFile = join(stateDir, "auth.json");
  daemon = await startDaemon();
});

afterEach(async () => {
  if (daemon) {
    daemon.proc.kill();
    await daemon.proc.exited.catch(() => undefined);
    daemon = undefined;
  }
  await rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
});

function ensureDaemon(): RunningDaemon {
  if (!daemon) throw new Error("daemon not running (beforeEach failed)");
  return daemon;
}

describe("M1.3 daemon ↔ CLI ↔ echo round-trip (real processes)", () => {
  test("status after empty start", async () => {
    const r = await runCli(["status", "--json"], ensureDaemon().baseUrl);
    expect(r.exitCode).toBe(0);
    const status = JSON.parse(r.stdout);
    expect(status.ok).toBe(true);
    expect(status.behaviors).toEqual([]);
  });

  test("load echo via CLI, list via CLI, call via CLI", async () => {
    const url = ensureDaemon().baseUrl;
    const load = await runCli(["behaviors", "load", ECHO_PKG, "--instance", "e2e", "--json"], url);
    expect(load.exitCode).toBe(0);
    expect(JSON.parse(load.stdout).instanceId).toBe("e2e");

    const list = await runCli(["behaviors", "list", "--json"], url);
    expect(list.exitCode).toBe(0);
    const arr = JSON.parse(list.stdout);
    expect(arr).toHaveLength(1);
    expect(arr[0].instanceId).toBe("e2e");
    expect(arr[0].name).toBe("echo");

    const call = await runCli(
      ["behaviors", "call", "e2e", "echo", '{"message":"integration"}', "--json"],
      url,
    );
    expect(call.exitCode).toBe(0);
    expect(JSON.parse(call.stdout).result).toEqual({ ok: true, length: 11 });
  });

  test("error from behavior surfaces as structured error blob in JSON mode", async () => {
    const url = ensureDaemon().baseUrl;
    await runCli(["behaviors", "load", ECHO_PKG, "--instance", "boom", "--json"], url);
    const r = await runCli(["behaviors", "call", "boom", "explode", "--json"], url);
    // --json keeps exit 0 so caller can read the error blob.
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.error.code).toBe(-32000);
    expect(out.error.message).toMatch(/intentional failure/);
  });

  test("CLI exits non-zero when daemon is unreachable", async () => {
    const r = await runCli(["status"], "http://127.0.0.1:1");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/cannot reach daemon/);
  });

  test("unknown command exits 2 from real CLI", async () => {
    const r = await runCli(["bogus"], ensureDaemon().baseUrl);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/unknown command/);
  });

  test("daemon writes state file with host/port/pid", async () => {
    const d = ensureDaemon();
    const state = await readStateFile(stateFile);
    expect(state).toBeDefined();
    expect(state?.host).toBe("127.0.0.1");
    expect(state?.port).toBe(Number(d.baseUrl.split(":").pop()));
    expect(state?.pid).toBe(d.proc.pid);
  });

  test("CLI auto-discovers daemon from state file (no --base-url, no env)", async () => {
    ensureDaemon();
    const r = await runCli(["status", "--json"], undefined);
    expect(r.exitCode).toBe(0);
    const status = JSON.parse(r.stdout);
    expect(status.ok).toBe(true);
  });
});
