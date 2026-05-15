import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE_PREVIEW_MAX_BYTES, FilePreviewError, previewFile } from "../src/file-preview.ts";
import { Daemon } from "../src/daemon.ts";
import type { WorkspaceRoots } from "../src/workspaces.ts";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const TEST_AUTH_TOKEN = "preview-test-token";

let root: string;
let outside: string;
let roots: WorkspaceRoots;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cr-preview-root-"));
  outside = await mkdtemp(join(tmpdir(), "cr-preview-outside-"));
  roots = { mode: "restricted", roots: [root] };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("previewFile", () => {
  test("returns a png blob for a file inside the workspace root", async () => {
    const file = join(root, "shot.png");
    await writeFile(file, PNG_BYTES);

    const result = await previewFile({ path: file }, roots);

    expect(result.contentType).toBe("image/png");
    expect(result.size).toBe(PNG_BYTES.byteLength);
    expect(result.filename).toBe("shot.png");
  });

  test("resolves relative paths against cwd", async () => {
    const nested = join(root, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "shot.png"), PNG_BYTES);

    const result = await previewFile({ path: "shot.png", cwd: nested }, roots);

    expect(result.path).toBe(join(nested, "shot.png"));
  });

  test("rejects relative paths without cwd", async () => {
    await expectPreviewCode({ path: "shot.png" }, "EINVAL");
  });

  test("rejects paths outside restricted workspace roots", async () => {
    const file = join(outside, "shot.png");
    await writeFile(file, PNG_BYTES);

    await expectPreviewCode({ path: file }, "EFORBIDDEN");
  });

  test("rejects symlinks that escape restricted workspace roots", async () => {
    const target = join(outside, "shot.png");
    const link = join(root, "linked.png");
    await writeFile(target, PNG_BYTES);
    try {
      await symlink(target, link);
    } catch {
      return;
    }

    await expectPreviewCode({ path: link }, "EFORBIDDEN");
  });

  test("rejects unsupported content even when the extension looks like an image", async () => {
    const file = join(root, "not-really.png");
    await writeFile(file, "<svg><script>alert(1)</script></svg>");

    await expectPreviewCode({ path: file }, "EUNSUPPORTED");
  });

  test("returns guarded text previews for markdown files", async () => {
    const file = join(root, "README.md");
    await writeFile(file, "# DeskRelay\n\nhello\n", "utf8");

    const result = await previewFile({ path: file }, roots);

    expect(result.contentType).toBe("text/plain; charset=utf-8");
    expect(new TextDecoder().decode(result.bytes)).toContain("# DeskRelay");
  });

  test("rejects text extensions when content is not utf-8 text", async () => {
    const file = join(root, "notes.md");
    await writeFile(file, new Uint8Array([0xff, 0xfe, 0x00, 0x00]));

    await expectPreviewCode({ path: file }, "EUNSUPPORTED");
  });

  test("rejects oversized files before reading them as previews", async () => {
    const file = join(root, "huge.png");
    const huge = new Uint8Array(FILE_PREVIEW_MAX_BYTES + 1);
    huge.set(PNG_BYTES, 0);
    await writeFile(file, huge);

    await expectPreviewCode({ path: file }, "ETOOLARGE");
  });

  test("daemon route returns binary preview bytes behind Bearer auth", async () => {
    const file = join(root, "shot.png");
    await writeFile(file, PNG_BYTES);
    const daemon = new Daemon({ port: 0, authToken: TEST_AUTH_TOKEN, workspaceRoots: roots });
    const listening = daemon.start();
    const url = `http://${listening.host}:${listening.port}/files/preview?path=${encodeURIComponent(
      file,
    )}`;
    try {
      const missingAuth = await fetch(url);
      expect(missingAuth.status).toBe(401);

      const res = await fetch(url, {
        headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    } finally {
      await daemon.stop();
    }
  });

  test("daemon route returns text preview bytes behind Bearer auth", async () => {
    const file = join(root, "notes.md");
    await writeFile(file, "hello from markdown\n", "utf8");
    const daemon = new Daemon({ port: 0, authToken: TEST_AUTH_TOKEN, workspaceRoots: roots });
    const listening = daemon.start();
    const url = `http://${listening.host}:${listening.port}/files/preview?path=${encodeURIComponent(
      file,
    )}`;
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("hello from markdown\n");
    } finally {
      await daemon.stop();
    }
  });

  test("daemon route can preview manager-scoped files outside restricted roots", async () => {
    const file = join(outside, "manager-notes.md");
    await writeFile(file, "manager scope\n", "utf8");
    const daemon = new Daemon({ port: 0, authToken: TEST_AUTH_TOKEN, workspaceRoots: roots });
    const listening = daemon.start();
    const baseUrl = `http://${listening.host}:${listening.port}/files/preview?path=${encodeURIComponent(
      file,
    )}`;
    try {
      const restricted = await fetch(baseUrl, {
        headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
      });
      expect(restricted.status).toBe(403);

      const unrestricted = await fetch(`${baseUrl}&workspaceScope=unrestricted`, {
        headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
      });
      expect(unrestricted.status).toBe(200);
      expect(unrestricted.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await unrestricted.text()).toBe("manager scope\n");
    } finally {
      await daemon.stop();
    }
  });
});

async function expectPreviewCode(
  input: Parameters<typeof previewFile>[0],
  code: FilePreviewError["code"],
): Promise<void> {
  try {
    await previewFile(input, roots);
  } catch (err) {
    expect(err).toBeInstanceOf(FilePreviewError);
    expect((err as FilePreviewError).code).toBe(code);
    return;
  }
  throw new Error(`expected previewFile to throw ${code}`);
}
