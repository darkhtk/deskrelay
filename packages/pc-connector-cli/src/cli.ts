// CLI entry — parses argv, dispatches to handlers. Kept transport-agnostic
// (no direct fetch / process exit) so unit tests can drive it deterministically.
//
// Usage:
//   cr-connector status
//   cr-connector behaviors list
//   cr-connector behaviors load <packageDir> [--instance <id>]
//   cr-connector behaviors unload <instanceId>
//   cr-connector behaviors call <instanceId> <method> [<jsonParams>] [--timeout <ms>]
//   cr-connector events tail <spaceId>
//
// Global flags:
//   --base-url <url>   override daemon URL (default $CR_CONNECTOR_URL or http://127.0.0.1:18091)
//   --json             emit machine-readable JSON to stdout
//   --help, -h         print help

import type { CliClient } from "./client.ts";

export interface CliEnv {
  client: CliClient;
  stdout(line: string): void;
  stderr(line: string): void;
  /** Non-zero exit codes propagate up; the bin wrapper calls process.exit. */
}

export interface CliResult {
  exitCode: number;
}

export const HELP_TEXT = `\
cr-connector — talk to the local PC connector daemon

Usage:
  cr-connector <command> [args] [--flags]

Commands:
  status                                       daemon status + behaviors
  pair <code> --site-url <url> [--label X]    pair this PC with a site account
  identity                                     show paired device identity
  unpair                                       forget local pairing (keys + identity)
  behaviors list                               list loaded behaviors
  behaviors load <packageDir> [--instance ID]  load a behavior package
  behaviors unload <instanceId>                gracefully unload
  behaviors call <instanceId> <method> [JSON]  invoke a request
  events tail <spaceId>                        stream events as NDJSON

Global flags:
  --base-url <url>    daemon URL — overrides env CR_CONNECTOR_URL and the
                      auto-discovered daemon state file
  --json              emit JSON output (default: human-readable)
  --help, -h          show this help

Daemon URL resolution (precedence):
  1. --base-url
  2. $CR_CONNECTOR_URL
  3. daemon state file (auto-written by the daemon on start)
  4. http://127.0.0.1:18091 (last-resort default)
`;

export async function runCli(argv: readonly string[], env: CliEnv): Promise<CliResult> {
  const args = [...argv];
  const json = takeFlag(args, "--json");
  if (takeFlag(args, "--help") || takeFlag(args, "-h")) {
    env.stdout(HELP_TEXT);
    return { exitCode: 0 };
  }
  // --base-url is consumed by the bin wrapper before it builds the client;
  // accept-and-ignore here so it doesn't trip parsing.
  takeFlagValue(args, "--base-url");

  const command = args.shift();
  if (!command) {
    env.stderr("error: command required\n");
    env.stderr(HELP_TEXT);
    return { exitCode: 2 };
  }

  try {
    switch (command) {
      case "status":
        return await cmdStatus(args, env, json);
      case "behaviors":
        return await cmdBehaviors(args, env, json);
      case "events":
        return await cmdEvents(args, env, json);
      case "pair":
        return await cmdPair(args, env, json);
      case "identity":
        return await cmdIdentity(args, env, json);
      case "unpair":
        return await cmdUnpair(args, env, json);
      default:
        env.stderr(`error: unknown command "${command}"\n`);
        env.stderr(HELP_TEXT);
        return { exitCode: 2 };
    }
  } catch (err) {
    env.stderr(`error: ${(err as Error).message}\n`);
    return { exitCode: 1 };
  }
}

// ---- commands ------------------------------------------------------------

async function cmdStatus(_args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  const status = await env.client.status();
  if (json) {
    env.stdout(`${JSON.stringify(status)}\n`);
    return { exitCode: 0 };
  }
  env.stdout(
    `daemon ok=${status.ok}  listening=${status.listening.host}:${status.listening.port}  startedAt=${status.startedAt}\n`,
  );
  env.stdout(
    `broker spaces=${status.brokerStats.spaces}  subscribers=${status.brokerStats.subscribers}  bufferedEvents=${status.brokerStats.bufferedEvents}\n`,
  );
  env.stdout(`behaviors (${status.behaviors.length}):\n`);
  for (const b of status.behaviors) {
    env.stdout(`  ${b.instanceId}  ${b.name}@${b.version}  loaded ${b.loadedAt}\n`);
  }
  return { exitCode: 0 };
}

async function cmdBehaviors(args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  const sub = args.shift();
  switch (sub) {
    case "list":
      return await cmdBehaviorsList(env, json);
    case "load":
      return await cmdBehaviorsLoad(args, env, json);
    case "unload":
      return await cmdBehaviorsUnload(args, env, json);
    case "call":
      return await cmdBehaviorsCall(args, env, json);
    default:
      env.stderr(`error: unknown subcommand "behaviors ${sub ?? ""}"\n`);
      return { exitCode: 2 };
  }
}

async function cmdBehaviorsList(env: CliEnv, json: boolean): Promise<CliResult> {
  const list = await env.client.listBehaviors();
  if (json) {
    env.stdout(`${JSON.stringify(list)}\n`);
    return { exitCode: 0 };
  }
  if (list.length === 0) {
    env.stdout("(no behaviors loaded)\n");
  } else {
    for (const b of list) {
      env.stdout(`${b.instanceId}\t${b.name}@${b.version}\t${b.loadedAt}\n`);
    }
  }
  return { exitCode: 0 };
}

async function cmdBehaviorsLoad(args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  const packageDir = args.shift();
  if (!packageDir) {
    env.stderr("error: behaviors load requires <packageDir>\n");
    return { exitCode: 2 };
  }
  const instanceId = takeFlagValue(args, "--instance");
  const result = await env.client.loadBehavior(packageDir, instanceId);
  if (json) {
    env.stdout(`${JSON.stringify(result)}\n`);
  } else {
    env.stdout(`loaded instanceId=${result.instanceId} loadedAt=${result.loadedAt}\n`);
  }
  return { exitCode: 0 };
}

async function cmdBehaviorsUnload(args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  const instanceId = args.shift();
  if (!instanceId) {
    env.stderr("error: behaviors unload requires <instanceId>\n");
    return { exitCode: 2 };
  }
  await env.client.unloadBehavior(instanceId);
  if (json) env.stdout(`${JSON.stringify({ ok: true })}\n`);
  else env.stdout(`unloaded ${instanceId}\n`);
  return { exitCode: 0 };
}

async function cmdBehaviorsCall(args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  const instanceId = args.shift();
  const method = args.shift();
  if (!instanceId || !method) {
    env.stderr("error: behaviors call requires <instanceId> <method> [JSON params]\n");
    return { exitCode: 2 };
  }
  const timeoutValue = takeFlagValue(args, "--timeout");
  let params: unknown = undefined;
  const paramsRaw = args.shift();
  if (paramsRaw !== undefined) {
    try {
      params = JSON.parse(paramsRaw);
    } catch (err) {
      env.stderr(`error: invalid JSON params: ${(err as Error).message}\n`);
      return { exitCode: 2 };
    }
  }
  const timeoutMs = timeoutValue ? Number(timeoutValue) : undefined;
  const out = await env.client.requestBehavior(instanceId, method, params, timeoutMs);
  if (json) {
    env.stdout(`${JSON.stringify(out)}\n`);
  } else if ("error" in out && out.error) {
    env.stderr(`error code=${out.error.code} message=${out.error.message}\n`);
    return { exitCode: 1 };
  } else {
    env.stdout(`${JSON.stringify(out.result)}\n`);
  }
  return { exitCode: 0 };
}

async function cmdEvents(args: string[], env: CliEnv, _json: boolean): Promise<CliResult> {
  const sub = args.shift();
  if (sub !== "tail") {
    env.stderr(`error: unknown subcommand "events ${sub ?? ""}"\n`);
    return { exitCode: 2 };
  }
  const spaceId = args.shift();
  if (!spaceId) {
    env.stderr("error: events tail requires <spaceId>\n");
    return { exitCode: 2 };
  }
  const lastEventId = takeFlagValue(args, "--since");
  const streamOptions: { lastEventId?: string } = {};
  if (lastEventId) streamOptions.lastEventId = lastEventId;
  for await (const event of env.client.streamEvents(spaceId, streamOptions)) {
    env.stdout(`${JSON.stringify(event)}\n`);
  }
  return { exitCode: 0 };
}

async function cmdPair(args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  const code = args.shift();
  if (!code) {
    env.stderr("error: pair requires <code>\n");
    return { exitCode: 2 };
  }
  const siteUrl = takeFlagValue(args, "--site-url") ?? process.env.CR_SITE_URL ?? "";
  if (!siteUrl) {
    env.stderr("error: --site-url <url> required (or set CR_SITE_URL)\n");
    return { exitCode: 2 };
  }
  const label = takeFlagValue(args, "--label");
  // Lazy-load to keep the CLI dep graph clean and let `--help` still work
  // without filesystem permissions.
  const { pairWithSite } = await import("@claude-remote/pc-connector-daemon");
  const os = process.platform;
  const hostname = (await import("node:os")).hostname();
  const opts: Parameters<typeof pairWithSite>[0] = {
    siteUrl,
    code,
    os,
    hostname,
  };
  if (label) opts.label = label;
  const result = await pairWithSite(opts);
  if (json) {
    env.stdout(`${JSON.stringify(result.identity)}\n`);
  } else {
    env.stdout(
      `paired as ${result.identity.deviceId} (label="${result.identity.label ?? ""}")\nsite=${result.identity.siteUrl}\nidentity stored — restart the daemon to pick it up\n`,
    );
  }
  return { exitCode: 0 };
}

async function cmdIdentity(_args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  const { readDeviceIdentity } = await import("@claude-remote/pc-connector-daemon");
  const identity = await readDeviceIdentity();
  if (!identity) {
    if (json) env.stdout("null\n");
    else env.stdout("(not paired — run `cr-connector pair <code> --site-url <url>`)\n");
    return { exitCode: 0 };
  }
  if (json) {
    env.stdout(`${JSON.stringify(identity)}\n`);
  } else {
    env.stdout(
      `deviceId: ${identity.deviceId}\nsite: ${identity.siteUrl}\npaired at: ${identity.pairedAt}\nlabel: ${identity.label ?? "(none)"}\n`,
    );
  }
  return { exitCode: 0 };
}

async function cmdUnpair(_args: string[], env: CliEnv, json: boolean): Promise<CliResult> {
  // Local-only: drops identity.json + private key file. Idempotent — a
  // second `unpair` after the first reports "already unpaired".
  // Site-side device row is NOT removed; that's a separate browser
  // action against DELETE /api/devices/:id (the user's session auth
  // gates it, so we don't widen the device-side auth surface here).
  const { removeDeviceIdentity } = await import("@claude-remote/pc-connector-daemon");
  const r = await removeDeviceIdentity();
  if (json) {
    env.stdout(`${JSON.stringify(r)}\n`);
  } else if (r.identityRemoved || r.keyRemoved) {
    env.stdout(
      `unpaired locally (was ${r.previousDeviceId ?? "unknown deviceId"})\n  identity.json removed: ${r.identityRemoved ? "yes" : "no"}\n  private key removed: ${r.keyRemoved ? "yes" : "no"}\nnote: site-side device row is NOT removed — delete it from the browser's Settings → Devices list if you want a clean slate.\n`,
    );
  } else {
    env.stdout("(already unpaired — nothing to remove)\n");
  }
  return { exitCode: 0 };
}

// ---- argv helpers --------------------------------------------------------

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
