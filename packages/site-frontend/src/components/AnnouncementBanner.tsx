import { type Component, Show, createSignal, onMount } from "solid-js";
import { getBaseUrl } from "../api.ts";

interface AnnouncementPayload {
  message: string;
  level?: "info" | "warning";
  until?: string;
}

export const AnnouncementBanner: Component = () => {
  const [payload, setPayload] = createSignal<AnnouncementPayload | null>(null);

  onMount(() => {
    const ctrl = new AbortController();
    const url = `${getBaseUrl()}/api/announcement`;
    const load = () => {
      void fetch(url, { signal: ctrl.signal })
        .then((response) =>
          response.ok ? (response.json() as Promise<AnnouncementPayload>) : null,
        )
        .then((data) => {
          if (!data || !data.message) {
            setPayload(null);
            return;
          }
          setPayload(data);
        })
        .catch(() => {
          // Banner failures should not interrupt the app.
        });
    };
    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      ctrl.abort();
      window.clearInterval(timer);
    };
  });

  return (
    <Show when={payload()}>
      {(current) => (
        <div
          class={`announcement-marquee announcement-marquee-${current().level ?? "info"}`}
          role="status"
          aria-live="polite"
        >
          <div class="announcement-marquee-track">
            <span class="announcement-marquee-text">{current().message}</span>
          </div>
        </div>
      )}
    </Show>
  );
};
