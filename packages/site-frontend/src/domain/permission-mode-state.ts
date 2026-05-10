import { CLAUDE_PERMISSION_MODES, type ClaudePermissionMode } from "../claude/stream-contract.ts";

export type PermissionModeStatus = "unconfirmed" | "pending" | "confirmed" | "mismatch" | "unknown";

export interface PermissionModeState {
  requested: ClaudePermissionMode;
  confirmed: ClaudePermissionMode | null;
  status: PermissionModeStatus;
  lastRequested: ClaudePermissionMode | null;
}

export type PermissionModeAlert =
  | { key: "pm.status.checking"; params: { mode: ClaudePermissionMode } }
  | { key: "pm.status.unknown"; params: { mode: ClaudePermissionMode } }
  | {
      key: "pm.status.mismatch";
      params: { requested: ClaudePermissionMode; actual: ClaudePermissionMode };
    };

export function createPermissionModeState(
  requested: ClaudePermissionMode = CLAUDE_PERMISSION_MODES.DEFAULT,
): PermissionModeState {
  return {
    requested,
    confirmed: null,
    status: "unconfirmed",
    lastRequested: null,
  };
}

export function resetConfirmedPermissionModeState(state: PermissionModeState): PermissionModeState {
  return {
    ...state,
    confirmed: null,
    status: "unconfirmed",
    lastRequested: null,
  };
}

export function setNextPermissionModeState(
  state: PermissionModeState,
  next: ClaudePermissionMode,
): PermissionModeState {
  return {
    ...state,
    requested: next,
    status: state.confirmed ? "confirmed" : "unconfirmed",
    lastRequested: null,
  };
}

export function markPermissionModePending(
  state: PermissionModeState,
  requested: ClaudePermissionMode,
): PermissionModeState {
  return {
    ...state,
    lastRequested: requested,
    status: "pending",
  };
}

export function markPermissionModeUnknown(
  state: PermissionModeState,
  requested: ClaudePermissionMode,
): PermissionModeState {
  return {
    ...state,
    lastRequested: requested,
    status: "unknown",
  };
}

export function confirmPermissionModeState(
  state: PermissionModeState,
  actual: ClaudePermissionMode,
  requested: ClaudePermissionMode | null,
): PermissionModeState {
  if (requested && requested !== actual) {
    return {
      ...state,
      requested: state.requested === requested ? actual : state.requested,
      confirmed: actual,
      lastRequested: requested,
      status: "mismatch",
    };
  }

  return {
    ...state,
    requested: !requested || state.requested === requested ? actual : state.requested,
    confirmed: actual,
    lastRequested: requested,
    status: "confirmed",
  };
}

export function permissionModeAlert(state: PermissionModeState): PermissionModeAlert | null {
  if (state.status === "pending") {
    return {
      key: "pm.status.checking",
      params: { mode: state.lastRequested ?? state.requested },
    };
  }
  if (state.status === "unknown") {
    return {
      key: "pm.status.unknown",
      params: { mode: state.lastRequested ?? state.requested },
    };
  }
  if (state.status === "mismatch" && state.confirmed && state.lastRequested) {
    return {
      key: "pm.status.mismatch",
      params: { requested: state.lastRequested, actual: state.confirmed },
    };
  }
  return null;
}
