import type {
  ManagerAssistantChatContext,
  ManagerAssistantChatMessage,
  ManagerAssistantStreamStatus,
} from "@deskrelay/shared";
import { type Component, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { type ClaudeStreamEvent, api } from "../api.ts";
import { Composer } from "./Composer.tsx";
import { Transcript } from "./Transcript.tsx";

const INITIAL_MESSAGE: ManagerAssistantChatMessage = {
  id: "assistant-initial",
  role: "assistant",
  text: "DeskRelay 상태 점검, 업데이트, 복구를 도와드릴게요.",
  createdAt: new Date().toISOString(),
};

interface ManagerAssistantProps {
  context?: ManagerAssistantChatContext | null;
}

export const ManagerAssistant: Component<ManagerAssistantProps> = (props) => {
  const [messages, setMessages] = createSignal<ManagerAssistantChatMessage[]>([INITIAL_MESSAGE]);
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
    messages();
    busy();
    queueMicrotask(() => {
      if (transcriptScroller && transcriptAtBottom()) {
        transcriptScroller.scrollTop = transcriptScroller.scrollHeight;
      }
    });
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
    const history = [...messages(), userMessage];
    setMessages(history);
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
    try {
      await api.managerAssistantChatStream(
        {
          message: text,
          history,
          ...(props.context ? { context: props.context } : {}),
        },
        (event) => {
          if (event.type === "status") {
            setStatus(event.status);
            return;
          }
          if (event.type === "message") {
            setMessages((current) => [...current, event.message]);
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
      if (!streamError) setStatus(null);
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
