import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type FsError, listDir, makeDir } from "../src/fs.ts";
import type { WorkspaceRoots } from "../src/workspaces.ts";

describe("fs workspace guards", () => {
  let root: string;
  let outside: string;
  let roots: WorkspaceRoots;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "deskrelay-fs-root-"));
    outside = await mkdtemp(join(tmpdir(), "deskrelay-fs-outside-"));
    roots = { mode: "restricted", roots: [root] };
    await makeDir({ parent: root, name: "visible-dir" }, roots);
    await writeFile(join(root, "hidden-file.txt"), "not listed\n", "utf8");
    await writeFile(join(outside, "outside.txt"), "blocked\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  test("lists only directories for the cwd picker", async () => {
    const listed = await listDir(root, roots);
    expect(listed.entries.map((entry) => entry.name)).toEqual(["visible-dir"]);
  });

  test("can include files for manager verification", async () => {
    const listed = await listDir(root, roots, { includeFiles: true });
    expect(listed.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["visible-dir", "directory"],
      ["hidden-file.txt", "file"],
    ]);
    expect(listed.entries.find((entry) => entry.name === "hidden-file.txt")?.isDir).toBe(false);
  });

  test("rejects listing a file path as not a directory", async () => {
    await expect(listDir(join(root, "hidden-file.txt"), roots)).rejects.toMatchObject({
      code: "ENOTDIR",
    } satisfies Partial<FsError>);
  });

  test("rejects listing outside configured workspace roots", async () => {
    await expect(listDir(outside, roots)).rejects.toMatchObject({
      code: "EFORBIDDEN",
    } satisfies Partial<FsError>);
  });

  test("rejects mkdir outside configured workspace roots without creating anything", async () => {
    await expect(makeDir({ parent: outside, name: "blocked" }, roots)).rejects.toMatchObject({
      code: "EFORBIDDEN",
    } satisfies Partial<FsError>);
    await expect(
      listDir(join(outside, "blocked"), { mode: "unrestricted", roots: [] }),
    ).rejects.toMatchObject({
      code: "ENOENT",
    } satisfies Partial<FsError>);
  });

  test("creates directories inside configured workspace roots", async () => {
    const created = await makeDir({ parent: root, name: "created" }, roots);
    expect(dirname(created.path)).toBe(root);
    const listed = await listDir(root, roots);
    expect(listed.entries.map((entry) => entry.name)).toEqual(["created", "visible-dir"]);
  });
});
