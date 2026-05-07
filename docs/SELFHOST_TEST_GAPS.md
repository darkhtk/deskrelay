# Self-Host Test Gaps

이 문서는 `bun run test:selfhost-virtual`과 `bun run test:selfhost-failures`가 어디까지 검증하고, 무엇을 아직 실제 환경 검증으로 남겨두는지 기록한다.

## 현재 자동 테스트가 확인하는 것

### `test:selfhost-virtual`

- 격리된 임시 루트에 self-host 서버 상태를 생성한다.
- 실제 site backend를 실행한다.
- 등록 명령이 GitHub의 `scripts/install-connector.ps1`를 내려받도록 생성되는지 확인한다.
- 가상 원격 PC daemon을 별도 포트와 별도 상태 폴더로 실행한다.
- `registerSelf()` 경로로 서버에 원격 디바이스를 등록한다.
- site -> daemon 프록시로 `remote-claude` behavior가 보이는지 확인한다.
- site -> daemon 프록시로 workspace root, directory listing, mkdir가 동작하는지 확인한다.
- 디바이스 삭제 후 목록에서 사라지고 해당 device route가 404가 되는지 확인한다.

### `test:selfhost-failures`

- 다른 PC 등록에 `127.0.0.1` 서버 URL이 들어가면 설치 전에 거부한다.
- 서버가 unreachable daemon을 저장하지 않는다.
- daemon token이 틀리면 등록을 거부하고 registry를 오염시키지 않는다.
- 서버가 꺼져 있으면 `register-self`가 명확히 실패한다.
- advertised connector endpoint가 닿지 않으면 서버 등록 전에 실패한다.
- workspace root 밖 경로 접근이 403으로 차단된다.

## 아직 happy path인 부분

- 서버 PC와 원격 PC가 같은 머신 안에서 포트와 상태 폴더만 분리되어 실행된다.
- 실제 다른 PC 사이의 LAN/Tailscale 라우팅은 검증하지 않는다.
- Windows Firewall 자동 설정과 관리자 권한 차이는 검증하지 않는다.
- 사용자가 복사한 PowerShell block의 GitHub 다운로드 전체를 깊게 실행하지 않는다.
- Windows login task는 실제 등록하지 않는 케이스가 있다. 자동 시작, 재부팅 후 복구, Task Scheduler 권한 문제는 별도 확인이 필요하다.
- 실제 Claude CLI 메시지 실행, 스트리밍, approval, 이미지 렌더링은 이 smoke 범위에서 제외한다.
- 디바이스 삭제는 서버 registry 삭제와 proxy route 404까지만 본다. 원격 PC의 login task 제거와 local connector state cleanup은 별도 테스트가 필요하다.
- Tailscale이 없는 PC에서 Tailscale URL 등록이 실패하는지는 이 머신이 Tailscale IP를 가진 경우 자동 skip된다.

## 다음에 보강할 테스트

- Tailscale이 없는 깨끗한 Windows VM에서 등록 명령 실행.
- Windows Firewall이 막혀 있을 때 오류 문구와 복구 안내 확인.
- 실제 login task 등록 후 로그아웃/재부팅/재로그인 복구 확인.
- 복사한 `REGISTER-OTHER-PC.txt` 전체 block을 실제 다른 PC에서 실행.
- 실제 Claude CLI run, SSE streaming replay, approval modal, 이미지 preview까지 포함하는 end-to-end 검증.
- 삭제 명령 복사 후 원격 PC의 login task와 local connector state가 정리되는지 확인.
