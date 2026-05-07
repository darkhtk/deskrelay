## 릴리즈 노트

### Self-host 설치와 등록 정리

- 설치 흐름을 `git clone` -> `bun install` -> 서버 시작 -> `REGISTER-OTHER-PC.txt` 실행으로 단순화했습니다.
- 다른 PC 등록 명령은 서버 URL과 Site token만 포함합니다.
- 실제 설치 작업은 GitHub에서 내려받은 `scripts/install-connector.ps1`가 처리합니다.
- 대상 PC의 `$HOME\deskrelay`가 없거나, git 저장소가 아니거나, remote가 다르거나, 깨끗하게 업데이트할 수 없으면 기존 폴더를 백업하고 새로 clone합니다.
- connector daemon은 `0.0.0.0:18091`로 실행되며, 서버 URL에 맞는 Tailscale/LAN 주소를 자동 감지합니다.
- 서버 등록 전에 server -> connector 접근 가능 여부를 검증합니다.
- 기존 connector가 같은 포트를 잡고 있거나 token이 맞지 않는 상황을 정리한 뒤 다시 등록합니다.

### UI 기준

- 메인 화면은 한국어 기준의 간단한 시작 화면입니다.
- 세션, 권한, 스킬은 모두 현재 선택된 디바이스 기준으로 표시됩니다.
- 권한 탭에서 Claude 권한 목록을 보고 수정할 수 있습니다.
- 스킬 탭에서 Claude 기본 slash 명령과 추가 스킬을 확인할 수 있습니다.
- composer에서 연속으로 보낸 지시는 순서대로 큐잉됩니다.
- Claude 응답이 끝나면 context 사용량을 갱신합니다.

### 테스트 보강

- `bun run test:selfhost-virtual`로 서버 설치, 원격 등록, 원격 사용, 해제의 가상 self-host 흐름을 검증합니다.
- `bun run test:selfhost-failures`로 local-only URL, unreachable daemon, 잘못된 daemon token, 서버 offline, 잘못된 advertise endpoint, workspace root escape를 검증합니다.
- 최근 테스트에서 발견된 결함은 `docs/SELFHOST_DEFECTS.md`에 기록합니다.
