// Load + validate a behavior package's manifest from disk.
//
// A behavior package is a directory containing at minimum:
//   - manifest.json   (matches @deskrelay/shared BehaviorManifest)
//   - the file referenced by manifest.entry
//
// Distribution mechanism (npm tarball, our registry, GitHub release) is
// orthogonal to this loader — by the time we get here, the bytes are on
// disk in a directory we own.

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { type BehaviorManifest, validateManifest } from "@deskrelay/shared/manifest";

export interface LoadedBehaviorPackage {
  /** Absolute path to the package directory. */
  packageDir: string;
  /** Validated manifest. */
  manifest: BehaviorManifest;
  /** Absolute path to the entry file (manifest.entry resolved against packageDir). */
  entryPath: string;
}

export class ManifestLoadError extends Error {
  constructor(
    message: string,
    readonly packageDir: string,
  ) {
    super(message);
    this.name = "ManifestLoadError";
  }
}

export async function loadBehaviorPackage(packageDir: string): Promise<LoadedBehaviorPackage> {
  // Always normalize via resolve() — even if the input is already absolute,
  // it may use the wrong slash style for the current OS. On Windows Bun,
  // `isAbsolute("C:/...")` returns true but the string keeps forward
  // slashes; resolve() converts them to backslashes so later
  // `startsWith` checks against other resolve() outputs match.
  const absDir = resolve(packageDir);

  const manifestPath = resolve(absDir, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    throw new ManifestLoadError(`cannot read manifest.json: ${(err as Error).message}`, absDir);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestLoadError(
      `manifest.json is not valid JSON: ${(err as Error).message}`,
      absDir,
    );
  }

  let manifest: BehaviorManifest;
  try {
    manifest = validateManifest(parsed);
  } catch (err) {
    throw new ManifestLoadError(`manifest validation failed: ${(err as Error).message}`, absDir);
  }

  const entryPath = resolve(absDir, manifest.entry);
  // Confine entry to the package directory — refuse paths that escape via "..".
  if (!entryPath.startsWith(absDir)) {
    throw new ManifestLoadError(
      `manifest.entry escapes package directory: ${manifest.entry}`,
      absDir,
    );
  }
  try {
    const s = await stat(entryPath);
    if (!s.isFile()) {
      throw new ManifestLoadError(`entry is not a file: ${entryPath}`, absDir);
    }
  } catch (err) {
    if (err instanceof ManifestLoadError) throw err;
    throw new ManifestLoadError(`cannot stat entry: ${(err as Error).message}`, absDir);
  }

  return { packageDir: absDir, manifest, entryPath };
}
