# PROTOCOL

The normative delegation contract. Every worker dispatched by the manager
gets a prompt conforming to this protocol; every mutation has an independent
post-check the manager runs against the filesystem.

관리자는 직접 구현하지 않는다

## Round Lifecycle

A round is keyed by `round_id`. Round-scoped state lives at
`lab/runtime/<round_id>/{spec.json, manifest.json, audit.log,
pre-snapshot.json, observed/, verify.json}` — manager manifest written
pre-dispatch, round metadata, append-only event log
(actor=manager|agent_<id>), lab top-level SHA256 snapshot at round open,
worker artifact landing zone, and the `evaluate-spec.ps1` output at close.

Idempotence: `(round_id, pre_hash)` uniquely identifies an attempt. On
manager restart, `manifest.json` is the resume reference — matching
`pre_hash` resumes from the last `audit.log` step; mismatch logs
`layer=server` and either reopens a fresh round (`retry_count<retry_cap`)
or escalates. Manager bookkeeping (STATE.md / view regen) runs AFTER worker
dispatch returns, never inside the worker's `allowed_paths` window.

Round close requires: (a) `declared_checks` all pass OR a FAILURES.md row
records the gap with `retry_count<retry_cap` and a concrete protocol_delta;
(b) `audit.log` carries a `round_close` entry; (c) `manifest.json status`
moves `opened` -> `closed`; (d) session cleanup via `sessions.deleteByCwd`
for the worker cwd (the current manager conversation is preserved by
hygiene category `current_manager`).

good example — minimal spec.json:

    {"round_id":"R15","pre_snapshot_uri":"lab/runtime/R15/pre-snapshot.json","assignments":[{"adapter":"claude-code","allowed_paths":["PROTOCOL.md"]}],"declared_checks":["V08","V09"],"violation_budget":{"manager_direct_edits_max":5}}

anti-example: same spec.json with `pre_snapshot_uri` omitted — the manager
has no rollback reference, so post-close hash-diff is impossible and the
round is unverifiable.

## Worker Prompt Schema

A worker prompt MUST carry these 8 fields, in order; missing or reordered
sections are a `layer=prompt` failure.

1. `objective` — paragraph naming round and task tag.
2. `allowed_paths` — files/globs writable; disjoint from concurrent workers unless LOCKS.md authorizes.
3. `forbidden_actions` — MUST include "no incidental temp files, debug dumps, or cache writes outside allowed_paths" (F7).
4. `expected_artifacts` — files/outputs the worker must produce.
5. `verification` — shell/PowerShell the manager runs at close.
6. `final_report` — last lines: `WORKER_DONE` then absolute paths, one per line, nothing after.
7. `verbatim_strings` — byte-exact strings the worker must reproduce in named targets; empty means no byte gate.
8. `canonical_examples` - optional list of literal artifacts (full file bodies, exact sample inputs/outputs, or byte-for-byte expected blocks) that disambiguate any prose-described format in the spec. REQUIRED whenever the round dispatches more than one worker AND the spec describes a format in prose rather than code. R24 finding: a 4-worker parallel round produced a cross-worker interpretation drift on a markdown frontmatter format because the DESIGN doc described it in prose without a literal example; both workers thought they followed the spec.

The rule: if a round has assignments.length > 1 AND any assignment's prose spec uses words like "format", "shape", "layout", "convention", a canonical_examples block MUST appear in the round's spec.json. The manager checks this at round_open and refuses to dispatch otherwise.

good example:
```
"canonical_examples": [
  {
    "name": "sample-post.md",
    "purpose": "disambiguates the markdown frontmatter format described in prose",
    "content": "# Hello World\ndate: 2026-01-15\n\nBody starts here as a normal paragraph.\n"
  }
]
```

anti-example:
```
spec describes "First line title, second line date" in prose only, no literal example. Two parallel workers interpret the blank-line norm differently. Integration test fails. R24 incident.
```

good example — 6-line prompt skeleton:

    objective: R15 PROTOCOL rewrite.
    allowed_paths: ["PROTOCOL.md"]
    forbidden_actions: ["no temp files outside allowed_paths"]
    expected_artifacts: ["PROTOCOL.md <=150 lines"]
    verification: "(Get-Content PROTOCOL.md).Count -le 150"
    verbatim_strings: ["관리자는 직접 구현하지 않는다","sessions.deleteByCwd"]

anti-example: the same prompt without `verbatim_strings` — the manager has
no byte-exact gate, so silent string drift (e.g. mojibake from a missing
UTF-8 preamble, F6) passes verification undetected.

## Verification Expectations

Filesystem inspection is canonical truth. Adapter `exit_state` and DeskRelay
task `succeeded` are advisory; only hash-diff against the round's
`pre-snapshot.json` is authoritative. `evaluate-spec.ps1 <spec_uri>` runs at
every round close and writes `verify.json`; a round closes clean only if
`verify.json.summary.fail == 0` OR FAILURES.md records the residual gap.
`LabRoot` is the relative-path resolution root for `spec.json` file fields.
A missing or skipped check is itself a `layer=verification` failure.
`WORKER_DONE` with failing declared_checks is `layer=prompt`;
`WORKER_BLOCKED` with an unchanged-filesystem hash diff is a correct refusal.

good example — passing verify.json:

    {"summary":{"pass":7,"fail":0},"checks":[{"rule_id":"V08","status":"pass"},{"rule_id":"V09","status":"pass"}]}

anti-example (R3 F6 incident): trusting the task tracker's `succeeded=true`
while the post-snapshot hash equals pre-snapshot — the worker reported done
but produced zero writes; only the filesystem hash diff caught it.

## Sandbox and Boundary

Adapter contract: `(spec.json) -> {artifacts, violations, exit_state,
audit_entries}` (full schema in WORKER-CONTRACT.md). Registered adapters:
`claude-code` (native, first-class since F2 closed at R6) and
`powershell-shim` (fallback; UTF-8 preamble per F6 mandatory whenever
non-ASCII bytes appear). Three write channels (LAB-LAYOUT.md is
authoritative): `board/` (manager-only bookkeeping), `refs/`
(worker-authored), `runtime/<round_id>/` (round-scoped append-only audit).
Manager writes only to `board/`; direct edits to `refs/` count against
`spec.json manager_direct_edits_max` (default 5). Workers write only to
their assignment's `allowed_paths` (subset of refs/ + runtime/<round_id>/).
`allowed_paths_violation` is post-hoc detected via hash-diff plus V08 (no
stray files) and V09 (no path overrun).

good example: assignment `allowed_paths:["FOO.md"]` whose worker writes
only FOO.md — V08 and V09 both pass.

anti-example (F7 incident): same assignment also writes `.tmp-foo.json`
alongside FOO.md. V08 catches the stray file by hash-diff and emits a
`layer=protocol` violation even though the worker's narrative claimed success.

## Runtime Verification Mandate

Every round whose deliverable is a runnable artifact MUST declare a
`runtime_verification` step in spec.json that EXECUTES the artifact
end-to-end and asserts on observed behaviour — not just static
structure. Static checks (line caps, verbatim strings, hash diffs,
bun build exit 0) are necessary but never sufficient.

A deliverable is "runnable" when any of these is true: it has a build
output a browser, CLI, or process opens (index.html, main.js, .exe,
.ps1, a server entry); it is a script the user is expected to invoke;
or a prior round produced a smoke harness for it. The
`runtime_verification` step MUST drive the artifact the way the end
user would (open index.html in a headless browser shim, invoke the
CLI exactly as the README documents, run the script and assert on
exit code AND declared side effects). It MUST NOT re-run the worker's
own self-tests; it MUST cross the boundary from "static structure" to
"observed behaviour at runtime".

good example — spec.json fragment for a tetris-like deliverable:

    "runtime_verification": {
      "command": "node browser-shim.js index.html",
      "expected_exit": 0,
      "expected_stdout_substrings": ["canvas initialized","first piece spawned"],
      "expected_files": ["build/main.js"]
    }

anti-example (R30 incident): spec.json with declared_checks listing
only line-cap, preserved-headings, hash-diff-set, and bun build exit
on the deliverable's source files. Every check passed. index.html
pointed at `./main.js` while bun build wrote `./build/main.js`. The
page was dead on first open and only a real "open the page" step
would have caught it — which is exactly what this rule mandates.

When the deliverable is "keyboard-driven" — accepts user input through `window`
`keydown`/`keyup` events, canvas focus, or pointer events that translate to a
game-state mutation — the `runtime_verification` block MUST declare at least
one `interactions` entry. An `interactions` entry is the triple `{ key,
hold_ms, assert_state_predicate }`: the shim drives `key` down through a
real browser engine, holds it for `hold_ms`, then evaluates
`assert_state_predicate` against window-exposed game state. A
runtime_verification with no `interactions` for a keyboard-driven artifact
is a `layer=verification` failure at round close.

The shim MUST use a real browser engine. Acceptable values for
`runtime_verification.command` are: a `chrome.exe --headless=new` invocation
producing a screenshot or DevTools-Protocol session; a `node` script
importing `playwright` or `puppeteer`; a `bun` script with the same. The
shim MUST NOT use `vm.runInContext` (or `eval`, or `new Function`) to
evaluate the bundled JS against hand-mocked `document`/`canvas`/`window`
objects. Mocked-DOM evaluation bypasses script-loading semantics (file://
+ `<script type="module">` CORS, ES module resolution, defer order) and
the real browser's input pipeline, so it cannot certify what a user sees.
This is the F-R34-1 root cause: a `vm.runInContext` shim reported PASS
while the user saw a blank page because file:// blocked the module script.

The shim is FORBIDDEN from writing to its own stdout any substring it
asserts the bundled artifact emitted. The pattern
`if (!stdout.includes(needle)) process.stdout.write(needle + '\n')`
inverts the assertion: the substring appears in the final stdout because
the shim itself put it there, not because the bundle did. Future shims
that exhibit this self-output pattern MUST be rejected by the round_open
gate via a static scan against the shim source. `forbid_shim_self_output:
true` becomes the default for every `runtime_verification` block from
R35 onward.

good example — runtime_verification with interactions:

    "runtime_verification": {
      "command": "node smoke.mjs",
      "expected_exit": 0,
      "expected_stdout_substrings": ["canvas initialized","rally started"],
      "expected_files": ["main.js"],
      "real_browser_required": true,
      "forbid_shim_self_output": true,
      "interactions": [
        { "key": "Space", "hold_ms": 120, "assert_state_predicate": "state.phase === 'rally'" }
      ]
    }

anti-example (F-R34-1 + F-R34-2 combined incident): the shim was a Node
script using `vm.runInContext` to evaluate `main.js` against a
hand-rolled `document`/`window`/`requestAnimationFrame` mock. It never
loaded `index.html` through a browser, so the file:// + `<script
type="module">` CORS block was invisible; it never simulated any key
press, so the `modeSelected` start-gate defect was invisible; and it
printed the three expected substrings to its own stdout when the bundle
did not, so even the boot-time assertions were satisfied by the shim's
own output rather than the artifact's. Two consecutive user-facing
breakages followed.

When the deliverable depends on operating-system-specific behaviour — POSIX
signals (SIGINT/SIGTERM/SIGHUP), POSIX permissions, fork/exec lifecycle,
filesystem case-sensitivity — the `runtime_verification` block MUST declare
an `os_matrix` sub-key naming the OSes the verifier is expected to pass on
and any known per-OS skips. The shim MUST gate OS-divergent assertions on
`process.platform` rather than asserting unconditionally. A shim that
unconditionally asserts an OS-divergent marker is a `layer=workspace`
failure on the OSes where the marker does not appear.

F-R41-1 (R41 memo-service): the smoke shim sent `proc.kill('SIGINT')` to
the child Bun process and asserted the child emitted
`graceful shutdown complete` within 5 seconds. On POSIX (Linux, macOS),
Bun delivers the signal and the child's `process.on('SIGINT', ...)`
handler fires. On Windows, `Bun.spawn(...).kill('SIGINT')` does NOT
propagate the signal to the child the way POSIX does, so the child stays
alive until force-killed. State persistence still worked because
`store.saveStore` is atomic-on-every-mutation, but the marker assertion
failed under Windows. The fix gates the marker assertion on
`process.platform !== 'win32'` and falls back to SIGKILL on Windows; state
persistence is verified through the restart-survival assertion, which is
OS-independent.

good example — runtime_verification with os_matrix:

    "runtime_verification": {
      "command": "bun smoke.mjs",
      "expected_exit": 0,
      "expected_stdout_substrings": ["server listening", "state persisted"],
      "expected_files": ["data/memos.json"],
      "real_browser_required": false,
      "os_matrix": {
        "supported": ["linux", "darwin", "win32"],
        "known_skips": { "win32": ["graceful_shutdown_complete_marker_assertion"] }
      }
    }

anti-example (F-R41-1 incident): the same runtime_verification with NO
`os_matrix` and `expected_stdout_substrings` including
`graceful shutdown complete`. The shim asserted the marker
unconditionally; Windows users saw a hard FAIL on a feature (state
persistence) that actually worked correctly. The cost was a manager
direct edit to patch the shim mid-round. With os_matrix declared up
front, the shim would skip the marker assertion on win32 by spec, the
round_close evaluator would not penalise the divergence, and the shim
remains forensically transparent (it does not lie about the marker —
it explicitly skips it on the declared-incompatible OS).

## Shim Authorship Independence

A round whose deliverable is runnable carries two distinct artifacts that must
not share an author: the artifact itself (the bundle, the HTML, the server
entry — owned by one or more `implementer` workers) and the
`runtime_verification` shim that drives it (a Node/Bun/Playwright script that
loads the artifact in a real browser engine, presses keys, asserts predicates
— owned by exactly one `verifier-runtime` worker, per AGENTS.md). The same
worker MUST NOT own a file from both sets in the same round.

The rationale is unstated independence: a worker that authors both its
artifact and the test of its artifact can satisfy the test by editing either
side, and a single perspective gap produces a false-positive both times. R34
demonstrated this: the shell+shim worker authored main.ts (artifact) AND
browser-shim.js (test). The shim wrote `expected_stdout_substrings` to its
own stdout when the bundle did not (F-R34-1), and it never simulated the
keyboard input pipeline that the bundle relied on (F-R34-2). Two distinct
user-facing failures rolled in the same round under one consistent
worldview.

Disjoint-paths is enforced at round_open by the evaluator. For every
assignment with role `implementer` (or any `implementer-*` variant), the
evaluator computes the union of that worker's allowed_paths. For every
assignment with role `verifier-runtime`, the evaluator computes its
allowed_paths set. If the two sets intersect — including by file globs that
resolve to the same physical path — round_open refuses to dispatch and emits
a `layer=protocol` failure row with the conflict listed.

The shim's file MUST live at a path that is impossible for the implementer
to also own. Conventional locations: `<project>/smoke.mjs`,
`<project>/runtime-test/*.mjs`, or `<project>/__shim__/*.js`. The shim's
`allowed_paths` is exclusively the shim file(s) plus optional fixture
directories (golden screenshots, recorded inputs). The shim is forbidden
from editing any source file the implementer owned, and is forbidden from
the F-R34-1 anti-patterns (self-output of expected_stdout_substrings;
vm.runInContext mocked-DOM evaluation).

good example — round assignments for a runnable browser game:

    assignments:
      - role: implementer-core,      allowed_paths: ["game/core.ts"]
      - role: implementer-renderer,  allowed_paths: ["game/renderer.ts"]
      - role: implementer-shell,     allowed_paths: ["game/main.ts","game/index.html","game/style.css"]
      - role: verifier-runtime,      allowed_paths: ["game/smoke.mjs"]

anti-example (F-R34-1 + F-R34-2 incident): one assignment carried role
implementer-shell with allowed_paths ["game/main.ts","game/index.html",
"game/style.css","game/browser-shim.js"] — the shim file slid into the
implementer's path set. The implementer authored its own test, the test
trivially passed, and two distinct user-facing breakages followed in the
same hour.

## Failure Discipline

FAILURES.md schema (append-only): `id | round | layer | summary | root_cause | protocol_delta | status | resolved_in_round | detected_by | retry_count | retry_cap`.
`status` is one of `open` | `resolved` | `deferred` | `superseded`;
transitions append a new row referencing the prior `id`, never mutate prior
rows. Retry budget: default `retry_cap=3`; exceeding without resolution
escalates to the user. Layer legend (13 values): server, connector, daemon,
Claude CLI, worker CLI, workspace, permission, network, repository,
protocol, prompt, verification, timeout.

good example: a row whose `protocol_delta` reads "R12 task PROTOCOL-12 adds
sessions.deleteByCwd to round_close checklist" — names a concrete next-round
task with an owner and an actionable verb.

anti-example (F-R11 lesson): a row whose `protocol_delta` is "TBD" or "fix
later" — counts as open without a plan, blocks round close, and silently
ages out of any retry budget.

## State File Schemas

Facts and views are physically separated. Sources (append-only,
manager-written): FAILURES.md, TASKS.md, REVIEW.md, plus per-round
`audit.log`. Views (computed by `regenerate-views.ps1`, not hand-edited):
STATE.md, ARTIFACTS.md. Regenerating views twice must produce zero diff; a
non-empty diff is a `layer=verification` failure. STATE.md MUST carry
`## current_round_metadata` populated from `manifest.json`, with `in_flight_round`, `prev_build`, `prev_started_at`, `pre_hash`, `manager_session_id`, `dispatch_intent_hash`, `manager_direct_edits_count`.

good example — current_round_metadata block:

    ## current_round_metadata
    in_flight_round: R15
    prev_build: 2026-05-14T09:12:00Z
    prev_started_at: 2026-05-14T09:14:30Z
    pre_hash: 7f3a...c1
    manager_session_id: mgr-3f2e
    dispatch_intent_hash: 9b22...0d
    manager_direct_edits_count: 0

anti-example: STATE.md prose-narrating "round R15 happened" without
populating `in_flight_round` or `pre_hash` — the view drifts from
FAILURES.md / audit.log facts and the manager-restart resume path has
nothing to compare against.
