# DeskRelay Self 남은 결함

이 문서는 self 프로젝트에서 Codex가 직접 처리할 수 있는 결함만 추적한다. 실제 다른 PC, 모바일, 실제 Claude 계정, 실제 Tailscale tailnet 검증은 별도 사용자 검증으로 둔다.

## 이번 반영

- 진단 모델에 `userVisible` 기준을 추가했다.
- backend doctor와 installer report는 내부 원인을 계속 남긴다.
- 사이트 UI는 실패, 경고, 업데이트 필요, 수동 조치가 있는 항목만 보여준다.
- 정상인 내부 확인값, 토큰 저장 방식, 중복 없음, backend alive 같은 사용자가 조치할 수 없는 항목은 사이트에서 숨긴다.
- 다른 PC 설치 스크립트가 installer report를 서버의 `/api/self/install-reports`로 제출한다.
- 서버는 최근 설치/등록 report를 `.self-server/state/install-reports.json`에 보관한다.
- 연결 진단 탭은 최근 report 중 사용자가 조치할 수 있는 항목만 표시한다.
- 디바이스 doctor가 저장된 원격 URL과 connector 실제 listen bind를 비교한다. Tailscale/LAN URL로 등록됐는데 connector가 `127.0.0.1`에만 바인딩된 경우에만 사이트에 표시한다.

## 남은 작업

| 우선순위 | 항목 | 현재 상태 | 다음 처리 |
| --- | --- | --- | --- |
| P1 | 오프라인 디바이스 업데이트 큐 | UI는 오프라인을 실패가 아닌 대기로 표시한다. 그러나 서버가 “다음 온라인 때 업데이트” 의도를 영속 저장하지는 않는다. | 디바이스별 desired update 상태를 서버 state에 저장하고, 디바이스가 다시 online으로 확인될 때 update를 재시도한다. |
| P1 | Tailscale/방화벽 실제 판정 | 설치 스크립트와 register-self report는 Tailscale 주소, 방화벽 권한, advertised daemon 접근 실패를 분류한다. 디바이스 doctor는 원격 URL과 실제 listen bind 불일치를 잡는다. | daemon doctor가 Tailscale CLI 상태와 Windows firewall rule 상태를 별도 step으로 보고하게 한다. 사이트에는 실패/경고만 표시한다. |
| P2 | 실패 report 누적 관리 | 최근 설치 report는 서버에 저장된다. | 최근 N개 보관 정책, 성공 report 압축, 같은 PC의 반복 실패 묶기, report 삭제 명령을 추가한다. |
| P2 | mock/virtual UI 회귀 테스트 | backend, daemon, 일부 frontend 단위 테스트가 있다. | 실제 Claude 없이 streaming, SSE resume, slash command, attachment, update UI 상태를 virtual transport로 반복 검증한다. |

## 표시 원칙

- backend는 원인을 풍부하게 감지한다.
- 사이트는 사용자가 판단하거나 조치할 수 있는 상태만 표시한다.
- 정상인 내부 체크는 UI에서 숨긴다.
- 실패 report는 “무엇이 막혔고, 다시 실행해도 안전한지, 다음 조치가 무엇인지”만 보여준다.
- 채팅창 UI는 사용자가 명시 요청하지 않는 한 건드리지 않는다.
