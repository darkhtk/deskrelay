// Targeted: `cr-connector behavior-host <entry>` actually evaluates the
// entry inside the daemon's bin.ts process — not as `bun run`, which is
// what the compiled cr-connector binary cannot do.
//
// Repro of the original bug: behavior-sdk used `[bunPath, "run", entry]`
// in spawnBehaviorHost. When bunPath = process.execPath AND the daemon
// runs from the compiled cr-connector single-file binary, that becomes
// `cr-connector run <entry>`, hits bin.ts's "unknown command" branch,
// exits 2. This test stands up the dev-mode equivalent (running bin.ts
// via Bun directly) and asserts that `behavior-host` is recognised and
// actually imports the file.
//
// We use a marker-file side effect because passing data back via stdout
// is racy with whatever the imported module decides to print — the
// imported module owns stdio in the real flow.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "src", "bin.ts");

describe("cr-connector behavior-host — internal subcommand", () => {
  test("import()s the entry file inside the daemon's Bun runtime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cr-bhost-"));
    try {
      const marker = join(dir, "ran.txt").replace(/\\/g, "/");
      // Tiny self-contained behavior entry: write a marker file then
      // exit 0. This is what the spawned process executes — proof that
      // bin.ts actually evaluated the import target.
      const entry = join(dir, "fake-behavior.ts");
      writeFileSync(
        entry,
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ok");\nprocess.exit(0);\n`,
      );

      const proc = Bun.spawn({
        cmd: [process.execPath, BIN, "behavior-host", entry],
        stdout: "pipe",
        stderr: "pipe",
        // CR_IDENTITY_DIR + CR_CONNECTOR_DISABLE_AUTOLOAD aren't needed —
        // behavior-host short-circuits before any daemon-mode code runs.
      });
      const exit = await proc.exited;
      const stderr = await new Response(proc.stderr).text();
      // Don't fail on warn-level stderr noise from autoload paths — only
      // care that the marker file landed (proves import() ran) and the
      // process exited cleanly.
      expect(stderr).not.toMatch(/unknown command/);
      expect(exit).toBe(0);
      expect(readFileSync(marker, "utf8")).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing entry argument exits 2 with a clear error (NOT the daemon banner)", async () => {
    const proc = Bun.spawn({
      cmd: [process.execPath, BIN, "behavior-host"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exit).toBe(2);
    expect(stderr).toMatch(/behavior-host requires <entryPath>/);
  });
});

describe("cr-connector uninstall", () => {
  test("removes local connector state and exits without starting the daemon", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cr-uninstall-"));
    try {
      const stateDir = join(dir, "state");
      const identityDir = join(stateDir, "identity");
      mkdirSync(join(identityDir, "keys"), { recursive: true });
      mkdirSync(join(stateDir, "behaviors", "echo"), { recursive: true });
      writeFileSync(join(stateDir, "auth.json"), "{}");
      writeFileSync(join(stateDir, "daemon.json"), "{}");
      writeFileSync(join(identityDir, "identity.json"), "{}");
      writeFileSync(join(identityDir, "keys", "key.bin"), "secret");
      writeFileSync(join(stateDir, "behaviors", "echo", "manifest.json"), "{}");

      const proc = Bun.spawn({
        cmd: [process.execPath, BIN, "uninstall"],
        env: {
          ...process.env,
          CR_CONNECTOR_STATE_DIR: stateDir,
          CR_CONNECTOR_AUTH_FILE: join(stateDir, "auth.json"),
          CR_IDENTITY_DIR: identityDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const exit = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      expect(exit).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/connector local state removed/);
      expect(existsSync(join(stateDir, "auth.json"))).toBe(false);
      expect(existsSync(join(stateDir, "daemon.json"))).toBe(false);
      expect(existsSync(identityDir)).toBe(false);
      expect(existsSync(join(stateDir, "behaviors"))).toBe(false);
      expect(existsSync(stateDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
