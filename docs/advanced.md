# 고급 사용

이 문서는 기본 설치와 다른 PC 등록을 마친 뒤 필요한 고급 설정만 다룹니다. 처음 설치하는 경우에는 먼저 [README](../README.md)의 설치 절차를 따르세요.

## 외부 접속과 SSH 관리

브라우저 사용자는 DeskRelay URL로 접속합니다.

```text
http://<my-server-pc>:18193
```

서버 업데이트, 로그 확인, 재시작 같은 관리 작업은 SSH key로 접속해서 처리할 수 있습니다. SSH는 비밀번호 로그인을 끄고 key 인증만 쓰는 편이 안전합니다.

```text
PasswordAuthentication no
PubkeyAuthentication yes
```

권장 구분은 단순합니다.

```text
앱 사용:
Tailscale + Site token

PC 관리:
Tailscale SSH 또는 일반 SSH + key only
```

connector daemon 포트 `18091`은 공용 인터넷에 열지 마세요. DeskRelay를 실행한 서버 PC의 로컬 daemon은 `127.0.0.1:18191`처럼 로컬 전용으로 충분하고, 다른 PC의 daemon은 Tailscale/LAN 주소로만 접근하게 두세요.

## Windows에서 connector 지속 실행

다른 PC 등록 명령은 Windows login task 설치와 시작을 자동으로 처리합니다. 아래 명령은 수동으로 connector를 다룰 때만 사용하세요.

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
