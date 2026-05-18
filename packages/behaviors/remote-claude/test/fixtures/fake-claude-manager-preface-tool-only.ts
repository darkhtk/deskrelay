#!/usr/bin/env bun
export {};

const lines = [
  { type: "system", subtype: "init", session_id: "manager-preface-tool-only-001", cwd: process.cwd() },
  {
    type: "assistant",
    message: {
      content: [{ type: "text", text: "알겠습니다. 작업자를 호출하겠습니다." }],
    },
  },
  {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "tool_1", name: "Agent", input: { description: "work" } }],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_1",
          content: "result: worker finished and all checks passed",
        },
      ],
    },
  },
  { type: "result", success: true, duration_ms: 1, num_turns: 1 },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
