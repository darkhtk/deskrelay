import { describe, expect, test } from "vitest";

describe("vitest sanity", () => {
  test("runs and asserts", () => {
    expect(2 + 2).toBe(4);
  });

  test("jsdom is available", () => {
    const div = document.createElement("div");
    div.textContent = "hello";
    expect(div.textContent).toBe("hello");
  });
});
