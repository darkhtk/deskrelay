// ApprovalModal — Phase G. Subscribes to the daemon's
// "claude.approvals:default" SSE space; when an approval.pending event
// arrives, opens a modal so the operator can Allow / Deny / Always
// allow. Decisions go to /api/devices/:id/approvals/respond, which
// unblocks the claude CLI subprocess waiting on its PreToolUse hook.
//
// Auto-approve policy lives in localStorage per device + tool (Phase G4):
// when the active deviceId+tool_name is in the allow set, the modal
// short-circuits and POSTs allow immediately without UI.

import { type Component, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { ApiError, api } from "../api.ts";
import { getAlwaysAllowedTools, isAlwaysAllowed, setAlwaysAllowed } from "../device-prefs.ts";
import { t } from "../i18n.ts";

const APPROVALS_SPACE = "claude.approvals:default";

/** Fallback watchdog for old daemon events that do not include
 *  expiresAt. Keep it shorter than the daemon timeout so the UI never
 *  promises a decision window the daemon has already closed. Auto-deny
 *  is the safe failure mode — claude treats a denied tool call as a
 *  recoverable error and offers an alternative path. */
export const APPROVAL_FALLBACK_TIMEOUT_MS = 55_000;

export interface PendingApproval {
  id: string;
  toolName: string;
  toolInput: unknown;
  sessionId?: string;
  expiresAt?: string;
}

export function parsePending(content: unknown): PendingApproval | null {
  if (typeof content !== "object" || content === null) return null;
  const c = content as Record<string, unknown>;
  if (typeof c.id !== "string") return null;
  const payload = c.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  const expiresAt = typeof c.expiresAt === "string" ? c.expiresAt : undefined;
  const toolName =
    typeof payload.tool_name === "string"
      ? payload.tool_name
      : typeof payload.toolName === "string"
        ? payload.toolName
        : "(unknown tool)";
  const sid =
    typeof payload.session_id === "string"
      ? payload.session_id
      : typeof payload.sessionId === "string"
        ? payload.sessionId
        : undefined;
  return {
    id: c.id,
    toolName,
    toolInput: payload.tool_input ?? payload.toolInput ?? null,
    ...(sid !== undefined ? { sessionId: sid } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

export function approvalDeadlineMs(req: PendingApproval, now = Date.now()): number {
  if (req.expiresAt) {
    const parsed = Date.parse(req.expiresAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return now + APPROVAL_FALLBACK_TIMEOUT_MS;
}

export interface ApprovalModalProps {
  /** Active device that owns the approval queue. The component
   *  resubscribes whenever this changes. */
  deviceId: string | null;
}

export const ApprovalModal: Component<ApprovalModalProps> = (props) => {
  const [pending, setPending] = createSignal<PendingApproval | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Seconds remaining until auto-deny fires. Updated by an interval
  // that runs while pending() is non-null; reads 0 when no modal is
  // up. Used both for display and as the auto-deny trigger.
  const [remainingSec, setRemainingSec] = createSignal(0);

  // Auto-redraw the alwaysAllowed list when the device id changes (so a
  // re-paired device's allow-set isn't stuck from the previous one).
  const allowSet = () => {
    const id = props.deviceId;
    return id ? getAlwaysAllowedTools(id) : new Set<string>();
  };

  async function decide(decision: "allow" | "deny", remember: boolean) {
    const cur = pending();
    const id = props.deviceId;
    if (!cur || !id || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.respondApproval(id, cur.id, decision);
      if ("error" in res) throw new Error(res.error);
      if (remember && decision === "allow") {
        setAlwaysAllowed(id, cur.toolName, true);
      }
      setPending(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        if (pending()?.id === cur.id) setPending(null);
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Idle-timeout watchdog: when pending() becomes non-null, start a
  // countdown; when it reaches zero, auto-deny so the daemon's
  // PreToolUse hook unblocks. Resets every time a fresh approval
  // arrives. Fully cleared when the user explicitly responds (which
  // clears pending() through decide() → setPending(null)).
  createEffect(() => {
    const cur = pending();
    if (!cur) {
      setRemainingSec(0);
      return;
    }
    const deadline = approvalDeadlineMs(cur);
    const initialMs = Math.max(0, deadline - Date.now());
    setRemainingSec(Math.ceil(initialMs / 1000));
    const tick = setInterval(() => {
      const now = Date.now();
      const ms = deadline - now;
      if (ms <= 0) {
        clearInterval(tick);
        setRemainingSec(0);
        // Snapshot guard: only fire auto-deny if this is still the
        // approval we started counting for. A race where the user
        // responded just before the tick fires would otherwise send
        // a duplicate deny.
        if (pending()?.id === cur.id && !busy()) {
          void decide("deny", false);
        }
        return;
      }
      setRemainingSec(Math.ceil(ms / 1000));
    }, 1000);
    onCleanup(() => clearInterval(tick));
  });

  // Subscribe to the device's approvals SSE.
  createEffect(() => {
    const id = props.deviceId;
    if (!id) return;
    const abort = new AbortController();
    onCleanup(() => abort.abort());
    void (async () => {
      try {
        for await (const env of api.streamEvents(id, APPROVALS_SPACE, { signal: abort.signal })) {
          const e = env as { kind?: string; content?: unknown };
          if (e.kind === "approval.pending") {
            const next = parsePending(e.content);
            if (!next) continue;
            // Auto-approve known tools without prompting.
            if (isAlwaysAllowed(id, next.toolName)) {
              api.respondApproval(id, next.id, "allow").catch(() => undefined);
              continue;
            }
            setPending(next);
          } else if (e.kind === "approval.resolved") {
            const cur = pending();
            const c = e.content as { id?: unknown } | undefined;
            if (cur && c && c.id === cur.id) setPending(null);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          // Stream dropped (daemon restart, network blip). The operator
          // doesn't need to see this — claude side will retry the hook
          // request on the next tool call.
        }
      }
    })();
  });

  return (
    <Show when={pending()}>
      {(req) => (
        <dialog
          open
          class="approval-modal-root"
          aria-label={t("approval.aria")}
          onClick={(e) => {
            if (e.target === e.currentTarget) e.stopPropagation();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") void decide("deny", false);
          }}
        >
          <div class="approval-card" style={{ width: "min(560px, 95vw)", "max-width": "560px" }}>
            <div class="approval-header">
              <span class="approval-mark">⚠</span>
              <span class="approval-title">
                {t("approval.title", { toolName: req().toolName })}
              </span>
            </div>

            <pre class="approval-input">{formatToolInput(req().toolInput)}</pre>

            <Show when={error()}>{(msg) => <span class="settings-error">{msg()}</span>}</Show>

            <Show when={remainingSec() > 0}>
              <span
                class={`approval-countdown${remainingSec() <= 10 ? " approval-countdown-urgent" : ""}`}
              >
                {t("approval.auto-deny", { seconds: remainingSec() })}
              </span>
            </Show>

            <div class="approval-footer">
              <button
                type="button"
                class="approval-btn"
                onClick={() => void decide("deny", false)}
                disabled={busy()}
              >
                {t("approval.deny")} <kbd>Esc</kbd>
              </button>
              <button
                type="button"
                class="approval-btn"
                onClick={() => void decide("allow", true)}
                disabled={busy()}
                title={t("approval.always-allow.title")}
              >
                {t("approval.always-allow")}
              </button>
              <button
                type="button"
                class="approval-btn approval-btn-allow"
                onClick={() => void decide("allow", false)}
                disabled={busy()}
              >
                {t("approval.allow")} <kbd>↵</kbd>
              </button>
            </div>

            <Show when={allowSet().size > 0}>
              <div class="settings-meta" style={{ "margin-top": "4px" }}>
                {t("approval.allowed-list", { tools: [...allowSet()].sort().join(", ") })}
              </div>
            </Show>
          </div>
        </dialog>
      )}
    </Show>
  );
};

function formatToolInput(value: unknown): string {
  if (value === null || value === undefined) return t("approval.no-args");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
