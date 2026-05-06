# DeskRelay

내 PC에서 실행되는 `claude` CLI를 브라우저에서 원격으로 조작하는 오픈소스 도구입니다.

DeskRelay는 호스팅 상품이 아닙니다. 이 저장소에는 공개 서비스 계정, 결제 플로우, 앱 패키지, 클라우드 relay가 필요하지 않습니다. 사용자가 직접 사이트 백엔드를 실행하고, 제어하려는 각 PC에서 connector daemon을 실행한 뒤, 브라우저에서 해당 daemon URL을 디바이스로 등록해서 사용합니다.

## 제공하는 것

| 필요 | DeskRelay가 하는 일 |
|---|---|
| Claude Code 원격 사용 | 브라우저에서 내 PC의 `claude` CLI로 프롬프트를 보냅니다. |
| 여러 PC 관리 | 여러 connector daemon URL을 등록하고 사이드바에서 전환합니다. |
| 작업 로컬 유지 | 파일, 셸 명령, git, MCP 설정, Anthropic 인증 정보는 daemon이 실행되는 PC에 남습니다. |
| 세션 이어가기 | 기존 Claude 세션 파일을 보고, 이어서 대화하거나, 대화를 포크하거나, 원하는 폴더에서 새 세션을 시작합니다. |
| 도구 사용 검토 | Claude의 도구 호출을 브라우저에서 승인하거나 거부합니다. |
| 생성 이미지 보기 | 선택한 작업 폴더의 지원되는 이미지 파일을 채팅 화면에서 미리 봅니다. |

## 요구 사항

- Git
- [Bun](https://bun.sh)
- 제어하려는 모든 PC에 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) 설치 및 인증 완료
- DeskRelay 사이트 백엔드가 각 connector daemon에 접근할 수 있는 사설 네트워크 경로

원격 사용에는 Tailscale, WireGuard, 사설 LAN/VPN이 가장 쉽습니다. connector daemon을 공용 인터넷에 직접 노출하지 마세요.

## 권장 사용 모델

DeskRelay self 버전은 중앙 SaaS가 아니라 사용자별 self-host 도구입니다.

각 사용자는 자기 PC 한 대를 DeskRelay 서버로 정하고, 그 서버에 자기 디바이스만 등록해서 씁니다.

```text
사용자 A의 PC 서버
- A의 site-frontend
- A의 site-backend
- A가 등록한 connector daemon들

사용자 B의 PC 서버
- B의 site-frontend
- B의 site-backend
- B가 등록한 connector daemon들
```

이 구조에서는 별도 가입, 중앙 계정, 결제, Microsoft Store, Cloudflare relay가 필요 없습니다. 외부 접속은 Tailscale 같은 사설 VPN을 권장하고, 서버 관리는 SSH key로 처리합니다.

## 빠른 시작: PC 한 대를 서버로 사용

저장소를 클론합니다.

```powershell
git clone https://github.com/darkhtk/deskrelay.git
cd deskrelay
bun install
```

PC 서버 모드를 시작합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-start.ps1
```

Windows에서 `.ps1` 실행 정책 오류가 나지 않도록, README의 PowerShell 스크립트 예시는 현재 명령에만 `ExecutionPolicy Bypass`를 적용합니다. 시스템 설정은 바꾸지 않습니다.

이 스크립트는 다음 세 가지를 한 번에 실행합니다.

- `site-backend`: `127.0.0.1:18192`
- 이 PC의 `connector daemon`: `127.0.0.1:18191`
- 브라우저 UI: `0.0.0.0:18193`

스크립트가 출력하는 URL 중 하나를 브라우저에서 엽니다.

```text
http://127.0.0.1:18193
http://<내-PC-LAN-IP>:18193
http://<내-PC-Tailscale-IP>:18193
```

로그인 화면이 나오면 스크립트가 출력한 `Site token`을 입력합니다.

이 PC의 daemon은 자동으로 등록됩니다. 다른 PC도 연결하려면 그 PC에서 connector daemon을 실행한 뒤, Settings -> Devices에서 해당 daemon URL을 추가합니다.

중지:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-stop.ps1
```

상태 확인:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-status.ps1
```

상태 명령은 접속 URL과 현재 `Site token`을 다시 출력합니다. 브라우저 로그인 토큰을 잃어버렸다면 이 명령으로 다시 확인하세요.

## 다른 디바이스 등록

사이트 백엔드와 브라우저 UI는 원격에서 접근 가능한 한 대의 PC 서버에서 실행합니다. 제어하려는 다른 PC에서는 connector daemon만 실행하고, PC 서버의 Settings -> Devices에서 그 daemon을 디바이스로 추가합니다.

PC 서버와 대상 PC가 서로 접근할 수 있어야 합니다. 가장 쉬운 방식은 Tailscale 같은 사설 VPN입니다. daemon 포트는 공용 인터넷에 직접 열지 마세요.

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

PC 서버의 브라우저 UI에서 Settings -> Devices를 열고 Add device에 다음 값을 입력합니다.

| 입력값 | 예시 | 설명 |
|---|---|---|
| Daemon URL | `http://100.x.y.z:18091` | PC 서버에서 접근 가능한 대상 PC daemon 주소입니다. |
| Label | `work-laptop` | 선택 사항입니다. 비워두면 daemon이 알려주는 이름을 사용합니다. |
| Daemon token | `auth-token` 명령이 출력한 token | 대상 PC daemon의 API 토큰입니다. |

저장을 누르면 사이트 백엔드가 해당 daemon의 `/status`를 먼저 확인합니다. URL에 접근할 수 없거나 token이 틀리면 디바이스를 저장하지 않고 오류를 보여줍니다. 검증이 성공하면 디바이스 목록이 갱신되고, 사이드바에서 해당 디바이스를 선택해 사용할 수 있습니다.

PC 서버에서 자동 등록된 로컬 daemon은 별도 등록이 필요 없습니다. 다른 PC를 추가할 때만 그 PC의 daemon URL과 daemon token을 입력합니다.

등록 예시:

```text
http://100.x.y.z:18091
http://my-laptop:18091
http://my-desktop:18091
```

DeskRelay는 디바이스 목록을 PC 서버의 사이트 백엔드 프로세스에 저장합니다. 브라우저에서는 사이드바에서 등록된 디바이스를 전환할 수 있습니다.

## 외부 접속과 SSH key

외부에서 쓰려면 포트포워딩보다 Tailscale을 권장합니다.

```text
앱 사용:
Tailscale + CR_SITE_TOKEN

서버 관리:
Tailscale SSH 또는 일반 SSH + key only
```

브라우저 사용자는 PC 서버 URL로 접속합니다.

```text
http://<my-server-pc>:18193
```

서버 업데이트, 로그 확인, 재시작 같은 관리 작업은 SSH key로 접속해서 처리합니다. SSH는 비밀번호 로그인을 끄고 key 인증만 쓰는 편이 안전합니다.

```text
PasswordAuthentication no
PubkeyAuthentication yes
```

connector daemon 포트 `18091`은 공용 인터넷에 열지 마세요. 같은 PC 서버의 로컬 daemon은 `127.0.0.1:18191`처럼 로컬 전용으로 충분하고, 다른 PC의 daemon은 Tailscale/LAN 주소로만 접근하게 두세요.

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
