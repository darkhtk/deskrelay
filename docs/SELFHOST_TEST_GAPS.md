# Self-Host Test Gaps

이 문서는 `bun run test:selfhost-virtual`이 검증하지 못하는 happy path 의존성을 기록한다.

## 현재 가상 E2E가 확인하는 것

- 격리된 임시 루트에 self-host 서버 상태를 생성한다.
- 실제 site backend를 실행한다.
- 복사 등록 명령이 GitHub의 `scripts/install-connector.ps1`를 내려받도록 생성되는지 확인한다.
- 가상 원격 PC daemon을 별도 포트와 별도 상태 폴더로 실행한다.
- `registerSelf()` 경로로 서버에 원격 디바이스를 등록한다.
- site -> daemon 프록시로 `remote-claude` behavior가 보이는지 확인한다.
- site -> daemon 프록시로 workspace root, directory listing, mkdir가 동작하는지 확인한다.
- 디바이스 삭제 후 목록에서 사라지고 해당 device route가 404가 되는지 확인한다.

## 아직 happy path인 부분

- 서버 PC와 원격 PC가 모두 같은 머신의 `127.0.0.1`로 가상화된다.
- 실제 Tailscale/LAN 라우팅, Windows Firewall, 다른 PC 간 네트워크는 검증하지 못한다.
- 사용자가 복사한 PowerShell block의 `Invoke-WebRequest` 네트워크 다운로드 전체는 실행하지 않는다.
- Windows login task는 실제 등록하지 않고 fake `installTask`로 daemon process를 띄운다.
- 재부팅 후 자동 시작, task scheduler 권한 문제, 기존 task 충돌은 검증하지 못한다.
- 실제 Claude CLI 메시지 실행, 스트리밍, approval, 이미지 렌더링은 실행하지 않는다.
- 디바이스 삭제는 서버 registry 삭제와 proxy route 404까지만 본다.
- 원격 PC의 login task 제거와 local connector state cleanup은 보지 않는다.

## 실제 사용자 설치 실패를 잡기 위해 추가할 테스트

- local-only 서버 URL이 등록 명령에서 즉시 거부되는지 확인한다.
- Tailscale URL로 접근하는데 target PC에 Tailscale IP가 없으면 명확한 오류를 내는지 확인한다.
- 서버가 죽어 있으면 registration이 timeout 후 실패하고 device registry가 오염되지 않는지 확인한다.
- daemon token이 틀리면 서버가 등록을 거부하고 device registry가 오염되지 않는지 확인한다.
- daemon이 127.0.0.1에만 bind된 상태로 외부 주소를 advertise하면 접근성 검증에서 실패하는지 확인한다.
- workspace root 밖의 경로 접근이 forbidden으로 막히는지 확인한다.
- 삭제 후 삭제된 device id로 proxy 요청하면 404가 유지되는지 확인한다.
