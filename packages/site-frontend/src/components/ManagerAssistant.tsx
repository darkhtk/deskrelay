import type { ManagerAssistantChatMessage } from "@deskrelay/shared";
import { type Component, For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { api } from "../api.ts";
import { Composer } from "./Composer.tsx";

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
  let threadEl: HTMLDivElement | undefined;

  createEffect(() => {
    messages();
    queueMicrotask(() => {
      if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
    });
  });

  onCleanup(() => {
    threadEl = undefined;
  });

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
      <div class="manager-assistant-header">
        <div>
          <h3>AI Assistant</h3>
        </div>
      </div>

      <div ref={threadEl} class="manager-assistant-thread" aria-live="polite">
        <For each={messages()}>
          {(message) => (
            <article class={`manager-message manager-message-${message.role}`}>
              <span>{message.role === "user" ? "나" : "AI"}</span>
              <p>{message.text}</p>
            </article>
          )}
        </For>
        <Show when={busy()}>
          <article class="manager-message manager-message-assistant manager-message-pending">
            <span>AI</span>
            <p>응답 대기 중...</p>
          </article>
        </Show>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="manager-assistant-error" role="alert">
            {message()}
          </div>
        )}
      </Show>

      <div class="manager-assistant-composer">
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
