// Tests ported from claude-remote/test/slash-commands.test.js, adjusted for
// the platform's filtered list (no /login /logout /keybindings-help
// /update-config; /cost hint changed; planned flag added on /loop /schedule).

import { describe, expect, test } from "vitest";
import {
  BUILTIN_SLASH_COMMANDS,
  type SlashCommand,
  applySlashCompletion,
  filterSlashCommands,
} from "../src/claude/slash-commands.ts";

describe("BUILTIN_SLASH_COMMANDS", () => {
  test("excludes claude CLI auth commands not relevant to the remote site", () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).not.toContain("/login");
    expect(names).not.toContain("/logout");
  });

  test("excludes Claude Code harness-only commands", () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).not.toContain("/keybindings-help");
    expect(names).not.toContain("/update-config");
  });

  test("/cost is kept but with usage-stats wording (not dollar cost)", () => {
    const cost = BUILTIN_SLASH_COMMANDS.find((c) => c.name === "/cost");
    expect(cost?.hint).toContain("usage");
    expect(cost?.hint).not.toContain("$");
  });

  test("/loop and /schedule are flagged planned", () => {
    expect(BUILTIN_SLASH_COMMANDS.find((c) => c.name === "/loop")?.paid).toBe(true);
    expect(BUILTIN_SLASH_COMMANDS.find((c) => c.name === "/schedule")?.paid).toBe(true);
  });

  test("non-automation commands are not planned-only", () => {
    const nonPaid = BUILTIN_SLASH_COMMANDS.filter((c) => !c.paid).map((c) => c.name);
    expect(nonPaid).toContain("/help");
    expect(nonPaid).toContain("/init");
    expect(nonPaid).toContain("/review");
  });

  test("every name starts with /", () => {
    for (const c of BUILTIN_SLASH_COMMANDS) {
      expect(c.name.startsWith("/")).toBe(true);
    }
  });

  test("no duplicate names", () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("filterSlashCommands", () => {
  test("non-slash input returns empty", () => {
    expect(filterSlashCommands("hello")).toEqual([]);
    expect(filterSlashCommands("")).toEqual([]);
  });

  test("bare / returns the full list", () => {
    const all = filterSlashCommands("/");
    expect(all.length).toBe(BUILTIN_SLASH_COMMANDS.length);
  });

  test("prefix match (case insensitive)", () => {
    const r = filterSlashCommands("/he");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((c) => c.name.toLowerCase().startsWith("/he"))).toBe(true);
    expect(r.find((c) => c.name === "/help")).toBeTruthy();
  });

  test("space after command name → empty (user is typing args)", () => {
    expect(filterSlashCommands("/init my-repo")).toEqual([]);
  });

  test("slash on a later line is ignored (only first-line trigger)", () => {
    expect(filterSlashCommands("hello\n/help")).toEqual([]);
  });

  test("custom command list overrides default", () => {
    const custom: SlashCommand[] = [{ name: "/foo", hint: "x" }];
    expect(filterSlashCommands("/", custom)).toEqual(custom);
    expect(filterSlashCommands("/help", custom)).toEqual([]);
  });
});

describe("applySlashCompletion", () => {
  test("replaces partial slash with chosen command + space", () => {
    expect(applySlashCompletion("/he", "/help")).toBe("/help ");
  });

  test("preserves trailing text after the slash region", () => {
    expect(applySlashCompletion("/he my-repo", "/help")).toBe("/help  my-repo");
  });

  test("empty input gets just the command + space", () => {
    expect(applySlashCompletion("", "/help")).toBe("/help ");
  });
});
