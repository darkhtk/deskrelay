# Worker Liveness — Implementation Notes (R-no-timeout)

## Scope

DeskRelay 매니저 백엔드의 worker 디스패치 로직에서 고정 `timeoutMs` 기반
강제 종료를 폐기하고, 진행도 기반 liveness 체크로 교체했다.

## 수정 파일

- `packages/site-backend/src/app.ts`
- `packages/shared/src/management.ts`

추가:
- `DESIGN-DOCS/WORKER-LIVENESS-POLICY.md` (신규)

## 핵심 변경 — `packages/site-backend/src/app.ts`

### `import` 라인 3

readdir 추가:

```ts
// before
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

// after
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
```

### `ManagerWorkerCliRunResult` (≈ 라인 11230)

`reason`, `idleDurationMs`, `error` 필드 및 `ManagerWorkerStopReason` 추가:

```ts
type ManagerWorkerStopReason = "idle" | "hard-cap" | "crash" | "cancel";

interface ManagerWorkerCliRunResult {
  ...
  sessionId?: string;
  reason?: ManagerWorkerStopReason;
  idleDurationMs?: number;
  error?: string;
}
```

### `runManagerWorkerCli` (≈ 라인 11250–11310)

stdio 활동 추적 + 새 helper로 대체:

```ts
// before — fixed-timeout kill
let timedOut = false;
const exitCode = await withTimeout(proc.exited, input.timeoutMs, () => {
  timedOut = true;
  proc.kill();
});

// after — idle-based liveness
let lastActivityAt = Date.now();
const bumpActivity = () => { lastActivityAt = Date.now(); };
const stdout = readLimitedText(proc.stdout, 2_000_000, bumpActivity);
const stderr = readLimitedText(proc.stderr, 500_000, bumpActivity);
const liveness = await awaitWorkerWithLiveness({
  exited: proc.exited,
  started,
  getLastActivityAt: () => lastActivityAt,
  cwd: input.cwd,
  legacyTimeoutMs: input.timeoutMs,
  onKill: () => { try { proc.kill(); } catch {} },
});
```

### 새 helper — `awaitWorkerWithLiveness` (≈ 라인 11340–11400)

```ts
const interval = setInterval(() => {
  void (async () => {
    if (killed) return;
    const now = Date.now();
    const sinceStart = now - input.started;
    const stdioIdleMs = now - input.getLastActivityAt();
    if (stdioIdleMs > idleMs) {
      const fsIdleMs = await fileMtimeIdleMsSafe(input.cwd, now);
      if (fsIdleMs > idleMs) {
        stopReason = "idle";
        idleDurationMs = Math.min(stdioIdleMs, fsIdleMs);
        const seconds = Math.floor(idleDurationMs / 1000);
        error = `Worker idle for ${seconds}s (no stdout/stderr/file activity)`;
        killed = true;
        clearInterval(interval);
        input.onKill();
        return;
      }
    }
    if (sinceStart > maxMs) {
      stopReason = "hard-cap";
      error = `Manager assistant CLI timed out after ${maxMs}ms.`;
      killed = true;
      clearInterval(interval);
      input.onKill();
    }
  })();
}, WORKER_LIVENESS_TICK_MS);
interval.unref?.();
```

### `readLimitedText` (≈ 라인 11383)

stdio 활동 콜백 추가:

```ts
async function readLimitedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onActivity?: () => void,
): Promise<{ text: string; truncated: boolean }> {
  ...
    if (!value) continue;
    onActivity?.();
  ...
}
```

### `withTimeout` 일반화 (≈ 라인 11955–11968)

`Manager assistant CLI timed out` 문자열을 워커 hard-cap 경로로 이전,
공유 helper는 일반 메시지로 강등:

```ts
// before
reject(new Error(`Manager assistant CLI timed out after ${timeoutMs}ms.`));

// after
reject(new Error(`Process timed out after ${timeoutMs}ms.`));
```

### `run-worker` 작업 요약 (≈ 라인 12378–12390)

타임아웃 단일 메시지 → reason 기반 메시지로 변경:

```ts
// before
const summary = result.timedOut
  ? `${profile.label} timed out after ${timeoutMs}ms.`
  ...

// after
const summary = result.timedOut
  ? (result.error ?? `${profile.label} stopped (reason=${result.reason ?? "unknown"}).`)
  ...
```

## 핵심 변경 — `packages/shared/src/management.ts`

`ManagerAgentMessageRequest.timeoutMs` (라인 1085–1098) 및
`ManagerRoundAgentAssignment.timeoutMs` (라인 1109–1120)에
`@deprecated` JSDoc 주석 추가. 본문은 형태를 그대로 유지 — 외부 호출자가
값을 전달해도 호환된다.

## 환경 변수

| 변수                        | 기본값      | 비고                                              |
| --------------------------- | ----------- | ------------------------------------------------- |
| `DESKRELAY_WORKER_IDLE_MS`  | `300_000`   | stdio + cwd mtime 두 신호가 모두 정체 시 종료     |
| `DESKRELAY_WORKER_MAX_MS`   | `3_600_000` | 시작 시점부터의 hard cap (안전망)                 |

값이 비어 있거나 숫자가 아니거나 0 이하면 기본값으로 폴백한다.

## TypeScript 검증

명령어: `bunx tsc --noEmit -p packages/site-backend/tsconfig.json`
결과: (아래 “TSC 실행 결과” 참조)

## 회귀 위험 자체점검

- **cancel 경로:** 본 helper는 `cancel` reason을 자동으로 채우지 않는다.
  외부 cancel(`cancelManagerTask`)은 기존과 동일하게 작업 state를
  cancelled로 마킹하며, 자식 프로세스 종료 신호는 별도 흐름을 통해 들어온다.
  liveness helper는 그 사이 정상적으로 `proc.exited`를 await만 하므로
  cancel과 충돌하지 않는다.
- **retry 경로:** `tasks/:id/retry`는 동일 입력으로 재호출되며 timeoutMs는
  계속 받아주되 무시된다. 재시도가 더 짧은 시간에 강제 종료될 가능성은
  사라졌고, idle/hard-cap만이 종료 결정자다.
- **출력 truncation:** `readLimitedText`는 한도 초과 후에도 `onActivity()`를
  계속 호출하므로 `lastActivityAt`이 stale해지지 않는다.
- **5초 probe (`checkManagerWorkerProfile`):** 5초 `withTimeout`은 유지.
  단 에러 문자열이 `Manager assistant CLI timed out ...` → `Process timed out
  after ...`로 변경된 점만 차이.
- **`runDefaultManagerAssistantCli` (manager assistant 본체):** 워커
  dispatch 경로가 아니므로 정책 적용 대상이 아니다. 기존 `withTimeout` 기반
  종료를 유지(기본 600s, 환경 변수 override 가능).
- **mtime depth=1 한계:** 깊은 하위 디렉터리만 활발히 갱신하는 워커는
  false-positive idle 가능성이 있으나, Claude CLI는 stream-json stdout을
  자주 내보내므로 실측 위험은 낮다. 필요 시 `DESKRELAY_WORKER_IDLE_MS`
  상향으로 완화.

## 서버 재시작 필요 여부

이 변경은 백엔드 코드 변경이며, 실행 중인 site-backend 프로세스는
**재기동되어야 반영된다**. 매니저가 사후 재시작 절차를 직접 호출하지
않도록 본 워커는 변경만 적용하고 종료한다.

## TSC 실행 결과

- 명령: `bunx tsc --noEmit -p packages/site-backend/tsconfig.json`
- exit code: **0**
- stdout/stderr: 비어 있음 (오류·경고 없음)
- 실행 환경: Bun + tsc, 로컬 cwd `C:\sourcetree\DeskRelay\deskrelay`
