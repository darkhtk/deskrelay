import type { ManagerAssistantChatMessage } from "@deskrelay/shared";
import { type Component, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { type ClaudeStreamEvent, api } from "../api.ts";
import { Composer } from "./Composer.tsx";
import { Transcript } from "./Transcript.tsx";

const INITIAL_MESSAGE: ManagerAssistantChatMessage = {
  id: "assistant-initial",
  role: "assistant",
  text: "DeskRelay 관리용 대화창입니다. 서버 PC의 DeskRelay 기본 폴더에서 Claude CLI로 응답합니다.",
  createdAt: new Date().toISOString(),
};

export const ManagerAssistant: Component = () => {
  const [messages, setMessages] = createSignal<ManagerAssistantChatMessage[]>([INITIAL_MESSAGE]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
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
    setBusy(true);
    try {
      const response = await api.managerAssistantChat({
        message: text,
        history,
      });
      setMessages((current) => [...current, response.message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
        <Show when={busy()}>
          <output class="composer-status composer-status-thinking" aria-live="polite">
            <span class="composer-status-main">AI Assistant</span>
            <span class="composer-status-detail">응답 대기</span>
          </output>
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
