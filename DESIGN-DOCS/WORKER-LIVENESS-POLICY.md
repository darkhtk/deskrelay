# Worker Liveness Policy

## 배경

기존 DeskRelay 매니저 백엔드는 모든 워커 CLI 자식 프로세스에 대해
고정 `timeoutMs`(기본 600,000ms = 10분)를 시계초처럼 적용하여
초과 시 강제 종료(`Manager assistant CLI timed out after ...`)했다.

이 방식은 다음과 같은 한계가 있었다.

- 워커가 실제로는 빌드·테스트·LLM 응답 스트리밍 중이어도 10분이 지나면 죽는다.
- 5분 정도면 끝나는 작은 작업과 30분 이상 걸리는 대규모 리팩토링이
  같은 한계 시간을 공유하므로, 한쪽을 늘리면 다른 쪽이 오래 행을 걸 위험이 커진다.
- `Manager assistant CLI timed out after 600000ms.` 오류는 사용자에게
  "왜 끊겼는지"(idle인지 정말 시간 초과인지)에 대한 정보를 주지 못한다.

이 문서는 이를 대체하는 **진행도 기반(liveness-based) 정책**을 정의한다.

## 정책 요약

1. **stdout/stderr 활동 추적.** 워커 자식 프로세스의 stdout/stderr에서
   바이트가 도착할 때마다 `lastActivityAt`을 `Date.now()`로 갱신한다.
2. **idle threshold(기본 5분).** `Date.now() - lastActivityAt > idleMs`가
   되면 1차 idle 의심.
3. **파일 mtime 보강 점검.** stdio가 멈춰 있어도 워커가 자기 cwd에
   파일을 쓰고 있다면 살아 있다고 본다. cwd 디렉터리와 1-depth 자식
   엔트리의 `mtimeMs` 최댓값을 확인하여, 그 시각으로부터의 경과도
   `idleMs`를 넘은 경우에만 진짜 idle로 판정한다.
4. **idle 종료.** 두 조건이 동시에 충족되면 `proc.kill()` + 결과에
   `reason='idle'` 및 `Worker idle for <N>s (no stdout/stderr/file activity)`
   오류 메시지를 부착한다.
5. **hard safety cap(기본 1시간).** 무한 hang을 방지하기 위해
   `Date.now() - startedAt > maxMs`가 되면 무조건 종료하고
   `reason='hard-cap'`을 기록한다. 이 분기에서만 기존
   `Manager assistant CLI timed out after <maxMs>ms.` 메시지를 사용한다.
6. **점검 주기.** 위 두 조건은 30초(`WORKER_LIVENESS_TICK_MS`) 단위로
   `setInterval`을 통해 점검한다. interval은 `unref()`되어 idle한 이벤트
   루프를 막지 않는다.
7. **reason 분류.** 결과 객체의 `reason`은 `idle | hard-cap | crash | cancel`
   중 하나(혹은 정상 종료 시 `undefined`)로 분류된다. `cancel`은
   외부에서의 명시적 취소 경로에서 사용한다.

## 환경 변수

| 변수                          | 기본값       | 설명                                                       |
| ----------------------------- | ------------ | ---------------------------------------------------------- |
| `DESKRELAY_WORKER_IDLE_MS`    | `300000`     | stdio·파일 모두 정체로 판정하는 임계값(ms).                |
| `DESKRELAY_WORKER_MAX_MS`     | `3600000`    | 시작 시각으로부터의 최종 안전망(hard cap, ms).             |

값이 비어 있거나 숫자로 파싱되지 않거나 0 이하인 경우 기본값으로 폴백한다.
모두 30초 주기 점검 시점에서만 평가되므로 실제 종료까지 최대 약 30초의
지연이 있을 수 있다(설계상 허용).

## 기존 timeoutMs와의 호환성

- `ManagerWorkerParams.timeoutMs`, `ManagerAgentMessageRequest.timeoutMs`,
  `ManagerRoundAgentAssignment.timeoutMs`는 **deprecated**로 표시한다.
- 요청 본문에 값이 들어와도 API는 받아주며, 결과 레코드에
  `timeoutMs` 컬럼/필드 형태를 보존한다(아카이브·UI 호환).
- 다만 자식 프로세스의 1차 kill 결정에는 더 이상 사용되지 않는다.
  실제 종료 결정은 위 idle/hard-cap 정책이 단독으로 내린다.
- `clampWorkerTimeoutMs`도 유지된다(요청 검증·결과 기록용). 단,
  유효 범위 5초~30분은 워커가 살아 있는지 판정하는 데에는 영향이 없다.
- `Manager assistant CLI timed out after ...` 문자열은 워커 경로에서
  **오직 hard cap 분기**에서만 발생한다. 기존 `withTimeout` 유틸은
  매니저 어시스턴트 본체(`runDefaultManagerAssistantCli`)와 워커 사용 가능
  여부 5초 probe에서만 사용되며, 오류 문자열은 일반화된
  `Process timed out after <N>ms.`로 바뀌었다.

## 회귀 위험 자체점검

- **취소(cancel) 경로:** 외부에서 `cancelManagerTask`로 작업을 취소하면
  기존과 동일하게 작업 state가 `cancelled`로 마킹된다. 본 변경은
  자식 프로세스의 자동 종료 시점에만 영향을 미치므로 cancel 경로의
  의미는 동일하다. 단, cancel reason은 별도 호출자(상위 라우트)가
  결과에 부착해야 한다 — 본 helper는 자동으로 `cancel`을 채우지 않는다.
- **재시도(retry) 경로:** `tasks/:id/retry`는 동일 입력으로 다시
  `createAndRunManagerTask`를 호출한다. timeoutMs가 그대로 전달되어도
  새 정책 하에서는 무시되므로 재시도가 의도치 않게 더 일찍 종료될
  위험은 없다.
- **출력 truncation:** stdout/stderr 한도(2_000_000 / 500_000 바이트)에
  도달한 이후에는 readLimitedText가 더 이상 chunks에 push하지 않지만
  `onActivity` 콜백은 계속 호출하므로 `lastActivityAt`이 갱신된다.
  즉, 출력이 잘려도 워커가 살아 있다는 신호는 유지된다.
- **파일 mtime 외 변화 누락:** 1-depth만 점검하므로 깊은 하위 디렉터리에서만
  파일을 쓰는 워커는 stdio가 동시에 멈춰 있을 때 false-positive idle이
  될 수 있다. 실제로는 Claude CLI가 30초 이내 빈번하게 stdout(JSON 스트림)을
  내보내므로 트리거 가능성은 매우 낮지만, 필요 시 `DESKRELAY_WORKER_IDLE_MS`를
  올리는 것이 안전한 완화책이다.
- **5초 probe(`checkManagerWorkerProfile`)**: 기존 5초 `withTimeout` 사용은
  유지된다. 오류 문자열만 `Process timed out after ...`로 일반화되었다.
- **매니저 어시스턴트 본체(`runDefaultManagerAssistantCli`)**: 기존
  `withTimeout` 기반 단순 타임아웃을 유지한다(워커 dispatch 경로가 아님).
