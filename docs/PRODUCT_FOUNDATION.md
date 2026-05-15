# DeskRelay Product Foundation

이 문서는 DeskRelay가 어떤 모양으로 발전해야 하는지 판단하기 위한 기준 문서다. 기능을 추가하거나 UI를 바꿀 때는 먼저 이 문서의 제품 문장, 핵심 시나리오, 화면 역할에 맞는지 확인한다.

## 제품 한 문장

DeskRelay는 내 PC 위에서 여러 AI CLI를 감독하고 조율하는 self-host 개발 관제실이다.

## 판단 원칙

- 이 기능이 설치, 등록, 복구를 돕는가? 그러면 메인 화면의 책임이다.
- 이 기능이 일반 Claude 작업을 돕는가? 그러면 채팅 화면의 책임이다.
- 이 기능이 시스템 진단, 운영, 작업 지시를 돕는가? 그러면 Manager Assistant의 책임이다.
- 이 기능이 여러 worker의 진행 상황을 보여주는가? 그러면 작업판의 책임이다.
- 이 기능이 옵션, 범위, 업데이트, 지침을 다루는가? 그러면 설정의 책임이다.
- 위 다섯 곳 중 어디에도 명확히 속하지 않으면 보류한다.

## 용어 사전

| 용어 | 의미 | UI에서 보여줄 때 |
| --- | --- | --- |
| Server | DeskRelay self-host 웹 서버가 실행되는 PC 또는 프로세스 | 서버 상태, 업데이트, 토큰, 접속 URL |
| Connector | 각 PC에서 로컬 Claude CLI와 파일 시스템에 접근하는 로컬 프로세스 | 연결됨, 실행 중 아님, 업데이트 필요 |
| Daemon | Connector의 실행 인스턴스 | 사용자에게는 보통 Connector로 표현 |
| Device | Server에 등록된 PC 단위 | 디바이스 선택, 등록, 제거 |
| Browser Client | DeskRelay에 접속한 브라우저 | 브라우저 설정, 캐시, 선택 유지 |
| Session | Claude CLI 대화 세션 | 세션 목록, 선택 유지, 삭제 |
| Manager Assistant | DeskRelay를 진단하고 worker를 감독하는 관리자 대화 | 관리자, 운영, 진단 |
| Worker | Manager가 역할별로 실행하거나 재사용하는 CLI 세션 | agent, role, 상태, 마지막 결과 |
| Round | 여러 worker가 같은 목표를 향해 한 번씩 작업하는 묶음 | R1, R2 같은 반복 단위 |
| Task | worker에게 내려간 개별 작업 | 실행 중, 완료, 실패, 차단 |
| Artifact | worker가 만든 파일, 문서, 코드, 보고서 | 산출물 |
| Protocol | worker 협업 방식, 파일 규칙, 검수 규칙 | 오케스트레이션 운영 규칙 |
| Workspace | 작업 대상 프로젝트 폴더 | cwd, 작업 폴더, 프로젝트 |

## 핵심 시나리오

### 1. 다른 PC를 등록하고 브라우저에서 Claude CLI를 안정적으로 쓴다

사용자는 서버 PC를 켜고, 다른 PC에서 등록 명령을 실행한 뒤, 브라우저에서 해당 PC의 Claude CLI를 사용할 수 있어야 한다.

성공 화면:

- 현재 브라우저가 어떤 상태인지 표시된다.
- 서버 URL과 Site token이 명확하다.
- 다른 PC 등록 명령이 복사 또는 실행 가능하다.
- 등록 후 디바이스 목록에 새 PC가 자동 반영된다.
- 선택한 디바이스가 실제로 명령 실행 가능한 상태인지 표시된다.

실패를 반드시 다룰 것:

- Git 없음.
- Bun 없음.
- Tailscale 없음.
- 방화벽 차단.
- 포트 점유.
- 오래된 connector 실행 중.
- token 불일치.
- server는 보이지만 connector에 접근 불가.

### 2. Manager Assistant가 시스템과 프로젝트 상태를 진단하고 복구를 돕는다

사용자는 "상태 봐줘", "업데이트 해줘", "왜 연결 안 돼?" 같은 자연어 요청을 할 수 있어야 한다. Manager는 필요한 API를 직접 선택해 확인하고, 사용자가 조치할 수 있는 결과만 정리해야 한다.

성공 화면:

- Manager 대화는 일반 채팅처럼 유지된다.
- Manager가 무엇을 하는 중인지 상태줄에 보인다.
- 진단 결과는 문제, 근거, 다음 행동으로 나뉜다.
- 사용자가 누를 수 있는 버튼 또는 실행할 수 있는 명령이 제공된다.
- 불필요한 내부 구현 정보는 숨긴다.

실패를 반드시 다룰 것:

- 원격 디바이스 timeout.
- manager API timeout.
- update restart pending.
- stale running agent.
- 오래된 worker 상태.
- 배포 또는 재시작 후 manager 대화 손실.

### 3. Manager Assistant가 여러 worker CLI를 역할별로 운영하며 프로젝트를 라운드 단위로 개선한다

사용자는 큰 목표를 준다. Manager는 직접 전부 구현하지 않고 역할을 나누고, worker를 실행하고, 결과를 검수하고, 프로토콜을 개선한다.

성공 화면:

- 현재 목표와 round가 보인다.
- worker별 역할, 상태, 세션, 마지막 결과 시간이 보인다.
- 같은 role/profile/cwd worker는 다음 round에서도 같은 세션을 재사용한다.
- 차단된 작업과 실패 사유가 분리되어 보인다.
- 산출물과 프로토콜 변경이 추적된다.
- 다음 round에서 무엇이 개선됐는지 확인할 수 있다.

실패를 반드시 다룰 것:

- Manager가 혼자 구현하려 함.
- worker가 매 round 새 세션으로 흩어짐.
- worker 결과를 검수하지 않음.
- 실패가 문서화되지 않음.
- 너무 많은 세션이 목록을 오염시킴.
- 작업판 시각화가 실제 상태와 어긋남.

## 화면 역할

| 화면 | 책임 | 넣지 말 것 |
| --- | --- | --- |
| 메인 화면 | 설치, 등록, 복구, 현재 브라우저 상태 판별 | 일반 채팅 기능, 세부 로그 |
| 채팅 화면 | 선택 디바이스의 일반 Claude 작업 | 설치 설명, 관리자 전용 복구 UI |
| Manager Assistant | 진단, 운영, 지시, worker 감독 | 일반 채팅과 무관한 장식적 시각화 |
| 작업판 | round, worker, task, artifact, protocol 상태 | 일반 대화 입력만 있는 화면 |
| 설정 | 옵션, 범위, 업데이트, 지침, 로그아웃 | 메인 화면이 감당하는 설치 wizard 중복 |

## 오케스트레이션 실험 규칙

오케스트레이션 검증용 프로젝트는 결과물의 완성도보다 협업 프레임워크가 제대로 작동하는지를 본다.

필수 확인:

- Manager가 목표를 역할로 분해했는가.
- 각 worker가 분리된 역할을 받았는가.
- worker 세션이 유지되는가.
- worker가 만든 산출물을 Manager가 검수했는가.
- 실패가 구조화되어 기록됐는가.
- 다음 round에서 프로토콜이 개선됐는가.
- 사용자가 중간 상태를 이해할 수 있는가.

권장 기본 파일:

- ORCHESTRATION.md
- AGENTS.md
- PROTOCOL.md
- TASKS.md
- STATE.md
- FAILURES.md
- ARTIFACTS.md
- PROJECT.md

## 라운드 리뷰 루틴

각 round가 끝나면 다음 질문으로 판단한다.

| 질문 | 통과 기준 |
| --- | --- |
| 어떤 역할이 생겼나? | role과 책임이 겹치지 않는다. |
| worker가 실제로 일했나? | task 결과와 산출물이 있다. |
| 같은 worker가 이어졌나? | session id가 유지된다. |
| Manager가 검수했나? | worker 결과에 대한 판단이 기록된다. |
| 실패가 남았나? | failure가 원인과 다음 행동으로 분류된다. |
| 프로토콜이 좋아졌나? | 다음 round에서 반복 실수가 줄어든다. |
| 사용자가 현재 상태를 이해할 수 있나? | 작업판 또는 보고서만 보고도 다음 상태를 알 수 있다. |

## 다음 구현 순서

1. Manager summary와 diagnostics가 느린 원격 디바이스 때문에 막히지 않게 분리한다.
2. stale running agent를 정리하거나 "검증 필요" 상태로 낮추는 기능을 만든다.
3. Manager worker 세션 표를 추가해 role, cwd, session id, 마지막 결과 시간을 보여준다.
4. 작업판 시각화를 현재 round 중심의 세로 상태 그래프로 정리한다.
5. 오케스트레이션 이벤트를 backend event bus로 내보내고 브라우저 캐시에 반영한다.
6. 다른 PC 등록 wizard를 stale connector, token mismatch, firewall, Tailscale 없음 기준으로 보강한다.

## 기능 추가 체크리스트

새 기능을 넣기 전 다음을 확인한다.

- 어느 핵심 시나리오를 강화하는가?
- 어느 화면의 책임인가?
- server, current device, current session, browser 중 어느 범위인가?
- 실패했을 때 사용자가 할 수 있는 행동이 있는가?
- manager가 직접 해야 할 일인가, worker에게 맡겨야 할 일인가?
- 기록으로 남겨야 하는가, 일시 상태로만 보여줘도 되는가?
- happy path 외에 최소 3개의 실패 케이스가 있는가?
