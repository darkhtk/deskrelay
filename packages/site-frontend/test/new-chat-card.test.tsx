// Basic interaction tests for the NewChatCard. The fs autocomplete and
// mkdir paths are exercised manually (they require api.fsList / fsMkdir
// mocks that simulate a real device); covered in the e2e smoke when
// daemon + site-backend + frontend are running locally.

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, test, vi } from "vitest";
import { NewChatCard } from "../src/components/NewChatCard.tsx";

describe("NewChatCard — basic input + confirm", () => {
  test("Start is disabled when cwd is empty", () => {
    const { container } = render(() => (
      <NewChatCard onConfirm={vi.fn()} permissionMode="default" />
    ));
    const startBtn = container.querySelector(".primary-button") as HTMLButtonElement;
    expect(startBtn).toBeDisabled();
  });

  test("typing enables Start; click invokes onConfirm with cwd + parent permission mode", () => {
    const onConfirm = vi.fn();
    const { container } = render(() => (
      <NewChatCard onConfirm={onConfirm} permissionMode="default" />
    ));
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "/work/repo" } });
    const startBtn = container.querySelector(".primary-button") as HTMLButtonElement;
    expect(startBtn).not.toBeDisabled();
    fireEvent.click(startBtn);
    expect(onConfirm).toHaveBeenCalledWith({
      cwd: "/work/repo",
      permissionMode: "default",
    });
  });

  test("Enter on the input submits when no autocomplete suggestion is highlighted", () => {
    const onConfirm = vi.fn();
    const { container } = render(() => (
      <NewChatCard onConfirm={onConfirm} permissionMode="default" />
    ));
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "/work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalled();
  });

  test("permissionMode prop flows into onConfirm payload", () => {
    const onConfirm = vi.fn();
    const { container } = render(() => <NewChatCard onConfirm={onConfirm} permissionMode="plan" />);
    fireEvent.input(container.querySelector("input") as HTMLInputElement, {
      target: { value: "/x" },
    });
    fireEvent.click(container.querySelector(".primary-button") as HTMLButtonElement);
    expect(onConfirm).toHaveBeenCalledWith({ cwd: "/x", permissionMode: "plan" });
  });

  test("updates the cwd field when initialCwd changes after mount", async () => {
    const Harness = () => {
      const [initialCwd, setInitialCwd] = createSignal("/old");
      return (
        <>
          <button type="button" onClick={() => setInitialCwd("/saved-default")}>
            Change initial cwd
          </button>
          <NewChatCard
            onConfirm={vi.fn()}
            permissionMode="default"
            initialCwd={initialCwd()}
          />
        </>
      );
    };

    const { container } = render(() => <Harness />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("/old");

    fireEvent.click(container.querySelector("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(input.value).toBe("/saved-default");
    });
  });

  test("Cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    const { container } = render(() => (
      <NewChatCard onConfirm={vi.fn()} onCancel={onCancel} permissionMode="default" />
    ));
    // Footer "Cancel" is the last secondary-button in the card.
    const cancelBtns = container.querySelectorAll(".secondary-button");
    fireEvent.click(cancelBtns[cancelBtns.length - 1] as HTMLButtonElement);
    expect(onCancel).toHaveBeenCalled();
  });

  test("Escape with no open suggestions calls onCancel", () => {
    const onCancel = vi.fn();
    const { container } = render(() => (
      <NewChatCard onConfirm={vi.fn()} onCancel={onCancel} permissionMode="default" />
    ));
    fireEvent.keyDown(container.querySelector("input") as HTMLInputElement, {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalled();
  });

  test("Enter while IME is composing does NOT submit", () => {
    const onConfirm = vi.fn();
    const { container } = render(() => (
      <NewChatCard onConfirm={onConfirm} permissionMode="default" />
    ));
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "C:\\Users\\테스트" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("NewChatCard — mkdir form", () => {
  test("clicking '+ 폴더' shows the form; cancel hides it", () => {
    const { container } = render(() => (
      <NewChatCard onConfirm={vi.fn()} permissionMode="default" />
    ));
    fireEvent.click(container.querySelector(".new-chat-mkdir-open") as HTMLButtonElement);
    expect(container.querySelector(".new-chat-mkdir-form")).toBeTruthy();
    // The mkdir form's "취소" button is its own secondary-button.
    const formCancel = container.querySelector(
      ".new-chat-mkdir-actions .secondary-button",
    ) as HTMLButtonElement;
    fireEvent.click(formCancel);
    expect(container.querySelector(".new-chat-mkdir-form")).toBeFalsy();
  });
});
