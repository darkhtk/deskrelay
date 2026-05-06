// Drives the pretooluse hook script as a subprocess. Exercises the
// fail-policy matrix end-to-end without spinning up a real daemon —
// we can verify all three security profiles by setting CR_DAEMON_URL
// to an unreachable address.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawn } from "bun";

const HOOK = join(import.meta.dir, "..", "src", "hooks", "pretooluse.ts");
const PAYLOAD = JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } });

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runHook(env: Record<string, string>): Promise<RunResult> {
  const proc = spawn({
    cmd: [process.execPath, "run", HOOK],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  proc.stdin.write(PAYLOAD);
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

// 127.0.0.1:1 — well-known reserved port, OS rejects with ECONNREFUSED
// fast. We also pass CR_PRETOOLUSE_TIMEOUT_MS so even if Bun's fetch
// stalls on Windows the hook bails out within the test budget.
const UNREACHABLE_URL = "http://127.0.0.1:1";
const HOOK_TIMEOUT_MS = "1000";

// (Per-test timeout was previously a 3rd describe() arg — bun:test doesn't
// accept that signature. The fail-policy hits return well under 1 second
// thanks to CR_PRETOOLUSE_TIMEOUT_MS, so the default test budget is fine.)

describe("pretooluse fail-policy", () => {
  test("relaxed (default) on unreachable daemon → continue:true exit 0", async () => {
    const r = await runHook({
      CR_DAEMON_URL: UNREACHABLE_URL,
      CR_PRETOOLUSE_TIMEOUT_MS: HOOK_TIMEOUT_MS,
    });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { continue: boolean };
    expect(parsed.continue).toBe(true);
  });

  test("relaxed (explicit) on unreachable daemon → continue:true exit 0", async () => {
    const r = await runHook({
      CR_DAEMON_URL: UNREACHABLE_URL,
      CR_PRETOOLUSE_FAIL_POLICY: "relaxed",
      CR_PRETOOLUSE_TIMEOUT_MS: HOOK_TIMEOUT_MS,
    });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { continue: boolean };
    expect(parsed.continue).toBe(true);
  });

  test("normal on unreachable daemon → continue:false exit 2", async () => {
    const r = await runHook({
      CR_DAEMON_URL: UNREACHABLE_URL,
      CR_PRETOOLUSE_FAIL_POLICY: "normal",
      CR_PRETOOLUSE_TIMEOUT_MS: HOOK_TIMEOUT_MS,
    });
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout) as { continue: boolean; decision?: string };
    expect(parsed.continue).toBe(false);
    expect(parsed.decision).toBe("block");
  });

  test("strict on unreachable daemon → continue:false exit 2", async () => {
    const r = await runHook({
      CR_DAEMON_URL: UNREACHABLE_URL,
      CR_PRETOOLUSE_FAIL_POLICY: "strict",
      CR_PRETOOLUSE_TIMEOUT_MS: HOOK_TIMEOUT_MS,
    });
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout) as { continue: boolean; decision?: string };
    expect(parsed.continue).toBe(false);
    expect(parsed.decision).toBe("block");
  });

  test("CR_DAEMON_URL unset + relaxed → fall-through allow", async () => {
    const r = await runHook({ CR_DAEMON_URL: "", CR_PRETOOLUSE_FAIL_POLICY: "relaxed" });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { continue: boolean };
    expect(parsed.continue).toBe(true);
  });

  test("CR_DAEMON_URL unset + normal → block", async () => {
    const r = await runHook({ CR_DAEMON_URL: "", CR_PRETOOLUSE_FAIL_POLICY: "normal" });
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout) as { continue: boolean; decision?: string };
    expect(parsed.continue).toBe(false);
    expect(parsed.decision).toBe("block");
  });
});
