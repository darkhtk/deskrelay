#!/usr/bin/env bun
// pretooluse.ts — claude CLI PreToolUse hook script.
//
// Wired by claude-runner via a generated settings.json that points at
// this file. claude CLI invokes us with the tool-use payload on stdin
// and expects either:
//   - exit 0 + JSON on stdout: { continue: true } | { continue: false, ... }
//   - exit 2: short-circuit "blocked" (legacy form)
//
// We forward the payload to the daemon's /hooks/pretooluse, which
// publishes an "approval.pending" event over the broker. The browser
// modal posts a decision back; the daemon resolves us, and we relay the
// HookResponse JSON to claude.
//
// Env (set by claude-runner when spawning):
//   CR_DAEMON_URL    e.g. http://127.0.0.1:18091     required
//
// Daemon-unreachable policy is per-device-configurable via the
// `CR_PRETOOLUSE_FAIL_POLICY` env (set by claude-runner from the chat
// request's securityProfile):
//
//   relaxed (or unset): fail open — `{continue: true}`. OK for trusted
//                       personal workstations; matches the original
//                       behaviour pre-M7.6.
//   normal:             fail closed — `{continue: false, decision: "block"}`.
//                       Recommended default for remote self-host use.
//   strict:             fail closed (same wire response as normal; a
//                       distinct profile field so future hardening can
//                       diverge without touching the hook contract).
//
// The daemon-side timeout (60s default deny) is independent of this —
// that's the safety net for when the operator simply doesn't answer.
// The fail-policy here only kicks in when this script can't reach the
// daemon at all (daemon down, network blip, auth gate denied us).

import { readableStreamFromStdin } from "./_stdin.ts";

const DAEMON_URL = process.env.CR_DAEMON_URL ?? "";
const FAIL_POLICY = (process.env.CR_PRETOOLUSE_FAIL_POLICY ?? "relaxed").toLowerCase();
// Bearer token for the daemon's per-machine auth gate. CR_DAEMON_TOKEN
// is set by the daemon's bin.ts on its own process env; behaviors
// (remote-claude) and their grandchildren (claude-runner → claude CLI
// → this hook script) inherit it down the spawn chain.
const DAEMON_TOKEN = process.env.CR_DAEMON_TOKEN ?? "";

function failResponse(): {
  continue: boolean;
  decision?: string;
  reason?: string;
} {
  if (FAIL_POLICY === "normal" || FAIL_POLICY === "strict") {
    return {
      continue: false,
      decision: "block",
      reason: `daemon unreachable; ${FAIL_POLICY} security profile blocks tool use until the connector daemon is back`,
    };
  }
  // relaxed (default for backwards compat) — pass through.
  return { continue: true };
}

async function main(): Promise<void> {
  if (!DAEMON_URL) {
    // No daemon configured — `relaxed` lets the chat continue, `normal`
    // / `strict` block. Same fail-policy logic as a real outage.
    const r = failResponse();
    process.stdout.write(JSON.stringify(r));
    process.exit(r.continue ? 0 : 2);
  }
  const raw = await readableStreamFromStdin();
  let payload: unknown = {};
  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { rawStdin: raw };
    }
  }
  let response: { continue: boolean; decision?: string; reason?: string };
  // Cap how long we'll wait for the daemon. If the daemon hangs (mid-
  // restart, queue stuck, slow disk) the operator-side timeout in the
  // approval queue is 60s — but the hook itself can't afford to hang
  // claude that long. After this timeout we apply the fail-policy.
  // The number is intentionally larger than the queue's default-deny so
  // the operator's "deny by timeout" still wins over our fail-open.
  const FETCH_TIMEOUT_MS = Number(process.env.CR_PRETOOLUSE_TIMEOUT_MS ?? 65_000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (DAEMON_TOKEN) headers.authorization = `Bearer ${DAEMON_TOKEN}`;
    const res = await fetch(`${DAEMON_URL.replace(/\/+$/, "")}/hooks/pretooluse`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Daemon refused for some reason (auth gate, route missing, etc.).
      // Apply the fail policy.
      const r = failResponse();
      process.stdout.write(JSON.stringify(r));
      process.exit(r.continue ? 0 : 2);
    }
    response = (await res.json()) as typeof response;
  } catch {
    const r = failResponse();
    process.stdout.write(JSON.stringify(r));
    process.exit(r.continue ? 0 : 2);
  }
  process.stdout.write(JSON.stringify(response));
  // Exit code 2 is the legacy "blocked" signal claude CLI honors even
  // when the JSON parse fails. Belt + suspenders.
  process.exit(response.continue ? 0 : 2);
}

await main();
