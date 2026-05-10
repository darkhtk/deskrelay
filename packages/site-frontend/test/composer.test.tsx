// Composer behavior tests — focus on what the user can do (type, submit,
// pick slash command, hit Stop). Real DOM via @solidjs/testing-library +
// jsdom. Uses fireEvent / keyboard simulation; no internal state assertions.

import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Composer } from "../src/components/Composer.tsx";
import { t } from "../src/i18n.ts";

function setup(props: Parameters<typeof Composer>[0] = { onSend: vi.fn() }) {
  const utils = render(() => <Composer {...props} />);
  const textarea = utils.container.querySelector("textarea") as HTMLTextAreaElement;
  const sendBtn = utils.container.querySelector(".composer-send") as HTMLButtonElement;
  const stopBtn = utils.container.querySelector(".composer-stop") as HTMLButtonElement;
  return { ...utils, textarea, sendBtn, stopBtn };
}

describe("Composer — basic typing + send", () => {
  test("send button is disabled when input is empty", () => {
    const { sendBtn } = setup();
    expect(sendBtn).toBeDisabled();
  });

  test("typing enables send", () => {
    const { textarea, sendBtn } = setup();
    fireEvent.input(textarea, { target: { value: "hello" } });
    expect(sendBtn).not.toBeDisabled();
  });

  test("textarea grows to fit multiline input", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.value.includes("\n") ? 96 : 48;
      },
    });

    try {
      const { textarea } = setup();
      fireEvent.input(textarea, { target: { value: "line one\nline two\nline three" } });
      await Promise.resolve();
      expect(textarea.style.height).toBe("96px");
      expect(textarea.style.overflowY).toBe("hidden");
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", descriptor);
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
      }
    }
  });

  test("Enter submits and clears the input", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { textarea } = setup({ onSend });
    fireEvent.input(textarea, { target: { value: "hi claude" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi claude");
    await Promise.resolve();
    expect(textarea.value).toBe("");
  });

  test("Shift+Enter does NOT submit", () => {
    const onSend = vi.fn();
    const { textarea } = setup({ onSend });
    fireEvent.input(textarea, { target: { value: "line1" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("Enter while IME is composing does NOT submit", () => {
    const onSend = vi.fn();
    const { textarea } = setup({ onSend });
    fireEvent.input(textarea, { target: { value: "테스트" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("send button click triggers submit", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { textarea, sendBtn } = setup({ onSend });
    fireEvent.input(textarea, { target: { value: "hi" } });
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  test("hasExtraContent keeps send enabled when text is empty", () => {
    const { sendBtn } = setup({ onSend: vi.fn(), hasExtraContent: () => true });
    expect(sendBtn).not.toBeDisabled();
  });
});

describe("Composer — slash picker", () => {
  test("typing '/' shows the picker", () => {
    const { textarea, container } = setup();
    fireEvent.input(textarea, { target: { value: "/" } });
    expect(container.querySelector(".slash-picker")).toBeTruthy();
    // /help is in the platform list
    expect(container.textContent).toContain("/help");
  });

  test("filters by prefix", () => {
    const { textarea, container } = setup();
    fireEvent.input(textarea, { target: { value: "/he" } });
    const items = container.querySelectorAll(".slash-suggest-item");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.textContent?.toLowerCase()).toContain("/he");
    }
  });

  test("typing a space hides the picker (entering args)", () => {
    const { textarea, container } = setup();
    fireEvent.input(textarea, { target: { value: "/init" } });
    expect(container.querySelector(".slash-picker")).toBeTruthy();
    fireEvent.input(textarea, { target: { value: "/init " } });
    expect(container.querySelector(".slash-picker")).toBeFalsy();
  });

  test("Tab completes the highlighted command", () => {
    const { textarea, container } = setup();
    fireEvent.input(textarea, { target: { value: "/he" } });
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea.value).toBe("/help ");
    expect(container.querySelector(".slash-picker")).toBeFalsy();
  });

  test("Enter inside picker completes (not submit)", () => {
    const onSend = vi.fn();
    const { textarea } = setup({ onSend });
    fireEvent.input(textarea, { target: { value: "/he" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("/help ");
    expect(onSend).not.toHaveBeenCalled();
  });

  test("Escape closes the picker without completing", () => {
    const { textarea, container } = setup();
    fireEvent.input(textarea, { target: { value: "/he" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(container.querySelector(".slash-picker")).toBeFalsy();
    expect(textarea.value).toBe("/he");
  });

  test("planned slash commands render a 'planned' label", () => {
    const { textarea, container } = setup();
    fireEvent.input(textarea, { target: { value: "/loo" } });
    const item = container.querySelector(".slash-suggest-item");
    expect(item?.textContent).toContain(t("composer.slash.paid"));
  });

  test("custom runtime slash commands can include user skills", () => {
    const { textarea, container } = setup({
      onSend: vi.fn(),
      slashCommands: [{ name: "/deep-fix", hint: "Claude Code skill" }],
    });
    fireEvent.input(textarea, { target: { value: "/deep" } });
    expect(container.textContent).toContain("/deep-fix");
  });
});

describe("Composer — context text", () => {
  test("does not reserve a context text slot when the host hides usage", () => {
    const { container } = setup({ onSend: vi.fn() });
    expect(container.querySelector(".composer-context-status")).toBeNull();
  });

  test("renders context compression remaining text", () => {
    const { container } = setup({ onSend: vi.fn(), contextRemainingPercent: 38 });
    const status = container.querySelector(".composer-context-status") as HTMLElement;

    expect(status).toBeTruthy();
    expect(status.textContent).toBe("컨텍스트 압축까지 38% 남았습니다");
    expect(status).toHaveClass("composer-context-status-danger");
  });

  test("shows a pending context text when usage is unknown", () => {
    const { container } = setup({ onSend: vi.fn(), contextRemainingPercent: null });
    const status = container.querySelector(".composer-context-status") as HTMLElement;

    expect(status).toHaveClass("composer-context-status-unknown");
    expect(status.textContent).toBe("컨텍스트 압축 정보 확인 중");
  });
});

describe("Composer — Stop / inFlight mode", () => {
  test("inFlight=true reveals the stop button (separate from send)", () => {
    const { sendBtn, stopBtn } = setup({ onSend: vi.fn(), inFlight: true });
    expect(stopBtn).toBeTruthy();
    expect(stopBtn.hidden).toBe(false);
    expect(sendBtn.getAttribute("aria-label")).toBe(t("composer.send.aria"));
    // While in flight the send button is greyed; the stop button is the
    // active affordance.
    expect(sendBtn).toBeDisabled();
  });

  test("inFlight=false hides the stop button", () => {
    const { stopBtn } = setup({ onSend: vi.fn(), inFlight: false });
    expect(stopBtn.hidden).toBe(true);
  });

  test("clicking Stop calls onInterrupt", () => {
    const onSend = vi.fn();
    const onInterrupt = vi.fn();
    const { stopBtn } = setup({ onSend, onInterrupt, inFlight: true });
    fireEvent.click(stopBtn);
    expect(onInterrupt).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  test("Escape calls onInterrupt while in flight", () => {
    const onSend = vi.fn();
    const onInterrupt = vi.fn();
    const { textarea } = setup({ onSend, onInterrupt, inFlight: true });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onInterrupt).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  test("Escape closes the slash picker before interrupting", () => {
    const onInterrupt = vi.fn();
    const { textarea, container } = setup({ onSend: vi.fn(), onInterrupt, inFlight: true });
    fireEvent.input(textarea, { target: { value: "/he" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(container.querySelector(".slash-picker")).toBeFalsy();
    expect(onInterrupt).not.toHaveBeenCalled();
  });
});

describe("Composer — attach button", () => {
  test('clicking "+" calls onAttachClick (host opens file picker)', () => {
    const onAttachClick = vi.fn();
    const { container } = setup({ onSend: vi.fn(), onAttachClick });
    const attach = container.querySelector(".composer-attach") as HTMLButtonElement;
    fireEvent.click(attach);
    expect(onAttachClick).toHaveBeenCalled();
  });

  test("attach button is hidden when onAttachClick is not provided", () => {
    // Hosts that don't wire image transport can omit onAttachClick so
    // the UI doesn't suggest a capability they don't support.
    const { container } = setup({ onSend: vi.fn() });
    expect(container.querySelector(".composer-attach")).toBeNull();
  });
});

describe("Composer — error recovery", () => {
  test("rejected onSend restores the draft", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("boom"));
    const { textarea } = setup({ onSend });
    fireEvent.input(textarea, { target: { value: "draft" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    // Wait for the rejected promise to resolve through the error path.
    await new Promise((r) => setTimeout(r, 0));
    expect(textarea.value).toBe("draft");
  });
});
