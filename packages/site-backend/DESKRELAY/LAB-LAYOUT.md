# LAB-LAYOUT.md

## Purpose

This file declares which channel (board / refs / runtime / sample-project) each lab artifact belongs to. The manager edits board-channel files directly (bookkeeping); workers author refs-channel files; the runtime/ subtree holds round-scoped artifacts; sample-project (game/) holds the validation vehicle. PROTOCOL.md ## Manager Boundary references this catalog as the authoritative write-channel separation contract. Physical relocation into board/ and refs/ subdirectories is a deferred P3 task; this round only establishes the conceptual mapping.

## Categories

- board/ (manager write channel): manager-only bookkeeping; TASKS.md / FAILURES.md / STATE.md / REVIEW.md / QUALITY-STANDARDS.md / ARTIFACTS.md / SPEC-* round manifests
- refs/ (worker write channel): worker-authored reference docs; ORCHESTRATION.md / AGENTS.md / PROTOCOL.md / ARCHITECTURE.md / VERIFICATION.md / CRITIQUE.md / RECORDS.md / INCORPORATION.md / DIAGNOSTICS.md / UPTIME-PROBE.md / REVIEWER-NOTES.md / WORKER-CONTRACT.md / SPEC-SCHEMA.md / LAB-LAYOUT.md / LOCKS.md / evaluate-spec.ps1 / regenerate-views.ps1 / invoke-adapter.ps1 (scripts share the refs channel for now)
- runtime/: lab/runtime/<round_id>/ tree; spec.json, manifest.json, pre-snapshot.json, audit.log, verify.json, dispatch-result.json
- sample-project: lab/game/ subtree; validation vehicle only, not framework artifact

## Catalog

| filename | channel | manager_direct_edits_allowed | notes |
| --- | --- | --- | --- |
| TASKS.md | board | yes | round queue and worker assignment ledger |
| FAILURES.md | board | yes | failed worker outcomes and root-cause notes |
| STATE.md | board | yes | current-round status snapshot |
| REVIEW.md | board | yes | reviewer verdicts per round |
| QUALITY-STANDARDS.md | board | yes | acceptance bars referenced by verifier |
| ARTIFACTS.md | board | yes | published artifacts index |
| ORCHESTRATION.md | refs | no (bookkeeping fallback) | manager loop, dispatch protocol, pre-G-C edits exist |
| AGENTS.md | refs | no (bookkeeping fallback) | agent roster and role contracts |
| PROTOCOL.md | refs | no (bookkeeping fallback) | round protocol and manager boundary |
| ARCHITECTURE.md | refs | no (bookkeeping fallback) | system architecture reference |
| VERIFICATION.md | refs | no (bookkeeping fallback) | verifier rule set V01..Vnn |
| CRITIQUE.md | refs | no | critic-authored review of rounds |
| RECORDS.md | refs | no | append-only round records by worker |
| INCORPORATION.md | refs | no (bookkeeping fallback) | how rounds fold into framework |
| DIAGNOSTICS.md | refs | no | diagnostic playbooks |
| UPTIME-PROBE.md | refs | no | uptime probe spec |
| REVIEWER-NOTES.md | refs | no | reviewer scratchpad and rubric |
| WORKER-CONTRACT.md | refs | no | worker invariants and allowed_paths discipline |
| SPEC-SCHEMA.md | refs | no | spec.json schema definition |
| LOCKS.md | refs | no (bookkeeping fallback) | lock registry and conflict policy |
| LAB-LAYOUT.md | refs | no | this file; write-channel catalog |
| PROJECT.md | refs | no (bookkeeping fallback) | project overview and entry point |
| evaluate-spec.ps1 | refs | no | spec.json evaluator script |
| regenerate-views.ps1 | refs | no | derived-view regeneration script |
| invoke-adapter.ps1 | refs | no | dispatch adapter (R8 G-B); future allowed_paths enforcer |
| runtime/<round_id>/spec.json | runtime | no | round assignment manifest, write-once at round open |
| runtime/<round_id>/manifest.json | runtime | no | round file manifest |
| runtime/<round_id>/pre-snapshot.json | runtime | no | pre-dispatch hash snapshot |
| runtime/<round_id>/audit.log | runtime | append-only | per-round audit trail |
| runtime/<round_id>/verify.json | runtime | no | verifier output |
| runtime/<round_id>/dispatch-result.json | runtime | no | dispatch adapter result |
| runtime/<round_id>/round-create-result.json | runtime | no | round-open bookkeeping result |
| game/ | sample-project | no | validation vehicle (index.html and assets); not a framework artifact |

## Boundary Enforcement

- The manager appends rows to board-channel files only. Edits to refs-channel files by the manager are exceptional and accounted for via the manager_direct_edits budget in spec.json (default cap 5 per round).
- Workers receive allowed_paths in their spec.json assignment; a worker writing outside its allowed_paths is an allowed_paths_violation (see WORKER-CONTRACT.md ## Invariants).
- invoke-adapter.ps1 (R8 G-B) will be extended in a future round to actively reject worker writes outside allowed_paths; currently enforcement is post-hoc via hash-diff plus V08/V09 in VERIFICATION.md.
- runtime/<round_id>/ is write-once at round open and otherwise append-only for audit.log; closed rounds retain their directories for retroactive audit and are never rewritten by later rounds.

## Migration Plan

Physical move of files into lab/board/ and lab/refs/ subdirectories is intentionally deferred. The risks are reference-path breakage across every doc that points at top-level filenames, and in-flight worker prompt assumptions about top-level paths baked into spec.json templates. A future round (proposed: R12+) will perform the migration with a single worker that updates every internal reference in one atomic dispatch, after a snapshot freeze of inbound prompts. Until then, channel membership is policy-only and is enforced by reviewer judgement against this catalog.

## Defeaters

- categorisation may evolve as new file types are introduced; this catalog must be re-validated at the start of any round that adds a top-level artifact.
- manager_direct_edits_allowed=no for refs is policy-only until invoke-adapter actively enforces it pre-write; current "no (bookkeeping fallback)" rows reflect historical manager edits during pre-G-C rounds that should taper to zero.
- runtime/ retention has no archival policy yet (P3); unbounded growth will eventually require an archive-and-prune routine, and audit reproducibility depends on retention until then.
- the refs channel currently mixes documentation and executable PowerShell scripts; a future split (e.g. refs/docs vs refs/scripts) is plausible but out of scope here.
- LAB-LAYOUT.md itself lives in the refs channel, so any future edits to it follow worker-write discipline (no manager direct edits beyond the bookkeeping-fallback budget).

WORKER_DONE
C:\Users\darkh\Projects\orchestration-lab\LAB-LAYOUT.md
