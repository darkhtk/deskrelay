#!/usr/bin/env bun

import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerSelf } from "../packages/pc-connector-daemon/src/self-register.ts";

interface ManagedProcess {
  name: string;
  child: ChildProcess;
  logPath: string;
}

interface TestContext {
  repoRoot: string;
  root: string;
  serverRoot: string;
  remoteRoot: string;
  serverPort: number;
  frontendPort: number;
  serverDaemonPort: number;
  remoteDaemonPort: number;
  siteToken: string;
  serverUrl: string;
  remoteWorkspace: string;
  processes: ManagedProcess[];
}

const keep = process.argv.includes("--keep");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ctx: TestContext = {
  repoRoot,
  root: await mkdtemp(join(tmpdir(), "deskrelay-selfhost-e2e-")),
  serverRoot: "",
  remoteRoot: "",
  serverPort: await freePort(),
  frontendPort: await freePort(),
  serverDaemonPort: await freePort(),
  remoteDaemonPort: await freePort(),
  siteToken: `e2e-${crypto.randomUUID()}`,
  serverUrl: "",
  remoteWorkspace: "",
  processes: [],
};
ctx.serverRoot = join(ctx.root, "server");
ctx.remoteRoot = join(ctx.root, "remote");
ctx.serverUrl = `http://127.0.0.1:${ctx.serverPort}`;
ctx.remoteWorkspace = join(ctx.root, "remote-workspace");

let failed = false;

try {
  await runScenario(ctx);
  await cleanup(ctx, true);
  pass("virtual self-host e2e passed");
} catch (err) {
  failed = true;
  await cleanup(ctx, false);
  fail((err as Error).stack ?? (err as Error).message);
  process.exitCode = 1;
} finally {
  if (failed || keep) {
    console.log(`logs: ${join(ctx.root, "logs")}`);
    console.log(`root: ${ctx.root}`);
  }
}

async function runScenario(ctx: TestContext): Promise<void> {
  step("server install");
  await mkdir(ctx.remoteWorkspace, { recursive: true });
  await mkdir(join(ctx.remoteWorkspace, "hello-dir"), { recursive: true });
  await writeFile(
    join(ctx.remoteWorkspace, "hello-dir", "hello.txt"),
    "hello from virtual remote pc\n",
    "utf8",
  );
  await runPowerShell([
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ctx.repoRoot, "scripts", "nas-dev-init.ps1"),
    "-NasRoot",
    ctx.serverRoot,
    "-RepoRoot",
    ctx.repoRoot,
    "-SiteToken",
    ctx.siteToken,
    "-SitePort",
    String(ctx.serverPort),
    "-FrontendPort",
    String(ctx.frontendPort),
    "-DaemonPort",
    String(ctx.serverDaemonPort),
    "-SiteHost",
    "127.0.0.1",
    "-ConnectorHost",
    "127.0.0.1",
    "-FrontendUrlHost",
    "127.0.0.1",
    "-DaemonUrlHost",
    "127.0.0.1",
    "-WorkspaceRoots",
    join(ctx.root, "server-workspace"),
    "-Force",
  ]);
  assert(existsSync(join(ctx.serverRoot, "dev.env.ps1")), "server env file was not created");
  assert(existsSync(join(ctx.serverRoot, "site-token.txt")), "site token file was not created");

  const backend = startManaged(ctx, "site-backend", ["run", "packages/site-backend/src/bin.ts"], {
    CR_NAS_DEV_ROOT: ctx.serverRoot,
    CR_LOCAL_DEV: "1",
    CR_SITE_HOST: "127.0.0.1",
    CR_SITE_PORT: String(ctx.serverPort),
    CR_SITE_TOKEN: ctx.siteToken,
    CR_SITE_TOKEN_FILE: join(ctx.serverRoot, "site-token.txt"),
    CR_SITE_DEVICE_REGISTRY_FILE: join(ctx.serverRoot, "state", "site-devices.json"),
    CR_SITE_AUTH_OPTIONAL: "0",
    CR_SITE_USAGE_DISABLED: "1",
    CR_DEV_FRONTEND_URL: ctx.serverUrl,
    SITE_ANNOUNCEMENT_URL: "0",
  });
  await waitJson(`${ctx.serverUrl}/healthz`, { timeoutMs: 20_000 });
  pass(`server ready (${backend.child.pid})`);

  const commandPayload = await waitJson<{
    command: string;
    preferredUrl: string;
  }>(`${ctx.serverUrl}/api/self/register-other-pc-command`, {
    headers: authHeaders(ctx.siteToken),
  });
  assert(
    commandPayload.command.includes("scripts/install-connector.ps1"),
    "generated registration command does not download install-connector.ps1",
  );
  assert(
    !commandPayload.command.includes("scripts/register-other-pc.ps1"),
    "generated registration command still points at register-other-pc.ps1",
  );
  pass("registration command uses GitHub installer");

  step("remote register");
  const remoteState = join(ctx.remoteRoot, "state");
  const remoteAuth = join(remoteState, "auth.json");
  const remoteStateFile = join(remoteState, "daemon.json");
  const remoteIdentity = join(ctx.remoteRoot, "identity");
  await mkdir(remoteState, { recursive: true });
  await mkdir(remoteIdentity, { recursive: true });

  const previousEnv = snapshotEnv([
    "CR_CONNECTOR_STATE_DIR",
    "CR_CONNECTOR_AUTH_FILE",
    "CR_CONNECTOR_STATE_FILE",
    "CR_IDENTITY_DIR",
    "CR_CONNECTOR_HOST",
    "CR_CONNECTOR_PORT",
    "CR_CONNECTOR_WORKSPACE_ROOTS",
  ]);
  Object.assign(process.env, {
    CR_CONNECTOR_STATE_DIR: remoteState,
    CR_CONNECTOR_AUTH_FILE: remoteAuth,
    CR_CONNECTOR_STATE_FILE: remoteStateFile,
    CR_IDENTITY_DIR: remoteIdentity,
  });
  try {
    const registration = await registerSelf({
      serverUrl: ctx.serverUrl,
      siteToken: ctx.siteToken,
      port: ctx.remoteDaemonPort,
      listenHost: "127.0.0.1",
      advertiseHost: "127.0.0.1",
      workspaceRoots: ctx.remoteWorkspace,
      label: "Virtual Remote PC",
      timeoutMs: 30_000,
      stopRecordedDaemon: async () => undefined,
      stopPortOwner: async () => false,
      installTask: async ({ launch }) => {
        startManaged(ctx, "remote-daemon", ["run", "packages/pc-connector-daemon/src/bin.ts"], {
          ...launch.env,
          CR_CONNECTOR_STATE_DIR: remoteState,
          CR_CONNECTOR_AUTH_FILE: remoteAuth,
          CR_CONNECTOR_STATE_FILE: remoteStateFile,
          CR_IDENTITY_DIR: remoteIdentity,
          CR_CONNECTOR_HOST: "127.0.0.1",
          CR_CONNECTOR_PORT: String(ctx.remoteDaemonPort),
          CR_CONNECTOR_WORKSPACE_ROOTS: ctx.remoteWorkspace,
        });
        return {
          supported: true,
          taskName: "Virtual DeskRelay Connector",
          started: true,
          scriptPath: join(ctx.remoteRoot, "virtual-login-task.ps1"),
          logPath: join(ctx.root, "logs", "remote-daemon.log"),
        };
      },
    });
    assert(
      registration.daemonUrl === `http://127.0.0.1:${ctx.remoteDaemonPort}`,
      `unexpected daemonUrl: ${registration.daemonUrl}`,
    );
  } finally {
    restoreEnv(previousEnv);
  }

  const devices = await waitJson<Array<{ id: string; label: string; daemonUrl: string }>>(
    `${ctx.serverUrl}/api/devices`,
    { headers: authHeaders(ctx.siteToken) },
  );
  assert(devices.length === 1, `expected exactly one registered device, got ${devices.length}`);
  const device = devices[0];
  assert(device?.label === "Virtual Remote PC", `unexpected device label: ${device?.label}`);
  pass(`remote registered (${device.id})`);

  step("connector verification report");
  const verifyReportPath = join(ctx.root, "connector-verify.json");
  await runPowerShell([
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(ctx.repoRoot, "scripts", "self-verify-connector.ps1"),
    "-Server",
    ctx.serverUrl,
    "-SiteToken",
    ctx.siteToken,
    "-Repo",
    ctx.repoRoot,
    "-Port",
    String(ctx.remoteDaemonPort),
    "-DaemonUrl",
    `http://127.0.0.1:${ctx.remoteDaemonPort}`,
    "-DaemonToken",
    await readDaemonToken(remoteAuth),
    "-WorkspaceRoots",
    ctx.remoteWorkspace,
    "-Label",
    "Virtual Remote PC",
    "-ReportPath",
    verifyReportPath,
    "-SkipLoginTask",
  ]);
  const verifyReport = JSON.parse(await Bun.file(verifyReportPath).text()) as {
    status?: string;
    steps?: Array<{ id: string; status: string }>;
  };
  assert(verifyReport.status === "succeeded", `verification failed: ${verifyReport.status}`);
  assert(
    verifyReport.steps?.some((step) => step.id === "server-registry" && step.status === "ok"),
    "verification report did not confirm server registry",
  );
  assert(
    verifyReport.steps?.some((step) => step.id === "server-to-daemon" && step.status === "ok"),
    "verification report did not confirm server-to-connector reachability",
  );
  pass("connector verification report confirms server registry");

  step("remote use");
  const roots = await waitJson<{ mode: string; roots: string[] }>(
    `${ctx.serverUrl}/api/devices/${device.id}/fs/roots`,
    { headers: authHeaders(ctx.siteToken) },
  );
  assert(roots.mode === "restricted", `expected restricted roots, got ${roots.mode}`);
  assert(roots.roots.includes(ctx.remoteWorkspace), "remote workspace root was not exposed");

  const behaviors = await waitJson<unknown>(`${ctx.serverUrl}/api/devices/${device.id}/behaviors`, {
    headers: authHeaders(ctx.siteToken),
  });
  assert(
    JSON.stringify(behaviors).includes("remote-claude"),
    "remote-claude behavior was not visible through the site",
  );

  const listing = await waitJson<{ entries: Array<{ name: string; type: string }> }>(
    `${ctx.serverUrl}/api/devices/${device.id}/fs/list?path=${encodeURIComponent(ctx.remoteWorkspace)}`,
    { headers: authHeaders(ctx.siteToken) },
  );
  assert(
    listing.entries.some((entry) => entry.name === "hello-dir"),
    "remote workspace listing did not include hello-dir",
  );

  await postJson(
    `${ctx.serverUrl}/api/devices/${device.id}/fs/mkdir`,
    { parent: ctx.remoteWorkspace, name: "created-from-site" },
    ctx.siteToken,
  );
  const listingAfterMkdir = await waitJson<{ entries: Array<{ name: string; type: string }> }>(
    `${ctx.serverUrl}/api/devices/${device.id}/fs/list?path=${encodeURIComponent(ctx.remoteWorkspace)}`,
    { headers: authHeaders(ctx.siteToken) },
  );
  assert(
    listingAfterMkdir.entries.some((entry) => entry.name === "created-from-site"),
    "remote mkdir through site did not appear in listing",
  );
  pass("remote fs proxy works");

  step("remove");
  await deleteJson(`${ctx.serverUrl}/api/devices/${device.id}`, ctx.siteToken);
  const afterDelete = await waitJson<unknown[]>(`${ctx.serverUrl}/api/devices`, {
    headers: authHeaders(ctx.siteToken),
  });
  assert(afterDelete.length === 0, `expected device list to be empty, got ${afterDelete.length}`);
  const removedProbe = await fetch(`${ctx.serverUrl}/api/devices/${device.id}/fs/roots`, {
    headers: authHeaders(ctx.siteToken),
  });
  assert(
    removedProbe.status === 404,
    `expected removed device route to 404, got ${removedProbe.status}`,
  );
  pass("device removal clears server routing");
}

function startManaged(
  ctx: TestContext,
  name: string,
  bunArgs: string[],
  extraEnv: Record<string, string | undefined>,
): ManagedProcess {
  const logsDir = join(ctx.root, "logs");
  const logPath = join(logsDir, `${name}.log`);
  if (!existsSync(logsDir)) {
    mkdir(logsDir, { recursive: true }).catch(() => undefined);
  }
  const out = createWriteStream(logPath, { flags: "a" });
  const child = spawn(process.execPath, bunArgs, {
    cwd: ctx.repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
      SITE_ANNOUNCEMENT_URL: "0",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  const managed = { name, child, logPath };
  ctx.processes.push(managed);
  child.on("exit", (code, signal) => {
    out.write(`\n[exit code=${code ?? ""} signal=${signal ?? ""}]\n`);
    out.end();
  });
  return managed;
}

async function cleanup(ctx: TestContext, success: boolean): Promise<void> {
  for (const proc of ctx.processes.reverse()) {
    await stopProcessTree(proc.child.pid);
  }
  if (success && !keep) {
    await rm(ctx.root, { recursive: true, force: true });
  }
}

async function stopProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    await runCommand("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).catch(() => undefined);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
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

async function postJson(url: string, body: unknown, token: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: HTTP ${res.status} ${await res.text()}`);
  return await res.json();
}

async function deleteJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`DELETE ${url} failed: HTTP ${res.status} ${await res.text()}`);
  return await res.json();
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function runPowerShell(args: string[]): Promise<void> {
  await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", ...args]);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveResult, reject) => {
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
    },
  );
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.code}\n${result.stdout}\n${result.stderr}`,
    );
  }
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

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function readDaemonToken(path: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() <= deadline) {
    try {
      const parsed = JSON.parse(await Bun.file(path).text()) as { token?: unknown };
      if (typeof parsed.token === "string") return parsed.token;
    } catch {
      // wait
    }
    await sleep(200);
  }
  throw new Error(`daemon auth token was not written: ${path}`);
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
