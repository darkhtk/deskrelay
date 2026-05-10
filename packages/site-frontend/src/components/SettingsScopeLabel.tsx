import { type Component, For } from "solid-js";

export type SettingsScope = "server" | "current device" | "current session" | "browser";

export const SettingsScopeLabel: Component<{ scope: SettingsScope }> = (props) => (
  <span class="settings-scope-label">{props.scope}</span>
);

export const SettingsScopeLabels: Component<{ scopes: SettingsScope[] }> = (props) => (
  <span class="settings-scope-labels">
    <For each={props.scopes}>{(scope) => <SettingsScopeLabel scope={scope} />}</For>
  </span>
);
