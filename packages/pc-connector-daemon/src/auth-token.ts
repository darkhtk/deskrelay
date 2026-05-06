// auth-token.ts — per-daemon shared secret used to authenticate every
// HTTP route the daemon exposes on 127.0.0.1.
//
// Why: the daemon binds localhost-only, but anything else on the same
// machine — a stray browser tab on http://localhost:18091, an unrelated
// CLI script, malware running as the user — could otherwise drive
// approval responses, load behaviors, or list the user's filesystem.
// A 256-bit token in a chmod-600 sibling file blocks that without
// adding any deployment friction (the daemon, CLI, and SiteWsClient
// all run as the same OS user and read the same file).
//
// Layout: <state-dir>/auth.json — sibling to daemon.json from
// state-file.ts. Two distinct files so we can chmod 600 the sensitive
// one without surprising tools that read daemon.json.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chmod600Best } from "./chmod-best.ts";
import { defaultStateDir } from "./state-file.ts";

export interface AuthFile {
  /** Hex-encoded 32 bytes of CSPRNG output. */
  token: string;
  /** ISO timestamp of generation; informational. */
  createdAt: string;
}

export interface LoadedAuth {
  token: string;
  /** Resolved absolute path of the auth file (may have been created). */
  path: string;
  /** True iff this call generated the token; used by bin.ts for a one-
   *  time log line. */
  created: boolean;
}

export function defaultAuthFilePath(): string {
  if (process.env.CR_CONNECTOR_AUTH_FILE) return process.env.CR_CONNECTOR_AUTH_FILE;
  return join(defaultStateDir(), "auth.json");
}

/** Read the existing token, or generate + persist a new one. Idempotent
 *  across daemon restarts: a daemon that already wrote auth.json keeps
 *  the same token across reboots so paired tools (CLI, SiteWsClient)
 *  don't need to re-read after every relaunch. */
export async function loadOrCreateAuthToken(path = defaultAuthFilePath()): Promise<LoadedAuth> {
  const existing = await readAuthFile(path);
  if (existing) return { token: existing.token, path, created: false };
  const token = randomBytes(32).toString("hex");
  const file: AuthFile = { token, createdAt: new Date().toISOString() };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await chmod600Best(path);
  return { token, path, created: true };
}

export async function readAuthFile(path = defaultAuthFilePath()): Promise<AuthFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as AuthFile).token !== "string" ||
    (parsed as AuthFile).token.length === 0
  ) {
    return undefined;
  }
  return parsed as AuthFile;
}

/** Convenience for the CLI / self-host site backend: read but don't
 *  generate. Returns undefined when the daemon has never run. */
export async function readAuthToken(path = defaultAuthFilePath()): Promise<string | undefined> {
  const file = await readAuthFile(path);
  return file?.token;
}
