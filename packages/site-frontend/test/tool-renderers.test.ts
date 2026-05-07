// Tests ported from the original browser prototype tests/tool-renderers.test.js with TS types.

import { describe, expect, test } from "vitest";
import {
  renderBash,
  renderDefault,
  renderEdit,
  renderGlob,
  renderGrep,
  renderRead,
  renderTodoWrite,
  renderToolResult,
  renderToolUse,
  renderWrite,
} from "../src/claude/tool-renderers.ts";

describe("renderBash", () => {
  test("renders command + description + cwd", () => {
    const html = renderBash({
      name: "Bash",
      input: { command: "ls -la", description: "list files", cwd: "/tmp" },
    });
    expect(html).toContain("ls -la");
    expect(html).toContain("list files");
    expect(html).toContain("/tmp");
    expect(html).toContain('class="tool-trace tool-bash"');
  });

  test("escapes shell metacharacters", () => {
    const html = renderBash({ name: "Bash", input: { command: "echo <script>" } });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("missing input → empty body but still renders shell", () => {
    const html = renderBash({ name: "Bash" });
    expect(html).toContain('class="tool-trace tool-bash"');
  });
});

describe("renderRead", () => {
  test("renders file path + range when offset/limit set", () => {
    const html = renderRead({
      name: "Read",
      input: { file_path: "/a/b/c.ts", offset: 10, limit: 50 },
    });
    expect(html).toContain("/a/b/c.ts");
    expect(html).toContain("lines 10–60");
  });

  test("uses basename for the peek summary", () => {
    const html = renderRead({ name: "Read", input: { file_path: "/very/long/path/file.ts" } });
    expect(html).toContain("file.ts");
  });
});

describe("renderEdit", () => {
  test("renders old + new diff blocks", () => {
    const html = renderEdit({
      name: "Edit",
      input: { file_path: "/x.ts", old_string: "foo", new_string: "bar" },
    });
    expect(html).toContain("foo");
    expect(html).toContain("bar");
    expect(html).toContain("tool-diff-old");
    expect(html).toContain("tool-diff-new");
  });

  test("flags replace_all in peek + body", () => {
    const html = renderEdit({
      name: "Edit",
      input: { file_path: "/x", old_string: "a", new_string: "b", replace_all: true },
    });
    expect(html).toContain("replace_all");
  });
});

describe("renderWrite", () => {
  test("renders file + truncated content", () => {
    const html = renderWrite({
      name: "Write",
      input: { file_path: "/x", content: "line\nline" },
    });
    expect(html).toContain("/x");
    expect(html).toContain("line\nline");
  });
});

describe("renderGlob + renderGrep", () => {
  test("Glob renders pattern + path", () => {
    const html = renderGlob({ name: "Glob", input: { pattern: "**/*.ts", path: "/src" } });
    expect(html).toContain("**/*.ts");
    expect(html).toContain("/src");
  });

  test("Grep renders pattern + type + glob", () => {
    const html = renderGrep({
      name: "Grep",
      input: { pattern: "TODO", path: "/src", type: "ts", glob: "*.ts" },
    });
    expect(html).toContain("TODO");
    expect(html).toContain("ts");
    expect(html).toContain("*.ts");
  });
});

describe("renderTodoWrite", () => {
  test("renders todo items with status classes", () => {
    const html = renderTodoWrite({
      name: "TodoWrite",
      input: {
        todos: [
          { subject: "first task", status: "completed" },
          { subject: "second task", status: "in_progress" },
        ],
      },
    });
    expect(html).toContain("first task");
    expect(html).toContain('class="todo-completed"');
    expect(html).toContain('class="todo-in_progress"');
    expect(html).toContain("2 items");
  });

  test("handles single item peek correctly", () => {
    const html = renderTodoWrite({
      name: "TodoWrite",
      input: { todos: [{ subject: "only one" }] },
    });
    expect(html).toContain("1 item");
    expect(html).not.toContain("1 items");
  });
});

describe("renderDefault", () => {
  test("falls back to escaped JSON for unknown tools", () => {
    const html = renderDefault({ name: "MysteryTool", input: { foo: "bar" } });
    expect(html).toContain("MysteryTool");
    expect(html).toContain("&quot;foo&quot;");
  });
});

describe("renderToolUse — registry dispatch", () => {
  test("Bash dispatches to renderBash", () => {
    const html = renderToolUse({
      type: "tool_use",
      id: "tu_1",
      name: "Bash",
      input: { command: "pwd" },
    });
    expect(html).toContain("tool-bash");
    expect(html).toContain("pwd");
  });

  test("MCP tool name falls through to default", () => {
    const html = renderToolUse({
      type: "tool_use",
      id: "tu_2",
      name: "mcp__server__list_files",
      input: {},
    });
    expect(html).toContain("tool-default");
    expect(html).toContain("mcp__server__list_files");
  });

  test("MultiEdit aliases Edit", () => {
    const html = renderToolUse({
      type: "tool_use",
      id: "tu_3",
      name: "MultiEdit",
      input: { file_path: "/x", old_string: "a", new_string: "b" },
    });
    expect(html).toContain("tool-edit");
  });
});

describe("renderToolResult", () => {
  test("string content renders inside <pre><code>", () => {
    const html = renderToolResult({ tool_use_id: "tu_1", content: "stdout output" });
    expect(html).toContain("stdout output");
    expect(html).toContain('class="tool-result"');
  });

  test("array content with multiple text blocks concatenates", () => {
    const html = renderToolResult({
      tool_use_id: "tu_2",
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });
    expect(html).toContain("first\nsecond");
  });

  test("is_error flips the class + label", () => {
    const html = renderToolResult({ tool_use_id: "tu_3", content: "boom", is_error: true });
    expect(html).toContain("tool-result-error");
    expect(html).toContain("✕ result");
  });

  test("base64 image with image/* media_type renders <img>", () => {
    const html = renderToolResult({
      tool_use_id: "tu_4",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "iVBORw0KG" },
        },
      ],
    });
    expect(html).toContain('src="data:image/png;base64,iVBORw0KG"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('<details class="tool-result" open');
  });

  test("non-image media_type is rejected", () => {
    const html = renderToolResult({
      tool_use_id: "tu_5",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "text/html", data: "PHA+" },
        },
      ],
    });
    expect(html).not.toContain("<img");
  });

  test("https URL image renders; http does not", () => {
    expect(
      renderToolResult({
        tool_use_id: "tu_6",
        content: [
          {
            type: "image",
            source: { type: "url", url: "https://example.com/x.png" },
          },
        ],
      }),
    ).toContain('src="https://example.com/x.png"');
    expect(
      renderToolResult({
        tool_use_id: "tu_7",
        content: [
          {
            type: "image",
            source: { type: "url", url: "http://example.com/x.png" },
          },
        ],
      }),
    ).not.toContain("<img");
  });
});
