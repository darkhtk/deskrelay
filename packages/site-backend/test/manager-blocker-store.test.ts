import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonManagerBlockerStore } from "../src/manager-blocker-store.ts";

describe("manager blocker store", () => {
  test("deduplicates open blockers and separates resolved blockers per project", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskrelay-blocker-store-"));
    try {
      const store = createJsonManagerBlockerStore(root, {
        now: fixedClock([
          "2026-05-16T00:00:00.000Z",
          "2026-05-16T00:01:00.000Z",
          "2026-05-16T00:02:00.000Z",
        ]),
      });

      const created = await store.create("project_a", {
        title: "Remote connector unreachable",
        detail: "Server cannot reach the selected connector through Tailscale.",
        severity: "error",
        requiredAction: "user",
        owner: "operator",
        source: "manager",
        dedupeKey: "device:remote:timeout",
      });
      expect(created.created).toBe(true);
      expect(created.blocker.status).toBe("open");

      const duplicate = await store.create("project_a", {
        title: "Same timeout",
        severity: "warning",
        requiredAction: "manager",
        owner: "manager",
        source: "system",
        dedupeKey: "device:remote:timeout",
      });
      expect(duplicate.created).toBe(false);
      expect(duplicate.blocker.id).toBe(created.blocker.id);
      expect(duplicate.blocker.title).toBe("Remote connector unreachable");

      await store.create("project_b", {
        title: "Other project blocker",
        severity: "warning",
        requiredAction: "worker",
        source: "browser",
      });

      const resolved = await store.resolve("project_a", created.blocker.id, {
        resolution: "User re-registered the connector.",
      });
      expect(resolved?.status).toBe("resolved");
      expect(resolved?.resolution).toBe("User re-registered the connector.");

      const listA = await store.list("project_a");
      expect(listA.blockers).toEqual([]);
      expect(listA.resolved.map((blocker) => blocker.id)).toEqual([created.blocker.id]);

      const listB = await store.list("project_b");
      expect(listB.blockers).toHaveLength(1);
      expect(listB.resolved).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function fixedClock(values: string[]): () => Date {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)] as string);
}
