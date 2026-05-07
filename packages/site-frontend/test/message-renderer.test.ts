// Tests ported from the original browser prototype tests/message-renderer.test.js (vanilla JS).
// Same coverage map; types added for the TS port.

import { describe, expect, test } from "vitest";
import { escapeHtml, renderMarkdown } from "../src/claude/message-renderer.ts";

describe("escapeHtml", () => {
  test("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  test("coerces non-strings", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(null)).toBe("null");
  });
});

describe("renderMarkdown — code blocks", () => {
  test("fenced code block with language", () => {
    const html = renderMarkdown("```ts\nconst x: number = 1;\n```");
    expect(html).toContain('<pre data-language="ts"><code class="language-ts">');
    expect(html).toContain("const x: number = 1;");
    expect(html).toContain("data-copy>Copy</button>");
  });

  test("fenced code block without language", () => {
    const html = renderMarkdown("```\nplain\n```");
    expect(html).toContain("<pre><code>plain</code>");
  });

  test("inline code is escaped + wrapped", () => {
    const html = renderMarkdown("call `foo<bar>` now");
    expect(html).toContain("<code>foo&lt;bar&gt;</code>");
  });

  test("code block contents are NOT markdown-parsed", () => {
    const html = renderMarkdown("```\n**not bold**\n```");
    expect(html).toContain("**not bold**");
    expect(html).not.toContain("<strong>");
  });
});

describe("renderMarkdown — block structure", () => {
  test("headers (# .. ######)", () => {
    const html = renderMarkdown("# h1\n## h2\n### h3\n###### h6");
    expect(html).toContain("<h1>h1</h1>");
    expect(html).toContain("<h2>h2</h2>");
    expect(html).toContain("<h3>h3</h3>");
    expect(html).toContain("<h6>h6</h6>");
  });

  test("unordered list", () => {
    const html = renderMarkdown("- a\n- b\n- c");
    expect(html).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
  });

  test("ordered list", () => {
    const html = renderMarkdown("1. a\n2. b");
    expect(html).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  test("blockquote", () => {
    const html = renderMarkdown("> quoted line\n> second line");
    expect(html).toBe("<blockquote>quoted line<br>second line</blockquote>");
  });

  test("horizontal rule", () => {
    expect(renderMarkdown("---")).toBe("<hr>");
  });

  test("paragraphs separated by blank lines", () => {
    const html = renderMarkdown("first line\n\nsecond para");
    expect(html).toBe("<p>first line</p><p>second para</p>");
  });

  test("single newline → <br> within paragraph", () => {
    const html = renderMarkdown("line a\nline b");
    expect(html).toBe("<p>line a<br>line b</p>");
  });
});

describe("renderMarkdown — inline formatting", () => {
  test("bold + italic", () => {
    expect(renderMarkdown("**bold** and *italic* and _italic2_")).toContain(
      "<strong>bold</strong>",
    );
    expect(renderMarkdown("*italic*")).toContain("<em>italic</em>");
  });

  test("https links open in new tab with noopener", () => {
    const html = renderMarkdown("[anthropic](https://anthropic.com)");
    expect(html).toContain('href="https://anthropic.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("javascript: links are NOT rendered as anchors", () => {
    const html = renderMarkdown("[evil](javascript:alert(1))");
    expect(html).not.toContain("<a");
  });
});

describe("renderMarkdown — image safelist", () => {
  test("https images render as <img>", () => {
    const html = renderMarkdown("![cat](https://example.com/cat.png)");
    expect(html).toContain('<img src="https://example.com/cat.png"');
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  test("data:image/* base64 renders", () => {
    const html = renderMarkdown("![dot](data:image/png;base64,iVBORw0KGgo=)");
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  test("http (insecure) image does NOT render as <img>", () => {
    const html = renderMarkdown("![bad](http://example.com/x.png)");
    expect(html).not.toContain("<img");
  });
});

describe("renderMarkdown — XSS guards", () => {
  test("raw <script> tag is escaped", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("attributes don't break out", () => {
    const html = renderMarkdown('[x](https://e.com" onclick=alert(1) ")');
    // URL regex stops at the first whitespace, so the link is rejected
    // and the line falls through to escaped text. No <a> is created;
    // the literal "onclick" appears as escaped body text, which is inert.
    expect(html).not.toContain("<a ");
    expect(html).toContain("&quot;");
  });
});

describe("renderMarkdown — null / empty", () => {
  test("null input returns empty string", () => {
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });

  test("empty string returns empty", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

describe("renderMarkdown local image placeholders", () => {
  test("local image paths render as daemon-preview placeholders, not file URLs", () => {
    const html = renderMarkdown("![shot](C:\\repo\\screens\\shot.png)");
    expect(html).toContain('class="local-image-preview"');
    expect(html).toContain('data-local-image-path="C:\\repo\\screens\\shot.png"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("file://");
  });

  test("inline-code local image paths also render as daemon-preview placeholders", () => {
    const html = renderMarkdown("created `dog.png`");
    expect(html).toContain('class="local-image-preview"');
    expect(html).toContain('data-local-image-path="dog.png"');
    expect(html).not.toContain("<code>dog.png</code>");
  });
});

describe("renderMarkdown tables", () => {
  test("renders a GitHub-style table block", () => {
    const html = renderMarkdown(`| Axis | Score | Weight | Weighted |
|------|-------|--------|----------|
| A. Vocabulary Cohesion | 3/3 | 1.0 | 3.0 |
| TOTAL | 29/36 (80.6%) | | 34.7 / 45.3 (76.6%) |`);
    expect(html).toContain('<div class="markdown-table-wrap">');
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Axis</th>");
    expect(html).toContain("<td>A. Vocabulary Cohesion</td>");
    expect(html).toContain("<td>34.7 / 45.3 (76.6%)</td>");
  });

  test("escapes table cell HTML", () => {
    const html = renderMarkdown(`| A | B |
|---|---|
| <script>alert(1)</script> | ok |`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
