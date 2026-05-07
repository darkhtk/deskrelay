import { render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Landing } from "../src/components/Landing.tsx";
import { setLocale, t } from "../src/i18n.ts";

beforeEach(() => {
  setLocale("ko");
  window.localStorage.removeItem("cr.locale");
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ ok: true, version: "0.0.0", devices: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("ko");
  window.localStorage.clear();
});

describe("Landing Korean-only locale", () => {
  test("does not expose language buttons above the headline", () => {
    render(() => <Landing onTokenLogin={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
    expect(screen.queryByRole("button", { name: "한국어" })).toBeNull();
    expect(screen.queryByRole("button", { name: "日本語" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Русский" })).toBeNull();

    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).toContain("DeskRelay");
  });

  test("normalizes old locale requests back to Korean", () => {
    setLocale("en");
    render(() => <Landing onTokenLogin={vi.fn()} />);

    expect(window.localStorage.getItem("cr.locale")).toBe("ko");
    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).toBe(t("landing.headline").replace(/\n/g, ""));
  });
});
