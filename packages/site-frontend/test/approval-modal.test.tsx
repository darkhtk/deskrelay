import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, api } from "../src/api.ts";
import {
  APPROVAL_FALLBACK_TIMEOUT_MS,
  ApprovalModal,
  approvalDeadlineMs,
  parsePending,
} from "../src/components/ApprovalModal.tsx";
import { getAlwaysAllowedTools } from "../src/device-prefs.ts";

const DEV_ID = "dev_approval_1";
const START = Date.parse("2026-05-02T00:00:00.000Z");

function pendingEvent(expiresAt: string) {
  return {
    kind: "approval.pending",
    content: {
      id: "apr_test_1",
      createdAt: new Date(START).toISOString(),
      expiresAt,
      payload: {
        tool_name: "Bash",
        tool_input: { command: "rm -rf ./dist" },
        session_id: "sess_1",
      },
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("ApprovalModal deadline handling", () => {
  test("parses the daemon-provided expiresAt deadline", () => {
    const expiresAt = new Date(START + 60_000).toISOString();
    const parsed = parsePending(pendingEvent(expiresAt).content);
    expect(parsed).toMatchObject({
      id: "apr_test_1",
      toolName: "Bash",
      sessionId: "sess_1",
      expiresAt,
    });
    expect(approvalDeadlineMs(parsed!, START)).toBe(START + 60_000);
  });

  test("falls back below the daemon timeout when old events omit expiresAt", () => {
    expect(
      approvalDeadlineMs(
        {
          id: "apr_legacy",
          toolName: "Bash",
          toolInput: {},
        },
        START,
      ),
    ).toBe(START + APPROVAL_FALLBACK_TIMEOUT_MS);
  });

  test("auto-denies at the daemon event deadline, not a hard-coded longer UI timeout", async () => {
    const expiresAt = new Date(START + 10_000).toISOString();
    vi.spyOn(api, "streamEvents").mockImplementation(async function* () {
      yield pendingEvent(expiresAt);
    });
    const respond = vi.spyOn(api, "respondApproval").mockResolvedValue({ ok: true });

    const { container } = render(() => <ApprovalModal deviceId={DEV_ID} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Bash");
    });

    await vi.advanceTimersByTimeAsync(9_000);
    expect(respond).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await waitFor(() => {
      expect(respond).toHaveBeenCalledWith(DEV_ID, "apr_test_1", "deny");
    });
  });

  test("stale 404 closes the modal without saving an always-allow grant", async () => {
    const expiresAt = new Date(START + 60_000).toISOString();
    vi.spyOn(api, "streamEvents").mockImplementation(async function* () {
      yield pendingEvent(expiresAt);
    });
    vi.spyOn(api, "respondApproval").mockRejectedValue(new ApiError("approval not found", 404));

    const { container } = render(() => <ApprovalModal deviceId={DEV_ID} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Bash");
    });

    const buttons = [...container.querySelectorAll("button")];
    const alwaysAllow = buttons.find((button) => /always/i.test(button.textContent ?? ""));
    expect(alwaysAllow).toBeTruthy();
    if (!alwaysAllow) throw new Error("always-allow button missing");
    fireEvent.click(alwaysAllow);

    await waitFor(() => {
      expect(container.querySelector(".approval-modal-root")).toBeNull();
    });
    expect([...getAlwaysAllowedTools(DEV_ID)]).not.toContain("Bash");
  });
});
