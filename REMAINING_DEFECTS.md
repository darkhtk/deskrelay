# DeskRelay Self 남은 결함과 개선 작업

이 문서는 self 프로젝트에서 Codex가 직접 처리할 수 있는 결함만 추적한다. 실제 다른 PC, 실제 모바일, 실제 Claude 계정이 필요한 검증은 별도 사용자 검증으로 남긴다.

## 이번 반영

- 공통 진단 단계 모델을 `@deskrelay/shared`에 추가했다.
- `register-self` report 단계에 `severity`, `source`, `evidence`, `action`, `retrySafe`를 붙일 수 있게 했다.
- `doctor` 결과를 공통 진단 단계 모델로 정규화했다.
- backend 진단 report에 기존 `checks`와 함께 새 `steps` 배열을 포함했다.
- 등록 실패 중 advertised daemon 접근 실패에 원인 증거와 다음 행동을 포함했다.
- 연결 진단 UI에서 오래된 `remote-claude@...` behavior 목록 표시를 제거했다.
- CTX 표시 위치를 컴포저 하단 쪽으로 낮추고 아래 여백을 줄였다.

## 남은 우선순위

| 우선순위 | 항목 | 남은 이유 | 다음 처리 기준 |
| --- | --- | --- | --- |
| P0 | 통합 진단 모델 | 모델은 생겼지만 모든 installer/update/security UI가 아직 같은 모델을 쓰지는 않는다. | `/api/self/doctor`, `/api/devices/:id/doctor`, installer report, update status가 같은 `steps` vocabulary를 공유한다. |
| P0 | 등록/설치 실패 분류와 재실행성 | 일부 등록 실패만 분류했다. Git, Bun, PATH, repo 상태, stale port 분류가 아직 부족하다. | 실패 report만 보고 사용자가 같은 명령을 재실행할지, 관리자 권한으로 다시 실행할지, 포트를 비울지 판단할 수 있다. |
| P1 | Tailscale/방화벽 판정 로직 | timeout을 더 세밀하게 Tailscale 없음, 로컬 바인드, 방화벽 의심, 토큰 거부로 나눠야 한다. | 등록 전에 서버가 접근 가능한 advertise URL인지 검증하고 실패 원인을 분리한다. |
| P1 | 업데이트 상태 머신 | 서버/디바이스 update 상태가 아직 완전한 state machine은 아니다. | `not_started`, `running`, `succeeded`, `failed`, `pending_until_device_online`로 표시와 버튼 활성화가 결정된다. |
| P1 | 보안 경계 가시성 | token, unrestricted workspace, 공개 connector port의 위험 표시가 산발적이다. | Settings Help와 진단 UI에서 현재 보안 경계와 위험 옵션을 한눈에 볼 수 있다. |
| P2 | mock/virtual 자동 회귀 테스트 | 실제 Claude 없이 streaming, SSE resume, slash, attachment를 검증하는 레이어가 부족하다. | 실제 Claude 계정 없이 transport와 UI 상태 전이를 반복 테스트한다. |

## 항목별 설계

### P0. 통합 진단 모델

- 모든 진단 생산자는 `DiagnosticStep`을 만들고, 기존 UI 호환이 필요한 곳만 `DiagnosticCheck`로 변환한다.
- `source`는 `installer`, `register-self`, `doctor`, `server`, `daemon`, `frontend`, `updater` 중 하나로 고정한다.
- `status`는 `ok`, `warn`, `failed`, `skipped`, `repaired`, `running`, `pending`, `unknown` 중 하나만 사용한다.
- UI는 legacy `checks`가 있으면 계속 읽되, 새 API는 `steps`를 우선 사용하도록 전환한다.

### P0. 등록/설치 실패 분류와 재실행성

- installer 단계마다 `id`, `status`, `evidence`, `action`, `retrySafe`를 남긴다.
- stale connector가 있으면 먼저 login task를 멈추고, 실패하면 포트 점유 PID와 수동 종료 명령을 report에 남긴다.
- Git/Bun/Tailscale이 없을 때는 설치 가능 여부와 수동 설치 링크를 구분한다.
- 같은 명령을 다시 실행해도 이전 실패 상태가 다음 실패를 만들지 않도록 정리 단계를 idempotent하게 유지한다.

### P1. Tailscale/방화벽 판정 로직

- local probe와 advertised probe를 분리한다.
- advertised host 후보는 Tailscale, LAN, 수동 입력 순서로 기록한다.
- Windows에서는 방화벽 rule 존재 여부와 관리자 권한 여부를 별도 evidence로 남긴다.
- timeout은 바로 방화벽으로 단정하지 않고, Tailscale 미설치/미로그인/로컬 바인드/라우팅 실패와 함께 분류한다.

### P1. 업데이트 상태 머신

- 서버 update와 각 디바이스 update를 별도 state machine으로 다룬다.
- 오프라인 디바이스는 실패가 아니라 `pending_until_device_online`로 둔다.
- update 버튼은 실행 가능 상태에서만 활성화한다.
- 강제 재시작이 필요한 경우 `restart_required` 성격의 action을 명시한다.

### P1. 보안 경계 가시성

- Site token, daemon token, connector port, workspace scope를 같은 진단 표에서 보여준다.
- token이 명령어에 포함될 때 복사 범위와 노출 위험을 명확히 표시한다.
- unrestricted workspace를 켜면 current device 범위의 위험 설정임을 표시한다.
- 디바이스 제거 결과는 server registry 삭제와 원격 PC cleanup 결과를 분리한다.

### P2. mock/virtual 자동 회귀 테스트

- mock daemon으로 registration, diagnostics, update, SSE streaming을 테스트한다.
- virtual transcript로 queued prompt, slash command, image attachment, generated image rendering 조건을 테스트한다.
- timeout 수치가 frontend/backend/daemon에서 어긋나지 않는지 fixture로 검증한다.
- 실제 Claude CLI 없이도 UI 상태 모델이 깨지지 않는 테스트를 우선한다.

## 작업 원칙

- self 프로젝트만 본다.
- product 저장소와 hosted 배포 경로는 건드리지 않는다.
- 채팅창 UI는 사용자가 명시적으로 요청한 경우에만 수정한다.
- 기능이나 설정을 바꾸면 Settings Help, README, Manual 갱신 필요 여부를 확인한다.
