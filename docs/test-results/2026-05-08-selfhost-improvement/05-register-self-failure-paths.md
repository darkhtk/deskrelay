# Register Self Failure Path Result

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
| Device list HTTP failure | Stop before replacement POST | PASS |
| Device list invalid JSON | Stop before replacement POST | PASS |
| Existing duplicate row delete failure | Stop before replacement POST | PASS |
| Multiple duplicate daemon URL rows | Delete every matching row, then POST once | PASS |

## Problem Closed

Registration no longer assumes the server registry is readable and mutable. If DeskRelay cannot prove that the old duplicate rows were removed, it does not create another row.

## Still Manual

Real cross-PC registration can still fail because of network reachability, firewall policy, or login task behavior. Those remain manual acceptance items.
