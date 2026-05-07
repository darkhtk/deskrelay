# DeskRelay

DeskRelay는 내 PC에서 실행되는 Claude Code CLI를 브라우저에서 원격으로 다루기 위한 self-host 도구입니다.

각 사용자가 자신의 PC에 서버를 띄우고, 자신이 제어할 PC들을 디바이스로 등록해서 사용합니다. 관리형 계정, 결제, 앱스토어 배포, 중앙 릴레이를 전제로 하지 않습니다.

## 무엇을 할 수 있나

| 기능 | 설명 |
|---|---|
| 브라우저에서 Claude Code 사용 | 서버 PC 또는 등록한 다른 PC의 `claude` CLI에 메시지를 보냅니다. |
| 여러 PC 등록 | 각 PC의 connector daemon을 등록하고 사이드바에서 전환합니다. |
| 세션 이어가기 | Claude Code 세션 목록을 보고 기존 대화를 이어가거나 새 세션을 시작합니다. |
| 작업 폴더 선택 | 허용된 workspace root 안에서 새 채팅의 작업 디렉터리를 고릅니다. |
| 권한 확인/편집 | 현재 선택된 디바이스의 Claude 권한 목록을 보고 수정합니다. |
| 스킬과 slash 명령 확인 | Claude 기본 명령과 추가 스킬을 사이드바에서 확인합니다. |
| 이미지 미리보기 | 작업 폴더 안 이미지 파일을 채팅 화면에서 렌더링합니다. |
| 연속 지시 큐잉 | Claude가 응답 중이어도 다음 지시를 composer에 계속 보낼 수 있습니다. |

## 화면

### 새 채팅과 작업 폴더 선택

![새 채팅 작업 폴더 선택](docs/assets/screenshots/new-chat-workspace.png)

### 세션 화면과 사용량 표시

![세션 화면](docs/assets/screenshots/chat-session.png)

### 연속 지시 큐잉

Claude가 이전 지시를 처리하는 동안에도 composer에서 다음 지시를 이어서 보낼 수 있습니다. DeskRelay는 입력을 순서대로 큐에 넣고 Claude CLI가 준비되는 대로 처리합니다.

![연속 지시 큐잉](docs/assets/screenshots/queued-prompts.png)

### 디바이스 설정

![디바이스 설정](docs/assets/screenshots/settings-devices.png)

### 일반 설정과 연결 진단

<p>
  <img src="docs/assets/screenshots/settings-general.png" alt="일반 설정" width="48%">
  <img src="docs/assets/screenshots/settings-diagnostics.png" alt="연결 진단" width="48%">
</p>

### 권한과 스킬

<p>
  <img src="docs/assets/screenshots/permissions-sidebar.png" alt="권한 탭" width="36%">
  <img src="docs/assets/screenshots/skills-sidebar.png" alt="스킬 탭" width="36%">
</p>

## 요구 사항

- Git
- [Bun](https://bun.sh)
- 제어하려는 PC마다 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) 설치 및 로그인
- 같은 LAN 또는 Tailscale 같은 사설 네트워크

공용 인터넷에 connector daemon 포트 `18091`을 직접 노출하지 마세요. 외부에서 접속하려면 Tailscale 사용을 권장합니다.

## 권장 구조

각 사용자는 자신의 서버 PC 한 대에서 DeskRelay를 실행합니다.

```text
사용자 A의 DeskRelay 서버 PC
- site-frontend
- site-backend
- 서버 PC connector daemon
- A가 추가 등록한 다른 PC connector daemon

사용자 B의 DeskRelay 서버 PC
- site-frontend
- site-backend
- 서버 PC connector daemon
- B가 추가 등록한 다른 PC connector daemon
```

이 구조에서는 별도 중앙 계정, 결제, 앱스토어 배포, 관리형 릴레이가 필요하지 않습니다.

## 설치

서버로 쓸 PC에서 한 번 실행합니다.

```powershell
git clone https://github.com/darkhtk/deskrelay.git
cd deskrelay
bun install
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-start.ps1
```

명령이 끝나면 접속 URL과 `Site token`이 출력됩니다.

- 같은 PC에서는 `http://127.0.0.1:18193`으로 접속합니다.
- 다른 기기에서는 출력된 Tailscale 또는 LAN URL로 접속합니다.
- 서버 PC에서 `앱 열기`를 누르면 보통 토큰 입력 없이 들어갑니다.
- 다른 기기에서는 `Site token`을 입력합니다.

서버 PC의 Claude CLI는 자동으로 기본 디바이스로 등록됩니다.

## 다른 PC 등록

서버 PC의 DeskRelay 폴더에 생성된 `REGISTER-OTHER-PC.txt`를 엽니다.

```powershell
notepad .\REGISTER-OTHER-PC.txt
```

그 안의 PowerShell 블록 전체를 제어하려는 다른 PC에 붙여 넣습니다.

등록 명령은 서버 URL과 Site token만 포함합니다. 나머지는 GitHub에서 최신 `scripts/install-connector.ps1`를 내려받아 처리합니다.

자동 처리되는 작업:

- `$HOME\deskrelay` 설치 또는 업데이트
- 기존 폴더가 깨져 있거나 다른 remote이면 백업 후 새 clone
- `bun install`
- connector daemon을 `0.0.0.0:18091`로 로그인 작업에 등록하고 시작
- 서버 URL에 맞는 Tailscale/LAN 주소 감지
- 서버에서 해당 connector URL에 접근 가능한지 검증
- 서버 디바이스 목록에 등록

서버 URL이 Tailscale 주소라면 등록 대상 PC도 같은 tailnet에 로그인되어 있어야 합니다.

## 자주 쓰는 명령

서버 중지:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-stop.ps1
```

서버 상태, URL, Site token 확인:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\self-pc-server-status.ps1
```

서버 상태 파일과 복사용 명령은 다음 위치에도 생성됩니다.

```text
.self-server\site-token.txt
.self-server\commands\
DESKRELAY-SERVER-CODE.txt
REGISTER-OTHER-PC.txt
```

이 파일들에는 Site token이 포함될 수 있으니 비밀번호처럼 다루세요.

## 외부 접속

외부에서 쓰려면 Tailscale을 설치하세요.

1. 서버 PC와 접속할 기기에 Tailscale을 설치합니다.
2. 같은 tailnet에 로그인합니다.
3. 서버 PC에서 `self-pc-server-status.ps1`를 실행해 Tailscale URL을 확인합니다.
4. 다른 기기의 브라우저에서 그 URL로 접속하고 `Site token`을 입력합니다.

## 보안 모델

DeskRelay는 내 PC를 원격으로 조작하는 도구입니다. 개발자 도구처럼 신중하게 다뤄야 합니다.

- connector daemon은 사용자의 권한으로 파일을 읽고 명령을 실행할 수 있습니다.
- browser approval UI는 Claude 도구 사용을 확인하게 해주지만 OS sandbox는 아닙니다.
- 가능한 작업 폴더를 `CR_CONNECTOR_WORKSPACE_ROOTS`로 제한하는 것이 좋습니다.
- `CR_SITE_TOKEN`과 daemon token을 비밀번호처럼 관리하세요.
- `18091`, `18092`, `18193`을 공용 인터넷에 직접 노출하지 마세요.

## 문서

- [고급 사용](docs/advanced.md)
- [개발 문서](docs/development.md)
- [Self-host 테스트 케이스](docs/SELFHOST_TEST_CASES.md)
- [Self-host 테스트 한계](docs/SELFHOST_TEST_GAPS.md)
- [최근 테스트에서 나온 결함](docs/SELFHOST_DEFECTS.md)

## 라이선스

메인 프로젝트는 Apache-2.0입니다. 자세한 내용은 [LICENSE](LICENSE)를 확인하세요.

Claude와 Claude Code는 Anthropic PBC의 상표입니다. DeskRelay는 Anthropic과 제휴하지 않은 오픈소스 프로젝트입니다.
