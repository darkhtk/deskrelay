import type {
  ManagerAssistantChatContext,
  ManagerAssistantChatMessage,
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
  if (typeof item.sessionId === "string" && item.sessionId.trim()) {
    state.sessionId = item.sessionId.trim().slice(0, 500);
  }
  if (typeof item.lastAssistantText === "string" && item.lastAssistantText.trim()) {
    state.lastAssistantText = item.lastAssistantText.trim().slice(0, MAX_ASSISTANT_STATE_TEXT);
  }
  return state;
}
function extractAssistantStateFromReply(
  text: string,
  previous: ManagerAssistantStructuredState,
  sessionId?: string,
): ManagerAssistantStructuredState {
  const compactText = text.trim().slice(0, MAX_ASSISTANT_STATE_TEXT);
  const state: ManagerAssistantStructuredState = {
    lastAssistantText: compactText,
  };
  const nextSessionId = sessionId?.trim() || previous.sessionId;
  if (nextSessionId) state.sessionId = nextSessionId;
  return state;
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
              extractAssistantStateFromReply(event.message.text, current, event.sessionId),
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
