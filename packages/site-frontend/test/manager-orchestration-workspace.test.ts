import type { ManagerProject, ManagerProjectListResponse } from "@deskrelay/shared";
import { describe, expect, test } from "vitest";
import { resolveSelectedManagerProject } from "../src/components/ManagerOrchestrationWorkspace.tsx";

const generatedAt = "2026-05-17T00:00:00.000Z";

function project(input: Pick<ManagerProject, "id" | "name" | "status">): ManagerProject {
  return {
    ...input,
    cwd: `C:\\work\\${input.id}`,
    goal: `${input.name} goal`,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

function projectList(
  projects: ManagerProject[],
  archived: ManagerProject[] = [],
): ManagerProjectListResponse {
  return { generatedAt, projects, archived, corrupt: [] };
}

describe("resolveSelectedManagerProject", () => {
  test("does not auto-select the first active project when no project is selected", () => {
    const active = project({ id: "active-project", name: "Active project", status: "planning" });

    expect(resolveSelectedManagerProject(projectList([active]), null)).toBeNull();
  });

  test("resolves archived projects only when they are explicitly selected", () => {
    const active = project({ id: "active-project", name: "Active project", status: "planning" });
    const archived = project({
      id: "archived-project",
      name: "Archived project",
      status: "archived",
    });

    expect(resolveSelectedManagerProject(projectList([active], [archived]), archived.id)).toBe(
      archived,
    );
  });

  test("clears stale selected project ids", () => {
    const active = project({ id: "active-project", name: "Active project", status: "planning" });

    expect(resolveSelectedManagerProject(projectList([active]), "missing-project")).toBeNull();
  });
});
