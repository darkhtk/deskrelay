#!/usr/bin/env bun
import {
  readAuthToken,
  readStateFile,
  stateFileToBaseUrl,
} from "@deskrelay/pc-connector-daemon";
import { runCli } from "./cli.ts";
import { CliClient } from "./client.ts";

const argv = process.argv.slice(2);

// Resolve daemon URL with this precedence:
//   1. --base-url <url>           (explicit on this command)
//   2. CR_CONNECTOR_URL env       (per-shell override)
//   3. daemon state file          (auto-discovery, no flags needed)
//   4. http://127.0.0.1:18091     (last-resort default)
let baseUrl: string | undefined;
const baseUrlIdx = argv.indexOf("--base-url");
if (baseUrlIdx !== -1 && argv[baseUrlIdx + 1]) {
  baseUrl = argv[baseUrlIdx + 1] as string;
} else if (process.env.CR_CONNECTOR_URL) {
  baseUrl = process.env.CR_CONNECTOR_URL;
} else {
  const state = await readStateFile().catch(() => undefined);
  if (state) baseUrl = stateFileToBaseUrl(state);
}
if (!baseUrl) baseUrl = "http://127.0.0.1:18091";

// Read the daemon's local auth token from auth.json (sibling of
// daemon.json). CR_CONNECTOR_TOKEN env overrides for ops/CI scripts
// that pass the token explicitly. Missing token = the daemon will
// 401, which surfaces as a clear "missing token" error message —
// the user just needs to (re)start the daemon to populate auth.json.
const authToken = process.env.CR_CONNECTOR_TOKEN ?? (await readAuthToken().catch(() => undefined));

const client = new CliClient({ baseUrl, ...(authToken ? { authToken } : {}) });
const result = await runCli(argv, {
  client,
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
});

process.exit(result.exitCode);
