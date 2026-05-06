import { type Component, For } from "solid-js";
import { t } from "../i18n.ts";

export type LegalPageKind = "privacy" | "terms";

type LegalPageProps = {
  kind: LegalPageKind;
};

const SECTION_IDS = [1, 2, 3, 4] as const;

export const LegalPage: Component<LegalPageProps> = (props) => {
  const prefix = () => `legal.${props.kind}`;

  return (
    <article class="legal-page">
      <a class="legal-back" href="/">
        {t("legal.back")}
      </a>

      <h1>{t(`${prefix()}.title`)}</h1>
      <p class="legal-updated">{t("legal.updated", { date: "2026-05-06" })}</p>
      <p>{t(`${prefix()}.intro`)}</p>

      <For each={SECTION_IDS}>
        {(id) => (
          <section>
            <h2>{t(`${prefix()}.section.${id}.title`)}</h2>
            <p>{t(`${prefix()}.section.${id}.body`)}</p>
          </section>
        )}
      </For>

      <p class="legal-foot">{t(`${prefix()}.foot`)}</p>
    </article>
  );
};
