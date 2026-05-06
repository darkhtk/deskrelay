// behavior-fetcher — resolve a behavior source descriptor to a local
// package directory (with manifest.json + entry).
//
// Source kinds (M7.5.4 — minimal):
//   { kind: "local", packageDir }    — already on disk; pass through.
//   { kind: "registry", url }        — claude-remote-platform://behaviors/<name>
//                                       (alias: cr-platform://behaviors/<name>)
//                                       resolves to the bundled
//                                       packages/behaviors/<name>/ for
//                                       first-party / dev. Production
//                                       (M9) maps it to a R2 tarball.
//   { kind: "npm", package }         — fetch from npm, extract tarball.
//   { kind: "github", repo, ref? }   — fetch from GitHub release tarball.
//
// Cache layout: ~/.claude-remote/behaviors/<name>/<version>/
// First time: download + extract + write manifest. Subsequent loads
// short-circuit on the cached dir.

import { mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { defaultStateDir } from "./state-file.ts";

export type BehaviorSource =
  | { kind: "local"; packageDir: string }
  | { kind: "registry"; url: string }
  | { kind: "npm"; package: string; version?: string }
  | { kind: "github"; repo: string; ref?: string };

export interface BehaviorFetcherOptions {
  /** Cache root. Default: defaultStateDir() / "behaviors". */
  cacheDir?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** First-party behaviors lookup table — for `claude-remote-platform://behaviors/<name>`
   *  (or the `cr-platform://` alias) the fetcher returns
   *  `firstPartyDirs.get(name)` directly without hitting the network.
   *  Lets the bundled monorepo install behaviors in dev without a registry. */
  firstPartyDirs?: Map<string, string>;
}

export interface FetchedPackage {
  /** Absolute path to a directory containing manifest.json + entry. */
  packageDir: string;
  /** What we ended up using (resolved version, source URL). */
  resolved: BehaviorSource;
}

export class BehaviorFetcherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BehaviorFetcherError";
  }
}

// `claude-remote-platform://` is the canonical scheme (matches the
// marketplace catalog data and the public docs); `cr-platform://` is
// kept as a back-compat alias for older callers and existing tests.
const REGISTRY_URL_PATTERN =
  /^(?:claude-remote-platform|cr-platform):\/\/behaviors\/([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)$/;

export class BehaviorFetcher {
  readonly #cacheDir: string;
  /** Reserved for future npm/github fetch implementations; unused until M9. */
  readonly _fetch: typeof fetch;
  readonly #firstParty: Map<string, string>;

  constructor(options: BehaviorFetcherOptions = {}) {
    this.#cacheDir = options.cacheDir ?? join(defaultStateDir(), "behaviors");
    this._fetch = options.fetchImpl ?? fetch;
    this.#firstParty = options.firstPartyDirs ?? new Map();
  }

  async fetchSource(source: BehaviorSource): Promise<FetchedPackage> {
    if (source.kind === "local") {
      return await this.#useLocal(source.packageDir);
    }
    if (source.kind === "registry") {
      return await this.#useRegistry(source.url);
    }
    if (source.kind === "npm") {
      throw new BehaviorFetcherError("npm source kind not implemented yet (M9 follow-up)");
    }
    if (source.kind === "github") {
      throw new BehaviorFetcherError("github source kind not implemented yet (M9 follow-up)");
    }
    throw new BehaviorFetcherError(`unknown source kind: ${(source as { kind: string }).kind}`);
  }

  /** Convenience: parse a free-form URL string into a BehaviorSource.
   *  Used by the daemon's HTTP API where callers send a URL string,
   *  not a typed source object. */
  static parseSourceUrl(input: string): BehaviorSource {
    const trimmed = input.trim();
    if (!trimmed) throw new BehaviorFetcherError("empty source URL");
    if (trimmed.startsWith("claude-remote-platform://") || trimmed.startsWith("cr-platform://")) {
      return { kind: "registry", url: trimmed };
    }
    if (trimmed.startsWith("npm://")) {
      const rest = trimmed.slice("npm://".length);
      const at = rest.lastIndexOf("@");
      if (at > 0) {
        return { kind: "npm", package: rest.slice(0, at), version: rest.slice(at + 1) };
      }
      return { kind: "npm", package: rest };
    }
    if (trimmed.startsWith("github://")) {
      const rest = trimmed.slice("github://".length);
      const at = rest.lastIndexOf("@");
      if (at > 0) {
        return { kind: "github", repo: rest.slice(0, at), ref: rest.slice(at + 1) };
      }
      return { kind: "github", repo: rest };
    }
    if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
      // Looks like a local absolute path.
      return { kind: "local", packageDir: trimmed };
    }
    throw new BehaviorFetcherError(`unsupported source URL: ${input}`);
  }

  // ---- internals -----------------------------------------------------

  async #useLocal(packageDir: string): Promise<FetchedPackage> {
    const abs = resolvePath(packageDir);
    await this.#assertManifestExists(abs);
    return { packageDir: abs, resolved: { kind: "local", packageDir: abs } };
  }

  async #useRegistry(url: string): Promise<FetchedPackage> {
    const m = url.match(REGISTRY_URL_PATTERN);
    if (!m) {
      throw new BehaviorFetcherError(
        `invalid registry URL (expected claude-remote-platform://behaviors/<name>): ${url}`,
      );
    }
    const name = m[1] as string;
    const local = this.#firstParty.get(name);
    if (local) {
      // Use the bundled monorepo dir directly (dev mode).
      const abs = resolvePath(local);
      await this.#assertManifestExists(abs);
      return { packageDir: abs, resolved: { kind: "registry", url } };
    }
    // Future: fetch package archives from a user-configured source
    // mirror, extract under cacheDir/<name>/<version>/, return that
    // path. M7.5.4 stops here — operators wire firstPartyDirs.
    throw new BehaviorFetcherError(
      `behavior "${name}" is not in firstPartyDirs and remote registry fetch is not implemented yet`,
    );
  }

  async #assertManifestExists(packageDir: string): Promise<void> {
    const manifest = join(packageDir, "manifest.json");
    try {
      const s = await stat(manifest);
      if (!s.isFile()) throw new Error("manifest.json is not a file");
    } catch (err) {
      throw new BehaviorFetcherError(
        `package dir is missing manifest.json (${packageDir}): ${(err as Error).message}`,
      );
    }
  }

  /** Read (don't validate) the manifest of a fetched package. The
   *  caller usually re-validates via behavior-sdk's loadBehaviorPackage. */
  async readRawManifest(packageDir: string): Promise<Record<string, unknown>> {
    const text = await readFile(join(packageDir, "manifest.json"), "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  }

  async ensureCacheDir(): Promise<void> {
    await mkdir(this.#cacheDir, { recursive: true });
  }
}
