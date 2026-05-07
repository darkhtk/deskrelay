# Self-Host Test Cases

이 문서는 구조 변경 시 같이 움직여야 하는 요소별 테스트 케이스를 정리한다. 목표는 happy path만 확인하지 않고, 실패했을 때 안전하게 멈추는지, registry와 로컬 상태를 오염시키지 않는지, 사용자가 다음 행동을 알 수 있는지까지 검증하는 것이다.

## 공통 원칙

- 성공 케이스마다 최소 하나 이상의 실패 케이스를 둔다.
- 서버 registry에 저장하기 전에는 항상 daemon 접근성과 token을 검증한다.
- 실패 후에는 device list, login task, local state, workspace가 중간 상태로 남지 않는지 확인한다.
- `127.0.0.1`은 같은 PC 전용이다. 다른 PC 등록 명령에는 들어가면 안 된다.
- 공용 인터넷에 connector port를 직접 노출하지 않는 전제를 유지한다.
- 실제 Claude 호출, 재부팅, Windows Firewall, Tailscale 미설치 PC는 자동 smoke와 별도 manual acceptance로 분리한다.

## A. 설치/등록 스크립트 체계

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| 서버 URL이 `127.0.0.1` | 다른 PC 등록 installer에 local URL 전달 | 설치 전 즉시 실패, 다른 PC용 Tailscale/LAN URL 안내 | 자동화됨 |
| 서버 URL이 Tailscale인데 대상 PC에 Tailscale 없음 | Tailscale 미설치 VM에서 등록 명령 실행 | Tailscale 설치/로그인 필요 메시지, clone/install 전 중단 | manual |
| Git 없음 | PATH에서 git 제거한 shell로 installer 실행 | Git 필요 메시지, 폴더/registry 변화 없음 | manual |
| Bun 없음 | PATH에서 bun 제거한 shell로 installer 실행 | Bun 필요 메시지, 폴더/registry 변화 없음 | manual |
| GitHub installer 다운로드 실패 | raw GitHub 차단 또는 잘못된 installer URL | 다운로드 실패 표시, 등록 중단 | manual |
| `$HOME\deskrelay` 없음 | 깨끗한 사용자 profile에서 실행 | clone, install, daemon 시작, 등록 완료 | manual |
| `$HOME\deskrelay`가 git repo 아님 | 같은 경로에 일반 폴더 생성 후 실행 | 기존 폴더 backup, 새 clone, 등록 진행 | manual |
| remote가 다른 repo | `$HOME\deskrelay` remote를 다른 URL로 설정 | 기존 폴더 backup, 새 clone, 등록 진행 | manual |
| repo dirty | `$HOME\deskrelay`에 미커밋 변경 생성 | 기존 폴더 backup, 새 clone, 등록 진행 | manual |
| 정상 등록 | 서버 URL/token 정상, target PC 접근 가능 | daemon 시작, server-to-connector 검증, device list 반영 | 자동 일부, 실제 PC는 manual |

## B. 네트워크, Tailscale, 방화벽

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| LAN 서버 URL + LAN reachable | 같은 LAN의 다른 PC에서 등록 | LAN IP advertise, 서버 등록 성공 | manual |
| Tailscale 서버 URL + Tailscale reachable | 같은 tailnet의 다른 PC에서 등록 | Tailscale IP advertise, 서버 등록 성공 | manual |
| daemon이 local-only bind | advertise는 외부 주소, daemon은 `127.0.0.1` bind | 서버 등록 전 실패, connector 접근 불가 메시지 | 자동화됨 |
| Windows Firewall이 `18091` 차단 | inbound 차단 후 등록 | 서버 등록 전 실패, 방화벽/Tailscale 확인 안내 | manual |
| 서버 backend offline | 꺼진 서버 URL로 `register-self` 실행 | `cannot reach DeskRelay server`, registry 변화 없음 | 자동화됨 |
| 잘못된 Site token | 틀린 Site token으로 등록 | 401/403, registry 저장 없음 | 추가 자동화 후보 |
| wrong daemon token | daemon URL은 맞지만 auth token 틀림 | 400, registry 저장 없음 | 자동화됨 |
| unreachable daemon 수동 등록 | `/api/devices`에 unreachable daemon URL POST | 502, registry 저장 없음 | 자동화됨 |

## C. Login Task와 로컬 상태 관리

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| login task install | 등록 명령 또는 `login-task install --start` 실행 | task 생성, daemon 시작, 로그 경로 표시 | manual |
| login task status | 설치 후 status 실행 | installed/running 상태와 script/log 경로 표시 | manual |
| login task remove | remove 실행 | task 제거, 재로그인 시 자동 시작 안 함 | manual |
| 기존 daemon이 같은 포트 점유 | 같은 포트에 stale daemon 실행 후 등록 | stale daemon 정리 후 새 daemon 시작 | unit 자동화 |
| 기존 daemon token 불일치 | 같은 포트에 다른 token daemon 실행 | stale 처리 후 재등록 또는 명확한 실패 | 자동 일부 |
| 재부팅/로그인 후 복구 | 등록 후 Windows 재로그인 | connector 자동 실행, site에서 online 복귀 | manual |
| uninstall | `cr-connector uninstall` 실행 | auth/state/identity/behavior cache 제거 | unit/수동 보강 |
| 삭제 명령 실행 | 복사한 삭제 명령을 등록 PC에서 실행 | server registry 삭제, login task 제거, local state 제거 | manual 우선 |

## D. 디바이스 Registry와 해제 UX

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| 정상 등록 | `/api/devices` POST 또는 등록 명령 | list에 즉시 표시, token은 응답에 노출 안 됨 | 자동화됨 |
| 중복 daemon URL 등록 | 같은 daemon URL 재등록 | 기존 같은 daemon URL row 모두 삭제 후 새 row 등록 | 자동화됨 |
| 등록 목록 조회 실패 | `/api/devices` 조회가 401/403/500 | 새 등록 중단, 중복 row 가능성 차단 | 자동화됨 |
| 등록 목록 invalid JSON | `/api/devices`가 잘못된 JSON 응답 | 새 등록 중단, registry 변화 없음 | 자동화됨 |
| 중복 row 삭제 실패 | 같은 daemon URL row DELETE 실패 | 새 등록 중단, 중복 row 가능성 차단 | 자동화됨 |
| 등록 직후 offline badge | 등록 후 health poll 확인 | reachable이면 offline 표시 자동 제거 | UI 자동/수동 |
| 선택된 디바이스 삭제 | 현재 선택 디바이스 삭제 | selected id 보정, 삭제 id로 요청 안 함 | UI 자동 보강 |
| 삭제 후 refetch 실패 | DELETE 성공 후 list refetch 실패 유도 | local optimistic removal 유지, 오류는 별도 표시 | UI 자동 보강 |
| 삭제된 device id proxy | 삭제 후 `/api/devices/:id/...` 호출 | 404 유지 | 자동화됨 |
| 브라우저 PC 미등록 | 서버 PC가 registry에 없는 상태로 접속 | 브라우저 PC 등록/시작 UX 표시 | UI 수동 |
| 선택 디바이스 offline | 선택한 원격 PC daemon 중지 | 선택 디바이스 문제로만 표시, 브라우저 PC와 혼동 없음 | UI 수동 |

## E. Workspace, File, Session

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| workspace root 조회 | `/fs/roots` 호출 | 허용 root만 표시 | 자동화됨 |
| root 밖 `/fs/list` | 허용 root 밖 경로 조회 | 403 forbidden | 자동화됨 |
| 파일 경로 `/fs/list` | 파일 경로를 list에 전달 | not directory 오류 | 자동화됨 |
| cwd picker listing | root 안에 파일/폴더 생성 후 조회 | 디렉터리만 표시 | 자동화됨 |
| `/fs/mkdir` 정상 | root 안에 폴더 생성 | 생성 후 목록 반영 | 자동화됨 |
| `/fs/mkdir` root 밖 | parent를 root 밖으로 전달 | 403, 폴더 생성 없음 | 자동화됨 |
| 세션 파일 없음 | jsonl 삭제 후 session list 요청 | 목록에 올리지 않음, toast 없음 | 자동/수동 |
| 같은 session id 중복 | 같은 session id 파일 여러 개 | 최신 1개만 표시 옵션 동작 | 자동 보강 |
| 개별 세션 삭제 | row 삭제 클릭 | 삭제 중 표시 후 목록 제거 | UI 자동/수동 |
| 폴더 전체 세션 삭제 | group 삭제 실행 | progress 표시, 해당 그룹 제거, 실패 시 stuck 없음 | UI 자동/수동 |

## F. Claude Run, Streaming, Approval

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| 새 채팅 `ping` | 새 채팅에서 `ping` 전송 | 새 Claude session 생성, 응답 표시 | manual acceptance |
| 기존 세션 이어쓰기 | session 선택 후 메시지 전송 | 같은 session에 append | manual acceptance |
| streaming 중 갱신 | 긴 응답 요청 | 새로고침 없이 token/message 반영 | manual/Playwright 후보 |
| SSE 재연결 | 응답 중 SSE 끊김 후 재연결 | 마지막 cursor 이후부터 이어받음 | 자동 보강 |
| 도구 사용 상태 | Claude가 Read/Grep/Bash 실행 | composer 위 상태줄이 현재 action 표시 | manual |
| approval 필요 | 권한 필요한 도구 실행 | modal 표시, 승인/거부 결과 반영 | manual/자동 후보 |
| approval timeout | 승인 없이 timeout 대기 | daemon timeout과 UI timeout 일치 | 자동 보강 |
| composer queue | 응답 중 `ping1`, `ping2` 연속 전송 | 순서대로 처리, 응답 순서 보존 | manual |
| 이미지 첨부 | 이미지 첨부 후 전송 | 실제 파일 전달, 전송 후 첨부 UI 초기화 | manual |
| 이미지 출력 preview | Claude가 이미지 파일 생성 | 채팅에서 preview 렌더링 | manual |
| 하단 스크롤 | 최하단에서 새 메시지 수신 | 자동 하단 유지 | UI 자동/수동 |
| 위쪽 읽는 중 | 사용자가 위로 스크롤 후 새 메시지 수신 | 자동 이동 없음, 아래 화살표 표시 | UI 자동/수동 |

## G. Usage, CTX, UI 상태

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| `/usage` 파싱 성공 | Claude `/usage` 응답 파싱 | Session/Week 값과 reset 시간 갱신 | unit/수동 |
| `/usage` 실패 | CLI 오류 또는 upgrade page 유도 | 새 탭 열림 없음, 기존 값 유지 또는 unavailable 표시 | 수동 |
| session reset 표시 | usage 응답에 session reset 포함 | `reset` 텍스트 없이 시간만 표시 | UI 확인 |
| week reset 표시 | usage 응답에 week reset 포함 | 시간 우측 표시 | UI 확인 |
| CTX on/off | 설정 토글 변경 | composer 내부 세로 bar 표시/숨김 | UI 자동 후보 |
| 세션 선택 직후 CTX | 다른 세션 선택 | 해당 세션 기준 CTX 즉시 갱신 | 수동/자동 후보 |
| 5분 polling | 앱 유지 | session/week 사용량 주기 갱신 | 수동 |
| 사이드바 토글 | PC 브라우저에서 토글 | 상태 유지, 레이아웃 깨짐 없음 | UI 확인 |

## H. 문서와 릴리즈 운영

| 케이스 | 절차 | 기대 결과 | 비고 |
|---|---|---|---|
| README 설치 명령 | 새 clone에서 README 순서 실행 | 서버 실행 가능 | manual |
| 다른 PC 등록 문서 | `REGISTER-OTHER-PC.txt`와 README 비교 | 실제 명령과 설명 일치 | 자동/수동 |
| self 문서 금지어 | product 배포/결제/관리형 릴레이 흔적 검색 | self 문서에 없음 | 자동화됨 |
| release notes | 앱 release notes 확인 | 현재 self-host 기능과 일치 | 수동 |
| defects 문서 | 테스트 후 갱신 | 발견 결함/조치/남은 한계 기록 | 수동 |
| package scripts | README/development와 `package.json` 비교 | smoke 명령 이름 일치 | 자동 보강 |

## 현재 자동화 명령

```powershell
bun run test:selfhost-virtual
bun run test:selfhost-failures
bun --filter @deskrelay/pc-connector-daemon test self-register.test.ts
bun --filter @deskrelay/site-backend test
bun --filter @deskrelay/pc-connector-daemon typecheck
bun --filter @deskrelay/site-backend typecheck
```

## Manual Acceptance 우선순위

1. Tailscale 없는 Windows VM에서 다른 PC 등록 실패 문구 확인.
2. 실제 다른 Windows PC에서 `REGISTER-OTHER-PC.txt` 전체 block 실행.
3. 등록 후 로그아웃/로그인 또는 재부팅으로 login task 복구 확인.
4. Windows Firewall 차단 상태에서 등록 실패 메시지 확인.
5. 삭제 명령으로 server registry, login task, local state가 모두 정리되는지 확인.
6. 실제 Claude `ping`, streaming, approval, 이미지 preview까지 확인.
