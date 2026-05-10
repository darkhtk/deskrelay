# AI가 유지보수하기 쉬운 프로젝트 기준과 리팩토링 계획

작성일: 2026-05-11  
대상: DeskRelay `self` 프로젝트  
목표: 사람과 AI가 같은 코드베이스를 이어받아도 맥락 손실, 과잉 수정, happy path 착각을 줄이는 구조로 만든다.

## 결론

DeskRelay는 기능은 강하지만 AI가 유지보수하기 쉬운 구조는 아직 아니다. 가장 큰 문제는 코드 품질이 낮다는 뜻이 아니라, 한 파일 안에 너무 많은 상태와 책임이 모여 있다는 점이다. AI는 이런 구조에서 작은 요청을 처리하다가 주변 상태를 과소평가하거나, 정상 흐름만 보고 실패/복구 경로를 놓치기 쉽다.

현재 우선순위는 대규모 재작성이나 디자인 변경이 아니다. 먼저 상태 모델, 명령/설치 흐름, 프론트 컨테이너, backend route, daemon CLI를 작고 검증 가능한 단위로 분리해야 한다.

## AI 유지보수성 평가 기준

| 기준 | 좋은 상태 | 나쁜 상태 |
|---|---|---|
| 파일 책임 | 한 파일이 하나의 역할을 갖고, 변경 이유가 명확하다. | UI, 상태, API 호출, 저장소, side effect, 오류 처리가 한 파일에 섞인다. |
| 상태 모델 | 상태 전이가 이름 있는 타입/함수/테이블로 표현된다. | boolean과 signal 조합으로 현재 의미를 추론해야 한다. |
| 계약 명확성 | API, daemon, behavior, frontend 사이의 request/response가 스키마로 고정된다. | 호출부마다 임의 객체를 만들고 실패 shape가 다르다. |
| 실패 경로 | 테스트와 UI가 실패, 재시도, 부분 성공, stale 상태를 다룬다. | 정상 성공만 테스트한다. |
| 추출 가능성 | 함수/모듈을 떼어내도 테스트로 의미가 보존된다. | 컴포넌트 내부 closure에 모든 정보가 묶여 있다. |
| 변경 반경 | 기능 하나를 고칠 때 손대는 파일이 예측 가능하다. | 한 기능 수정이 `App`, `ChatView`, `api`, CSS, backend를 동시에 흔든다. |
| 이름의 일관성 | server, site-backend, daemon, connector, device가 구분된다. | 같은 개념을 여러 이름으로 부르거나, 다른 개념을 같은 이름으로 부른다. |
| 관찰 가능성 | 로그, doctor, UI status가 같은 원천 모델을 본다. | 로그와 UI와 command 출력이 서로 다른 판단을 한다. |
| 테스트 계층 | pure unit, integration, self-host smoke, 실제 PC 검증이 분리된다. | 테스트가 크거나, 반대로 위험한 경로가 테스트 밖에 있다. |
| 문서-코드 동기화 | README, command 파일, UI 도움말이 같은 규칙에서 파생된다. | 문서만 맞고 코드가 다르거나, UI만 맞고 README가 뒤처진다. |

## 현재 구조 진단

| 영역 | 관찰 | AI 유지보수 리스크 |
|---|---|---|
| `packages/site-frontend/src/components/ChatView.tsx` | 약 3550줄. 세션, 디바이스, composer, stream, 권한, 지침, context usage, sidebar 상태가 함께 있다. | 작은 UI 변경도 run lifecycle이나 session persistence를 건드릴 위험이 있다. |
| `packages/site-frontend/src/App.tsx` | 약 1730줄. landing, settings, usage meter, update UI, token login, diagnostics가 함께 있다. | 설정 항목 하나를 바꾸다 landing 또는 top chrome 상태를 깨기 쉽다. |
| `packages/site-backend/src/app.ts` | 약 1400줄. API route와 self-host server 기능이 한 파일에 집중되어 있다. | route 추가/변경 시 인증, registry, proxy, update side effect를 놓치기 쉽다. |
| `packages/pc-connector-daemon/src/bin.ts` | 약 1100줄. CLI parsing, login task, register, legacy cleanup, daemon start가 섞여 있다. | 설치/등록 관련 수정이 다른 CLI 명령을 깨기 쉽다. |
| `packages/behaviors/remote-claude/src/index.ts` | 약 1160줄. behavior method registry와 Claude 기능이 한 파일에 많다. | 세션/권한/스킬/usage 변경이 서로 영향을 줄 수 있다. |
| 테스트 | 프론트 테스트와 일부 self-host smoke가 많다. | 실제 다른 Windows PC, firewall, Tailscale, 재부팅 복구는 여전히 수동 검증 의존도가 높다. |

## 핵심 원칙

1. 큰 파일을 바로 쪼개지 않는다.

   먼저 pure helper와 typed model을 추출하고, 기존 컴포넌트가 그 helper를 호출하게 한다. UI 이동은 그 다음이다.

2. happy path를 기준으로 리팩토링하지 않는다.

   각 단계마다 offline, stale token, partial failure, timeout, duplicate row, missing workspace, old connector를 테스트한다.

3. 상태를 UI 문장보다 먼저 모델링한다.

   "오프라인", "설치됨", "등록됨", "사용 가능"은 각각 다른 상태다. UI 문구가 아니라 domain state enum에서 출발해야 한다.

4. API 계약을 먼저 고정한다.

   frontend/backend/daemon/behavior 사이 request와 response를 공유 타입 또는 schema로 고정한다. 실패 응답도 성공 응답만큼 중요하다.

5. 리팩토링 단위는 배포 가능한 단위여야 한다.

   한 단계가 끝날 때마다 typecheck, relevant tests, self-host smoke 중 최소 하나가 통과해야 한다.

## 리팩토링 계획

### Phase 1. 상태 모델과 파생 문구 분리

목표: UI 컴포넌트가 상태를 직접 추론하지 않게 한다.

작업:

- `site-frontend/src/domain/connection-state.ts` 추가
- device, daemon, behavior, Claude run, workspace, update 상태를 하나의 view model로 조합
- `ChatView`의 composer status, sidebar device dot, diagnostics label이 같은 model을 사용하게 변경
- `ConnectionDiagnostics`도 같은 status label helper를 사용

happy path 금지 테스트:

- device 없음
- device row는 있으나 daemon offline
- daemon online이나 behavior not ready
- stale connector version
- workspace root 밖 경로
- run streaming 중 connection status 변경

완료 기준:

- `connection-status.test.ts`가 상태 조합별로 통과
- UI snapshot성 invariant가 status 문구 중복을 검사
- 정상 online 상태에서는 불필요한 상태 문구가 뜨지 않음

### Phase 2. `ChatView`를 controller와 panels로 분리

목표: 거대 컴포넌트의 변경 반경을 줄인다.

추출 순서:

1. `useDeviceSelection`
2. `useSessionSelection`
3. `useRunStream`
4. `useContextUsage`
5. `usePermissionMode`
6. `ChatLayout`
7. `ComposerArea`
8. `SidebarController`

주의:

- 처음부터 JSX를 크게 이동하지 않는다.
- signal 이름과 localStorage key는 그대로 둔다.
- 기존 테스트가 참조하는 DOM label과 aria는 유지한다.

happy path 금지 테스트:

- 새로고침 후 device 선택 유지
- 새로고침 후 session 선택 유지
- 삭제된 session id가 저장소에 남아 있을 때 자동 보정
- streaming 중 SSE 재연결
- composer send 후 scroll 조건
- attachment send 실패 후 draft 복구

완료 기준:

- `ChatView.tsx`가 1500줄 이하
- session/device/run/context 각각 독립 test 가능
- 기존 `chat-view-devices-refresh.test.tsx`가 통과

### Phase 3. 설정 다이얼로그를 영역별 모듈로 분리

목표: `App.tsx`에서 settings 내부 복잡도를 제거한다.

추출 대상:

- `SettingsDialog`
- `GeneralSettingsTab`
- `DeviceSettingsTab`
- `DiagnosticsSettingsTab`
- `GlobalInstructionsSettingsTab`
- `HelpSettingsTab`
- `UpdateSettingsPanel`

happy path 금지 테스트:

- 설정 열기 옵션이 특정 tab/deviceId로 들어오는 경우
- device 제거 후 목록 갱신
- server device는 개별 제거 불가
- 전체 제거/cleanup 안내
- update running/succeeded/failed 상태
- 옵션 적용 범위 label 확인: `server`, `current device`, `current session`, `browser`

완료 기준:

- `App.tsx`가 900줄 이하
- settings tab별 테스트 파일 분리
- 도움말 문구와 실제 설정 항목 불일치 검사

### Phase 4. Backend route를 기능별 router로 분리

목표: `site-backend/src/app.ts`를 routing table 중심으로 줄인다.

추출 대상:

- `routes/auth.ts`
- `routes/devices.ts`
- `routes/proxy.ts`
- `routes/self-update.ts`
- `routes/self-server.ts`
- `routes/commands.ts`
- `routes/legal.ts`

공통화:

- auth guard
- JSON body parser
- error response builder
- device lookup
- daemon proxy helper

happy path 금지 테스트:

- missing/invalid Site token
- deleted device id
- daemon unreachable
- daemon token mismatch
- update command failure
- command file generation failure
- request body schema mismatch

완료 기준:

- `app.ts`가 app composition만 담당
- route별 test가 실패 응답 shape까지 검사
- frontend가 의존하는 error message key가 깨지지 않음

### Phase 5. Daemon CLI와 설치 reconcile 분리

목표: `bin.ts`가 CLI entry만 맡고, 설치/등록/해제가 재실행 가능한 operation이 되게 한다.

추출 대상:

- `commands/start.ts`
- `commands/register-self.ts`
- `commands/login-task.ts`
- `commands/uninstall.ts`
- `commands/auth-token.ts`
- `commands/doctor.ts`
- `operations/reconcile-install.ts`
- `operations/reconcile-registration.ts`

happy path 금지 테스트:

- `$HOME\deskrelay` 없음
- 다른 repo가 같은 경로에 있음
- dirty repo
- Bun 없음
- Git 없음
- port 18091 점유
- stale auth token
- login task 이미 존재
- server URL 접근 불가
- server는 접근 가능하지만 target daemon 접근 불가

완료 기준:

- 등록 명령 3회 반복 실행 시 같은 device row로 수렴
- 실패 단계별 exit code와 JSON result가 있음
- 사람이 읽는 메시지는 JSON result에서 파생

### Phase 6. Behavior method registry 분리

목표: `remote-claude/src/index.ts`를 작게 만들고, 기능별 실패를 독립적으로 다룬다.

추출 대상:

- `methods/sessions.ts`
- `methods/permissions.ts`
- `methods/skills.ts`
- `methods/instructions.ts`
- `methods/context-usage.ts`
- `methods/files.ts`
- `methods/system.ts`

happy path 금지 테스트:

- Claude CLI 미설치
- Claude 로그인 안 됨
- cwd 없음
- workspace root 밖 경로
- session jsonl 없음
- skill path 없음
- `/usage` parsing 실패
- image preview path 접근 실패

완료 기준:

- method별 request/response type 존재
- method registry는 이름과 handler mapping만 담당
- 실패 응답이 frontend 표시 문구와 연결됨

### Phase 7. Doctor를 단일 진실 소스로 만든다

목표: UI, CLI, 로그가 같은 진단 모델을 공유한다.

진단 노드:

- server process
- site token
- frontend/backend reachability
- device registry row
- selected device daemon URL
- daemon token match
- local daemon process
- advertised daemon reachability
- login task
- behavior loaded
- Claude CLI account
- workspace roots
- update status

happy path 금지 테스트:

- 각 노드별 `ok`, `warning`, `failed`, `unknown`
- 여러 노드가 동시에 실패
- offline device와 stale device 구분
- server PC device와 other PC device 구분
- browser token 없음

완료 기준:

- CLI `doctor --json`
- backend `/api/diagnostics/full`
- settings diagnostics tab이 같은 모델 렌더링
- troubleshooting README가 doctor code 기준으로 작성됨

### Phase 8. 문서와 command 파일 생성 규칙 통합

목표: README, 메인 화면, command txt, 도움말이 다른 말을 하지 않게 한다.

작업:

- command 생성 template을 코드와 문서에서 공유
- README의 설치 명령과 실제 `write-self-commands.ps1` 결과 비교 테스트
- 설정 도움말과 실제 설정 항목 key 비교 테스트
- forbidden term scan에 product/SaaS/Cloudflare/MSIX 잔재 검사 유지

happy path 금지 테스트:

- 서버 URL이 Tailscale만 있을 때
- LAN만 있을 때
- token 없음
- command 파일 생성 실패
- README 명령과 생성 명령 불일치

완료 기준:

- `test:selfhost-docs`가 README, 도움말, command 파일 샘플까지 검사
- command가 바뀌면 문서 테스트가 실패

## 리팩토링 순서

| 순서 | 이유 |
|---:|---|
| 1. 상태 모델 | 이후 UI 분리의 기준점이 된다. |
| 2. ChatView hooks | 가장 큰 변경 반경을 줄인다. |
| 3. Settings 분리 | 현재 사용자-facing 안정성 기능이 모여 있어 자주 바뀐다. |
| 4. Backend routes | API 실패 shape를 안정화한다. |
| 5. Daemon CLI reconcile | 설치/등록 신뢰의 핵심이다. |
| 6. Behavior methods | Claude 기능별 회귀를 줄인다. |
| 7. Doctor 통합 | 파워유저 도구로서 신뢰를 만든다. |
| 8. 문서/command 통합 | 사용자에게 주는 명령과 실제 코드가 어긋나는 문제를 막는다. |

## 하지 말아야 할 것

- `ChatView`를 한 번에 여러 파일로 잘라내지 않는다.
- UI 레이아웃 개선과 domain refactor를 같은 PR/커밋에 섞지 않는다.
- 설치 스크립트를 성공 흐름 기준으로만 단순화하지 않는다.
- 기존 localStorage key를 임의로 바꾸지 않는다.
- "오프라인" 하나로 여러 실패를 합치지 않는다.
- 테스트가 없는 상태에서 daemon/register/backend route를 구조 변경하지 않는다.

## AI 작업 규칙

AI가 이 프로젝트를 수정할 때는 다음 순서를 지킨다.

1. 변경하려는 기능의 소유 모듈을 먼저 찾는다.
2. 성공 흐름이 아니라 실패 흐름 목록을 먼저 적는다.
3. 기존 테스트가 어느 실패를 막고 있는지 확인한다.
4. pure helper를 먼저 추출하고 테스트한다.
5. UI 이동은 마지막에 한다.
6. 타입체크와 관련 테스트를 통과한 뒤 전체 테스트 또는 smoke를 고른다.
7. README, 도움말, command 파일 영향이 있으면 문서를 함께 갱신한다.

## 1차 실행 후보

가장 먼저 할 만한 실제 작업은 `ChatView`의 `useContextUsage` 또는 `usePermissionMode` 추출이다.

추천은 `usePermissionMode`다.

이유:

- 범위가 session streaming 전체보다 작다.
- 현재 composer status, sidebar permission picker, run request와 연결되어 있어 실사용 가치가 있다.
- happy path가 아닌 mismatch, unknown, pending 상태 테스트를 만들기 좋다.
- 성공하면 이후 `useRunStream` 추출의 연습이 된다.

1차 완료 기준:

- `src/hooks/usePermissionMode.ts` 또는 `src/domain/permission-mode-state.ts` 추가
- `permissionModeAlertText`, confirmed/requested/lastRequested 상태 전이 테스트
- `ChatView`의 권한 모드 관련 signal 수 감소
- 기존 `chat-view-devices-refresh.test.tsx` 통과

## 최종 목표

AI가 유지보수하기 쉬운 DeskRelay는 "파일이 작다"가 목표가 아니다. 목표는 AI가 요청을 받았을 때 다음을 빠르게 판단할 수 있는 구조다.

- 이 변경은 어느 domain을 건드리는가?
- 성공 외에 어떤 실패 상태가 있는가?
- API 계약은 어디에 정의되어 있는가?
- UI 문구는 어떤 상태 모델에서 파생되는가?
- 어떤 테스트가 회귀를 막는가?

이 질문에 5분 안에 답할 수 있으면 유지보수성이 좋아진 것이다. 지금 DeskRelay는 기능이 앞서 있고 구조가 따라가는 중이다. 리팩토링은 기능을 줄이는 작업이 아니라, 이미 생긴 힘을 AI와 사람이 안전하게 다룰 수 있게 손잡이를 다는 작업이다.
