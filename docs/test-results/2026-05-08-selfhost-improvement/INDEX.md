# 2026-05-08 Self-Host Improvement Test Results

이번 묶음은 happy path만 보지 않고, 실패/복구/오염 방지를 자동 테스트로 고정하는 1차 개선이다.

## 결과 요약

| 영역 | 결과 파일 | 상태 |
|---|---|---|
| Workspace/File guard | [01-fs-workspace.md](01-fs-workspace.md) | PASS |
| Register/self duplicate replacement | [02-register-self.md](02-register-self.md) | PASS |
| Register/self failure paths | [05-register-self-failure-paths.md](05-register-self-failure-paths.md) | PASS |
| Self-host docs product-term scan | [03-docs-forbidden-terms.md](03-docs-forbidden-terms.md) | PASS |
| Formatting/check gate | [04-biome-check.md](04-biome-check.md) | PASS |

## 이번에 자동화로 닫은 문제

- `/fs/list`는 cwd picker 계약대로 디렉터리만 반환한다.
- `/fs/list`에 파일 경로가 들어오면 not directory로 실패한다.
- workspace root 밖 조회와 mkdir는 forbidden으로 실패하고 파일 시스템을 오염시키지 않는다.
- 같은 daemon URL을 다시 등록할 때 기존 row를 모두 삭제하고 새 row를 등록한다.
- 기존 device 목록 조회나 중복 row 삭제가 실패하면 새 등록을 중단한다.
- self-host 문서에 product 전용 배포/결제/관리형 릴레이 용어가 섞이지 않도록 검사한다.

## 아직 수동 검증으로 남은 것

- 실제 다른 Windows PC에서 `REGISTER-OTHER-PC.txt` 전체 block 실행.
- Tailscale 없는 PC에서 Tailscale URL 등록 실패 메시지 확인.
- Windows Firewall이 `18091`을 막는 상황에서 등록 실패 메시지 확인.
- login task 재부팅/재로그인 복구.
- 실제 Claude CLI `ping`, streaming, approval, 이미지 preview.
