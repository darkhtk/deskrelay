# Worker Liveness Policy

## 배경

기존 worker 실행은 `timeoutMs` 또는 별도 hard-cap을 시계처럼 적용할 수 있었다.
그 결과 실제로는 빌드, 테스트, LLM 응답 스트림, 다운로드, 설치 작업을 계속 수행 중인데도
`Manager assistant CLI timed out after ...` 같은 오류로 강제 종료되는 문제가 있었다.

이 정책은 worker 경로에서 고정 시간 초과를 제거하고, 프로세스가 응답할 때까지 기다리되
사용자와 관리자가 현재 상태를 볼 수 있도록 liveness 관찰만 기록한다.

## 정책 요약

1. **worker는 elapsed time 때문에 kill하지 않는다.**
   `timeoutMs`, `DESKRELAY_WORKER_IDLE_MS`, 과거 `DESKRELAY_WORKER_MAX_MS` 값은
   자식 프로세스의 1차 종료 조건이 아니다.
2. **stdout/stderr 활동을 관찰한다.**
   worker stdout/stderr에서 바이트가 들어오면 `lastActivityAt`을 갱신한다.
3. **workspace mtime을 보조 신호로 본다.**
   stdio가 조용해도 cwd 또는 1-depth 항목의 mtime이 바뀌면 작업 중인 신호로 본다.
4. **조용한 상태도 죽이지 않는다.**
   stdio와 workspace 모두 조용하면 `worker.liveness` step에
   “still running; no stdout/stderr or workspace changes...” 형태로 기록한다.
5. **관찰 주기만 있다.**
   기본 30초마다 liveness를 확인하고 task `updatedAt`과 `worker.liveness` step을 갱신한다.
6. **task stream은 terminal 상태까지 유지한다.**
   `/api/manager/tasks/:id/stream`은 worker가 끝나지 않았다는 이유만으로 2분 뒤 닫히지 않는다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | ---: | --- |
| `DESKRELAY_WORKER_IDLE_MS` | `300000` | liveness step에서 “quiet”로 표시할 기준이다. kill 기준이 아니다. |
| `DESKRELAY_WORKER_LIVENESS_TICK_MS` | `30000` | liveness 관찰 주기다. |
| `DESKRELAY_WORKER_STALE_MS` | `1800000` | 서버 상태 요약에서 오래 갱신되지 않은 worker task를 stale로 표시할 기준이다. kill 기준이 아니다. |

`DESKRELAY_WORKER_MAX_MS`는 더 이상 worker kill 정책에 사용하지 않는다.

## 기존 timeoutMs와의 호환성

- `ManagerWorkerParams.timeoutMs`, `ManagerAgentMessageRequest.timeoutMs`,
  `ManagerRoundAgentAssignment.timeoutMs`는 deprecated 입력으로만 남긴다.
- API 호환을 위해 요청 본문에 값이 있어도 받을 수 있지만, worker 프로세스 종료에는 쓰지 않는다.
- `ManagerWorkerProfile.defaultTimeoutMs`도 기존 클라이언트 표시와 저장 호환을 위해 유지한다.
- 과거 기록에 `timedOut: true`가 남아 있으면 health gate는 이를 새 timeout으로 해석하지 않고
  “legacy forced-stop flag”로 표시한다.

## 예외

- `checkManagerWorkerProfile`의 5초 probe는 worker 실행이 아니라 사용 가능성 확인이므로 유지한다.
- 서버 업데이트, git remote 확인, 외부 진단처럼 worker dispatch가 아닌 짧은 probe 경로는 각 기능의
  별도 timeout 정책을 유지할 수 있다.
- 명시적 취소 API는 task state를 `cancelled`로 바꾸지만, 현재 구현은 이미 실행 중인 외부 worker
  프로세스까지 강제 종료하지 않는다. 별도 process-control 기능을 만들 때만 cancel reason을
  결과에 연결한다.
