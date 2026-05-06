// build-web.ts — Capacitor's webDir input.
//
// 1. Lets VITE_API_BASE_URL point at the user's self-host backend when
//    provided. If unset, the SPA keeps the normal relative /api path.
//    Mobile WebView builds usually need an explicit self-host backend:
//      VITE_API_BASE_URL=https://my-fork.example.com bun run build:web
//
// 2. Runs the site-frontend production build with that env.
//
// 3. Syncs the resulting dist into ./dist via the cross-platform copy
//    helper (the previous shell `cp -r` broke under Windows + busybox).

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

// Use process.execPath so we don't rely on `bun` being on PATH inside
// child shells — on Windows the binary is `bun.exe` and PATH may differ
// between the parent shell and `cmd.exe` that `shell: true` spawns.
const bun = process.execPath;
const apiBase = process.env.VITE_API_BASE_URL?.trim() ?? "";
const frontendEnv = { ...process.env };
if (apiBase) frontendEnv.VITE_API_BASE_URL = apiBase;
else delete frontendEnv.VITE_API_BASE_URL;
console.log(
  `[mobile-app] building site-frontend with VITE_API_BASE_URL=${apiBase || "(relative / same-origin)"}`,
);

await runStep(bun, ["--filter", "@claude-remote/site-frontend", "build"], frontendEnv);
await runStep(bun, ["run", resolve(here, "sync-web.ts")], process.env);

async function runStep(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const proc = spawn(cmd, args, { cwd: repoRoot, env, stdio: "inherit", shell: true });
  const code: number | null = await new Promise((res) => proc.on("close", res));
  if (code !== 0) {
    throw new Error(`build-web step failed: ${cmd} ${args.join(" ")} (exit ${code})`);
  }
}
