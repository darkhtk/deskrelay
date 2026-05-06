import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Landing } from "../src/components/Landing.tsx";
import { setLocale } from "../src/i18n.ts";

beforeEach(() => {
  setLocale("en");
  window.localStorage.removeItem("cr.locale");
});

afterEach(() => {
  setLocale("en");
  window.localStorage.clear();
});

describe("Landing language switcher", () => {
  test("starts in English and exposes all four language buttons above the headline", () => {
    render(() => <Landing onTokenLogin={vi.fn()} />);

    const english = screen.getByRole("button", { name: "English" });
    expect(english).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "한국어" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "日本語" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Русский" })).toBeTruthy();

    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).toContain("DeskRelay");
    expect(heading).toContain("for your own PCs");
  });

  test("persists the chosen landing language", () => {
    render(() => <Landing onTokenLogin={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "한국어" }));

    expect(window.localStorage.getItem("cr.locale")).toBe("ko");
    expect(screen.getByRole("button", { name: "한국어" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).not.toContain("for your own PCs");
  });
});
