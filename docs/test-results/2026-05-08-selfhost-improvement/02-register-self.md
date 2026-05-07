# Register Self Test Result

## Command

```powershell
bun --filter @deskrelay/pc-connector-daemon test self-register.test.ts
```

## Result

```text
3 pass
0 fail
12 expect() calls
```

## Cases Covered

| Case | Expected | Result |
|---|---|---|
| Normal register-self | Wildcard-bound login task env, local and advertised daemon checks, server registration | PASS |
| Stale local connector | Existing wrong-token daemon path is stopped before install | PASS |
| Same daemon URL already registered | Old device row is deleted before replacement POST | PASS |

## Problem Closed

This fixes the device duplicate policy gap for the register-self path. Re-registering the same daemon URL should not leave duplicate devices in the server registry.

## Still Manual

Actual Windows Task Scheduler creation, reboot recovery, and cross-PC network behavior remain manual acceptance items.
