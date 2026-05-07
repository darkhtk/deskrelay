# 개발 문서

DeskRelay를 수정하거나 테스트할 때 쓰는 최소 개발 문서다. 일반 사용자는 [README](../README.md)의 설치 절차만 따르면 된다.

## 로컬 개발 스택

격리된 로컬 스택을 실행한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-start.ps1
```

기본 포트:

```text
connector daemon: 127.0.0.1:18191
site backend:     127.0.0.1:18192
site frontend:    127.0.0.1:18193
```

중지:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-stop.ps1
```

상태 확인:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-status.ps1
```

## self-host smoke

성공 경로:

```powershell
bun run test:selfhost-virtual
```

설치 실패/등록 실패 방어:

```powershell
bun run test:selfhost-failures
```

두 smoke 모두 임시 폴더와 임시 포트를 사용한다. 기존 product/master 환경이나 실제 connector 상태를 건드리지 않는 방향으로 작성되어 있다.

## 자주 돌리는 검증

```powershell
bunx biome check package.json scripts/selfhost-virtual-e2e.ts scripts/selfhost-install-failure-smoke.ts
bun --filter @deskrelay/pc-connector-daemon test self-register.test.ts
bun --filter @deskrelay/site-backend test
bun --filter @deskrelay/pc-connector-daemon typecheck
bun --filter @deskrelay/site-backend typecheck
```

전체 확인이 필요할 때:

```powershell
bun run test
bun run typecheck
```

## 저장소 구조

```text
packages/site-frontend           Solid/Vite browser UI
packages/site-backend            Hono/Bun self-host backend
packages/pc-connector-daemon     local connector daemon
packages/behaviors/remote-claude Claude Code behavior
packages/behavior-sdk            behavior host runtime
packages/core                    broker and event primitives
packages/shared                  shared types and helpers
scripts/dev-local-*.ps1          local dev stack helpers
scripts/self-pc-server-*.ps1     self-host server helpers
scripts/*smoke*.ts               smoke/e2e checks
```

## 관련 문서

- [Self-host 테스트 케이스](SELFHOST_TEST_CASES.md)
- [Self-host 테스트 한계](SELFHOST_TEST_GAPS.md)
- [최근 테스트 결함](SELFHOST_DEFECTS.md)
