#!/usr/bin/env bun
// Fake claude — emits canned stream-json output. Used by claude-runner tests.
//
// Reads its argv to extract the user message (last positional after our
// known flags) just to verify the runner passes args correctly. Echoes
// the message back as an "assistant" event and exits 0.

const argv = process.argv.slice(2);
const message = argv[argv.length - 1] ?? "";

const lines = [
  { type: "system", subtype: "init", session_id: "fake-session-001", cwd: process.cwd() },
  { type: "assistant", message: { content: [{ type: "text", text: `echo: ${message}` }] } },
  { type: "result", success: true, duration_ms: 1, num_turns: 1 },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
