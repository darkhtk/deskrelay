// PermissionModePicker — small select pinned to the chat sidebar bottom
// (above the profile card). Replaces the per-NewChatCard permission
// mode selector so the user can switch modes without opening a new chat.
//
// This is a request for the next Claude run, not the confirmed current
// mode. The confirmed mode comes back from Claude's system:init event.

import { type Component, For } from "solid-js";
import { CLAUDE_PERMISSION_MODES, type ClaudePermissionMode } from "../claude/stream-contract.ts";
import { t } from "../i18n.ts";

const OPTIONS: Array<{ value: ClaudePermissionMode; key: string }> = [
  { value: CLAUDE_PERMISSION_MODES.DEFAULT, key: "pm.option.default" },
  { value: CLAUDE_PERMISSION_MODES.AUTO, key: "pm.option.auto" },
  { value: CLAUDE_PERMISSION_MODES.ACCEPT_EDITS, key: "pm.option.accept-edits" },
  { value: CLAUDE_PERMISSION_MODES.DONT_ASK, key: "pm.option.dont-ask" },
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
