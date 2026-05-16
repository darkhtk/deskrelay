import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonManagerDecisionStore } from "../src/manager-decision-store.ts";

describe("manager decision store", () => {
  test("creates, updates, archives, and preserves revisions per project", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskrelay-decision-store-"));
    try {
      const store = createJsonManagerDecisionStore(root, {
        now: fixedClock([
          "2026-05-16T00:00:00.000Z",
          "2026-05-16T00:01:00.000Z",
          "2026-05-16T00:02:00.000Z",
        ]),
      });

      const created = await store.create("project_a", {
        title: "Separate reviewer",
        detail: "Reviewer writes reports only.",
        tags: ["protocol", "review", "protocol"],
        createdBy: "manager",
      });
      expect(created.status).toBe("active");
      expect(created.tags).toEqual(["protocol", "review"]);
      expect(created.createdBy).toBe("manager");

      const updated = await store.update("project_a", created.id, {
        status: "superseded",
        detail: "Reviewer may write only report artifacts.",
      });
      expect(updated?.status).toBe("superseded");
      expect(updated?.revisions).toHaveLength(1);
      expect(updated?.revisions[0]?.detail).toBe("Reviewer writes reports only.");

      const archived = await store.update("project_a", created.id, { status: "archived" });
      expect(archived?.status).toBe("archived");
      expect(archived?.revisions).toHaveLength(2);

      await store.create("project_b", {
        title: "Other project",
        detail: "Do not leak into project A.",
      });

      const listA = await store.list("project_a");
      expect(listA.decisions).toEqual([]);
      expect(listA.archived.map((decision) => decision.id)).toEqual([created.id]);

      const listB = await store.list("project_b");
      expect(listB.decisions).toHaveLength(1);
      expect(listB.archived).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function fixedClock(values: string[]): () => Date {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)] as string);
}
