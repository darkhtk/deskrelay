# Self-Host Docs Forbidden-Term Scan Result

## Command

```powershell
bun run test:selfhost-docs
```

## Result

```text
OK self-host docs forbidden-term scan passed
```

## Cases Covered

The scan checks self-host documentation surfaces for product-only deployment, payment, package, or managed relay terms.

| Surface | Result |
|---|---|
| `README.md` | PASS |
| `docs/*.md` | PASS |
| `packages/site-frontend/src/content/*.md` | PASS |

## Problem Closed

This prevents self-host documentation from drifting back into product-specific install or deployment language.
