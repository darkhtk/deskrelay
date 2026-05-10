import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface SelfServerAutostartStatus {
  supported: boolean;
  installed: boolean;
  taskName: string;
  error?: string;
}

export interface SelfServerAutostartController {
  status(): Promise<SelfServerAutostartStatus>;
  setEnabled(enabled: boolean): Promise<SelfServerAutostartStatus>;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export function createPowerShellSelfServerAutostartController(options: {
  repoRoot: string;
  root: string;
  taskName?: string;
  runner?: CommandRunner;
}): SelfServerAutostartController {
  const taskName = options.taskName ?? "DeskRelay Self Server";
  const scriptPath = join(options.repoRoot, "scripts", "self-pc-server-autostart.ps1");
  const runner = options.runner ?? runCommand;

  async function run(action: "install" | "remove" | "status"): Promise<CommandResult> {
    if (process.platform !== "win32") {
      return {
        code: 0,
        stdout: `(self server autostart unsupported: ${taskName})`,
        stderr: "Windows Task Scheduler is required.",
      };
    }
    if (!existsSync(scriptPath)) {
      return {
        code: 1,
        stdout: "",
        stderr: `self server autostart script not found: ${scriptPath}`,
      };
    }
    return await runner("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Action",
      action,
      "-Root",
      options.root,
      "-RepoRoot",
      options.repoRoot,
      "-TaskName",
      taskName,
    ]);
  }

  async function status(): Promise<SelfServerAutostartStatus> {
    const result = await run("status");
    return parseStatus(taskName, result);
  }

  return {
    status,
    async setEnabled(enabled) {
      const action = enabled ? "install" : "remove";
      const result = await run(action);
      if (result.code !== 0) {
        throw new Error(combineOutput(result) || `self server autostart ${action} failed`);
      }
      return await status();
    },
  };
}

function parseStatus(taskName: string, result: CommandResult): SelfServerAutostartStatus {
  const output = combineOutput(result);
  if (process.platform !== "win32") {
    return {
      supported: false,
      installed: false,
      taskName,
      error: "Windows Task Scheduler is required.",
    };
  }
  if (result.code !== 0) {
    return {
      supported: false,
      installed: false,
      taskName,
      error: output || `could not read self server autostart status`,
    };
  }
  const installed =
    output.includes(`self server autostart installed: ${taskName}`) &&
    !output.includes(`self server autostart not installed: ${taskName}`);
  return { supported: true, installed, taskName };
}

function combineOutput(result: CommandResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim()).join("\n").trim();
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
