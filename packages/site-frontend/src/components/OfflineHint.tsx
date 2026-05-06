// OfflineHint — when a fetch error matches the daemon-offline message
// from the backend (be.daemon.offline), render a tiny inline action
// row so the user can recover without copy-pasting commands by hand.
//
// Pattern detection deliberately matches the literal "connector daemon"
// substring that the backend keeps untranslated across en/ko/ja/ru, so
// this stays useful regardless of the user's locale.

import { type Component, Show, createSignal } from "solid-js";
import { t } from "../i18n.ts";

export interface OfflineHintProps {
  /** The error message text returned by the backend / surfaced by the
   *  caller. We compare against this to decide whether to render. */
  message: string | null | undefined;
  /** Optional: if provided, renders a Retry button that fires this. */
  onRetry?: (() => void) | undefined;
  /** Human label of the selected device, used to avoid implying that
   *  refreshing or starting the daemon on the browser PC can fix a
   *  different PC. */
  deviceLabel?: string | null | undefined;
  /** Optional: shown as a "pick another device" action. */
  onPickDevice?: (() => void) | undefined;
  /** Show the source-mode `bun run .../bin.ts` copy button. Defaults to
   *  Vite's DEV flag for non-Windows builds. Windows production currently
   *  uses the source-run command as the primary recovery path because
   *  Chrome blocks the unsigned binary download. */
  showSourceCommand?: boolean;
}

const PRIMARY_COMMAND = "cr-connector";
const SOURCE_COMMAND = "bun run packages/pc-connector-daemon/src/bin.ts";
/** Windows recovery hint: with the packaged connector flow the daemon auto-starts on
 *  every login, so "daemon offline" usually means the
 *  process is wedged or the user terminated it. Restarting the binary
 *  in any open terminal is enough — the install dir is on PATH already.
 *  No PowerShell admin dance needed. */
const WINDOWS_BINARY_RUN_COMMAND = "cr-connector";

/** True iff the message looks like the be.daemon.offline error. The
 *  string "connector daemon" stays in every locale (only translation
 *  is the surrounding text), so a substring match works without
 *  hardcoding 4 different translations. */
export function isDaemonOfflineMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /connector\s+daemon/i.test(message);
}

export function daemonOfflineBannerMessage(deviceLabel?: string | null): string {
  return deviceLabel
    ? t("offline.banner.device", { label: deviceLabel })
    : t("offline.banner");
}

export function daemonOfflineHelpMessage(deviceLabel?: string | null): string {
  return deviceLabel ? t("offline.help.device", { label: deviceLabel }) : t("offline.help");
}

export const OfflineHint: Component<OfflineHintProps> = (props) => {
  const [copied, setCopied] = createSignal<"none" | "primary" | "source">("none");

  function copy(text: string, which: "primary" | "source") {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(which);
        setTimeout(() => setCopied("none"), 1500);
      },
      () => {
        // Clipboard API unavailable (insecure context / old browser).
        // Fall back to a localized prompt so the user still gets the
        // text — better than a silent no-op.
        try {
          window.prompt(t("offline.copy.fallback-title"), text);
        } catch {
          /* ignore */
        }
      },
    );
  }

  const isWindows = () => detectOfflineOS() === "windows";
  const primaryCommand = () => (isWindows() ? WINDOWS_BINARY_RUN_COMMAND : PRIMARY_COMMAND);
  // Default: Vite's DEV flag for non-Windows. Windows already uses the
  // source runner as primary, so a second source button would duplicate it.
  const showSource = () => props.showSourceCommand ?? (import.meta.env.DEV && !isWindows());

  return (
    <Show when={isDaemonOfflineMessage(props.message)}>
      <div class="offline-hint" role="note">
        <div class="offline-hint-message">{daemonOfflineHelpMessage(props.deviceLabel)}</div>
        <div class="offline-hint-actions">
          <button
            type="button"
            class="offline-hint-copy"
            onClick={() => copy(primaryCommand(), "primary")}
            title={primaryCommand()}
          >
            {copied() === "primary" ? t("offline.copied") : t("offline.copy.primary")}
          </button>
          <Show when={showSource()}>
            <button
              type="button"
              class="offline-hint-copy offline-hint-copy-secondary"
              onClick={() => copy(SOURCE_COMMAND, "source")}
              title={SOURCE_COMMAND}
            >
              {copied() === "source" ? t("offline.copied") : t("offline.copy.source")}
            </button>
          </Show>
          <Show when={props.onRetry}>
            <button type="button" class="offline-hint-retry" onClick={() => props.onRetry?.()}>
              {t("offline.retry")}
            </button>
          </Show>
          <Show when={props.onPickDevice}>
            <button type="button" class="offline-hint-retry" onClick={() => props.onPickDevice?.()}>
              {t("offline.pick-device")}
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
};

function detectOfflineOS(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): "windows" | "mac" | "linux" | "other" {
  const lower = ua.toLowerCase();
  if (lower.includes("win")) return "windows";
  if (lower.includes("mac")) return "mac";
  if (lower.includes("linux") || lower.includes("x11")) return "linux";
  return "other";
}
