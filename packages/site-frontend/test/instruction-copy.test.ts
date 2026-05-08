import { describe, expect, test } from "vitest";
import {
  instructionScopeEmptyDescription,
  instructionScopePlaceholder,
  temporaryInstructionPlaceholder,
} from "../src/instruction-copy.ts";

describe("instruction copy", () => {
  test("explains each instruction scope in the placeholder", () => {
    expect(instructionScopePlaceholder("user")).toContain("전역 지침");
    expect(instructionScopePlaceholder("project")).toContain("CLAUDE.md");
    expect(instructionScopePlaceholder("projectClaude")).toContain(".claude/CLAUDE.md");
    expect(instructionScopePlaceholder("local")).toContain("CLAUDE.local.md");
    expect(instructionScopePlaceholder("managed")).toContain("읽기 전용");
  });

  test("empty readonly descriptions use the same scope-specific explanation", () => {
    expect(instructionScopeEmptyDescription("managed")).toBe(
      instructionScopePlaceholder("managed"),
    );
  });

  test("temporary instruction placeholder says it is not a Claude file", () => {
    expect(temporaryInstructionPlaceholder()).toContain("Claude 지침 파일로 저장되지");
  });
});
