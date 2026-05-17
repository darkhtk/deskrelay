# QUALITY-STANDARDS

## Purpose

This file is the single source of truth for "is the orchestration framework good enough yet?". The manager runs the audit at the start of every round and continues dispatching until every gate is PASS (excluding gates explicitly marked DEFERRED with stated user-dependency). It consolidates quality gates previously scattered across ORCHESTRATION.md, REVIEW.md, PROTOCOL.md, CRITIQUE.md, INCORPORATION.md, FAILURES.md, REVIEWER-NOTES.md, and VERIFICATION.md into one canonical contract. The Korean operating principle 관리자는 직접 구현하지 않는다 (the manager does not implement directly) anchors gate G1 and remains load-bearing for every downstream gate.

## Gate Categories

- G1 Delegation
- G2 Verification
- G3 Failure Discipline
- G4 Protocol Completeness
- G5 Artifact Hygiene
- G6 Cross-Document Consistency
- G7 Resilience
- G8 Sample-Project Discipline

## Gates

### G1. Delegation

- intent: every substantive artifact in a round is produced by a worker, never authored directly by the manager.
- acceptance:
  - ORCHESTRATION.md ## Operating Principle carries the principle line byte-for-byte.
  - ORCHESTRATION.md ## What the Manager Produces Directly restricts manager output to bookkeeping deltas (TASKS / FAILURES / REVIEW / STATE).
  - REVIEW.md row for the round records delegation_used = pass.
  - Every artifact added or modified in the round has a worker_id citation either in STATE.md ## terminated_workers or in the REVIEW.md row notes.
- evidence sources: ORCHESTRATION.md, REVIEW.md ## Round Scores, STATE.md ## terminated_workers, AGENTS.md ## Manager Forbidden actions.
- pass condition: all four acceptance bullets satisfied for the most recent closed round.

### G2. Verification

- intent: each worker mutation is checked by an independent filesystem inspection; task state never overrides hash diff.
- acceptance:
  - PROTOCOL.md ## Verification Expectations declares filesystem inspection canonical truth and task state advisory.
  - VERIFICATION.md catalog defines snippets V01..V08 with pass conditions and inputs.
  - Every round records a pre-round and a post-round hash snapshot and runs at least one V0N snippet per worker assignment.
  - F5 (cancelled-task-but-files-completed) is documented in PROTOCOL.md and re-applied in REVIEW.md notes whenever it is observed.
- evidence sources: PROTOCOL.md ## Verification Expectations, VERIFICATION.md V01..V08, REVIEW.md round notes citing V08 PASS.
- pass condition: PROTOCOL.md filesystem-canonical language present AND the most recent round logged a "V08 PASS" or equivalent independent check.

### G3. Failure Discipline

- intent: every observed failure carries a layer label and a status; no failure sits open without a protocol_delta plan.
- acceptance:
  - FAILURES.md schema header is the 9-column form (id | round | layer | summary | root_cause | protocol_delta | status | resolved_in_round | detected_by).
  - Each row's layer is one of the 13 legend values (server, connector, daemon, Claude CLI, worker CLI, workspace, permission, network, repository, protocol, prompt, verification, timeout).
  - Each row's status is one of open / resolved / deferred / superseded.
  - Every row whose status is open carries a non-empty protocol_delta clause naming the change scheduled to close it.
- evidence sources: FAILURES.md schema header line, FAILURES.md rows F1..F4.3, PROTOCOL.md ## State File Schemas.
- pass condition: all four bullets satisfied for every row currently in FAILURES.md.

### G4. Protocol Completeness

- intent: PROTOCOL.md exposes the 12 H2 sections the dispatch contract depends on, so worker prompts have a stable schema to cite.
- acceptance: PROTOCOL.md contains, by exact heading text, each of: ## Worker Prompt Schema, ## Verbatim Strings, ## Mandatory Fields, ## File-Locking Convention, ## Conflict Avoidance Rules, ## Verification Expectations, ## Failure Handling, ## Final Report Format (worker side), ## English Restatement, ## Worker Timeouts, ## UTF-8 Preamble, ## State File Schemas.
- evidence sources: PROTOCOL.md H2 outline.
- pass condition: all 12 named sections present (order preserved or documented).

### G5. Artifact Hygiene

- intent: V08 ("no unexpected files") is PASS for every recent round; ARTIFACTS.md catalog covers every lab file; no orphan top-level files.
- acceptance:
  - VERIFICATION.md V08 snippet exists with its pass condition stated.
  - REVIEW.md rounds R6 R1' through R6 R4' each record V08 PASS or top-level V08 PASS in their notes.
  - ARTIFACTS.md ## Catalog has a row for every file present in the lab top level (board + reference + manager-only).
  - No .tmp-*, debug.json, or stray side-effect files at the lab top level (F7 lesson codified in AGENTS.md ## forbidden_actions baseline).
- evidence sources: VERIFICATION.md V08, REVIEW.md R6 R1'..R6 R4' notes, ARTIFACTS.md ## Catalog, AGENTS.md ## forbidden_actions baseline.
- pass condition: all four bullets satisfied at the close of the most recent round.

### G6. Cross-Document Consistency

- intent: every X-finding raised in REVIEWER-NOTES.md is resolved; ORCHESTRATION, STATE, and ARTIFACTS agree on the 8-file board.
- acceptance:
  - REVIEWER-NOTES.md X01, X02, X03, X04, X05, X06 are each closed (statement_A and statement_B reconciled in the cited files).
  - ORCHESTRATION.md ## Artifacts the Manager Reads Every Round names the same 8 files as STATE.md ## current_round narration and ARTIFACTS.md ## Catalog board entries.
  - No file appears as "planned" in ARCHITECTURE.md ## File Ownership when ARTIFACTS.md marks it active.
- evidence sources: REVIEWER-NOTES.md ## Cross-document Inconsistencies, ORCHESTRATION.md, STATE.md, ARTIFACTS.md, ARCHITECTURE.md.
- pass condition: every X-finding closed AND the three board-listing files agree on the same 8 names.

### G7. Resilience

- intent: the UPTIME-PROBE procedure exists and was exercised; manager temp lives outside the server-repo watched tree (T6.2 lesson); the framework has survived at least one F4-class restart without artifact loss.
- acceptance:
  - UPTIME-PROBE.md ## Probe Command and ## Detection Rule both present.
  - At least one round in REVIEW.md cites the probe firing (e.g. F4.2 detected at R6 R0' or F4.3 at R6 R2').
  - Manager temp directory relocated to C:\Users\darkh\Projects\.deskrelay-manager-temp\ (T6.2) and recorded in STATE.md or REVIEW.md notes.
  - Hash diff after each observed F4-class event shows no lab artifact was lost or partially written.
- evidence sources: UPTIME-PROBE.md, REVIEW.md R6 R1'..R6 R4' notes, FAILURES.md F4.2 / F4.3 rows, STATE.md ## current_round.
- pass condition: all four bullets satisfied; the F4.x rows themselves may remain open at the upstream-server layer without failing this gate.

### G8. Sample-Project Discipline

- intent: PROJECT.md is marked NOT-primary; M0 done is recorded but never promoted to a framework deliverable; a scope guard exists in the charter or rubric.
- acceptance:
  - ORCHESTRATION.md ## Non-Goals lists "Shipping the sample mini-game" verbatim.
  - PROJECT.md prose declares the sample is a validation vehicle, not the deliverable.
  - REVIEW.md ## Evaluation Criteria keeps sample_project_progress as a free-text auxiliary signal, not one of the four scored criteria.
  - M0 completion is recorded in PROJECT.md ## Milestones and REVIEW.md notes only; ORCHESTRATION.md ## Primary Goal still names the framework, not the game.
- evidence sources: ORCHESTRATION.md ## Non-Goals + ## Primary Goal, PROJECT.md ## Milestones, REVIEW.md ## Evaluation Criteria.
- pass condition: all four bullets satisfied.

## Audit Result

| gate | status | evidence | gap |
| G1 | PASS | ORCHESTRATION.md line 21 principle line present; REVIEW.md R6 R4' row scores delegation_used=pass; STATE.md ## terminated_workers and R6 R4' notes cite agent_QSktJmptPnoTpw (protocol-locks) and agent_LlaJdcBClGCOjQ (implementer-m0) as authors. | (none) |
| G2 | PASS | PROTOCOL.md ## Verification Expectations lines 60-68 declare filesystem canonical; VERIFICATION.md V01..V08 snippets defined; REVIEW.md R6 R4' notes "V08 top-level PASS". | (none) |
| G3 | PASS | FAILURES.md line 26 schema header (9 cols); rows F1..F4.3 all carry layer + status from the legend; open rows F4 / F4.2 / F4.3 / F5 each cite a protocol_delta plan (Worker Timeouts, temp-dir relocation, T5.1 amendment). | (none) |
| G4 | PASS | PROTOCOL.md H2 outline includes Worker Prompt Schema (L10), Verbatim Strings (L24), Mandatory Fields (L32), File-Locking Convention (L42), Conflict Avoidance Rules (L52), Verification Expectations (L60), Failure Handling (L70), Final Report Format (L77), English Restatement (L88), Worker Timeouts (L92), UTF-8 Preamble (L100), State File Schemas (L109). | (none) |
| G5 | PASS | VERIFICATION.md V08 lines 97-108; REVIEW.md R6 R1' / R2' / R3' / R4' each record V08 PASS; ARTIFACTS.md catalog aligned to ARCHITECTURE.md ## File Ownership after R6 R3' arch-doc refresh (zero "planned" markers post-edit). | (none) |
| G6 | FAIL | REVIEWER-NOTES.md X01 / X02 / X03 closed in R6 R3' (arch-doc + protocol-orch); X04 (TASKS.md duplicate T5.1/T5.2/T5.3 rows) and X06 (STATE.md ## active_workers parenthetical still reads "(no active workers at R4 close)" while current_round is R6 R4') remain unresolved. | A manager bookkeeping round (or recorder agent) must de-duplicate TASKS.md T5.x rows and refresh STATE.md ## active_workers / ## terminated_workers to current_round R6 R4'. |
| G7 | PASS | UPTIME-PROBE.md ## Probe Command + ## Detection Rule defined; FAILURES.md F4.2 detected pre-dispatch at R6 R0', F4.3 pre-dispatch at R6 R2'; STATE.md R6 R4' notes "0 F4 restarts during the new-structured run" under the external-temp-dir mitigation (C:\Users\darkh\Projects\.deskrelay-manager-temp\). | (none) |
| G8 | PASS | ORCHESTRATION.md ## Non-Goals line 16 names "Shipping the sample mini-game"; PROJECT.md framed as validation vehicle; REVIEW.md ## Evaluation Criteria keeps sample_project_progress as auxiliary free-text; STATE.md R6 R4' frames M0 done as "first successful code-bearing worker dispatch" (exercising the framework, not delivering the game). | (none) |

## Open Gate Plan

| gate | round_to_close | proposed_worker_role | proposed_artifact |
| G6 | R6 R5' | recorder | TASKS.md de-duplication of T5.1 / T5.2 / T5.3 (X04) and STATE.md refresh of ## active_workers + ## terminated_workers to reflect current_round R6 R4' agents agent_QSktJmptPnoTpw / agent_LlaJdcBClGCOjQ and the critic agent producing QUALITY-STANDARDS.md (X06). |

## Deferred Gates Justification

(No DEFERRED gates in this audit. F2 (worker CLI / native claude-code profile) remains deferred at the FAILURES.md row level pending user-authorized server restart; it is tracked under G3 row-level discipline and does not block any audit gate because the powershell-shim profile satisfies every functional requirement the gates check.)

WORKER_DONE
C:\Users\darkh\Projects\orchestration-lab\QUALITY-STANDARDS.md
