#!/usr/bin/env bun

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const scanRoots = ["README.md", "docs", "packages/site-frontend/src/content"];
const forbidden = [
  "Cloudflare",
  "MSIX",
  "Microsoft Store",
  "Lemon Squeezy",
  "LemonSqueezy",
  "winget",
];

const markdownFiles: string[] = [];
for (const root of scanRoots) {
  await collectMarkdown(resolve(repoRoot, root), markdownFiles);
}

const findings: Array<{ file: string; line: number; term: string; text: string }> = [];
for (const file of markdownFiles.sort()) {
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const term of forbidden) {
      if (!line.toLowerCase().includes(term.toLowerCase())) continue;
      findings.push({
        file: relative(repoRoot, file).replace(/\\/g, "/"),
        line: index + 1,
        term,
        text: line.trim(),
      });
    }
  });
}

if (findings.length > 0) {
  console.error("Self-host docs contain product-only terms:");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.term}: ${finding.text}`);
  }
  process.exit(1);
}

console.log(
  `OK self-host docs forbidden-term scan passed (${markdownFiles.length} markdown files)`,
);

async function collectMarkdown(path: string, out: string[]): Promise<void> {
  const s = await stat(path);
  if (s.isFile()) {
    if (path.toLowerCase().endsWith(".md")) out.push(path);
    return;
  }
  if (!s.isDirectory()) return;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdown(child, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(child);
    }
  }
}
