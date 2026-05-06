import { type Component, For, Show, createSignal } from "solid-js";
import { LOCALES, LOCALE_LABELS, locale, setLocale, t } from "../i18n.ts";
import { LoginCard } from "./LoginCard.tsx";

export interface LandingProps {
  onTokenLogin: (token: string) => void | Promise<void>;
  authed?: boolean;
  onProceed?: () => void;
}

export const Landing: Component<LandingProps> = (props) => {
  const [accessOpen, setAccessOpen] = createSignal(false);
  const open = () => {
    if (props.authed) {
      props.onProceed?.();
      return;
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
          <h1 class="landing-headline" innerHTML={t("landing.headline").replace(/\n/g, "<br/>")} />
          <p class="landing-subhead">{t("landing.subhead")}</p>
          <div class="landing-cta-row">
            <button type="button" class="primary-button landing-cta" onClick={open}>
              {t("landing.cta.start")}
            </button>
            <a class="secondary-button landing-cta" href="#how">
              {t("landing.cta.how")}
            </a>
          </div>
        </div>
      </section>

      <section class="landing-features">
        <article class="landing-feature">
          <h3>{t("landing.feature1.title")}</h3>
          <p>{t("landing.feature1.body")}</p>
        </article>
        <article class="landing-feature">
          <h3>{t("landing.feature2.title")}</h3>
          <p>{t("landing.feature2.body")}</p>
        </article>
        <article class="landing-feature">
          <h3>{t("landing.feature3.title")}</h3>
          <p>{t("landing.feature3.body")}</p>
        </article>
      </section>

      <section id="how" class="landing-how">
        <h2 class="landing-h2">{t("landing.how.title")}</h2>
        <ol class="landing-steps">
          <li innerHTML={renderMarkdown(t("landing.how.step1"))} />
          <li innerHTML={renderMarkdown(t("landing.how.step2"))} />
          <li innerHTML={renderMarkdown(t("landing.how.step3"))} />
        </ol>
        <div class="landing-cta-row" style={{ "justify-content": "center" }}>
          <button type="button" class="primary-button landing-cta" onClick={open}>
            {t("landing.how.cta")}
          </button>
        </div>
      </section>

      <footer class="landing-footer">
        <span>{t("landing.footer.legal")}</span>
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

function renderMarkdown(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}
