import type { Device } from "./api.ts";

export type ConnectionStatusKind =
  | "not_installed"
  | "site_connecting"
  | "online"
  | "selected_device_offline"
  | "behavior_not_ready"
  | "streaming"
  | "tool_running"
  | "approval_waiting"
  | "error";

export type ConnectionStatusTone = "ok" | "pending" | "warning" | "danger" | "offline";
export type ConnectionStatusAction = "devices" | "diagnostics";

export interface ConnectionStatus {
  kind: ConnectionStatusKind;
  tone: ConnectionStatusTone;
  mainKey: string;
  detailKey: string;
  action?: ConnectionStatusAction;
  detailOverride?: string;
}

export interface ConnectionStatusInput {
  devices: Device[] | undefined;
  devicesLoading: boolean;
  activeDevice: Device | null;
  behaviorsLoading: boolean;
  hasRemoteClaude: boolean;
  running: boolean;
  activityLabel: string | null;
  approvalWaiting: boolean;
  hasError: boolean;
}

export function deriveConnectionStatus(input: ConnectionStatusInput): ConnectionStatus {
  const hasDevices = (input.devices?.length ?? 0) > 0;

  if (input.devicesLoading && !hasDevices) {
    return status("site_connecting", "pending", "devices");
  }

  if (!hasDevices || !input.activeDevice) {
    return status("not_installed", "danger", "devices");
  }

  if (input.activeDevice.connectionState === "offline") {
    return status("selected_device_offline", "offline", "devices");
  }

  if (input.approvalWaiting) {
    return status("approval_waiting", "warning", "diagnostics", input.activityLabel ?? undefined);
  }

  if (input.running) {
    if (input.activityLabel) {
      return status("tool_running", "pending", undefined, input.activityLabel);
    }
    return status("streaming", "pending");
  }

  if (input.behaviorsLoading) {
    return status("site_connecting", "pending", "diagnostics");
  }

  if (!input.hasRemoteClaude) {
    return status("behavior_not_ready", "danger", "diagnostics");
  }

  if (input.hasError) {
    return status("error", "warning", "diagnostics");
  }

  return status("online", "ok");
}

function status(
  kind: ConnectionStatusKind,
  tone: ConnectionStatusTone,
  action?: ConnectionStatusAction,
  detailOverride?: string,
): ConnectionStatus {
  return {
    kind,
    tone,
    mainKey: `connection.status.${kind}.main`,
    detailKey: `connection.status.${kind}.detail`,
    ...(action ? { action } : {}),
    ...(detailOverride ? { detailOverride } : {}),
  };
}
