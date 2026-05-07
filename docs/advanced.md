# 고급 사용

이 문서는 기본 설치와 다른 PC 등록을 마친 뒤 필요한 고급 설정만 다룬다. 처음 설치하는 경우에는 먼저 [README](../README.md)를 따른다.

## 외부 접속과 SSH 관리

브라우저 사용자는 DeskRelay URL로 접속한다.

```text
http://<server-pc-tailscale-or-lan-ip>:18193
```

서버 업데이트, 로그 확인, 재시작 같은 관리 작업은 SSH key로 접속해서 처리할 수 있다. SSH를 열어야 한다면 비밀번호 로그인을 끄고 key 인증만 쓰는 편이 안전하다.

```text
PasswordAuthentication no
PubkeyAuthentication yes
```

권장 구분:

```text
브라우저 사용:
Tailscale URL + Site token

PC 관리:
Tailscale SSH 또는 일반 SSH + key only
```

connector daemon 포트 `18091`은 공용 인터넷에 열지 않는다. 서버 PC 내부 daemon은 로컬 전용으로 충분하고, 다른 PC daemon은 Tailscale/LAN 주소에서만 접근 가능하게 둔다.

## connector 로그인 작업

다른 PC 등록 명령은 Windows login task 설치와 시작을 자동으로 처리한다. 수동으로 다룰 때만 아래 명령을 사용한다.

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

macOS/Linux에서는 `systemd`, `launchd`, `tmux`, `screen` 등 신뢰하는 프로세스 관리자를 사용한다.

## 주요 환경 변수

### site backend

| 변수 | 기본값 | 목적 |
|---|---:|---|
| `CR_SITE_HOST` | `127.0.0.1` | backend bind host |
| `CR_SITE_PORT` | `18092` | backend port |
| `CR_SITE_TOKEN` | 시작 시 생성 가능 | browser API bearer token |
| `CR_SITE_AUTH_OPTIONAL` | unset | 신뢰 가능한 로컬 개발망에서만 `1` 사용 |
| `CR_CONNECTOR_DAEMON_TOKEN` | local daemon token | backend가 같은 PC daemon에 proxy할 때 쓰는 token |

### connector daemon

| 변수 | 기본값 | 목적 |
|---|---:|---|
| `CR_CONNECTOR_HOST` | `127.0.0.1` | daemon bind host |
| `CR_CONNECTOR_PORT` | `18091` | daemon port |
| `CR_CONNECTOR_WORKSPACE_ROOTS` | unrestricted | 접근 가능한 작업 폴더 root 목록 |
| `CR_CONNECTOR_STATE_DIR` | OS별 사용자 상태 폴더 | daemon state 저장 위치 |
| `CR_CONNECTOR_AUTH_FILE` | state dir의 `auth.json` | daemon local API token 파일 |

Tailscale IP에 직접 bind해서 daemon을 띄우는 예시:

```powershell
$env:CR_CONNECTOR_HOST = "100.x.y.z"
$env:CR_CONNECTOR_WORKSPACE_ROOTS = "C:\Users\me\Projects"
bun run packages/pc-connector-daemon/src/bin.ts
```

일반 사용자는 수동 bind보다 등록 명령이 생성한 login task를 쓰는 편이 안전하다.
