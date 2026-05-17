## Purpose

This file lists named, idempotent, side-effect-free PowerShell snippets the manager runs after dispatch to verify worker outputs independently of worker self-reports. Each snippet is read-only, takes declared input variables, and returns observable output the manager can match against a stated pass condition.

## Rule Library

These rules are the canonical inputs to evaluate-spec.ps1. A round's spec.json declared_checks[] entries reference rules by rule.id; the evaluator dispatches each entry to the matching rule handler. The PowerShell snippets below are preserved from the prior V01..V09 catalog and remain useful as reference documentation of each rule's intended behavior; the authoritative implementation lives in the evaluator.

### exact-file-set-check (was V01)
- rule_id: exact-file-set-check
- parameters: { "LabPath": "<dir>", "Expected": ["file1", "file2", "..."] }
- pass condition: the directory contains exactly the declared expected file names, with no missing and no extra entries.
- Reference snippet:
```powershell
$actual = Get-ChildItem -Force -File -Path $LabPath | Select-Object -ExpandProperty Name | Sort-Object
$expected = $Expected | Sort-Object
$missing = $expected | Where-Object { $actual -notcontains $_ }
$extra   = $actual   | Where-Object { $expected -notcontains $_ }
[pscustomobject]@{ Missing = $missing; Extra = $extra; Match = (-not $missing -and -not $extra) }
```

### select-string-presence (was V02)
- rule_id: select-string-presence
- parameters: { "Files": ["path1", "path2", "..."], "Needles": ["literal1", "literal2", "..."] }
- pass condition: every needle in Needles appears at least once across the listed files.
- Reference snippet:
```powershell
foreach ($n in $Needles) {
  $hits = Select-String -SimpleMatch -Pattern $n -Path $Files -ErrorAction SilentlyContinue
  [pscustomobject]@{ Needle = $n; Hits = ($hits | Measure-Object).Count; Pass = [bool]$hits }
}
```

### forbidden-string-absence (was V03)
- rule_id: forbidden-string-absence
- parameters: { "Files": ["path1", "path2", "..."], "Forbidden": ["literal1", "literal2", "..."] }
- pass condition: none of the forbidden literals appears in any of the listed files.
- Reference snippet:
```powershell
foreach ($f in $Forbidden) {
  $hits = Select-String -SimpleMatch -Pattern $f -Path $Files -ErrorAction SilentlyContinue
  [pscustomobject]@{ Forbidden = $f; Hits = ($hits | Measure-Object).Count; Pass = -not [bool]$hits }
}
```

### markdown-table-header (was V04)
- rule_id: markdown-table-header
- parameters: { "File": "<path>", "Header": "| Col A | Col B |" }
- pass condition: the exact pipe-delimited header line is present in the file at least once.
- Reference snippet:
```powershell
$hit = Select-String -SimpleMatch -Pattern $Header -Path $File -ErrorAction SilentlyContinue
[pscustomobject]@{ Header = $Header; Hits = ($hit | Measure-Object).Count; Pass = [bool]$hit }
```

### hash-diff-set (was V05, renamed from "drift")
- rule_id: hash-diff-set
- parameters: { "Before": { "<name>": "<sha256>" }, "After": { "<name>": "<sha256>" } }
- pass condition: the classified Added, Removed, and Changed sets match the round's declared expected drift (commonly all empty for read-only rounds).
- Reference snippet:
```powershell
$beforeNames = @($Before.Keys)
$afterNames  = @($After.Keys)
$added     = $afterNames  | Where-Object { $beforeNames -notcontains $_ }
$removed   = $beforeNames | Where-Object { $afterNames  -notcontains $_ }
$common    = $afterNames  | Where-Object { $beforeNames -contains  $_ }
$changed   = $common | Where-Object { $Before[$_] -ne $After[$_] }
$unchanged = $common | Where-Object { $Before[$_] -eq $After[$_] }
[pscustomobject]@{ Added = $added; Removed = $removed; Changed = $changed; Unchanged = $unchanged }
```

### line-cap (was V06)
- rule_id: line-cap
- parameters: { "File": "<path>", "Max": <integer> }
- pass condition: the file's line count is less than or equal to Max.
- Reference snippet:
```powershell
$count = (Get-Content -LiteralPath $File).Count
[pscustomobject]@{ File = $File; Lines = $count; Max = $Max; Pass = ($count -le $Max) }
```

### preserved-headings (was V07, renamed from "heading order")
- rule_id: preserved-headings
- parameters: { "File": "<path>", "ExpectedOrder": ["## A", "## B", "..."] }
- pass condition: the H2 headings in the file equal ExpectedOrder positionally and in count.
- Reference snippet:
```powershell
$actual = Get-Content -LiteralPath $File | Where-Object { $_ -match '^## ' }
$expected = $ExpectedOrder
$len = [Math]::Min($actual.Count, $expected.Count)
$mismatch = 0..($len-1) | Where-Object { $actual[$_] -ne $expected[$_] }
[pscustomobject]@{
  Actual = $actual
  Expected = $expected
  Pass = (($actual.Count -eq $expected.Count) -and (-not $mismatch))
}
```

### v08-equivalent (was V08, no-unexpected-files)
- rule_id: v08-equivalent
- parameters: { "LabPath": "<dir>", "PreSnapshotPath": "<path>", "ExpectedAdds": ["file1", "..."] }
- pass condition: every file currently in LabPath was either present in the pre-snapshot or is in ExpectedAdds; anything else is an F7-class allowed_paths violation.
- Reference snippet:
```powershell
$pre = Get-Content -Raw -Encoding UTF8 $PreSnapshotPath | ConvertFrom-Json
$preNames = @($pre | ForEach-Object { $_.Name })
$cur = Get-ChildItem -Force -File -Path $LabPath | ForEach-Object { $_.Name }
$unexpected = @($cur | Where-Object { ($_ -notin $preNames) -and ($_ -notin $ExpectedAdds) })
if ($unexpected.Count -eq 0) { "V08 PASS" } else { "V08 FAIL: " + ($unexpected -join ', ') }
```

### subdir-add (was V09)
- rule_id: subdir-add
- parameters: { "LabPath": "<dir>", "PreSnapshotPath": "<path>", "ExpectedNewDirs": ["sub1", "..."], "ExpectedSubdirFiles": { "sub1": ["fileA", "fileB"] } }
- pass condition: every new subdirectory under LabPath is in ExpectedNewDirs, each declared subdir exists, and the files inside each subdir are within the allow-list ExpectedSubdirFiles entry.
- Reference snippet:
```powershell
$pre = Get-Content -Raw -Encoding UTF8 $PreSnapshotPath | ConvertFrom-Json
$preNames = @($pre | ForEach-Object { $_.Name })
$curDirs = Get-ChildItem -Force -Directory -Path $LabPath | ForEach-Object { $_.Name }
$unexpectedDirs = @($curDirs | Where-Object { ($_ -notin $preNames) -and ($_ -notin $ExpectedNewDirs) })
if ($unexpectedDirs.Count -gt 0) { "V09 FAIL: unexpected subdirs " + ($unexpectedDirs -join ', '); return }
foreach ($d in $ExpectedNewDirs) {
  $dirPath = Join-Path $LabPath $d
  if (-not (Test-Path $dirPath)) { "V09 FAIL: declared subdir missing: $d"; return }
  $files = Get-ChildItem -Force -File -Path $dirPath | ForEach-Object { $_.Name }
  $allowed = $ExpectedSubdirFiles[$d]
  $stray = @($files | Where-Object { $_ -notin $allowed })
  if ($stray.Count -gt 0) { "V09 FAIL: stray files in $d : " + ($stray -join ', '); return }
}
"V09 PASS"
```

### dry-run-integration
- rule_id: dry-run-integration
- parameters (as JSON-like): { command: string, expected_exit: number, expected_stdout_substrings: string[], expected_files: string[] }
- pass condition: run `command` in the round's workspace; pass when exit code equals `expected_exit` AND all `expected_stdout_substrings` appear in stdout AND every path in `expected_files` exists.
- intent: catch cross-worker integration failures inside the round, before the round closes. R24 incident: 4 parallel workers each thought they followed DESIGN.md; a literal `bun cli.ts sample-posts dist` invocation surfaced the interpretation drift in <5 seconds.
- powershell reference snippet:
```powershell
$out = & $bin $args 2>&1 | Out-String
if ($LASTEXITCODE -ne $expectedExit) { return "FAIL: exit $LASTEXITCODE" }
foreach ($s in $expectedSubstrings) { if (-not ($out -match [regex]::Escape($s))) { return "FAIL: missing '$s'" } }
foreach ($f in $expectedFiles) { if (-not (Test-Path $f)) { return "FAIL: file missing $f" } }
"PASS"
```

### canonical-example-presence
- rule_id: canonical-example-presence
- parameters: { require_when: "assignments_gt_1_and_prose_format" }
- pass condition: the round's spec.json contains `canonical_examples` array with at least 1 entry whenever the condition fires.
- intent: cheap pre-dispatch gate. R24 finding showed prose-only specs corrupt parallel work; this rule forces literal examples whenever the dispatch is parallel.
- evaluator integration: this rule runs at spec.json load time, BEFORE any worker dispatches. Failure aborts dispatch.

### runtime-smoke
- rule_id: runtime-smoke
- parameters: { "Command": "<string>", "ExpectedExit": <int>, "ExpectedStdoutSubstrings": ["literal1", "literal2", "..."], "ExpectedFiles": ["path1", "path2", "..."], "HeadlessBrowserShim": "<optional path>" }
- pass condition: run `Command` in the round's workspace; pass when exit code equals `ExpectedExit` AND every literal in `ExpectedStdoutSubstrings` appears in captured stdout AND every path in `ExpectedFiles` exists after the run.
- intent: drive the round's deliverable end-to-end, the way a real user would. Static checks (line-cap, preserved-headings, hash-diff-set, bun build exit) verify structure; this rule verifies behaviour. R30 incident: Tetris arcade passed every static check, shipped with index.html pointing at ./main.js while build wrote ./build/main.js, the page was dead on first open — only "open the page" catches this class.
- powershell reference snippet:
```powershell
$out = & cmd /c $Command 2>&1 | Out-String
$code = $LASTEXITCODE
$ok = ($code -eq $ExpectedExit)
foreach ($s in $ExpectedStdoutSubstrings) { if (-not ($out -like "*$s*")) { $ok = $false } }
foreach ($f in $ExpectedFiles) { if (-not (Test-Path $f)) { $ok = $false } }
[pscustomobject]@{ Command = $Command; Exit = $code; Pass = $ok }
```
- Anti-patterns (introduced by F-R34-1 + F-R34-2; round_open evaluator rejects any shim exhibiting these):
  - shim-self-output: the shim's source contains `process.stdout.write(<literal>)` or `console.log(<literal>)` where `<literal>` equals any entry in `expected_stdout_substrings`. The assertion is then circular: the shim writes the substring it then asserts the bundle emitted. F-R34-1 incident: the pikachu-volleyball Stage 3 shim contained `if (!stdoutText.includes('title screen rendered')) process.stdout.write('title screen rendered\n')`, and the runtime-smoke rule reported PASS while the real browser showed a blank page.
  - mocked-DOM-evaluation: the shim uses `vm.runInContext`, `eval`, `new Function`, or a hand-rolled document/canvas/window mock to evaluate the bundled JS in Node, instead of loading the real index.html in a real browser engine. This bypasses script-loading semantics (file:// + `<script type="module">` CORS, ES module resolution, defer order) and the input pipeline, so it cannot certify what the user sees. F-R34-1 root cause.

### path-consistency
- rule_id: path-consistency
- parameters: { "HtmlFiles": ["index.html", "..."], "BuildOutputDir": "<optional path>", "ExpectedScriptPattern": "<optional regex>" }
- pass condition: for every HTML file in `HtmlFiles`, parse `<script src="...">` references; resolve each relative path against the HTML file's own directory (or against `BuildOutputDir` if specified); every resolved path MUST exist on disk.
- intent: cheap pre-runtime catch for the R30 incident class — HTML referring to a script path that does not match the actual build output location. Surfaces the path mismatch before the user ever opens the page, without needing a full browser shim.
- powershell reference snippet:
```powershell
foreach ($html in $HtmlFiles) {
  $dir = Split-Path -Parent $html
  $text = Get-Content -Raw -LiteralPath $html
  $matches = [regex]::Matches($text, '<script[^>]*src="([^"]+)"')
  foreach ($m in $matches) {
    $src = $m.Groups[1].Value
    $candidate = if ($BuildOutputDir) { Join-Path $BuildOutputDir (Split-Path -Leaf $src) } else { Join-Path $dir $src }
    if (-not (Test-Path $candidate)) { return "path-consistency FAIL: $html -> $src" }
  }
}
"path-consistency PASS"
```

### runtime-interaction-smoke
- rule_id: runtime-interaction-smoke
- parameters: { "Command": "<string>", "Interactions": [ { "key": "<KeyboardEvent.code>", "hold_ms": <int>, "assert_state_predicate": "<JS expression against page window>" } ], "AssertionTimeoutMs": <int, optional, default 2000>, "RealBrowserEngine": "chromium" | "firefox" | "webkit" | "chrome-headless" }
- pass condition: launch `Command` (a Node or Bun script that controls a real browser engine via Playwright/Puppeteer/CDP); for each entry in `Interactions[]`, the shim presses the key down through the real browser keyboard API, holds for `hold_ms`, releases, then evaluates `assert_state_predicate` against the page's window object; the rule passes when the script exits 0 AND every predicate evaluates truthy within `AssertionTimeoutMs`.
- intent: catch the F-R34-2 class — a keyboard-driven artifact whose boot path renders the first frame but whose start-gate (or any other input-driven state transition) is unreachable from real user keystrokes. The Stage 3 shim for pikachu-volleyball cleared every `runtime-smoke` substring while real Space presses left the title screen frozen on `modeSelected=false`; only a rule that actually presses keys catches this. The `real_browser_required` flag and `playwright` (or equivalent CDP driver) dependency are mandatory; mocked-DOM evaluation under `vm.runInContext` is explicitly forbidden, matching the runtime-smoke Anti-patterns above.
- javascript reference snippet (Node + Playwright):
```javascript
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await page.goto(indexUrl);
await page.waitForTimeout(400);
for (const it of Interactions) {
  await page.keyboard.down(it.key);
  await page.waitForTimeout(it.hold_ms);
  await page.keyboard.up(it.key);
  await page.waitForTimeout(200);
  const ok = await page.evaluate(it.assert_state_predicate);
  if (!ok) { await browser.close(); console.error('FAIL: ' + it.key + ' -> ' + it.assert_state_predicate); process.exit(1); }
}
await browser.close();
process.exit(0);
```

### os-matrix-coverage
- rule_id: os-matrix-coverage
- parameters: { "OsMatrix": { "supported": [<os>...], "known_skips": { <os>: [<assertion_id>...] } }, "CurrentPlatform": "<linux|darwin|win32>" }
- pass condition: the current platform appears in OsMatrix.supported. Additionally, when known_skips contains entries for CurrentPlatform, the evaluator records (informational, not failing) which assertions the shim is expected to skip. A missing os_matrix on a runnable artifact whose shim source contains POSIX-signal patterns (`process.on('SIG`, `kill('SIG`) emits a `layer=workspace` warning rather than a hard fail (so pre-R42 specs are not retroactively broken).
- intent: F-R41-1 (R41 memo-service smoke) wasted ~10 seconds of run time + 1 manager direct edit because the shim asserted the `graceful shutdown complete` marker unconditionally while Bun on Windows does not deliver POSIX SIGINT to child processes. Declaring the win32 skip up front in the spec lets the shim gate the assertion on process.platform without surprise patches at round close.
- powershell reference snippet:
```powershell
$current = [string]$CurrentPlatform
$supported = @($OsMatrix.supported)
if ($supported -notcontains $current) {
  return [pscustomobject]@{ Pass = $false; Reason = "current_platform '$current' not in supported '$($supported -join "/")'" }
}
$skips = @()
if ($OsMatrix.known_skips -and $OsMatrix.known_skips.PSObject.Properties.Name -contains $current) {
  $skips = @($OsMatrix.known_skips.$current)
}
[pscustomobject]@{ Pass = $true; CurrentPlatform = $current; KnownSkips = $skips }
```

### export-contract-match
- rule_id: export-contract-match
- parameters: { "ModuleExportContract": [ { "module": "<filename>.ts", "exports": ["sym1","sym2",...] }, ... ], "WorkerPromptPaths": ["<.tmp-prompt-1.txt>", ...] }
- pass condition: for each worker prompt file in WorkerPromptPaths, scan the prompt text for TypeScript named imports (regex `import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]\.\/([^'"]+)['"]`); each captured `{ symbols }` from `./module` must satisfy `ModuleExportContract.find(m => m.module === module + '.ts').exports` contains every symbol. Fail with `unsatisfied_imports[]` listing offenders.
- intent: catch F-R47-1 incident class pre-dispatch (validate-spec) AND at round close (evaluate-spec). The R47 architect predicted "import name drift" in defeater_fields but the drift still happened (implementer-stages imported `writeAtomic` while implementer-fs exported only `writeCheckpoint`). Declarative enumeration + automated cross-check eliminates the gap.
- powershell reference snippet:
```powershell
$unsatisfied = @()
foreach ($promptPath in $WorkerPromptPaths) {
  if (-not (Test-Path -LiteralPath $promptPath)) { continue }
  $text = Get-Content -Raw -Path $promptPath -Encoding UTF8
  $matches = [regex]::Matches($text, "import\s*\{\s*([^}]+)\s*\}\s*from\s*['""]\.\/([^'""]+)['""]")
  foreach ($m in $matches) {
    $syms = $m.Groups[1].Value.Split(',') | ForEach-Object { $_.Trim() -replace '\s+as\s+\w+','' } | Where-Object { $_ }
    $mod = ($m.Groups[2].Value -replace '\.tsx?$','') + '.ts'
    $entry = $ModuleExportContract | Where-Object { $_.module -eq $mod } | Select-Object -First 1
    if (-not $entry) {
      $unsatisfied += @{ prompt=$promptPath; module=$mod; missing=$syms; reason='module-not-in-contract' }
      continue
    }
    $missing = @($syms | Where-Object { $entry.exports -notcontains $_ })
    if ($missing.Count -gt 0) {
      $unsatisfied += @{ prompt=$promptPath; module=$mod; missing=$missing; reason='symbols-not-declared' }
    }
  }
}
[pscustomobject]@{ Pass = ($unsatisfied.Count -eq 0); UnsatisfiedImports = $unsatisfied }
```

## Evaluator Integration

The evaluator (evaluate-spec.ps1) loads the round's spec.json, iterates declared_checks[], and dispatches each entry to the rule handler matching its rule_id, binding the entry's parameters as inputs. Each handler returns a pass/fail observation; the evaluator aggregates them and writes verify.json for the round. The rule library above is documentation of behavior, not the implementation: the snippets explain what each rule_id observes and the pass condition it enforces, while the canonical logic lives inside evaluate-spec.ps1 and may diverge in form (e.g., richer error reporting) as long as the observable contract per rule_id is preserved.
