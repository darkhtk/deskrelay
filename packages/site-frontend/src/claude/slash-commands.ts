// slash-commands -- pure list + filter for the composer's "/" picker.
//
// Mixes DeskRelay-local commands, Claude CLI built-ins, Claude Code built-in
// skills, and runtime-discovered per-PC user/plugin skills. The runtime list
// comes from Claude Code's stream-json `system init` event, which is the
// closest thing the --print IPC path gives us to a slash-command capability
// surface.

export interface SlashCommand {
  name: string;
  hint: string;
  /** Marks an automation command that is planned but not available in
   *  every Claude Code environment. The picker shows a small status badge. */
  paid?: boolean;
}

export interface RuntimeSlashCommands {
  slashCommands?: readonly unknown[];
  skills?: readonly unknown[];
  model?: string;
  claudeVersion?: string;
}

const HIDDEN_REMOTE_COMMANDS: ReadonlySet<string> = new Set([
  "/login",
  "/logout",
  "/keybindings-help",
  "/update-config",
  "/skills",
]);

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<SlashCommand> = Object.freeze([
  // DeskRelay-local commands. Claude Code's --print IPC currently reports
  // these as unavailable, so the app handles them before spawning claude.
  { name: "/status", hint: "Show DeskRelay connection and session status" },
  { name: "/model", hint: "Show or set the model for new Claude turns" },
  // CLI commands
  { name: "/help", hint: "Show built-in command list" },
  { name: "/clear", hint: "Clear the conversation transcript" },
  { name: "/compact", hint: "Summarize older turns to free context" },
  { name: "/cost", hint: "Token usage stats" },
  { name: "/resume", hint: "Resume a recent session" },
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

const BUILTIN_BY_NAME: ReadonlyMap<string, SlashCommand> = new Map(
  BUILTIN_SLASH_COMMANDS.map((command) => [command.name.toLowerCase(), command]),
);

export function normalizeSlashCommandName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const raw = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) return null;
  return raw;
}

export function mergeRuntimeSlashCommands(
  runtime: RuntimeSlashCommands | null | undefined,
): SlashCommand[] {
  const merged = new Map<string, SlashCommand>();
  for (const command of BUILTIN_SLASH_COMMANDS) {
    merged.set(command.name.toLowerCase(), command);
  }

  const runtimeSkills = new Set<string>();
  for (const value of runtime?.skills ?? []) {
    const name = normalizeSlashCommandName(value);
    if (name) runtimeSkills.add(name.toLowerCase());
  }

  for (const value of [...(runtime?.slashCommands ?? []), ...(runtime?.skills ?? [])]) {
    const name = normalizeSlashCommandName(value);
    if (!name) continue;
    const key = name.toLowerCase();
    if (HIDDEN_REMOTE_COMMANDS.has(key)) continue;
    if (merged.has(key)) continue;
    const known = BUILTIN_BY_NAME.get(key);
    merged.set(key, {
      name,
      hint: known?.hint ?? (runtimeSkills.has(key) ? "Claude Code skill" : "Claude CLI command"),
      ...(known?.paid ? { paid: known.paid } : {}),
    });
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

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
