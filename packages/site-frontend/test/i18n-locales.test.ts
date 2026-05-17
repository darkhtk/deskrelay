import { readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type Messages = Record<string, string>;

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDir, "..");
const localeDir = join(packageRoot, "src", "locales");
const sourceRoot = join(packageRoot, "src");

function readLocale(fileName: string): Messages {
  return JSON.parse(readFileSync(join(localeDir, fileName), "utf8"));
}

function localeDictionaries(): Record<string, Messages> {
  return Object.fromEntries(
    readdirSync(localeDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => [fileName.replace(/\.json$/, ""), readLocale(fileName)]),
  );
}

function sortedKeys(messages: Messages): string[] {
  return Object.keys(messages).sort();
}

function placeholders(value: string): string[] {
  return Array.from(
    value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g),
    (match) => match[1] ?? "",
  ).sort();
}

function walkSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const target = join(dir, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(target);
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".d.ts"))
      return [];
    return [target];
  });
}

function staticTranslationRefs(): string[] {
  const refs = new Set<string>();
  for (const filePath of walkSourceFiles(sourceRoot)) {
    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(/\b(t|tn)\(\s*["']([^"']+)["']/g)) {
      const kind = match[1];
      const key = match[2];
      if (!key) continue;
      if (kind === "tn") {
        refs.add(`${key}.singular`);
        refs.add(`${key}.plural`);
      } else {
        refs.add(key);
      }
    }
  }
  return Array.from(refs)
    .filter((key) => !key.endsWith("."))
    .sort();
}

describe("locale dictionaries", () => {
  const dictionaries = localeDictionaries();
  const korean = dictionaries.ko ?? {};

  test("Korean is the default locale and English is selectable", () => {
    expect(Object.keys(dictionaries).sort()).toEqual(["en", "ko"]);
  });

  test("non-Korean locale keys are valid Korean fallback keys", () => {
    const mismatches = Object.entries(dictionaries)
      .filter(([locale]) => locale !== "ko")
      .flatMap(([locale, messages]) =>
        sortedKeys(messages)
          .filter((key) => !(key in korean))
          .map((key) => `${locale} extra ${key}`),
      );

    expect(mismatches).toEqual([]);
  });

  test("all locale placeholders match Korean", () => {
    const mismatches = Object.entries(dictionaries)
      .filter(([locale]) => locale !== "ko")
      .flatMap(([locale, messages]) =>
        sortedKeys(messages).flatMap((key) => {
          const expected = placeholders(korean[key] ?? "").join(",");
          const actual = placeholders(messages[key] ?? "").join(",");
          return expected === actual
            ? []
            : `${locale} ${key}: expected {${expected}}, got {${actual}}`;
        }),
      );

    expect(mismatches).toEqual([]);
  });

  test("Korean locale contains all statically referenced translation keys", () => {
    const missing = staticTranslationRefs().filter((key) => !(key in korean));
    const labeledMissing = missing.map((key) => `${key} from ${relative(packageRoot, sourceRoot)}`);

    expect(labeledMissing).toEqual([]);
  });
});
