// Transcript — Solid wrapper around TranscriptModel.
//
// Phase-1 strategy: the heavy lifting (markdown render, tool renderers,
// entry accumulation) lives in pure TS modules that produce HTML strings.
// This component just rebuilds a TranscriptModel from the events prop and
// assigns model.render() to a div's innerHTML. The events array is treated
// as the source of truth; on every change we replay from scratch.
//
// Future Phase-3 work will introduce a streaming
// model (ingest one event at a time) so we don't replay the world on each
// new SSE frame — for now the array-rebuild path is correct for any size
// transcript a single user produces in one session.

import { type Component, createEffect, createMemo, onCleanup, onMount } from "solid-js";
import { ApiError, api, type ClaudeStreamEvent } from "../api.ts";
import { TranscriptModel } from "../claude/transcript-model.ts";
import { t } from "../i18n.ts";

export interface TranscriptProps {
  events: ClaudeStreamEvent[];
  deviceId?: string | null;
  cwd?: string | null;
}

export const Transcript: Component<TranscriptProps> = (props) => {
  const html = createMemo(() => {
    const model = new TranscriptModel();
    for (const event of props.events) {
      // ClaudeStreamEvent has the same shape (`type`, `message`, etc.)
      // as the model's ClaudeRawEvent — no envelope unwrap needed.
      model.ingestEvent(event as Parameters<TranscriptModel["ingestEvent"]>[0]);
    }
    return model.render();
  });

  let rootEl!: HTMLDivElement;
  let generation = 0;
  const objectUrls = new Set<string>();

  function revokePreviewUrls() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  onMount(() => {
    // Delegate code-block copy buttons. The rendered HTML embeds
    // `<button data-copy>` next to each <pre>; we wire the handler at
    // the root so it survives innerHTML re-writes.
    rootEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const retry = target?.closest("button[data-preview-retry]");
      if (retry) {
        const preview = retry.closest(".local-image-preview") as HTMLElement | null;
        if (preview) {
          preview.removeAttribute("data-preview-state");
          void hydrateLocalImagePreview(preview, {
            deviceId: props.deviceId ?? null,
            cwd: props.cwd ?? "",
            generation,
            currentGeneration: () => generation,
            registerObjectUrl: (url) => objectUrls.add(url),
          });
        }
        return;
      }
      if (!target?.matches("button[data-copy]")) return;
      const pre = target.closest("pre");
      const code = pre?.querySelector("code");
      if (!code?.textContent) return;
      navigator.clipboard?.writeText(code.textContent).catch(() => undefined);
      const original = target.textContent;
      target.textContent = t("tx.copied");
      setTimeout(() => {
        target.textContent = original;
      }, 1200);
    });
  });

  createEffect(() => {
    const rendered = html();
    const deviceId = props.deviceId ?? null;
    const cwd = props.cwd ?? "";
    void rendered;
    revokePreviewUrls();
    generation += 1;
    const localGeneration = generation;
    queueMicrotask(() => {
      if (!rootEl || localGeneration !== generation) return;
      resetLocalImagePreviewStates(rootEl);
      hydrateLocalImagePreviews(rootEl, {
        deviceId,
        cwd,
        generation: localGeneration,
        currentGeneration: () => generation,
        registerObjectUrl: (url) => objectUrls.add(url),
      });
    });
  });

  onCleanup(revokePreviewUrls);

  return (
    <div
      ref={rootEl}
      class="transcript"
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={html() || `<p class="muted">${t("tx.empty")}</p>`}
    />
  );
};

interface PreviewHydrationOptions {
  deviceId: string | null;
  cwd: string;
  generation: number;
  currentGeneration: () => number;
  registerObjectUrl: (url: string) => void;
}

function hydrateLocalImagePreviews(root: HTMLElement, options: PreviewHydrationOptions): void {
  const previews = root.querySelectorAll<HTMLElement>(
    ".local-image-preview[data-local-image-path]:not([data-preview-state])",
  );
  for (const preview of previews) {
    void hydrateLocalImagePreview(preview, options);
  }
}

function resetLocalImagePreviewStates(root: HTMLElement): void {
  const previews = root.querySelectorAll<HTMLElement>(
    ".local-image-preview[data-local-image-path]",
  );
  for (const preview of previews) preview.removeAttribute("data-preview-state");
}

async function hydrateLocalImagePreview(
  preview: HTMLElement,
  options: PreviewHydrationOptions,
): Promise<void> {
  const path = preview.dataset.localImagePath ?? "";
  const alt = preview.dataset.localImageAlt || path;
  preview.dataset.previewState = "loading";
  setPreviewStatus(preview, t("preview.loading"));
  if (!options.deviceId) {
    setPreviewError(preview, t("preview.error.no-device"), false);
    return;
  }
  if (!path) {
    setPreviewError(preview, t("preview.error.no-path"), false);
    return;
  }
  try {
    const blob = await api.filePreview(options.deviceId, path, options.cwd);
    if (options.generation !== options.currentGeneration()) return;
    const url = URL.createObjectURL(blob);
    options.registerObjectUrl(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = alt;
    img.loading = "lazy";
    img.className = "message-image local-image-preview-img";
    preview.dataset.previewState = "ready";
    preview.replaceChildren(img);
  } catch (err) {
    if (options.generation !== options.currentGeneration()) return;
    setPreviewError(preview, previewErrorMessage(err), previewErrorRetryable(err));
  }
}

function setPreviewStatus(preview: HTMLElement, message: string): void {
  const status = document.createElement("span");
  status.className = "local-image-preview-status";
  status.textContent = message;
  preview.replaceChildren(status);
}

function setPreviewError(preview: HTMLElement, message: string, retryable: boolean): void {
  preview.dataset.previewState = "error";
  const status = document.createElement("span");
  status.className = "local-image-preview-status";
  status.textContent = message;
  if (!retryable) {
    preview.replaceChildren(status);
    return;
  }
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "local-image-preview-retry";
  retry.dataset.previewRetry = "true";
  retry.textContent = t("preview.retry");
  preview.replaceChildren(status, retry);
}

function previewErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 403:
        return t("preview.error.forbidden");
      case 404:
        return t("preview.error.not-found");
      case 413:
        return t("preview.error.too-large");
      case 415:
        return t("preview.error.unsupported");
      case 503:
        return t("preview.error.offline");
      default:
        return err.message || t("preview.error.generic");
    }
  }
  return err instanceof Error ? err.message : t("preview.error.generic");
}

function previewErrorRetryable(err: unknown): boolean {
  return (
    err instanceof ApiError && (err.status === 502 || err.status === 503 || err.status === 504)
  );
}
