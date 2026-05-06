import { describe, expect, test } from "vitest";
import { cwdBasename, formatAgo } from "../src/claude/session-utils.ts";

describe("cwdBasename", () => {
  test("POSIX path → last component", () => {
    expect(cwdBasename("/home/user/projects/foo")).toBe("foo");
  });

  test("Windows path → last component", () => {
    expect(cwdBasename("C:\\Users\\me\\projects\\bar")).toBe("bar");
  });

  test("trailing slash is ignored", () => {
    expect(cwdBasename("/home/user/")).toBe("user");
  });

  test("empty / null falls back to em dash", () => {
    expect(cwdBasename(null)).toBe("—");
    expect(cwdBasename("")).toBe("—");
    expect(cwdBasename(undefined)).toBe("—");
  });
});

describe("formatAgo", () => {
  const now = 1_700_000_000_000;

  test("missing time → empty string", () => {
    expect(formatAgo(undefined, now)).toBe("");
  });

  test("future timestamp → 'just now'", () => {
    expect(formatAgo(now + 5_000, now)).toBe("just now");
  });

  test("seconds ago", () => {
    expect(formatAgo(now - 30_000, now)).toBe("30s ago");
  });

  test("minutes ago", () => {
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5m ago");
  });

  test("hours ago", () => {
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
  });

  test("days ago", () => {
    expect(formatAgo(now - 7 * 86_400_000, now)).toBe("7d ago");
  });

  test("months ago", () => {
    expect(formatAgo(now - 60 * 86_400_000, now)).toBe("2mo ago");
  });

  test("years ago", () => {
    expect(formatAgo(now - 400 * 86_400_000, now)).toBe("1y ago");
  });
});
