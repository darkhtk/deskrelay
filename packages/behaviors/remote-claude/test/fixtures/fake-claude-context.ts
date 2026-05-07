#!/usr/bin/env bun
// Fake claude for context.usage probing. It emits the same essential
// stream-json shape that Claude Code returns for the `/context` slash
// command, including both assistant text and a result string.

const text = [
  "## Context Usage",
  "",
  "**Model:** claude-test",
  "**Tokens:** 25.9k / 1m (3%)",
  "",
  "| Category | Tokens | Percentage |",
  "|----------|--------|------------|",
  "| Messages | 13 | 0.0% |",
  "| Free space | 941.1k | 94.1% |",
].join("\n");

const lines = [
  { type: "system", subtype: "init", session_id: "fake-context-session", cwd: process.cwd() },
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  },
  { type: "result", subtype: "success", is_error: false, result: text, num_turns: 0 },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

export {};
