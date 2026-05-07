# DeskRelay

DeskRelay는 자기 PC에서 실행 중인 Claude Code를 브라우저로 조작하기 위한 self-host 오픈소스 도구다. 출시용 SaaS가 아니라, 파워유저가 자기 장비 안에 띄워 두는 control plane에 가깝다.

## 구조 노드

```text
[사용자 브라우저]
  역할: DeskRelay UI 접속, Site token 로그인, 세션/권한/스킬/디바이스 조작
  통신: HTTP/SSE -> [Self-host site server]

[Self-host site server]
  패키지: packages/site-backend
  역할: 브라우저 API, 디바이스 registry, 세션 proxy, 공지, self 명령 생성
  기본 포트: 18193
  보안 경계: Site token
  통신:
    - HTTP -> [Connector daemon: server PC]
    - HTTP -> [Connector daemon: other PC]

[Site frontend]
  패키지: packages/site-frontend
  역할: 브라우저 앱 UI
  표시: 디바이스 선택, 세션 목록, 권한 탭, 스킬 탭, 사용량, 연결 상태
  통신: HTTP/SSE -> [Self-host site server]

[Device registry]
  위치: self-host server local state
  역할: 등록된 PC 목록 저장
  저장 값: device id, label, daemonUrl, daemon auth token
  규칙: 같은 daemonUrl 재등록 시 기존 row를 지우고 새 row를 만든다

[Connector daemon: server PC]
  패키지: packages/pc-connector-daemon
  역할: 서버 PC 자체를 제어 대상으로 노출
  기본 포트: 18091
  보안 경계: daemon token
  실행: login task 또는 직접 실행

[Connector daemon: other PC]
  패키지: packages/pc-connector-daemon
  역할: 다른 PC를 제어 대상으로 노출
  등록: 서버에서 복사한 register command 실행
  주소: Tailscale/LAN IP + 18091
  보안 경계: daemon token

[Claude behavior host]
  패키지: packages/behaviors/remote-claude
  역할: connector daemon 안에서 Claude Code 실행을 담당
  처리: 새 세션 생성, 기존 세션 읽기, streaming, approval, slash command

[Claude Code CLI]
  위치: 각 제어 대상 PC
  역할: 실제 Claude 세션 실행
  상태: 로그인/권한/usage/세션 파일은 해당 PC의 Claude 환경에 종속

[Workspace roots]
  설정: CR_CONNECTOR_WORKSPACE_ROOTS
  역할: cwd picker와 파일 접근 범위 제한
  규칙: root 밖 list/mkdir는 forbidden

[Windows login task]
  위치: 각 connector PC
  역할: 로그인 시 connector daemon 자동 시작
  관리: cr-connector login-task install/status/remove

[Tailscale/LAN]
  역할: server PC가 other PC connector에 접근하기 위한 네트워크
  주의: 127.0.0.1은 같은 PC 전용이므로 다른 PC 등록 주소로 쓰면 안 된다
```

## 연결 그래프

```text
사용자 브라우저
  -> Site frontend
  -> Self-host site server
  -> Device registry
  -> 선택된 Connector daemon
  -> Claude behavior host
  -> Claude Code CLI
  -> 세션 파일 / workspace / 권한 / 스킬
```

## 등록 흐름

```text
1. 서버 PC에서 self-host site server를 실행한다.
2. 서버 PC의 connector daemon은 보통 자동 등록된다.
3. 다른 PC를 제어하려면 Settings -> Devices에서 등록 명령을 복사한다.
4. 다른 PC의 PowerShell에 등록 명령을 붙여 넣는다.
5. 등록 명령은 repository 설치, connector 시작, 외부 접근 확인, 서버 registry 등록을 수행한다.
6. 서버가 해당 connector의 /status에 접근할 수 있어야 디바이스 목록에 올라간다.
```

## 신뢰 기준

등록됐다는 것과 쓸 수 있다는 것은 다르다. DeskRelay가 믿을 수 있으려면 최소한 아래 조건을 분리해서 확인해야 한다.

```text
[설치됨] repository와 의존성이 있음
[실행 중] connector daemon process가 있음
[로컬 준비] 127.0.0.1:18091 /status가 daemon token으로 응답
[외부 접근 가능] server PC가 daemonUrl /status에 접근 가능
[등록됨] server registry에 device row가 있음
[Claude 준비] behavior host와 Claude Code CLI가 실행 가능
[작업 범위 유효] workspace roots가 실제 경로와 맞음
[자동 복구] login task가 설치되어 재로그인 후 daemon을 다시 띄움
```

## 파워유저 관점의 핵심 목표

- 같은 설치/등록 명령을 여러 번 실행해도 상태가 망가지지 않아야 한다.
- 실패하면 어느 노드에서 실패했는지 보여줘야 한다.
- 서버와 connector가 서로 접근 가능한지 등록 전에 검증해야 한다.
- token mismatch, local-only bind, firewall, Tailscale 미연결을 하나의 오프라인으로 뭉개면 안 된다.
- UI는 예쁜 온보딩보다 현재 노드 상태와 복구 액션을 보여줘야 한다.
