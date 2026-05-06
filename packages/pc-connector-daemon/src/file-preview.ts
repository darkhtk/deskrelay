// file-preview.ts - guarded read-only image preview surface for the browser.
//
// The browser never gets file:// access. It asks the daemon for a small
// preview blob, and the daemon enforces workspace roots, symlink escape
// checks, size limits, and magic-byte MIME detection before reading.

import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { type WorkspaceRoots, isInsideRoot } from "./workspaces.ts";

export const FILE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export type FilePreviewErrorCode =
  | "EINVAL"
  | "EFORBIDDEN"
  | "ENOENT"
  | "ENOTFILE"
  | "EPERM"
  | "ETOOLARGE"
  | "EUNSUPPORTED";

export class FilePreviewError extends Error {
  constructor(
    message: string,
    readonly code: FilePreviewErrorCode,
  ) {
    super(message);
    this.name = "FilePreviewError";
  }
}

export interface FilePreviewInput {
  path: string;
  cwd?: string;
}

export interface FilePreviewResult {
  path: string;
  filename: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  size: number;
  bytes: Uint8Array;
}

const UNRESTRICTED: WorkspaceRoots = { mode: "unrestricted", roots: [] };
const CONTROL_CHARS = /[\0-\x1f]/;
const RESERVED_WINDOWS_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export async function previewFile(
  input: FilePreviewInput,
  roots: WorkspaceRoots = UNRESTRICTED,
): Promise<FilePreviewResult> {
  const rawPath = String(input.path || "").trim();
  const rawCwd = String(input.cwd || "").trim();
  if (!rawPath) throw new FilePreviewError("path is required", "EINVAL");
  validateRawPath(rawPath);
  if (!isAbsolute(rawPath) && !rawCwd) {
    throw new FilePreviewError("cwd is required for relative preview paths", "EINVAL");
  }
  if (rawCwd) validateRawPath(rawCwd);

  const cwd = rawCwd ? resolve(rawCwd) : "";
  if (cwd && !isInsideRoot(cwd, roots)) {
    throw forbidden(cwd);
  }
  const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideRoot(candidate, roots)) {
    throw forbidden(candidate);
  }

  let resolvedReal: string;
  try {
    resolvedReal = await realpath(candidate);
  } catch (err) {
    throw new FilePreviewError(
      `cannot access file: ${candidate} (${(err as Error).message})`,
      "ENOENT",
    );
  }
  if (!isInsideRoot(resolvedReal, roots)) {
    throw forbidden(resolvedReal);
  }

  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(resolvedReal);
  } catch (err) {
    throw new FilePreviewError(
      `cannot access file: ${resolvedReal} (${(err as Error).message})`,
      "ENOENT",
    );
  }
  if (!s.isFile()) {
    throw new FilePreviewError(`not a file: ${resolvedReal}`, "ENOTFILE");
  }
  if (s.size > FILE_PREVIEW_MAX_BYTES) {
    throw new FilePreviewError(
      `file too large for preview (${s.size} > ${FILE_PREVIEW_MAX_BYTES} bytes)`,
      "ETOOLARGE",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(resolvedReal));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      throw new FilePreviewError(`permission denied: ${resolvedReal}`, "EPERM");
    }
    throw err;
  }
  const contentType = sniffImageContentType(bytes);
  if (!contentType) {
    throw new FilePreviewError("unsupported preview file type", "EUNSUPPORTED");
  }
  return {
    path: resolvedReal,
    filename: basename(resolvedReal) || "image",
    contentType,
    size: bytes.byteLength,
    bytes,
  };
}

export function filePreviewErrorStatus(err: unknown): number {
  if (!(err instanceof FilePreviewError)) return 500;
  switch (err.code) {
    case "EINVAL":
    case "ENOTFILE":
      return 400;
    case "EFORBIDDEN":
    case "EPERM":
      return 403;
    case "ENOENT":
      return 404;
    case "ETOOLARGE":
      return 413;
    case "EUNSUPPORTED":
      return 415;
  }
}

export function safePreviewFilename(filename: string): string {
  return String(filename || "image")
    .replace(/[\r\n"]/g, "_")
    .replace(/[\\/]/g, "_")
    .slice(0, 180);
}

function validateRawPath(raw: string): void {
  if (CONTROL_CHARS.test(raw)) {
    throw new FilePreviewError("path contains control characters", "EINVAL");
  }
  if (process.platform === "win32") {
    if (/^[\\/]{2}/.test(raw)) {
      throw new FilePreviewError("network/UNC paths are not previewed", "EINVAL");
    }
    const name = basename(raw);
    if (RESERVED_WINDOWS_BASENAME.test(name)) {
      throw new FilePreviewError("path uses a reserved Windows device name", "EINVAL");
    }
  }
}

function forbidden(absPath: string): FilePreviewError {
  return new FilePreviewError(
    `forbidden: ${absPath} is outside the configured workspace roots`,
    "EFORBIDDEN",
  );
}

function sniffImageContentType(bytes: Uint8Array): FilePreviewResult["contentType"] | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const header = ascii(bytes, 0, 6);
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}
