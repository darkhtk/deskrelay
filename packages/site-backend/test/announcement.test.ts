// Tests for the public GET /api/announcement endpoint. The operator
// pushes a string into the SITE_ANNOUNCEMENT env var; we accept either
// plain text or a `{ message, until?, level? }` JSON object and emit a
// uniform response shape so the frontend has one parser to write.

import { describe, expect, test } from "bun:test";
import { createSiteApp } from "../src/app.ts";
import { InMemoryDeviceRegistry } from "../src/device-registry.ts";
import type { UpdateNoticeSource } from "../src/update-notice.ts";

interface Body {
  message: string;
  level?: "info" | "warning";
  until?: string;
}

function makeApp(announcement?: string, updateNotice?: UpdateNoticeSource) {
  return createSiteApp({
    registry: new InMemoryDeviceRegistry(),
    ...(announcement === undefined ? {} : { announcement }),
    ...(updateNotice ? { updateNotice } : {}),
  });
}

async function getAnnouncement(
  announcement?: string,
  updateNotice?: UpdateNoticeSource,
): Promise<{ status: number; body: Body }> {
  const app = makeApp(announcement, updateNotice);
  const res = await app.fetch(new Request("http://site.local/api/announcement"));
  return { status: res.status, body: (await res.json()) as Body };
}

function updateNotice(message: string, level: "info" | "warning" = "info"): UpdateNoticeSource {
  return { read: async () => ({ message, level }) };
}

describe("GET /api/announcement", () => {
  test("unset env -> empty message, 200", async () => {
    const r = await getAnnouncement();
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("");
  });

  test("update notice can become the whole announcement", async () => {
    const r = await getAnnouncement(undefined, updateNotice("현재 버젼 v0.0.0"));
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("현재 버젼 v0.0.0");
    expect(r.body.level).toBe("info");
  });

  test("update notice is prepended to operator announcement", async () => {
    const r = await getAnnouncement(
      "원격 공지",
      updateNotice("현재 버젼 v0.0.0, 다음 버젼 v0.0.1", "warning"),
    );
    expect(r.body.message).toBe("현재 버젼 v0.0.0, 다음 버젼 v0.0.1 · 원격 공지");
    expect(r.body.level).toBe("warning");
  });

  test("update notice read failure becomes a warning announcement", async () => {
    const r = await getAnnouncement(undefined, {
      read: async () => {
        throw new Error("git unavailable");
      },
    });
    expect(r.body.message).toBe("현재 버젼 확인 실패");
    expect(r.body.level).toBe("warning");
  });

  test("empty / whitespace-only env -> empty message", async () => {
    expect((await getAnnouncement("")).body.message).toBe("");
    expect((await getAnnouncement("   ")).body.message).toBe("");
  });

  test("plain text passes through as message with default level=info", async () => {
    const r = await getAnnouncement("Maintenance 5/10 21:00 ~ 23:00");
    expect(r.body.message).toBe("Maintenance 5/10 21:00 ~ 23:00");
    expect(r.body.level).toBe("info");
    expect(r.body.until).toBeUndefined();
  });

  test("JSON form: parses message + level + until", async () => {
    const raw = JSON.stringify({
      message: "New feature released",
      level: "warning",
      until: "2099-01-01T00:00:00Z",
    });
    const r = await getAnnouncement(raw);
    expect(r.body.message).toBe("New feature released");
    expect(r.body.level).toBe("warning");
    expect(r.body.until).toBe("2099-01-01T00:00:00Z");
  });

  test("JSON with expired until -> empty message (banner self-clears)", async () => {
    const raw = JSON.stringify({
      message: "Old notice",
      until: "2000-01-01T00:00:00Z",
    });
    const r = await getAnnouncement(raw);
    expect(r.body.message).toBe("");
  });

  test("JSON with bogus level falls back to info (defensive default)", async () => {
    const raw = JSON.stringify({ message: "Notice", level: "critical" });
    const r = await getAnnouncement(raw);
    expect(r.body.level).toBe("info");
  });

  test("malformed JSON falls back to plain-text interpretation", async () => {
    // A string that *looks* like JSON but is not valid. Better to show it
    // as-is than fail the public announcement endpoint.
    const r = await getAnnouncement('{ message: "missing quotes" }');
    expect(r.body.message).toBe('{ message: "missing quotes" }');
    expect(r.body.level).toBe("info");
  });

  test("public -> does not require auth", async () => {
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      token: "some-token",
      announcement: "hi",
    });
    const res = await app.fetch(new Request("http://site.local/api/announcement"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).message).toBe("hi");
  });

  test("remote URL is fetched through the server and cached", async () => {
    let calls = 0;
    const app = createSiteApp({
      registry: new InMemoryDeviceRegistry(),
      announcementUrl: "https://example.test/ANNOUNCEMENT.txt",
      announcementPollMs: 60_000,
      fetchImpl: async () => {
        calls += 1;
        return new Response("Remote repository notice", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      },
    });

    const res = await app.fetch(new Request("http://site.local/api/announcement"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).message).toBe("Remote repository notice");
    expect(calls).toBe(1);
  });
});
