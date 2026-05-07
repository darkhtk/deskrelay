import { type Component, For, Show, createSignal } from "solid-js";
import { LOCALES, LOCALE_LABELS, locale, setLocale, t } from "../i18n.ts";
import { LoginCard } from "./LoginCard.tsx";

export interface LandingProps {
  onTokenLogin: (token: string) => void | Promise<void>;
  onLocalAccessLogin?: () => boolean | Promise<boolean>;
  authed?: boolean;
  onProceed?: () => void;
}

export const Landing: Component<LandingProps> = (props) => {
  const [accessOpen, setAccessOpen] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const open = async () => {
    if (opening()) return;
    if (props.authed) {
      props.onProceed?.();
      return;
    }
    setOpening(true);
    try {
      if (await props.onLocalAccessLogin?.()) {
        props.onProceed?.();
        return;
      }
    } catch {
      // Fall back to manual Site token entry.
    } finally {
      setOpening(false);
    }
    setAccessOpen(true);
  };

  return (
    <>
      <section class="landing-hero">
        <div class="landing-hero-inner">
          <div class="landing-language-row" aria-label="Language">
            <For each={LOCALES}>
              {(id) => (
                <button
                  type="button"
                  class={`landing-language-btn${
                    id === locale() ? " landing-language-btn-active" : ""
                  }`}
                  aria-pressed={id === locale()}
                  onClick={() => setLocale(id)}
                >
                  {LOCALE_LABELS[id]}
                </button>
              )}
            </For>
          </div>
          <h1 class="landing-headline">
            <For each={t("landing.headline").split("\n")}>
              {(line, index) => (
                <>
                  <Show when={index() > 0}>
                    <br />
                  </Show>
                  {line}
                </>
              )}
            </For>
          </h1>
          <div class="landing-cta-row">
            <button
              type="button"
              class="primary-button landing-cta"
              onClick={() => void open()}
              disabled={opening()}
            >
              {t("landing.cta.start")}
            </button>
          </div>
        </div>
      </section>

      <footer class="landing-footer">
        <span class="landing-footer-links">
          <span>{t("landing.footer.legal")}</span>
          <a href="/privacy">{t("app.alpha-banner.privacy")}</a>
          <a href="/terms">{t("app.alpha-banner.terms")}</a>
        </span>
        <span style={{ "font-size": "12px", opacity: "0.7" }}>
          {t("landing.footer.disclaimer")}
        </span>
      </footer>

      <Show when={accessOpen()}>
        <dialog
          open
          class="approval-modal-root"
          aria-label={t("landing.signin.title")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setAccessOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setAccessOpen(false);
          }}
        >
          <button
            type="button"
            class="approval-backdrop"
            onClick={() => setAccessOpen(false)}
            aria-label={t("app.settings.close")}
          />
          <div class="approval-card" style={{ width: "min(420px, 95vw)" }}>
            <div class="approval-header">
              <span class="approval-title">{t("landing.signin.title")}</span>
              <button
                type="button"
                class="sidebar-action"
                style={{ "margin-left": "auto", width: "auto", padding: "4px 10px" }}
                onClick={() => setAccessOpen(false)}
                aria-label={t("app.dialog.close")}
              >
                x
              </button>
            </div>
            <LoginCard
              onTokenLogin={async (token) => {
                await props.onTokenLogin(token);
                props.onProceed?.();
              }}
            />
          </div>
        </dialog>
      </Show>
    </>
  );
};
