import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteClaudeInstruction,
  readClaudeInstructions,
  writeClaudeInstruction,
} from "../src/instructions.ts";
import type { WorkspaceRoots } from "../src/workspaces.ts";

describe("Claude instruction files", () => {
  let root: string;
  let outside: string;
  let roots: WorkspaceRoots;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "deskrelay-instructions-root-"));
    outside = await mkdtemp(join(tmpdir(), "deskrelay-instructions-outside-"));
    roots = { mode: "restricted", roots: [root] };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test("reads the real Claude instruction sources for a cwd", async () => {
    await writeFile(join(root, "CLAUDE.md"), "project rules\n", "utf8");

    const snapshot = await readClaudeInstructions(root, roots);
    const project = snapshot.sources.find((source) => source.scope === "project");
    const local = snapshot.sources.find((source) => source.scope === "local");

    expect(snapshot.cwd).toBe(root);
    expect(project?.exists).toBe(true);
    expect(project?.content).toBe("project rules\n");
    expect(local?.exists).toBe(false);
  });

  test("writes and deletes editable project instructions", async () => {
    const written = await writeClaudeInstruction(
      { scope: "projectClaude", cwd: root, content: "nested rules\n", expectedHash: "missing" },
      roots,
    );

    expect(written.exists).toBe(true);
    expect(written.content).toBe("nested rules\n");
    expect(written.path.endsWith(join(".claude", "CLAUDE.md"))).toBe(true);

    const deleted = await deleteClaudeInstruction(
      { scope: "projectClaude", cwd: root, expectedHash: written.hash ?? "" },
      roots,
    );
    expect(deleted.exists).toBe(false);
  });

  test("blocks project instruction access outside workspace roots", async () => {
    await expect(
      writeClaudeInstruction({ scope: "project", cwd: outside, content: "nope" }, roots),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("detects conflicts before overwriting instruction files", async () => {
    await writeFile(join(root, "CLAUDE.md"), "first\n", "utf8");
    const snapshot = await readClaudeInstructions(root, roots);
    const project = snapshot.sources.find((source) => source.scope === "project");
    expect(project?.hash).toBeTruthy();

    await writeFile(join(root, "CLAUDE.md"), "external edit\n", "utf8");

    await expect(
      writeClaudeInstruction(
        {
          scope: "project",
          cwd: root,
          content: "overwrite\n",
          expectedHash: project?.hash ?? "",
        },
        roots,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
