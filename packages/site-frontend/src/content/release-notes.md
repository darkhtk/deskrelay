## 릴리즈 노트

### Self-host 설치/등록 정리

- README의 설치/등록 절차를 `git clone` -> `bun install` -> 서버 시작 -> `REGISTER-OTHER-PC.txt` 실행 흐름으로 단순화했습니다.
- 다른 PC 등록 명령은 이제 GitHub의 bootstrap 스크립트를 받아 실행합니다. 대상 PC의 `$HOME\deskrelay`가 없거나, git 저장소가 아니거나, remote가 다르거나, 로컬 변경으로 업데이트할 수 없으면 기존 폴더를 백업하고 새로 clone합니다.
- 등록 명령에는 서버의 Tailscale URL을 우선 사용하고, 없으면 LAN URL을 사용합니다. `127.0.0.1`이 다른 PC 등록 명령에 들어가는 일을 피합니다.
- 등록 대상 PC에서도 서버 URL에 맞는 Tailscale/LAN 주소를 자동 감지하고, connector 외부 접근 가능 여부를 서버 등록 전에 검증합니다.
- 기존 connector가 같은 포트를 잡고 있어 새 token으로 `HTTP 401`이 나던 경우를 자동으로 정리한 뒤 다시 등록합니다.
- 공지사항은 실행 중인 self-host 서버가 공개 Git 저장소의 `ANNOUNCEMENT.txt`를 주기적으로 읽어 표시합니다.

### 현재 UI 기준

- 메인 화면은 한국어 전용 인터페이스와 **시작하기** 버튼으로 바로 열립니다.
- 세션, 권한, 스킬은 모두 현재 선택된 디바이스 기준으로 표시됩니다.
- 사이드바 권한 탭에서 CLI 권한을 편집할 수 있습니다. 항목 삭제, `All` 전환, 허용 목록 비우기, `Bash(*)`, `Grep(*)`, `Read(*)` 같은 자주 쓰는 권한 추가를 지원합니다.
- Claude 응답이 끝나면 `/context`를 확인해 CTX 표시를 갱신합니다.
