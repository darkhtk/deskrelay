#!/usr/bin/env bun
export {};

const argv = process.argv.slice(2);
const resumeIndex = argv.indexOf("--resume");
const resumedSession =
  resumeIndex >= 0 && typeof argv[resumeIndex + 1] === "string" ? argv[resumeIndex + 1] : null;
const message = argv[argv.length - 1] ?? "";

if (message.includes("slow")) {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

const sessionId = resumedSession ?? "queue-session-001";
const lines = [
  { type: "system", subtype: "init", session_id: sessionId, cwd: process.cwd() },
  {
    type: "assistant",
    message: {
      content: [{ type: "text", text: `resume:${resumedSession ?? "none"} message:${message}` }],
    },
  },
  { type: "result", success: true, duration_ms: 1, num_turns: 1 },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
