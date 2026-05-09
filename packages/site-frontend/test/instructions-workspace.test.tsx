import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import type { ClaudeInstructionSource } from "../src/api.ts";
import { InstructionsWorkspace } from "../src/components/InstructionsWorkspace.tsx";
import { t } from "../src/i18n.ts";

const SOURCES: ClaudeInstructionSource[] = [
  {
    scope: "user",
    label: "사용자 전역",
    path: "C:\\Users\\darkh\\.claude\\CLAUDE.md",
    readonly: false,
    exists: true,
    content: "global line 1\nglobal line 2",
  },
  {
    scope: "project",
    label: "프로젝트",
    path: "C:\\Users\\darkh\\Projects\\deskrelay\\CLAUDE.md",
    readonly: false,
    exists: false,
    content: "",
  },
];

function setup(overrides: Partial<Parameters<typeof InstructionsWorkspace>[0]> = {}) {
  const drafts: Record<string, string> = Object.fromEntries(
    SOURCES.map((source) => [source.scope, source.content]),
  );
  return render(() => (
    <InstructionsWorkspace
      cwd="C:\\Users\\darkh\\Projects\\deskrelay"
      sources={SOURCES}
      loading={false}
      error={null}
      draft={(source) => drafts[source.scope] ?? source.content}
      dirty={() => false}
      savingScope={null}
      status={null}
      onInput={(source, content) => {
        drafts[source.scope] = content;
      }}
      onReset={vi.fn()}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onReload={vi.fn()}
      onBack={vi.fn()}
      {...overrides}
    />
  ));
}

describe("InstructionsWorkspace", () => {
  test("renders source cards as visibility-first raw text", () => {
    const { container } = setup();

    expect(container.textContent).toContain("사용자 전역");
    expect(container.textContent).toContain("global line 1");
    expect(container.textContent).toContain("global line 2");
    expect(container.textContent).toContain(t("instructions.workspace.line-count", { count: "2" }));
  });

  test("opens the source editor drawer from a clicked line", () => {
    const { container } = setup();
    const line = [...container.querySelectorAll(".instruction-source-line")].find((item) =>
      item.textContent?.includes("global line 2"),
    ) as HTMLButtonElement | undefined;
    if (!line) throw new Error("instruction line missing");

    fireEvent.click(line);

    expect(container.querySelector(".instruction-editor-drawer")).toBeInTheDocument();
    expect(container.querySelector(".instruction-source-line.is-active")?.textContent).toContain(
      "global line 2",
    );
  });

  test("missing scopes keep a create affordance", () => {
    const { container } = setup();
    expect(container.textContent).toContain(
      t("instructions.workspace.create", { label: "프로젝트" }),
    );
  });
});
