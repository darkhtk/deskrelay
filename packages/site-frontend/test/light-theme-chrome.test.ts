import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("light theme browser chrome", () => {
  test("uses the light app surface for installed-app chrome", () => {
    const html = read("../index.html");
    const manifest = JSON.parse(read("../public/manifest.webmanifest"));

    expect(html).toContain('<meta name="theme-color" content="#faf9f5" />');
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    );
    expect(manifest.background_color).toBe("#faf9f5");
    expect(manifest.theme_color).toBe("#faf9f5");
  });

  test("keeps stale low-light chrome strings out of frontend theme surfaces", () => {
    const staleChromePattern = new RegExp(
      [
        ["#0b", "0b0e"].join(""),
        ["black", "translucent"].join("-"),
        ["da", "rk-theme"].join(""),
        ["#00", "0000"].join(""),
      ].join("|"),
      "i",
    );
    const surfaces = [
      read("../index.html"),
      read("../public/manifest.webmanifest"),
      read("../src/styles.css"),
      read("../src/components/DeviceShell.tsx"),
    ];

    for (const source of surfaces) {
      expect(source).not.toMatch(staleChromePattern);
      expect(source).not.toMatch(/rgba\(0\s*,\s*0\s*,\s*0/i);
      expect(source).not.toMatch(/rgba\(31\s*,\s*29\s*,\s*26/i);
    }
  });
});
