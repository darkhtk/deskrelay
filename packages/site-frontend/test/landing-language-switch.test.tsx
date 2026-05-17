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

describe("Landing locale behavior", () => {
  test("does not expose language buttons above the headline", () => {
    render(() => <Landing onTokenLogin={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
    expect(screen.queryByRole("button", { name: "한국어" })).toBeNull();

    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).toContain("DeskRelay");
  });

  test("English is selectable without adding landing language buttons", () => {
    setLocale("en");
    render(() => <Landing onTokenLogin={vi.fn()} />);

    expect(window.localStorage.getItem("cr.locale")).toBe("en");
    expect(t("manager.orchestration.tab.overview")).toBe("Overview");
    expect(t("manager.worker-settings.profile.claude-code.label")).toBe("Claude Code worker");
    expect(t("manager.worker-settings.role.implementation")).toBe("implementation");
    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).toBe(t("landing.headline").replace(/\n/g, ""));
  });

  test("unsupported locale requests fall back to Korean", () => {
    setLocale("ja");

    expect(window.localStorage.getItem("cr.locale")).toBe("ko");
    expect(t("settings.language.title")).toBe("언어");
    expect(t("manager.worker-settings.profile.claude-code.label")).toBe("Claude Code 작업자");
    expect(t("manager.worker-settings.role.implementation")).toBe("구현");
  });
});
