import { describe, expect, test } from "vitest";
import { CLAUDE_PERMISSION_MODES } from "../src/claude/stream-contract.ts";
import {
  confirmPermissionModeState,
  createPermissionModeState,
  markPermissionModePending,
  markPermissionModeUnknown,
  permissionModeAlert,
  resetConfirmedPermissionModeState,
  setNextPermissionModeState,
} from "../src/domain/permission-mode-state.ts";

describe("permission mode state", () => {
  test("starts unconfirmed with default requested mode", () => {
    expect(createPermissionModeState()).toEqual({
      requested: CLAUDE_PERMISSION_MODES.DEFAULT,
      confirmed: null,
      status: "unconfirmed",
      lastRequested: null,
    });
  });

  test("marks a requested run as pending without changing the next requested mode", () => {
    const state = setNextPermissionModeState(
      createPermissionModeState(),
      CLAUDE_PERMISSION_MODES.PLAN,
    );
    const next = markPermissionModePending(state, CLAUDE_PERMISSION_MODES.PLAN);

    expect(next.requested).toBe(CLAUDE_PERMISSION_MODES.PLAN);
    expect(next.status).toBe("pending");
    expect(permissionModeAlert(next)).toEqual({
      key: "pm.status.checking",
      params: { mode: CLAUDE_PERMISSION_MODES.PLAN },
    });
  });

  test("confirms matching system init and keeps the actual mode as next mode", () => {
    const pending = markPermissionModePending(
      setNextPermissionModeState(createPermissionModeState(), CLAUDE_PERMISSION_MODES.AUTO),
      CLAUDE_PERMISSION_MODES.AUTO,
    );
    const confirmed = confirmPermissionModeState(
      pending,
      CLAUDE_PERMISSION_MODES.AUTO,
      CLAUDE_PERMISSION_MODES.AUTO,
    );

    expect(confirmed).toEqual({
      requested: CLAUDE_PERMISSION_MODES.AUTO,
      confirmed: CLAUDE_PERMISSION_MODES.AUTO,
      status: "confirmed",
      lastRequested: CLAUDE_PERMISSION_MODES.AUTO,
    });
    expect(permissionModeAlert(confirmed)).toBeNull();
  });

  test("surfaces mismatch and realigns next mode only when the user has not changed it", () => {
    const pending = markPermissionModePending(
      setNextPermissionModeState(createPermissionModeState(), CLAUDE_PERMISSION_MODES.PLAN),
      CLAUDE_PERMISSION_MODES.PLAN,
    );
    const mismatch = confirmPermissionModeState(
      pending,
      CLAUDE_PERMISSION_MODES.DEFAULT,
      CLAUDE_PERMISSION_MODES.PLAN,
    );

    expect(mismatch.requested).toBe(CLAUDE_PERMISSION_MODES.DEFAULT);
    expect(mismatch.confirmed).toBe(CLAUDE_PERMISSION_MODES.DEFAULT);
    expect(mismatch.status).toBe("mismatch");
    expect(permissionModeAlert(mismatch)).toEqual({
      key: "pm.status.mismatch",
      params: {
        requested: CLAUDE_PERMISSION_MODES.PLAN,
        actual: CLAUDE_PERMISSION_MODES.DEFAULT,
      },
    });
  });

  test("does not overwrite a newer user-selected next mode with an older mismatch", () => {
    const pending = markPermissionModePending(
      setNextPermissionModeState(createPermissionModeState(), CLAUDE_PERMISSION_MODES.PLAN),
      CLAUDE_PERMISSION_MODES.PLAN,
    );
    const userChanged = setNextPermissionModeState(pending, CLAUDE_PERMISSION_MODES.AUTO);
    const mismatch = confirmPermissionModeState(
      userChanged,
      CLAUDE_PERMISSION_MODES.DEFAULT,
      CLAUDE_PERMISSION_MODES.PLAN,
    );

    expect(mismatch.requested).toBe(CLAUDE_PERMISSION_MODES.AUTO);
    expect(mismatch.confirmed).toBe(CLAUDE_PERMISSION_MODES.DEFAULT);
    expect(mismatch.status).toBe("mismatch");
  });

  test("unknown mode report keeps the requested run visible to the user", () => {
    const unknown = markPermissionModeUnknown(
      createPermissionModeState(CLAUDE_PERMISSION_MODES.BYPASS_PERMISSIONS),
      CLAUDE_PERMISSION_MODES.BYPASS_PERMISSIONS,
    );

    expect(permissionModeAlert(unknown)).toEqual({
      key: "pm.status.unknown",
      params: { mode: CLAUDE_PERMISSION_MODES.BYPASS_PERMISSIONS },
    });
  });

  test("reset clears only the confirmed run state and keeps the selected next mode", () => {
    const confirmed = confirmPermissionModeState(
      setNextPermissionModeState(createPermissionModeState(), CLAUDE_PERMISSION_MODES.AUTO),
      CLAUDE_PERMISSION_MODES.AUTO,
      CLAUDE_PERMISSION_MODES.AUTO,
    );
    const reset = resetConfirmedPermissionModeState(confirmed);

    expect(reset).toEqual({
      requested: CLAUDE_PERMISSION_MODES.AUTO,
      confirmed: null,
      status: "unconfirmed",
      lastRequested: null,
    });
  });
});
