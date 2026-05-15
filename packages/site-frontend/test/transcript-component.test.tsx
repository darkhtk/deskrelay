import { render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type ClaudeStreamEvent, api } from "../src/api.ts";
import { Transcript } from "../src/components/Transcript.tsx";
import { t } from "../src/i18n.ts";

function ev(...e: ClaudeStreamEvent[]): ClaudeStreamEvent[] {
  return e;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Transcript (Solid)", () => {
  test("empty events shows the placeholder", () => {
    const { container } = render(() => <Transcript events={ev()} />);
    expect(container.textContent).toContain(t("tx.empty"));
  });

  test("renders an assistant text bubble", () => {
    render(() => (
      <Transcript
        events={ev({
          type: "assistant",
          message: { content: [{ type: "text", text: "hello world" }] },
        } as ClaudeStreamEvent)}
      />
    ));
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  test("keeps transient tool activity out of the visible transcript", () => {
    const { container } = render(() => (
      <Transcript
        events={ev({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_1",
                name: "Bash",
                input: { command: "ls -la" },
              },
            ],
          },
        } as ClaudeStreamEvent)}
      />
    ));
    expect(container.querySelector(".tool-bash")).toBeNull();
    expect(container.textContent).not.toContain("ls -la");
    expect(container.textContent).toContain(t("tx.empty"));
  });

  test("session strip appears once on system init", () => {
    const { container } = render(() => (
      <Transcript
        events={ev({
          type: "system",
          subtype: "init",
          session_id: "sess_abcdef12",
          model: "claude-opus-4-7",
        } as ClaudeStreamEvent)}
      />
    ));
    expect(container.querySelector(".session-strip")).toBeTruthy();
    expect(container.textContent).toContain("sess_abc");
  });

  test("error result surfaces the body text", () => {
    const { container } = render(() => (
      <Transcript
        events={ev({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          result: "rate limited",
        } as ClaudeStreamEvent)}
      />
    ));
    expect(container.querySelector(".result-error")).toBeTruthy();
    expect(container.textContent).toContain("rate limited");
  });

  test("hydrates local image placeholders through the daemon preview API", async () => {
    const createObjectUrl = vi.fn(() => "blob:preview");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectUrl,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectUrl,
      configurable: true,
    });
    const filePreview = vi
      .spyOn(api, "filePreview")
      .mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));

    const { container } = render(() => (
      <Transcript
        deviceId="dev_1"
        cwd={"C:\\repo"}
        events={ev({
          type: "assistant",
          message: { content: [{ type: "text", text: "![shot](shot.png)" }] },
        } as ClaudeStreamEvent)}
      />
    ));

    await waitFor(() => {
      const img = container.querySelector<HTMLImageElement>("img.local-image-preview-img");
      expect(img?.src).toBe("blob:preview");
    });
    expect(filePreview).toHaveBeenCalledWith("dev_1", "shot.png", "C:\\repo");
    expect(container.textContent).not.toContain("file://");
  });

  test("hydrates inline-code local image paths through the daemon preview API", async () => {
    const createObjectUrl = vi.fn(() => "blob:dog-preview");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectUrl,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectUrl,
      configurable: true,
    });
    const filePreview = vi
      .spyOn(api, "filePreview")
      .mockResolvedValue(new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }));

    const { container } = render(() => (
      <Transcript
        deviceId="dev_1"
        cwd={"C:\\repo"}
        events={ev({
          type: "assistant",
          message: { content: [{ type: "text", text: "created `dog.png`" }] },
        } as ClaudeStreamEvent)}
      />
    ));

    await waitFor(() => {
      const img = container.querySelector<HTMLImageElement>("img.local-image-preview-img");
      expect(img?.src).toBe("blob:dog-preview");
    });
    expect(filePreview).toHaveBeenCalledWith("dev_1", "dog.png", "C:\\repo");
    expect(container.textContent).not.toContain("file://");
  });

  test("hydrates plain local image filenames through the daemon preview API", async () => {
    const createObjectUrl = vi.fn(() => "blob:plain-dog-preview");
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectUrl,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    const filePreview = vi
      .spyOn(api, "filePreview")
      .mockResolvedValue(new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" }));

    const { container } = render(() => (
      <Transcript
        deviceId="dev_1"
        cwd={"C:\\repo"}
        events={ev({
          type: "assistant",
          message: { content: [{ type: "text", text: "created dog.png" }] },
        } as ClaudeStreamEvent)}
      />
    ));

    await waitFor(() => {
      const img = container.querySelector<HTMLImageElement>("img.local-image-preview-img");
      expect(img?.src).toBe("blob:plain-dog-preview");
    });
    expect(filePreview).toHaveBeenCalledWith("dev_1", "dog.png", "C:\\repo");
  });
});
