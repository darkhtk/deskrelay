#!/usr/bin/env bun
// build-locales.ts — parse docs/LOCALIZATION-STRINGS.md and emit
// packages/site-frontend/src/locales/{en,ko,ja,ru}.json with one
// flat key→string map per locale. Idempotent: rerun anytime the md
// changes.
//
// Tables in the md look like:
//
//   | key | type | en | ko | ja | ru |
//   |-----|------|-----|-----|-----|-----|
//   | `app.brand` | heading | `DeskRelay` | ... | ... | ... |
//
// Long-form blocks (legal pages) follow a `### \`legal.*.body\``
// heading and contain four ```html``` fenced blocks, each preceded by
// `#### English` / `#### 한국어` / `#### 日本語` / `#### Русский`.
//
// We don't pull a Markdown library — single regex pass per shape.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const sourceMd = resolve(repoRoot, "docs", "LOCALIZATION-STRINGS.md");
const outDir = resolve(repoRoot, "packages", "site-frontend", "src", "locales");

const LOCALES = ["en", "ko", "ja", "ru"] as const;
type Locale = (typeof LOCALES)[number];

const HEADER_NAMES: Record<string, Locale> = {
  english: "en",
  한국어: "ko",
  日本語: "ja",
  русский: "ru",
};

interface ParseResult {
  rows: number;
  longBlocks: number;
  perLocale: Record<Locale, Record<string, string>>;
}

async function main(): Promise<void> {
  const md = await readFile(sourceMd, "utf8");
  const result = parse(md);
  await mkdir(outDir, { recursive: true });
  for (const locale of LOCALES) {
    const path = resolve(outDir, `${locale}.json`);
    const dict = sortedDict(result.perLocale[locale]);
    await writeFile(path, `${JSON.stringify(dict, null, 2)}\n`, "utf8");
    const count = Object.keys(dict).length;
    console.log(`  ${locale}.json — ${count} keys`);
  }
  console.log(
    `parsed ${result.rows} table rows + ${result.longBlocks} long-form blocks → ${outDir}`,
  );
}

function parse(md: string): ParseResult {
  const perLocale: Record<Locale, Record<string, string>> = {
    en: {},
    ko: {},
    ja: {},
    ru: {},
  };
  let rows = 0;
  // ---- Tables ---------------------------------------------------------
  // Match a row that has at least 6 cells (key, type, en, ko, ja, ru).
  // Skip header / separator rows by requiring the first cell to be
  // wrapped in backticks (which our `key` column always is).
  const tableRow =
    /^\|\s*`([^`]+)`\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/gm;
  let m: RegExpExecArray | null = tableRow.exec(md);
  while (m !== null) {
    const key = m[1]?.trim();
    if (key) {
      perLocale.en[key] = unwrap(m[3] ?? "");
      perLocale.ko[key] = unwrap(m[4] ?? "");
      perLocale.ja[key] = unwrap(m[5] ?? "");
      perLocale.ru[key] = unwrap(m[6] ?? "");
      rows += 1;
    }
    m = tableRow.exec(md);
  }
  // ---- Long-form blocks (legal pages) --------------------------------
  // A `### \`legal.*.body\`` heading followed by four `#### <lang>` +
  // ```html``` code fences. We emit one key per (legal-key, locale).
  const longBlocks = parseLongBlocks(md, perLocale);
  return { rows, longBlocks, perLocale };
}

function parseLongBlocks(md: string, perLocale: Record<Locale, Record<string, string>>): number {
  let blocks = 0;
  // Find each `### \`legal.<name>.body\`` heading and the slice up to
  // the next `###` (or EOF). Inside that slice, pull `#### <lang>`
  // headings and the ```html ... ``` block that immediately follows.
  const headingRe = /^###\s+`(legal\.[a-z]+\.body)`/gm;
  const headings: Array<{ key: string; index: number }> = [];
  let h: RegExpExecArray | null = headingRe.exec(md);
  while (h !== null) {
    headings.push({ key: h[1] ?? "", index: h.index });
    h = headingRe.exec(md);
  }
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i]?.index ?? 0;
    const next = headings[i + 1];
    const end = next ? next.index : findNextHeading(md, start + 1);
    const slice = md.slice(start, end);
    const langRe = /^####\s+(\S+)\s*\r?\n+```html\r?\n([\s\S]*?)\r?\n```/gm;
    let lm: RegExpExecArray | null = langRe.exec(slice);
    while (lm !== null) {
      const langName = lm[1]?.trim().toLowerCase() ?? "";
      const body = (lm[2] ?? "").replace(/\r\n/g, "\n");
      const locale = HEADER_NAMES[langName];
      if (locale) {
        const key = headings[i]?.key ?? "";
        if (key) {
          perLocale[locale][key] = body.trim();
          blocks += 1;
        }
      }
      lm = langRe.exec(slice);
    }
  }
  return blocks;
}

function findNextHeading(md: string, from: number): number {
  // First `## ` or `### ` starting at column 0 after `from`.
  const re = /^#{2,3}\s/gm;
  re.lastIndex = from;
  const m = re.exec(md);
  return m ? m.index : md.length;
}

function unwrap(cell: string): string {
  let s = cell.trim();
  // Strip a leading + trailing single backtick (the md tables wrap
  // every value in `…` for monospace rendering). We accept missing
  // backticks too because some cells span backtick boundaries (e.g.
  // mixed text + code).
  if (s.startsWith("`") && s.endsWith("`") && s.length >= 2) {
    s = s.slice(1, -1);
  }
  // Markdown escapes for the table format: `\|` for literal pipes
  // (not currently used but safe to handle), and HTML entity decode
  // for any rare cases.
  s = s.replace(/\\\|/g, "|");
  return s;
}

function sortedDict(d: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(d)
      .sort()
      .map((k) => [k, d[k] ?? ""]),
  );
}

await main();
