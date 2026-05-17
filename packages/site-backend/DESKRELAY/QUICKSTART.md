# QUICKSTART

Zero to a verified first round in 5 minutes. This is the front door of the framework; read it before ORCHESTRATION.md.

## Purpose

This framework supervises multiple Claude CLI workers under one manager that dispatches prompts, isolates write paths, and verifies outputs against the filesystem. The goal is to dispatch + verify without trusting worker self-reports - adapter exit codes and worker WORKER_DONE lines are advisory, hash-diff against `pre-snapshot.json` is canonical.

## Prerequisites

- DeskRelay server running (`http://127.0.0.1:18193`) - the relay that owns worker stdio + restart.
- `DESKRELAY_SITE_TOKEN` set in the shell (matches the server token).
- `bun` on PATH (manager scripts are TypeScript run via bun).
- `claude` CLI on PATH (version >= 2.1.140) - this is the worker adapter.
- Lab folder at `C:\Users\darkh\Projects\orchestration-lab` (this directory).
- Manager temp dir at `C:\Users\darkh\Projects\.deskrelay-manager-temp\` (per-round prompt files land here).

## Hello-World Round (5 minutes)

A minimal round whose only task is to create `HELLO.md` and verify it exists. Run every block from the lab root in PowerShell.

### 1. Choose a round id

Pick the next unused id under `runtime/`. The walkthrough uses `R-hello`:

```powershell
$rid = 'R-hello'
if (Test-Path "runtime/$rid") { throw "round dir already exists, pick another id" }
```

### 2. Bootstrap the round directory

Create `runtime/R-hello/` with the three resume artifacts (pre-snapshot, manifest, audit log):

```powershell
$dir = "runtime/$rid"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Get-ChildItem -File -Recurse -Path . -Exclude 'runtime','node_modules' |
  ForEach-Object { [pscustomobject]@{ path = (Resolve-Path -Relative $_.FullName); sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash } } |
  ConvertTo-Json -Depth 3 | Set-Content "$dir/pre-snapshot.json" -Encoding utf8
@{ round_id = $rid; status = 'opened'; opened_at = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content "$dir/manifest.json" -Encoding utf8
"round_open $rid $(Get-Date -Format o)" | Set-Content "$dir/audit.log" -Encoding utf8
```

### 3. Write a minimal spec.json

One assignment (verifier role writing `HELLO.md`), one declared check (the `exists` rule). Save inline:

```powershell
@'
{
  "spec_version": "0.1.0-draft",
  "round_id": "R-hello",
  "title": "Hello world round",
  "objective": "Create HELLO.md so the framework's dispatch + verify loop runs end-to-end.",
  "assignments": [
    { "role": "verifier", "adapter": "claude-code", "allowed_paths": ["HELLO.md"] }
  ],
  "declared_checks": [
    { "id": "C1", "rule": "exists", "path": "HELLO.md" }
  ],
  "violation_budget": { "manager_direct_edits_max": 0, "current": 0 }
}
'@ | Set-Content "$dir/spec.json" -Encoding utf8
```

### 4. Render the worker prompt

`render-prompt.ps1` reads the `verifier` block from `PROMPT-TEMPLATES.md` and substitutes the delta:

```powershell
.\render-prompt.ps1 -TemplateId verifier -DeltaJson '{"round_id":"R-hello","role":"verifier","objective":"Write a one-line HELLO.md so the framework dispatch+verify loop runs end-to-end.","allowed_paths":["HELLO.md"],"forbidden_extras":"none","verbatim_strings":["hello"],"declared_checks_summary":"C1 exists HELLO.md","final_report_paths":"HELLO.md","free_text_appendix":""}'
```

Output lands at `runtime/R-hello/prompts/verifier.txt` (UTF-8 no BOM).

### 5. Dispatch the worker

POST the prompt to the manager API. Build a body file then call:

```powershell
@{
  profile   = 'claude-code'
  cwd       = (Resolve-Path .).Path
  prompt    = Get-Content "$dir/prompts/verifier.txt" -Raw
  timeoutMs = 120000
} | ConvertTo-Json -Depth 5 | Set-Content "$dir/body.json" -Encoding utf8

bun run scripts/manager-api.ts POST /api/manager/workers/run --body-file "$dir/body.json"
```

The HTTP call returns the worker `round_report` (canonical) - the adapter's own exit code is advisory.

### 6. Verify

Run the declared checks. Pass means `verify.json.summary.fail == 0`:

```powershell
.\evaluate-spec.ps1 -SpecUri runtime/R-hello/spec.json -LabRoot .
Get-Content runtime/R-hello/verify.json | ConvertFrom-Json | Select-Object -ExpandProperty summary
```

If `summary.fail == 0`, mark `manifest.json status = closed`, append `round_close` to `audit.log`, and call `sessions.deleteByCwd` to retire the session jsonl.

## Where Things Live

| concern | source of truth |
| --- | --- |
| how to dispatch your first round | QUICKSTART.md (this file) |
| delegation contract + verification rules | PROTOCOL.md |
| roles, good/bad output per role | AGENTS.md |

## Next Steps

- After Hello-World succeeds, read PROTOCOL.md ## Round Lifecycle for the full contract (pre-hash idempotence, manifest states, close criteria).
- For real work, use PROMPT-TEMPLATES.md role skeletons via render-prompt.ps1 - never hand-roll prompts.
- Failures go to FAILURES.md with `layer` from the legend (PROTOCOL.md ## Failure Discipline) plus retry_count / retry_cap.

## Troubleshooting

- **HTTP timeout on dispatch** - the round is not necessarily dead. The `round_report` written by the worker into `runtime/<round_id>/` is the canonical state; re-read it before retrying. The HTTP response is advisory.
- **Worker exited with `exit code -1`** - almost always the DeskRelay server's own `/api/self/process/restart` (not a worker crash). See FAILURES.md F4: the relay spawns a detached PowerShell that calls `Stop-Process -Force`, surfacing as Windows TerminateProcess. Inspect `audit.log` for a restart line before classifying as a crash.
- **`verbatim_strings` missing in worker output** - the delta you passed to render-prompt.ps1 was wrong. Correct the delta and re-render; do not hand-edit the rendered prompt file.
- **Session jsonl piling up under DeskRelay** - round_close did not call `sessions.deleteByCwd`. Run it manually keyed on `cwd` from the dispatch body, then update the close path in your manager script.
- **`evaluate-spec.ps1` reports `fail > 0` but file looks right** - the check rule (e.g. `exists`, `select-string-presence`) compares against the round's `pre-snapshot.json`; a stale pre-snapshot from an earlier attempt will mis-classify. Rebuild step 2 with a fresh round id.

WORKER_DONE
C:\Users\darkh\Projects\orchestration-lab\QUICKSTART.md
