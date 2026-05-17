# R4 Diagnostician Report - DeskRelay Mid-R2 Restart

Subject: site-server restart at 2026-05-13T13:43:00 with build transition
from short commit 4d488d6 to 4d11dfe (older per git log of
C:\sourcetree\DeskRelay\deskrelay).

## Method

Called the following manager API endpoints from
C:\sourcetree\DeskRelay\deskrelay via scripts/manager-api.ts (GET only):

- /api/manager/system/summary - 200; build commit 4d11dfea4f0c (dirty),
  autostart task "DeskRelay Self Server", three running components.
- /api/self/process/status - 200; pid 12936, startedAt
  2026-05-13T13:43:00.792Z, kind site-server.
- /api/self/install/status - 200; installed=true, running=true,
  update.state succeeded changed=false.
- /api/self/install-reports - 200; two reports for remote
  DESKTOP-8GHUPS5 (2026-05-13T00:59:30Z succeeded; 2026-05-12T20:11:16Z
  failed). Neither is the local PC and neither is near 13:43.
- /api/self/update/status - 200; last update 2026-05-12T00:46:42Z
  (changed=false). Stale, predates the restart by >36 hours.
- /api/self/autostart - 200; taskName "DeskRelay Self Server".
- /api/self/logs (site-backend default), ?source=daemon,
  ?source=site-frontend - all 200.
- /api/self/logs?source=site-server - 400 "unsupported log source"
  (no parent-supervisor channel exposed).
- /api/manager/audit-log?limit=200 - 200; no update-all, repair, or
  restart task at or near 13:43:00.

## Observed Facts

- 2026-05-12T00:46:42.85Z last self-server update ran; succeeded,
  before/after fbeaefa, changed=false (/api/self/update/status).
  Stale, cannot have caused the 13:43 restart.
- 2026-05-13T13:33:32.11Z daemon exited code -1; supervisor logged
  "restarting daemon in 2 seconds" (daemon log).
- 2026-05-13T13:33:35.87Z daemon attempt=1 succeeded (daemon log).
  Normal ~3.7s supervised cycle.
- 2026-05-13T13:40:04Z manager dispatched four R2 worker tasks
  (architect, critic, protocol, verifier) under
  roundId=round_dkG6zqByDN8t7w (audit-log).
- 2026-05-13T13:41:09.22Z R2 verifier task_d6fp1h1zEbNK9C-N succeeded
  normally (audit-log; exitCode 0).
- 2026-05-13T13:41:24.93Z daemon exited code -1; supervisor logged
  "restarting daemon in 2 seconds" (daemon log).
- 2026-05-13T13:41:26.48Z site-backend exited code -1 (site-backend
  log).
- 2026-05-13T13:41:26.88Z site-frontend exited code -1 (site-frontend
  log).
- No audit-log entry and no log line in any of the three component
  channels for ~94 seconds after 13:41:26.88Z.
- 2026-05-13T13:43:00.05Z daemon attempt=1 starting (daemon log).
- 2026-05-13T13:43:00.71Z site-backend attempt=1 starting (log).
- 2026-05-13T13:43:00.79Z site-server reports startedAt; pid 12936;
  build 4d11dfea4f0c, dirty=true (/api/self/process/status).
- 2026-05-13T13:43:00.89-0.90Z three running R2 worker tasks
  (architect, critic, protocol) were marked cancelled with step
  "Task recovered after restart" detail "Recovered when server
  4d11dfea4f0c started at 2026-05-13T13:43:00.792Z" (audit-log).
  Server self-evidence that the old supervisor held a different
  build identity (the orchestrator saw 4d488d6).
- 2026-05-13T13:43:01.10Z device dev_2516c982844e87b2 (Local dev
  HOMEDEV) re-registered (system/summary).
- 2026-05-13T13:43:01.26Z site-frontend attempt=1 starting (log).
- 2026-05-13T13:44:47.98Z first new task accepted post-restart
  (audit-log).
- /api/self/autostart taskName: "DeskRelay Self Server".
- audit-log has NO update-all, repair, or restart task in
  13:30-13:50 - the 13:43 transition was not API-initiated.

## Candidate Causes

### C1. Windows scheduled task "DeskRelay Self Server" re-launched the binary against the same checkout after the old supervisor exited

- evidence-for:
  - Autostart is installed and taskName "DeskRelay Self Server" is
    confirmed.
  - All three child components exited within a 2-second window at
    13:41:24-26 with code -1 (consistent with parent supervisor
    exiting and dragging children).
  - No supervisor heartbeat for ~94s (no "restarting daemon" follow-up
    despite the log line saying it would in 2s).
  - New site-server pid 12936 begins at 13:43:00.792Z without any
    API-side update/repair task in the audit log.
- evidence-against:
  - Build commit changed from 4d488d6 to 4d11dfe; if the same
    checkout was re-launched the build hash should be unchanged
    unless someone moved HEAD between launches.
  - No second install-report or "self-server-update" log file dated
    2026-05-13T13:4x exists.
- residual-risk: if the scheduled task can be triggered while the old
  supervisor is still alive (or shortly after a crash), and the git
  working tree at C:\sourcetree\DeskRelay\deskrelay has moved between
  launches, R5 will keep seeing build identity flip without any audit
  trail.

### C2. Process crash plus Windows recovery action launched a different binary or relaunched at a moved HEAD

- evidence-for:
  - All children exited with code -1 (Windows convention for
    forcibly-terminated or unhandled-exit processes).
  - The site-backend has been exiting with code -1 every 20-60
    minutes for many hours (visible throughout 2026-05-13 in
    site-backend.log) - the supervisor is unstable.
  - build.dirty=true on the new process means the working tree has
    uncommitted edits; a `git checkout 4d11dfe` (an older commit) on
    that working tree between crashes would explain the apparent
    rollback from 4d488d6 to 4d11dfe.
- evidence-against:
  - We have no direct proof of a `git checkout` happening at 13:42:xx;
    that is inferred from the build-identity change and dirty flag.
  - The scheduled task "DeskRelay Self Server" already covers the
    autostart path; an additional Windows recovery hook would be
    duplicative.
- residual-risk: if a developer is actively rebasing or checking out
  older commits in the live server checkout, every restart will roll
  the running build identity and worker tasks dispatched mid-flight
  will be cancelled with "Task recovered after restart".

### C3. Manual operator restart from the same console (PowerShell Stop-Process / Restart-ScheduledTask / Task Manager) with no API trail

- evidence-for:
  - No matching POST in /api/manager/audit-log; manager-initiated
    restarts would appear there.
  - The exit-then-restart gap (~94s) is too long for the supervised
    auto-restart loop (which targets 2s) and matches a human
    intervention window.
  - The user is hands-on with this PC (Local dev HOMEDEV device is
    this same machine).
- evidence-against:
  - No log line marks operator action.
  - The site-backend has been crashing on its own all day, so we
    cannot exclude a crash-driven supervisor exit.
- residual-risk: human-initiated restarts during an active round can
  invalidate worker dispatch; if R5 cannot distinguish them, the
  manager will keep retrying tasks that were intentionally aborted.

### C4. Internal /api/self/update or /api/self/install repair restarted the server

- evidence-for:
  - (none observed)
- evidence-against:
  - /api/self/update/status last update 2026-05-12T00:46:42Z,
    changed=false, well before the incident.
  - install-reports list shows nothing on 2026-05-13T13:xx; reports
    are for remote DESKTOP-8GHUPS5 only.
  - No audit-log task of kind update-all, repair, or self-update at
    13:30-13:50.
- residual-risk: low; this can be effectively excluded for R5.

## Manager Recommendations

- Capture /api/self/process/status (pid, startedAt, build.commit) and
  store it in STATE.md ## active_workers metadata at round dispatch;
  diff against the same endpoint at round join - any uptime
  regression or commit change is an F-class fail and the round must
  not be marked complete.
- Before dispatching a round, also call /api/self/logs (default
  site-backend) and snapshot the last "exited with code" timestamp;
  reject dispatch if the most recent exit is newer than the previous
  round's marker (the supervisor is currently unstable and will
  re-restart mid-round).
- Treat any "task.recovered-after-restart" step in /api/manager/audit-log
  as F4 (orchestration-corruption) and trigger a forced retry of the
  affected agentIds rather than treating their cancelled state as
  worker failure.
- Pin a copy of the running build commit (short and full) in STATE.md
  metadata for every dispatched worker so the verifier can detect a
  build-identity mismatch (e.g. 4d488d6 -> 4d11dfe) without round-trip
  to the API.

## Open Questions

- The build identity flipped from 4d488d6 to 4d11dfe with dirty=true;
  did an operator run `git checkout` / `git reset` on
  C:\sourcetree\DeskRelay\deskrelay between 2026-05-13T13:41:26Z and
  2026-05-13T13:43:00Z?
- Why is the supervised site-backend exiting with code -1 every 20-60
  minutes throughout 2026-05-13 - is there a known crash bug, a
  memory pressure issue, or an external killer (AV, scheduled
  maintenance script) at play?
- Does the Windows scheduled task "DeskRelay Self Server" have a
  trigger schedule that can fire periodically (not just on logon or
  failure), and was it manually invoked from Task Scheduler near
  13:43:00?
- The audit-log surface returned no restart-related entry; is there a
  separate operator-action audit channel (e.g. CLI invocations of
  scripts/restart-self.ps1) that the manager API does not expose?
- Why does /api/self/update/status report localCommit
  3e2f1a9711c976f49916a94600f3939ddabd3e40 while the running build is
  4d11dfea4f0c - is the cached update-status stale, or is the server
  running source from a different checkout than the one git inspects?
