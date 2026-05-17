# PROMPT-TEMPLATES.md

## Purpose

This file is the versioned prompt template library. Templates are referenced by id in `spec.json assignments[i].template_id`. The renderer `render-prompt.ps1` substitutes `{{placeholders}}` to produce the final worker prompt at dispatch time. Future rounds compose dispatch prompts from these templates instead of bespoke per-round writeups.

## Placeholder Reference

- {{round_id}} — current round id (e.g. R15)
- {{role}} — assignment role
- {{objective}} — task-specific objective text supplied by delta JSON
- {{allowed_paths}} — comma-separated list from delta JSON
- {{forbidden_extras}} — task-specific forbidden actions added on top of the baseline
- {{verbatim_strings}} — newline-bulleted list from delta JSON
- {{declared_checks_summary}} — short prose describing the manager's post-task checks
- {{final_report_paths}} — newline list of paths the worker must emit after WORKER_DONE
- {{free_text_appendix}} — any task-specific instructions that do not fit other placeholders

## Templates

### architect

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: design clarity, sharp file boundaries, mandatory diagrams and worked examples; resist scope creep.

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

### protocol

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: schema correctness, normative wording, an anti-example beside every contract; the line cap is policy, not a goal.

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

### verifier

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: independent post-check by filesystem hash-diff; adapter exit_state is advisory, the hash diff is canonical.

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

### critic

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: ruthless quality assessment; reject any "good enough" that hides drift, rule erosion, or unverified self-report.

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

### recorder

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: append-only, single-source-of-fact discipline; no derived-view edits, no rewriting of prior rows, timestamps in ISO.

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

### documenter

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: reader-first explanation; one canonical phrasing per concept; cross-link rather than duplicate.

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

### implementer

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: ship the smallest correct change; no incidental refactor; honor allowed_paths to the byte.

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

### diagnostician

```
Role: {{role}} ({{round_id}}). One-shot worker. round_id={{round_id}}.
Focus: root cause over patch; classify by failure layer; every conclusion cites concrete evidence (hash, log line, byte).

Objective:
{{objective}}

Allowed paths:
{{allowed_paths}}

Forbidden actions (in addition to AGENTS.md ## Forbidden Actions Baseline):
{{forbidden_extras}}

Verbatim strings (must appear byte-for-byte after edit):
{{verbatim_strings}}

Verification the manager will run:
{{declared_checks_summary}}

{{free_text_appendix}}

Final report (LAST lines of output, no extra text after):
WORKER_DONE
{{final_report_paths}}
```

## Versioning

template_id is the role name plus an optional revision suffix (e.g. `architect.v1`). Breaking changes increment the suffix; existing rounds keep referencing their pinned version. Default if no suffix given: latest available revision for that role (the renderer falls back to the bare `### <role>` heading when no suffixed revisions exist).
