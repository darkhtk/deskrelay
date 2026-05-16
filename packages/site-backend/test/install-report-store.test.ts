import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createJsonInstallReportStore } from "../src/install-report-store.ts";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempReportPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deskrelay-install-reports-"));
  tempDirs.push(dir);
  return join(dir, "reports.json");
}

describe("Json install report store", () => {
  test("collapses repeated connector failures from the same PC and failure step", async () => {
    const filePath = await tempReportPath();
    const dates = [
      new Date("2026-05-13T00:00:00.000Z"),
      new Date("2026-05-13T00:01:00.000Z"),
      new Date("2026-05-13T00:02:00.000Z"),
    ];
    const store = createJsonInstallReportStore(filePath, {
      maxReports: 10,
      now: () => dates.shift() ?? new Date("2026-05-13T00:03:00.000Z"),
    });

    const repeatedFailure = {
      status: "failed",
      server: "http://100.67.105.67:18193",
      label: "DESKTOP-8GHUPS5",
      steps: [
        {
          id: "server-to-daemon",
          label: "server-to-connector",
          status: "failed",
          summary: "cannot reach daemon",
        },
      ],
    };

    await store.add(repeatedFailure);
    const collapsed = await store.add(repeatedFailure);
    await store.add({
      ...repeatedFailure,
      label: "OTHER-PC",
    });

    const reports = await store.list(10);
    expect(reports).toHaveLength(2);
    expect(reports[1]?.id).toBe(collapsed.id);
    expect(collapsed.repeatCount).toBe(2);
    expect(collapsed.firstReceivedAt).toBe("2026-05-13T00:00:00.000Z");
    expect(collapsed.lastReceivedAt).toBe("2026-05-13T00:01:00.000Z");
  });

  test("clears stored reports when cleanup is requested", async () => {
    const filePath = await tempReportPath();
    const store = createJsonInstallReportStore(filePath);
    await store.add({ status: "failed", steps: [] });
    await store.add({ status: "succeeded", steps: [] });

    await expect(store.list(10)).resolves.toHaveLength(2);
    await expect(store.clear?.()).resolves.toEqual({ deleted: 2 });
    await expect(store.list(10)).resolves.toEqual([]);
  });
});
