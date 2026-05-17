# ARTIFACTS

## Purpose

This file is the authoritative artifact catalog for the orchestration lab. The
manager appends entries when a new artifact is introduced or its ownership /
status changes; the manager also rewrites the cross-reference tables at round
close. Workers never edit this file. Future workers and the manager consult this
catalog to answer "what is each file, who owns it, what is its current status,
and which rounds / failures touched it."

## Catalog

Categories: board (canonical orchestration board file the manager consults each
round), reference (auxiliary worker-authored document), state (manager-only
state snapshot), sample (sample-project deliverable referenced by PROJECT.md),
temp (scratch / non-persistent). Owner: "manager" for bookkeeping-only files,
otherwise the agent role that owns substantive edits. Status: active |
superseded | draft | deprecated.

| filename | category | owner | introduced_in_round | last_touched_in_round | status | depends_on | notes |
| ORCHESTRATION.md | board | architect | R1 | R6 R3' | active | PROTOCOL.md, AGENTS.md | Charter; F1 (관리자) substitution finally landed in R3. R6 R2' appended ## Round Loop Diagram; R6 R3' rewrote ## Artifacts the Manager Reads Every Round to the correct 8-file board including ARTIFACTS.md (closed X03). |
| AGENTS.md | board | architect | R1 | R6 R3' | active | PROTOCOL.md, ORCHESTRATION.md | Role definitions. R6 R3' appended ## Per-Role Definitions covering architect / protocol / verifier / critic / recorder / documenter / diagnostician plus ### forbidden_actions baseline (closed X02). |
| PROTOCOL.md | board | protocol | R1 | R6 R4' | active | LOCKS.md, FAILURES.md, F1, F3, F5, F6, F7 | R2 verbatim_strings schema, R3 관리자 substitution, R4 ## Worker Timeouts + ## UTF-8 Preamble + ## State File Schemas + ## Mandatory Fields, R5 ## Verification Expectations amend, R6 R4' rewrote ## File-Locking Convention to reference LOCKS body (closed X05). |
| TASKS.md | board | manager | R1 | R6 R4' | active | FAILURES.md, INCORPORATION.md | Append-only task queue; R6 rows include the T6.x series for the new-structured run (T6.1 R1' documenter, T6.2 temp-dir relocation, T6.3 R2' reviewer, T6.4 R3' arch-doc + protocol-orch, T6.5 R4' protocol-locks + implementer-m0). |
| STATE.md | state | manager | R1 | R6 R4' | active | PROTOCOL.md, FAILURES.md, F4, F5, F7 | Manager rewrites at every round close; current snapshot says "R6 R4' closed clean; M0 done; ~27 min uptime across R0'..R4' under the T6.2 external-temp-dir mitigation." |
| FAILURES.md | board | manager | R1 | R6 R2' | active | PROTOCOL.md | 9-column schema since R4; legend has 13 layer values including "timeout". F4.2 row added R6 R1' (second observed restart); F4.3 row added R6 R2' (third restart, pre-dispatch detected). |
| REVIEW.md | board | manager | R1 | R6 R4' | active | FAILURES.md, TASKS.md | Per-round rubric; latest row is R6 R4' (sample_project_progress = "M0 done"). |
| PROJECT.md | board | architect | R1 | R6 R4' | active | ORCHESTRATION.md | Sample-project (Reflex Tap) context. R6 R4' appended M0=done line to ## Milestones once game/index.html landed. |
| VERIFICATION.md | reference | verifier | R2 | R5 | active | PROTOCOL.md, F7 | Snippet library V01..V08; V08 (no unexpected top-level files) added in R5 to enforce the F7 lesson. R6 dispatches reuse V08 unchanged. |
| ARCHITECTURE.md | reference | architect | R2 | R6 R3' | active | PROTOCOL.md, AGENTS.md | Wiring diagram. R6 R2' appended ## System Layers Diagram (flowchart LR) + ## Round Lifecycle Diagram (sequenceDiagram); R6 R3' refreshed ## File Ownership against ARTIFACTS.md so zero "planned" markers remain (closed X01). |
| CRITIQUE.md | reference | critic | R2 | R2 | active | PROTOCOL.md, AGENTS.md, ORCHESTRATION.md | R2 critic pass, ten findings F01..F10; superseded as a live backlog by INCORPORATION.md but retained as the historical audit trail. |
| LOCKS.md | reference | protocol | R2 | R6 R4' | active | PROTOCOL.md | R6 R4' expanded from header-only skeleton to 26 lines with ## Acquire / Release Rules and ## Conflict Resolution; manager-cleared at round end once active rows appear. |
| RECORDS.md | reference | recorder | R3 | R3 | active | FAILURES.md, TASKS.md, STATE.md | Append-only chronological record; currently covers R1 + R2 entries plus failure cross-references for F1..F5. R6 backfill pending. |
| INCORPORATION.md | reference | critic | R3 | R3 | active | CRITIQUE.md, FAILURES.md, PROTOCOL.md | R3 prioritisation of CRITIQUE.md findings; P1 backlog (F02 / F05 / F10) drove R4 tasks T4.1..T4.3. P2/P3 backlog still open (REVIEWER-NOTES Open Question #5). |
| DIAGNOSTICS.md | reference | verifier | R4 | R4 | active | F4, FAILURES.md | R4 verifier-as-diagnostician report on the 13:43:00 site-server restart; attributes to candidate C2 (chronic crash + git HEAD movement). |
| UPTIME-PROBE.md | reference | recorder | R5 | R5 | active | F4, STATE.md, DIAGNOSTICS.md | T5.3 deliverable: pre-dispatch uptime probe procedure + STATE.md ## round_metadata template; cited at every R6 round-open and underpins the F4.2 / F4.3 detection trail. |
| ARTIFACTS.md | board | manager | R1 | R6 R5' | active | all lab .md files | This catalog. R6 R1' backfilled the file from the catalog index in CLAUDE-prompt context; R6 R5' rewrote the Catalog + cross-reference tables, added the ## Subdirectories section, and aligned with REVIEWER-NOTES.md. Manager-only writes. |
| REVIEWER-NOTES.md | reference | reviewer | R6 R2' | R6 R2' | active | ARTIFACTS.md, ORCHESTRATION.md, STATE.md | R6 R2' reviewer audit. Surfaced X01 (ARCHITECTURE stale - closed R3'), X02 (AGENTS missing per-role blocks - closed R3'), X03 (ORCHESTRATION vs STATE board disagreement - closed R3'), X04 (TASKS.md duplicate T5.x rows), X05 (PROTOCOL "LOCKS will be introduced" - closed R4'), X06 (STATE active_workers stale). |
| QUALITY-STANDARDS.md | reference | critic | R6 R5' | R6 R5' | active | PROTOCOL.md, REVIEW.md, CRITIQUE.md | R6 R5' quality-critic deliverable. Defines the documentation-quality bar the lab measures itself against (clarity, traceability, non-redundancy, schema discipline). Parallel-authored with this ARTIFACTS.md refresh; verification hash-diff happens after both finish. |
| game/index.html | sample | implementer | R6 R4' | R6 R4' | active | PROJECT.md | First sample-project artifact and first sub-directory artifact in the lab. Single-file reflex-tap browser game (122 lines, 4425 bytes; <!doctype html> + <canvas + </html> verbatim present); satisfies M0 milestone in PROJECT.md. |

## Round Cross-reference

Modifications below count substantive content edits (worker-authored or
manager-applied schema/bookkeeping rewrites). Routine append-only bookkeeping
to TASKS.md / FAILURES.md / REVIEW.md / STATE.md happens every round and is
listed when the round materially changed the file's content.

| round | artifacts_introduced | artifacts_modified | artifacts_removed |
| R1 | ORCHESTRATION.md, AGENTS.md, PROTOCOL.md, TASKS.md, STATE.md, FAILURES.md, REVIEW.md, PROJECT.md, ARTIFACTS.md | - | - |
| R2 | VERIFICATION.md, ARCHITECTURE.md, CRITIQUE.md, LOCKS.md | PROTOCOL.md, STATE.md, FAILURES.md, TASKS.md, REVIEW.md | - |
| R3 | RECORDS.md, INCORPORATION.md | ORCHESTRATION.md, PROTOCOL.md, STATE.md, FAILURES.md, TASKS.md, REVIEW.md | - |
| R4 | DIAGNOSTICS.md | PROTOCOL.md, STATE.md, FAILURES.md, TASKS.md, REVIEW.md | .tmp-logs-server.json (F7 stray temp file cleaned by manager) |
| R5 | UPTIME-PROBE.md | PROTOCOL.md, VERIFICATION.md, TASKS.md, STATE.md | - |
| R6 R0' | - | - | - |
| R6 R1' | ARTIFACTS.md (backfill) | STATE.md, FAILURES.md (F4.2 row) | - |
| R6 R2' | REVIEWER-NOTES.md | ORCHESTRATION.md, ARCHITECTURE.md, STATE.md, FAILURES.md (F4.3 row), TASKS.md, REVIEW.md | - |
| R6 R3' | - | ARCHITECTURE.md, AGENTS.md, ORCHESTRATION.md, STATE.md, TASKS.md, REVIEW.md | - |
| R6 R4' | game/index.html | LOCKS.md, PROTOCOL.md, PROJECT.md, STATE.md, TASKS.md, REVIEW.md | - |
| R6 R5' | QUALITY-STANDARDS.md | ARTIFACTS.md, STATE.md, TASKS.md, REVIEW.md | - |

## Failure Cross-reference

Lists each failure id from FAILURES.md and the artifact filenames the failure
relates to (target files of the violation, files that captured the protocol
delta, or files that codify the mitigation).

| failure_id | artifacts_touched |
| F1 | ORCHESTRATION.md, PROTOCOL.md |
| F2 | AGENTS.md, PROTOCOL.md |
| F3 | PROTOCOL.md, STATE.md |
| F4 | STATE.md, FAILURES.md, DIAGNOSTICS.md, UPTIME-PROBE.md, PROTOCOL.md |
| F4.2 | STATE.md, FAILURES.md, UPTIME-PROBE.md |
| F4.3 | STATE.md, FAILURES.md, UPTIME-PROBE.md |
| F5 | PROTOCOL.md, STATE.md, FAILURES.md |
| F6 | PROTOCOL.md, ORCHESTRATION.md |
| F7 | PROTOCOL.md, VERIFICATION.md, DIAGNOSTICS.md, ARTIFACTS.md |

## Subdirectories

- game/ (introduced R6 R4', owner implementer) - contains:
  - game/index.html (introduced R6 R4') - M0 reflex-tap browser game; single-file HTML+JS; sample-project deliverable referenced by PROJECT.md ## Milestones.
