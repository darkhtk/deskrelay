# DeskRelay Self 남은 작업

이 문서는 Codex가 코드, 문서, 로컬/가상 테스트로 직접 처리할 수 있는 작업만 추적한다. 실제 다른 PC 실증, 재부팅 실증, 사용자 계정이 필요한 Claude Code 실사용 검증처럼 외부 환경 조작이 필요한 항목은 제외한다.

## 현재 우선순위

| 순위 | 항목 | 내가 처리할 수 있는 범위 | 완료 기준 |
| --- | --- | --- | --- |
| 1 | 통합 진단 모델 | `doctor`, backend diagnostics, 연결 진단 UI의 상태 vocabulary 통일 | 한 API/모델로 설치, daemon, server, token, workspace, behavior 상태를 설명 |
| 2 | 등록/설치 실패 분류 고도화 | installer와 `register-self`의 실패 단계, report, 재실행 보정 강화 | 실패 report가 원인, 증거, 다음 명령을 안정적으로 제공 |
| 3 | Tailscale/방화벽 판정 로직 | adapter, advertise host, LAN 후보, firewall rule 탐지 코드와 가상 테스트 | timeout을 네트워크/방화벽/Tailscale/token 문제로 분리 |
| 4 | 업데이트 상태 머신 | 서버/connector 업데이트 상태와 오프라인 디바이스 pending 처리 | 상태가 `not_started`, `running`, `succeeded`, `failed`, `pending_until_device_online` 중 하나로 수렴 |
| 5 | 보안 경계 가시성 | token 회전/폐기, 위험 옵션 경고, 제거 실패 분리 기록 | 사용자가 노출 위험과 제거 결과를 UI/문서에서 확인 |
| 6 | 자동 회귀 테스트 보강 | mock/virtual 환경으로 streaming, SSE resume, approval timeout 검증 | 실제 Claude 계정 없이 주요 프로토콜 회귀를 잡음 |

## P0. 통합 진단 모델

**남은 작업**

- `cr-connector doctor --json` 결과 schema를 고정한다.
- backend diagnostics API가 doctor 결과를 받아 같은 schema로 반환하게 한다.
- 연결 진단 탭, 메인 화면 상태 라벨, installer report가 같은 단계명과 상태명을 쓰게 한다.
- 상태별 action을 하나로 정리한다.
  - token mismatch
  - stale local daemon
  - local daemon unreachable
  - advertised daemon unreachable
  - server registry rejected
  - workspace root denied
  - behavior not ready
  - Claude CLI unavailable
- doctor schema fixture와 snapshot 테스트를 추가한다.

**완료 기준**

- 같은 실패가 installer report, CLI doctor, 설정의 연결 진단에서 같은 이름으로 보인다.
- 긴 오류 메시지와 경로가 UI에서 잘리지 않는다.
- 테스트 fixture만 봐도 사용자가 다음에 실행할 명령을 알 수 있다.

## P0. 등록/설치 실패 분류와 재실행성

**남은 작업**

- Git 없음, Bun 없음, PATH 꼬임, repo dirty, 다른 repo, stale port, stale token을 단계별로 분리한다.
- 각 단계에 `status`, `evidence`, `action`, `retrySafe`를 기록한다.
- 실패 후 같은 등록 명령을 다시 실행했을 때 이전 실패 report와 process 상태가 새 실패를 만들지 않게 한다.
- stale port를 발견하면 가능한 경우 login task/process 정리 명령을 report에 함께 넣는다.
- 가상 e2e에 다음 fixture를 추가한다.
  - repo 없음
  - repo는 있으나 `.git` 없음
  - stale daemon token
  - local-only server URL
  - advertised probe timeout
  - server registry rejected

**완료 기준**

- 등록 명령은 중간 실패 후 재실행해도 같은 최종 상태로 수렴한다.
- 실패 report는 사용자가 복사할 수 있는 다음 명령을 포함한다.
- 자동 보정 불가능한 경우에도 실패 원인이 한 단계로 좁혀진다.

## P1. Tailscale/방화벽 실패 판정

**남은 작업**

- Tailscale adapter 탐지 결과와 선택된 advertise host 근거를 report에 기록한다.
- LAN 후보와 Tailscale 후보를 분리해서 probe한다.
- Windows firewall rule 존재 여부를 확인하고, 없으면 관리자 권한용 보정 명령을 report에 넣는다.
- `/healthz` 또는 `/status` 응답 실패를 다음으로 분류한다.
  - token rejected
  - connection refused
  - timeout
  - local-only bind
  - firewall suspected
  - tailscale missing
  - no routable advertise host
- 분류 로직 단위 테스트를 추가한다.

**완료 기준**

- 단순 timeout으로 뭉개지지 않는다.
- 등록 전에 서버가 접근할 수 없는 daemon은 registry에 넣지 않는다.
- UI와 report가 같은 실패 분류를 보여준다.

## P1. 업데이트 상태 머신

**남은 작업**

- 전체 업데이트 상태를 고정 enum으로 정리한다.
  - `not_started`
  - `running`
  - `succeeded`
  - `failed`
  - `pending_until_device_online`
- 디바이스별 update 상태와 마지막 로그 경로를 backend에 저장한다.
- 오프라인 디바이스는 다음 connector 시작 시 pending update를 이어받게 한다.
- 설정 일반 탭의 전체 업데이트 버튼이 상태별로만 활성화되게 한다.
- 업데이트 후 release note 표시 여부를 상태에 연결한다.

**완료 기준**

- 사용자는 업데이트가 안 됐는지, 진행 중인지, 됐는지, 실패했는지 구분할 수 있다.
- 꺼져 있던 디바이스가 나중에 켜졌을 때 pending update가 사라지지 않는다.
- 실패한 디바이스는 재시도 action과 로그 위치를 가진다.

## P1. 보안 경계 가시성

**남은 작업**

- Site token rotate/revoke API와 UI를 추가한다.
- token이 포함된 등록 명령 옆에 노출 위험과 재발급 방법을 표시한다.
- unrestricted workspace 옵션과 connector port 공개 옵션 옆에 위험 라벨을 붙인다.
- 디바이스 제거 결과를 분리 기록한다.
  - server registry 삭제 성공/실패
  - 대상 PC uninstall 요청 성공/실패
  - login task 제거 성공/실패
  - 남은 local report/log 위치
- 보안 관련 도움말을 Settings > Help와 README/Manual에 동기화한다.

**완료 기준**

- token을 잃어버렸을 때 폐기하고 새로 발급할 수 있다.
- 위험 옵션은 사용자가 의식적으로 켜야 한다.
- 제거 실패 시 서버에 남은 것과 대상 PC에 남은 것이 분리 표시된다.

## P2. 자동 회귀 테스트 보강

**남은 작업**

- 실제 Claude 계정 없이 protocol/mock 기준으로 다음을 테스트한다.
  - queued prompt 처리
  - streaming event 누락 방지
  - SSE 재연결 후 cursor resume
  - approval timeout과 daemon timeout 일치
  - slash command 전달
  - image attachment payload 전달
  - generated image metadata 렌더 조건
- 실패 event가 UI status model에 남는지 확인한다.
- 긴 응답과 큰 transcript에서 "최근 N개 메시지 로드" 정책이 깨지지 않는지 테스트한다.

**완료 기준**

- 실제 Claude Code 계정 없이도 transport와 UI 상태 회귀를 잡는다.
- 새로고침이나 SSE 재연결 후 run event가 누락되지 않는다.
- timeout 숫자는 frontend, backend, daemon에서 일치한다.

## 작업 가드

- self 프로젝트만 본다.
- product 저장소와 hosted product 배포 경로는 건드리지 않는다.
- 채팅 화면 UI는 별도 지시 없이는 수정하지 않는다.
- 기능을 바꾸면 Settings > Help 또는 README/Manual에 반영할 필요가 있는지 확인한다.
- 실제 다른 PC, 실제 재부팅, 실제 Claude 계정 검증이 필요한 항목은 이 문서에 남기지 않는다.
