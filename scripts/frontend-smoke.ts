#!/usr/bin/env bun
// frontend-smoke — small DOM-metric smoke against the built site-frontend
// dist. Spins up a tiny Bun.serve, points Playwright at it, runs the
// asserts the prompt asked for at 1440×900 (desktop) and 390×844 (mobile).
//
// Not a screenshot framework. Just enough to catch:
//   - horizontal overflow on Landing,
//   - raw <button> user-agent styling inside LoginCard,
//   - sub-40px touch targets on key controls,
//   - theme-color regression.
//
// Run with:  bun run scripts/frontend-smoke.ts
// Pre-req:   bun --filter @deskrelay/site-frontend build (populates dist).

import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const distDir = resolve(repoRoot, "packages/site-frontend/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Stub /api/* responses so the SPA doesn't crash on missing backend.
function apiStub(pathname: string): Response | null {
  if (!pathname.startsWith("/api/") && pathname !== "/healthz") return null;
  if (pathname === "/healthz") {
    return Response.json({ ok: true, version: "smoke", devices: 0 });
  }
  if (pathname === "/api/auth/providers") {
    return Response.json([{ id: "google", displayName: "Google" }]);
  }
  if (pathname === "/api/auth/me") {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (pathname === "/api/consent/me") {
    return Response.json({ agreedVersion: null, currentVersion: "v1" });
  }
  // Generic 404 — the SPA is robust to missing endpoints.
  return new Response("{}", { status: 404 });
}

async function staticHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const stub = apiStub(url.pathname);
  if (stub) return stub;
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(distDir, requested);
  try {
    const s = await stat(filePath);
    if (s.isFile()) {
      const data = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      return new Response(data, {
        status: 200,
        headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
      });
    }
  } catch {
    /* fall through */
  }
  // SPA fallback — serve index.html for unknown paths.
  try {
    const html = await readFile(join(distDir, "index.html"));
    return new Response(html, {
      status: 200,
      headers: { "content-type": MIME[".html"] as string },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

interface AssertResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: AssertResult[] = [];
function assert(name: string, condition: boolean, detail?: string) {
  results.push({ name, ok: condition, ...(detail ? { detail } : {}) });
}

async function main(): Promise<void> {
  await stat(join(distDir, "index.html")).catch(() => {
    throw new Error(
      "site-frontend dist missing — run `bun --filter @deskrelay/site-frontend build` first.",
    );
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: staticHandler,
  });
  const baseUrl = `http://${server.hostname}:${server.port}`;
  console.log(`[smoke] static server listening on ${baseUrl}`);

  // Try chromium first; fall back to firefox if its launch hangs (some
  // Windows + AV configs block chrome's CDP pipe and `chromium.launch`
  // never resolves). Both engines see the same DOM here.
  const browser = await Promise.race([
    chromium.launch({ headless: true, timeout: 30_000 }).catch((err) => {
      console.warn(`[smoke] chromium launch failed (${err.message}); trying firefox`);
      return null;
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 35_000)),
  ]).then((b) => b ?? firefox.launch({ headless: true, timeout: 60_000 }));
  try {
    for (const [label, viewport] of [
      ["desktop", { width: 1440, height: 900 }] as const,
      ["mobile", { width: 390, height: 844 }] as const,
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });

      // Theme-color regression guard.
      const themeColor = await page.locator('meta[name="theme-color"]').getAttribute("content");
      assert(`${label}: theme-color is light`, themeColor === "#faf9f5", `got ${themeColor}`);

      // No horizontal overflow.
      const docOverflow = await page.evaluate(() => {
        const w = document.documentElement;
        return w.scrollWidth - w.clientWidth;
      });
      assert(
        `${label}: no horizontal overflow`,
        docOverflow <= 1,
        `scrollWidth-clientWidth=${docOverflow}px`,
      );

      // Header locale buttons reachable.
      const localeBtnHeight = await page
        .locator(".header-locale-btn")
        .first()
        .evaluate((el: HTMLElement) => el.offsetHeight);
      const minHeight = label === "mobile" ? 36 : 28;
      assert(
        `${label}: header locale btn ≥ ${minHeight}px`,
        localeBtnHeight >= minHeight,
        `got ${localeBtnHeight}px`,
      );

      // Open the Login modal via "Get started" CTA.
      const cta = page.getByRole("button", { name: /get started/i }).first();
      await cta.click({ trial: false });

      // Provider button: must be primary-button, not raw user-agent.
      await page.waitForSelector(".login-provider-btn", { timeout: 2_000 });
      const providerHasPrimary = await page
        .locator(".login-provider-btn")
        .first()
        .evaluate((el: HTMLElement) => el.classList.contains("primary-button"));
      assert(`${label}: provider btn has primary-button`, providerHasPrimary);
      const providerHeight = await page
        .locator(".login-provider-btn")
        .first()
        .evaluate((el: HTMLElement) => el.offsetHeight);
      assert(`${label}: provider btn ≥ 40px`, providerHeight >= 40, `got ${providerHeight}px`);

      // No raw .panel / .col / .row inside the LoginCard.
      const stalePanel = await page.locator(".login-stack .panel").count();
      const staleCol = await page.locator(".login-stack .col").count();
      const staleRow = await page.locator(".login-stack .row").count();
      assert(`${label}: no stale .panel inside login`, stalePanel === 0);
      assert(`${label}: no stale .col inside login`, staleCol === 0);
      assert(`${label}: no stale .row inside login`, staleRow === 0);

      // Modal scrim + card visually separated (backdrop has non-transparent bg).
      const backdropBg = await page
        .locator(".approval-backdrop")
        .first()
        .evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
      const isScrim =
        backdropBg !== "rgba(0, 0, 0, 0)" && backdropBg !== "transparent" && backdropBg !== "";
      assert(`${label}: modal backdrop has scrim`, isScrim, `bg=${backdropBg}`);

      await ctx.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }

  let failed = 0;
  for (const r of results) {
    const tag = r.ok ? "✓" : "✗";
    const detail = r.detail ? `  (${r.detail})` : "";
    console.log(`  ${tag} ${r.name}${detail}`);
    if (!r.ok) failed += 1;
  }
  console.log(`\n[smoke] ${results.length - failed}/${results.length} assertions passed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

await main();
