import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryManagerArtifactStore,
  createJsonManagerArtifactStore,
} from "../src/manager-artifact-store.ts";

describe("manager artifact store", () => {
  test("dedupes scanned paths per project and preserves inactive status on rescan", async () => {
    let time = 0;
    const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, time++));
    const store = createInMemoryManagerArtifactStore({ now });

    const first = await store.upsertMany("project-a", [
      {
        path: "PROTOCOL.md",
        kind: "protocol",
        owner: "protocol",
        source: "worker",
        agentId: "agent-1",
      },
      {
        path: "protocol.md",
        kind: "protocol",
        owner: "protocol",
        source: "worker",
        agentId: "agent-1",
      },
    ]);

    expect(first.created).toHaveLength(1);
    expect(first.artifacts).toHaveLength(1);
    expect(first.artifacts[0]?.path).toBe("protocol.md");

    const artifact = first.artifacts[0];
    expect(artifact).toBeDefined();
    const obsolete = await store.update("project-a", artifact?.id ?? "", {
      status: "obsolete",
      note: "superseded by STATE.md",
    });
    expect(obsolete?.status).toBe("obsolete");

    const second = await store.upsertMany("project-a", [
      {
        path: "PROTOCOL.md",
        kind: "protocol",
        owner: "protocol",
        source: "scan",
      },
    ]);

    expect(second.created).toHaveLength(0);
    expect(second.artifacts).toHaveLength(0);
    expect(second.inactive).toHaveLength(1);
    expect(second.inactive[0]?.status).toBe("obsolete");

    const revived = await store.update("project-a", artifact?.id ?? "", { status: "active" });
    expect(revived?.status).toBe("active");
    const listed = await store.list("project-a");
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.inactive).toHaveLength(0);
  });

  test("json store keeps project artifacts isolated", async () => {
    const temp = await mkdtemp(join(tmpdir(), "deskrelay-artifacts-"));
    const store = createJsonManagerArtifactStore(temp);

    await store.upsertMany("project-a", [{ path: "A.md", owner: "a", source: "scan" }]);
    await store.upsertMany("project-b", [{ path: "B.md", owner: "b", source: "scan" }]);

    expect((await store.list("project-a")).artifacts.map((artifact) => artifact.path)).toEqual([
      "A.md",
    ]);
    expect((await store.list("project-b")).artifacts.map((artifact) => artifact.path)).toEqual([
      "B.md",
    ]);
  });
});
