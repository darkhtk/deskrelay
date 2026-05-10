import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CommandRunner, updateLocalSourceConnector } from "../src/self-update.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deskrelay-update-"));
  mkdirSync(join(root, ".git"));
});

describe("updateLocalSourceConnector", () => {
  test("fast-forwards, installs dependencies, and schedules restart when login task exists", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let headReads = 0;
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "git" && args.join(" ") === "rev-parse HEAD") {
        headReads += 1;
        return {
          stdout: headReads === 1 ? `${"a".repeat(40)}\n` : `${"b".repeat(40)}\n`,
          stderr: "",
        };
      }
      if (command === "git" && args.join(" ") === "rev-parse origin/main") {
        return { stdout: `${"b".repeat(40)}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "status") return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    };

    const result = await updateLocalSourceConnector({
      repoRoot: root,
      runner,
      loginTaskStatus: async () => ({
        supported: true,
        installed: true,
        taskName: "DeskRelay Connector",
      }),
    });

    expect(result.changed).toBe(true);
    expect(result.restartScheduled).toBe(true);
    expect(result.before.shortCommit).toBe("a".repeat(12));
    expect(result.after.shortCommit).toBe("b".repeat(12));
    expect(calls.map((call) => `${call.command} ${call.args.join(" ")}`)).toEqual([
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git fetch origin main",
      "git rev-parse origin/main",
      "git pull --ff-only origin main",
      "bun install",
      "git rev-parse HEAD",
    ]);
  });

  test("refuses to update a dirty tracked checkout before fetching", async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "git" && args.join(" ") === "rev-parse HEAD") {
        return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "status") {
        return { stdout: " M README.md\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    await expect(
      updateLocalSourceConnector({
        repoRoot: root,
        runner,
        loginTaskStatus: async () => ({
          supported: true,
          installed: true,
          taskName: "DeskRelay Connector",
        }),
      }),
    ).rejects.toThrow(/local changes/);
    expect(calls).toEqual(["git rev-parse HEAD", "git status --porcelain --untracked-files=no"]);
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
