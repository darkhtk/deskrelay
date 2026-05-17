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
    const restartRequests: string[] = [];
    let headReads = 0;
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "git" && args.join(" ") === "branch --show-current") {
        return { stdout: "api-ai-assistant\n", stderr: "" };
      }
      if (command === "git" && args.join(" ") === "rev-parse HEAD") {
        headReads += 1;
        return {
          stdout: headReads === 1 ? `${"a".repeat(40)}\n` : `${"b".repeat(40)}\n`,
          stderr: "",
        };
      }
      if (command === "git" && args.join(" ") === "rev-parse origin/api-ai-assistant") {
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
      restartLoginTask: async (taskName) => {
        restartRequests.push(taskName);
        return { ok: true };
      },
    });

    expect(result.changed).toBe(true);
    expect(result.state).toBe("succeeded");
    expect(result.restartScheduled).toBe(true);
    expect(result.restartRequested).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual([
      "repo",
      "working-tree",
      "git-fetch",
      "git-pull",
      "dependencies",
      "login-task",
      "restart",
    ]);
    expect(result.steps.every((step) => step.source === "updater")).toBe(true);
    expect(restartRequests).toEqual(["DeskRelay Connector"]);
    expect(result.before.shortCommit).toBe("a".repeat(12));
    expect(result.after.shortCommit).toBe("b".repeat(12));
    expect(calls.map((call) => `${call.command} ${call.args.join(" ")}`)).toEqual([
      "git branch --show-current",
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
      "git fetch origin +refs/heads/api-ai-assistant:refs/remotes/origin/api-ai-assistant",
      "git rev-parse origin/api-ai-assistant",
      "git branch --show-current",
      "git pull --ff-only origin api-ai-assistant",
      "bun install",
      "git rev-parse HEAD",
    ]);
  });

  test("does not report restart success when the login task restart request fails", async () => {
    let headReads = 0;
    const runner: CommandRunner = async (command, args) => {
      if (command === "git" && args.join(" ") === "branch --show-current") {
        return { stdout: "main\n", stderr: "" };
      }
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
      restartLoginTask: async () => ({ ok: false, error: "cannot start task" }),
    });

    expect(result.restartScheduled).toBe(true);
    expect(result.restartRequested).toBe(false);
    expect(result.state).toBe("restart_required");
    expect(result.restartRequestError).toBe("cannot start task");
    expect(result.warning).toContain("automatic restart request failed");
    expect(result.steps.find((step) => step.id === "restart")).toMatchObject({
      status: "warn",
      retrySafe: true,
    });
  });

  test("uses an explicit server branch instead of the local checkout branch", async () => {
    const calls: string[] = [];
    let headReads = 0;
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "git" && args.join(" ") === "rev-parse HEAD") {
        headReads += 1;
        return {
          stdout: headReads === 1 ? `${"a".repeat(40)}\n` : `${"c".repeat(40)}\n`,
          stderr: "",
        };
      }
      if (command === "git" && args.join(" ") === "rev-parse origin/api-ai-assistant") {
        return { stdout: `${"c".repeat(40)}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "status") return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    };

    const result = await updateLocalSourceConnector({
      repoRoot: root,
      branch: "api-ai-assistant",
      runner,
      loginTaskStatus: async () => ({
        supported: true,
        installed: true,
        taskName: "DeskRelay Connector",
      }),
      restartLoginTask: async () => ({ ok: true }),
    });

    expect(result.branch).toBe("api-ai-assistant");
    expect(calls[0]).toBe("git rev-parse HEAD");
    expect(calls).toContain(
      "git fetch origin +refs/heads/api-ai-assistant:refs/remotes/origin/api-ai-assistant",
    );
    expect(calls).toContain("git switch --track -c api-ai-assistant origin/api-ai-assistant");
    expect(calls).toContain("git pull --ff-only origin api-ai-assistant");
  });

  test("rejects invalid explicit update branches before fetching", async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { stdout: "", stderr: "" };
    };

    await expect(
      updateLocalSourceConnector({
        repoRoot: root,
        branch: "../main",
        runner,
        loginTaskStatus: async () => ({
          supported: true,
          installed: true,
          taskName: "DeskRelay Connector",
        }),
      }),
    ).rejects.toThrow(/Invalid update branch/);
    expect(calls).toEqual([]);
  });

  test("refuses to update a dirty tracked checkout before fetching", async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "git" && args.join(" ") === "branch --show-current") {
        return { stdout: "main\n", stderr: "" };
      }
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
    expect(calls).toEqual([
      "git branch --show-current",
      "git rev-parse HEAD",
      "git status --porcelain --untracked-files=no",
    ]);
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
