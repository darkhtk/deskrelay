// Build a self-contained cr-connector executable for the host platform.
//
// `bun build --compile` packages the daemon entry + every dep — including
// the in-process remote-claude behavior imported as a workspace package —
// into a single native exe with the Bun runtime embedded. No external
// behaviors/ folder, no spawn pipeline, no JSONRPC stdio for first-party
// behaviors. The site's "Add a device" UX links to this file so users
// get pairing + daemon in one download.
//
// Layout produced under packages/pc-connector-daemon/dist/:
//   cr-connector-{os}-{arch}[.exe]   ← single self-contained binary

import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const repoRoot = resolve(pkgDir, "..", "..");
const distDir = join(pkgDir, "dist");
const entry = join(pkgDir, "src", "bin.ts");

// Optional cross-compile target. `bun build --compile` accepts a target
// like `bun-windows-x64-modern`, `bun-darwin-arm64`, etc. — defaults to
// the host so a Windows dev producing a Windows release just runs
// `bun run build:binary`. To produce all 4 supported variants:
//   for t in win-x64 darwin-arm64 darwin-x64 linux-x64; do BUN_TARGET=bun-$t bun run build:binary; done
const target = process.env.BUN_TARGET; // e.g. bun-windows-x64-modern; undefined = host
const platformSuffix = target
  ? target.replace(/^bun-/, "").replace(/-modern$/, "")
  : `${process.platform}-${process.arch}`;
const exeExt =
  (target ?? process.platform).includes("windows") || process.platform === "win32" ? ".exe" : "";
const outFile = join(distDir, `cr-connector-${platformSuffix}${exeExt}`);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

console.log(`[build-binary] entry: ${entry}`);
console.log(`[build-binary] out:   ${outFile}`);
console.log(`[build-binary] target:${target ?? "(host)"}`);

const compileArgs = ["build", "--compile", entry, "--outfile", outFile];
if (target) compileArgs.push("--target", target);

await runStep(process.execPath, compileArgs, repoRoot);

// Behaviors are no longer copied next to the binary — `remote-claude` is
// imported as a workspace package by bin.ts (loaded in-process via
// BehaviorRegistry.loadInProcess), so `bun build --compile` already baked
// it into the binary above. Earlier releases shipped a sibling
// `behaviors/<name>/` tree because the daemon spawned each behavior as a
// subprocess and needed manifest + entry on disk; with subprocess gone
// for first-party behaviors, the tree gone too. The release zip is now
// just the single exe.
//
// (The PreToolUse hook script under `behaviors/remote-claude/src/hooks/`
// is import()'d by claude-runner via `import.meta.url` resolution. With
// the binary path, that resolution lands inside Bun's embedded fs — only
// matters when CR_CONNECTOR_APPROVALS=1 is set, which the binary
// distribution doesn't enable by default. Revisit if/when we wire the
// approval gate to the compiled binary path.)

// Print the produced layout so CI logs make it obvious what to ship.
const tree = await collectTree(distDir);
console.log("\n[build-binary] dist contents:");
for (const item of tree) console.log(`  ${item}`);

async function runStep(cmd: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveStep, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "inherit", shell: true });
    proc.on("close", (code) => {
      if (code === 0) resolveStep();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
    proc.on("error", reject);
  });
}

async function collectTree(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const info = await stat(full);
    const sizeStr = info.isFile() ? ` (${(info.size / 1024).toFixed(1)} KB)` : "";
    out.push(`${prefix}${entry}${sizeStr}`);
    if (info.isDirectory()) {
      out.push(...(await collectTree(full, `${prefix}  `)));
    }
  }
  return out;
}
