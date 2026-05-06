import { render } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import type { ClaudeStreamEvent } from "../src/api.ts";
import { CapabilitiesBadge } from "../src/components/CapabilitiesBadge.tsx";

const initEvent = (overrides: Partial<ClaudeStreamEvent> = {}): ClaudeStreamEvent =>
  ({
    type: "system",
    subtype: "init",
    session_id: "sess_xxx",
    model: "claude-opus-4-7",
    cwd: "/home/user",
    permissionMode: "default",
    tools: [{}, {}, {}],
    mcp_servers: [{}, {}],
    ...overrides,
  }) as ClaudeStreamEvent;

describe("CapabilitiesBadge", () => {
  test("renders nothing when there are no events", () => {
    const { container } = render(() => <CapabilitiesBadge events={[]} />);
    expect(container.querySelector(".capabilities-badge")).toBeFalsy();
  });

  test("renders model + mode + tools + mcp chips after init", () => {
    const { container } = render(() => <CapabilitiesBadge events={[initEvent()]} />);
    const chips = container.querySelectorAll(".cap-chip");
    expect(chips.length).toBe(4);
    expect(container.textContent).toContain("claude-opus-4-7");
    expect(container.textContent).toContain("default");
    expect(container.textContent).toContain("3"); // tools
    expect(container.textContent).toContain("2"); // mcp
  });

  test("hides tool/mcp chips when counts are 0 / missing", () => {
    const { container } = render(() => (
      <CapabilitiesBadge
        events={[initEvent({ tools: [], mcp_servers: undefined } as Partial<ClaudeStreamEvent>)]}
      />
    ));
    expect(container.querySelector(".cap-chip-tools")).toBeFalsy();
    expect(container.querySelector(".cap-chip-mcp")).toBeFalsy();
    expect(container.querySelector(".cap-chip-model")).toBeTruthy();
    expect(container.querySelector(".cap-chip-mode")).toBeTruthy();
  });

  test("ignores non-init events (no session metadata)", () => {
    const userEvent: ClaudeStreamEvent = {
      type: "user",
      message: { content: [{ type: "text", text: "hi" }] },
    } as ClaudeStreamEvent;
    const { container } = render(() => <CapabilitiesBadge events={[userEvent]} />);
    expect(container.querySelector(".capabilities-badge")).toBeFalsy();
  });
});
