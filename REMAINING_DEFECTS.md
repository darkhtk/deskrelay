# DeskRelay Self 남은 결함과 개선 작업

이 문서는 self 프로젝트에서 Codex가 직접 처리할 수 있는 결함만 추적한다. 실제 다른 PC, 실제 모바일, 실제 Claude 계정이 필요한 검증은 별도 사용자 검증으로 남긴다.

## 이번 반영

- 공통 진단 단계 모델을 `@deskrelay/shared`에 추가했다.
- 공유 update 상태 vocabulary(`UpdateState`)를 추가했다.
- `register-self` report 단계에 `severity`, `source`, `evidence`, `action`, `retrySafe`를 붙일 수 있게 했다.
- Windows 설치 스크립트 report도 `severity`, `source`, `retrySafe`를 남긴다.
- `doctor` 결과를 공통 진단 단계 모델로 정규화했다.
- backend 진단 report에 기존 `checks`와 함께 새 `steps` 배열을 포함했다.
- 등록 실패 중 advertised daemon 접근 실패를 token reject, DNS 실패, refused, timeout으로 분리하고 원인 증거와 다음 행동을 포함했다.
- Tailscale/LAN/공개망/로컬 주소 구분을 등록 report evidence에 남긴다.
- connector update 결과에 `succeeded`, `restart_required` 상태와 updater 단계 report를 포함했다.
- 설정의 update UI에서 오프라인 디바이스를 실패가 아니라 대기 상태로 표시하고, 재시작 필요 상태를 실패와 분리했다.
- doctor report에 Site token, daemon token, workspace scope, connector URL network 성격을 보안 경계로 표시한다.
- 연결 진단 UI에서 오래된 `remote-claude@...` behavior 목록 표시를 제거했다.
- CTX 표시 위치를 컴포저 하단 쪽으로 낮추고 아래 여백을 줄였다.
- mock/unit 테스트에 shared diagnostics, register-self failure classification, self-update state machine, backend doctor security checks를 추가했다.

## 남은 우선순위

| 우선순위 | 항목 | 남은 이유 | 다음 처리 기준 |
| --- | --- | --- | --- |
| P1 | 설치 report UI 연결 | installer report JSON은 좋아졌지만 브라우저에서 과거 실패 report를 불러와 보여주는 화면은 없다. | 메인 wizard 또는 설정 진단에서 최근 installer report를 읽고 단계별로 보여준다. |
| P1 | 오프라인 디바이스 자동 업데이트 큐 | UI는 오프라인을 대기 상태로 분리하지만, 다음 부팅 때 자동 update를 수행하는 persistent queue는 아직 없다. | 서버가 device별 desired version을 저장하고 connector가 시작 시 확인해 self-update를 실행한다. |
| P1 | Tailscale/방화벽 실제 판정 | report는 세분화됐지만 실제 방화벽 rule/테일넷 로그인 상태를 서버가 원격으로 판정하지는 않는다. | installer와 daemon diagnostics가 Tailscale CLI 상태, firewall rule 상태, advertised bind 상태를 별도 step으로 보고한다. |
| P2 | mock/virtual UI 회귀 테스트 | 등록/diagnostic/update는 테스트됐지만 실제 Claude 없이 streaming, SSE resume, slash, attachment를 검증하는 UI 레이어가 부족하다. | 실제 Claude 계정 없이 transport와 UI 상태 전이를 반복 테스트한다. |
| P2 | 실패 report 누적 관리 | 실패 report는 파일로 남지만 오래된 report 정리/비교 정책이 없다. | 최근 N개 report 유지, 마지막 실패/성공 report를 명령으로 조회한다. |

## 항목별 설계

### P0. 통합 진단 모델

- 상태: 1차 완료.
- 모든 진단 생산자는 `DiagnosticStep`을 만들고, 기존 UI 호환이 필요한 곳만 `DiagnosticCheck`로 변환한다.
- `source`는 `installer`, `register-self`, `doctor`, `server`, `daemon`, `frontend`, `updater` 중 하나로 고정한다.
- `status`는 `ok`, `warn`, `failed`, `skipped`, `repaired`, `running`, `pending`, `unknown` 중 하나만 사용한다.
- UI는 legacy `checks`가 있으면 계속 읽되, 새 API는 `steps`를 우선 사용하도록 전환한다.

### P0. 등록/설치 실패 분류와 재실행성

- 상태: 1차 완료. 남은 일은 최근 report를 UI에서 보여주는 것.
- installer 단계마다 `id`, `status`, `evidence`, `action`, `retrySafe`를 남긴다.
- stale connector가 있으면 먼저 login task를 멈추고, 실패하면 포트 점유 PID와 수동 종료 명령을 report에 남긴다.
- Git/Bun/Tailscale이 없을 때는 설치 가능 여부와 수동 설치 링크를 구분한다.
- 같은 명령을 다시 실행해도 이전 실패 상태가 다음 실패를 만들지 않도록 정리 단계를 idempotent하게 유지한다.

### P1. Tailscale/방화벽 판정 로직

- 상태: 1차 완료. 남은 일은 실제 Tailscale/firewall 상태 query를 daemon diagnostics에 넣는 것.
- local probe와 advertised probe를 분리한다.
- advertised host 후보는 Tailscale, LAN, 수동 입력 순서로 기록한다.
- Windows에서는 방화벽 rule 존재 여부와 관리자 권한 여부를 별도 evidence로 남긴다.
- timeout은 바로 방화벽으로 단정하지 않고, Tailscale 미설치/미로그인/로컬 바인드/라우팅 실패와 함께 분류한다.

### P1. 업데이트 상태 머신

- 상태: 1차 완료. 남은 일은 오프라인 디바이스의 다음 부팅 자동 update queue.
- 서버 update와 각 디바이스 update를 별도 state machine으로 다룬다.
- 오프라인 디바이스는 실패가 아니라 `pending_until_device_online`로 둔다.
- update 버튼은 실행 가능 상태에서만 활성화한다.
- 강제 재시작이 필요한 경우 `restart_required` 성격의 action을 명시한다.

### P1. 보안 경계 가시성

- 상태: 1차 완료. 남은 일은 Help/Manual에 진단 항목 설명을 더 연결하는 것.
- Site token, daemon token, connector port, workspace scope를 같은 진단 표에서 보여준다.
- token이 명령어에 포함될 때 복사 범위와 노출 위험을 명확히 표시한다.
- unrestricted workspace를 켜면 current device 범위의 위험 설정임을 표시한다.
- 디바이스 제거 결과는 server registry 삭제와 원격 PC cleanup 결과를 분리한다.

### P2. mock/virtual 자동 회귀 테스트

- 상태: 일부 완료. 단위/백엔드 테스트는 늘렸고, UI virtual 회귀가 남았다.
- mock daemon으로 registration, diagnostics, update, SSE streaming을 테스트한다.
- virtual transcript로 queued prompt, slash command, image attachment, generated image rendering 조건을 테스트한다.
- timeout 수치가 frontend/backend/daemon에서 어긋나지 않는지 fixture로 검증한다.
- 실제 Claude CLI 없이도 UI 상태 모델이 깨지지 않는 테스트를 우선한다.

## 작업 원칙

- self 프로젝트만 본다.
- product 저장소와 hosted 배포 경로는 건드리지 않는다.
- 채팅창 UI는 사용자가 명시적으로 요청한 경우에만 수정한다.
- 기능이나 설정을 바꾸면 Settings Help, README, Manual 갱신 필요 여부를 확인한다.
