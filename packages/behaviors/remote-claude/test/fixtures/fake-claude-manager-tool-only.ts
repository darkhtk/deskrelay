#!/usr/bin/env bun
export {};

const lines = [
  { type: "system", subtype: "init", session_id: "manager-tool-only-001", cwd: process.cwd() },
  {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "tool_1", name: "Bash", input: { command: "status" } }],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_1",
          content: "HTTP 404 from C:/Program Files/Git/api/manager/system/summary",
        },
      ],
    },
  },
  { type: "result", success: true, duration_ms: 1, num_turns: 1 },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
