#!/usr/bin/env bun
// bin.ts — single entry for the cr-connector executable.
//
// User-facing commands:
//   cr-connector                       run daemon
//   cr-connector register-self --server <URL> --site-token <TOKEN>
//                                      install/start/register this PC
//   cr-connector login-task install --start  install Windows login task
//   cr-connector login-task status     print Windows login task status
//   cr-connector login-task remove     remove Windows login task
//   cr-connector auth-token            print this PC's daemon API token
//   cr-connector uninstall             remove all local connector state, exit
//   cr-connector --help                show usage
//
// Power-user flags / env (rarely needed):
//   --label <NAME>                     human label for this device
//   CR_CONNECTOR_PORT, CR_CONNECTOR_HOST,
//   CR_CONNECTOR_BUN_PATH, CR_CONNECTOR_FIRST_PARTY_DIRS,
//   CR_CONNECTOR_DISABLE_AUTOLOAD,
//   CR_CONNECTOR_WORKSPACE_ROOTS  comma-separated allowlist for the
//                                 cwd picker (e.g. "~/projects,/srv/dev").
//                                 Unset = unrestricted.
//                                 Set + empty = lockdown.
//   CR_CONNECTOR_AUTH_FILE        override the auth.json location
//                                 (default: <state-dir>/auth.json).
//                                 Same file the CLI reads to authenticate.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, hostname as osHostname } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { behaviorDef as remoteClaudeBehavior } from "@deskrelay/behavior-remote-claude";
import { loadOrCreateAuthToken, readAuthFile } from "./auth-token.ts";
import { BehaviorFetcher } from "./behavior-fetcher.ts";
import { removeConnectorLocalState } from "./connector-cleanup.ts";
import { Daemon, type DaemonPairingStatus, type DaemonReloadResult } from "./daemon.ts";
import {
  defaultIdentityPath,
  pairWithSite,
  readDeviceIdentity,
  removeDeviceIdentity,
} from "./device-identity.ts";
import {
  WINDOWS_LOGIN_TASK_NAME,
  installLoginTask,
  isPackagedConnectorBinary,
  queryLoginTask,
  readLoginTaskScript,
  removeLoginTask,
  removeSourceRunLoginTask,
  restartLoginTask,
} from "./login-task.ts";
import { RegisterSelfError, formatRegisterSelfReport, registerSelf } from "./self-register.ts";
import { updateLocalSourceConnector } from "./self-update.ts";
import { SiteWsClient } from "./site-ws-client.ts";
import { clearStateFile, readStateFile, writeStateFile } from "./state-file.ts";
import { parseWorkspaceRoots } from "./workspaces.ts";

const DEFAULT_SITE_URL = "http://127.0.0.1:18092";

const HELP = `\
cr-connector - host Claude Code behaviors for DeskRelay

Usage:
  cr-connector                          run daemon
  cr-connector doctor                   diagnose local connector issues
  cr-connector register-self --server <URL> --site-token <TOKEN>
                                        install, start, verify, and register this PC
  cr-connector login-task install       install Windows login task
  cr-connector login-task install --start install and start Windows login task
  cr-connector login-task status        print Windows login task status
  cr-connector login-task remove        remove Windows login task
  cr-connector auth-token               print this PC's daemon API token
  cr-connector uninstall                remove local connector state
  cr-connector remove                   alias for uninstall
  cr-connector --help                   show this help

Self-host:
  On every PC you want to control, run the register-self command copied
  from Settings -> Devices. It starts the connector, verifies the
  Tailscale/LAN URL, and registers the device with the self-host server.

Uninstall:
  Removes identity/auth/state files, login task, and connector-local
  cached behavior packages from this PC. It does not delete cloned
  source/binary folders.

Default daemon URL:
  http://127.0.0.1:18091

Workspace restriction:
  CR_CONNECTOR_WORKSPACE_ROOTS=C:\\Users\\me\\Projects,D:\\work
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

// First positional arg picks the mode. Everything else feeds the daemon.
const command = argv[0];

// Internal/hidden subcommand — used by behavior-sdk's spawnBehaviorHost
// when the daemon itself is running from a Bun-compiled single-file
// binary (cr-connector.exe / cr-connector). The compiled binary cannot
// `bun run <file>` because it's not the bun CLI; it always re-enters
// this same bin.ts. So we expose a host mode that import()s the entry
// path and lets the behavior-sdk's stdio bridge take over.
//
// Not advertised in --help: end users never type this. The behavior-sdk
// chooses between `bun run` (real bun) and `behavior-host` (compiled
// cr-connector binary) by inspecting the spawn command's basename.
if (command === "behavior-host") {
  const entry = argv[1];
  if (!entry) {
    process.stderr.write("error: behavior-host requires <entryPath>\n");
    process.exit(2);
  }
  const { resolve } = await import("node:path");
  const absolute = resolve(entry);
  // The behavior's index.ts wires itself to stdin/stdout via the
  // behavior-sdk runtime. import() is enough — no further glue here.
  await import(absolute);
  // Block forever so we don't fall through to daemon mode (which would
  // try to bind the listening port and stomp on the parent process's
  // state). The imported behavior keeps the event loop alive via its
  // stdio handlers; the process exits naturally when the parent closes
  // stdin or the behavior calls process.exit itself.
  await new Promise<never>(() => {});
}
if (command === "login-task" || command === "autostart") {
  const action = argv[1] ?? "status";
  try {
    if (action === "install") {
      const start = takeFlag(argv, "--start");
      const r = await installLoginTask({ start });
      if (!r.supported) {
        process.stderr.write("login-task is currently supported on Windows only.\n");
        process.exit(2);
      }
      process.stdout.write(
        `login task installed: ${r.taskName}\nscript: ${r.scriptPath}\nlog: ${r.logPath}\nstarted: ${r.started ? "yes" : "no"}\n`,
      );
      process.exit(0);
    }
    if (action === "remove" || action === "uninstall") {
      const r = await removeLoginTask();
      if (!r.supported) {
        process.stderr.write("login-task is currently supported on Windows only.\n");
        process.exit(2);
      }
      process.stdout.write(
        r.removed
          ? `login task removed: ${r.taskName}\n`
          : `(login task already absent: ${r.taskName})\n`,
      );
      process.exit(0);
    }
    if (action === "status") {
      const r = await queryLoginTask();
      if (!r.supported) {
        process.stderr.write("login-task is currently supported on Windows only.\n");
        process.exit(2);
      }
      process.stdout.write(
        r.installed
          ? `login task installed: ${r.taskName}\n${r.raw ?? ""}`
          : `(login task not installed: ${r.taskName})\n`,
      );
      process.exit(0);
    }
    process.stderr.write(`error: unknown login-task action "${action}"\n\n`);
    process.stderr.write(HELP);
    process.exit(2);
  } catch (err) {
    process.stderr.write(`login-task ${action} failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
if (command === "unpair") {
  try {
    const r = await removeDeviceIdentity();
    if (r.identityRemoved || r.keyRemoved) {
      process.stdout.write(
        `✓ unpaired locally (was ${r.previousDeviceId ?? "unknown deviceId"}).\n  identity.json removed: ${r.identityRemoved ? "yes" : "no"}\n  private key removed: ${r.keyRemoved ? "yes" : "no"}\n  Note: site-side device row is NOT removed — delete it from the\n  browser's Settings → Devices list if you want a clean slate.\n`,
      );
    } else {
      process.stdout.write("(already unpaired — nothing to remove)\n");
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`✗ unpair failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
if (command === "uninstall" || command === "remove") {
  try {
    const result = await uninstallLocalConnector({ removeRepo: takeFlag(argv, "--remove-repo") });
    writeUninstallSummary(result);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`✗ uninstall failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
if (command === "doctor") {
  const { runDoctor, formatDoctorOutput } = await import("./doctor.ts");
  const results = await runDoctor();
  process.stdout.write(`${formatDoctorOutput(results)}\n`);
  // exit 0 on warns, 1 on errors so CI / scripts can branch.
  const hasError = results.some((r) => r.status === "error");
  process.exit(hasError ? 1 : 0);
}
if (command === "register-self") {
  const serverUrl = takeFlagValue(argv, "--server") ?? takeFlagValue(argv, "--site-url");
  const siteToken = takeFlagValue(argv, "--site-token") ?? takeFlagValue(argv, "--token");
  if (!serverUrl || !siteToken) {
    process.stderr.write(
      "error: register-self requires --server <URL> and --site-token <TOKEN>\n\n",
    );
    process.stderr.write(HELP);
    process.exit(2);
  }
  const portRaw = takeFlagValue(argv, "--port");
  const port = portRaw ? Number(portRaw) : undefined;
  const listenHost =
    takeFlagValue(argv, "--listen-host") ??
    takeFlagValue(argv, "--bind-host") ??
    takeFlagValue(argv, "--host");
  const advertiseHost =
    takeFlagValue(argv, "--advertise-host") ?? takeFlagValue(argv, "--daemon-host");
  const workspaceRoots = takeFlagValue(argv, "--workspace-roots");
  const label = takeFlagValue(argv, "--label");
  try {
    const result = await registerSelf({
      serverUrl,
      siteToken,
      ...(port !== undefined ? { port } : {}),
      ...(listenHost !== undefined ? { listenHost } : {}),
      ...(advertiseHost !== undefined ? { advertiseHost } : {}),
      ...(workspaceRoots !== undefined ? { workspaceRoots } : {}),
      ...(label !== undefined ? { label } : {}),
    });
    process.stdout.write(`${formatRegisterSelfReport(result.report)}\n`);
    process.stdout.write(
      [
        `connector listening: ${result.listenHost}:${result.port}`,
        `external connector URL verified: ${result.daemonUrl}`,
        `registered ${result.label} with the DeskRelay server`,
        `login task: ${result.taskName}`,
        ...(result.scriptPath ? [`script: ${result.scriptPath}`] : []),
        ...(result.logPath ? [`log: ${result.logPath}`] : []),
        "",
      ].join("\n"),
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof RegisterSelfError) {
      process.stderr.write(`${formatRegisterSelfReport(err.report)}\n`);
    }
    process.stderr.write(`register-self failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
if (command === "identity") {
  const identity = await readDeviceIdentity().catch(() => undefined);
  if (!identity) {
    process.stdout.write(
      "(not paired — run `cr-connector pair ABC123` first, replacing ABC123 with the site code)\n",
    );
    process.exit(0);
  }
  process.stdout.write(
    `deviceId: ${identity.deviceId}\nsite: ${identity.siteUrl}\nlabel: ${identity.label ?? "(none)"}\npaired at: ${identity.pairedAt}\nconnectionToken: ${identity.connectionToken ? "present" : "MISSING — re-pair to get one"}\n`,
  );
  process.exit(0);
}

if (command === "auth-token" || command === "token") {
  const auth = await loadOrCreateAuthToken();
  process.stdout.write(`token: ${auth.token}\npath: ${auth.path}\n`);
  process.exit(0);
}

if (command === "pair") {
  const code = argv[1];
  if (!code) {
    process.stderr.write("error: pair requires the 6-character site code\n\n");
    process.stderr.write(HELP);
    process.exit(2);
  }
  const siteUrl = takeFlagValue(argv, "--site-url") ?? process.env.CR_SITE_URL ?? DEFAULT_SITE_URL;
  const label = takeFlagValue(argv, "--label") ?? `${osHostname()} (${process.platform})`;
  const noStart = takeFlag(argv, "--no-start");
  const loginTask = takeFlag(argv, "--login-task") || takeFlag(argv, "--install-login-task");
  if (noStart && loginTask) {
    process.stderr.write("error: pair cannot combine --no-start and --login-task\n");
    process.exit(2);
  }
  process.stdout.write(`Pairing with ${siteUrl}…\n`);
  try {
    const result = await pairWithSite({
      siteUrl,
      code,
      label,
      os: process.platform,
      hostname: osHostname(),
    });
    process.stdout.write(
      `✓ paired as ${result.identity.deviceId} (label="${result.identity.label ?? ""}")\n`,
    );
    // Live re-pair: if a daemon is already running on this PC, ask it to
    // hot-reload its SiteWsClient instead of starting a second one.
    // Without this, the user has to kill the old process by hand or the
    // re-pair never takes effect (the old process keeps the revoked
    // identity in memory). Best-effort — failure falls through to the
    // kill-stale + start-fresh path so the user isn't stuck if the
    // running daemon is wedged or predates /pairing/reload.
    const reloaded = await maybeReloadRunningDaemon();
    if (reloaded && !loginTask) {
      process.stdout.write("✓ existing daemon picked up the new identity — no restart needed.\n");
      process.exit(0);
    }
    if (reloaded && loginTask) {
      process.stdout.write(
        "✓ existing daemon picked up the new identity — restarting through the login task.\n",
      );
    }
    // Reload failed (old daemon, wedged daemon, port collision risk), or
    // the caller requested login-task persistence and we need that task
    // to own the daemon process. Kill the stale/live daemon now so the
    // new daemon — started either inline below or via installLoginTask —
    // can bind 18091 cleanly. Idempotent no-op when nothing's running.
    const killed = await killStaleRunningDaemon();
    if (killed.killed && killed.pid !== undefined) {
      process.stdout.write(`(stopped stale daemon pid=${killed.pid} so the new pair can bind)\n`);
    }
    if (noStart) {
      process.stdout.write("identity stored. Run `cr-connector` to start the daemon.\n");
      process.exit(0);
    }
    if (loginTask) {
      try {
        const task = await installLoginTask({ start: true });
        if (!task.supported) {
          process.stderr.write("login-task is currently supported on Windows only.\n");
          process.exit(2);
        }
        process.stdout.write(
          `login task installed: ${task.taskName}\nscript: ${task.scriptPath}\nlog: ${task.logPath}\nstarted: yes\n`,
        );
        process.exit(0);
      } catch (err) {
        // Login-task install commonly fails because the user ran the
        // shell unelevated and schtasks /Create denies the per-user
        // task registration. Pair already wrote a valid identity to
        // disk, so falling through to the inline daemon start gets the
        // user's chat working *now* — they can re-run `login-task
        // install --start` from an admin shell later for boot
        // persistence. Without this fallback the user stares at a
        // pair-succeeded-then-died terminal and has no daemon.
        process.stderr.write(
          `⚠ login task install failed: ${(err as Error).message}\n  Pair succeeded — starting daemon in this shell. Reboot persistence won't survive without an admin-shell \`cr-connector login-task install --start\`.\n`,
        );
        // Fall through to inline daemon start below.
      }
    }
    process.stdout.write("Starting daemon…\n");
    // Fall through to daemon start with the freshly-written identity.
  } catch (err) {
    process.stderr.write(`✗ pair failed: ${(err as Error).message}\n`);
    process.exit(1);
  }
} else if (command && !command.startsWith("--")) {
  process.stderr.write(`error: unknown command "${command}"\n\n`);
  process.stderr.write(HELP);
  process.exit(2);
}

// ---- daemon mode (default) ------------------------------------------------

const port = process.env.CR_CONNECTOR_PORT ? Number(process.env.CR_CONNECTOR_PORT) : 18091;
const host = process.env.CR_CONNECTOR_HOST ?? "127.0.0.1";
// Default to the Bun binary running this daemon — guarantees behaviors
// can spawn even if `bun` isn't on PATH (common on Windows).
const bunPath = process.env.CR_CONNECTOR_BUN_PATH ?? process.execPath;

// Resolve first-party behavior dirs so URL-style packageDir inputs
// (`deskrelay://behaviors/<name>`) can be installed without
// a remote registry. Three sources, merged in this order:
//   1. monorepo auto-detect — when running from the bundled repo, scan
//      <root>/packages/behaviors/* for manifest.json files.
//   2. binary sibling auto-detect — scan <execDir>/behaviors/* so the
//      compiled .exe can ship with bundled behaviors next to it.
//   3. CR_CONNECTOR_FIRST_PARTY_DIRS env — `name=path,name=path` for
//      operators wiring without the monorepo (prod self-host).
// All absent is fine: fetcher just rejects registry URLs with a
// clear "not in firstPartyDirs" error until a remote catalog is configured.
const firstPartyDirs = new Map<string, string>();
for (const [name, dir] of discoverMonorepoBehaviors()) firstPartyDirs.set(name, dir);
for (const [name, dir] of discoverSiblingBehaviors()) firstPartyDirs.set(name, dir);
for (const [name, dir] of parseEnvFirstParty(process.env.CR_CONNECTOR_FIRST_PARTY_DIRS)) {
  firstPartyDirs.set(name, dir);
}

const fetcher = new BehaviorFetcher({ firstPartyDirs });

// Workspace allowlist for /fs/list + /fs/mkdir. CR_CONNECTOR_WORKSPACE_ROOTS
// unset = legacy unrestricted (preserves the M0–M7 self-host workflow).
// Set, even to "", switches the daemon into restricted mode.
const workspaceRoots = parseWorkspaceRoots(process.env.CR_CONNECTOR_WORKSPACE_ROOTS);

// Per-machine shared secret for the local HTTP API. Persisted to
// auth.json (chmod 600 on POSIX). The CLI + SiteWsClient read this
// file too so they can include the matching Bearer token. The browser never sees it; the self-host site backend reads this value when it proxies directly to the daemon.
const auth = await loadOrCreateAuthToken();

// Holds the in-flight SiteWsClient. Wrapped in a setter so /pairing/reload
// can swap it for a fresh client without bin.ts losing the reference.
let siteWs: SiteWsClient | undefined;
let siteWsDeviceId: string | undefined;

const getPairingStatus = (): DaemonPairingStatus => {
  if (!siteWs || !siteWsDeviceId) {
    // No running WS client — bin.ts will have detected the cause at
    // startup (see siteWs construction below) and stamped one of these:
    //   - identity missing → "unpaired"
    //   - identity present but no connectionToken → "missing-token"
    //   - identity revoked → "revoked"
    return startupPairingStatus;
  }
  const diag = siteWs.getDiagnostics();
  return {
    state: diag.state,
    deviceId: siteWsDeviceId,
    ...(diag.lastError ? { lastError: diag.lastError } : {}),
  };
};
const connectorLogPath =
  process.env.CR_CONNECTOR_LOG_PATH ??
  (process.env.CR_DEV_LOG_DIR ? join(process.env.CR_DEV_LOG_DIR, "daemon.log") : undefined);

const daemon = new Daemon({
  host,
  port,
  bunPath,
  fetcher,
  workspaceRoots,
  authToken: auth.token,

  getPairingStatus,
  reloadSiteWsClient,
  requestSelfUninstall: async ({ removeRepo }) => {
    const result = await uninstallLocalConnector({ removeRepo: removeRepo === true });
    const exitTimer = setTimeout(() => process.exit(0), 250);
    (exitTimer as { unref?: () => void }).unref?.();
    return result;
  },
  requestSelfUpdate: async () => {
    const result = await updateLocalSourceConnector({
      ...(process.env.DESKRELAY_UPDATE_BRANCH
        ? { branch: process.env.DESKRELAY_UPDATE_BRANCH }
        : {}),
    });
    if (result.restartScheduled && result.restartRequested !== false) {
      const exitTimer = setTimeout(() => process.exit(0), 500);
      (exitTimer as { unref?: () => void }).unref?.();
    }
    return result;
  },
  requestSelfRestart: async () => {
    const result = await restartLoginTask();
    if (!result.supported) {
      return {
        supported: false,
        accepted: false,
        message: "connector login task is unsupported on this OS",
      };
    }
    if (!result.installed) {
      return {
        supported: true,
        accepted: false,
        message: "connector login task is not installed",
      };
    }
    if (!result.restarted) {
      return {
        supported: true,
        accepted: false,
        message: "connector restart request failed",
        ...(result.error ? { error: result.error } : {}),
      };
    }
    const exitTimer = setTimeout(() => process.exit(0), 500);
    (exitTimer as { unref?: () => void }).unref?.();
    return {
      supported: true,
      accepted: true,
      message: `connector restart requested through ${result.taskName}`,
    };
  },
  ...(connectorLogPath ? { logPath: connectorLogPath } : {}),
  onLog: (record) => {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  },
  onUnexpectedExit: (info) => {
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "behavior unexpected exit",
        instanceId: info.instanceId,
        code: info.code,
      })}\n`,
    );
  },
});

await maybeMigrateSourceRunLoginTaskForPackagedConnector();

const listening = daemon.start();

// Expose the daemon's listening URL to behaviors (and any sub-subprocess
// they spawn — e.g. claude CLI's PreToolUse hook) via env. The hook
// script (packages/behaviors/remote-claude/src/hooks/pretooluse.ts)
// reads CR_DAEMON_URL to know where to POST the approval request.
if (!process.env.CR_DAEMON_URL) {
  process.env.CR_DAEMON_URL = localDaemonUrl(listening.host, listening.port);
}
// Same path for the per-machine auth token. The hook script needs it
// to pass the daemon's Bearer auth gate. This token never leaves the
// machine — env propagates only to subprocesses we own (Bun's spawn
// inherits env), and the daemon never echoes it over the WebSocket.
if (!process.env.CR_DAEMON_TOKEN) {
  process.env.CR_DAEMON_TOKEN = auth.token;
}

// Auto-load remote-claude in-process. The behavior is bundled into the
// daemon binary as a workspace import, so loading is a direct function
// call into BehaviorRegistry.loadInProcess — no subprocess spawn, no
// JSONRPC stdio handshake, no behaviors/ folder discovery, no spawn
// argv detection. Every "behavior won't load" failure mode that
// depended on those layers (we patched four of them today) cannot
// happen on this path.
//
// CR_CONNECTOR_DISABLE_AUTOLOAD=1 turns this off — used by integration
// tests that want a clean, empty registry for assertions.
if (process.env.CR_CONNECTOR_DISABLE_AUTOLOAD !== "1") {
  try {
    const entry = await daemon.registry.loadInProcess(remoteClaudeBehavior, {
      instanceId: "remote-claude",
      onLog: (record) => {
        process.stderr.write(
          `${JSON.stringify({ ...record, source: "behavior", instanceId: "remote-claude" })}\n`,
        );
      },
    });
    console.log(
      JSON.stringify({
        event: "auto-loaded-behavior",
        instanceId: entry.instanceId,
        name: entry.pkg.manifest.name,
        mode: "in-process",
      }),
    );
  } catch (err) {
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: `failed to auto-load remote-claude: ${(err as Error).message}`,
      })}\n`,
    );
  }
}

// Best-effort: drop a rendezvous file so the CLI can find this daemon
// without --base-url. Failure is non-fatal — we still serve traffic.
try {
  await writeStateFile({
    pid: process.pid,
    host: listening.host,
    port: listening.port,
    startedAt: new Date().toISOString(),
  });
} catch (err) {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      msg: `failed to write daemon state file: ${(err as Error).message}`,
    })}\n`,
  );
}

console.log(JSON.stringify({ event: "listening", ...listening }));
if (firstPartyDirs.size > 0) {
  console.log(
    JSON.stringify({
      event: "first-party-behaviors",
      names: [...firstPartyDirs.keys()].sort(),
    }),
  );
}

// Confirm token state without leaking the value itself. "created" is
// useful for first-run setup; "loaded" for routine restarts.
console.log(
  JSON.stringify({
    event: auth.created ? "auth-token-created" : "auth-token-loaded",
    path: auth.path,
  }),
);

if (workspaceRoots.mode === "unrestricted") {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      msg: "fs browsing unrestricted — set CR_CONNECTOR_WORKSPACE_ROOTS to restrict /fs/list + /fs/mkdir",
    })}\n`,
  );
} else {
  console.log(
    JSON.stringify({
      event: "workspace-roots",
      roots: workspaceRoots.roots,
    }),
  );
}

// Optional legacy outbound WebSocket relay. The default self-host path does not use it.

// Steady-state diagnostic for /status when no SiteWsClient is live.
// Updated by openSiteWs() on construction failure paths so /status
// reflects "unpaired" vs "missing-token" without bin.ts having to
// re-read identity.json on every status request.
let startupPairingStatus: DaemonPairingStatus = { state: "unpaired" };

async function openSiteWs(reason: "startup" | "reload"): Promise<DaemonReloadResult> {
  // Always re-read identity from disk so a re-pair (which rewrites the
  // file on the same path) is picked up. The previous SiteWsClient — if
  // any — is stopped first so we don't double-up reconnect timers.
  const previous = siteWs;
  if (previous) {
    previous.stop();
    siteWs = undefined;
    siteWsDeviceId = undefined;
  }
  const identity = await readDeviceIdentity(defaultIdentityPath()).catch(() => undefined);
  const url =
    process.env.CR_CONNECTOR_SITE_WS_URL ??
    (identity?.siteUrl ? siteUrlToWsUrl(identity.siteUrl) : undefined);
  const deviceId = process.env.CR_CONNECTOR_DEVICE_ID ?? identity?.deviceId;
  const token = process.env.CR_CONNECTOR_DEVICE_TOKEN ?? identity?.connectionToken;
  if (url && deviceId && token) {
    const client = new SiteWsClient({
      siteUrl: url,
      deviceId,
      token,
      relayTo: localDaemonUrl(listening.host, listening.port),
      // In-process: site-ws-client adds this Bearer header on every
      // relay fetch so the daemon's auth gate accepts it. No network
      // hop — the token never leaves this Bun process.
      localToken: auth.token,
      onLog: (record) => {
        process.stderr.write(`${JSON.stringify({ ...record, source: "site-ws" })}\n`);
      },
    });
    client.start();
    siteWs = client;
    siteWsDeviceId = deviceId;
    startupPairingStatus = { state: "ok", deviceId };
    console.log(
      JSON.stringify({
        event: reason === "reload" ? "site-ws-reloaded" : "site-ws-enabled",
        url,
        deviceId,
        source: process.env.CR_CONNECTOR_SITE_WS_URL ? "env" : "identity",
      }),
    );
    return { reloaded: true };
  }
  if (!identity) {
    startupPairingStatus = { state: "unpaired" };
    if (reason === "startup") {
      process.stderr.write(
        "⚠ no pairing identity found — site relay disabled.\n  Run `cr-connector pair ABC123` with the site code to enable browser/mobile access.\n",
      );
    }
    return { reloaded: false, error: "no identity on disk" };
  }
  startupPairingStatus = {
    state: "missing-token",
    deviceId: identity.deviceId,
  };
  if (reason === "startup") {
    process.stderr.write(
      "⚠ identity is missing connectionToken — site relay disabled.\n  Re-pair with `cr-connector pair ABC123` using a fresh site code.\n",
    );
  }
  return { reloaded: false, error: "identity missing connectionToken" };
}

async function reloadSiteWsClient(): Promise<DaemonReloadResult> {
  return openSiteWs("reload");
}

await openSiteWs("startup");

let shutdownInFlight = false;
const shutdown = async (signal: string) => {
  if (shutdownInFlight) return;
  shutdownInFlight = true;
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: `received ${signal}, shutting down`,
    })}\n`,
  );
  siteWs?.stop();
  await daemon.stop();
  await clearStateFile().catch(() => undefined);
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// ---- helpers ---------------------------------------------------------

/** Walk up from this file looking for the monorepo root (a package.json
 *  with workspaces covering `packages/*`). When found, return a map of
 *  `manifest.name → absolute behavior dir` for every dir under
 *  `<root>/packages/behaviors/` that has a readable manifest.json.
 *  Returns empty for compiled binaries running outside the repo. */
function discoverMonorepoBehaviors(): Iterable<[string, string]> {
  const out = new Map<string, string>();
  const root = findWorkspaceRoot(import.meta.dir);
  if (!root) return out;
  const behaviorsDir = join(root, "packages", "behaviors");
  if (!existsSync(behaviorsDir)) return out;
  return scanBehaviorsDir(behaviorsDir);
}

/** Compiled binary distribution: scan a `behaviors/` directory next to
 *  the executable. Lets a packaged release ship `cr-connector.exe` +
 *  `behaviors/remote-claude/...` and have the daemon pick it up without
 *  any env config. */
function discoverSiblingBehaviors(): Iterable<[string, string]> {
  const out = new Map<string, string>();
  const exeDir = dirname(process.execPath);
  const behaviorsDir = join(exeDir, "behaviors");
  if (!existsSync(behaviorsDir)) return out;
  return scanBehaviorsDir(behaviorsDir);
}

function scanBehaviorsDir(behaviorsDir: string): Iterable<[string, string]> {
  const out = new Map<string, string>();
  let entries: string[];
  try {
    entries = readdirSync(behaviorsDir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const dir = join(behaviorsDir, entry);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };
      if (typeof raw.name === "string" && raw.name.length > 0) out.set(raw.name, dir);
    } catch {
      // ignore unparseable manifests — they'll fail at load time anyway.
    }
  }
  return out;
}

function findWorkspaceRoot(start: string): string | null {
  let cur = resolvePath(start);
  for (let i = 0; i < 12; i++) {
    const pkg = join(cur, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as {
          workspaces?: string[] | { packages?: string[] };
        };
        const ws = Array.isArray(parsed.workspaces)
          ? parsed.workspaces
          : (parsed.workspaces?.packages ?? []);
        if (ws.some((p) => p.startsWith("packages/"))) return cur;
      } catch {
        // fall through
      }
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/** Convert a https?:// site URL into the canonical WS upgrade endpoint
 *  (`/api/connector/ws`). Used when the daemon falls back to the
 *  identity file's `siteUrl` field — pairing/complete writes the
 *  origin only. */
function siteUrlToWsUrl(siteUrl: string): string {
  try {
    const u = new URL(siteUrl);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/api/connector/ws";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return siteUrl;
  }
}

function localDaemonUrl(host: string, port: number): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return `http://127.0.0.1:${port}`;
  }
  return `http://${host}:${port}`;
}

function parseEnvFirstParty(raw: string | undefined): Iterable<[string, string]> {
  const out = new Map<string, string>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const path = trimmed.slice(eq + 1).trim();
    if (name && path) out.set(name, resolvePath(path));
  }
  return out;
}

/** Best-effort: if a cr-connector daemon is already running on this PC,
 *  POST /pairing/reload to it so it adopts the freshly-written identity
 *  without us spawning a second daemon. Returns true on a successful
 *  reload (HTTP 200 + body { reloaded: true }). False on any other path
 *  — caller falls back to "kill the stale daemon, then start fresh"
 *  via {@link killStaleRunningDaemon}.
 *
 *  Why best-effort: pair must work even when the running daemon is
 *  wedged or auth.json was rotated out from under us. We never want to
 *  block the user from re-pairing because of a transient local error. */
async function maybeReloadRunningDaemon(): Promise<boolean> {
  let state: { host: string; port: number; pid: number } | undefined;
  try {
    const s = await readStateFile();
    if (!s) return false;
    state = { host: s.host, port: s.port, pid: s.pid };
  } catch {
    return false;
  }
  let token: string | undefined;
  try {
    const a = await readAuthFile();
    token = a?.token;
  } catch {
    return false;
  }
  if (!token) return false;
  const url = `http://${state.host}:${state.port}/pairing/reload`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      // 5s ceiling — a wedged daemon shouldn't block re-pair forever.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Daemon state file is stale (process gone) or socket refused.
    // Caller falls through to "start a new daemon" path.
    return false;
  }
  if (!res.ok) return false;
  let body: { reloaded?: boolean; error?: string } = {};
  try {
    body = (await res.json()) as { reloaded?: boolean; error?: string };
  } catch {
    return false;
  }
  if (!body.reloaded) {
    if (body.error) {
      process.stderr.write(`(running daemon refused reload: ${body.error})\n`);
    }
    return false;
  }
  return true;
}

/** Packaged connector binaries may migrate old source-run login tasks so only one daemon binds the local port. */
async function maybeMigrateSourceRunLoginTaskForPackagedConnector(): Promise<void> {
  if (process.platform !== "win32") return;
  const base = basename(process.execPath).toLowerCase();
  if (!isPackagedConnectorBinary(base)) return;

  const migrationTasks = [
    {
      taskName: WINDOWS_LOGIN_TASK_NAME,
      remove: () => removeSourceRunLoginTask({ taskName: WINDOWS_LOGIN_TASK_NAME }),
    },
  ];

  let removed = false;
  for (const { taskName, remove } of migrationTasks) {
    try {
      const result = await remove();
      removed = result.removed || removed;
      if (result.removed) {
        process.stderr.write(
          `${JSON.stringify({
            ts: new Date().toISOString(),
            level: "info",
            msg: `removed legacy source-run login task ${result.taskName}`,
          })}\n`,
        );
      }
    } catch (err) {
      process.stderr.write(
        `${JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          msg: `failed to remove legacy source-run login task ${taskName}: ${(err as Error).message}`,
        })}\n`,
      );
    }
  }

  if (!removed) return;
  const killed = await killStaleRunningDaemon();
  if (killed.killed && killed.pid !== undefined) {
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: `stopped legacy daemon pid=${killed.pid} for packaged connector takeover`,
      })}\n`,
    );
  }
}

interface LocalConnectorUninstallResult {
  ok: true;
  loginTask?: Awaited<ReturnType<typeof removeLoginTaskForUninstall>>;
  loginTaskError?: string;
  localState: Awaited<ReturnType<typeof removeConnectorLocalState>>;
  repoRemoval: RepoRemovalResult;
}

interface RepoRemovalResult {
  requested: boolean;
  scheduled: boolean;
  path?: string;
  reason?: string;
}

async function uninstallLocalConnector(
  options: {
    removeRepo?: boolean;
  } = {},
): Promise<LocalConnectorUninstallResult> {
  let loginTask: Awaited<ReturnType<typeof removeLoginTaskForUninstall>> | undefined;
  let loginTaskError: string | undefined;
  try {
    loginTask = await removeLoginTaskForUninstall();
  } catch (err) {
    loginTaskError = (err as Error).message;
  }
  const localState = await removeConnectorLocalState();
  const repoRemoval = scheduleRepoRemoval(options.removeRepo === true);
  return {
    ok: true,
    ...(loginTask ? { loginTask } : {}),
    ...(loginTaskError ? { loginTaskError } : {}),
    localState,
    repoRemoval,
  };
}

function writeUninstallSummary(result: LocalConnectorUninstallResult): void {
  if (result.loginTaskError) {
    process.stderr.write(`warning: failed to remove login task: ${result.loginTaskError}\n`);
  }
  if (result.loginTask?.supported) {
    process.stdout.write(
      result.loginTask.removed
        ? `login task removed: ${result.loginTask.taskName}\n`
        : `(login task already absent: ${result.loginTask.taskName})\n`,
    );
  }
  const r = result.localState;
  if (r.removedAny) {
    process.stdout.write(
      `✓ connector local state removed from ${r.stateDir}.\n  auth.json removed: ${r.authRemoved ? "yes" : "no"}\n  daemon.json removed: ${r.daemonStateRemoved ? "yes" : "no"}\n  identity/ removed: ${r.identityDirRemoved ? "yes" : "no"}\n  behaviors/ removed: ${r.behaviorsDirRemoved ? "yes" : "no"}\n  login task script removed: ${r.loginTaskScriptRemoved ? "yes" : "no"}\n  logs/ removed: ${r.logsDirRemoved ? "yes" : "no"}\n`,
    );
  } else {
    process.stdout.write(`(connector local state already absent at ${r.stateDir})\n`);
  }
  if (result.repoRemoval.requested) {
    process.stdout.write(
      result.repoRemoval.scheduled
        ? `source clone removal scheduled: ${result.repoRemoval.path}\n`
        : `(source clone removal skipped: ${result.repoRemoval.reason ?? "unknown reason"})\n`,
    );
  }
  process.stdout.write(
    "Note: site-side device row is NOT removed — delete it from the\nbrowser's Settings → Devices list if you want a clean slate.\n",
  );
}

function scheduleRepoRemoval(requested: boolean): RepoRemovalResult {
  if (!requested) return { requested: false, scheduled: false, reason: "not requested" };
  const repo = resolvePath(process.cwd());
  if (process.platform !== "win32") {
    return {
      requested: true,
      scheduled: false,
      path: repo,
      reason: "automatic source clone removal is Windows-only",
    };
  }
  if (basename(repo).toLowerCase() !== "deskrelay") {
    return {
      requested: true,
      scheduled: false,
      path: repo,
      reason: "current folder is not a DeskRelay installer clone",
    };
  }
  const home = resolvePath(homedir());
  if (!isInsideOrEqual(repo, home)) {
    return {
      requested: true,
      scheduled: false,
      path: repo,
      reason: "current folder is outside the user home directory",
    };
  }

  try {
    const psScript = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$pidToWait = ${process.pid}`,
      `$repo = ${quotePowerShellString(repo)}`,
      "Wait-Process -Id $pidToWait -Timeout 30",
      "Start-Sleep -Milliseconds 500",
      "if (Test-Path -LiteralPath $repo) { Remove-Item -LiteralPath $repo -Recurse -Force }",
    ].join("; ");
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    const child = Bun.spawn(
      [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        encoded,
      ],
      {
        cwd: home,
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    (child as { unref?: () => void }).unref?.();
    return { requested: true, scheduled: true, path: repo };
  } catch (err) {
    return {
      requested: true,
      scheduled: false,
      path: repo,
      reason: (err as Error).message,
    };
  }
}

function isInsideOrEqual(path: string, parent: string): boolean {
  const normalizedPath = path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const normalizedParent = parent.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}\\`);
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function removeLoginTaskForUninstall() {
  if (process.platform !== "win32") return await removeLoginTask();
  // Test/self-host flows can point CR_CONNECTOR_STATE_DIR at an
  // alternate state root. In that mode, only remove a Task Scheduler
  // entry if this state root actually owns the supervisor script;
  // otherwise `uninstall` for a temp/custom state could delete the
  // user's real connector login task.
  if (!process.env.CR_CONNECTOR_STATE_DIR) return await removeLoginTask();
  const script = await readLoginTaskScript();
  if (!script) {
    return { supported: true, removed: false, taskName: WINDOWS_LOGIN_TASK_NAME };
  }
  return await removeLoginTask();
}

/** Best-effort: kill a daemon process recorded in state-file so the
 *  freshly-paired bin can bind 18091 and start clean. Used as a
 *  fallback when {@link maybeReloadRunningDaemon} can't hot-swap
 *  (older daemon without /pairing/reload, or wedged daemon that 5xx's
 *  the call). Without this step a stale daemon owning the port silently
 *  blocks the new pair from coming online — the exact wedge users hit
 *  after "delete + re-add" without coordinated re-pair. */
async function killStaleRunningDaemon(): Promise<{ killed: boolean; pid?: number }> {
  let pid: number | undefined;
  let port: number | undefined;
  try {
    const s = await readStateFile();
    if (!s) return { killed: false };
    pid = s.pid;
    port = s.port;
  } catch {
    return { killed: false };
  }
  if (!pid) return { killed: false };
  // Don't kill ourselves — would happen if state-file leaked from a
  // previous incarnation that re-used our PID after a reboot. Cheap
  // sanity; the typical re-pair flow runs as a separate short-lived
  // process so this almost never matches.
  if (pid === process.pid) return { killed: false, pid };
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      // Process already gone — state-file just hadn't been cleaned up.
      // Treat as success so the caller stops worrying about it.
      return { killed: true, pid };
    }
    return { killed: false, pid };
  }
  // Wait for the OS to release the port. SIGTERM gives the daemon a
  // chance to run its shutdown handler (clearStateFile + behavior unload);
  // if it ignores the signal we follow up with SIGKILL.
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (port === undefined || (await isPortFree("127.0.0.1", port))) return { killed: true, pid };
    await new Promise((r) => setTimeout(r, 200));
  }
  // Still alive after 4s — last resort. Doesn't run shutdown handlers
  // but at least frees the port so the user's re-pair can complete.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore — best effort
  }
  return { killed: true, pid };
}

/** Returns true when nothing is listening on (host, port). Uses a
 *  short-timeout connect probe rather than parsing netstat so it works
 *  the same on Windows / mac / linux. */
async function isPortFree(host: string, port: number): Promise<boolean> {
  try {
    const sock = await Bun.connect({
      hostname: host,
      port,
      socket: { open: () => undefined, data: () => undefined, close: () => undefined },
    });
    sock.end();
    return false;
  } catch {
    return true;
  }
}

function takeFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function takeFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  args.splice(idx, 2);
  return value;
}
