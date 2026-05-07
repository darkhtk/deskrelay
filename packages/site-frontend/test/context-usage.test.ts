import { describe, expect, test } from "vitest";
import { latestContextUsageSnapshot } from "../src/components/ChatView.tsx";

describe("context usage extraction", () => {
  test("reads Claude /context free space from assistant text", () => {
    const usage = latestContextUsageSnapshot([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: [
                "## Context Usage",
                "",
                "**Tokens:** 25.9k / 1m (3%)",
                "",
                "| Category | Tokens | Percentage |",
                "|----------|--------|------------|",
                "| Messages | 13 | 0.0% |",
                "| Free space | 941.1k | 94.1% |",
              ].join("\n"),
            },
          ],
        },
      },
    ]);

    expect(usage?.remainingPercent).toBeCloseTo(94.1);
    expect(usage?.usedPercent).toBeCloseTo(5.9);
    expect(usage?.source).toBe("text");
  });

  test("reads Claude /context text from result events", () => {
    const usage = latestContextUsageSnapshot([
      {
        type: "result",
        result: "## Context Usage\n\n**Tokens:** 25.9k / 1m (3%)",
      },
    ]);

    expect(usage).toEqual({
      remainingPercent: 97,
      usedPercent: 3,
      source: "text",
    });
  });
});
