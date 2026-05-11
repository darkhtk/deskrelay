// Attachments — pending image-attachment list shown above the composer.
//
// Ported from the original browser prototype/attachments.js. Image-only (matches
// claude's image content-block surface), max 8 files / 10 MB each. Two
// input paths exposed:
//   - File picker via the "Attach" button that triggers a hidden <input>
//   - Programmatic add(File[]) so a paste handler on the composer (or
//     anywhere else) can drop images in
// Each attachment becomes a chip with thumbnail + filename + remove button.

import { type Component, For, type JSX, Show, createSignal } from "solid-js";
import { t } from "../i18n.ts";

const MAX_FILES = 8;
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

export interface Attachment {
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
}

export interface AttachmentsAPI {
  /** Currently pending attachments (read-only snapshot). */
  list: () => Attachment[];
  /** Add files (e.g. from a paste event). Skips non-images and oversized. */
  add: (files: FileList | File[] | null | undefined) => Promise<void>;
  /** Remove one by index. */
  remove: (index: number) => void;
  /** Clear all (e.g. after a successful send). */
  clear: () => void;
  /** Programmatically trigger the hidden file picker. The composer's "+"
   *  attach button calls this so we don't need a separate visible button
   *  on the attachment bar. */
  openPicker: () => void;
}

export interface AttachmentsProps {
  /** Notified whenever the list changes (also after add / remove / clear). */
  onChange?: (attachments: Attachment[]) => void;
  /** Receives the imperative API so a parent (Composer host) can call
   *  add() from a paste handler. */
  ref?: (api: AttachmentsAPI) => void;
  /** Style hook for the surrounding bar. */
  style?: JSX.CSSProperties;
}

interface AttachmentNotice {
  id: number;
  message: string;
}

export const Attachments: Component<AttachmentsProps> = (props) => {
  const [items, setItems] = createSignal<Attachment[]>([]);
  const [notices, setNotices] = createSignal<AttachmentNotice[]>([]);
  let fileInputEl!: HTMLInputElement;
  let nextNoticeId = 1;

  function emit(next: Attachment[]) {
    setItems(next);
    props.onChange?.(next);
  }

  function showNotices(messages: string[]) {
    setNotices(
      messages.map((message) => ({
        id: nextNoticeId++,
        message,
      })),
    );
  }

  async function add(files: FileList | File[] | null | undefined): Promise<void> {
    if (!files) return;
    const list = Array.isArray(files) ? files : Array.from(files);
    const next = items().slice();
    const messages: string[] = [];
    let maxFilesReported = false;
    for (const file of list) {
      if (next.length >= MAX_FILES) {
        if (!maxFilesReported) {
          messages.push(t("att.error.max-files", { max: MAX_FILES }));
          maxFilesReported = true;
        }
        continue;
      }
      if (!isSupportedImage(file)) {
        messages.push(t("att.error.unsupported", { name: file.name || "file" }));
        continue;
      }
      if (file.size > MAX_BYTES_PER_FILE) {
        messages.push(
          t("att.error.too-large", {
            name: file.name || "image",
            max: formatBytes(MAX_BYTES_PER_FILE),
          }),
        );
        continue;
      }
      try {
        const dataBase64 = await readBase64(file);
        next.push({
          name: file.name || "image",
          mimeType: mimeTypeForFile(file),
          size: file.size || 0,
          dataBase64,
        });
      } catch {
        messages.push(t("att.error.read-failed", { name: file.name || "image" }));
      }
    }
    showNotices(messages);
    emit(next);
  }

  function remove(index: number) {
    const cur = items();
    if (index < 0 || index >= cur.length) return;
    const next = cur.slice();
    next.splice(index, 1);
    emit(next);
  }

  function clear() {
    setNotices([]);
    emit([]);
  }

  function openPicker() {
    try {
      fileInputEl.value = "";
    } catch {
      // some browsers throw on setting .value of file input — safe to ignore
    }
    fileInputEl.click();
  }

  // Expose the imperative API to the parent (e.g. for paste handlers).
  props.ref?.({
    list: () => items().slice(),
    add,
    remove,
    clear,
    openPicker,
  });

  return (
    <>
      <Show when={items().length > 0 || notices().length > 0}>
        <div class="attachment-bar" id="attachment-bar">
          <For each={items()}>
            {(att, i) => (
              <div class="attachment-chip" data-attachment-index={i()} title={att.name}>
                <img
                  class="attachment-thumb"
                  src={`data:${att.mimeType};base64,${att.dataBase64}`}
                  alt={att.name}
                />
                <span class="attachment-name">
                  <span>{att.name}</span>
                  <span class="attachment-meta">{formatBytes(att.size)}</span>
                </span>
                <button
                  type="button"
                  class="attachment-remove"
                  aria-label={t("att.remove")}
                  onClick={(e) => {
                    e.preventDefault();
                    remove(i());
                  }}
                >
                  x
                </button>
              </div>
            )}
          </For>
          <For each={notices()}>
            {(notice) => (
              <span class="attachment-notice" data-attachment-notice-id={notice.id}>
                {notice.message}
              </span>
            )}
          </For>
        </div>
      </Show>
      <input
        ref={fileInputEl}
        id="composer-attach-input"
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        hidden
        onChange={(e) => {
          void add((e.currentTarget as HTMLInputElement).files);
        }}
      />
    </>
  );
};

function isSupportedImage(file: File): boolean {
  if (SUPPORTED_IMAGE_TYPES.has(String(file?.type || "").toLowerCase())) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
}

function mimeTypeForFile(file: File): string {
  const type = String(file?.type || "").toLowerCase();
  if (SUPPORTED_IMAGE_TYPES.has(type)) return type;
  const name = file.name || "";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "image/png";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = Number.isInteger(value) || value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Helper for hosts that want to wire a paste handler on a textarea or
 *  document. Returns true if at least one image was found and queued. */
export function imagesFromClipboard(event: ClipboardEvent): File[] {
  const out: File[] = [];
  const items = event.clipboardData?.items;
  if (!items) return out;
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isSupportedImage(file)) out.push(file);
  }
  return out;
}
