// approvals.ts — PreToolUse approval queue for claude CLI hooks.
//
// Phase G (M7.5.11). Three pieces:
//
//   POST /hooks/pretooluse                     called by the claude CLI
//     body: { tool_name, tool_input, session_id, ... }   ← claude hook payload
//     publishes "approval.pending" to the "claude.approvals" broker
//     space and awaits a matching decision via /hooks/pretooluse/respond.
//     Returns the decision JSON ({ continue, decision?, reason? }) so
//     the hook script can pass it back to claude.
//
//   POST /hooks/pretooluse/respond
//     body: { id, decision: "allow" | "deny", reason? }
//     resolves the awaited promise from the /pretooluse handler.
//
//   POST /hooks/pretooluse/simulate            ops/test only
//     body: { tool_name, tool_input?, session_id? }
//     drives the queue without an actual claude run — lets us E2E
//     verify the modal flow before the claude-runner hook wiring lands.
//
// Decisions time out after APPROVAL_TIMEOUT_MS (default deny so a
// missing browser doesn't hang the daemon forever).

import type { InProcessSubscriptionBroker } from "@deskrelay/core";
import { asSpaceId } from "@deskrelay/shared/space";

export const APPROVAL_TIMEOUT_MS = 60_000;
// Format must match SpaceId brand (`{behavior}.{kind}:{id}`).
export const APPROVALS_SPACE = asSpaceId("claude.approvals:default");

export interface PendingApproval {
  /** Unique id assigned by the queue. Echoed back in /respond. */
  id: string;
  /** ISO when the request was added. */
  createdAt: string;
  /** ISO deadline when the daemon will default-deny the request. */
  expiresAt: string;
  /** The verbatim tool-use payload from claude. */
  payload: Record<string, unknown>;
}

export interface ApprovalDecision {
  decision: "allow" | "deny";
  reason?: string;
}

/** Shape returned to the hook script (matches claude's PreToolUse hook
 *  contract — exit-code / continue / decision). */
export interface HookResponse {
  continue: boolean;
  decision?: "approve" | "block";
  reason?: string;
}

export class ApprovalQueue {
  readonly #pending = new Map<
    string,
    {
      resolve: (decision: ApprovalDecision) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #counter = 0;

  constructor(private readonly broker: InProcessSubscriptionBroker) {}

  /** Called by /hooks/pretooluse. Publishes a pending approval to the
   *  broker space and resolves once /respond arrives or the timeout
   *  fires (default deny). */
  async request(payload: Record<string, unknown>): Promise<HookResponse> {
    this.#counter += 1;
    const now = Date.now();
    const id = `apr_${now.toString(36)}_${this.#counter.toString(36)}`;
    const event: PendingApproval = {
      id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + APPROVAL_TIMEOUT_MS).toISOString(),
      payload,
    };
    // Publish so SSE subscribers (browser + mobile) see the pending
    // request.
    this.broker.publish({
      spaceId: APPROVALS_SPACE,
      kind: "approval.pending",
      content: event,
    });
    const decision = await new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        // No browser around / disconnected — default to deny so claude
        // can't silently invoke a tool just because the operator left.
        resolve({ decision: "deny", reason: "approval timed out" });
      }, APPROVAL_TIMEOUT_MS);
      this.#pending.set(id, { resolve, timer });
    });
    // Tell subscribers the request is gone (so the modal can close on
    // any device that wasn't the one who answered).
    this.broker.publish({
      spaceId: APPROVALS_SPACE,
      kind: "approval.resolved",
      content: { id, decision: decision.decision, reason: decision.reason },
    });
    return decisionToHookResponse(decision);
  }

  /** Called by /hooks/pretooluse/respond. Returns true when an entry
   *  matched (so the route can 404 on stale ids). */
  resolve(id: string, decision: ApprovalDecision): boolean {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    pending.resolve(decision);
    return true;
  }

  /** For /status — count of in-flight approvals. */
  pendingCount(): number {
    return this.#pending.size;
  }
}

function decisionToHookResponse(decision: ApprovalDecision): HookResponse {
  if (decision.decision === "allow") {
    return { continue: true, decision: "approve" };
  }
  return {
    continue: false,
    decision: "block",
    reason: decision.reason ?? "denied by operator",
  };
}
