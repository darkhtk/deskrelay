# DeskRelay

내 PC에서 실행되는 `claude` CLI를 브라우저에서 원격으로 조작하는 오픈소스 도구입니다.

DeskRelay는 호스팅 상품이 아닙니다. 공개 서비스 계정, 결제 플로우, 앱스토어 패키지, 중앙 릴레이 없이 각 사용자가 자기 PC에서 직접 실행하는 self-host 도구입니다. 사용자는 이 PC에서 DeskRelay를 실행하면 바로 이 PC의 Claude CLI를 브라우저에서 사용할 수 있고, 필요하면 다른 PC의 connector daemon URL을 디바이스로 추가 등록합니다.

## 제공하는 것

| 필요 | DeskRelay가 하는 일 |
|---|---|
| Claude Code 원격 사용 | 브라우저에서 내 PC의 `claude` CLI로 프롬프트를 보냅니다. |
| 여러 PC 관리 | 여러 connector daemon URL을 등록하고 사이드바에서 전환합니다. |
| 작업 로컬 유지 | 파일, 셸 명령, git, MCP 설정, Anthropic 인증 정보는 daemon이 실행되는 PC에 남습니다. |
| 세션 이어가기 | 기존 Claude 세션 파일을 보고, 이어서 대화하거나, 원하는 폴더에서 새 세션을 시작합니다. |
| 도구 사용 검토 | Claude의 도구 호출을 브라우저에서 승인하거나 거부합니다. |
| 생성 이미지 보기 | 선택한 작업 폴더의 지원되는 이미지 파일을 채팅 화면에서 미리 봅니다. |

## 요구 사항

- Git
- [Bun](https://bun.sh)
- 제어하려는 모든 PC에 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) 설치 및 인증 완료
- DeskRelay 사이트 백엔드가 각 connector daemon에 접근할 수 있는 사설 네트워크 경로

같은 LAN 안에서만 쓸 거라면 별도 VPN 없이 사용할 수 있습니다. 집 밖, 회사 밖, 모바일 네트워크처럼 LAN 밖에서 접속하려면 먼저 [Tailscale](https://tailscale.com)을 설치해 PC들을 같은 사설 네트워크에 넣으세요. connector daemon을 공용 인터넷에 직접 노출하지 마세요.

## 권장 사용 모델

DeskRelay self 버전은 중앙 SaaS가 아니라 사용자별 self-host 도구입니다.

각 사용자는 자기 PC 한 대에서 DeskRelay를 실행합니다. 그 PC의 Claude CLI는 기본 디바이스로 자동 등록되고, 다른 PC의 Claude CLI도 쓰고 싶을 때만 추가 디바이스를 등록합니다.

```text
사용자 A의 DeskRelay PC
- A의 site-frontend
- A의 site-backend
- A PC의 connector daemon
- A가 추가 등록한 다른 PC connector daemon들

사용자 B의 DeskRelay PC
- B의 site-frontend
- B의 site-backend
- B PC의 connector daemon
- B가 추가 등록한 다른 PC connector daemon들
```

이 구조에서는 별도 가입, 중앙 계정, 결제, 앱스토어 배포, 중앙 릴레이가 필요 없습니다. 외부 접속은 Tailscale 같은 사설 VPN을 권장하고, PC 관리는 SSH key로 처리합니다.

## 빠른 시작: 이 PC의 Claude를 브라우저에서 사용

저장소를 클론합니다.

```powershell
git clone https://github.com/darkhtk/deskrelay.git
cd deskrelay
bun install
```

이 PC에서 DeskRelay를 시작합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-start.ps1
```

Windows에서 `.ps1` 실행 정책 오류가 나지 않도록, README의 PowerShell 스크립트 예시는 현재 명령에만 `ExecutionPolicy Bypass`를 적용합니다. 시스템 설정은 바꾸지 않습니다.

이 스크립트는 다음 세 가지를 한 번에 실행합니다.

- `site-backend`: `127.0.0.1:18192`
- 이 PC의 `connector daemon`: `127.0.0.1:18191`
- 브라우저 UI: `0.0.0.0:18193`
- 이 PC의 daemon 자동 등록

스크립트가 출력하는 URL 중 하나를 브라우저에서 엽니다.

```text
http://127.0.0.1:18193
http://<내-PC-LAN-IP>:18193
http://<내-PC-Tailscale-IP>:18193
```

로그인 화면이 나오면 스크립트가 출력한 `Site token`을 입력합니다.

이 PC의 daemon은 자동으로 등록됩니다. 로그인 후 바로 이 PC의 Claude CLI를 사용할 수 있습니다. 다른 PC도 연결하려면 생성된 `REGISTER-OTHER-PC.txt`를 그 PC에서 실행하거나, 그 PC에서 connector daemon을 실행한 뒤 Settings -> Devices에서 daemon URL과 token을 추가합니다.

이 PC에서 `http://127.0.0.1:18193`로 접속해 `앱 열기`를 누르면 Site token을 직접 입력하지 않고 바로 들어갑니다. 다른 PC나 모바일 기기에서 Tailscale/LAN URL로 접속할 때는 계속 Site token이 필요합니다.

중지:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-stop.ps1
```

상태 확인:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-status.ps1
```

상태 명령은 접속 URL과 현재 `Site token`을 다시 출력합니다. 브라우저 로그인 토큰을 잃어버렸다면 이 명령으로 다시 확인하세요.

Site token은 `.self-server\site-token.txt`에도 따로 저장됩니다.

LAN 밖에서 이 PC의 DeskRelay에 접속하려면 이 PC와 접속할 기기에 Tailscale을 설치하고 로그인하세요. 그다음 `self-pc-server-start.ps1` 또는 `self-pc-server-status.ps1`가 출력하는 Tailscale URL을 사용합니다.

시작/상태 명령은 복붙용 운영 명령도 생성합니다. 가장 자주 쓰는 두 파일은 DeskRelay 폴더 최상위에 바로 생깁니다.

| 파일 | 목적 |
|---|---|
| `DESKRELAY-SERVER-CODE.txt` | 이 서버의 접속 URL과 Site token |
| `REGISTER-OTHER-PC.txt` | 다른 PC에서 PowerShell에 통째로 붙여넣는 자동 등록 명령 |

더 많은 운영 명령은 `.self-server\commands\`에도 생성됩니다. 파일을 열어서 필요한 블록을 통째로 복사해 실행할 수 있습니다.

이 파일들에는 `Site token`이 포함됩니다. 내 PC 안에서 쓰는 편의 파일로 보고, 공개 저장소나 채팅에 붙여넣지 마세요.

| 파일 | 목적 |
|---|---|
| `deskrelay-commands.txt` | 자주 쓰는 명령 전체 모음 |
| `open-site.txt` | 접속 URL, Site token, 브라우저 로그인 helper |
| `register-other-pc.txt` | 다른 PC에서 실행해 daemon 설치, 실행, 자동 등록 |
| `manual-register-other-pc.txt` | 자동 등록이 실패할 때 수동 등록 값 확인 |
| `list-devices.txt` | 등록된 디바이스 목록 조회 |
| `unregister-device-by-id.txt` | 디바이스 id로 등록 해제 |
| `stop-server.txt` | 이 PC의 DeskRelay 중지 |
| `reset-server.txt` | 중지 후 `.self-server` 상태 폴더 삭제 |
| `remove-this-pc-connector.txt` | 이 PC self connector 상태 제거 |

## 다른 디바이스 등록

이 PC의 Claude CLI는 `self-pc-server-start.ps1`가 자동 등록합니다. 제어하려는 다른 PC가 있을 때만 그 PC에서 생성된 등록 명령을 실행하거나 connector daemon을 실행하고, 현재 브라우저 UI의 Settings -> Devices에서 그 daemon을 디바이스로 추가합니다.

이 PC와 대상 PC가 서로 접근할 수 있어야 합니다. 가장 쉬운 방식은 Tailscale 같은 사설 VPN입니다. daemon 포트는 공용 인터넷에 직접 열지 마세요.

가장 쉬운 방법은 이 PC의 DeskRelay 폴더 최상위에 생성된 `REGISTER-OTHER-PC.txt`를 열고, 내용을 대상 PC의 PowerShell에 통째로 붙여넣는 것입니다. 같은 내용은 `.self-server\commands\register-other-pc.txt`에도 있습니다. 이 명령은 서버의 Tailscale/LAN URL을 우선 사용하고, 대상 PC의 `$HOME\deskrelay` 폴더가 없거나 잘못된 git 저장소이거나 로컬 변경으로 업데이트할 수 없으면 기존 폴더를 백업한 뒤 깨끗하게 다시 clone합니다. 이후 대상 PC의 Tailscale IP를 자동 감지하고, daemon token을 읽은 뒤, 현재 DeskRelay에 디바이스를 등록합니다.

대상 PC에 DeskRelay를 설치합니다.

```powershell
git clone https://github.com/darkhtk/deskrelay.git
cd deskrelay
bun install
```

대상 PC의 daemon을 사설 네트워크 주소에 바인딩해서 실행합니다. `100.x.y.z`는 대상 PC의 Tailscale IP 또는 사설 LAN IP로 바꿉니다.

```powershell
$env:CR_CONNECTOR_HOST = "100.x.y.z"
$env:CR_CONNECTOR_PORT = "18091"
$env:CR_CONNECTOR_WORKSPACE_ROOTS = "C:\Users\me\Projects"
bun run packages/pc-connector-daemon/src/bin.ts
```

같은 터미널을 닫으면 daemon도 종료됩니다. Windows에서 계속 실행하려면 로그인 작업으로 등록할 수 있습니다.

```powershell
bun run packages/pc-connector-daemon/src/bin.ts login-task install --start
```

대상 PC의 daemon token을 확인합니다.

```powershell
bun run packages/pc-connector-daemon/src/bin.ts auth-token
```

이 PC에서 열린 브라우저 UI의 Settings -> Devices를 열고 Add device에 다음 값을 입력합니다.

| 입력값 | 예시 | 설명 |
|---|---|---|
| Daemon URL | `http://100.x.y.z:18091` | 이 PC에서 접근 가능한 대상 PC daemon 주소입니다. |
| Label | `work-laptop` | 선택 사항입니다. 비워두면 daemon이 알려주는 이름을 사용합니다. |
| Daemon token | `auth-token` 명령이 출력한 token | 대상 PC daemon의 API 토큰입니다. |

저장을 누르면 사이트 백엔드가 해당 daemon의 `/status`를 먼저 확인합니다. URL에 접근할 수 없거나 token이 틀리면 디바이스를 저장하지 않고 오류를 보여줍니다. 검증이 성공하면 디바이스 목록이 갱신되고, 사이드바에서 해당 디바이스를 선택해 사용할 수 있습니다.

이 PC에서 자동 등록된 로컬 daemon은 별도 등록이 필요 없습니다. 다른 PC를 추가할 때만 그 PC의 daemon URL과 daemon token을 입력합니다.

등록 예시:

```text
http://100.x.y.z:18091
http://my-laptop:18091
http://my-desktop:18091
```

DeskRelay는 디바이스 목록을 이 PC의 사이트 백엔드 프로세스에 저장합니다. 브라우저에서는 사이드바에서 등록된 디바이스를 전환할 수 있습니다.

## 외부 접속과 SSH key

외부에서 쓰려면 Tailscale을 설치하세요. 포트포워딩으로 DeskRelay를 공용 인터넷에 직접 공개하는 방식은 권장하지 않습니다.

Tailscale 사용 순서:

1. DeskRelay를 실행한 이 PC와 접속할 기기에 Tailscale을 설치합니다.
2. 같은 Tailscale 계정 또는 같은 tailnet으로 로그인합니다.
3. 이 PC에서 `self-pc-server-status.ps1`를 실행해 Tailscale URL을 확인합니다.
4. 외부 기기의 브라우저에서 그 URL로 접속하고 `Site token`으로 로그인합니다.

```text
앱 사용:
Tailscale + CR_SITE_TOKEN

이 PC 관리:
Tailscale SSH 또는 일반 SSH + key only
```

브라우저 사용자는 DeskRelay URL로 접속합니다.

```text
http://<my-server-pc>:18193
```

서버 업데이트, 로그 확인, 재시작 같은 관리 작업은 SSH key로 접속해서 처리합니다. SSH는 비밀번호 로그인을 끄고 key 인증만 쓰는 편이 안전합니다.

```text
PasswordAuthentication no
PubkeyAuthentication yes
```

connector daemon 포트 `18091`은 공용 인터넷에 열지 마세요. DeskRelay를 실행한 이 PC의 로컬 daemon은 `127.0.0.1:18191`처럼 로컬 전용으로 충분하고, 다른 PC의 daemon은 Tailscale/LAN 주소로만 접근하게 두세요.

## Windows에서 connector 지속 실행

소스 설치 기준으로, 현재 내장된 지속 실행 작업 helper는 Windows만 지원합니다.

```powershell
bun run packages/pc-connector-daemon/src/bin.ts login-task install --start
```

상태 확인:

```powershell
bun run packages/pc-connector-daemon/src/bin.ts login-task status
```

제거:

```powershell
bun run packages/pc-connector-daemon/src/bin.ts login-task remove
```

macOS/Linux에서는 이미 신뢰하는 프로세스 관리자(`systemd`, `launchd`, tmux, screen, 터미널 세션 등)로 daemon을 실행하세요.

## 주요 환경 변수

### 사이트 백엔드

| 변수 | 기본값 | 목적 |
|---|---:|---|
| `CR_SITE_HOST` | `127.0.0.1` | 백엔드가 바인딩할 호스트입니다. |
| `CR_SITE_PORT` | `18092` | 백엔드 포트입니다. |
| `CR_SITE_TOKEN` | 시작 시 자동 생성 | 브라우저 API bearer token입니다. 원격 사용에는 직접 지정하는 편이 안정적입니다. |
| `CR_SITE_AUTH_OPTIONAL` | 미설정 | 완전히 사설이고 신뢰 가능한 네트워크에서 토큰 없이 쓰고 싶을 때만 `1`로 설정합니다. |
| `CR_CONNECTOR_DAEMON_TOKEN` | 로컬 daemon 상태에서 자동 읽기 | 백엔드가 같은 OS 사용자로 실행 중인 daemon에 프록시할 때 쓰는 토큰입니다. |

### Connector daemon

| 변수 | 기본값 | 목적 |
|---|---:|---|
| `CR_CONNECTOR_HOST` | `127.0.0.1` | daemon이 바인딩할 호스트입니다. 원격 접근에는 사설 VPN/LAN 주소를 사용하세요. |
| `CR_CONNECTOR_PORT` | `18091` | daemon 포트입니다. |
| `CR_CONNECTOR_WORKSPACE_ROOTS` | 제한 없음 | 접근 가능한 작업 폴더 root를 쉼표로 지정합니다. 원격 사용 전 설정하는 것이 안전합니다. |
| `CR_CONNECTOR_STATE_DIR` | OS 사용자 상태 폴더 | connector 상태 저장 위치입니다. |
| `CR_CONNECTOR_AUTH_FILE` | OS 사용자 상태 폴더의 auth 파일 | daemon 로컬 API 토큰 파일입니다. |

Tailscale IP에 바인딩하는 원격 daemon 예시:

```powershell
$env:CR_CONNECTOR_HOST = "100.x.y.z"
$env:CR_CONNECTOR_WORKSPACE_ROOTS = "C:\Users\me\Projects"
bun run packages/pc-connector-daemon/src/bin.ts
```

## 로컬 개발 helper

격리된 로컬 스택을 빠르게 실행하려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-start.ps1
```

실행되는 항목:

- connector daemon: `127.0.0.1:18191`
- 사이트 백엔드: `127.0.0.1:18192`
- 프론트엔드: `127.0.0.1:18193`

중지:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local-stop.ps1
```

## 보안 모델

DeskRelay는 내 머신을 원격으로 조작하는 표면입니다. 개발자용 관리 도구처럼 다루세요.

- connector daemon은 Claude Code가 실행할 수 있는 파일 읽기와 명령 실행을 수행할 수 있습니다.
- 브라우저 승인 UI는 도구 사용 검토를 돕지만, sandbox가 아닙니다.
- daemon은 `127.0.0.1` 또는 사설 VPN/LAN 인터페이스에 바인딩하세요.
- 원격 사용 전 `CR_CONNECTOR_WORKSPACE_ROOTS`를 설정하세요.
- 네트워크 전체가 사설이고 신뢰 가능한 경우가 아니라면 강한 `CR_SITE_TOKEN`을 사용하세요.
- `18091` 또는 `18092`를 공용 인터넷에 직접 노출하지 마세요.

## 개인정보와 이용약관

DeskRelay self는 호스팅 서비스가 아니라 사용자가 직접 실행하는 소프트웨어입니다. 따라서 프로젝트 관리자는 일반적인 self-host 설치에서 채팅, 프롬프트, Claude 응답, 파일, 명령 결과, 디바이스 목록, Site token, daemon token, 로그를 받거나 저장하지 않습니다.

주요 데이터 위치는 다음과 같습니다.

- Site token과 UI 설정: 브라우저 localStorage
- 디바이스 등록 정보: 사용자가 실행한 site-backend의 로컬 상태
- daemon token과 connector 상태: connector가 실행되는 PC
- Claude Code 세션 파일, 작업 폴더, git 상태, MCP 설정, Anthropic 인증 정보: connector가 실행되는 PC
- `.self-server\commands\` 명령 파일: 이 PC에서 쓰는 복붙용 파일이며 Site token이 포함될 수 있음

앱 안의 `/privacy`와 `/terms` 페이지도 self-host 기준으로 작성되어 있습니다. 이 저장소에는 가입, 결제, 앱스토어 배포, 중앙 릴레이 같은 호스팅 서비스 전제가 없습니다.

## 저장소 구조

```text
packages/site-frontend           Solid/Vite 브라우저 UI
packages/site-backend            Hono/Bun self-host 백엔드
packages/pc-connector-daemon     로컬 connector daemon
packages/behaviors/remote-claude Claude Code behavior
packages/behavior-sdk            behavior host runtime
packages/core                    broker 및 event primitive
packages/shared                  공유 타입과 helper
scripts/dev-local-*.ps1          로컬 스택 helper
```

## 라이선스

메인 프로젝트는 Apache-2.0입니다. [LICENSE](LICENSE)를 확인하세요.

Claude와 Claude Code는 Anthropic PBC의 상표입니다. DeskRelay는 Anthropic과 제휴하지 않은 독립 오픈소스 프로젝트입니다.
