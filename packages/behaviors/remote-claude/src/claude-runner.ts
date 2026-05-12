// claude-runner — spawns the `claude` CLI in stream-json mode for a
// single message, forwards each emitted event to a callback, resolves
// when the subprocess exits.
//
// Command shape:
//   claude --print --output-format stream-json
//          --verbose                                 (required for stream-json)
//          --include-partial-messages
//          [--input-format stream-json]              (when images are attached)
//          [--add-dir <temp attachments dir>]        (when images are attached)
//          [--append-system-prompt <file paths>]     (when images are attached)
//          [--resume <sessionId>]
//          --cwd <cwd>
//          [-- <message>]                            (positional prompt)
//
// Text-only prompts are sent as the positional `--print` arg. Image
// attachments require Claude Code's structured stdin path, so those runs
// use `--input-format stream-json` and write one user message to stdin.
// We also materialize each browser image attachment as a temporary local
// file and allow that folder via `--add-dir`; otherwise Claude can see
// the image but its tools cannot copy or inspect the original file bytes.
// We still spawn one process per browser send; this is not the long-lived
// bidirectional M3.5 subprocess mode.
//
// We expose a tiny `runClaude` factory for tests: it takes an optional
// `command` array so tests can substitute a fake `claude` script that
// emits canned output.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { type Subprocess, spawn } from "bun";
import { type ClaudeStreamEvent, StreamJsonParser } from "./stream-json.ts";

export interface ClaudeRunOptions {
  /** Working directory the claude CLI runs in (cwd of the subprocess). */
  cwd: string;
  /** The user's message (passed as the `--print` positional arg). */
  message: string;
  /** Pending browser image attachments. When present, the prompt is sent
   *  through Claude Code's stream-json input so image content blocks reach
   *  the model instead of being visible only in the browser transcript. */
  attachments?: ClaudeRunAttachment[];
  /** Resume an existing claude session. */
  resumeSessionId?: string;
  /** claude `--permission-mode` value. When unset, claude's own default
   *  applies. Validated by the caller (remote-claude index.ts) — we just
   *  forward as a literal flag. */
  permissionMode?: string;
  /** claude `--model` value. Validated by the caller; forwarded as one
   *  argv element so it cannot inject extra flags. */
  model?: string;
  /** Override the executable. Default "claude" (PATH lookup). */
  command?: readonly string[];
  /** Extra flags appended after our defaults. */
  extraArgs?: readonly string[];
  /** Extra system prompt text appended to this Claude run. */
  appendSystemPrompt?: string | readonly string[];
  /** Process env overrides (merged onto process.env). */
  env?: Record<string, string>;
  /** Called once per emitted JSONL event. */
  onEvent: (event: ClaudeStreamEvent) => void;
  /** Called for each malformed stdout line (rare; claude warnings). */
  onMalformedStdout?: (line: string, error: Error) => void;
  /** Called for each line on stderr (claude logs warnings here). */
  onStderrLine?: (line: string) => void;
  /** AbortSignal — when triggered, the subprocess is killed. */
  signal?: AbortSignal;
}

export interface ClaudeRunAttachment {
  name?: string;
  mimeType: string;
  size?: number;
  dataBase64: string;
}

export interface ClaudeRunResult {
  /** Process exit code, or null if killed by signal. */
  exitCode: number | null;
  /** Number of JSONL events successfully parsed. */
  eventCount: number;
}

export interface ClaudeSlashCommandProbeOptions {
  cwd: string;
  command?: readonly string[];
  env?: Record<string, string>;
  onMalformedStdout?: (line: string, error: Error) => void;
  onStderrLine?: (line: string) => void;
}

export interface ClaudeSlashCommandProbeResult {
  slashCommands: string[];
  skills: string[];
  claudeVersion?: string;
  model?: string;
}

export class ClaudeRunError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "ClaudeRunError";
  }
}

const DEFAULT_COMMAND = ["claude"] as const;

/** Generate a temp settings.json that wires the PreToolUse approval
 *  hook (Phase G). claude CLI loads this via --settings <path>; the
 *  hook script POSTs the tool-use payload to the daemon and waits for
 *  the operator's decision via the browser modal.
 *
 *  Opt-in: only fires when CR_CONNECTOR_APPROVALS=1 AND CR_DAEMON_URL
 *  is in env. Without both, runClaude behaves exactly like before
 *  (unchanged for self-host workflows). */
async function maybeWriteApprovalSettings(env: Record<string, string>): Promise<{
  settingsPath: string;
  bunPath: string;
} | null> {
  if (env.CR_CONNECTOR_APPROVALS !== "1") return null;
  if (!env.CR_DAEMON_URL) return null;
  const bunPath = env.CR_CONNECTOR_BUN_PATH ?? process.execPath;
  // Hook script lives next to this file; resolve via import.meta.url so
  // it works in bun bundles + tests.
  const here = fileURLToPath(import.meta.url);
  const hookPath = resolvePath(here, "..", "hooks", "pretooluse.ts");
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [
            {
              type: "command",
              command: `${quoteForShell(bunPath)} ${quoteForShell(hookPath)}`,
            },
          ],
        },
      ],
    },
  };
  const dir = await mkdtemp(join(tmpdir(), "cr-claude-settings-"));
  const settingsPath = join(dir, "settings.json");
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  return { settingsPath, bunPath };
}

function quoteForShell(value: string): string {
  // Windows-friendly: wrap in double quotes only when there's whitespace.
  return /\s/.test(value) ? `"${value}"` : value;
}

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const cmd = [...(options.command ?? DEFAULT_COMMAND)];
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(options.env ?? {}),
  };
  const approvals = await maybeWriteApprovalSettings(env);
  const attachments = normalizeImageAttachments(options.attachments);
  const materialized =
    attachments.length > 0 ? await materializeImageAttachments(attachments) : undefined;

  const args: string[] = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  if (approvals) {
    args.push("--settings", approvals.settingsPath);
  }
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  }
  if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  for (const prompt of normalizeAppendSystemPrompt(options.appendSystemPrompt)) {
    args.push("--append-system-prompt", prompt);
  }
  if (options.extraArgs) args.push(...options.extraArgs);
  if (materialized) {
    args.push("--add-dir", materialized.dir);
    args.push("--append-system-prompt", buildAttachmentSystemPrompt(materialized.files));
  }
  const inputBlocks = buildUserMessageContent(options.message, attachments);
  const useStructuredInput = inputBlocks.some((block) => block.type === "image");
  if (useStructuredInput) {
    args.push("--input-format", "stream-json");
  } else {
    args.push(options.message);
  }

  let proc: Subprocess | undefined;
  try {
    proc = spawn({
      cmd: [...cmd, ...args],
      cwd: options.cwd,
      stdin: useStructuredInput ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    if (useStructuredInput) {
      writeStructuredUserMessage(proc, inputBlocks);
    }

    // Wire up abort.
    let aborted = false;
    if (options.signal) {
      if (options.signal.aborted) {
        aborted = true;
        proc.kill();
      } else {
        options.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            proc?.kill();
          },
          { once: true },
        );
      }
    }

    const parser = new StreamJsonParser();
    let eventCount = 0;
    const stderrChunks: string[] = [];

    const stdoutLoop = (async () => {
      const stdout = proc.stdout as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of stdout) {
        const events = parser.push(chunk, options.onMalformedStdout);
        for (const ev of events) {
          eventCount += 1;
          try {
            options.onEvent(ev);
          } catch {
            // Caller's onEvent must not break the read loop.
          }
        }
      }
      parser.flush(options.onMalformedStdout);
    })();

    const stderrLoop = (async () => {
      const stderr = proc.stderr as unknown as AsyncIterable<Uint8Array>;
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of stderr) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trimEnd();
          buffer = buffer.slice(nl + 1);
          if (line.length > 0) {
            stderrChunks.push(line);
            options.onStderrLine?.(line);
          }
          nl = buffer.indexOf("\n");
        }
      }
      if (buffer.length > 0) {
        stderrChunks.push(buffer);
        options.onStderrLine?.(buffer);
      }
    })();

    const exitCode = await proc.exited;
    await Promise.allSettled([stdoutLoop, stderrLoop]);

    if (aborted) return { exitCode: null, eventCount };
    if (exitCode !== 0) {
      throw new ClaudeRunError(
        `claude exited with code ${exitCode}`,
        exitCode ?? null,
        stderrChunks.join("\n"),
      );
    }
    return { exitCode: exitCode ?? 0, eventCount };
  } finally {
    if (materialized) {
      await rm(materialized.dir, { recursive: true, force: true });
    }
  }
}

function normalizeAppendSystemPrompt(input: ClaudeRunOptions["appendSystemPrompt"]): string[] {
  if (typeof input === "string") return input.trim() ? [input] : [];
  if (!Array.isArray(input)) return [];
  return input.map((item) => item.trim()).filter(Boolean);
}

export async function probeClaudeSlashCommands(
  options: ClaudeSlashCommandProbeOptions,
): Promise<ClaudeSlashCommandProbeResult> {
  const captured: { initEvent?: Record<string, unknown> } = {};
  const runOptions: ClaudeRunOptions = {
    cwd: options.cwd,
    message: "/skills",
    ...(options.command ? { command: options.command } : {}),
    ...(options.env ? { env: options.env } : {}),
    extraArgs: ["--no-session-persistence", "--max-budget-usd", "0.01"],
    onEvent: (event) => {
      if (
        event &&
        typeof event === "object" &&
        event.type === "system" &&
        (event as { subtype?: unknown }).subtype === "init"
      ) {
        captured.initEvent = event as Record<string, unknown>;
      }
    },
  };
  if (options.onMalformedStdout) runOptions.onMalformedStdout = options.onMalformedStdout;
  if (options.onStderrLine) runOptions.onStderrLine = options.onStderrLine;
  await runClaude(runOptions);

  const initEvent = captured.initEvent;
  return {
    slashCommands: stringArray(initEvent?.slash_commands),
    skills: stringArray(initEvent?.skills),
    ...(typeof initEvent?.claude_code_version === "string"
      ? { claudeVersion: initEvent.claude_code_version }
      : {}),
    ...(typeof initEvent?.model === "string" ? { model: initEvent.model } : {}),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

// Re-export so consumers don't have to reach into stream-json.ts.
export type { ClaudeStreamEvent } from "./stream-json.ts";
export type { Subprocess };

type ClaudeInputContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

function buildUserMessageContent(
  message: string,
  attachments: ClaudeRunAttachment[],
): ClaudeInputContentBlock[] {
  const blocks: ClaudeInputContentBlock[] = [];
  if (message.trim()) blocks.push({ type: "text", text: message });
  for (const attachment of attachments) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: attachment.dataBase64,
      },
    });
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: message });
  return blocks;
}

interface MaterializedAttachment {
  path: string;
  mimeType: string;
  size: number;
}

function normalizeImageAttachments(
  values: ClaudeRunAttachment[] | undefined,
): ClaudeRunAttachment[] {
  return (values ?? []).filter(isValidImageAttachment);
}

function isValidImageAttachment(
  value: ClaudeRunAttachment | undefined,
): value is ClaudeRunAttachment {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    typeof value.mimeType === "string" &&
    /^image\/[A-Za-z0-9.+-]+$/.test(value.mimeType) &&
    typeof value.dataBase64 === "string" &&
    value.dataBase64.length > 0
  );
}

async function materializeImageAttachments(
  attachments: ClaudeRunAttachment[],
): Promise<{ dir: string; files: MaterializedAttachment[] }> {
  const dir = await mkdtemp(join(tmpdir(), "cr-claude-attachments-"));
  const files: MaterializedAttachment[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const bytes = Buffer.from(attachment.dataBase64, "base64");
    if (bytes.length === 0) continue;
    const fileName = safeAttachmentFileName(attachment, index);
    const path = join(dir, fileName);
    await writeFile(path, bytes);
    files.push({ path, mimeType: attachment.mimeType, size: bytes.length });
  }
  return { dir, files };
}

function safeAttachmentFileName(attachment: ClaudeRunAttachment, index: number): string {
  const inferred = extensionForMime(attachment.mimeType);
  const rawName = typeof attachment.name === "string" ? basename(attachment.name) : "";
  const sanitized = rawName
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/[\t\n\r]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 80);
  const base = sanitized || `attachment-${index + 1}${inferred}`;
  return extname(base) ? `${index + 1}-${base}` : `${index + 1}-${base}${inferred}`;
}

function extensionForMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg") return ".jpg";
  if (lower === "image/png") return ".png";
  if (lower === "image/gif") return ".gif";
  if (lower === "image/webp") return ".webp";
  if (lower === "image/svg+xml") return ".svg";
  return ".img";
}

function buildAttachmentSystemPrompt(files: MaterializedAttachment[]): string {
  const lines = files.map(
    (file, index) => `${index + 1}. ${file.path} (${file.mimeType}, ${file.size} bytes)`,
  );
  return [
    "The user's browser image attachments are available both as image input blocks and as temporary local files for this turn.",
    "If the user asks you to save, copy, inspect, transform, or otherwise operate on an attachment, use these local file paths before the command exits:",
    ...lines,
  ].join("\n");
}

function writeStructuredUserMessage(proc: Subprocess, content: ClaudeInputContentBlock[]): void {
  const stdin = proc.stdin as { write: (chunk: string) => void; end: () => void } | undefined;
  if (!stdin) throw new Error("claude stdin pipe was not created");
  stdin.write(
    `${JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content,
      },
    })}\n`,
  );
  stdin.end();
}
