// Attachments behavior tests — verifies the imperative API + DOM rendering.
// Avoids relying on the file picker (jsdom can't show one); uses the
// programmatic add() path that paste handlers also use.

import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import {
  Attachments,
  type AttachmentsAPI,
  imagesFromClipboard,
} from "../src/components/Attachments.tsx";

function pngFile(name = "x.png", size = 100): File {
  // jsdom's File supports the constructor; size is whatever we put in.
  const blob = new Uint8Array(size);
  return new File([blob], name, { type: "image/png" });
}

function nonImageFile(): File {
  return new File(["text"], "notes.txt", { type: "text/plain" });
}

function setup() {
  let api!: AttachmentsAPI;
  const onChange = vi.fn();
  const utils = render(() => (
    <Attachments
      onChange={onChange}
      ref={(a) => {
        api = a;
      }}
    />
  ));
  return { ...utils, api: () => api, onChange };
}

describe("Attachments — add / remove / clear", () => {
  test("starts empty (no chips, no bar)", () => {
    const { container } = setup();
    expect(container.querySelector(".attachment-bar")).toBeFalsy();
  });

  test("add() inserts an image and renders a chip", async () => {
    const { api, container, onChange } = setup();
    await api().add([pngFile("a.png")]);
    expect(container.querySelectorAll(".attachment-chip").length).toBe(1);
    expect(container.textContent).toContain("a.png");
    expect(onChange).toHaveBeenCalled();
  });

  test("non-image files are rejected with a visible notice", async () => {
    const { api, container } = setup();
    await api().add([nonImageFile()]);
    expect(container.querySelector(".attachment-chip")).toBeFalsy();
    expect(container.querySelector(".attachment-notice")?.textContent).toContain("지원하지 않는");
  });

  test("oversized files (>10 MB) are rejected with a visible notice", async () => {
    const { api, container } = setup();
    await api().add([pngFile("big.png", 11 * 1024 * 1024)]);
    expect(container.querySelector(".attachment-chip")).toBeFalsy();
    expect(container.querySelector(".attachment-notice")?.textContent).toContain("10 MiB");
  });

  test("max 8 attachments", async () => {
    const { api, container } = setup();
    await api().add(Array.from({ length: 12 }, (_, i) => pngFile(`p${i}.png`)));
    expect(container.querySelectorAll(".attachment-chip").length).toBe(8);
    expect(container.querySelector(".attachment-notice")?.textContent).toContain("최대 8개");
  });

  test("extension fallback accepts image files with missing MIME type", async () => {
    const { api, container } = setup();
    const file = new File([new Uint8Array(100)], "photo.jpg", { type: "" });
    await api().add([file]);
    const img = container.querySelector(".attachment-thumb") as HTMLImageElement;
    expect(img.src).toMatch(/^data:image\/jpeg;base64,/);
  });

  test("× button removes the chip", async () => {
    const { api, container } = setup();
    await api().add([pngFile("a.png"), pngFile("b.png")]);
    const removeBtn = container.querySelector(".attachment-remove") as HTMLButtonElement;
    fireEvent.click(removeBtn);
    expect(container.querySelectorAll(".attachment-chip").length).toBe(1);
    // The first one (a.png) was removed.
    expect(container.textContent).toContain("b.png");
    expect(container.textContent).not.toContain("a.png");
  });

  test("clear() empties everything", async () => {
    const { api, container } = setup();
    await api().add([pngFile("a.png"), pngFile("b.png")]);
    api().clear();
    expect(container.querySelector(".attachment-chip")).toBeFalsy();
  });

  test("list() returns a snapshot, not the live array", async () => {
    const { api } = setup();
    await api().add([pngFile("a.png")]);
    const snap = api().list();
    expect(snap.length).toBe(1);
    api().clear();
    expect(snap.length).toBe(1); // snapshot unaffected
  });

  test("attachment chip has data URL src for the thumbnail", async () => {
    const { api, container } = setup();
    await api().add([pngFile("a.png")]);
    const img = container.querySelector(".attachment-thumb") as HTMLImageElement;
    expect(img.src).toMatch(/^data:image\/png;base64,/);
  });
});

describe("imagesFromClipboard", () => {
  function makeClipboardEvent(items: Array<{ kind: string; type: string; file: File | null }>) {
    const dataTransferItems = items.map((it) => ({
      kind: it.kind,
      type: it.type,
      getAsFile: () => it.file,
    }));
    return {
      clipboardData: {
        items: dataTransferItems as unknown as DataTransferItemList,
      },
    } as ClipboardEvent;
  }

  test("returns image files", () => {
    const file = pngFile("paste.png");
    const event = makeClipboardEvent([{ kind: "file", type: "image/png", file }]);
    expect(imagesFromClipboard(event)).toEqual([file]);
  });

  test("ignores non-file items", () => {
    const event = makeClipboardEvent([{ kind: "string", type: "text/plain", file: null }]);
    expect(imagesFromClipboard(event)).toEqual([]);
  });

  test("ignores non-image files", () => {
    const file = nonImageFile();
    const event = makeClipboardEvent([{ kind: "file", type: "text/plain", file }]);
    expect(imagesFromClipboard(event)).toEqual([]);
  });

  test("returns empty when clipboardData is missing", () => {
    expect(imagesFromClipboard({} as ClipboardEvent)).toEqual([]);
  });
});
