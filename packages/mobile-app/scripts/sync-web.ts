// Copies the freshly-built site-frontend dist into ./dist so Capacitor's
// `cap sync` picks it up as the WebView bundle. Cross-platform via Bun's
// built-in fs (the previous shell `cp -r` broke under Windows / busybox).

import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDist = resolve(here, "..", "..", "site-frontend", "dist");
const targetDist = resolve(here, "..", "dist");

await rm(targetDist, { recursive: true, force: true });
await cp(sourceDist, targetDist, { recursive: true });

console.log(`synced ${sourceDist} → ${targetDist}`);
