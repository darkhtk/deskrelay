// PermissionModePicker — small select pinned to the chat sidebar bottom
// (above the profile card). Replaces the per-NewChatCard permission
// mode selector so the user can switch modes without opening a new chat.
//
// The mode applies to the next chat that's started; existing in-flight
// runs aren't affected (claude-runner only reads the mode at spawn).

import { type Component, For } from "solid-js";
import { CLAUDE_PERMISSION_MODES, type ClaudePermissionMode } from "../claude/stream-contract.ts";
import { t } from "../i18n.ts";

const OPTIONS: Array<{ value: ClaudePermissionMode; key: string }> = [
  { value: CLAUDE_PERMISSION_MODES.DEFAULT, key: "pm.option.default" },
  { value: CLAUDE_PERMISSION_MODES.ACCEPT_EDITS, key: "pm.option.accept-edits" },
  { value: CLAUDE_PERMISSION_MODES.BYPASS_PERMISSIONS, key: "pm.option.bypass" },
  { value: CLAUDE_PERMISSION_MODES.PLAN, key: "pm.option.plan" },
];

export interface PermissionModePickerProps {
  value: ClaudePermissionMode;
  onChange: (next: ClaudePermissionMode) => void;
}

export const PermissionModePicker: Component<PermissionModePickerProps> = (props) => {
  return (
    <div class="permission-mode-picker">
      <label class="sidebar-label" for="permission-mode">
        {t("pm.label")}
      </label>
      <select
        id="permission-mode"
        class="text-input"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value as ClaudePermissionMode)}
      >
        <For each={OPTIONS}>{(opt) => <option value={opt.value}>{t(opt.key)}</option>}</For>
      </select>
    </div>
  );
};
