// Targeted: spawnArgvForBehaviorHost picks the right argv for the two
// runtime flavors we ship — real Bun CLI vs cr-connector compiled
// single-file binary.
//
// Background: when the daemon is run from the compiled cr-connector
// binary (direct zip / Homebrew / future installer), `bunPath = process.execPath` points
// at cr-connector.exe, NOT the bun CLI. cr-connector has no `run`
// subcommand, so the previous `[bunPath, "run", entry]` invocation
// crashed every spawn with `error: unknown command "run"` and the
// behavior would never start (chat dead on packaged builds).
//
// The fix routes to the compiled binary's hidden `behavior-host` entry
// when the basename matches; everything else still gets `bun run`.

import { describe, expect, test } from "bun:test";
import { spawnArgvForBehaviorHost } from "../src/host.ts";

const ENTRY = "/repo/packages/behaviors/remote-claude/src/index.ts";

describe("spawnArgvForBehaviorHost", () => {
  test("real bun: uses `bun run <entry>` (dev / monorepo / system bun)", () => {
    expect(spawnArgvForBehaviorHost("/usr/local/bin/bun", ENTRY)).toEqual([
      "/usr/local/bin/bun",
      "run",
      ENTRY,
    ]);
  });

  test("real bun on Windows: same shape", () => {
    expect(spawnArgvForBehaviorHost("C:\\Users\\me\\.bun\\bin\\bun.exe", ENTRY)).toEqual([
      "C:\\Users\\me\\.bun\\bin\\bun.exe",
      "run",
      ENTRY,
    ]);
  });

  test("cr-connector compiled binary: uses `cr-connector behavior-host <entry>`", () => {
    expect(spawnArgvForBehaviorHost("/usr/local/bin/cr-connector", ENTRY)).toEqual([
      "/usr/local/bin/cr-connector",
      "behavior-host",
      ENTRY,
    ]);
  });

  test("cr-connector.exe (Windows packaged binary): same routing", () => {
    expect(
      spawnArgvForBehaviorHost("C:\\Program Files\\cr-connector\\cr-connector.exe", ENTRY),
    ).toEqual(["C:\\Program Files\\cr-connector\\cr-connector.exe", "behavior-host", ENTRY]);
  });

  test("case-insensitive on the basename (Cr-Connector / CR_CONNECTOR.exe)", () => {
    expect(spawnArgvForBehaviorHost("/opt/Cr-Connector", ENTRY)[1]).toBe("behavior-host");
    expect(spawnArgvForBehaviorHost("/opt/CR_CONNECTOR.exe", ENTRY)[1]).toBe("behavior-host");
  });

  test("unrelated binary names default to `bun run` (operator's escape hatch)", () => {
    // If someone ships a custom wrapper with a different name and
    // sets CR_CONNECTOR_BUN_PATH, we treat it as a real bun-compatible
    // CLI. They can either rename their wrapper or set CR_CONNECTOR_BUN_PATH
    // to a real bun.
    expect(spawnArgvForBehaviorHost("/opt/my-custom-bun", ENTRY)).toEqual([
      "/opt/my-custom-bun",
      "run",
      ENTRY,
    ]);
  });

  test("does not match a `cr-connector-cli` lookalike (only the daemon binary owns `behavior-host`)", () => {
    expect(spawnArgvForBehaviorHost("/usr/local/bin/cr-connector-cli", ENTRY)).toEqual([
      "/usr/local/bin/cr-connector-cli",
      "run",
      ENTRY,
    ]);
  });

  test("GitHub release artifact filenames (cr-connector-<platform>-<arch>) route to behavior-host", () => {
    // The release pipeline uploads the compiled binary under names like
    // `cr-connector-windows-x64.exe` directly into the user's
    // %LOCALAPPDATA%\cr-connector after Expand-Archive. Without this,
    // the daemon's auto-loaded remote-claude behavior crashes at
    // spawn with `unknown command "run"` because the pre-fix regex
    // only matched the bare `cr-connector(.exe)?` name.
    expect(
      spawnArgvForBehaviorHost(
        "C:\\Users\\me\\AppData\\Local\\cr-connector\\cr-connector-windows-x64.exe",
        ENTRY,
      )[1],
    ).toBe("behavior-host");
    expect(
      spawnArgvForBehaviorHost("/usr/local/bin/cr-connector-darwin-arm64", ENTRY)[1],
    ).toBe("behavior-host");
    expect(spawnArgvForBehaviorHost("/usr/local/bin/cr-connector-darwin-x64", ENTRY)[1]).toBe(
      "behavior-host",
    );
    expect(spawnArgvForBehaviorHost("/usr/local/bin/cr-connector-linux-x64", ENTRY)[1]).toBe(
      "behavior-host",
    );
  });
});
