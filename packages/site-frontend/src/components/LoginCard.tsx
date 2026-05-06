import { type Component, createSignal } from "solid-js";
import { t } from "../i18n.ts";

export interface LoginCardProps {
  onTokenLogin: (token: string) => void | Promise<void>;
}

export const LoginCard: Component<LoginCardProps> = (props) => {
  const [token, setTokenInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  return (
    <div class="login-stack">
      <h2 class="login-title">{t("login.title")}</h2>
      <p class="settings-card-help">{t("login.token.help")}</p>
      <form
        class="login-token-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = token().trim();
          if (!value || busy()) return;
          setError(null);
          setBusy(true);
          try {
            await props.onTokenLogin(value);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
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
          disabled={busy()}
        />
        <button type="submit" class="primary-button" disabled={!token().trim() || busy()}>
          {busy() ? t("login.token.checking") : t("login.token.submit")}
        </button>
      </form>
      {error() ? <span class="settings-error">{error()}</span> : null}
    </div>
  );
};
