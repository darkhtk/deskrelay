// Tests for the public GET /api/announcement endpoint. The operator
// pushes a string into the SITE_ANNOUNCEMENT env var; we accept either
// plain text or a `{ message, until?, level? }` JSON object and emit a
// uniform response shape so the frontend has one parser to write.

import { describe, expect, test } from "bun:test";
import { createSiteApp } from "../src/app.ts";
import { InMemoryDeviceRegistry } from "../src/device-registry.ts";

interface Body {
  message: string;
  level?: "info" | "warning";
  until?: string;
}

function makeApp(announcement?: string) {
  return createSiteApp({
    registry: new InMemoryDeviceRegistry(),
    ...(announcement === undefined ? {} : { announcement }),
  });
}

async function getAnnouncement(announcement?: string): Promise<{ status: number; body: Body }> {
  const app = makeApp(announcement);
  const res = await app.fetch(new Request("http://site.local/api/announcement"));
  return { status: res.status, body: (await res.json()) as Body };
}

describe("GET /api/announcement", () => {
  test("unset env → empty message, 200", async () => {
    const r = await getAnnouncement();
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("");
  });

  test("empty / whitespace-only env → empty message", async () => {
    expect((await getAnnouncement("")).body.message).toBe("");
    expect((await getAnnouncement("   ")).body.message).toBe("");
  });

  test("plain text passes through as message with default level=info", async () => {
    const r = await getAnnouncement("점검 5/10 21:00 ~ 23:00");
    expect(r.body.message).toBe("점검 5/10 21:00 ~ 23:00");
    expect(r.body.level).toBe("info");
    expect(r.body.until).toBeUndefined();
  });

  test("JSON form: parses message + level + until", async () => {
    const raw = JSON.stringify({
      message: "신규 기능 출시 🎉",
      level: "warning",
      until: "2099-01-01T00:00:00Z",
    });
    const r = await getAnnouncement(raw);
    expect(r.body.message).toBe("신규 기능 출시 🎉");
    expect(r.body.level).toBe("warning");
    expect(r.body.until).toBe("2099-01-01T00:00:00Z");
  });

  test("JSON with expired until → empty message (banner self-clears)", async () => {
    const raw = JSON.stringify({
      message: "지난 공지",
      until: "2000-01-01T00:00:00Z",
    });
    const r = await getAnnouncement(raw);
    expect(r.body.message).toBe("");
  });

  test("JSON with bogus level falls back to info (defensive default)", async () => {
    const raw = JSON.stringify({ message: "공지", level: "critical" });
    const r = await getAnnouncement(raw);
    expect(r.body.level).toBe("info");
  });

  test("malformed JSON falls back to plain-text interpretation", async () => {
    // A string that *looks* like JSON but isn't — operator probably
    // meant to type literal text. Better to show it as-is than 500.
    const r = await getAnnouncement('{ message: "missing quotes" }');
    expect(r.body.message).toBe('{ message: "missing quotes" }');
    expect(r.body.level).toBe("info");
  });

  test("public — does not require auth", async () => {
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: "some-token",
      announcement: "hi",
    });
    const res = await app.fetch(new Request("http://site.local/api/announcement"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).message).toBe("hi");
  });
});
