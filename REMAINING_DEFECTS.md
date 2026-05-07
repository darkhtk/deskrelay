# DeskRelay Self 남은 결함 목록

이 문서는 self-host 파워유저 관점에서 아직 닫히지 않은 설치/연결 신뢰 결함을 추적한다. 이미 자동 테스트로 닫은 `register-self` 중복 등록, device list 조회 실패, 중복 row 삭제 실패는 제외한다.

## D1. 다른 Windows PC 실제 등록 검증 부족

**상태:** 미검증

**증상**

서버 PC가 아닌 다른 Windows PC에서 등록 명령을 실행했을 때, repository 설치, connector 시작, daemonUrl 감지, server registry 등록, UI 목록 반영까지 끝까지 검증한 기록이 부족하다.

**위험**

unit test와 가상 smoke는 통과해도 실제 사용자 PC에서는 Git/Bun/PATH/PowerShell/네트워크 상태 때문에 등록이 실패할 수 있다.

**필요 검증**

- 깨끗한 Windows 사용자 profile에서 등록 명령 실행
- 기존 `$HOME\deskrelay`가 없을 때 clone 되는지 확인
- 기존 `$HOME\deskrelay`가 다른 repo 또는 dirty repo일 때 backup 후 재설치 되는지 확인
- 등록 후 서버 UI 디바이스 목록에 즉시 나타나는지 확인
- 등록 후 선택하면 세션 조회와 새 채팅이 되는지 확인

**해결 방향**

- 등록 명령을 `install -> start -> local /status -> advertised /status -> server POST -> server list 확인` 단계로 출력
- 실패 단계별 exit code와 메시지 분리
- 성공 시 등록된 device id, daemonUrl, log path 출력

## D2. Tailscale 미설치/미연결 상태 분류 부족

**상태:** 미검증

**증상**

다른 PC 등록 시 Tailscale이 없거나 로그인되어 있지 않으면 advertiseHost 감지 또는 server-to-connector 접근이 실패한다. 현재는 방화벽/LAN/Tailscale 문제가 하나의 접근 실패 메시지로 합쳐질 수 있다.

**위험**

사용자가 Tailscale을 설치해야 하는지, 로그인해야 하는지, 같은 tailnet인지, 아니면 LAN으로 접근하면 되는지 판단하기 어렵다.

**필요 검증**

- Tailscale 미설치 PC
- Tailscale 설치됐지만 로그아웃된 PC
- Tailscale 연결은 됐지만 서버 PC와 다른 tailnet인 PC
- Tailscale IP는 있으나 server PC에서 접근 불가능한 PC

**해결 방향**

- `register-self` 또는 `doctor`에서 Tailscale adapter 존재 여부와 IP를 별도 표시
- advertiseHost 자동 선택 근거 출력
- Tailscale 후보와 LAN 후보를 분리해서 probe

## D3. Windows Firewall 차단 분류 부족

**상태:** 미검증

**증상**

connector daemon이 `0.0.0.0:18091`로 떠 있어도 Windows Firewall inbound 정책이 막으면 서버 PC에서 접근할 수 없다.

**위험**

사용자는 daemon이 실행 중인데도 디바이스가 등록되지 않거나 offline으로 보이는 상황을 이해하기 어렵다.

**필요 검증**

- 대상 PC에서 `18091` inbound 차단
- server PC에서 `http://<target>:18091/status` 접근 실패 확인
- 등록 명령이 registry POST 전에 멈추는지 확인

**해결 방향**

- 실패 메시지에 `daemon process running`, `local status ok`, `advertised status failed`를 분리 표시
- Windows에서 firewall rule 존재 여부를 doctor에 포함
- 필요 시 사용자가 직접 실행할 firewall check command 출력

## D4. Login task 재부팅/재로그인 복구 검증 부족

**상태:** 미검증

**증상**

등록 직후 connector가 떠 있어도, Windows 재로그인 또는 재부팅 후 login task가 정상적으로 connector를 다시 띄우는지 실제 검증이 부족하다.

**위험**

처음 등록은 성공했지만 다음 날 디바이스가 offline이 되는 신뢰 문제가 생긴다.

**필요 검증**

- `login-task install --start` 후 로그아웃/로그인
- 재부팅 후 connector process 존재 확인
- log file에 start 기록 확인
- server UI에서 online 복귀 확인

**해결 방향**

- `cr-connector login-task status`를 더 구조화
- doctor에 task installed, task action, script path, last log tail 포함
- 등록 성공 후 login task 상태를 반드시 출력

## D5. 실제 Claude streaming/approval/image preview 검증 부족

**상태:** 미검증

**증상**

connector 등록과 daemon 접근은 별개로, 실제 Claude Code CLI 세션 실행, streaming 업데이트, approval flow, 이미지 preview는 end-to-end 수동 검증 의존도가 높다.

**위험**

디바이스는 online인데 실제 작업이 멈추거나 새로고침해야 보이는 신뢰 문제가 남을 수 있다.

**필요 검증**

- 새 채팅에서 `ping`
- 긴 응답 streaming
- `/permissions`와 권한 변경
- approval 필요한 tool 실행
- 이미지 첨부 후 전송
- Claude가 생성한 이미지 preview
- streaming 중 브라우저 새로고침 후 이어받기

**해결 방향**

- run event backlog/cursor 기반 재연결 검증
- approval timeout과 daemon timeout 일치
- 이미지 파일 전달/preview 조건을 doctor 또는 debug panel에 표시

## D6. 상태 진단 모델 부족

**상태:** 설계 필요

**증상**

현재 상태는 UI와 로그, 명령 출력에 흩어져 있다. 파워유저가 어느 노드에서 실패했는지 한 번에 보기 어렵다.

**위험**

연결 문제를 해결할 때 매번 수동으로 `status`, log, netstat, browser UI를 오가야 한다.

**필요 검증**

- 서버 실행 여부
- site token 유효 여부
- device registry 상태
- connector process 상태
- local /status
- advertised /status
- daemon token 일치 여부
- behavior host 준비 여부
- Claude CLI 사용 가능 여부
- workspace roots 유효 여부
- login task 설치 여부

**해결 방향**

- `cr-connector doctor` JSON 출력 정리
- server `doctor` 또는 `/api/diagnostics` 추가
- UI 연결 진단 탭은 doctor 결과를 그대로 렌더링

## D7. 설치/등록 명령 재실행성 보장 부족

**상태:** 부분 개선

**증상**

같은 등록 명령을 여러 번 실행해도 중복 registry row는 막기 시작했지만, 폴더 상태, task 상태, process 상태, token 상태까지 완전한 reconcile로 보장되지는 않았다.

**위험**

한 번 실패한 PC에서 같은 명령을 다시 실행했을 때 기존 실패 흔적 때문에 다른 실패가 발생할 수 있다.

**필요 검증**

- 등록 명령 3회 연속 실행
- 중간에 connector process 강제 종료 후 재실행
- `$HOME\deskrelay` dirty 상태에서 재실행
- login task가 이미 있을 때 재실행
- auth token이 이미 있을 때 재실행

**해결 방향**

- installer를 install script가 아니라 reconcile script로 취급
- 각 단계가 idempotent인지 테스트
- 마지막에 server registry와 connector state를 대조

## 우선순위

1. D6 상태 진단 모델
2. D7 설치/등록 재실행성
3. D1 다른 Windows PC 실제 등록
4. D4 login task 복구
5. D2 Tailscale 분류
6. D3 Firewall 분류
7. D5 Claude run end-to-end
