import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  type WorkspaceRoots,
  expandTilde,
  isInsideRoot,
  parseWorkspaceRoots,
} from "../src/workspaces.ts";

describe("expandTilde", () => {
  test("bare ~ resolves to homedir", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  test("~/ prefix resolves under homedir", () => {
    expect(expandTilde("~/proj")).toBe(resolve(homedir(), "proj"));
  });

  test("~\\ prefix resolves under homedir (Windows-style)", () => {
    expect(expandTilde("~\\proj")).toBe(resolve(homedir(), "proj"));
  });

  test("non-tilde path passes through unchanged", () => {
    expect(expandTilde("/srv/dev")).toBe("/srv/dev");
  });

  test("empty string passes through", () => {
    expect(expandTilde("")).toBe("");
  });
});

describe("parseWorkspaceRoots", () => {
  test("undefined → unrestricted", () => {
    expect(parseWorkspaceRoots(undefined)).toEqual({ mode: "unrestricted", roots: [] });
  });

  test("empty string → restricted with no roots (lockdown)", () => {
    expect(parseWorkspaceRoots("")).toEqual({ mode: "restricted", roots: [] });
  });

  test("whitespace-only entries are dropped", () => {
    expect(parseWorkspaceRoots(" , , ")).toEqual({ mode: "restricted", roots: [] });
  });

  test("single absolute path → one root", () => {
    const r = parseWorkspaceRoots(resolve("/srv/dev"));
    expect(r.mode).toBe("restricted");
    expect(r.roots).toEqual([resolve("/srv/dev")]);
  });

  test("comma-separated entries are split + sorted + deduped", () => {
    const a = resolve("/srv/a");
    const b = resolve("/srv/b");
    const r = parseWorkspaceRoots(`${b}, ${a}, ${a}`);
    expect(r.mode).toBe("restricted");
    expect(r.roots).toEqual([a, b]);
  });

  test("~ expansion produces absolute paths under homedir", () => {
    const r = parseWorkspaceRoots("~/proj, ~/work");
    expect(r.roots).toEqual([resolve(homedir(), "proj"), resolve(homedir(), "work")].sort());
  });

  test("trailing separator on a root is normalized away", () => {
    const a = `${resolve("/srv/dev")}${sep}`;
    const r = parseWorkspaceRoots(a);
    expect(r.roots).toEqual([resolve("/srv/dev")]);
  });
});

describe("isInsideRoot", () => {
  test("unrestricted always returns true", () => {
    const cfg: WorkspaceRoots = { mode: "unrestricted", roots: [] };
    expect(isInsideRoot("/anywhere", cfg)).toBe(true);
    expect(isInsideRoot("/etc/passwd", cfg)).toBe(true);
  });

  test("restricted with empty roots always returns false (lockdown)", () => {
    const cfg: WorkspaceRoots = { mode: "restricted", roots: [] };
    expect(isInsideRoot("/anywhere", cfg)).toBe(false);
  });

  test("path equal to a root is inside", () => {
    const root = resolve("/srv/dev");
    expect(isInsideRoot(root, { mode: "restricted", roots: [root] })).toBe(true);
  });

  test("descendant of a root is inside", () => {
    const root = resolve("/srv/dev");
    expect(isInsideRoot(join(root, "x", "y"), { mode: "restricted", roots: [root] })).toBe(true);
  });

  test("sibling sharing a string prefix is NOT inside", () => {
    // Naive startsWith would say /srv/dev-other is inside /srv/dev — relative()
    // gives "../dev-other" so we correctly reject.
    const root = resolve("/srv/dev");
    expect(isInsideRoot(resolve("/srv/dev-other"), { mode: "restricted", roots: [root] })).toBe(
      false,
    );
  });

  test(".. traversal is rejected", () => {
    const root = resolve("/srv/dev");
    expect(isInsideRoot(join(root, "..", "secret"), { mode: "restricted", roots: [root] })).toBe(
      false,
    );
  });

  test("any root match is sufficient when multiple are configured", () => {
    const a = resolve("/srv/a");
    const b = resolve("/srv/b");
    const cfg: WorkspaceRoots = { mode: "restricted", roots: [a, b] };
    expect(isInsideRoot(join(b, "child"), cfg)).toBe(true);
    expect(isInsideRoot(resolve("/srv/c"), cfg)).toBe(false);
  });

  test("trailing separator on the input is tolerated", () => {
    const root = resolve("/srv/dev");
    expect(isInsideRoot(`${root}${sep}`, { mode: "restricted", roots: [root] })).toBe(true);
  });
});
