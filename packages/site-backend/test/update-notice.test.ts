import { describe, expect, test } from "bun:test";
import type { DeskRelayBuildInfo } from "@deskrelay/shared/version";
import { createGitUpdateNoticeSource } from "../src/update-notice.ts";

const CURRENT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REMOTE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function build(overrides: Partial<DeskRelayBuildInfo> = {}): DeskRelayBuildInfo {
  return {
    version: "1.2.3",
    commit: CURRENT,
    shortCommit: CURRENT.slice(0, 12),
    dirty: false,
    source: "git",
    ...overrides,
  };
}

describe("git update notice", () => {
  test("reports up to date when local and remote commits match", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build(),
      runner: async () => ({ stdout: `${CURRENT}\trefs/heads/main\n` }),
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 버젼 v1.2.3",
      level: "info",
    });
  });

  test("reports next version when remote commit has a different package version", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build(),
      runner: async (args) => ({
        stdout:
          args[0] === "show"
            ? JSON.stringify({ version: "1.2.4" })
            : `${REMOTE}\trefs/heads/main\n`,
      }),
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 버젼 v1.2.3, 다음 버젼 v1.2.4",
      level: "warning",
    });
  });

  test("omits next version when remote package version is unavailable", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build(),
      runner: async (args) => {
        if (args[0] === "show") throw new Error("not fetched");
        return { stdout: `${REMOTE}\trefs/heads/main\n` };
      },
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 버젼 v1.2.3",
      level: "info",
    });
  });

  test("explicit next version overrides git package lookup", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build(),
      nextVersion: "v2.0.0",
      runner: async () => ({ stdout: `${CURRENT}\trefs/heads/main\n` }),
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 버젼 v1.2.3, 다음 버젼 v2.0.0",
      level: "warning",
    });
  });

  test("keeps current version only when remote lookup fails", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build(),
      runner: async () => {
        throw new Error("network unavailable");
      },
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 버젼 v1.2.3",
      level: "info",
    });
  });
});
