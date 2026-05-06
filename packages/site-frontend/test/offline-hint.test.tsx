// OfflineHint renders an inline copy-command + retry block when the
// surrounding error message looks like the daemon-offline error from
// the backend. Verifies the detector matches each locale and that the
// component stays out of the DOM for unrelated errors.

import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OfflineHint, isDaemonOfflineMessage } from "../src/components/OfflineHint.tsx";

describe("isDaemonOfflineMessage", () => {
  test("matches en/ko/ja/ru offline messages", () => {
    expect(isDaemonOfflineMessage("device offline — start the connector daemon on this PC")).toBe(
      true,
    );
    expect(
      isDaemonOfflineMessage("디바이스 오프라인 — 이 PC 에서 connector daemon 을 실행하세요"),
    ).toBe(true);
    expect(
      isDaemonOfflineMessage("デバイスがオフライン — この PC で connector daemon を起動"),
    ).toBe(true);
    expect(
      isDaemonOfflineMessage("Устройство офлайн — запустите connector daemon на этом ПК"),
    ).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(isDaemonOfflineMessage("rate limit exceeded — slow down")).toBe(false);
    expect(isDaemonOfflineMessage("invalid JSON body")).toBe(false);
    expect(isDaemonOfflineMessage("")).toBe(false);
    expect(isDaemonOfflineMessage(null)).toBe(false);
    expect(isDaemonOfflineMessage(undefined)).toBe(false);
  });
});

describe("<OfflineHint />", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders nothing when message is unrelated", () => {
    const { container } = render(() => <OfflineHint message="rate limit exceeded — slow down" />);
    expect(container.querySelector(".offline-hint")).toBeNull();
  });

  test("renders the copy + retry actions when message matches the offline pattern", () => {
    const onRetry = vi.fn();
    const { container } = render(() => (
      <OfflineHint
        message="디바이스 오프라인 — 이 PC 에서 connector daemon 을 실행하세요"
        onRetry={onRetry}
      />
    ));
    expect(container.querySelector(".offline-hint")).not.toBeNull();
    const copyButtons = container.querySelectorAll(".offline-hint-copy");
    // primary + source = 2 copy buttons
    expect(copyButtons.length).toBe(2);
    expect(container.querySelector(".offline-hint-retry")).not.toBeNull();
  });

  test("device label clarifies that another PC must run the daemon", () => {
    const onPickDevice = vi.fn();
    const { container } = render(() => (
      <OfflineHint
        message="device offline — connector daemon"
        deviceLabel="Office PC"
        onPickDevice={onPickDevice}
      />
    ));
    expect(container.textContent).toContain("Selected device: Office PC");
    expect(container.textContent).toContain("that PC");
    const pickButton = [...container.querySelectorAll("button")].find((button) =>
      /pick device/i.test(button.textContent ?? ""),
    );
    expect(pickButton).toBeTruthy();
    if (!pickButton) throw new Error("pick device button missing");
    fireEvent.click(pickButton);
    expect(onPickDevice).toHaveBeenCalledTimes(1);
  });

  test("clicking the primary copy button writes `cr-connector` to the clipboard", async () => {
    const { container } = render(() => (
      <OfflineHint message="device offline — start the connector daemon on this PC" />
    ));
    const btn = container.querySelector(".offline-hint-copy") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    if (!btn) throw new Error("copy button missing");
    fireEvent.click(btn);
    // Wait one microtask for the async clipboard call.
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith("cr-connector");
  });

  test("on Windows, primary copy writes the packaged connector restart command", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const { container } = render(() => (
      <OfflineHint message="device offline — start the connector daemon on this PC" />
    ));
    const buttons = container.querySelectorAll(".offline-hint-copy");
    expect(buttons.length).toBe(1);
    const btn = buttons[0] as HTMLButtonElement | undefined;
    expect(btn).toBeTruthy();
    if (!btn) throw new Error("copy button missing");
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 0));
    const copied = writeText.mock.calls[0]?.[0] as string;
    // Packaged connector flow: install dir is on PATH so `cr-connector` alone
    // restarts the daemon. No PowerShell preamble.
    expect(copied).toBe("cr-connector");
  });

  test("clicking the source copy button writes the source-mode `bun run` command", async () => {
    const { container } = render(() => (
      <OfflineHint message="device offline — start the connector daemon on this PC" />
    ));
    const buttons = container.querySelectorAll(".offline-hint-copy");
    const sourceBtn = buttons[1] as HTMLButtonElement | undefined;
    expect(sourceBtn).toBeTruthy();
    if (!sourceBtn) throw new Error("source button missing");
    fireEvent.click(sourceBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith("bun run packages/pc-connector-daemon/src/bin.ts");
  });

  test("clicking Retry fires onRetry once", () => {
    const onRetry = vi.fn();
    const { container } = render(() => (
      <OfflineHint message="device offline — connector daemon" onRetry={onRetry} />
    ));
    const retry = container.querySelector(".offline-hint-retry") as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    if (!retry) throw new Error("retry button missing");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("Retry button is hidden when onRetry is omitted", () => {
    const { container } = render(() => <OfflineHint message="device offline — connector daemon" />);
    expect(container.querySelector(".offline-hint-retry")).toBeNull();
  });

  test("source-mode button is hidden when showSourceCommand=false (production gate)", () => {
    const { container } = render(() => (
      <OfflineHint
        message="device offline — start the connector daemon on this PC"
        showSourceCommand={false}
      />
    ));
    const copyButtons = container.querySelectorAll(".offline-hint-copy");
    expect(copyButtons.length).toBe(1);
    expect(container.querySelector(".offline-hint-copy-secondary")).toBeNull();
  });
});
