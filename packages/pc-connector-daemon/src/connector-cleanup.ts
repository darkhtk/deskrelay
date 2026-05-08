// connector-cleanup — local uninstall helpers for cr-connector.
//
// Scope is intentionally local-only: this removes files the connector
// owns on this PC, but it does not delete the site-side device row. The
// browser Settings → Devices flow already owns that authenticated delete.

import { rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { defaultAuthFilePath } from "./auth-token.ts";
import { defaultIdentityDir } from "./device-identity.ts";
import { WINDOWS_LOGIN_TASK_SCRIPT_NAME } from "./login-task.ts";
import { defaultStateDir, defaultStateFilePath } from "./state-file.ts";

export interface RemoveConnectorLocalStateOptions {
  stateDir?: string;
  authFilePath?: string;
  stateFilePath?: string;
  identityDir?: string;
  behaviorsDir?: string;
  loginTaskScriptPath?: string;
  logsDir?: string;
}

export interface RemoveConnectorLocalStateResult {
  stateDir: string;
  authRemoved: boolean;
  daemonStateRemoved: boolean;
  identityDirRemoved: boolean;
  behaviorsDirRemoved: boolean;
  loginTaskScriptRemoved: boolean;
  logsDirRemoved: boolean;
  stateDirRemoved: boolean;
  removedAny: boolean;
}

export async function removeConnectorLocalState(
  opts: RemoveConnectorLocalStateOptions = {},
): Promise<RemoveConnectorLocalStateResult> {
  const stateDir = opts.stateDir ?? defaultStateDir();
  const authFilePath = opts.authFilePath ?? defaultAuthFilePath();
  const stateFilePath = opts.stateFilePath ?? defaultStateFilePath();
  const identityDir = opts.identityDir ?? defaultIdentityDir();
  const behaviorsDir = opts.behaviorsDir ?? join(stateDir, "behaviors");
  const loginTaskScriptPath =
    opts.loginTaskScriptPath ?? join(stateDir, WINDOWS_LOGIN_TASK_SCRIPT_NAME);
  const logsDir = opts.logsDir ?? join(stateDir, "logs");

  const daemonStateRemoved = await removeIfPresent(stateFilePath);
  const authRemoved = await removeIfPresent(authFilePath);
  const identityDirRemoved = await removeIfPresent(identityDir);
  const behaviorsDirRemoved = await removeIfPresent(behaviorsDir);
  const loginTaskScriptRemoved = await removeIfPresent(loginTaskScriptPath);
  const logsDirRemoved = await removeIfPresent(logsDir);
  const stateDirRemoved = await removeEmptyDir(stateDir);

  return {
    stateDir,
    authRemoved,
    daemonStateRemoved,
    identityDirRemoved,
    behaviorsDirRemoved,
    loginTaskScriptRemoved,
    logsDirRemoved,
    stateDirRemoved,
    removedAny:
      authRemoved ||
      daemonStateRemoved ||
      identityDirRemoved ||
      behaviorsDirRemoved ||
      loginTaskScriptRemoved ||
      logsDirRemoved ||
      stateDirRemoved,
  };
}

async function removeIfPresent(path: string): Promise<boolean> {
  const existed = await exists(path);
  await rm(path, { recursive: true, force: true });
  return existed;
}

async function removeEmptyDir(path: string): Promise<boolean> {
  try {
    await rmdir(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") return false;
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
