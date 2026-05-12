#!/usr/bin/env bun
export {};

const argv = process.argv.slice(2);
const permissionIndex = argv.indexOf("--permission-mode");
const promptIndex = argv.indexOf("--append-system-prompt");
const promptArg = promptIndex >= 0 ? argv[promptIndex + 1] : undefined;
const observed = {
  permissionMode: permissionIndex >= 0 ? argv[permissionIndex + 1] : null,
  hasManagerPrompt:
    typeof promptArg === "string" ? promptArg.includes("DeskRelay manager mode is active") : false,
  apiBase: process.env.DESKRELAY_MANAGER_API_BASE ?? null,
  token: process.env.DESKRELAY_SITE_TOKEN ?? null,
  repoRoot: process.env.DESKRELAY_REPOSITORY_ROOT ?? null,
};

const lines = [
  { type: "system", subtype: "init", session_id: "manager-session-001", cwd: process.cwd() },
  {
    type: "assistant",
    message: { content: [{ type: "text", text: JSON.stringify(observed) }] },
  },
  { type: "result", success: true, duration_ms: 1, num_turns: 1 },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
