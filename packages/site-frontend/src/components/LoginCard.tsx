import { type Component, createSignal } from "solid-js";
import { t } from "../i18n.ts";

export interface LoginCardProps {
  onTokenLogin: (token: string) => void;
}

export const LoginCard: Component<LoginCardProps> = (props) => {
  const [token, setTokenInput] = createSignal("");

  return (
    <div class="login-stack">
      <h2 class="login-title">{t("login.title")}</h2>
      <p class="settings-card-help">{t("login.token.help")}</p>
      <form
        class="login-token-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = token().trim();
          if (value) props.onTokenLogin(value);
        }}
      >
        <input
          type="password"
          class="text-input"
          placeholder={t("login.token.placeholder")}
          value={token()}
          onInput={(event) => setTokenInput(event.currentTarget.value)}
          autocomplete="off"
          spellcheck={false}
        />
        <button type="submit" class="primary-button" disabled={!token().trim()}>
          {t("login.token.submit")}
        </button>
      </form>
    </div>
  );
};
