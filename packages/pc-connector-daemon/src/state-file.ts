// state-file.ts — small helper for the daemon ↔ CLI rendezvous file.
//
// Intent: the user shouldn't have to remember (or pass) the daemon URL on
// every CLI invocation. The daemon writes a tiny JSON file on start
// listing host/port/pid; the CLI reads it as the default --base-url.
//
// Default location: $XDG_STATE_HOME/claude-remote/daemon.json on Linux,
// %LOCALAPPDATA%\claude-remote\daemon.json on Windows, ~/Library/
// Application Support/claude-remote/daemon.json on macOS.
// Override via $CR_CONNECTOR_STATE_FILE.
//
// On graceful shutdown the daemon should call clearStateFile(); on a
// crash the file may linger — the CLI does a cheap reachability check
// before treating it as authoritative.

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DaemonStateFile {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  /** SemVer of the running daemon (informational; CLI doesn't enforce). */
  version?: string;
}

export function defaultStateDir(): string {
  if (process.env.CR_CONNECTOR_STATE_DIR) return process.env.CR_CONNECTOR_STATE_DIR;
  if (process.platform === "win32") {
    const appData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(appData, "claude-remote");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "claude-remote");
  }
  const xdg = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(xdg, "claude-remote");
}

export function defaultStateFilePath(): string {
  if (process.env.CR_CONNECTOR_STATE_FILE) return process.env.CR_CONNECTOR_STATE_FILE;
  return join(defaultStateDir(), "daemon.json");
}

export async function writeStateFile(
  state: DaemonStateFile,
  path = defaultStateFilePath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function readStateFile(
  path = defaultStateFilePath(),
): Promise<DaemonStateFile | undefined> {
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
    typeof (parsed as DaemonStateFile).host !== "string" ||
    typeof (parsed as DaemonStateFile).port !== "number" ||
    typeof (parsed as DaemonStateFile).pid !== "number"
  ) {
    return undefined;
  }
  return parsed as DaemonStateFile;
}

export async function clearStateFile(path = defaultStateFilePath()): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function stateFileToBaseUrl(state: DaemonStateFile): string {
  return `http://${state.host}:${state.port}`;
}
