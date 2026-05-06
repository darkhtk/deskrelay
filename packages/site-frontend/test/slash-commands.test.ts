// Tests ported from claude-remote/test/slash-commands.test.js, adjusted for
// the platform's filtered list (no /login /logout /keybindings-help
// /skills; runtime-discovered skills are merged from Claude init).

import { describe, expect, test } from "vitest";
import {
  BUILTIN_SLASH_COMMANDS,
  type SlashCommand,
  applySlashCompletion,
  filterSlashCommands,
  mergeRuntimeSlashCommands,
  normalizeSlashCommandName,
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

  test("excludes /skills until the connector can prove it is available", () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).not.toContain("/skills");
  });

  test("keeps DeskRelay-local basic commands", () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain("/help");
    expect(names).toContain("/clear");
    expect(names).toContain("/model");
    expect(names).toContain("/permissions");
    expect(names).toContain("/status");
  });

  test("excludes unsupported terminal-only commands unless runtime reports them", () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).not.toContain("/mcp");
    expect(names).not.toContain("/hooks");
    expect(names).not.toContain("/agents");
    expect(names).not.toContain("/doctor");
    expect(names).not.toContain("/resume");
    expect(names).not.toContain("/cost");
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

describe("mergeRuntimeSlashCommands", () => {
  test("adds Claude Code runtime skills and slash commands", () => {
    const merged = mergeRuntimeSlashCommands({
      slashCommands: ["usage", "context", "deep-fix"],
      skills: ["deep-fix", "protocol-rubric"],
    });
    const names = merged.map((c) => c.name);
    expect(names).toContain("/usage");
    expect(names).toContain("/context");
    expect(names).toContain("/deep-fix");
    expect(names).toContain("/protocol-rubric");
    expect(merged.find((c) => c.name === "/deep-fix")?.hint).toContain("skill");
  });

  test("keeps local /model and /status even when runtime omits them", () => {
    const names = mergeRuntimeSlashCommands({ slashCommands: [], skills: [] }).map((c) => c.name);
    expect(names).toContain("/model");
    expect(names).toContain("/status");
  });

  test("filters remote commands that are misleading in the browser shell", () => {
    const names = mergeRuntimeSlashCommands({
      slashCommands: ["skills", "update-config", "login", "status"],
      skills: ["update-config"],
    }).map((c) => c.name);
    expect(names).not.toContain("/skills");
    expect(names).not.toContain("/login");
    expect(names).toContain("/update-config");
    expect(names).toContain("/status");
  });
});

describe("normalizeSlashCommandName", () => {
  test("normalizes runtime names to slash-prefixed commands", () => {
    expect(normalizeSlashCommandName("deep-fix")).toBe("/deep-fix");
    expect(normalizeSlashCommandName("/status")).toBe("/status");
  });

  test("rejects invalid command names", () => {
    expect(normalizeSlashCommandName("bad command")).toBeNull();
    expect(normalizeSlashCommandName("../bad")).toBeNull();
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

  test("/skills prefix stays empty when the runtime does not support it", () => {
    expect(filterSlashCommands("/ski")).toEqual([]);
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
