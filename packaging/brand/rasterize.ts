// rasterize.ts — convert the SVG brand assets to PNGs at the sizes
// stores / favicons need. Uses @resvg/resvg-js (WASM librsvg port) so
// no headless browser launch is required — it's a single in-process
// call that renders SVG → PNG buffer in milliseconds.
//
// Run: bun run packaging/brand/rasterize.ts

import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

interface Job {
  src: string;
  out: string;
  width: number;
  /** Height is derived from SVG aspect ratio when omitted; the lockup
   *  jobs need a different aspect than the square mark, so resvg's
   *  fitTo strategy ("width") preserves the SVG's intrinsic ratio. */
}

const JOBS: Job[] = [
  // Coral mark on transparent — for sidebars / READMEs.
  { src: "logo-mark.svg", out: "logo-mark-256.png", width: 256 },
  { src: "logo-mark.svg", out: "logo-mark-512.png", width: 512 },
  { src: "logo-mark.svg", out: "logo-mark-1024.png", width: 1024 },

  // Cream mark on coral square — Store icon, dock, taskbar, favicon ≥64.
  { src: "logo-mark-on-coral.svg", out: "logo-mark-on-coral-256.png", width: 256 },
  { src: "logo-mark-on-coral.svg", out: "logo-mark-on-coral-512.png", width: 512 },
  { src: "logo-mark-on-coral.svg", out: "logo-mark-on-coral-1024.png", width: 1024 },

  // Horizontal lockup, light theme — for site headers, READMEs, OG.
  { src: "logo-lockup.svg", out: "logo-lockup-720.png", width: 720 },
  { src: "logo-lockup.svg", out: "logo-lockup-1440.png", width: 1440 },

];

for (const job of JOBS) {
  const svg = await readFile(join(here, job.src), "utf8");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: job.width },
    background: "rgba(0,0,0,0)",
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  const outPath = join(here, job.out);
  await writeFile(outPath, png);
  const sizeKb = Math.round(png.byteLength / 102.4) / 10;
  console.log(`  ${job.out.padEnd(36)} width=${job.width}  ${sizeKb} KB`);
}

console.log(`\ndone. ${JOBS.length} PNGs written under ${here}.`);
