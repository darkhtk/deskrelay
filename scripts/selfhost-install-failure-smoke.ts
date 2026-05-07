#!/usr/bin/env bun

import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerSelf } from "../packages/pc-connector-daemon/src/self-register.ts";

interface ManagedProcess {
  name: string;
  child: ChildProcess;
  logPath: string;
}

interface Harness {
  repoRoot: string;
  root: string;
  serverRoot: string;
  remoteRoot: string;
  siteToken: string;
  serverPort: number;
  frontendPort: number;
  serverDaemonPort: number;
  remoteDaemonPort: number;
  serverUrl: string;
  workspace: string;
  stateDir: string;
  authFile: string;
  stateFile: string;
  identityDir: string;
  processes: ManagedProcess[];
}

const keep = process.argv.includes("--keep");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harness: Harness = {
  repoRoot,
  root: await mkdtemp(join(tmpdir(), "deskrelay-install-failure-")),
  serverRoot: "",
  remoteRoot: "",
  siteToken: `failure-${crypto.randomUUID()}`,
  serverPort: await freePort(),
  frontendPort: await freePort(),
  serverDaemonPort: await freePort(),
  remoteDaemonPort: await freePort(),
  serverUrl: "",
  workspace: "",
  stateDir: "",
  authFile: "",
  stateFile: "",
  identityDir: "",
  processes: [],
};
harness.serverRoot = join(harness.root, "server");
harness.remoteRoot = join(harness.root, "remote");
harness.serverUrl = `http://127.0.0.1:${harness.serverPort}`;
harness.workspace = join(harness.root, "workspace");
harness.stateDir = join(harness.remoteRoot, "state");
harness.authFile = join(harness.stateDir, "auth.json");
harness.stateFile = join(harness.stateDir, "daemon.json");
harness.identityDir = join(harness.remoteRoot, "identity");

let failed = false;

try {
  await runSmoke(harness);
  await cleanup(harness, true);
  pass("self-host install failure smoke passed");
} catch (err) {
  failed = true;
  await cleanup(harness, false);
  fail((err as Error).stack ?? (err as Error).message);
  process.exitCode = 1;
} finally {
  if (failed || keep) {
    console.log(`logs: ${join(harness.root, "logs")}`);
    console.log(`root: ${harness.root}`);
  }
}

async function runSmoke(h: Harness): Promise<void> {
  step("script guard: local-only server URL");
  await expectPowerShellFailure(
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(h.repoRoot, "scripts", "install-connector.ps1"),
      "-Server",
      "http://127.0.0.1:18193",
      "-SiteToken",
      "dummy",
      "-Repo",
      join(h.root, "unused-repo"),
    ],
    "server URL is local-only",
  );
  pass("local-only copied URL is rejected before install");

  if (hasTailscaleIpv4()) {
    pass("tailscale-missing guard skipped because this runner already has a Tailscale IPv4");
  } else {
    step("script guard: tailscale URL without tailscale IP");
    await expectPowerShellFailure(
      [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(h.repoRoot, "scripts", "install-connector.ps1"),
        "-Server",
        "http://100.64.0.1:18193",
        "-SiteToken",
        "dummy",
        "-Repo",
        join(h.root, "unused-repo-2"),
      ],
      "has no Tailscale IPv4 address",
    );
    pass("tailscale URL fails clearly when target PC has no tailscale IP");
  }

  await setupServer(h);
  await setupRemoteState(h);

  step("server guard: unreachable daemon is not saved");
  const unreachable = await postDevice(h, {
    daemonUrl: `http://127.0.0.1:${await freePort()}`,
    label: "Unreachable",
    authToken: "wrong",
  });
  assert(
    unreachable.status === 502,
    `expected 502 for unreachable daemon, got ${unreachable.status}`,
  );
  await assertDeviceCount(h, 0);
  pass("unreachable daemon rejected without registry pollution");

  step("server guard: wrong daemon token is not saved");
  const daemon = startRemoteDaemon(h);
  await waitJson(`http://127.0.0.1:${h.remoteDaemonPort}/status`, {
    headers: { authorization: `Bearer ${await readDaemonToken(h)}` },
    timeoutMs: 20_000,
  });
  const wrongToken = await postDevice(h, {
    daemonUrl: `http://127.0.0.1:${h.remoteDaemonPort}`,
    label: "Wrong token",
    authToken: "not-the-daemon-token",
  });
  assert(wrongToken.status === 400, `expected 400 for wrong token, got ${wrongToken.status}`);
  await assertDeviceCount(h, 0);
  pass(`wrong daemon token rejected (${daemon.child.pid})`);

  step("register-self guard: server offline");
  await expectRegisterSelfFailure(
    h,
    {
      serverUrl: `http://127.0.0.1:${await freePort()}`,
      siteToken: h.siteToken,
      port: await freePort(),
      listenHost: "127.0.0.1",
      advertiseHost: "127.0.0.1",
      workspaceRoots: h.workspace,
      label: "Server offline",
    },
    "cannot reach DeskRelay server",
  );
  pass("register-self reports offline server");

  step("register-self guard: advertised endpoint unreachable");
  await expectRegisterSelfFailure(
    h,
    {
      serverUrl: h.serverUrl,
      siteToken: h.siteToken,
      port: await freePort(),
      listenHost: "127.0.0.1",
      advertiseHost: "192.0.2.55",
      workspaceRoots: h.workspace,
      label: "Unreachable advertised endpoint",
    },
    "cannot reach connector at",
  );
  await assertDeviceCount(h, 0);
  pass("bad advertised endpoint is rejected before server registration");

  step("workspace guard: outside root");
  const token = await readDaemonToken(h);
  const registered = await postDevice(h, {
    daemonUrl: `http://127.0.0.1:${h.remoteDaemonPort}`,
    label: "Good remote",
    authToken: token,
  });
  assert(registered.status === 201, `expected successful registration, got ${registered.status}`);
  const devices = await listDevices(h);
  const device = devices[0];
  assert(device, "device missing after successful registration");
  const outside = await fetch(
    `${h.serverUrl}/api/devices/${device.id}/fs/list?path=${encodeURIComponent(dirname(h.root))}`,
    { headers: authHeaders(h.siteToken), signal: AbortSignal.timeout(5_000) },
  );
  assert(outside.status === 403, `expected forbidden outside workspace, got ${outside.status}`);
  pass("workspace root escape is blocked");
}

async function setupServer(h: Harness): Promise<void> {
  step("setup: isolated server backend");
  await mkdir(h.workspace, { recursive: true });
  await runPowerShell([
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(h.repoRoot, "scripts", "nas-dev-init.ps1"),
    "-NasRoot",
    h.serverRoot,
    "-RepoRoot",
    h.repoRoot,
    "-SiteToken",
    h.siteToken,
    "-SitePort",
    String(h.serverPort),
    "-FrontendPort",
    String(h.frontendPort),
    "-DaemonPort",
    String(h.serverDaemonPort),
    "-SiteHost",
    "127.0.0.1",
    "-ConnectorHost",
    "127.0.0.1",
    "-FrontendUrlHost",
    "127.0.0.1",
    "-DaemonUrlHost",
    "127.0.0.1",
    "-WorkspaceRoots",
    join(h.root, "server-workspace"),
    "-Force",
  ]);
  startManaged(h, "site-backend", ["run", "packages/site-backend/src/bin.ts"], {
    CR_NAS_DEV_ROOT: h.serverRoot,
    CR_LOCAL_DEV: "1",
    CR_SITE_HOST: "127.0.0.1",
    CR_SITE_PORT: String(h.serverPort),
    CR_SITE_TOKEN: h.siteToken,
    CR_SITE_TOKEN_FILE: join(h.serverRoot, "site-token.txt"),
    CR_SITE_DEVICE_REGISTRY_FILE: join(h.serverRoot, "state", "site-devices.json"),
    CR_SITE_AUTH_OPTIONAL: "0",
    CR_SITE_USAGE_DISABLED: "1",
    CR_DEV_FRONTEND_URL: h.serverUrl,
    SITE_ANNOUNCEMENT_URL: "0",
  });
  await waitJson(`${h.serverUrl}/healthz`, { timeoutMs: 20_000 });
  pass("isolated server backend ready");
}

async function setupRemoteState(h: Harness): Promise<void> {
  await mkdir(h.stateDir, { recursive: true });
  await mkdir(h.identityDir, { recursive: true });
  await mkdir(h.workspace, { recursive: true });
  await writeFile(join(h.workspace, "workspace-marker.txt"), "ok\n", "utf8");
}

function startRemoteDaemon(h: Harness): ManagedProcess {
  return startManaged(h, "remote-daemon", ["run", "packages/pc-connector-daemon/src/bin.ts"], {
    CR_CONNECTOR_STATE_DIR: h.stateDir,
    CR_CONNECTOR_AUTH_FILE: h.authFile,
    CR_CONNECTOR_STATE_FILE: h.stateFile,
    CR_IDENTITY_DIR: h.identityDir,
    CR_CONNECTOR_HOST: "127.0.0.1",
    CR_CONNECTOR_PORT: String(h.remoteDaemonPort),
    CR_CONNECTOR_WORKSPACE_ROOTS: h.workspace,
  });
}

async function expectRegisterSelfFailure(
  h: Harness,
  options: Parameters<typeof registerSelf>[0],
  expected: string,
): Promise<void> {
  const snapshot = snapshotEnv([
    "CR_CONNECTOR_STATE_DIR",
    "CR_CONNECTOR_AUTH_FILE",
    "CR_CONNECTOR_STATE_FILE",
    "CR_IDENTITY_DIR",
  ]);
  Object.assign(process.env, {
    CR_CONNECTOR_STATE_DIR: join(h.root, `failure-state-${crypto.randomUUID()}`),
    CR_CONNECTOR_AUTH_FILE: join(h.root, `failure-auth-${crypto.randomUUID()}.json`),
    CR_CONNECTOR_STATE_FILE: join(h.root, `failure-daemon-${crypto.randomUUID()}.json`),
    CR_IDENTITY_DIR: join(h.root, `failure-identity-${crypto.randomUUID()}`),
  });
  try {
    await registerSelf({
      ...options,
      timeoutMs: 5_000,
      stopRecordedDaemon: async () => undefined,
      stopPortOwner: async () => false,
      installTask: async ({ launch }) => {
        const port = Number(launch.env.CR_CONNECTOR_PORT);
        startManaged(
          h,
          `failure-daemon-${port}`,
          ["run", "packages/pc-connector-daemon/src/bin.ts"],
          {
            ...launch.env,
            CR_CONNECTOR_STATE_DIR: process.env.CR_CONNECTOR_STATE_DIR,
            CR_CONNECTOR_AUTH_FILE: process.env.CR_CONNECTOR_AUTH_FILE,
            CR_CONNECTOR_STATE_FILE: process.env.CR_CONNECTOR_STATE_FILE,
            CR_IDENTITY_DIR: process.env.CR_IDENTITY_DIR,
          },
        );
        return { supported: true, taskName: "Virtual failure task", started: true };
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes(expected)) return;
    throw new Error(`expected failure containing "${expected}", got "${message}"`);
  } finally {
    restoreEnv(snapshot);
  }
  throw new Error(`expected registerSelf to fail with "${expected}"`);
}

async function expectPowerShellFailure(args: string[], expected: string): Promise<void> {
  const result = await runCommandCapture("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    ...args,
  ]);
  if (result.code === 0) {
    throw new Error("expected PowerShell command to fail, but it exited 0");
  }
  const combined = `${result.stdout}\n${result.stderr}`;
  if (!combined.includes(expected)) {
    throw new Error(`expected PowerShell failure containing "${expected}", got:\n${combined}`);
  }
}

async function postDevice(
  h: Harness,
  body: { daemonUrl: string; label: string; authToken: string },
): Promise<Response> {
  return await fetch(`${h.serverUrl}/api/devices`, {
    method: "POST",
    headers: { ...authHeaders(h.siteToken), "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function listDevices(h: Harness): Promise<Array<{ id: string; daemonUrl: string }>> {
  return await waitJson<Array<{ id: string; daemonUrl: string }>>(`${h.serverUrl}/api/devices`, {
    headers: authHeaders(h.siteToken),
  });
}

async function assertDeviceCount(h: Harness, count: number): Promise<void> {
  const devices = await listDevices(h);
  assert(devices.length === count, `expected ${count} devices, got ${devices.length}`);
}

async function readDaemonToken(h: Harness): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() <= deadline) {
    try {
      const parsed = JSON.parse(await Bun.file(h.authFile).text()) as { token?: unknown };
      if (typeof parsed.token === "string") return parsed.token;
    } catch {
      // wait
    }
    await sleep(200);
  }
  throw new Error(`daemon auth token was not written: ${h.authFile}`);
}

function startManaged(
  h: Harness,
  name: string,
  bunArgs: string[],
  extraEnv: Record<string, string | undefined>,
): ManagedProcess {
  const logsDir = join(h.root, "logs");
  const logPath = join(logsDir, `${name}.log`);
  if (!existsSync(logsDir)) mkdir(logsDir, { recursive: true }).catch(() => undefined);
  const out = createWriteStream(logPath, { flags: "a" });
  const child = spawn(process.execPath, bunArgs, {
    cwd: h.repoRoot,
    env: { ...process.env, ...extraEnv, SITE_ANNOUNCEMENT_URL: "0" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  child.on("exit", (code, signal) => {
    out.write(`\n[exit code=${code ?? ""} signal=${signal ?? ""}]\n`);
    out.end();
  });
  const managed = { name, child, logPath };
  h.processes.push(managed);
  return managed;
}

async function cleanup(h: Harness, success: boolean): Promise<void> {
  for (const proc of h.processes.reverse()) await stopProcessTree(proc.child.pid);
  if (success && !keep) await rm(h.root, { recursive: true, force: true });
}

async function stopProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    await runCommandCapture("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).catch(
      () => undefined,
    );
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function waitJson<T>(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let last = "";
  while (Date.now() <= deadline) {
    try {
      const res = await fetch(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return (await res.json()) as T;
      last = `HTTP ${res.status}: ${await res.text()}`;
    } catch (err) {
      last = (err as Error).message;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function runPowerShell(args: string[]): Promise<void> {
  const result = await runCommandCapture("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    ...args,
  ]);
  if (result.code !== 0) {
    throw new Error(`powershell failed with ${result.code}\n${result.stdout}\n${result.stderr}`);
  }
}

async function runCommandCapture(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate free port")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function hasTailscaleIpv4(): boolean {
  return Object.values(networkInterfaces()).some((entries) =>
    (entries ?? []).some(
      (entry) => entry.family === "IPv4" && !entry.internal && entry.address.startsWith("100."),
    ),
  );
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function step(message: string): void {
  console.log(`-- ${message}`);
}

function pass(message: string): void {
  console.log(`OK ${message}`);
}

function fail(message: string): void {
  console.error(`FAIL ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
