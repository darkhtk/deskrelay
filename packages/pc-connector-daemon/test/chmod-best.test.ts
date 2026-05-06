// Targeted: chmod600Best is best-effort. Behavior contracts:
//   - never throws (so callers don't need try/catch around perm setup);
//   - on POSIX with a real file, leaves perms at 0o600 when possible;
//   - on Windows, no-op (NTFS ACLs aren't modeled by chmod) — we don't
//     write a stderr warning either, since "Windows" isn't an actionable
//     diagnosis;
//   - swallows EACCES / EROFS silently (CI containers, read-only mounts);
//   - emits exactly one stderr warning for any other error so an
//     operator on an unusual filesystem sees that the file isn't locked.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmod600Best } from "../src/chmod-best.ts";

let tmp: string;
let originalStderrWrite: typeof process.stderr.write;
let stderrCaptured: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cr-chmod-"));
  stderrCaptured = "";
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrCaptured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
  rmSync(tmp, { recursive: true, force: true });
});

describe("chmod600Best", () => {
  test("never throws when target file does not exist", async () => {
    // ENOENT is not in the silent set, so this should produce a warning
    // — but still resolve, never throw. That's the whole contract.
    await expect(chmod600Best(join(tmp, "missing"))).resolves.toBeUndefined();
  });

  test("on POSIX with a real file, sets perms to 0o600 (no warning)", async () => {
    if (process.platform === "win32") return; // Windows path is no-op
    const path = join(tmp, "auth.json");
    writeFileSync(path, "{}");
    await chmod600Best(path);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(stderrCaptured).toBe("");
  });

  test("on Windows, returns without touching stderr (no actionable diagnosis)", async () => {
    if (process.platform !== "win32") return;
    const path = join(tmp, "auth.json");
    writeFileSync(path, "{}");
    await chmod600Best(path);
    expect(stderrCaptured).toBe("");
  });

  test("warning fires for non-EACCES/EROFS errors on POSIX (e.g. ENOENT)", async () => {
    if (process.platform === "win32") return;
    await chmod600Best(join(tmp, "does-not-exist"));
    expect(stderrCaptured).toMatch(/chmod 600.*failed/);
    expect(stderrCaptured).toMatch(/still functional/);
  });
});
