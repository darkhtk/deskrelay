import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type WorkspaceRoots, isInsideRoot } from "./workspaces.ts";

export type ClaudeInstructionScope = "user" | "project" | "projectClaude" | "local" | "managed";

export interface ClaudeInstructionSource {
  scope: ClaudeInstructionScope;
  label: string;
  path: string;
  readonly: boolean;
  exists: boolean;
  content: string;
  hash?: string;
  mtimeMs?: number;
  error?: string;
}

export interface ClaudeInstructionsSnapshot {
  cwd: string | null;
  sources: ClaudeInstructionSource[];
}

export interface WriteClaudeInstructionInput {
  scope: ClaudeInstructionScope;
  cwd?: string;
  content: string;
  expectedHash?: string;
}

export interface DeleteClaudeInstructionInput {
  scope: ClaudeInstructionScope;
  cwd?: string;
  expectedHash?: string;
}

export class InstructionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "InstructionError";
  }
}

const MAX_INSTRUCTION_BYTES = 256 * 1024;

const SOURCE_META: Record<ClaudeInstructionScope, { label: string; readonly: boolean }> = {
  user: { label: "사용자 지침", readonly: false },
  project: { label: "프로젝트 지침", readonly: false },
  projectClaude: { label: ".claude 지침", readonly: false },
  local: { label: "로컬 지침", readonly: false },
  managed: { label: "관리 정책", readonly: true },
};

export async function readClaudeInstructions(
  cwd: string | undefined,
  roots: WorkspaceRoots,
): Promise<ClaudeInstructionsSnapshot> {
  const resolvedCwd = resolveCwd(cwd, roots, false);
  const sources = await Promise.all(
    (Object.keys(SOURCE_META) as ClaudeInstructionScope[]).map((scope) =>
      readInstructionSource(scope, resolvedCwd, roots),
    ),
  );
  return {
    cwd: resolvedCwd?.ok ? resolvedCwd.path : null,
    sources,
  };
}

export async function writeClaudeInstruction(
  input: WriteClaudeInstructionInput,
  roots: WorkspaceRoots,
): Promise<ClaudeInstructionSource> {
  const target = resolveSourcePath(input.scope, input.cwd, roots, true);
  if (target.readonly) throw new InstructionError("managed instructions are read-only", 403);
  await assertUnchanged(target.path, input.expectedHash);
  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, input.content, "utf8");
  return await readInstructionSource(input.scope, { ok: true, path: target.cwd ?? "" }, roots);
}

export async function deleteClaudeInstruction(
  input: DeleteClaudeInstructionInput,
  roots: WorkspaceRoots,
): Promise<ClaudeInstructionSource> {
  const target = resolveSourcePath(input.scope, input.cwd, roots, true);
  if (target.readonly) throw new InstructionError("managed instructions are read-only", 403);
  await assertUnchanged(target.path, input.expectedHash);
  try {
    await unlink(target.path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return await readInstructionSource(input.scope, { ok: true, path: target.cwd ?? "" }, roots);
}

async function readInstructionSource(
  scope: ClaudeInstructionScope,
  cwd: ResolvedCwd | undefined,
  roots: WorkspaceRoots,
): Promise<ClaudeInstructionSource> {
  const meta = SOURCE_META[scope];
  if (cwd && !cwd.ok && scope !== "user" && scope !== "managed") {
    return emptySource(scope, meta, "", cwd.error);
  }
  if (!cwd && scope !== "user" && scope !== "managed") {
    return emptySource(scope, meta, "", "cwd is not selected");
  }
  let target: ResolvedSource;
  try {
    target = resolveSourcePath(scope, cwd?.ok ? cwd.path : undefined, roots, false);
  } catch (err) {
    return emptySource(scope, meta, "", (err as Error).message);
  }

  try {
    const s = await stat(target.path);
    if (!s.isFile()) {
      return emptySource(scope, meta, target.path, "not a file");
    }
    if (s.size > MAX_INSTRUCTION_BYTES) {
      return emptySource(scope, meta, target.path, "file is too large to edit safely");
    }
    const content = await readFile(target.path, "utf8");
    return {
      scope,
      label: meta.label,
      path: target.path,
      readonly: target.readonly,
      exists: true,
      content,
      hash: hashContent(content),
      mtimeMs: s.mtimeMs,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptySource(scope, meta, target.path);
    }
    return emptySource(scope, meta, target.path, (err as Error).message);
  }
}

function emptySource(
  scope: ClaudeInstructionScope,
  meta: { label: string; readonly: boolean },
  path: string,
  error?: string,
): ClaudeInstructionSource {
  return {
    scope,
    label: meta.label,
    path,
    readonly: meta.readonly,
    exists: false,
    content: "",
    ...(error ? { error } : {}),
  };
}

interface ResolvedCwdOk {
  ok: true;
  path: string;
}

interface ResolvedCwdError {
  ok: false;
  error: string;
}

type ResolvedCwd = ResolvedCwdOk | ResolvedCwdError;

interface ResolvedSource {
  path: string;
  readonly: boolean;
  cwd?: string;
}

function resolveCwd(
  cwd: string | undefined,
  roots: WorkspaceRoots,
  required: boolean,
): ResolvedCwd | undefined {
  const trimmed = String(cwd ?? "").trim();
  if (!trimmed) {
    if (required) throw new InstructionError("cwd is required for this instruction source", 400);
    return undefined;
  }
  const resolved = resolve(trimmed);
  if (!isInsideRoot(resolved, roots)) {
    const message = `forbidden: ${resolved} is outside the configured workspace roots`;
    if (required) throw new InstructionError(message, 403);
    return { ok: false, error: message };
  }
  return { ok: true, path: resolved };
}

function resolveSourcePath(
  scope: ClaudeInstructionScope,
  cwd: string | undefined,
  roots: WorkspaceRoots,
  requireCwd: boolean,
): ResolvedSource {
  const meta = SOURCE_META[scope];
  if (!meta) throw new InstructionError(`unknown instruction source: ${scope}`, 400);
  if (scope === "user") {
    return { path: join(homedir(), ".claude", "CLAUDE.md"), readonly: false };
  }
  if (scope === "managed") {
    return { path: managedClaudePath(), readonly: true };
  }

  const resolvedCwd = resolveCwd(cwd, roots, requireCwd);
  if (!resolvedCwd) {
    throw new InstructionError("cwd is required for this instruction source", 400);
  }
  if (!resolvedCwd.ok) {
    throw new InstructionError(resolvedCwd.error, 403);
  }

  if (scope === "project") {
    return { path: join(resolvedCwd.path, "CLAUDE.md"), readonly: false, cwd: resolvedCwd.path };
  }
  if (scope === "projectClaude") {
    return {
      path: join(resolvedCwd.path, ".claude", "CLAUDE.md"),
      readonly: false,
      cwd: resolvedCwd.path,
    };
  }
  if (scope === "local") {
    return {
      path: join(resolvedCwd.path, "CLAUDE.local.md"),
      readonly: false,
      cwd: resolvedCwd.path,
    };
  }
  throw new InstructionError(`unknown instruction source: ${scope}`, 400);
}

async function assertUnchanged(path: string, expectedHash: string | undefined): Promise<void> {
  if (!expectedHash) return;
  try {
    const content = await readFile(path, "utf8");
    if (hashContent(content) !== expectedHash) {
      throw new InstructionError("instruction file changed on disk; reload before saving", 409);
    }
  } catch (err) {
    if (err instanceof InstructionError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (expectedHash !== "missing") {
        throw new InstructionError(
          "instruction file was deleted on disk; reload before saving",
          409,
        );
      }
      return;
    }
    throw err;
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function managedClaudePath(): string {
  if (process.platform === "win32") return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  if (process.platform === "darwin") return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  return "/etc/claude-code/CLAUDE.md";
}
