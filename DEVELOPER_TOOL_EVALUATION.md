# DeskRelay 개발도구 평가: 남은 부족분

평가일: 2026-05-11  
대상: self-host `main` 브랜치

README 정리, 서버 설치 bootstrap, macOS 서버 스크립트, 매뉴얼 분리, connector `doctor`는 이미 들어왔다. 아래에는 아직 닫혔다고 보기 어려운 것만 남긴다.

## 1. 실제 다른 Windows PC 등록 검증

**아직 빠진 것**

- 깨끗한 Windows 사용자 프로필에서 서버가 아닌 다른 PC 등록 명령을 끝까지 실행한 기록
- Git/Bun 없음, PATH 꼬임, 기존 `$HOME\deskrelay` dirty 상태, stale connector, 포트 점유 상태별 실제 검증
- 등록 성공 후 서버 UI 디바이스 목록 즉시 반영, 세션 조회, 새 채팅까지 이어지는 end-to-end 확인

**통과 기준**

- 같은 등록 명령을 3회 반복 실행해도 device row가 하나로 수렴한다.
- 실패 시 어느 단계에서 막혔는지 명령 출력만으로 알 수 있다.
- 성공 시 device id, daemon URL, log path, 서버 등록 확인 결과가 출력된다.

## 2. Tailscale과 방화벽 실패 분류

**아직 빠진 것**

- Tailscale 미설치, 로그아웃, 다른 tailnet, LAN fallback, Windows Firewall 차단을 서로 다른 실패로 분류하는 실제 검증
- 서버 PC에서 대상 PC의 advertised daemon URL 접근 실패 시 원인 후보를 좁혀주는 진단

**통과 기준**

- `local daemon ok`, `advertised daemon unreachable`, `firewall suspected`, `tailscale missing`, `tailscale logged out`, `wrong network suspected`가 구분된다.
- 등록 명령이 registry POST 전에 접근 검증 실패를 명확히 멈춘다.

## 3. 재부팅/재로그인 복구 신뢰

**아직 빠진 것**

- 서버 PC와 등록 PC 모두에서 로그인 작업이 재부팅 후 실제로 복구되는지 검증
- login task installed와 실제 connector online 사이의 차이를 보여주는 상태 확인

**통과 기준**

- Windows 재부팅 후 서버 PC가 자동으로 `site-frontend`, `site-backend`, 서버 connector를 복구한다.
- 등록 PC 재부팅 후 connector가 자동으로 online이 된다.
- 실패 시 task path, log path, 마지막 실행 결과를 바로 볼 수 있다.

## 4. 통합 doctor UI

**아직 빠진 것**

- connector CLI의 `doctor` 결과를 서버/프론트 연결 진단 탭에서 일관된 JSON 모델로 렌더링
- 서버, registry, selected device, daemon token, behavior, Claude CLI, workspace roots, login task를 한 번에 판정하는 화면

**통과 기준**

- 사용자가 연결 진단 탭 하나만 보고 어느 노드가 실패했는지 판단할 수 있다.
- 각 실패 항목은 다음 행동을 하나 이상 제시한다.

## 5. 실제 Claude run end-to-end 회귀 검증

**아직 빠진 것**

- 실제 Claude Code 실행 기준의 streaming, approval, slash command, image attach, generated image preview 자동 검증
- 브라우저 새로고침 또는 SSE 재연결 뒤 run event가 누락되지 않는 검증

**통과 기준**

- `ping`, 긴 응답 streaming, 권한 요청, 이미지 첨부, 생성 이미지 preview가 새로고침 없이 동작한다.
- streaming 중 새로고침해도 마지막 cursor 이후 이벤트를 이어받는다.

## 6. 업데이트 실패와 꺼진 디바이스 처리

**아직 빠진 것**

- 전체 업데이트 실패 시 자동 복구, 재시도, 실패 원인 표시
- 꺼져 있는 디바이스가 다음 부팅 때 업데이트를 이어받는 보장

**통과 기준**

- 업데이트 상태가 `not_started`, `running`, `succeeded`, `failed`, `pending_until_device_online`으로 구분된다.
- 실패한 디바이스는 로그와 재시도 액션을 제공한다.

## 7. 보안 경계 강화

**아직 빠진 것**

- Site token이 URL/명령에 포함되는 구조에 대한 회전, 폐기, 노출 경고
- daemon port 공개 범위와 workspace root 제한 해제의 위험을 액션 가까이에서 표시
- 디바이스 제거 시 서버 registry 삭제와 대상 PC uninstall 실패를 분리해 보여주는 감사 정보

**통과 기준**

- token rotate/revoke 경로가 있다.
- unrestricted workspace 옵션과 connector port 노출은 명확한 위험 확인 후에만 켜진다.
- 제거 실패 시 서버에서 지워진 것과 대상 PC에 남은 것이 분리 표시된다.

## 우선순위

1. 실제 다른 Windows PC 등록 검증
2. Tailscale/방화벽 실패 분류
3. 재부팅/재로그인 복구 신뢰
4. 통합 doctor UI
5. 실제 Claude run end-to-end 회귀 검증
6. 업데이트 실패와 꺼진 디바이스 처리
7. 보안 경계 강화
