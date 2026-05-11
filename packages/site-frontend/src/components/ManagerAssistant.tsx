import type { ManagerAssistantChatMessage } from "@deskrelay/shared";
import { type Component, For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { api } from "../api.ts";

const INITIAL_MESSAGE: ManagerAssistantChatMessage = {
  id: "assistant-initial",
  role: "assistant",
  text: "DeskRelay 관리용 대화창입니다. 서버 PC의 DeskRelay 기본 폴더에서 Claude CLI로 응답합니다.",
  createdAt: new Date().toISOString(),
};

export const ManagerAssistant: Component = () => {
  const [messages, setMessages] = createSignal<ManagerAssistantChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let threadEl: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;

  createEffect(() => {
    messages();
    queueMicrotask(() => {
      if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
    });
  });

  onCleanup(() => {
    threadEl = undefined;
    inputEl = undefined;
  });

  const appendMessage = (message: ManagerAssistantChatMessage) => {
    setMessages((current) => [...current, message]);
  };

  const send = async () => {
    const text = input().trim();
    if (!text || busy()) return;
    const userMessage: ManagerAssistantChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
    setInput("");
    setError(null);
    appendMessage(userMessage);
    setBusy(true);
    try {
      const response = await api.managerAssistantChat({
        message: text,
        history: messages(),
      });
      appendMessage(response.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      inputEl?.focus();
    }
  };

  return (
    <div class="manager-assistant manager-assistant-chat">
      <div class="manager-assistant-header">
        <div>
          <h3>AI Assistant</h3>
          <p>서버 PC의 DeskRelay 폴더에서 실행되는 CLI 대화</p>
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
            <p>응답을 기다리는 중...</p>
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

      <div class="manager-assistant-input">
        <textarea
          ref={inputEl}
          class="text-input"
          rows={3}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="DeskRelay 관리에 대해 물어보세요..."
          disabled={busy()}
        />
        <button
          type="button"
          class="primary-button"
          onClick={() => void send()}
          disabled={busy() || !input().trim()}
        >
          전송
        </button>
      </div>
    </div>
  );
};
