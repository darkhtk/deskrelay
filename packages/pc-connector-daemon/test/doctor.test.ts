// doctor.test.ts — drives runDoctor with synthetic identity files +
// fake fetch so each branch of the diagnosis is covered without
// actually pinging a real site or daemon.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CheckResult, formatDoctorOutput, runDoctor } from "../src/doctor.ts";

let stateDir: string;
let identityPath: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "cr-doctor-"));
  await mkdir(join(stateDir, "identity"), { recursive: true });
  identityPath = join(stateDir, "identity", "identity.json");
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

interface Probe {
  url: string;
  status: number;
}

function fakeFetch(probes: Probe[]) {
  return async (input: string | URL) => {
    const url = String(input);
    const hit = probes.find((p) => url.startsWith(p.url));
    if (!hit) return { status: 0 };
    return { status: hit.status };
  };
}

async function writeIdentity(overrides: Partial<{
  deviceId: string;
  siteUrl: string;
  publicKey: string;
  keyHandle: string;
  pairedAt: string;
  label: string;
  os: string;
  hostname: string;
  connectionToken: string;
}> = {}) {
  await writeFile(
    identityPath,
    JSON.stringify({
      deviceId: "dev_TEST_xyz",
      siteUrl: "https://site.test",
      publicKey: "pub",
      keyHandle: "kh",
      pairedAt: "2026-05-01T00:00:00Z",
      label: "homedev (linux)",
      os: "linux",
      hostname: "homedev",
      connectionToken: "tok-abc",
      ...overrides,
    }),
    "utf8",
  );
}

function find(results: CheckResult[], id: string): CheckResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`expected check ${id}, got [${results.map((x) => x.id).join(", ")}]`);
  return r;
}

describe("runDoctor — happy path", () => {
  test("identity + auth + login-task + daemon + site + device-recognized → all OK", async () => {
    await writeIdentity();
    await writeFile(join(stateDir, "auth.json"), JSON.stringify({ token: "x".repeat(64) }));
    const results = await runDoctor({
      stateDir,
      identityPath,
      platform: "linux",
      fetchImpl: fakeFetch([
        { url: "http://127.0.0.1:18091/healthz", status: 200 },
        { url: "https://site.test/healthz", status: 200 },
        { url: "https://site.test/api/connector/ws", status: 101 },
      ]),
    });
    expect(find(results, "identity").status).toBe("ok");
    expect(find(results, "auth-token").status).toBe("ok");
    // login-task is skipped on non-Windows.
    expect(find(results, "login-task").status).toBe("skip");
    expect(find(results, "daemon-local").status).toBe("ok");
    expect(find(results, "site-reachable").status).toBe("ok");
    expect(find(results, "site-recognizes-device").status).toBe("ok");
    expect(results.some((r) => r.status === "error")).toBe(false);
  });
});

describe("runDoctor — pairing fault diagnostics", () => {
  test("missing identity short-circuits with a re-pair hint", async () => {
    // Don't write identity.json.
    const results = await runDoctor({
      stateDir,
      identityPath,
      platform: "linux",
      fetchImpl: fakeFetch([]),
    });
    expect(results).toHaveLength(1);
    const id = find(results, "identity");
    expect(id.status).toBe("error");
    expect(id.hint).toMatch(/cr-connector pair/);
  });

  test("identity present but connectionToken missing → warn, hint to re-pair", async () => {
    await writeIdentity({ connectionToken: "" });
    const results = await runDoctor({
      stateDir,
      identityPath,
      platform: "linux",
      fetchImpl: fakeFetch([]),
    });
    const id = find(results, "identity");
    expect(id.status).toBe("warn");
    expect(id.hint).toMatch(/connectionToken|re-pair/i);
  });

  test("site returns 404 for the device → error with stale-pairing hint", async () => {
    await writeIdentity();
    const results = await runDoctor({
      stateDir,
      identityPath,
      platform: "linux",
      fetchImpl: fakeFetch([
        { url: "http://127.0.0.1:18091/healthz", status: 200 },
        { url: "https://site.test/healthz", status: 200 },
        { url: "https://site.test/api/connector/ws", status: 404 },
      ]),
    });
    const r = find(results, "site-recognizes-device");
    expect(r.status).toBe("error");
    expect(r.summary).toMatch(/404/);
    expect(r.hint).toMatch(/stale|re-pair/i);
  });

  test("site unreachable → error with network hint", async () => {
    await writeIdentity();
    const results = await runDoctor({
      stateDir,
      identityPath,
      platform: "linux",
      fetchImpl: fakeFetch([{ url: "http://127.0.0.1:18091/healthz", status: 200 }]),
    });
    const r = find(results, "site-reachable");
    expect(r.status).toBe("error");
    expect(r.hint).toMatch(/network|DNS|firewall/i);
  });

  test("daemon not listening → error suggesting how to start it", async () => {
    await writeIdentity();
    const results = await runDoctor({
      stateDir,
      identityPath,
      platform: "linux",
      fetchImpl: fakeFetch([
        // no daemon match — falls through to status=0
        { url: "https://site.test/healthz", status: 200 },
        { url: "https://site.test/api/connector/ws", status: 101 },
      ]),
    });
    const r = find(results, "daemon-local");
    expect(r.status).toBe("error");
    expect(r.hint).toMatch(/cr-connector|start the daemon/i);
  });
});

describe("formatDoctorOutput", () => {
  test("error count appears in the summary line", async () => {
    const out = formatDoctorOutput([
      { id: "x", label: "x", status: "ok", summary: "fine" },
      { id: "y", label: "y", status: "error", summary: "broken", hint: "fix it" },
    ]);
    expect(out).toMatch(/1 error\(s\) found/);
    expect(out).toMatch(/→ fix it/);
  });

  test("all-OK summary says everything's healthy", () => {
    const out = formatDoctorOutput([
      { id: "x", label: "x", status: "ok", summary: "fine" },
    ]);
    expect(out).toMatch(/everything looks healthy/);
  });
});
