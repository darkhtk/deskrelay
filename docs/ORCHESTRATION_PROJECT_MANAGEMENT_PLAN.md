# 오케스트레이션 프로젝트 관리 현황 및 개선 계획

기준일: 2026-05-20  
대상 브랜치: `api-ai-assistant`

DeskRelay의 오케스트레이션은 단순한 CLI 실행 로그가 아니라, 사용자가 만들고 싶은 결과물을 여러 에이전트와 함께 진행하는 작업 지휘판이어야 한다. 이 문서는 초기 Phase 계획이 아니라, 현재 구현 상태를 기준으로 남은 개선 방향을 정리한다.

## 목표

- 오케스트레이션의 최상위 단위를 `Project`로 둔다.
- 라운드, 에이전트, 작업, 실행, 산출물, 결정, 차단 요소, 승인 액션을 프로젝트 기준으로 추적한다.
- 관리자 Assistant는 직접 구현자가 아니라 감독자다. 목표를 정리하고, worker에게 위임하고, 결과를 검증하고, 사용자에게 필요한 판단만 요청한다.
- 사용자는 작업 탭에서 “지금 무엇을 하는 중인지”, “내가 눌러야 할 것이 있는지”, “결과가 충분한지”를 먼저 볼 수 있어야 한다.
- 일반 채팅창은 사용자가 직접 바꾸라고 하지 않는 한 변경하지 않는다. 오케스트레이션 UX 개선은 관리자 대화와 작업 탭 안에서 처리한다.

## 핵심 원칙

- 작업 탭은 PM 도구가 아니라 AI/CLI 오케스트레이션 운영 도구다.
- 정보 위계는 `현재 판단 -> 필요한 행동 -> 실행 상태 -> 상세 기록` 순서다.
- command-flow가 canonical state다. 오래된 assistant 대화나 stale snapshot이 command-flow를 덮어쓰면 안 된다.
- 반복 폴링, heartbeat, 내부 감시 로그는 사용자가 읽는 대화에 쌓지 않는다.
- 승인 게이트는 항상 최신 상태를 preflight로 확인한 뒤 실행한다.
- 상태가 다르면 조용히 진행하지 않는다. 관리자 상태 표시, 실제 command-flow, 승인 게이트, worker 상태가 다르면 먼저 불일치를 해소한다.

## 현재 구현 상태

### 완료됨

- 프로젝트 단위 관리
  - `ManagerProject` 기반 프로젝트 생성, 목록, 상세, 수정, archive.
  - `.deskrelay/projects` 기반 파일 저장.
  - 프로젝트 생성 시 orchestration-lab base protocol 복제 선택.

- 프로젝트 하위 데이터 연결
  - round, agent, task, worker run을 projectId로 묶음.
  - 프로젝트 선택에 따라 작업 탭 데이터가 필터링됨.

- command-flow
  - `GET /api/manager/projects/:id/command-flow`가 작업 탭의 기준 상태를 제공.
  - readiness, active round, next action, judgments, blockers, artifacts, worker runs, protocol trace를 한 번에 읽을 수 있음.
  - 관리자 prompt도 command-flow를 우선 상태로 보도록 지침이 들어가 있음.

- 작업 탭 현재 판단
  - “현재 단계”와 “필요한 행동”을 분리 표시.
  - stale orchestration snapshot이 현재 판단을 덮어쓰지 않도록 방어.
  - focus, visibility, pageshow 복귀 시 작업 탭 상태 새로고침.

- 오케스트레이션 순서도
  - mermaid가 아니라 상태 노드 순서도로 전체 상태를 보여줌.
  - 현재 상태가 하이라이트됨.
  - `기획 -> 시작 준비 -> 실행 -> 감시 -> 승인 대기 -> 승인 처리 -> 결과 검토 -> 방향 수정 -> 종료/막힘` 흐름을 표시.

- 승인 게이트
  - 승인 전 preflight 검증.
  - stale action 정리.
  - command-flow judgment가 비어 있어도 최신 snapshot approval action을 버튼으로 표시.
  - “다음 실제 라운드 시작”, “프로젝트 완료 승인” 같은 현재 실행 가능한 행동만 노출.

- 에이전트 현황
  - 세로 한 줄 목록.
  - 기본은 이름과 상태만 표시.
  - 클릭 시 세부 정보 펼침.
  - JSON처럼 보이는 정보는 사람이 읽기 좋은 형태로 렌더링하는 방향으로 정리됨.

- 관리자 대화 일부 정리
  - 관리자/사용자 라벨 제거.
  - markdown 렌더링 개선.
  - 내부 notification, timeout chatter, healthz, heartbeat, polling류 노이즈 필터링.
  - 라운드 박스/상세 로그 임베딩 제거.
  - 진행 중 상태는 최신 상태 슬롯으로 분리.
  - 일반 대화 목록에 관리자 대화가 섞이지 않도록 분리.

- 프로젝트 폴더 열기
  - AI에게 요청하는 방식이 아니라 즉시 실행 API로 처리.

- 언어팩
  - 한국어 기본, 영어 선택 방향.
  - 작업 탭의 주요 문구는 언어팩 대상으로 이동 중.

### 부분 완료 또는 계속 검증 필요

- 관리자 대화 응답 표시
  - streaming 응답은 같은 턴에 즉시 대화에 붙도록 보강됨.
  - 오래 걸리는 관리자 CLI는 keepalive status를 보내며 `생각 중` 상태를 유지함.
  - 실제 장시간 Godot 라운드에서 반복 검증 필요.

- worker 장기 실행
  - worker는 임의 hard timeout으로 실패 처리하면 안 됨.
  - 살아 있는지 확인하고, 응답이 끝날 때까지 기다리는 liveness 정책이 더 명확해야 함.

- 외부 접속
  - 로컬 접속은 동작하지만, 외부 접근이 막히는 사례가 반복됨.
  - 서버 bind, advertised URL, Windows 방화벽, connector tunnel 상태를 하나의 진단 UX로 묶어야 함.

- 오케스트레이션 결과 실행
  - “빌드 버전별 실행”은 DeskRelay 업데이트 설정이 아니라, 오케스트레이팅 중인 프로젝트 산출물 실행 목록이어야 함.
  - 프로젝트 artifact/build 목록에서 클릭 즉시 실행하는 흐름이 필요함.

- 관리자 대화 출력 UX
  - 기본 대화 출력은 카드/라벨 없이 본문 중심으로 정리됨.
  - 남은 검증은 실제 장시간 오케스트레이션에서 완료 요약이 1개만 남는지 확인하는 것.

## 현재 데이터 모델

```text
Project
  ├─ Charter
  ├─ Protocol
  ├─ Command Flow
  ├─ Rounds
  │   ├─ Agents
  │   ├─ Tasks
  │   ├─ Worker Runs
  │   └─ Round Review
  ├─ Judgments
  ├─ Approval Actions
  ├─ Artifacts
  ├─ Decisions
  ├─ Blockers
  ├─ Hygiene
  └─ Timeline / Evidence
```

## 주요 API 표면

```text
GET    /api/manager/projects
POST   /api/manager/projects
GET    /api/manager/projects/:id
PATCH  /api/manager/projects/:id
POST   /api/manager/projects/:id/archive
POST   /api/manager/projects/:id/open-folder

GET    /api/manager/projects/:id/overview
GET    /api/manager/projects/:id/command-flow
GET    /api/manager/projects/:id/orchestration

GET    /api/manager/projects/:id/rounds
GET    /api/manager/projects/:id/agents
GET    /api/manager/projects/:id/tasks
GET    /api/manager/projects/:id/runs

GET    /api/manager/projects/:id/protocol
POST   /api/manager/projects/:id/protocol/scan
PATCH  /api/manager/projects/:id/protocol
GET    /api/manager/projects/:id/protocol-trace

GET    /api/manager/projects/:id/decisions
POST   /api/manager/projects/:id/decisions
PATCH  /api/manager/projects/:id/decisions/:decisionId

GET    /api/manager/projects/:id/blockers
POST   /api/manager/projects/:id/blockers
POST   /api/manager/projects/:id/blockers/:blockerId/resolve

GET    /api/manager/projects/:id/artifacts
POST   /api/manager/projects/:id/artifacts/scan
PATCH  /api/manager/projects/:id/artifacts/:artifactId

GET    /api/manager/projects/:id/hygiene
POST   /api/manager/projects/:id/hygiene/cleanup
```

## 작업 탭 UX 기준

```text
작업 탭
  ├─ 관리자 대화
  │   ├─ 사용자 지시
  │   ├─ 관리자 최종 응답 요약
  │   └─ 진행 중 최신 상태 1개
  └─ 프로젝트 작업판
      ├─ 프로젝트 선택 / 폴더 열기
      ├─ 현재 판단
      ├─ 오케스트레이션 순서도
      ├─ 승인 게이트
      ├─ 에이전트 현황
      ├─ 라운드 / 작업 / 실행
      ├─ 산출물 / 빌드 실행
      ├─ 프로토콜
      ├─ 결정 / 차단 요소
      └─ 상세 로그 / 위생
```

표시 원칙:

- `현재 판단`은 사용자가 지금 무엇을 해야 하는지만 말한다.
- `오케스트레이션 순서도`는 전체 상태와 현재 위치를 보여준다.
- `승인 게이트`는 사용자가 눌러야 할 실행 가능한 버튼만 보여준다.
- `에이전트 현황`은 기본적으로 접혀 있어야 한다.
- 상세 로그는 기본 흐름을 방해하지 않는 위치에 둔다.

## 관리자 대화 출력 정책

목표: 관리자 대화는 일반 AI 모델 대화처럼 읽혀야 한다. 내부 감시 로그를 메시지로 쌓는 로그 뷰어가 되면 안 된다.

### 메시지 형태

- 메시지를 라운드 박스나 카드로 감싸지 않는다.
- 사용자에게 필요한 대화 본문만 자연스럽게 표시한다.
- markdown은 일반 채팅과 같은 품질로 렌더링한다.
- 관리자/사용자 같은 반복 라벨은 표시하지 않는다.

### 진행 중 상태

- 진행 중에는 최신 상태 하나만 표시한다.
- 예:
  - `생각 중`
  - `작업 확인 중`
  - `worker 응답 대기`
  - `승인 대기`
  - `결과 정리 중`
- 새 상태가 오면 이전 상태를 대체한다.
- 진행 상태는 대화 메시지로 누적하지 않는다.

### 폴링/감시 로그

- 폴링 횟수, heartbeat, health check, internal notification은 관리자 대화에 출력하지 않는다.
- 필요한 경우 작업 탭의 상세 로그나 디버그 영역에만 남긴다.
- 기본 화면에서는 접힌 상태로 둔다.

### 완료 응답

- 작업이 끝나면 요약 메시지 하나를 남긴다.
- 요약에는 다음만 포함한다.
  - 수행한 일
  - 확인된 결과
  - 남은 문제
  - 사용자가 선택해야 할 행동
- retry, stale cleanup, polling, 내부 API 호출 같은 내용은 사용자가 알아야 할 때만 포함한다.

### 메시지 분류

```text
user-visible summary  -> 관리자 대화에 누적
live status           -> 최신 상태 슬롯에만 표시
internal event        -> 상세 로그
debug log             -> 상세 로그 / 개발자용
```

## 승인 게이트 정책

- 버튼은 현재 실행 가능한 action만 보여준다.
- 클릭 전에는 항상 최신 command-flow와 orchestration snapshot을 다시 읽는다.
- 라운드가 바뀌었거나 task가 이미 성공했으면 실행하지 않고 stale action을 정리한다.
- command-flow judgment가 비어 있어도 snapshot approval action이 최신이면 버튼을 표시한다.
- 승인 액션 실행 결과는 작업 탭 상태를 새로고침한 뒤 보여준다.
- 승인 실패 메시지는 원인과 다음 행동을 함께 보여준다.

## 상태 일관성 정책

상태 표시가 어긋나면 아래 우선순위로 판단한다.

1. `command-flow`
2. 최신 `orchestration snapshot`
3. task/round/agent API
4. manager assistant status report
5. manager chat history

예:

- 관리자 상태가 `대기 중`인데 command-flow가 `승인 대기`면 `승인 대기`가 우선이다.
- snapshot이 `감시 중`인데 active round가 이미 `completed`면 snapshot을 stale로 본다.
- 대화 기록이 “작업 중”이어도 task API가 `succeeded`면 완료 상태가 우선이다.

## 남은 개선 우선순위

### P0. 관리자 대화 출력 정리

- 상태: 구현 완료, 장시간 실사용 검증 필요.
- 메시지 라운드 박스 제거.
- 폴링/감시 로그 누적 제거.
- live status 단일 슬롯 구현.
- 완료 후 요약만 대화에 남김.
- 관리자 대화 markdown 렌더링을 일반 채팅 수준으로 통일.

검증:

- 긴 작업을 지시해도 대화창에 폴링 로그가 반복 누적되지 않아야 한다.
- 진행 중에는 최신 상태만 바뀌어야 한다.
- 완료 후에는 요약 메시지 하나만 남아야 한다.

### P0. 관리자 응답 즉시성

- 상태: streaming/keepalive 경로 구현 완료, 실제 장시간 오케스트레이션 검증 필요.
- 관리자 응답이 다음 사용자 지시 때 늦게 표시되는 문제를 없앤다.
- streaming 또는 polling 결과 반영 경로를 분리해, assistant 응답 완료 시 즉시 대화에 반영한다.
- timeout 문구를 그대로 노출하지 않고, 살아 있는 작업이면 `생각 중` 또는 `worker 응답 대기`로 유지한다.

검증:

- 사용자가 관리자에게 질문하면 같은 턴에 응답이 보인다.
- 긴 작업 중에도 상태가 멈춘 것처럼 보이지 않는다.

### P0. worker liveness / timeout 정책

- 상태: worker hard timeout 제거와 liveness 기록은 구현됨. UI 표시와 실제 Godot 라운드 검증이 남음.
- worker는 고정 시간 초과만으로 실패 처리하지 않는다.
- heartbeat, stdout/stderr 변화, 프로세스 생존, 산출물 변화로 살아 있음을 판단한다.
- 죽은 worker와 오래 걸리는 worker를 구분한다.

검증:

- 장시간 Godot 개발 라운드가 단순 600000ms 초과로 실패 처리되지 않는다.
- worker가 살아 있으면 UI는 계속 `worker 응답 대기` 또는 구체 상태를 표시한다.

### P1. 프로젝트 산출물 실행

- 오케스트레이팅 중인 프로젝트의 build/artifact 목록을 보여준다.
- 빌드 버전별 실행은 설정창이 아니라 프로젝트 산출물 영역에서 처리한다.
- 실행 가능한 artifact를 클릭하면 즉시 실행한다.

검증:

- Godot 프로젝트의 `game.exe` 같은 산출물을 작업 탭에서 바로 실행할 수 있다.
- 없는 파일, 오래된 파일, 실패한 빌드는 명확히 구분된다.

### P1. 외부 접속 진단

- 서버 bind 주소, 외부 URL, Windows 방화벽, connector 상태를 한 화면에서 점검한다.
- “외부 접속 안 됨”의 원인을 추정이 아니라 검증 결과로 보여준다.

검증:

- `127.0.0.1`, LAN IP, advertised URL 각각의 접근 가능 여부를 구분한다.
- 막힌 경우 다음 조치를 제안한다.

### P2. Export / Import / Summary

- 프로젝트 상태 export.
- 프로젝트 import.
- 프로젝트 summary markdown 생성.
- 민감한 토큰과 로컬 인증 정보 제외.

검증:

- export된 자료만으로 프로젝트 진행 이력을 이해할 수 있다.
- import 시 id 충돌과 외부 파일 경로 문제를 안전하게 처리한다.

## 검증 시나리오

### 기본 흐름

1. 프로젝트 생성.
2. 프로토콜 확인.
3. 오케스트레이션 시작.
4. worker 진행 감시.
5. 방향 수정 또는 승인.
6. 결과 확인.
7. 다음 라운드 또는 완료.

### 실패/불일치 흐름

- command-flow와 snapshot이 다른 상태를 말함.
- 승인 버튼이 stale action을 가리킴.
- worker가 오래 걸리지만 살아 있음.
- task는 성공했는데 승인 게이트가 retry를 제안함.
- manager 상태는 대기 중인데 실제 flow는 승인 대기임.
- 외부 접속이 로컬과 다르게 실패함.

### 사용자 관점 흐름

- 사용자는 관리자 대화에서 내부 로그를 읽지 않아도 된다.
- 작업 탭에서 현재 단계와 필요한 행동을 바로 이해한다.
- 승인 버튼을 누르면 실제로 다음 상태로 넘어간다.
- 최종 결과는 산출물과 요약으로 확인한다.

## 다음 작업

1. 관리자 대화 출력 정리부터 구현한다.
2. live status 단일 슬롯과 메시지 분류를 붙인다.
3. 관리자 응답 즉시성 문제를 같은 흐름에서 검증한다.
4. 이어서 worker liveness / timeout 정책을 강화한다.
5. Godot 2D 한국어 프로젝트를 다시 오케스트레이션 대상으로 사용해 전체 흐름을 검증한다.
