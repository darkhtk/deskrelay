# DeskRelay

DeskRelay는 자기 PC에서 실행 중인 Claude Code를 브라우저로 조작하기 위한 self-host 오픈소스 도구다. 출시용 SaaS가 아니라, 파워유저가 자기 장비 안에 띄워 두는 control plane에 가깝다.

## 구조 노드

```mermaid
flowchart LR
  Browser["사용자 브라우저<br/>DeskRelay UI<br/>Site token 로그인"]
  Frontend["Site frontend<br/>packages/site-frontend<br/>세션/권한/스킬/디바이스 UI"]
  Server["Self-host site server<br/>packages/site-backend<br/>:18193<br/>브라우저 API / proxy / self 명령 생성"]
  Registry[("Device registry<br/>server local state<br/>device id / label / daemonUrl / daemon token")]

  subgraph ServerPC["서버 PC"]
    ServerConnector["Connector daemon<br/>packages/pc-connector-daemon<br/>:18091<br/>daemon token"]
    ServerTask["Windows login task<br/>login 시 connector 자동 시작"]
    ServerWorkspace["Workspace roots<br/>CR_CONNECTOR_WORKSPACE_ROOTS"]
    ServerBehavior["Claude behavior host<br/>remote-claude"]
    ServerClaude["Claude Code CLI<br/>세션/권한/usage"]
  end

  subgraph OtherPC["다른 제어 대상 PC"]
    OtherConnector["Connector daemon<br/>:18091<br/>Tailscale/LAN 주소"]
    OtherTask["Windows login task"]
    OtherWorkspace["Workspace roots"]
    OtherBehavior["Claude behavior host"]
    OtherClaude["Claude Code CLI"]
  end

  Network["Tailscale / LAN<br/>server PC -> other PC connector 접근"]

  Browser -->|"HTTP/SSE"| Frontend
  Frontend -->|"API"| Server
  Server --> Registry
  Server -->|"HTTP + daemon token"| ServerConnector
  Server -->|"HTTP + daemon token"| Network
  Network --> OtherConnector

  ServerConnector --> ServerTask
  ServerConnector --> ServerWorkspace
  ServerConnector --> ServerBehavior
  ServerBehavior --> ServerClaude

  OtherConnector --> OtherTask
  OtherConnector --> OtherWorkspace
  OtherConnector --> OtherBehavior
  OtherBehavior --> OtherClaude

  Registry -. "같은 daemonUrl 재등록 시 기존 row 삭제 후 새 row 생성" .-> Server
```

## 연결 그래프

```mermaid
sequenceDiagram
  participant B as 사용자 브라우저
  participant F as Site frontend
  participant S as Self-host site server
  participant R as Device registry
  participant D as 선택된 Connector daemon
  participant H as Claude behavior host
  participant C as Claude Code CLI

  B->>F: UI 조작
  F->>S: API / SSE
  S->>R: device 조회
  S->>D: proxy request + daemon token
  D->>H: behavior 실행
  H->>C: Claude 세션 실행/이어쓰기
  C-->>H: streaming / tool / approval 상태
  H-->>D: run event
  D-->>S: event stream
  S-->>F: SSE
  F-->>B: 세션/권한/스킬/상태 표시
```

## 등록 흐름

```mermaid
flowchart TD
  A["1. 서버 PC에서 self-host site server 실행"]
  B["2. 서버 PC connector daemon 자동 등록"]
  C["3. Settings -> Devices에서 다른 PC 등록 명령 복사"]
  D["4. 다른 PC PowerShell에 등록 명령 붙여넣기"]
  E["5. repository 설치 / connector 시작"]
  F["6. 다른 PC의 Tailscale/LAN daemonUrl 감지"]
  G{"7. 서버가 /status 접근 가능?"}
  H["8. server registry에 device row 등록"]
  I["9. 디바이스 목록에 표시"]
  X["실패: firewall / Tailscale / local-only bind / token 문제를 분리해서 표시"]

  A --> B --> C --> D --> E --> F --> G
  G -->|yes| H --> I
  G -->|no| X
```

## 신뢰 기준

등록됐다는 것과 쓸 수 있다는 것은 다르다. DeskRelay가 믿을 수 있으려면 최소한 아래 조건을 분리해서 확인해야 한다.

```mermaid
flowchart TD
  Install["설치됨<br/>repository와 의존성 있음"]
  Process["실행 중<br/>connector daemon process 있음"]
  Local["로컬 준비<br/>127.0.0.1:18091 /status<br/>daemon token 응답"]
  Remote["외부 접근 가능<br/>server PC -> daemonUrl /status"]
  Registered["등록됨<br/>registry device row 있음"]
  Claude["Claude 준비<br/>behavior host + Claude Code CLI 실행 가능"]
  Workspace["작업 범위 유효<br/>workspace roots가 실제 경로와 맞음"]
  Recovery["자동 복구<br/>login task 설치됨"]
  Usable["사용 가능<br/>브라우저에서 세션 실행 가능"]

  Install --> Process --> Local --> Remote --> Registered --> Claude --> Workspace --> Recovery --> Usable
```

## 파워유저 관점의 핵심 목표

- 같은 설치/등록 명령을 여러 번 실행해도 상태가 망가지지 않아야 한다.
- 실패하면 어느 노드에서 실패했는지 보여줘야 한다.
- 서버와 connector가 서로 접근 가능한지 등록 전에 검증해야 한다.
- token mismatch, local-only bind, firewall, Tailscale 미연결을 하나의 오프라인으로 뭉개면 안 된다.
- UI는 예쁜 온보딩보다 현재 노드 상태와 복구 액션을 보여줘야 한다.
