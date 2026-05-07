# Register Self Test Result

## Command

```powershell
bun --filter @deskrelay/pc-connector-daemon test self-register.test.ts
```

## Result

```text
6 pass
0 fail
18 expect() calls
```

## Cases Covered

| Case | Expected | Result |
|---|---|---|
| Normal register-self | Wildcard-bound login task env, local and advertised daemon checks, server registration | PASS |
| Stale local connector | Existing wrong-token daemon path is stopped before install | PASS |
| Same daemon URL already registered once | Old device row is deleted before replacement POST | PASS |
| Same daemon URL registered multiple times | All old device rows are deleted before replacement POST | PASS |
| Device list cannot be read | Registration stops before POST | PASS |
| Device list response is invalid | Registration stops before POST | PASS |
| Old device row cannot be deleted | Registration stops before POST | PASS |

## Problem Closed

This fixes the device duplicate policy gap for the register-self path. Re-registering the same daemon URL deletes all known existing rows first, and unsafe registry states now stop before the replacement POST.

## Still Manual

Actual Windows Task Scheduler creation, reboot recovery, and cross-PC network behavior remain manual acceptance items.
