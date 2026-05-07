# 개발 문서

DeskRelay를 수정하거나 테스트할 때 필요한 개발자용 참고입니다. 일반 사용자는 [README](../README.md)의 설치 절차만 따라도 됩니다.

## 로컬 개발 helper

격리된 로컬 스택을 빠르게 실행하려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-start.ps1
```

실행되는 항목:

- connector daemon: `127.0.0.1:18191`
- 사이트 백엔드: `127.0.0.1:18192`
- 프론트엔드: `127.0.0.1:18193`

중지:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-stop.ps1
```

상태 확인:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-status.ps1
```

## 저장소 구조

```text
packages/site-frontend           Solid/Vite 브라우저 UI
packages/site-backend            Hono/Bun self-host 백엔드
packages/pc-connector-daemon     로컬 connector daemon
packages/behaviors/remote-claude Claude Code behavior
packages/behavior-sdk            behavior host runtime
packages/core                    broker 및 event primitive
packages/shared                  공유 타입과 helper
scripts/dev-local-*.ps1          로컬 스택 helper
```
