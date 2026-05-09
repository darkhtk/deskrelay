# DeskRelay

DeskRelay는 자기 PC에서 실행 중인 Claude Code를 브라우저로 조작하기 위한 self-host 오픈소스 도구다. 출시용 SaaS가 아니라, 파워유저가 자기 장비 안에 띄워 두는 control plane에 가깝다.

## Claude Remote와의 냉정한 비교

여기서 말하는 Claude Remote는 사용자가 별도 서버 운영을 거의 의식하지 않는 관리형 원격 Claude Code 제품을 뜻한다. DeskRelay는 그 반대편에 있는 self-host 도구다. 둘은 같은 문제를 풀지만, 좋은 방향과 나쁜 방향이 분명히 다르다.

| 기준 | DeskRelay self-host | Claude Remote형 관리 제품 |
| --- | --- | --- |
| 소유권 | 코드, 서버, 디바이스 등록 상태가 사용자 PC 안에 남는다. 구조를 읽고 고칠 수 있다. | 제품 운영자가 제어면을 관리한다. 사용자는 내부 구조를 덜 신경 쓰는 대신 통제권은 줄어든다. |
| 설치 난이도 | 높다. 서버 PC, 대상 PC, Tailscale/LAN, 방화벽, PowerShell 실행 정책이 모두 실패 지점이다. | 낮아야 한다. 사용자는 설치 버튼과 로그인 흐름을 기대한다. 실패 지점은 제품이 숨겨야 한다. |
| 외부 접근 | 직접 공용 노출을 피하고, Tailscale 또는 같은 LAN을 전제로 한다. 안전하지만 네트워크 이해가 필요하다. | 외부 접근을 제품이 대신 설계한다. 편하지만 사용자는 어떤 경로로 명령이 흐르는지 덜 알게 된다. |
| 보안 모델 | Site token + daemon token + 사설 네트워크 전제가 핵심이다. 단순하고 감사 가능하지만, 운영 실수에 약하다. | 중앙 인증, 세션 관리, 기기 신뢰 모델을 제품이 제공할 수 있다. 대신 구현과 운영자를 신뢰해야 한다. |
| 비용과 제한 | 별도 사용량 과금은 없다. 단, 사용자의 PC 전원, 네트워크, Claude Code 계정 상태에 의존한다. | 서비스 운영 비용과 정책 제한이 붙을 수 있다. 대신 사용자는 인프라 관리를 덜 한다. |
| 안정성 | 서버 PC가 꺼지면 끝이다. 네트워크가 흔들리면 사용자가 직접 원인을 봐야 한다. | 제품이 상태 감시, 재연결, 장애 대응을 더 일관되게 제공해야 한다. |
| 업데이트 | git pull과 스크립트 재실행 중심이다. 빠르게 바꿀 수 있지만 자동 업데이트 품질은 약하다. | 업데이트가 매끄러워야 한다. 대신 사용자는 업데이트 내용을 세밀하게 통제하기 어렵다. |
| 디버깅 | 로그와 스크립트가 로컬에 있어 원인 추적이 쉽다. 파워유저에게 유리하다. | 사용자는 편하지만, 문제가 생기면 제품 로그와 지원 채널에 의존한다. |
| UX 완성도 | 아직 거칠다. 설치/등록/진단 wizard가 있어도 사용자가 네트워크 개념을 알아야 한다. | 일반 사용자용이라면 훨씬 더 매끄러워야 한다. 실패 복구도 제품이 대신 안내해야 한다. |
| 맞는 사용자 | 자기 PC를 서버처럼 다루는 사람, 오픈소스 코드를 고쳐 쓰는 사람, Tailscale/LAN을 이해하는 사람. | 설치와 운영을 맡기고 싶은 사람, 팀 단위 사용, 일관된 온보딩과 지원이 필요한 사람. |

엄하게 말하면 DeskRelay는 아직 “제품”보다 “작동하는 개인용 제어면”에 가깝다. 강점은 투명성, 자기 소유, 수정 가능성이고 약점은 설치 마찰, 네트워크 의존성, 운영 책임이다. 일반 사용자에게는 Claude Remote형 제품이 더 맞고, 파워유저에게는 DeskRelay가 더 솔직하고 강하다.

## 서버 PC 설치

서버로 쓸 Windows PC의 PowerShell에 아래 명령을 통째로 붙여넣는다. 기본 설치 위치는 `$HOME\deskrelay`이고, 실행 상태와 Site token은 `.self-server` 아래에 생성된다.

```powershell
$ErrorActionPreference = 'Stop'

$repo = Join-Path $HOME 'deskrelay'
if (-not (Test-Path -LiteralPath $repo)) {
  git clone https://github.com/darkhtk/deskrelay.git $repo
} elseif (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
  throw "Path exists but is not a git repo: $repo"
}

Set-Location -LiteralPath $repo
git pull --ff-only
bun install
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-start.ps1
```

실행이 끝나면 `http://127.0.0.1:18193`이 기본 브라우저로 열린다. 메인 화면에는 현재 PC 상태, 접속 URL, Site token, 다른 PC 등록 명령이 표시된다. 같은 정보는 터미널에도 출력되고, `.self-server\commands` 아래의 command 파일과 저장소 최상위 quick 파일에도 생성된다.

다른 기기에서 열 때는 `DESKRELAY-SERVER-CODE.txt`의 `Recommended login URL for another device`를 우선 사용한다. 이 URL은 `#site-token=...`을 포함하므로 처음 접속한 브라우저도 토큰 입력 없이 들어간다. `100.x.x.x` Tailscale 주소는 공용 인터넷 주소가 아니며, 같은 Tailscale tailnet에 로그인되어 있고 온라인인 기기에서만 열린다. 같은 집/사무실 LAN 안에서는 LAN URL을 쓸 수 있다.

상태를 확인하려면:

```powershell
Set-Location -LiteralPath (Join-Path $HOME 'deskrelay')
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-status.ps1
```

서버를 재시작하려면:

```powershell
Set-Location -LiteralPath (Join-Path $HOME 'deskrelay')
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-stop.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-start.ps1
```

이전 서버를 관리자 권한 PowerShell이나 다른 터미널에서 띄운 상태라면 일반 터미널의 stop 명령으로 프로세스를 닫지 못할 수 있다. 그때는 서버를 띄웠던 터미널을 직접 닫거나, 관리자 PowerShell에서 `18191`, `18192`, `18193` 포트를 잡고 있는 프로세스를 종료한 뒤 다시 시작한다.

```powershell
Get-NetTCPConnection -LocalPort 18191,18192,18193 -State Listen |
  Select-Object LocalPort, OwningProcess

taskkill /PID <OwningProcess> /T /F
```

서버를 중지하려면:

```powershell
Set-Location -LiteralPath (Join-Path $HOME 'deskrelay')
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-stop.ps1
```

서버 설치 상태를 제거하려면:

```powershell
Set-Location -LiteralPath (Join-Path $HOME 'deskrelay')
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-uninstall.ps1
```

이 명령은 서버가 아직 켜져 있으면 먼저 등록된 모든 디바이스에 `/system/uninstall`을 보내 각 PC의 DeskRelay connector가 스스로 login task, local state, source clone을 정리하게 한다. 그 다음 실행 중인 self 서버와 서버 PC connector를 끄고, `.self-server` 런타임 상태와 생성된 command txt 파일을 지운다. git clone 폴더 자체는 남긴다. 폴더까지 지우고 싶을 때만 `-RemoveRepo`를 붙인다.

다른 PC에서 접속하려면 서버 PC와 대상 PC가 같은 LAN 또는 Tailscale tailnet에 있어야 한다. connector 포트를 공용 인터넷에 직접 노출하지 않는다.

## 다른 PC 등록과 해제

다른 PC 등록은 메인 화면이 담당한다. 서버를 열면 메인 화면의 등록 wizard에 서버 URL과 Site token이 포함된 PowerShell 명령이 표시된다. 그 명령을 드래그해서 통째로 복사한 뒤 제어하려는 Windows PC의 PowerShell에 붙여넣으면 된다. 설정 다이얼로그는 중복된 등록 UI를 갖지 않고, 이미 등록된 디바이스의 선택, 이름/기본 작업 디렉토리 관리, 제거만 담당한다.

서버가 켜지면 `.self-server\commands` 아래에 세부 command 파일이 생성되고, 저장소 최상위에도 자주 쓰는 quick 파일이 생성된다.

- `.self-server\commands\register-other-pc.txt`: 제어할 다른 Windows PC에 그대로 붙여넣는 등록 명령
- `.self-server\commands\remove-other-pc.txt`: 등록을 해제할 Windows PC에 그대로 붙여넣는 해제 명령
- `.self-server\commands\status-server.txt`: 현재 서버 URL, Site token, command 파일 위치 확인
- `.self-server\commands\deskrelay-commands.txt`: 생성된 모든 운영 명령 모음
- `REGISTER-OTHER-PC.txt`: 최상위 quick 등록 명령
- `REMOVE-OTHER-PC.txt`: 최상위 quick 해제 명령
- `DESKRELAY-SERVER-CODE.txt`: 서버 URL, Site token, command 파일 위치
- `REMOVE-DESKRELAY-SERVER.txt`: 서버 PC의 self-host 상태 제거 명령

등록 명령은 GitHub에서 `scripts/install-connector.ps1`을 내려받아 실행한다. 이 스크립트가 `$HOME\deskrelay` 설치 상태를 판별하고, 필요하면 새로 clone/update한 뒤 connector를 `0.0.0.0:18091`에 띄우고, Tailscale/LAN 주소를 감지하고, 서버가 `/status`에 접근 가능한지 확인한 다음 device row를 등록한다. 등록이 끝나면 Site token이 포함된 DeskRelay URL을 기본 브라우저로 연다. 브라우저 자동 실행이 막히면 터미널에 `#site-token=...`이 포함된 URL을 출력하므로, 그 URL을 그대로 열면 token을 다시 입력하지 않아도 된다.

해제 명령은 GitHub에서 `scripts/remove-connector.ps1`을 내려받아 실행한다. 이 스크립트가 해당 PC의 Tailscale/LAN daemon URL 후보를 계산하고, 서버의 matching device row를 삭제하고, Windows login task와 local connector state를 제거하고, 남아 있는 connector listener를 종료한다. repo 폴더는 기본적으로 남긴다.

브라우저 설정 다이얼로그의 `디바이스 제거`는 서버의 device row만 지우지 않는다. 선택한 디바이스의 daemon에 접근할 수 있으면 `/system/uninstall`을 호출해 Windows login task, connector auth/state/identity, behavior cache, login-task script, logs 폴더를 함께 제거한다. 등록 명령으로 `$HOME\deskrelay`에 설치된 source clone이면 프로세스 종료 뒤 repo 폴더 제거도 예약한다. 디바이스가 오프라인이거나 오래된 connector라 cleanup 요청이 실패해도, 브라우저 목록에서는 device row를 제거해 stale 디바이스가 남지 않게 한다. 이 경우 앱은 메인 화면으로 돌아가 어떤 PC에 수동 cleanup이 필요한지 알리고, 그 PC에서 실행할 제거 명령을 보여준다.

## 구조 노드

DeskRelay self 서버를 켜면 서버 PC 안에서 세 개의 로컬 프로세스가 함께 뜬다.

- `daemon`: 서버 PC 자체를 제어 가능한 디바이스로 노출한다. 기본 포트는 `18191`이다.
- `site-backend`: Site token 인증, 디바이스 레지스트리, 디바이스 proxy, 등록/삭제 명령 생성을 맡는다. 기본 포트는 `18192`이다.
- `site-frontend`: 브라우저가 여는 DeskRelay UI다. 기본 포트는 `18193`이고, `/api`와 `/healthz` 요청을 `site-backend`로 proxy한다.

```mermaid
flowchart LR
  Browser["사용자 브라우저<br/>DeskRelay UI<br/>Site token 로그인"]

  subgraph ServerPC["서버 PC"]
    SiteFrontend["site-frontend<br/>packages/site-frontend<br/>:18193<br/>브라우저 UI<br/>/api -> site-backend proxy"]
    SiteBackend["site-backend<br/>packages/site-backend<br/>:18192<br/>Site token 인증<br/>device registry / proxy / command 생성"]
    Registry[("Device registry<br/>.self-server/state<br/>device id / label / daemonUrl / daemon token")]
    Commands["Command files<br/>.self-server/commands<br/>top-level quick txt"]
    ServerDaemon["daemon<br/>packages/pc-connector-daemon<br/>:18191<br/>서버 PC connector<br/>daemon token"]
    ServerTask["Windows login task<br/>login 시 connector 자동 시작"]
    ServerWorkspace["Workspace roots<br/>CR_CONNECTOR_WORKSPACE_ROOTS"]
    ServerBehavior["Claude behavior host<br/>remote-claude"]
    ServerClaude["Claude Code CLI<br/>세션/권한/usage"]
  end

  subgraph OtherPC["다른 제어 대상 PC"]
    OtherDaemon["daemon<br/>packages/pc-connector-daemon<br/>:18091<br/>Tailscale/LAN 주소<br/>daemon token"]
    OtherTask["Windows login task"]
    OtherWorkspace["Workspace roots"]
    OtherBehavior["Claude behavior host"]
    OtherClaude["Claude Code CLI"]
  end

  Network["Tailscale / LAN<br/>서버 PC -> 다른 PC daemon 접근"]

  Browser -->|"HTTP / SSE"| SiteFrontend
  SiteFrontend -->|"same-origin /api proxy"| SiteBackend
  SiteBackend --> Registry
  SiteBackend --> Commands
  SiteBackend -->|"HTTP + daemon token"| ServerDaemon
  SiteBackend -->|"HTTP + daemon token"| Network
  SiteBackend -->|"/system/uninstall on device removal"| Network
  Network --> OtherDaemon

  ServerDaemon --> ServerTask
  ServerDaemon --> ServerWorkspace
  ServerDaemon --> ServerBehavior
  ServerBehavior --> ServerClaude

  OtherDaemon --> OtherTask
  OtherDaemon --> OtherWorkspace
  OtherDaemon --> OtherBehavior
  OtherBehavior --> OtherClaude

  Registry -. "같은 daemonUrl 재등록 시 기존 row 삭제 후 새 row 생성" .-> SiteBackend
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
  C["3. 메인 화면 등록 wizard 또는 command 파일에서 다른 PC 등록 명령 복사"]
  D["4. 다른 PC PowerShell에 등록 명령 붙여넣기"]
  E["5. GitHub install-connector.ps1 실행<br/>repository 설치/update + connector 시작"]
  F["6. 다른 PC의 Tailscale/LAN daemonUrl 감지"]
  G{"7. 서버가 /status 접근 가능?"}
  H["8. server registry에 device row 등록"]
  I["9. 브라우저 디바이스 목록에 표시"]
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

## 세션 목록과 내부 조회

DeskRelay는 사용량과 상태 확인을 위해 Claude CLI의 `/context`, `/status`, `/usage` 같은 내부 조회 명령을 실행할 수 있다. 이런 조회는 사용자 대화가 아니므로 세션 목록을 오염시키면 안 된다.

- 새 내부 조회는 `--no-session-persistence`로 실행해 Claude `.jsonl` 세션 파일을 만들지 않는다.
- 예전 버전에서 만들어진 `<local-command-caveat>` 기반 내부 명령 전용 세션은 세션 목록을 읽을 때 자동으로 삭제한다.
- 내부 조회 뒤에 실제 사용자 메시지가 섞인 세션은 삭제하지 않는다.

## 파워유저 관점의 핵심 목표

- 같은 설치/등록 명령을 여러 번 실행해도 상태가 망가지지 않아야 한다.
- 실패하면 어느 노드에서 실패했는지 보여줘야 한다.
- 서버와 connector가 서로 접근 가능한지 등록 전에 검증해야 한다.
- token mismatch, local-only bind, firewall, Tailscale 미연결을 하나의 오프라인으로 뭉개면 안 된다.
- UI는 예쁜 온보딩보다 현재 노드 상태와 복구 액션을 보여줘야 한다.
- 설치/등록 안내는 메인 화면으로 모으고, 설정 다이얼로그는 등록된 디바이스 관리만 맡아 중복 동선을 만들지 않는다.
- 디바이스 제거는 목록에서 숨기는 동작이 아니라, 가능하면 해당 PC의 connector 설치 흔적까지 함께 정리하는 동작이어야 한다.
