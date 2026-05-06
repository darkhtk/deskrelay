#!/usr/bin/env bun
// Fake claude that reads one stream-json user message from stdin and
// echoes a compact summary. Used to verify image attachments travel all
// the way into the CLI subprocess input, not only the browser transcript.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const stdin = (await new Response(Bun.stdin.stream()).text()).trim();
const line = stdin.split(/\r?\n/)[0] ?? "";
const input = JSON.parse(line) as {
  message?: { content?: Array<{ type?: string; text?: string; source?: { media_type?: string } }> };
};
const content = Array.isArray(input.message?.content) ? input.message.content : [];
const summary = content
  .map((block) => {
    if (block.type === "text") return `text:${block.text ?? ""}`;
    if (block.type === "image") return `image:${block.source?.media_type ?? ""}`;
    return `block:${block.type ?? ""}`;
  })
  .join("|");

let argsSummary = "";
if (process.env.CR_FAKE_CLAUDE_ECHO_ARGS === "1") {
  const addDirIndex = process.argv.indexOf("--add-dir");
  const appendPromptIndex = process.argv.indexOf("--append-system-prompt");
  const addDir = addDirIndex === -1 ? "" : (process.argv[addDirIndex + 1] ?? "");
  const appendPrompt = appendPromptIndex === -1 ? "" : (process.argv[appendPromptIndex + 1] ?? "");
  const files = addDir
    ? readdirSync(addDir).filter((name) => statSync(join(addDir, name)).isFile())
    : [];
  const firstFile = files[0] ? join(addDir, files[0]) : "";
  const firstFileBytes = firstFile ? readFileSync(firstFile).byteLength : 0;
  argsSummary = [
    `addDir:${addDir ? "yes" : "no"}`,
    `fileCount:${files.length}`,
    `firstFileBytes:${firstFileBytes}`,
    `promptHasDog:${appendPrompt.includes("dog.png") ? "yes" : "no"}`,
  ].join("|");
}

const lines = [
  { type: "system", subtype: "init", session_id: "fake-session-stdin", cwd: process.cwd() },
  {
    type: "assistant",
    message: {
      content: [{ type: "text", text: argsSummary ? `${summary}|${argsSummary}` : summary }],
    },
  },
  { type: "result", success: true, duration_ms: 1, num_turns: 1 },
];

for (const event of lines) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export {};
