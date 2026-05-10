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
      message: "현재 설치 버전 1.2.3 (aaaaaaa) · 최신 상태",
      level: "info",
    });
  });

  test("reports update available when remote commit differs", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build(),
      runner: async () => ({ stdout: `${REMOTE}\trefs/heads/main\n` }),
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 설치 버전 1.2.3 (aaaaaaa) · 업데이트 있음 (bbbbbbb)",
      level: "warning",
    });
  });

  test("reports local changes as warning even when remote matches", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build({ dirty: true }),
      runner: async () => ({ stdout: `${CURRENT}\trefs/heads/main\n` }),
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 설치 버전 1.2.3 (aaaaaaa) · 최신 상태 · 로컬 변경 있음",
      level: "warning",
    });
  });

  test("reports check failure when remote lookup fails", async () => {
    const source = createGitUpdateNoticeSource({
      repoRoot: "C:\\repo",
      build: build(),
      runner: async () => {
        throw new Error("network unavailable");
      },
    });

    const payload = await source.read();
    expect(payload).toEqual({
      message: "현재 설치 버전 1.2.3 (aaaaaaa) · 업데이트 확인 불가",
      level: "warning",
    });
  });
});
