import type {
  ManagerAssistantChatContext,
  ManagerAssistantChatMessage,
  ManagerAssistantDecisionOption,
  ManagerAssistantStreamStatus,
  ManagerAssistantStructuredState,
} from "@deskrelay/shared";
import { type Component, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { type ClaudeStreamEvent, api } from "../api.ts";
import { Composer } from "./Composer.tsx";
import { Transcript } from "./Transcript.tsx";

const STORAGE_KEY = "cr.manager-assistant.messages:v2";
const STATE_STORAGE_KEY = "cr.manager-assistant.state:v1";
const MAX_STORED_MESSAGES = 40;
const MAX_ASSISTANT_STATE_TEXT = 8_000;
const MAX_FACTS = 8;

const INITIAL_MESSAGE: ManagerAssistantChatMessage = {
  id: "assistant-initial",
  role: "assistant",
  text: "DeskRelay 상태 점검, 업데이트, 복구를 도와드릴게요.",
  createdAt: new Date().toISOString(),
};

function loadStoredMessages(): ManagerAssistantChatMessage[] {
  if (typeof window === "undefined") return [INITIAL_MESSAGE];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [INITIAL_MESSAGE];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [INITIAL_MESSAGE];
    const messages = parsed.filter(isManagerAssistantMessage).slice(-MAX_STORED_MESSAGES);
    return messages.length ? messages : [INITIAL_MESSAGE];
  } catch {
    return [INITIAL_MESSAGE];
  }
}

function storeMessages(messages: ManagerAssistantChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function loadStoredAssistantState(): ManagerAssistantStructuredState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return normalizeAssistantState(parsed);
  } catch {
    return {};
  }
}

function storeAssistantState(state: ManagerAssistantStructuredState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(normalizeAssistantState(state)));
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function normalizeAssistantState(input: unknown): ManagerAssistantStructuredState {
  if (!input || typeof input !== "object") return {};
  const item = input as Record<string, unknown>;
  const state: ManagerAssistantStructuredState = {};
  if (typeof item.lastAssistantText === "string" && item.lastAssistantText.trim()) {
    state.lastAssistantText = item.lastAssistantText.trim().slice(0, MAX_ASSISTANT_STATE_TEXT);
  }
  if (item.pendingDecision && typeof item.pendingDecision === "object") {
    const decision = item.pendingDecision as Record<string, unknown>;
    const options = Array.isArray(decision.options)
      ? decision.options.filter(isDecisionOption).slice(0, 12)
      : [];
    if (options.length) {
      state.pendingDecision = {
        id:
          typeof decision.id === "string" && decision.id.trim()
            ? decision.id.trim().slice(0, 120)
            : "pending-decision",
        ...(typeof decision.prompt === "string" && decision.prompt.trim()
          ? { prompt: decision.prompt.trim().slice(0, 1_000) }
          : {}),
        options,
        ...(typeof decision.createdAt === "string" && decision.createdAt.trim()
          ? { createdAt: decision.createdAt.trim() }
          : {}),
      };
    }
  }
  if (item.task && typeof item.task === "object") {
    const task = item.task as Record<string, unknown>;
    const taskState =
      typeof task.state === "string" && isTaskState(task.state) ? task.state : "idle";
    state.task = {
      state: taskState,
      ...(typeof task.title === "string" && task.title.trim()
        ? { title: task.title.trim().slice(0, 240) }
        : {}),
      ...(typeof task.updatedAt === "string" && task.updatedAt.trim()
        ? { updatedAt: task.updatedAt.trim() }
        : {}),
    };
  }
  const facts = normalizeStringList(item.facts);
  const decisions = normalizeStringList(item.decisions);
  const openQuestions = normalizeStringList(item.openQuestions);
  if (facts.length) state.facts = facts;
  if (decisions.length) state.decisions = decisions;
  if (openQuestions.length) state.openQuestions = openQuestions;
  return state;
}

function isDecisionOption(input: unknown): input is ManagerAssistantDecisionOption {
  if (!input || typeof input !== "object") return false;
  const item = input as Record<string, unknown>;
  return typeof item.key === "string" && item.key.trim() !== "" && typeof item.label === "string";
}

function isTaskState(value: string): value is NonNullable<ManagerAssistantStructuredState["task"]>["state"] {
  return [
    "idle",
    "planning",
    "waiting_user_choice",
    "executing",
    "verifying",
    "blocked",
    "done",
  ].includes(value);
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim().replace(/\s+/g, " ").slice(0, 500))
    .slice(0, MAX_FACTS);
}

function extractAssistantStateFromReply(
  text: string,
  previous: ManagerAssistantStructuredState,
): ManagerAssistantStructuredState {
  const compactText = text.trim().slice(0, MAX_ASSISTANT_STATE_TEXT);
  const pendingDecision = extractPendingDecision(text);
  const facts = mergeUnique(previous.facts ?? [], extractFactCandidates(text));
  const decisions = mergeUnique(previous.decisions ?? [], extractDecisionCandidates(text));
  const state: ManagerAssistantStructuredState = {
    lastAssistantText: compactText,
    task: inferTaskMemory(text, pendingDecision),
  };
  if (pendingDecision) state.pendingDecision = pendingDecision;
  if (facts.length) state.facts = facts;
  if (decisions.length) state.decisions = decisions;
  if (pendingDecision?.prompt) state.openQuestions = [pendingDecision.prompt];
  return state;
}

function extractPendingDecision(text: string): ManagerAssistantStructuredState["pendingDecision"] {
  const lines = text.split(/\r?\n/);
  const options: ManagerAssistantDecisionOption[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:[-*]\s*)?([0-9]{1,2}|[A-Z])[\.)]\s+(.{2,})$/);
    if (!match) continue;
    const key = match[1] ?? "";
    const label = (match[2] ?? "")
      .replace(/\s+/g, " ")
      .replace(/\*\*/g, "")
      .trim();
    if (!key || !label) continue;
    options.push({
      key,
      label: label.slice(0, 400),
    });
  }
  if (options.length < 2) return undefined;
  const prompt = [...lines]
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.endsWith("?") || line.includes("선택") || line.includes("어느"));
  return {
    id: `decision-${Date.now()}`,
    ...(prompt ? { prompt: prompt.slice(0, 1_000) } : {}),
    options: options.slice(0, 12),
    createdAt: new Date().toISOString(),
  };
}

function extractFactCandidates(text: string): string[] {
  return extractBulletCandidates(text, ["확인", "관측", "실측", "사실", "제약", "상태"]);
}

function extractDecisionCandidates(text: string): string[] {
  return extractBulletCandidates(text, ["결론", "결정", "확정", "진행"]);
}

function extractBulletCandidates(text: string, headingHints: string[]): string[] {
  const lines = text.split(/\r?\n/);
  const results: string[] = [];
  let capture = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      capture = headingHints.some((hint) => trimmed.includes(hint));
      continue;
    }
    if (!capture) continue;
    if (!trimmed) continue;
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet?.[1]) results.push(bullet[1].replace(/\s+/g, " ").slice(0, 500));
    if (results.length >= 4) break;
  }
  return results;
}

function mergeUnique(existing: string[], next: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...existing, ...next]) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(-MAX_FACTS);
}

function inferTaskMemory(
  text: string,
  pendingDecision: ManagerAssistantStructuredState["pendingDecision"],
): NonNullable<ManagerAssistantStructuredState["task"]> {
  const lower = text.toLowerCase();
  let state: NonNullable<ManagerAssistantStructuredState["task"]>["state"] = "idle";
  if (pendingDecision) state = "waiting_user_choice";
  else if (text.includes("막힘") || text.includes("불가능") || lower.includes("blocked")) state = "blocked";
  else if (text.includes("검증") || text.includes("확인 중")) state = "verifying";
  else if (text.includes("진행") || text.includes("실행")) state = "executing";
  else if (text.includes("완료") || text.includes("성공")) state = "done";
  else if (text.includes("계획") || text.includes("설계")) state = "planning";
  return { state, updatedAt: new Date().toISOString() };
}

function isManagerAssistantMessage(input: unknown): input is ManagerAssistantChatMessage {
  if (!input || typeof input !== "object") return false;
  const item = input as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant" || item.role === "system") &&
    typeof item.text === "string" &&
    typeof item.createdAt === "string"
  );
}

interface ManagerAssistantProps {
  context?: ManagerAssistantChatContext | null;
}

export const ManagerAssistant: Component<ManagerAssistantProps> = (props) => {
  const [messages, setMessages] = createSignal<ManagerAssistantChatMessage[]>(loadStoredMessages());
  const [assistantState, setAssistantState] = createSignal<ManagerAssistantStructuredState>(
    loadStoredAssistantState(),
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<ManagerAssistantStreamStatus | null>(null);
  const [transcriptAtBottom, setTranscriptAtBottom] = createSignal(true);
  let transcriptScroller: HTMLDivElement | undefined;

  const transcriptEvents = createMemo<ClaudeStreamEvent[]>(() =>
    messages().map((message) => ({
      type: message.role,
      message: {
        role: message.role,
        content: [{ type: "text", text: message.text }],
      },
    })),
  );

  createEffect(() => {
    const currentMessages = messages();
    storeMessages(currentMessages);
    busy();
    queueMicrotask(() => {
      if (transcriptScroller && transcriptAtBottom()) {
        transcriptScroller.scrollTop = transcriptScroller.scrollHeight;
      }
    });
  });

  createEffect(() => {
    storeAssistantState(assistantState());
  });

  onCleanup(() => {
    transcriptScroller = undefined;
  });

  const updateTranscriptBottomState = () => {
    const el = transcriptScroller;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setTranscriptAtBottom(distance < 8);
  };

  const scrollToBottom = () => {
    if (!transcriptScroller) return;
    transcriptScroller.scrollTo({ top: transcriptScroller.scrollHeight, behavior: "smooth" });
    setTranscriptAtBottom(true);
  };

  const send = async (value: string) => {
    const text = value.trim();
    if (!text || busy()) return;
    const userMessage: ManagerAssistantChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
    const history = messages();
    setMessages([...history, userMessage]);
    setTranscriptAtBottom(true);
    setError(null);
    setStatus({
      phase: "preparing",
      tone: "thinking",
      main: "요청 준비 중",
      detail: "선택 컨텍스트 전달",
    });
    setBusy(true);
    let streamError: string | null = null;
    let receivedFinalMessage = false;
    try {
      await api.managerAssistantChatStream(
        {
          message: text,
          history,
          assistantState: assistantState(),
          ...(props.context ? { context: props.context } : {}),
        },
        (event) => {
          if (event.type === "status") {
            setStatus(event.status);
            return;
          }
          if (event.type === "message") {
            receivedFinalMessage = true;
            setMessages((current) => [...current, event.message]);
            setAssistantState((current) =>
              extractAssistantStateFromReply(event.message.text, current),
            );
            return;
          }
          if (event.type === "error") {
            streamError = event.error;
            setError(event.error);
            setStatus({
              phase: "error",
              tone: "warning",
              main: "Assistant 오류",
              detail: event.error,
            });
          }
        },
      );
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
      setError(streamError);
      setStatus({
        phase: "error",
        tone: "warning",
        main: "Assistant 오류",
        detail: streamError,
      });
    } finally {
      setBusy(false);
      if (!streamError && !receivedFinalMessage) {
        const incomplete =
          "Assistant 응답이 완료되지 않았습니다. 마지막 요청을 다시 시도해 주세요.";
        setError(incomplete);
        setStatus({
          phase: "error",
          tone: "warning",
          main: "Assistant 응답 미완료",
          detail: "최종 응답 없음",
        });
      } else if (!streamError) {
        setStatus(null);
      }
    }
  };

  return (
    <div class="manager-assistant manager-assistant-chat">
      <div
        ref={transcriptScroller}
        class="transcript manager-assistant-transcript"
        onScroll={updateTranscriptBottomState}
      >
        <div class="transcript-inner">
          <Transcript events={transcriptEvents()} />
        </div>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="upstream-banner manager-assistant-error" role="alert">
            <span class="upstream-banner-message">{message()}</span>
          </div>
        )}
      </Show>

      <div class="composer-shell manager-assistant-composer">
        <Show when={!transcriptAtBottom() && messages().length > 0}>
          <button
            type="button"
            class="scroll-to-bottom-button"
            aria-label="아래로 이동"
            title="아래로 이동"
            onClick={scrollToBottom}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 5v14" />
              <path d="m6 13 6 6 6-6" />
            </svg>
          </button>
        </Show>
        <Show when={status()}>
          {(guidance) => (
            <output class={`composer-status composer-status-${guidance().tone}`} aria-live="polite">
              <span class="composer-status-main">{guidance().main}</span>
              <Show when={guidance().detail}>
                {(detail) => <span class="composer-status-detail">{detail()}</span>}
              </Show>
            </output>
          )}
        </Show>
        <Composer
          onSend={send}
          disabled={busy()}
          idPrefix="manager-assistant-composer"
          placeholder="DeskRelay 관리에 대해 물어보세요..."
        />
      </div>
    </div>
  );
};
