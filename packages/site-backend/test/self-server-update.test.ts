import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPowerShellSelfServerUpdater } from "../src/self-server-update.ts";

describe("self server updater status recovery", () => {
  test("marks a running update as failed when the updater never writes a log", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskrelay-self-update-"));
    const statusPath = join(root, "state", "self-server-update-status.json");
    await mkdir(join(root, "state"), { recursive: true });
    const startedAt = "2026-01-01T00:00:00.000Z";
    await writeFile(
      statusPath,
      JSON.stringify(
        {
          state: "running",
          startedAt,
          logPath: join(root, "logs", "missing.log"),
        },
        null,
        2,
      ),
    );

    const updater = createPowerShellSelfServerUpdater({
      root,
      repoRoot: root,
      now: () => new Date("2026-01-01T00:00:02.000Z"),
      bootstrapLogGraceMs: 1,
    });

    const status = await updater.status();
    expect(status.state).toBe("failed");
    expect(status.startedAt).toBe(startedAt);
    expect(status.error).toContain("before writing a log");

    const persisted = JSON.parse(await readFile(statusPath, "utf8")) as { state: string };
    expect(persisted.state).toBe("failed");
  });

  test("does not start another update while a current update is still running", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskrelay-self-update-"));
    const statusPath = join(root, "state", "self-server-update-status.json");
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      statusPath,
      JSON.stringify({
        state: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const updater = createPowerShellSelfServerUpdater({
      root,
      repoRoot: root,
      now: () => new Date("2026-01-01T00:00:01.000Z"),
    });

    const result = await updater.update();
    expect(result).toEqual({
      supported: true,
      started: false,
      error: "self server update is already running",
      status: {
        state: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  test("marks a running update as failed when its process is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskrelay-self-update-"));
    const statusPath = join(root, "state", "self-server-update-status.json");
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      statusPath,
      JSON.stringify({
        state: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        pid: 999_999_999,
      }),
    );

    const updater = createPowerShellSelfServerUpdater({
      root,
      repoRoot: root,
      now: () => new Date("2026-01-01T00:00:01.000Z"),
    });

    const status = await updater.status();
    expect(status.state).toBe("failed");
    expect(status.error).toContain("no longer running");
  });

  test("marks old running updates without a pid as failed when the log is idle", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskrelay-self-update-"));
    const statusPath = join(root, "state", "self-server-update-status.json");
    const logPath = join(root, "logs", "idle.log");
    await mkdir(join(root, "state"), { recursive: true });
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(logPath, "stopped after backend shutdown");
    await writeFile(
      statusPath,
      JSON.stringify({
        state: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        logPath,
      }),
    );

    const updater = createPowerShellSelfServerUpdater({
      root,
      repoRoot: root,
      now: () => new Date(Date.now() + 60_000),
      logIdleStaleMs: 1,
    });

    const status = await updater.status();
    expect(status.state).toBe("failed");
    expect(status.error).toContain("stopped writing logs");
  });

  test("reads PowerShell UTF-8 BOM status files", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskrelay-self-update-"));
    const statusPath = join(root, "state", "self-server-update-status.json");
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      statusPath,
      `\uFEFF${JSON.stringify({
        state: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        error: "dirty tree",
      })}`,
    );

    const updater = createPowerShellSelfServerUpdater({ root, repoRoot: root });

    expect(await updater.status()).toEqual({
      state: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      error: "dirty tree",
    });
  });

  test("reports when the server repo has a remote update", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskrelay-self-update-"));
    const local = "a".repeat(40);
    const remote = "b".repeat(40);
    const updater = createPowerShellSelfServerUpdater({
      root,
      repoRoot: root,
      gitRunner: async (args) => {
        if (args[0] === "rev-parse") return { stdout: `${local}\n` };
        if (args[0] === "ls-remote") return { stdout: `${remote}\trefs/heads/main\n` };
        return { stdout: "" };
      },
    });

    expect(await updater.status()).toEqual({
      state: "idle",
      localCommit: local,
      remoteCommit: remote,
      updateAvailable: true,
    });
  });

  test("clears stale local-change failures once the repo is up to date", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskrelay-self-update-"));
    const statusPath = join(root, "state", "self-server-update-status.json");
    const commit = "a".repeat(40);
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      statusPath,
      JSON.stringify({
        state: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        branch: "main",
        before: "aaaaaaa",
        changed: true,
        error:
          "Cannot update while tracked files have local changes. Commit or stash them, then retry.",
      }),
    );

    const updater = createPowerShellSelfServerUpdater({
      root,
      repoRoot: root,
      gitRunner: async (args) => {
        if (args[0] === "rev-parse") return { stdout: `${commit}\n` };
        if (args[0] === "ls-remote") return { stdout: `${commit}\trefs/heads/main\n` };
        return { stdout: "" };
      },
    });

    expect(await updater.status()).toEqual({
      state: "idle",
      localCommit: commit,
      remoteCommit: commit,
      updateAvailable: false,
    });
  });
});
