# 매니저 판정 패킷 자동 강등 규칙

`buildManagerJudgmentPackets`가 매 routine round 종료 시마다 emit하는 `priority='approval'` 패킷을 자동으로 `priority='notice'`로 강등하기 위한 규칙을 정의한다. 사용자가 정말로 중요한 사안에만 승인 행위를 하도록 만드는 것이 목적이다.

가드 함수: `shouldDowngradeToNotice(...)` — `packages/site-backend/src/app.ts`에 정의. 분기 6/7의 패킷 생성 직전 호출되어 `priority`를 결정한다.

## 자동 downgrade 규칙

분기 6(라운드 정리: summarize → continue)과 분기 7(첫 라운드 준비: ready & no activeRound)에서 아래 조건을 **모두** 만족하면 패킷 `priority`가 `approval` → `notice`로 강등된다.

| 조건 | 분기 6 (summarize/continue) | 분기 7 (first-round/continue) | 검사 위치 |
| --- | --- | --- | --- |
| `verdict` | `continue` 또는 `wait` | `continue` | `shouldDowngradeToNotice` |
| `readiness.userCheckRequired === false` | 필수 | 필수 | `shouldDowngradeToNotice` |
| `userBlockers.length === 0` | 필수 | 필수 | `shouldDowngradeToNotice` |
| `failedEvidence.length === 0` | 필수 | 필수 | `shouldDowngradeToNotice` |
| `failedResults.length === 0` | 필수 | 필수 | `shouldDowngradeToNotice` |
| `roundHasActionableHealthIssue === false` | 필수 | 필수 | `shouldDowngradeToNotice` |
| `protocolProblems.length === 0` | 필수 | 필수 | `shouldDowngradeToNotice` |
| 이미 다른 approval 패킷이 큐에 있는지 | 진입 가드(`packets.every(... !== 'approval')`)로 이미 차단 | 진입 가드(`packets.length === 0`)로 이미 차단 | 분기 진입 조건 |

조건 중 하나라도 false면 본 패킷은 기존대로 `priority='approval'`을 유지한다.

## 사용자 승인 유지 케이스

다음 분기는 본 라운드에서 진짜로 사람 의사결정이 필요한 카테고리이므로 강등하지 않는다.

| 분기 | 트리거 | verdict | priority | 사용자 승인이 필요한 이유 |
| --- | --- | --- | --- | --- |
| 분기 1 | `!input.readiness.ready` | `blocked` | `approval` | 사전 준비(프로토콜/readiness)가 미충족 — 워커가 임의로 진행하면 안 됨 |
| 분기 3 | `userBlockers.length > 0 \|\| readiness.userCheckRequired` | `user_check` | `approval` | 명시적인 user checkpoint — 사람 확답 없이는 루프 진행 불가 |
| 분기 4 | `failedResults.length > 0 \|\| failedEvidence.length > 0` | `retry` | `approval` | 라운드 결과가 실패/누락 — repair/retry는 신뢰 영향이 커서 사람이 결정 |
| 분기 5 | `protocolProblems.length > 0 && readiness.ready` | `direction_change` | `approval` | 프로토콜 위반/모호 — 방향 전환은 본질적으로 사람 판단 |

위 분기는 본 작업에서 **수정하지 않는다**. 이 분기들이 emit한 approval 패킷이 큐에 존재하면, 분기 6/7은 진입 가드에서 이미 컷되어 강등 로직 자체가 동작하지 않는다.

## 향후 확장 후보

- 분기 6 강등 시 `staleEvidence.length > 0`이면 `confidence`도 `medium`으로 함께 낮추는 정책 (현재는 `priority`만 조정).
- 동일 라운드에서 연속 N회 이상 `continue/notice`만 emit된 경우, N+1회차에는 강제로 `approval`로 promote하여 "조용히 무한루프" 방지.
- `roundHealthGate.runningRuns`/`blockedRuns` 카운트를 가드 입력에 추가하여 헬스 게이트의 미세한 경고도 강등 조건에서 제외.
- 사용자별 "조용 모드" 토글: 사용자가 명시적으로 ack 빈도를 낮추고 싶을 때만 강등 폭을 더 넓힘.
- 분기 2(toolchain setup) 강등 검토 — 현재는 항상 `approval`이지만, 워커가 자체적으로 해결 가능한 케이스에 한해 `notice` 강등 후보.

## 회귀 위험 자체점검

- **라운드 실패 케이스 강등 위험**: 강등 가드가 `failedEvidence`, `failedResults`, `roundHasActionableHealthIssue`, `protocolProblems`를 모두 0으로 요구하므로 실패가 발생한 routine은 강등되지 않는다. 즉 사용자 알림이 누락될 위험은 낮다.
- **user-check 누락 위험**: `readiness.userCheckRequired === false` AND `userBlockers.length === 0`을 모두 요구하므로 user-check 신호가 어느 한 경로로 들어와도 강등을 차단한다.
- **진입 순서 의존**: 분기 6/7은 분기 1/3/4/5 다음에 평가된다. 분기 1/3/4/5에서 이미 approval 패킷을 큐에 넣으면 분기 6은 `packets.every(... !== 'approval')`에서, 분기 7은 `packets.length === 0`에서 컷된다. 분기 순서를 바꾸면 본 규칙이 깨지므로 주의.
- **타입 불변성**: `ManagerJudgmentPriority = "silent" | "notice" | "approval"` (`packages/shared/src/management.ts`)에서 `notice`는 이미 1급 시민이므로 enum 확장 없이 안전하게 강등 가능.
- **무음 위험 (silent loop 가능성)**: 동일 라운드가 계속 `notice`만 내보내면 사용자가 진행 상황을 놓칠 수 있다. 향후 확장 후보 항목의 "N회차 promote" 정책이 이 위험을 완화한다. 현재는 매니저 UI 측에서 `notice` 패킷도 visibility 있게 표시하는 책임을 가진다.
