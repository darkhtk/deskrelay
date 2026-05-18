import type { ManagerAgent } from "@deskrelay/shared";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ManagerOrchestrationPanel } from "../src/components/ManagerOrchestrationPanel.tsx";
import { setLocale, t } from "../src/i18n.ts";

beforeEach(() => {
  setLocale("en");
  window.localStorage.clear();
});

afterEach(() => {
  setLocale("ko");
  window.localStorage.clear();
});

describe("ManagerOrchestrationPanel agents view", () => {
  test("keeps agent details collapsed and renders JSON output as readable fields", () => {
    const agent: ManagerAgent = {
      id: "agent-verifier",
      role: "verifier",
      label: "Verifier agent",
      profile: "Checks whether the build matches the requested UX.",
      status: "completed",
      lastInstruction: "Review the latest orchestration board.",
      lastOutput: JSON.stringify({
        review_notes: "Agent cards are easier to scan.",
        changedFiles: ["ManagerOrchestrationPanel.tsx", "styles.css"],
        metrics: {
          collapsedByDefault: true,
          visibleFields: 2,
        },
      }),
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:10:00.000Z",
    };

    render(() => <ManagerOrchestrationPanel rounds={[]} agents={[agent]} standalone />);

    fireEvent.click(screen.getByRole("tab", { name: t("manager.orchestration.tab.agents") }));

    const summary = screen.getByText("Verifier agent").closest("summary");
    expect(summary).toBeTruthy();
    expect(summary?.textContent).toContain("Verifier agent");
    expect(summary?.textContent).toContain(t("manager.orchestration.status.completed"));
    expect(summary?.textContent).not.toContain("Checks whether");
    expect(summary?.textContent).not.toContain("review_notes");

    const details = summary?.closest("details") as HTMLDetailsElement | null;
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);

    fireEvent.click(summary as HTMLElement);

    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain("Checks whether the build matches the requested UX.");

    const readableJson = details?.querySelector(".manager-agent-json-render");
    expect(readableJson).toBeTruthy();
    expect(readableJson?.textContent).toContain("review notes");
    expect(readableJson?.textContent).toContain("Agent cards are easier to scan.");
    expect(readableJson?.textContent).toContain("changed files");
    expect(readableJson?.textContent).toContain("collapsed by default");
    expect(readableJson?.textContent).not.toContain('"review_notes"');
  });
});
