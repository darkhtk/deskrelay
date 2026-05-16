import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonManagerProjectStore } from "../src/manager-project-store.ts";

describe("manager project store", () => {
  test("creates, updates, lists, and archives projects", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskrelay-project-store-"));
    try {
      const store = createJsonManagerProjectStore(root, {
        now: fixedClock([
          "2026-05-16T00:00:00.000Z",
          "2026-05-16T00:01:00.000Z",
          "2026-05-16T00:02:00.000Z",
        ]),
      });

      const created = await store.create({
        cwd: "C:\\Users\\darkh\\Projects\\orchestration-lab",
        goal: "verify orchestration",
        activeRoundId: "round_1",
      });
      expect(created.name).toBe("orchestration-lab");
      expect(created.status).toBe("planning");
      expect(created.activeRoundId).toBe("round_1");

      const updated = await store.update(created.id, {
        status: "running",
        summary: "R1 dispatched",
      });
      expect(updated?.status).toBe("running");
      expect(updated?.summary).toBe("R1 dispatched");

      const archived = await store.archive(created.id);
      expect(archived?.status).toBe("archived");
      expect(archived?.archivedAt).toBe("2026-05-16T00:02:00.000Z");

      const list = await store.list();
      expect(list.projects).toEqual([]);
      expect(list.archived.map((project) => project.id)).toEqual([created.id]);
      expect(list.corrupt).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports corrupt project records without blocking valid projects", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskrelay-project-store-"));
    try {
      const store = createJsonManagerProjectStore(root, {
        now: () => new Date("2026-05-16T00:00:00.000Z"),
      });
      const created = await store.create({
        cwd: "C:\\Users\\darkh\\Projects\\valid",
        name: "Valid",
      });
      writeFileSync(join(root, "broken.json"), "{ not json", "utf8");

      const list = await store.list();
      expect(list.projects.map((project) => project.id)).toEqual([created.id]);
      expect(list.corrupt).toHaveLength(1);
      expect(list.corrupt[0]?.id).toBe("broken");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function fixedClock(values: string[]): () => Date {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)] as string);
}
