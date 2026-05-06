import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitStatus } from "../src/git.ts";
import { parseWorkspaceRoots } from "../src/workspaces.ts";

const execFileAsync = promisify(execFile);

let tmpRoot: string;

async function gitInit(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-q", "--initial-branch=main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "cr-git-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("gitStatus", () => {
  test("non-git directory → isRepo: false", async () => {
    const r = await gitStatus(tmpRoot, parseWorkspaceRoots(tmpRoot));
    expect(r.isRepo).toBe(false);
  });

  test("clean repo on default branch → isRepo, dirty: false, branch set", async () => {
    await gitInit(tmpRoot);
    writeFileSync(join(tmpRoot, "README.md"), "hello");
    await execFileAsync("git", ["add", "README.md"], { cwd: tmpRoot });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tmpRoot });

    const r = await gitStatus(tmpRoot, parseWorkspaceRoots(tmpRoot));
    expect(r.isRepo).toBe(true);
    expect(r.branch).toBe("main");
    expect(r.dirty).toBe(false);
    expect(r.modifiedCount).toBe(0);
  });

  test("untracked + modified files counted in modifiedCount", async () => {
    await gitInit(tmpRoot);
    writeFileSync(join(tmpRoot, "README.md"), "hello");
    await execFileAsync("git", ["add", "README.md"], { cwd: tmpRoot });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tmpRoot });
    writeFileSync(join(tmpRoot, "README.md"), "hello world");
    writeFileSync(join(tmpRoot, "new.txt"), "new file");

    const r = await gitStatus(tmpRoot, parseWorkspaceRoots(tmpRoot));
    expect(r.isRepo).toBe(true);
    expect(r.dirty).toBe(true);
    expect(r.modifiedCount).toBeGreaterThanOrEqual(2);
  });

  test("staged change → stagedCount > 0", async () => {
    await gitInit(tmpRoot);
    writeFileSync(join(tmpRoot, "a.txt"), "v1");
    await execFileAsync("git", ["add", "a.txt"], { cwd: tmpRoot });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tmpRoot });
    writeFileSync(join(tmpRoot, "a.txt"), "v2");
    await execFileAsync("git", ["add", "a.txt"], { cwd: tmpRoot });

    const r = await gitStatus(tmpRoot, parseWorkspaceRoots(tmpRoot));
    expect(r.stagedCount ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("cwd outside workspace allowlist is rejected without spawning git", async () => {
    await gitInit(tmpRoot);
    // The allowlist points at a sibling directory, so tmpRoot itself
    // is "outside". The function returns isRepo:false + an explanatory
    // error and never invokes git.
    const sibling = join(tmpRoot, "..", "definitely-not-here");
    const r = await gitStatus(tmpRoot, parseWorkspaceRoots(sibling));
    expect(r.isRepo).toBe(false);
    expect(r.error).toMatch(/outside the configured workspace roots/);
  });
});
