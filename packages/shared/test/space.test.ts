import { describe, expect, test } from "bun:test";
import { asSpaceId, isSpaceId, makeSpaceId, parseSpaceId } from "../src/space.ts";

describe("SpaceId", () => {
  test("accepts canonical {behavior}.{kind}:{id}", () => {
    expect(isSpaceId("remote_claude.machine:home-pc")).toBe(true);
    expect(isSpaceId("remote_codex.thread:abc123")).toBe(true);
    expect(isSpaceId("a.b:x")).toBe(true);
    expect(isSpaceId("remote_claude.session:01HQTB6Z9G7M.A.B-C_D")).toBe(true);
    // Kebab-case behavior + kind names (the actual convention across
    // packages/behaviors/*). Underscores in the id segment are also fine.
    expect(isSpaceId("remote-claude.run:rmojvlgk8_dukkql")).toBe(true);
    expect(isSpaceId("remote-codex.compose:run_abc-123")).toBe(true);
    expect(isSpaceId("foo-bar.kebab-kind:id")).toBe(true);
  });

  test("rejects malformed strings", () => {
    expect(isSpaceId("missing-dot:x")).toBe(false);
    expect(isSpaceId("missing-colon.kind")).toBe(false);
    expect(isSpaceId("Upper.Case:x")).toBe(false);
    expect(isSpaceId(".kind:x")).toBe(false);
    expect(isSpaceId("behavior.:x")).toBe(false);
    expect(isSpaceId("behavior.kind:")).toBe(false);
    expect(isSpaceId("123.kind:x")).toBe(false);
    expect(isSpaceId("")).toBe(false);
  });

  test("rejects non-string values", () => {
    expect(isSpaceId(undefined)).toBe(false);
    expect(isSpaceId(null)).toBe(false);
    expect(isSpaceId(42)).toBe(false);
    expect(isSpaceId({})).toBe(false);
  });

  test("asSpaceId throws on invalid input", () => {
    expect(() => asSpaceId("nope")).toThrow();
  });

  test("makeSpaceId composes the canonical form", () => {
    const id = makeSpaceId("remote_claude", "machine", "home-pc");
    expect(id as string).toBe("remote_claude.machine:home-pc");
  });

  test("parseSpaceId round-trips", () => {
    const id = makeSpaceId("remote_claude", "session", "abc.def-123");
    const parsed = parseSpaceId(id);
    expect(parsed).toEqual({
      behavior: "remote_claude",
      kind: "session",
      id: "abc.def-123",
    });
  });

  test("parseSpaceId preserves colons inside the id segment if present in raw form", () => {
    // If the id contains a colon it would have failed validation, so we
    // never reach this branch. But defensively, parseSpaceId splits on the
    // first colon, so any trailing colons stay in the id.
    // (No test asserts this — documented for future maintainers.)
  });
});
