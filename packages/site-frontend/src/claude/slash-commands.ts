// slash-commands — pure list + filter for the composer's "/" picker.
//
// Mixes claude CLI built-ins and Claude Code built-in skills. Per-PC user
// or plugin skills aren't surfaced yet — when the daemon exposes a
// capabilities endpoint that lists them, merge in.
//
// Ported from claude-remote/public/slash-commands.js with five entries
// dropped (they target the local claude CLI / Claude Code harness rather
// than the remote site context):
//   - /login, /logout — claude CLI's Anthropic re-auth; user is already
//     signed into the platform site, and re-auth would log out the PC's
//     CLI mid-session
//   - /keybindings-help, /update-config — target Claude Code's terminal
//     harness, not our browser/mobile shell
//   - /skills — currently returns "isn't available in this environment"
//     in the connector-run Claude Code environment, so advertising it is
//     misleading until daemon-side capability discovery exists.
//
// /cost is a local Claude Code concern, not a DeskRelay feature.
// so cost-to-the-user is not the right framing — it's just usage stats
// for the curious.

export interface SlashCommand {
  name: string;
  hint: string;
  /** Marks an automation command that is planned but not available in
   *  the hosted alpha. The picker shows a small status badge. */
  paid?: boolean;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<SlashCommand> = Object.freeze([
  // CLI commands
  { name: "/help", hint: "Show built-in command list" },
  { name: "/clear", hint: "Clear the conversation transcript" },
  { name: "/compact", hint: "Summarize older turns to free context" },
  { name: "/cost", hint: "Token usage stats" },
  { name: "/resume", hint: "Resume a recent session" },
  { name: "/model", hint: "Switch the active model" },
  { name: "/permissions", hint: "Edit allow/deny tool rules" },
  { name: "/mcp", hint: "Inspect / restart MCP servers" },
  { name: "/hooks", hint: "List configured hooks" },
  { name: "/agents", hint: "List installed sub-agents" },
  { name: "/doctor", hint: "Diagnose CLI / config issues" },
  // Built-in skills
  { name: "/init", hint: "Generate a CLAUDE.md for this repo" },
  { name: "/loop", hint: "Run a prompt or slash command on a recurring interval", paid: true },
  { name: "/schedule", hint: "Schedule remote agents on a cron schedule", paid: true },
  { name: "/review", hint: "Review a pull request" },
  { name: "/security-review", hint: "Security review of pending changes" },
  { name: "/simplify", hint: "Review changed code for reuse, quality, efficiency" },
  { name: "/claude-api", hint: "Build / debug Claude API + Anthropic SDK apps" },
  {
    name: "/fewer-permission-prompts",
    hint: "Trim repeated permission prompts via allowlist",
  },
]);

/** Returns candidate slash commands for an input value.
 *  - If the value doesn't start with "/", returns [].
 *  - If the value is just "/", returns the full list.
 *  - Otherwise returns prefix-matched commands (case-insensitive).
 *  Only triggers on the first line so a "/" inside a code block on a
 *  later line doesn't pop the picker. Hides once a space is typed (the
 *  user has moved past the command name into args). */
export function filterSlashCommands(
  value: unknown,
  commands: ReadonlyArray<SlashCommand> = BUILTIN_SLASH_COMMANDS,
): SlashCommand[] {
  const v = String(value ?? "");
  if (!v.startsWith("/")) return [];
  const firstLine = v.split(/\r?\n/, 1)[0] || v;
  if (!firstLine.startsWith("/")) return [];
  if (firstLine.includes(" ")) return [];
  const prefix = firstLine.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(prefix));
}

/** Replaces the slash region of `value` with the chosen command,
 *  preserving any trailing text on subsequent lines. Adds a trailing
 *  space so the caret is positioned ready for arguments. */
export function applySlashCompletion(value: unknown, commandName: string): string {
  const v = String(value ?? "");
  const m = v.match(/^\/\S*/);
  if (!m) return `${commandName} `;
  return `${commandName} ${v.slice(m[0].length)}`;
}
