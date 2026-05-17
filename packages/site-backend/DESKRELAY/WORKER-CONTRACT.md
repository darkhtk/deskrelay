# WORKER-CONTRACT

## Purpose

This file is the authoritative adapter contract for the orchestration lab. The manager and every adapter implementation read it as the single source of truth for how a worker invocation is shaped, sandboxed, and reported. PROTOCOL.md ## Adapter Contract references this document by name; any divergence in a concrete adapter is a protocol violation, not a local quirk. The contract exists so that every worker invocation channel - claude-code, powershell-shim, and any future adapter - looks like the same uniform function call from the manager's perspective.

## WorkerSpec Schema

The WorkerSpec is the input every adapter receives. It is documented here in Markdown but serialized as JSON on the wire. Field semantics:

- `spec_uri` (required): absolute path to the round's `spec.json`. Must exist on disk before the adapter is invoked.
- `round_id` (required): the round identifier the worker is participating in. Used for audit correlation and for resolving the round's `audit.log`.
- `role`: the worker's role label. One of `architect`, `protocol`, `verifier`, `critic`, `recorder`, `documenter`, `implementer`, `diagnostician`. AGENTS.md governs which roles each adapter may host.
- `prompt_uri` (required): absolute path to the worker's task brief. The adapter MUST NOT mutate this file.
- `workspace` (required): absolute path the worker runs under. For the `claude-code` adapter this is the worker process cwd and MUST resolve inside the server repo per F3.
- `allowed_paths[]` (required): exclusive allow-list of files the worker may write. Anything outside this list is a sandbox violation.
- `forbidden_paths[]`: optional explicit deny-list. Overrides any incidental overlap with `allowed_paths`; if a path appears in both lists, the deny wins.
- `env_overrides`: key-value map of process environment variables to inject into the worker. Adapters MUST NOT leak ambient secrets that were not declared here.
- `encoding`: declared transport encoding for stdout/stderr/stream framing. Defaults to `utf-8`. The `powershell-shim` adapter MUST apply the F6 preamble whenever `encoding` is `utf-8`; the `claude-code` adapter handles UTF-8 natively via stream-json and needs no preamble.
- `timeout_ms`: per-invocation wall-clock cap. On expiry the adapter cancels the worker and emits `adapter_failed` with `exit_state=cancelled`.
- `retry_policy`: `{ max: int, on_layers: [worker-CLI | prompt | verification | ...] }`. Names which failure layers are retry-eligible and the cap. The adapter is responsible for honoring `max`; the manager does not retry on its behalf.

## Adapter Return Shape

Every adapter MUST produce the following return value to the manager. Missing fields are treated as a protocol violation by QUALITY-STANDARDS.md G2.

- `artifacts[]`: list of `{ path, hash_before, hash_after, write_attempts: int }`. One entry per path the adapter observed the worker touch, regardless of whether the path was in `allowed_paths`.
- `violations[]`: list of `{ type, allowed_paths_violation | forbidden_action | encoding_mismatch | other, detail }`. Empty list means the invocation was clean.
- `exit_state`: one of `succeeded`, `failed`, `blocked`, `cancelled`. Advisory only; the canonical signal for downstream consumers is the filesystem hash diff over `allowed_paths`.
- `audit_entries[]`: append-only events the adapter emitted into the round's `audit.log`. The adapter is the writer; the manager is a reader.
- `duration_ms`: wall-clock duration from `adapter_start` to terminal entry.

## Adapter Registry

Currently supported adapters:

| adapter_id      | profile      | encoding handling                       | sandbox enforcement                          | first-class since | notes                                                                       |
| claude-code     | claude-code  | native UTF-8 via stream-json            | post-hoc hash diff (no in-flight block)      | R6 (F2 resolved)  | preferred adapter; lower latency                                            |
| powershell-shim | powershell   | requires F6 preamble                    | post-hoc hash diff                           | R1 (workaround)   | retained as fallback; will deprecate when claude-code is stable across all role classes |

New adapters are added by extending this table in the same round that lands the implementation; the manager refuses to route to an `adapter_id` that is not registered here.

## Invariants

Every adapter MUST hold the following invariants on every invocation:

- `spec_uri` MUST exist before invocation; the adapter aborts immediately on missing `spec_uri` and emits `adapter_failed` with `exit_state=blocked`.
- For any path observed in `artifacts[]` whose `hash_after` differs from `hash_before` and that path is NOT in `allowed_paths`, the adapter MUST emit a `violations[]` row of `type=allowed_paths_violation`.
- The adapter MUST emit at least one `audit_entries` pair per invocation: an opening `adapter_start` and a terminal `adapter_done` or `adapter_failed`. Both entries carry the same `round_id` and a monotonically increasing sequence number.
- The adapter MUST NOT swallow worker stdout or stderr. All worker output is captured and surfaced verbatim in `audit_entries`; truncation, if any, is explicit and marked.
- Cancelled tasks whose filesystem hash diff over `allowed_paths` shows the expected artifacts present and well-formed are reclassified by the manager as `succeeded` (F5 lesson). The adapter still reports `exit_state=cancelled`; the reclassification is the manager's job, not the adapter's.

## Compliance

PROTOCOL.md ## Adapter Contract enforces compliance with this file; AGENTS.md per-role definitions name which adapters each role MAY use; QUALITY-STANDARDS.md G2 verifies that the `audit_entries` an adapter emits match the `declared_checks` field of the round's `spec.json`. An adapter that satisfies the schema and return shape but whose `audit_entries` do not cover the declared checks is non-compliant and the round fails verification.

WORKER_DONE
C:\Users\darkh\Projects\orchestration-lab\WORKER-CONTRACT.md
