import { type Component, For, type JSX, Show, createSignal } from "solid-js";
import { t } from "../i18n.ts";
import { LoginCard } from "./LoginCard.tsx";

type MarkdownBlock =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

const releaseNotesMarkdown = `
## 릴리즈 노트

### Self-host 설치와 등록 정리

- 설치 흐름을 서버 시작과 다른 PC 등록 명령 실행으로 단순화했습니다.
- 다른 PC 등록 명령은 서버 URL과 Site token만 포함합니다.
- 대상 PC의 connector daemon은 외부 접근 가능 여부를 검증한 뒤 등록됩니다.
- 같은 daemon URL을 다시 등록하면 기존 등록을 정리한 뒤 새 등록을 만듭니다.

### UI 기준

- 메인 화면은 한국어 기준의 간단한 시작 화면입니다.
- 세션, 권한, 스킬은 모두 현재 선택된 디바이스 기준으로 표시됩니다.
- composer에서 연속으로 보낸 지시는 순서대로 큐잉됩니다.
`.trim();

export interface LandingProps {
  onTokenLogin: (token: string) => void | Promise<void>;
  onLocalAccessLogin?: () => boolean | Promise<boolean>;
  authed?: boolean;
  onProceed?: () => void;
}

export const Landing: Component<LandingProps> = (props) => {
  const [accessOpen, setAccessOpen] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const open = async () => {
    if (opening()) return;
    if (props.authed) {
      props.onProceed?.();
      return;
    }
    setOpening(true);
    try {
      if (await props.onLocalAccessLogin?.()) {
        props.onProceed?.();
        return;
      }
    } catch {
      // Fall back to manual Site token entry.
    } finally {
      setOpening(false);
    }
    setAccessOpen(true);
  };

  return (
    <>
      <section class="landing-hero">
        <div class="landing-hero-inner">
          <h1 class="landing-headline">
            <For each={t("landing.headline").split("\n")}>
              {(line, index) => (
                <>
                  <Show when={index() > 0}>
                    <br />
                  </Show>
                  {line}
                </>
              )}
            </For>
          </h1>
          <div class="landing-cta-row">
            <button
              type="button"
              class="primary-button landing-cta"
              onClick={() => void open()}
              disabled={opening()}
            >
              {t("landing.cta.start")}
            </button>
          </div>
        </div>
      </section>

      <MarkdownReleaseNotes markdown={releaseNotesMarkdown} />

      <Show when={accessOpen()}>
        <dialog
          open
          class="approval-modal-root"
          aria-label={t("landing.signin.title")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setAccessOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setAccessOpen(false);
          }}
        >
          <button
            type="button"
            class="approval-backdrop"
            onClick={() => setAccessOpen(false)}
            aria-label={t("app.settings.close")}
          />
          <div class="approval-card" style={{ width: "min(420px, 95vw)" }}>
            <div class="approval-header">
              <span class="approval-title">{t("landing.signin.title")}</span>
              <button
                type="button"
                class="sidebar-action"
                style={{ "margin-left": "auto", width: "auto", padding: "4px 10px" }}
                onClick={() => setAccessOpen(false)}
                aria-label={t("app.dialog.close")}
              >
                x
              </button>
            </div>
            <LoginCard
              onTokenLogin={async (token) => {
                await props.onTokenLogin(token);
                props.onProceed?.();
              }}
            />
          </div>
        </dialog>
      </Show>
    </>
  );
};

const MarkdownReleaseNotes: Component<{ markdown: string }> = (props) => {
  const blocks = () => parseMarkdownBlocks(props.markdown);
  return (
    <section class="landing-release-notes" aria-label="Release notes">
      <div class="landing-release-notes-inner">
        <For each={blocks()}>{(block) => renderMarkdownBlock(block)}</For>
      </div>
    </section>
  );
};

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "ul", items: list });
    list = [];
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2).trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderMarkdownBlock(block: MarkdownBlock): JSX.Element {
  if (block.type === "h2") return <h2>{renderMarkdownInline(block.text)}</h2>;
  if (block.type === "h3") return <h3>{renderMarkdownInline(block.text)}</h3>;
  if (block.type === "ul") {
    return (
      <ul>
        <For each={block.items}>{(item) => <li>{renderMarkdownInline(item)}</li>}</For>
      </ul>
    );
  }
  return <p>{renderMarkdownInline(block.text)}</p>;
}

function renderMarkdownInline(text: string): JSX.Element[] {
  const nodes: JSX.Element[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = link?.[1];
      const url = link?.[2];
      if (label && url) {
        const href = safeMarkdownHref(url);
        nodes.push(
          href ? (
            <a href={href} rel="noreferrer">
              {label}
            </a>
          ) : (
            label
          ),
        );
      } else {
        nodes.push(token);
      }
    }
    last = pattern.lastIndex;
    match = pattern.exec(text);
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function safeMarkdownHref(value: string): string | null {
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
