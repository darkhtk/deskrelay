// chmod-best — single source of truth for "lock down a file to user-only
// read/write, but don't crash the daemon if the platform/filesystem
// won't let us." Used wherever we drop a token, private key, or paired
// identity onto disk.
//
// Behavior:
//   - On Windows: no-op. NTFS ACLs inherit from the parent dir; chmod
//     doesn't model them faithfully.
//   - On POSIX: chmod 0o600 best-effort. EACCES / EROFS are silent —
//     these happen on read-only mounts (CI containers, Docker bind
//     mounts, some Nix store paths) and aren't actionable. Anything
//     else gets a single stderr warning so the operator at least knows
//     the file isn't perm-locked.
//
// Why a stderr warning and not a thrown error: pairing/auth setup must
// stay best-effort. Failing the daemon over a chmod issue would block
// the user even though their data is still functionally readable. A
// noisy log lets the operator see + investigate without breaking the
// happy path.

import { chmod } from "node:fs/promises";

export async function chmod600Best(path: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    await chmod(path, 0o600);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EROFS") return;
    process.stderr.write(
      `⚠ chmod 600 ${path} failed: ${(err as Error).message}\n  the file is still functional but not perm-locked.\n`,
    );
  }
}
