import type {
  ManagerRegistrationDiagnosis,
  ManagerSystemSummary,
  ManagerTask,
  ManagerTaskKind,
  ManagerTaskLogResponse,
  ManagerTaskRequest,
} from "@deskrelay/shared";
import {
  type Component,
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { ApiError, api } from "../api.ts";

type AssistantActionId =
  | "diagnose"
  | "update-plan"
  | "update-all"
  | "restart-server"
  | "registration-diagnose"
  | "repair-registration";

type AssistantMessageTone = "neutral" | "good" | "warn" | "bad";

type AssistantMessage = {
  id: string;
  role: "assistant" | "user";
  tone: AssistantMessageTone;
  text: string;
  taskId?: string;
};

type AssistantAction = {
  id: AssistantActionId;
  label: string;
  description: string;
  risk: "safe" | "changes" | "restart";
  confirm: boolean;
};

const ACTIONS: AssistantAction[] = [
  {
    id: "diagnose",
    label: "진단",
    description: "서버, 등록, 업데이트 상태를 읽기 전용으로 확인합니다.",
    risk: "safe",
    confirm: false,
  },
  {
    id: "update-plan",
    label: "업데이트 계획",
    description: "실제 변경 없이 서버와 디바이스 업데이트 가능 여부를 점검합니다.",
    risk: "safe",
    confirm: false,
  },
  {
    id: "update-all",
    label: "전체 업데이트",
    description: "등록된 connector 업데이트를 요청하고 서버 업데이트를 실행합니다.",
    risk: "changes",
    confirm: true,
  },
  {
    id: "restart-server",
    label: "서버 재시작",
    description: "DeskRelay 서버 프로세스를 재시작합니다.",
    risk: "restart",
    confirm: true,
  },
  {
    id: "registration-diagnose",
    label: "등록 진단",
    description: "최근 등록 실패, Tailscale, Site token 상태를 확인합니다.",
    risk: "safe",
    confirm: false,
  },
  {
    id: "repair-registration",
    label: "등록 복구",
    description: "최근 등록 실패를 분석하고 가능한 복구 작업을 실행합니다.",
    risk: "changes",
    confirm: true,
  },
];

const INITIAL_MESSAGES: AssistantMessage[] = [
  {
    id: "assistant-initial",
    role: "assistant",
    tone: "neutral",
    text: "관리 Assistant입니다. 진단, 업데이트, 서버 재시작, 등록 복구를 실행하고 작업 상태를 추적합니다.",
  },
];

export const ManagerAssistant: Component = () => {
  const [messages, setMessages] = createSignal<AssistantMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [pendingAction, setPendingAction] = createSignal<AssistantAction | null>(null);
  const [selectedTaskId, setSelectedTaskId] = createSignal<string | null>(null);

  const [summary, { refetch: refetchSummary }] = createResource(async () =>
    api.managerSystemSummary(),
  );
  const [tasks, { refetch: refetchTasks }] = createResource(async () =>
    api.managerTasks(20).then((response) => response.tasks),
  );
  const [taskLogs, { refetch: refetchTaskLogs }] = createResource(selectedTaskId, async (id) =>
    id ? await api.managerTaskLogs(id) : null,
  );

  createEffect(() => {
    const timer = window.setInterval(() => {
      void refetchTasks();
      void refetchSummary();
      if (selectedTaskId()) void refetchTaskLogs();
    }, 4000);
    onCleanup(() => window.clearInterval(timer));
  });

  const appendAssistant = (
    text: string,
    tone: AssistantMessageTone = "neutral",
    taskId?: string,
  ) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}-${prev.length}`,
        role: "assistant",
        tone,
        text,
        ...(taskId ? { taskId } : {}),
      },
    ]);
  };

  const appendUser = (text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}-${prev.length}`, role: "user", tone: "neutral", text },
    ]);
  };

  const refresh = async () => {
    await Promise.all([refetchSummary(), refetchTasks()]);
    if (selectedTaskId()) await refetchTaskLogs();
  };

  const askConfirmation = (action: AssistantAction) => {
    setPendingAction(action);
    appendAssistant(
      `${action.label} 실행 전 확인이 필요합니다. 작업 내용을 확인한 뒤 실행하세요.`,
      "warn",
    );
  };

  const runAction = async (action: AssistantAction, confirmed = false) => {
    if (action.confirm && !confirmed) {
      askConfirmation(action);
      return;
    }
    setPendingAction(null);
    setBusy(true);
    appendUser(action.label);
    try {
      const result = await executeAction(action);
      if ("id" in result) {
        appendAssistant(taskSummary(result), taskTone(result), result.id);
        setSelectedTaskId(result.id);
      } else {
        appendAssistant(registrationSummary(result), severityTone(result.summary.severity));
      }
      await refresh();
    } catch (error) {
      appendActionError(action.label, error);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    const text = input().trim();
    if (!text || busy()) return;
    setInput("");
    const action = inferAction(text);
    appendUser(text);
    if (!action) {
      appendAssistant(
        "알 수 없는 요청입니다. 진단, 업데이트 계획, 전체 업데이트, 서버 재시작, 등록 진단, 등록 복구 중 하나를 선택하세요.",
        "warn",
      );
      return;
    }
    if (action.confirm) {
      askConfirmation(action);
      return;
    }
    setBusy(true);
    try {
      const result = await executeAction(action);
      if ("id" in result) {
        appendAssistant(taskSummary(result), taskTone(result), result.id);
        setSelectedTaskId(result.id);
      } else {
        appendAssistant(registrationSummary(result), severityTone(result.summary.severity));
      }
      await refresh();
    } catch (error) {
      appendActionError(action.label, error);
    } finally {
      setBusy(false);
    }
  };

  const retryTask = async (task: ManagerTask) => {
    setBusy(true);
    appendUser(`재시도: ${task.kind}`);
    try {
      const retried = await api.retryManagerTask(task.id);
      appendAssistant(taskSummary(retried), taskTone(retried), retried.id);
      setSelectedTaskId(retried.id);
      await refresh();
    } catch (error) {
      appendActionError("재시도", error);
    } finally {
      setBusy(false);
    }
  };

  const cancelTask = async (task: ManagerTask) => {
    setBusy(true);
    appendUser(`취소: ${task.kind}`);
    try {
      const cancelled = await api.cancelManagerTask(task.id);
      appendAssistant(taskSummary(cancelled), taskTone(cancelled), cancelled.id);
      setSelectedTaskId(cancelled.id);
      await refresh();
    } catch (error) {
      appendActionError("취소", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="manager-assistant">
      <div class="manager-assistant-header">
        <div>
          <h3>관리 Assistant</h3>
          <p>진단, 업데이트, 복구 작업을 실행하고 결과를 추적합니다.</p>
        </div>
        <button
          type="button"
          class="secondary-button"
          onClick={() => void refresh()}
          disabled={busy()}
        >
          새로고침
        </button>
      </div>

      <div class="manager-assistant-summary" aria-label="관리 요약">
        <SummaryItem
          label="상태"
          value={summary.loading ? "조회 중" : (summary()?.summary.message ?? "정보 없음")}
        />
        <SummaryItem label="버전" value={`v${summary()?.build.version ?? "0.0.0"}`} />
        <SummaryItem label="디바이스" value={`${summary()?.devices.length ?? 0}대`} />
        <SummaryItem label="최근 작업" value={latestTaskLabel(summary())} />
      </div>

      <div class="manager-assistant-actions" aria-label="관리 작업">
        <For each={ACTIONS}>
          {(action) => (
            <button
              type="button"
              class={`manager-action manager-action-${action.risk}`}
              onClick={() => void runAction(action)}
              disabled={busy()}
              title={action.description}
            >
              <span>{action.label}</span>
              <small>{action.confirm ? "확인 필요" : "읽기 전용"}</small>
            </button>
          )}
        </For>
      </div>

      <Show when={pendingAction()}>
        {(action) => (
          <div class="manager-assistant-confirm" role="alert">
            <div>
              <strong>{action().label}</strong>
              <span>{action().description}</span>
            </div>
            <button
              type="button"
              class="primary-button"
              onClick={() => void runAction(action(), true)}
              disabled={busy()}
            >
              실행
            </button>
            <button type="button" class="secondary-button" onClick={() => setPendingAction(null)}>
              취소
            </button>
          </div>
        )}
      </Show>

      <div class="manager-assistant-thread" aria-label="Assistant 대화">
        <For each={messages()}>
          {(message) => (
            <div
              class={`manager-message manager-message-${message.role} manager-message-${message.tone}`}
            >
              <span>{message.role === "user" ? "사용자" : "Assistant"}</span>
              <p>{message.text}</p>
              <Show when={message.taskId}>
                {(id) => (
                  <button type="button" class="text-button" onClick={() => setSelectedTaskId(id())}>
                    작업 로그 보기
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="manager-assistant-input">
        <input
          type="text"
          class="text-input"
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSubmit();
          }}
          placeholder="예: 진단, 업데이트 계획, 전체 업데이트, 서버 재시작"
          disabled={busy()}
        />
        <button
          type="button"
          class="primary-button"
          onClick={() => void handleSubmit()}
          disabled={busy()}
        >
          보내기
        </button>
      </div>

      <section class="manager-task-section" aria-label="최근 관리 작업">
        <div class="manager-section-head">
          <h4>최근 작업</h4>
          <span>{tasks.loading ? "조회 중" : `${tasks()?.length ?? 0}개`}</span>
        </div>
        <div class="manager-task-list">
          <For
            each={tasks() ?? []}
            fallback={<p class="manager-empty">아직 실행된 작업이 없습니다.</p>}
          >
            {(task) => (
              <div class={`manager-task-row manager-task-${task.state}`}>
                <button
                  type="button"
                  class="manager-task-main"
                  onClick={() => setSelectedTaskId(task.id)}
                  title={task.error ?? task.kind}
                >
                  <strong>{task.kind}</strong>
                  <span>
                    {taskStateLabel(task)} · {formatTime(task.updatedAt)}
                  </span>
                </button>
                <div class="manager-task-actions">
                  <Show when={canRetry(task)}>
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => void retryTask(task)}
                      disabled={busy()}
                    >
                      재시도
                    </button>
                  </Show>
                  <Show when={canCancel(task)}>
                    <button
                      type="button"
                      class="text-button"
                      onClick={() => void cancelTask(task)}
                      disabled={busy()}
                    >
                      취소
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="text-button"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    로그
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </section>

      <Show when={selectedTaskId()}>
        <section class="manager-task-log" aria-label="작업 로그">
          <div class="manager-section-head">
            <h4>작업 로그</h4>
            <span>{selectedTaskId()}</span>
          </div>
          <Show
            when={taskLogs()}
            fallback={
              <p class="manager-empty">
                {taskLogs.loading ? "로그 조회 중" : "로그를 불러오지 못했습니다."}
              </p>
            }
          >
            {(logs) => <TaskLogView logs={logs()} />}
          </Show>
        </section>
      </Show>
    </div>
  );

  function appendActionError(label: string, error: unknown) {
    const task = taskFromApiError(error);
    if (task) {
      appendAssistant(taskSummary(task), taskTone(task), task.id);
      setSelectedTaskId(task.id);
      return;
    }
    appendAssistant(`${label} 실패: ${errorMessage(error)}`, "bad");
  }
};

const SummaryItem: Component<{ label: string; value: string }> = (props) => (
  <div class="manager-summary-item">
    <span>{props.label}</span>
    <strong>{props.value}</strong>
  </div>
);

const TaskLogView: Component<{ logs: ManagerTaskLogResponse }> = (props) => (
  <div class="manager-log-body">
    <For each={props.logs.lines} fallback={<p class="manager-empty">표시할 로그가 없습니다.</p>}>
      {(line) => <code>{line}</code>}
    </For>
  </div>
);

async function executeAction(
  action: AssistantAction,
): Promise<ManagerTask | ManagerRegistrationDiagnosis> {
  switch (action.id) {
    case "diagnose":
      return await api.createManagerTask(managerTaskRequest("diagnose", true));
    case "update-plan":
      return await api.managerUpdateAll({ dryRun: true, requestedBy: "manager-assistant" });
    case "update-all":
      return await api.managerUpdateAll({ dryRun: false, requestedBy: "manager-assistant" });
    case "restart-server":
      return await api.createManagerTask(managerTaskRequest("restart-server", false));
    case "registration-diagnose":
      return await api.managerRegistrationDiagnosis();
    case "repair-registration":
      return await api.managerRegistrationRepair({
        dryRun: false,
        requestedBy: "manager-assistant",
      });
  }
}

function managerTaskRequest(kind: ManagerTaskKind, dryRun: boolean): ManagerTaskRequest {
  return { kind, dryRun, requestedBy: "manager-assistant" };
}

function inferAction(text: string): AssistantAction | null {
  const normalized = text.toLowerCase();
  if (normalized.includes("전체") || normalized.includes("all")) return actionById("update-all");
  if (normalized.includes("업데이트") || normalized.includes("update"))
    return actionById("update-plan");
  if (normalized.includes("재시작") || normalized.includes("restart"))
    return actionById("restart-server");
  if (normalized.includes("복구") || normalized.includes("repair"))
    return actionById("repair-registration");
  if (normalized.includes("등록") || normalized.includes("registration")) {
    return actionById("registration-diagnose");
  }
  if (normalized.includes("진단") || normalized.includes("diagnose")) return actionById("diagnose");
  return null;
}

function actionById(id: AssistantActionId): AssistantAction {
  const action = ACTIONS.find((candidate) => candidate.id === id);
  if (!action) throw new Error(`unknown assistant action: ${id}`);
  return action;
}

function taskSummary(task: ManagerTask): string {
  const target = task.targetLabel ? ` · ${task.targetLabel}` : "";
  if (task.error) return `${task.kind}${target}: ${taskStateLabel(task)} · ${task.error}`;
  return `${task.kind}${target}: ${taskStateLabel(task)} · ${task.steps.length}단계 기록`;
}

function registrationSummary(report: ManagerRegistrationDiagnosis): string {
  return `등록 진단: ${report.summary.message} · Site token ${
    report.siteTokenConfigured ? "있음" : "없음"
  } · Tailscale ${report.tailscaleDetected ? "감지됨" : "감지 안 됨"}`;
}

function taskTone(task: ManagerTask): AssistantMessageTone {
  if (task.state === "succeeded") return "good";
  if (task.state === "failed" || task.state === "cancelled") return "bad";
  if (
    task.state === "blocked" ||
    task.state === "waiting_for_device" ||
    task.state === "restart_required"
  ) {
    return "warn";
  }
  return "neutral";
}

function severityTone(severity: string): AssistantMessageTone {
  if (severity === "ok") return "good";
  if (severity === "error") return "bad";
  if (severity === "warn") return "warn";
  return "neutral";
}

function taskStateLabel(task: ManagerTask): string {
  const labels: Record<ManagerTask["state"], string> = {
    pending: "대기",
    running: "진행 중",
    blocked: "중단됨",
    waiting_for_device: "디바이스 대기",
    restart_required: "재시작 필요",
    succeeded: "완료",
    failed: "실패",
    cancelled: "취소됨",
  };
  return `${labels[task.state]}${task.dryRun ? " · 점검" : ""}`;
}

function canRetry(task: ManagerTask): boolean {
  return (
    task.state === "failed" ||
    task.state === "blocked" ||
    task.state === "waiting_for_device" ||
    task.state === "restart_required"
  );
}

function canCancel(task: ManagerTask): boolean {
  return (
    task.state === "pending" || task.state === "running" || task.state === "waiting_for_device"
  );
}

function latestTaskLabel(summary: ManagerSystemSummary | undefined): string {
  const latest = summary?.recentTasks?.[0];
  return latest ? `${latest.kind} · ${taskStateLabel(latest)}` : "기록 없음";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function taskFromApiError(error: unknown): ManagerTask | null {
  if (!(error instanceof ApiError)) return null;
  if (!error.body || typeof error.body !== "object") return null;
  const candidate = error.body as Partial<ManagerTask>;
  if (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.state === "string"
  ) {
    return candidate as ManagerTask;
  }
  return null;
}
