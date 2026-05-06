// Attachments — pending image-attachment list shown above the composer.
//
// Ported from claude-remote/public/attachments.js. Image-only (matches
// claude's image content-block surface), max 8 files / 10 MB each. Two
// input paths exposed:
//   - File picker via the "Attach" button that triggers a hidden <input>
//   - Programmatic add(File[]) so a paste handler on the composer (or
//     anywhere else) can drop images in
// Each attachment becomes a chip with thumbnail + filename + × button.

import { type Component, For, type JSX, Show, createSignal } from "solid-js";
import { t } from "../i18n.ts";

const MAX_FILES = 8;
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;

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

export const Attachments: Component<AttachmentsProps> = (props) => {
  const [items, setItems] = createSignal<Attachment[]>([]);
  let fileInputEl!: HTMLInputElement;

  function emit(next: Attachment[]) {
    setItems(next);
    props.onChange?.(next);
  }

  async function add(files: FileList | File[] | null | undefined): Promise<void> {
    if (!files) return;
    const list = Array.isArray(files) ? files : Array.from(files);
    const next = items().slice();
    for (const file of list) {
      if (next.length >= MAX_FILES) break;
      if (!isImage(file)) continue;
      if (file.size > MAX_BYTES_PER_FILE) continue;
      try {
        const dataBase64 = await readBase64(file);
        next.push({
          name: file.name || "image",
          mimeType: file.type || "image/png",
          size: file.size || 0,
          dataBase64,
        });
      } catch {
        // skip unreadable
      }
    }
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
      <Show when={items().length > 0}>
        <div class="attachment-bar" id="attachment-bar">
          <For each={items()}>
            {(att, i) => (
              <div class="attachment-chip" data-attachment-index={i()}>
                <img
                  class="attachment-thumb"
                  src={`data:${att.mimeType};base64,${att.dataBase64}`}
                  alt={att.name}
                />
                <span class="attachment-name">{att.name}</span>
                <button
                  type="button"
                  class="attachment-remove"
                  aria-label={t("att.remove")}
                  onClick={(e) => {
                    e.preventDefault();
                    remove(i());
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <input
        ref={fileInputEl}
        id="composer-attach-input"
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void add((e.currentTarget as HTMLInputElement).files);
        }}
      />
    </>
  );
};

function isImage(file: File): boolean {
  return /^image\//.test(String(file?.type || ""));
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
    if (file && isImage(file)) out.push(file);
  }
  return out;
}
