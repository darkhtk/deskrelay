// Service worker — minimal "PWA + Web Push" surface.
//
// v1 ships payload-less push (the server POSTs to the push endpoint
// with no body). The browser still wakes the SW with a `push` event
// — we just don't have any payload to read, so we show a hardcoded
// "Claude has an update" notification with a click-through that
// focuses or opens the app.
//
// No fetch handler, no offline cache. We deliberately keep the SW
// minimal so it never serves stale code (the SPA shell is always
// fetched fresh from the backend on each visit). When we add offline
// later, an explicit cache-versioning strategy belongs here.

const APP_URL = "/";
const NOTIFICATION_TITLE = "DeskRelay";
const NOTIFICATION_BODY_FALLBACK = "Your PC has an update.";
const NOTIFICATION_ICON = "/deskrelay-icon-192.png";
const NOTIFICATION_BADGE = "/deskrelay-icon-192.png";

self.addEventListener("install", (event) => {
  // Skip waiting so newer SW versions take over immediately on reload.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // event.data is null for payload-less pushes (v1 default). When v2
  // adds encrypted payloads, parse them here and use the title/body.
  let title = NOTIFICATION_TITLE;
  let body = NOTIFICATION_BODY_FALLBACK;
  if (event.data) {
    try {
      const json = event.data.json();
      if (json && typeof json === "object") {
        if (typeof json.title === "string") title = json.title;
        if (typeof json.body === "string") body = json.body;
      }
    } catch {
      // Treat non-JSON payload as plain text body.
      body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag: "remote-for-claude",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Focus an existing tab on our origin if one's open; otherwise open a new one.
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          return;
        }
      }
      await self.clients.openWindow(APP_URL);
    })(),
  );
});
