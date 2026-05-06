#!/usr/bin/env bun
// Fake claude for slash command probing. It mimics the --print stream-json
// shape enough for probeClaudeSlashCommands to harvest the init surface.
export {};

const lines = [
  {
    type: "system",
    subtype: "init",
    session_id: "fake-slash-session",
    cwd: process.cwd(),
    slash_commands: ["clear", "model", "status", "deep-fix", "usage"],
    skills: ["deep-fix", "protocol-rubric"],
    claude_code_version: "9.9.9-test",
    model: "claude-test-model",
  },
  {
    type: "assistant",
    message: { content: [{ type: "text", text: "/skills isn't available in this environment." }] },
  },
  { type: "result", subtype: "success", is_error: false, duration_ms: 1, num_turns: 0 },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
