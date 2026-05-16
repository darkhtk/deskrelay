# Orchestration Project Management Plan

DeskRelay의 오케스트레이션은 단순한 CLI 실행 로그가 아니라, 사용자가 진행 중인 작업을 여러 에이전트와 함께 관리하는 작업 지휘판이어야 한다. 이 문서는 프로젝트 관리 개념을 한 번에 크게 붙이지 않고, 단계적으로 도입하기 위한 개발 계획이다.

## 목표

- 오케스트레이션의 최상위 단위를 `Project`로 명확히 둔다.
- 라운드, 에이전트, 작업, 실행, 산출물, 결정, 차단 요소가 어느 프로젝트에 속하는지 추적한다.
- 관리자 Assistant가 현재 프로젝트 맥락을 기준으로 감독하고 판단하게 한다.
- 사용자는 작업판에서 “지금 무엇을 해야 하는가”를 먼저 보고, 필요할 때 세부 기록으로 들어간다.
- self-host 도구답게 상태는 가능한 한 읽기 쉬운 파일 기반으로 남긴다.

## 핵심 원칙

- Jira나 일반 PM 도구가 아니라 AI/CLI 오케스트레이션 운영 도구로 만든다.
- 현재 판단에 필요한 정보, 조치 가능한 정보, 기록성 정보 순서로 위계를 둔다.
- happy path만 가정하지 않는다. 프로젝트 없음, 오래된 세션, 중복 worker, daemon timeout, 파일 누락, 부분 실패를 기본 케이스로 다룬다.
- 기존 일반 채팅 UI와 일반 세션 관리는 불필요하게 흔들지 않는다.
- 초기 버전은 가볍게 시작하고, 결정/차단/프로토콜/위생 기능은 프로젝트 코어 위에 점진적으로 붙인다.

## 대상 모델

```text
Project
  ├─ Goal
  ├─ State
  ├─ Protocol
  ├─ Rounds
  │   ├─ Agents
  │   ├─ Tasks
  │   ├─ Runs
  │   └─ Results
  ├─ Artifacts
  ├─ Decisions
  ├─ Blockers
  └─ Hygiene
```

## 저장 구조

초기 구현은 DB보다 파일 기반 저장소를 우선한다.

```text
.deskrelay/projects/
  project_<id>/
    project.json
    rounds.jsonl
    agents.jsonl
    tasks.jsonl
    runs.jsonl
    artifacts.jsonl
    decisions.jsonl
    blockers.jsonl
    protocol-state.json
    timeline.jsonl
```

장점:

- 사용자가 직접 읽을 수 있다.
- git으로 추적하거나 백업하기 쉽다.
- 관리자 Assistant와 worker가 파일 기반 프로토콜을 다루기 쉽다.
- self-host 구조와 맞다.

주의:

- 파일 쓰기는 append 중심으로 시작한다.
- 손상된 JSONL 한 줄 때문에 전체 프로젝트가 죽지 않도록 부분 복구를 둔다.
- archive된 프로젝트는 기본 목록에서 숨기되 삭제하지 않는다.

## 개발 단계

### Phase 1. Project Core

목표: 오케스트레이션이 어느 프로젝트에 속하는지 표현한다.

구현:

- `ManagerProject` shared 타입 추가
- 파일 기반 project repository 추가
- 프로젝트 생성, 목록, 상세, 수정, archive API 추가
- 현재 선택 프로젝트를 브라우저 또는 서버 상태에 저장
- 작업 탭 상단에 Project Header 추가

API:

```text
GET    /api/manager/projects
POST   /api/manager/projects
GET    /api/manager/projects/:projectId
PATCH  /api/manager/projects/:projectId
POST   /api/manager/projects/:projectId/archive
```

UI:

- 프로젝트명
- cwd
- goal
- status
- active round
- last update
- next action placeholder

예외 처리:

- 프로젝트가 하나도 없으면 “현재 폴더에서 프로젝트 시작”을 제안한다.
- cwd가 허용 루트 밖이면 생성은 막고 이유를 표시한다.
- project file이 깨져 있으면 해당 프로젝트를 `needs_repair`로 표시한다.
- archive된 프로젝트는 기본 선택 대상에서 제외한다.

완료 기준:

- 프로젝트를 만들고 선택할 수 있다.
- 새로고침 후 선택 프로젝트가 유지된다.
- project metadata가 `.deskrelay/projects` 아래에 저장된다.
- 기존 round/agent 데이터가 없어도 작업판은 깨지지 않는다.

### Phase 2. Round / Agent / Task 연결

목표: 기존 오케스트레이션 데이터를 프로젝트 아래로 묶는다.

구현:

- `round.projectId`
- `agent.projectId`
- `task.projectId`
- `workerRun.projectId`
- round dispatch 시 현재 projectId 자동 연결
- projectId 없는 기존 데이터는 `Unassigned` 그룹으로 표시

API:

```text
GET /api/manager/projects/:projectId/rounds
GET /api/manager/projects/:projectId/agents
GET /api/manager/projects/:projectId/tasks
GET /api/manager/projects/:projectId/runs
```

UI:

- 프로젝트 선택 시 해당 프로젝트의 round/agent/run만 표시
- Unassigned 데이터는 별도 안내로 이동 가능하게 표시

예외 처리:

- round는 있는데 projectId가 없으면 자동 할당하지 않고 사용자 확인 또는 manager 판단으로 이동한다.
- task는 있는데 agent가 없으면 orphan task로 표시한다.
- worker run은 있는데 task가 없으면 run integrity issue로 표시한다.

완료 기준:

- 프로젝트 선택에 따라 Overview, Agents, Runs, Timeline이 필터링된다.
- 기존 데이터는 사라지지 않고 Unassigned로 남는다.
- 새 라운드는 현재 프로젝트에 자동 연결된다.

### Phase 3. Project Overview

목표: 작업판을 로그 뷰어가 아니라 지휘판으로 만든다.

구현:

- Project Header 강화
- 프로젝트 summary 계산
- 현재 라운드, 다음 조치, 마지막 결정, 활성 blocker 표시
- 핵심 숫자 표시: agents, blocked, artifacts, last update

UI:

```text
Project Header
  ├─ Project name / status / cwd
  ├─ Goal
  ├─ Active round
  └─ Next action

Overview
  ├─ Current decision surface
  ├─ Active blocker
  ├─ Agents / blocked / artifacts / last update
  └─ Recent signals
```

예외 처리:

- active round가 없으면 “다음 라운드 시작” 상태로 표시한다.
- 최신 signal이 stale이면 stale 이유를 표시한다.
- blocker가 있지만 user action이 아니면 불필요하게 사용자에게 겁주지 않는다.

완료 기준:

- 사용자는 Overview만 보고 다음 행동을 판단할 수 있다.
- 로그성 정보보다 프로젝트 상태와 조치 정보가 먼저 보인다.

### Phase 4. Decisions

목표: 관리자의 판단을 프로젝트 기록으로 남긴다.

구현:

- `ManagerDecision` 타입 추가
- decision 저장소와 API 추가
- Decisions 탭 추가
- manager가 중요한 판단을 decision으로 남기도록 지침 업데이트

API:

```text
GET  /api/manager/projects/:projectId/decisions
POST /api/manager/projects/:projectId/decisions
PATCH /api/manager/projects/:projectId/decisions/:decisionId
```

Decision 예:

- “R2 worker timeout 정책 폐기”
- “PROTOCOL.md v3 채택”
- “verifier는 구현하지 않고 검증만 수행”
- “게임 완성보다 오케스트레이션 프레임워크 검증 우선”

예외 처리:

- manager가 판단 없이 파일만 수정했으면 decision 생성을 강제하지 않는다.
- decision 수정은 원본을 덮어쓰기보다 revision을 남긴다.
- archive된 decision은 기본 Overview에서 제외한다.

완료 기준:

- 왜 그렇게 진행했는지가 프로젝트에 남는다.
- 다음 라운드가 이전 decision을 참고할 수 있다.

### Phase 5. Blockers

목표: 에러 로그를 조치 가능한 문제로 바꾼다.

구현:

- `ManagerBlocker` 타입 추가
- severity, owner, requiredAction, status 저장
- blocker list/create/resolve API 추가
- Blockers 탭 추가
- health/hygiene/worker failure에서 blocker 후보 생성

API:

```text
GET  /api/manager/projects/:projectId/blockers
POST /api/manager/projects/:projectId/blockers
POST /api/manager/projects/:projectId/blockers/:blockerId/resolve
```

분류:

- `requiredAction: user`
- `requiredAction: manager`
- `requiredAction: worker`
- `requiredAction: none`

예외 처리:

- 동일 원인의 blocker가 반복 생성되지 않도록 dedupe key를 둔다.
- daemon timeout 같은 transient 문제는 즉시 user blocker로 만들지 않는다.
- 사용자가 할 수 없는 내부 신호는 UI에 과도하게 노출하지 않는다.

완료 기준:

- 막힌 이유와 필요한 조치가 분리된다.
- Overview에는 가장 중요한 blocker 하나만 노출된다.

### Phase 6. Artifacts

목표: 산출물을 프로젝트 결과물로 관리한다.

구현:

- `ManagerArtifact` 타입 추가
- artifact scan/index API 추가
- agent output, task result, protocol files에서 path 추출
- artifact status: active, draft, obsolete, failed
- Artifacts 탭 개선

API:

```text
GET  /api/manager/projects/:projectId/artifacts
POST /api/manager/projects/:projectId/artifacts/scan
PATCH /api/manager/projects/:projectId/artifacts/:artifactId
```

예외 처리:

- 파일이 사라졌으면 missing으로 표시하되 전체 탭을 깨지 않는다.
- 허용 루트 밖 파일은 path만 기록하고 열기 액션은 제한한다.
- obsolete artifact는 기본 목록에서 숨길 수 있게 한다.

완료 기준:

- 어떤 파일이 현재 유효한 산출물인지 알 수 있다.
- 프로토콜/리포트/코드/로그가 산출물로 구분된다.

### Phase 7. Protocol

목표: 프로젝트별 오케스트레이션 규칙을 관리한다.

구현:

- protocol file 탐지
- protocol-state 저장
- version, active rules, latest change 표시
- protocol 변경 시 decision과 연결
- Protocol 탭 또는 State 하위 섹션 추가

대상 파일 예:

```text
ORCHESTRATION.md
AGENTS.md
PROTOCOL.md
LOCKS.md
TASKS.md
STATE.md
FAILURES.md
PROJECT.md
```

예외 처리:

- 파일이 없어도 프로젝트는 정상 동작한다.
- protocol 파일이 너무 많으면 기본 핵심 파일만 표시하고 나머지는 접는다.
- manager가 protocol을 수정했지만 decision이 없으면 “unexplained protocol change”로 표시한다.

완료 기준:

- 현재 프로젝트가 어떤 규칙으로 돌아가는지 보인다.
- protocol 변경 이유와 적용 라운드가 남는다.

### Phase 8. Manager Context Injection

목표: 관리자 Assistant가 항상 현재 프로젝트를 알고 행동하게 한다.

구현:

- manager prompt에 current project context 자동 포함
- project goal, cwd, active round, blockers, decisions, artifacts 요약 주입
- 프로젝트 미선택 시 생성/선택을 먼저 수행하도록 지침 강화
- round 생성 시 projectId 자동 연결

주입 예:

```text
Current Project:
- id
- name
- cwd
- goal
- status
- active round
- blockers
- latest decisions
- valid artifacts
- protocol files
```

예외 처리:

- context가 너무 커지면 latest N개 decision/blocker/artifact만 넣는다.
- project가 stale이면 manager에게 먼저 상태 refresh를 지시한다.
- 선택 프로젝트와 cwd가 다르면 확인 후 진행한다.

완료 기준:

- 관리자가 엉뚱한 폴더나 세션을 기준으로 행동하지 않는다.
- 사용자가 “이 프로젝트 계속 감독해”라고 하면 프로젝트 기준으로 이어간다.

### Phase 9. Hygiene / Recovery

목표: 프로젝트 단위 유지보수를 제공한다.

구현:

- project-scoped stale worker 탐지
- duplicate session 탐지
- orphan task/run 탐지
- archived project 숨김
- cleanup preview → confirm → execute

API:

```text
GET  /api/manager/projects/:projectId/hygiene
POST /api/manager/projects/:projectId/hygiene/cleanup
```

예외 처리:

- cleanup은 항상 preview 먼저 제공한다.
- active task/run은 삭제하지 않는다.
- 실패한 cleanup은 report를 남긴다.

완료 기준:

- 오래된 worker/round/session이 프로젝트를 오염시키지 않는다.
- 정리 작업이 안전하게 반복 실행 가능하다.

### Phase 10. Export / Import

목표: 프로젝트 상태를 백업하고 옮길 수 있게 한다.

구현:

- project export
- project import
- project summary markdown 생성
- decisions/blockers/artifacts 포함

API:

```text
GET  /api/manager/projects/:projectId/export
POST /api/manager/projects/import
GET  /api/manager/projects/:projectId/summary.md
```

예외 처리:

- import 시 같은 id가 있으면 새 id로 fork하거나 overwrite 확인을 요구한다.
- 외부 파일 경로는 복구 불가능할 수 있음을 명확히 표시한다.
- 민감한 토큰/로컬 인증 정보는 export하지 않는다.

완료 기준:

- 프로젝트 상태를 백업/공유/이관할 수 있다.
- export된 자료만으로 진행 이력을 이해할 수 있다.

## 추천 구현 순서

1. Phase 1: Project Core
2. Phase 2: Round / Agent / Task 연결
3. Phase 3: Project Overview
4. Phase 4: Decisions
5. Phase 5: Blockers
6. Phase 6: Artifacts
7. Phase 8: Manager Context Injection
8. Phase 7: Protocol
9. Phase 9: Hygiene / Recovery
10. Phase 10: Export / Import

## 2026-05-16 Progress Update

- Phase 1 through Phase 8 are implemented on `api-ai-assistant`.
- Phase 9 first slice is implemented: project-scoped hygiene report plus cleanup that records deduplicated recovery blockers without deleting active task/run state.
- The next planned implementation phase is Phase 10: project export/import and summary generation.

순서를 이렇게 두는 이유는 프로젝트 모델과 연결 관계가 먼저 안정돼야 이후 지능형 기능이 덜 지저분해지기 때문이다.

## 우선 구현 범위

첫 구현 묶음은 Phase 1~3까지만 권장한다.

```text
Project Core
  → Round 연결
  → Project Overview
```

이 범위의 결과물:

- 프로젝트 생성/선택/수정
- 현재 프로젝트 기준으로 라운드/에이전트/런 필터링
- 작업판 상단의 Project Header
- 프로젝트 Overview에서 다음 행동 확인

이 단계까지만 완료돼도 “오케스트레이션이 프로젝트 단위로 관리된다”는 체감이 생긴다.

## 테스트 계획

happy path만 보지 않는다.

### Project Core

- 프로젝트가 없는 상태에서 작업 탭 진입
- 허용 루트 안 cwd로 프로젝트 생성
- 허용 루트 밖 cwd로 프로젝트 생성 시도
- project.json 손상
- archive된 프로젝트가 기본 목록에서 숨겨지는지
- 새로고침 후 선택 프로젝트 유지

### Round 연결

- 새 라운드 생성 시 projectId 자동 연결
- 기존 projectId 없는 round가 Unassigned로 보이는지
- task는 있는데 agent가 없는 경우
- worker run은 있는데 task가 없는 경우
- 프로젝트 전환 시 탭 내용이 섞이지 않는지

### Overview

- active round 없음
- running round 있음
- blocked agent 있음
- stale signal 있음
- artifact 없음
- decision 없음

### Decisions / Blockers

- 같은 blocker 반복 발생 dedupe
- user action blocker와 internal blocker 표시 차이
- decision 수정 시 revision 보존
- resolved blocker가 Overview에서 내려가는지

### Artifacts / Protocol

- 파일 path는 있지만 파일 없음
- 허용 루트 밖 artifact
- obsolete artifact 숨김
- protocol 파일 없음
- protocol 변경 후 decision 없음

### Hygiene / Export

- active worker가 cleanup 대상에서 제외되는지
- cleanup 실패 report 생성
- export에 토큰/인증 정보가 들어가지 않는지
- import id 충돌

## UI 방향

작업 탭은 아래 구조를 목표로 한다.

```text
작업
  ├─ 좌측: 관리자 대화
  └─ 우측: 프로젝트 지휘판
       ├─ Project Header
       ├─ Overview
       ├─ Rounds
       ├─ Agents
       ├─ Artifacts
       ├─ Decisions
       ├─ Blockers
       ├─ Protocol
       ├─ Timeline
       └─ Hygiene
```

표시 원칙:

- Project Header는 작업 탭의 기준점을 제공한다.
- Overview는 판단용이다.
- Agents/Runs는 실행 상태용이다.
- Decisions/Blockers는 관리 기록과 조치용이다.
- Artifacts/Protocol은 산출물과 규칙용이다.
- Timeline은 기록용이다.
- Hygiene은 문제가 있을 때만 강하게 드러난다.

## 구현 리스크

- projectId 연결을 급하게 넣으면 기존 manager round/task 상태와 충돌할 수 있다.
- 관리자 Assistant context가 커지면 응답 품질과 속도가 떨어질 수 있다.
- 파일 기반 저장소는 동시 쓰기와 손상 복구를 명확히 해야 한다.
- 프로젝트 관리 UI가 너무 PM 도구처럼 커지면 DeskRelay의 실행 도구 성격이 흐려진다.

## 다음 액션

가장 좋은 다음 작업은 Phase 1 상세 설계와 구현이다.

1. shared 타입 정의
2. 파일 저장소 구현
3. project API 추가
4. 작업 탭 Project Header 추가
5. 프로젝트 없음/선택/새로고침 유지 테스트
