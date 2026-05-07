import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CommandResult,
  buildWindowsLoginTaskScript,
  buildWindowsRegisterTaskArgs,
  buildWindowsUnregisterTaskArgs,
  defaultLoginTaskLaunch,
  installLoginTask,
  isSourceRunLoginTaskScript,
  readLoginTaskScript,
  removeLoginTask,
  removeSourceRunLoginTask,
} from "../src/login-task.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "cr-login-task-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("login task command generation", () => {
  test("source-run pairing installs a daemon launch, not another pair command", () => {
    const launch = defaultLoginTaskLaunch(
      [
        "C:\\Users\\me\\.bun\\bin\\bun.exe",
        "packages/pc-connector-daemon/src/bin.ts",
        "pair",
        "ABC123",
        "--login-task",
      ],
      "C:\\Users\\me\\.bun\\bin\\bun.exe",
      "C:\\Users\\me\\claude-remote-platform",
    );

    expect(launch.command).toBe("C:\\Users\\me\\.bun\\bin\\bun.exe");
    expect(launch.args).toEqual([
      "run",
      "C:\\Users\\me\\claude-remote-platform\\packages\\pc-connector-daemon\\src\\bin.ts",
    ]);
    expect(launch.args.join(" ")).not.toContain("pair");
  });

  test("compiled connector schedules the executable directly", () => {
    const launch = defaultLoginTaskLaunch(
      ["C:\\Tools\\cr-connector-win32-x64.exe", "pair", "ABC123"],
      "C:\\Tools\\cr-connector-win32-x64.exe",
      "C:\\Tools",
    );

    expect(launch).toEqual({
      command: "C:\\Tools\\cr-connector-win32-x64.exe",
      args: [],
      cwd: "C:\\Tools",
    });
  });

  test("does not treat cr-connector-cli lookalikes as packaged daemon binaries", () => {
    const launch = defaultLoginTaskLaunch(
      ["C:\\Tools\\cr-connector-cli.exe", "packages/pc-connector-daemon/src/bin.ts"],
      "C:\\Tools\\cr-connector-cli.exe",
      "C:\\repo",
    );

    expect(launch.command).toBe("C:\\Tools\\cr-connector-cli.exe");
    expect(launch.args).toEqual(["run", "C:\\repo\\packages\\pc-connector-daemon\\src\\bin.ts"]);
  });

  test("PowerShell supervisor restarts the daemon and appends logs", () => {
    const script = buildWindowsLoginTaskScript(
      {
        command: "C:\\Users\\me\\.bun\\bin\\bun.exe",
        args: ["run", "C:\\repo\\packages\\pc-connector-daemon\\src\\bin.ts"],
        cwd: "C:\\repo",
        env: {
          CR_CONNECTOR_HOST: "0.0.0.0",
          CR_CONNECTOR_PORT: "18091",
        },
      },
      "C:\\Users\\me\\AppData\\Local\\claude-remote\\logs\\connector.log",
    );

    expect(script).toContain("while ($true)");
    expect(script).toContain("Set-Location -LiteralPath $cwd");
    expect(script).toContain("& $exe @argv *>> $logFile");
    expect(script).toContain("restarting in 5 seconds");
    expect(script).toContain("connector-supervisor.lock");
    expect(script).toContain("[System.IO.FileShare]::None");
    expect(script).toContain("another connector supervisor is already running; exiting");
    expect(script).toContain("$env:CR_CONNECTOR_HOST = '0.0.0.0'");
    expect(script).toContain("$env:CR_CONNECTOR_PORT = '18091'");
    expect(script).not.toContain("pair ABC123");
  });

  test("pair --login-task does not leave an already-running daemon owning the port", async () => {
    const source = await readFile(join(import.meta.dir, "..", "src", "bin.ts"), "utf8");

    expect(source).toContain("if (reloaded && !loginTask)");
    expect(source).toContain("if (reloaded && loginTask)");
    expect(source).toContain("restarting through the login task");
  });

  test("detects legacy source-run supervisor scripts", () => {
    const sourceRunScript = buildWindowsLoginTaskScript(
      {
        command: "C:\\Users\\me\\.bun\\bin\\bun.exe",
        args: ["run", "C:\\repo\\packages\\pc-connector-daemon\\src\\bin.ts"],
        cwd: "C:\\repo",
      },
      "C:\\Users\\me\\AppData\\Local\\claude-remote\\logs\\connector.log",
    );
    const packagedScript = buildWindowsLoginTaskScript(
      {
        command: "C:\\Program Files\\WindowsApps\\Banbi.DeskRelayConnector\\cr-connector.exe",
        args: [],
        cwd: "C:\\Program Files\\WindowsApps\\Banbi.DeskRelayConnector",
      },
      "C:\\Users\\me\\AppData\\Local\\claude-remote\\logs\\connector.log",
    );

    expect(isSourceRunLoginTaskScript(sourceRunScript)).toBe(true);
    expect(isSourceRunLoginTaskScript(packagedScript)).toBe(false);
  });

  test("Register-ScheduledTask args install a current-user on-logon task without admin", () => {
    // The args are crafted so a non-admin powershell.exe can register the
    // task under the current user's SID. We use -EncodedCommand to dodge
    // shell quoting; the test decodes it back and asserts the inner script.
    const args = buildWindowsRegisterTaskArgs(
      "DeskRelay Connector",
      "C:\\Users\\me\\AppData\\Local\\claude-remote\\task.ps1",
    );
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    const encoded = args[3] ?? "";
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    // Action: powershell.exe with -File pointing at the supervisor script.
    expect(script).toContain("New-ScheduledTaskAction -Execute 'powershell.exe'");
    expect(script).toContain("C:\\Users\\me\\AppData\\Local\\claude-remote\\task.ps1");
    // Trigger: at logon, scoped to $env:USERNAME (per-user, not "any user").
    expect(script).toContain("New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME");
    // Register: under the current user's SID, with -Force so a re-pair
    // overwrites a stale prior registration.
    expect(script).toContain("Register-ScheduledTask -TaskName 'DeskRelay Connector'");
    expect(script).toContain("-User $env:USERNAME -Force");
  });

  test("Register-ScheduledTask args quote-escape task names containing apostrophes", () => {
    const args = buildWindowsRegisterTaskArgs("Bob's Task", "C:\\path\\task.ps1");
    const script = Buffer.from(args[3] ?? "", "base64").toString("utf16le");
    // PowerShell single-quoted strings escape ' by doubling.
    expect(script).toContain("Register-ScheduledTask -TaskName 'Bob''s Task'");
  });

  test("Unregister-ScheduledTask args remove the current-user task without schtasks delete", () => {
    const args = buildWindowsUnregisterTaskArgs("DeskRelay Connector");
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    const script = Buffer.from(args[3] ?? "", "base64").toString("utf16le");
    expect(script).toContain("$ErrorActionPreference = 'Stop'");
    expect(script).toContain("Get-ScheduledTask -TaskName 'DeskRelay Connector'");
    expect(script).toContain("Unregister-ScheduledTask -TaskName 'DeskRelay Connector'");
    expect(script).toContain("-Confirm:$false");
  });

  test("migration scripts can override the default task name", async () => {
    const previous = process.env.CR_CONNECTOR_LOGIN_TASK_NAME;
    process.env.CR_CONNECTOR_LOGIN_TASK_NAME = "Remote for Claude Connector";
    try {
      const result = await removeLoginTask({
        platform: "win32",
        runner: async () => ({ code: 1, stdout: "", stderr: "not found" }),
      });
      expect(result.taskName).toBe("Remote for Claude Connector");
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "CR_CONNECTOR_LOGIN_TASK_NAME");
      else process.env.CR_CONNECTOR_LOGIN_TASK_NAME = previous;
    }
  });
});

describe("installLoginTask", () => {
  test("writes the supervisor script, creates the task, and starts it when requested", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });
      return { code: 0, stdout: "ok", stderr: "" };
    };

    const result = await installLoginTask({
      platform: "win32",
      stateDir: tmp,
      runner,
      start: true,
      launch: {
        command: "C:\\Users\\me\\.bun\\bin\\bun.exe",
        args: ["run", "C:\\repo\\packages\\pc-connector-daemon\\src\\bin.ts"],
        cwd: "C:\\repo",
      },
    });

    expect(result.supported).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.started).toBe(true);
    // Three commands: schtasks /End (best-effort stop), powershell -EncodedCommand
    // Register-ScheduledTask (the install — admin-free), schtasks /Run.
    expect(calls.map((c) => c.command)).toEqual(["schtasks.exe", "powershell.exe", "schtasks.exe"]);
    expect(calls[0]?.args.slice(0, 2)).toEqual(["/End", "/TN"]);
    expect(calls[1]?.args.slice(0, 3)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    // Decode the EncodedCommand to confirm it routes to Register-ScheduledTask.
    const psScript = Buffer.from(calls[1]?.args[3] ?? "", "base64").toString("utf16le");
    expect(psScript).toContain("Register-ScheduledTask");
    expect(psScript).toContain("-User $env:USERNAME -Force");
    expect(calls[2]?.args).toEqual(["/Run", "/TN", "DeskRelay Connector"]);

    const script = await readLoginTaskScript(tmp);
    expect(script).toContain("C:\\repo\\packages\\pc-connector-daemon\\src\\bin.ts");
    await stat(join(tmp, "cr-connector-login-task.ps1"));
  });

  test("remove is idempotent when the task is absent", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });
      return { code: 1, stdout: "", stderr: "not found" };
    };

    const result = await removeLoginTask({ platform: "win32", runner });

    expect(result).toEqual({
      supported: true,
      removed: false,
      taskName: "DeskRelay Connector",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["/Query", "/TN", "DeskRelay Connector"]);
  });

  test("removes only legacy source-run login tasks", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });
      return { code: 0, stdout: "ok", stderr: "" };
    };
    await installLoginTask({
      platform: "win32",
      stateDir: tmp,
      runner,
      launch: {
        command: "C:\\Users\\me\\.bun\\bin\\bun.exe",
        args: ["run", "C:\\repo\\packages\\pc-connector-daemon\\src\\bin.ts"],
        cwd: "C:\\repo",
      },
    });
    calls.length = 0;

    const result = await removeSourceRunLoginTask({ platform: "win32", stateDir: tmp, runner });

    expect(result).toEqual({
      supported: true,
      removed: true,
      taskName: "DeskRelay Connector",
    });
    expect(calls.map((c) => c.command)).toEqual([
      "schtasks.exe",
      "schtasks.exe",
      "schtasks.exe",
      "powershell.exe",
    ]);
    expect(calls[3]?.args.slice(0, 3)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
  });

  test("does not remove packaged login tasks", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]): Promise<CommandResult> => {
      calls.push({ command, args });
      return { code: 0, stdout: "ok", stderr: "" };
    };
    await installLoginTask({
      platform: "win32",
      stateDir: tmp,
      runner,
      launch: {
        command: "C:\\Tools\\cr-connector-win32-x64.exe",
        args: [],
        cwd: "C:\\Tools",
      },
    });
    calls.length = 0;

    const result = await removeSourceRunLoginTask({ platform: "win32", stateDir: tmp, runner });

    expect(result).toEqual({
      supported: true,
      removed: false,
      taskName: "DeskRelay Connector",
      skippedReason: "not-source-run",
    });
    expect(calls.map((c) => c.args[0])).toEqual(["/Query"]);
  });
});
