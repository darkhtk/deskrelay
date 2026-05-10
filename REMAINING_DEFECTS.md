# DeskRelay Self 남은 작업

이 문서는 self-host DeskRelay의 설치/연결 신뢰성을 파워유저 도구 수준으로 끌어올리기 위해 남은 작업만 추적한다. 검증은 성공 경로만 보지 않는다. 재실행, stale 상태, 네트워크 실패, 권한 부족, 재부팅 이후 복구까지 확인한다.

## 현재 우선순위

| 순위 | 항목 | 목적 | 현재 상태 |
| --- | --- | --- | --- |
| 1 | 다른 Windows PC 등록 실증 | 실제 사용자 설치 실패를 잡는다 | 자동 리포트는 있음, 실제 깨끗한 PC 실증 필요 |
| 2 | 설치 스크립트 재실행성 강화 | 실패 후 같은 명령 재실행으로 정상 상태에 수렴 | 일부 stale port 감지는 있음, 전체 reconcile 부족 |
| 3 | 통합 진단 모델 | 연결 진단 탭 하나로 원인과 다음 행동을 판정 | UI 안내는 반영, doctor/API 통합 남음 |
| 4 | Tailscale/방화벽 실패 분류 | 네트워크 실패를 사용자가 바로 이해 | timeout/token 거부는 분리, 세부 분류 부족 |
| 5 | 재부팅 복구 검증 | 다음 날 켜도 자동 사용 가능하게 보장 | 수동 검증 필요 |
| 6 | 실제 Claude run 회귀 검증 | 연결됨 상태와 실제 작업 성공을 일치 | 수동 검증 의존 |

## 다음 작업 권장 순서

1. 깨끗한 Windows 사용자 profile 또는 VM에서 다른 PC 등록 명령을 그대로 실행한다.
2. 실패 로그와 `%LOCALAPPDATA%\DeskRelay\reports\connector-verify-*.json`을 수집한다.
3. 실패 단계가 installer에서 자동 보정 가능한지, 사용자 안내만 필요한지 분류한다.
4. 자동 보정 가능한 것은 `install-connector.ps1` 또는 `register-self`에 넣는다.
5. 보정 후 같은 명령을 3회 반복해 디바이스 row가 하나로 수렴하는지 확인한다.
6. 마지막으로 연결 진단 탭과 도움말 문구가 실제 실패 분류와 맞는지 조정한다.

## 최근 완료

- `register-self` 단계별 등록 리포트 추가
- daemon token 생성/로드, connector env, 기존 daemon 정리, login task 설치, local `/status`, advertised `/status`, server registry POST, server device list 확인을 분리 표시
- stale local connector가 다른 daemon token으로 포트를 점유하면 등록 중단 및 재시도 조건 안내
- advertised daemon probe 실패를 token 거부, timeout, 네트워크/방화벽 접근 실패로 우선 분류
- server 등록 뒤 `/api/devices`를 다시 조회해 실제 목록 반영 확인
- server list 확인 실패 회귀 테스트 추가
- `self-verify-connector.ps1` 추가: 실제 PC 등록 후 Git/Bun/repo/workspace/login task/local daemon/advertised daemon/server registry를 JSON report로 남김
- `install-connector.ps1`가 등록 완료 후 connector 검증 리포트를 자동 실행
- 가상 self-host e2e에서 connector 검증 리포트 성공 여부 확인
- 메인 화면, 설정 도움말, 연결 진단 탭, README/Manual에 connector 검증 리포트 위치와 단계명을 반영

## P0. 다른 Windows PC 등록 실증

**상태:** 최우선. 자동 검증 리포트와 UI 안내는 추가됨. 실제 PC 실증 필요

**남은 작업**

- 깨끗한 Windows 사용자 profile에서 등록 명령 실행
- 기존 `$HOME\deskrelay`가 없을 때 clone/install/start/register가 끝까지 진행되는지 확인
- 기존 `$HOME\deskrelay`가 dirty repo, 다른 repo, 오래된 repo일 때 안전하게 보정되는지 확인
- 같은 등록 명령을 3회 반복 실행해도 device row가 하나로 수렴하는지 확인
- 등록 성공 뒤 서버 UI 디바이스 목록에 즉시 표시되는지 확인
- 등록한 디바이스 선택 뒤 세션 조회와 새 채팅 시작까지 확인
- 등록 명령 마지막의 connector verification report 저장 여부 확인
- 실패 시 report의 `failed`, `warn`, `action`, `evidence`가 실제 사용자가 취할 행동으로 충분한지 확인

**통과 기준**

- 실패하면 어느 단계에서 막혔는지 명령 출력만으로 알 수 있다.
- 성공하면 daemon URL, log path, server device list 확인 결과가 출력된다.
- verification report JSON에 실패/경고/증거/다음 행동이 남는다.
- 같은 PC를 반복 등록해도 중복 디바이스가 생기지 않는다.

## P0. 설치 스크립트 재실행성 강화

**상태:** stale daemon token/port 감지는 추가됨. installer 전체 reconcile은 남음

**남은 작업**

- Git 미설치, Bun 미설치, PATH 꼬임을 설치 스크립트가 감지하고 명확히 안내
- 기존 connector process, login task, auth token, workspace root, server registry를 한 번에 보정
- stale port 점유 시 관리자 권한 필요 여부와 직접 종료 명령을 출력
- 실패 후 같은 명령을 다시 붙여넣으면 이전 실패 흔적 때문에 새 실패가 생기지 않게 보장
- 검증 리포트 실패 항목을 installer가 더 직접적으로 repair할 수 있게 연결
- Git/Bun 자동 설치가 실패했을 때, 다음 수동 명령과 재실행 조건을 한 화면에 남기기
- repo가 다른 원격 저장소일 때 삭제/이동/중단 중 어떤 정책을 쓸지 고정

**통과 기준**

- 설치 명령은 "한 번 실행하고 끝"이 아니라 "현재 상태 판별 -> 보정 -> 검증 -> 등록"으로 동작한다.
- 중간 실패 후 재실행해도 같은 최종 상태로 수렴한다.

## P1. 통합 진단 모델

**상태:** 연결 진단 탭에 등록 검증 단계명 안내는 추가됨. 평상시 doctor/API 모델 통합은 부족

**남은 작업**

- `cr-connector doctor --json` 모델을 정리
- server diagnostics API 추가 또는 기존 연결 진단 탭과 doctor 결과 연결
- 서버 실행 여부, site token 유효성, registry 상태, local daemon, advertised daemon, daemon token 일치, behavior 준비, Claude CLI 사용 가능 여부, workspace root, login task를 하나의 구조로 판정
- 등록 직후 report와 평상시 diagnostics의 단계명/상태명/해결 행동을 같은 vocabulary로 통일

**통과 기준**

- 사용자는 연결 진단 탭 하나만 보고 어느 노드가 실패했는지 판단할 수 있다.
- 각 실패 항목은 다음 행동을 하나 이상 제공한다.

## P1. Tailscale과 방화벽 실패 분류

**상태:** timeout/token 거부는 분리됨, Tailscale/Firewall 세부 진단은 남음

**남은 작업**

- Tailscale 미설치, 로그아웃, 다른 tailnet, LAN fallback, Windows Firewall 차단을 서로 다른 실패로 분류
- Tailscale adapter 존재 여부와 선택된 advertiseHost 근거 출력
- LAN 후보와 Tailscale 후보를 분리해서 probe
- Windows firewall rule 존재 여부 확인 및 보정 명령 안내

**통과 기준**

- `local daemon ok`, `advertised daemon unreachable`, `firewall suspected`, `tailscale missing`, `tailscale logged out`, `wrong network suspected`가 구분된다.
- registry POST 전에 접근 불가능한 daemon 등록을 멈춘다.

## P1. Login task 재부팅 복구 검증

**상태:** 수동 검증 필요

**남은 작업**

- 서버 PC 재부팅 후 `site-frontend`, `site-backend`, 서버 connector 복구 확인
- 등록 PC 재부팅 후 connector 자동 실행 확인
- task path, script path, log path, 마지막 실행 결과를 진단에 포함
- login task installed와 실제 connector online 차이를 UI에서 구분

**통과 기준**

- 다음 날 PC를 켜도 등록된 디바이스가 자동으로 사용 가능 상태로 돌아온다.
- 복구 실패 시 사용자가 봐야 할 로그 위치가 바로 표시된다.

## P2. 실제 Claude run 회귀 검증

**상태:** 수동 검증 의존

**남은 작업**

- 실제 Claude Code 기준 `ping`, 긴 streaming, 권한 요청, slash command, 이미지 첨부, 생성 이미지 preview 검증
- streaming 중 브라우저 새로고침 후 마지막 cursor 이후 이벤트 이어받기 확인
- approval timeout과 daemon timeout 일치 확인

**통과 기준**

- 디바이스가 online이면 실제 작업도 새로고침 없이 반영된다.
- 새로고침이나 SSE 재연결 후에도 run event가 누락되지 않는다.

## P2. 업데이트와 꺼진 디바이스 처리

**상태:** 상태 표시 기본 구조는 있음, 실패/오프라인 처리는 더 필요

**남은 작업**

- 전체 업데이트 상태를 `not_started`, `running`, `succeeded`, `failed`, `pending_until_device_online`으로 고정
- 꺼진 디바이스는 다음 부팅 때 update pending을 이어받게 설계
- 실패한 디바이스별 로그와 재시도 액션 제공
- 업데이트 후 release note 표시 정책 정리

**통과 기준**

- 사용자는 각 디바이스가 업데이트 됐는지, 진행 중인지, 실패했는지 즉시 알 수 있다.
- 꺼져 있던 디바이스도 다음 실행 시 업데이트 누락이 없다.

## P2. 보안 경계 강화

**상태:** self-host 전제의 최소 경계는 있음, 파워유저용 가시성 부족

**남은 작업**

- Site token 회전/폐기 경로 추가
- 등록 명령에 token이 포함되는 구조의 노출 위험을 가까운 위치에서 안내
- daemon port 공개 범위와 unrestricted workspace 옵션의 위험을 액션 옆에 표시
- 디바이스 제거 시 server registry 삭제와 대상 PC uninstall 실패를 분리 기록

**통과 기준**

- token을 잃어버렸을 때 폐기하고 새로 발급할 수 있다.
- 위험한 옵션은 사용자가 의식적으로 켜야 한다.
- 제거 실패 시 서버에 남은 것과 대상 PC에 남은 것이 분리 표시된다.

## 작업 가드

- 지금은 self 프로젝트만 본다.
- product 저장소와 hosted product 배포 경로는 건드리지 않는다.
- 채팅 화면 UI는 안정성 검증 대상일 뿐, 별도 지시 없이는 수정하지 않는다.
- 기능을 바꾸면 Settings > Help 또는 README/Manual에 반영할 필요가 있는지 확인한다.
