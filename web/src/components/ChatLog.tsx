import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { hidePopup, requestLookup, showFeedbackPopup, showLookupPopup, speak } from "../lib/session";
import { useStore, type FeedbackRef, type FeedbackType, type Message } from "../lib/store";

export function ChatLog() {
  const messages = useStore((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length]);

  return (
    <div ref={ref} onScroll={hidePopup} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
      {messages.map((m) => (m.role === "ai" ? <AiMessage key={m.id} m={m} /> : <MyMessage key={m.id} m={m} />))}
    </div>
  );
}

const bubble = "max-w-[85%] rounded-xl px-3 py-2";

export const FEEDBACK_MARK: Record<FeedbackType, string> = { grammar: "❌", natural: "💬", advanced: "✨" };

/** 下線の色と形。文法の誤りは波線で目立たせる */
const UNDERLINE: Record<FeedbackType, string> = {
  grammar: "decoration-grammar decoration-wavy",
  natural: "decoration-natural",
  advanced: "decoration-advanced decoration-dotted",
};

/** 本文を範囲（start〜end）で区切り、範囲の部分は render で描く */
function splitByRanges<T extends { start: number; end: number }>(
  text: string,
  ranges: T[],
  render: (range: T, slice: string) => ReactNode,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    parts.push(render(r, text.slice(r.start, r.end)));
    pos = r.end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

function useFlash(id: string) {
  const flash = useStore((s) => s.flashId === id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [flash]);
  return { ref, flash };
}

function openFeedback(e: MouseEvent<HTMLElement>, refs: FeedbackRef[]) {
  e.stopPropagation();
  showFeedbackPopup(refs, e.currentTarget.getBoundingClientRect());
}

function MyMessage({ m }: { m: Message }) {
  const { ref, flash } = useFlash(m.id);
  const parts = splitByRanges(m.text, m.fbSpans ?? [], (sp, slice) => (
    <span
      key={`${sp.cardId}-${sp.index}`}
      data-popup-anchor
      title="クリックで指摘を見る"
      onClick={(e) => openFeedback(e, [sp])}
      className={`cursor-pointer underline decoration-2 underline-offset-4 hover:bg-black/5 ${UNDERLINE[sp.type]}`}
    >
      {slice}
    </span>
  ));
  const whole = m.fbWhole ?? [];

  return (
    <div ref={ref} className={`${bubble} self-end bg-me ${flash ? "outline-2 outline-accent" : ""}`}>
      <span>{parts}</span>
      {m.ja && <div className="mt-1 text-[13px] text-muted">🇯🇵 {m.ja}</div>}
      {whole.length > 0 && (
        <button
          data-popup-anchor
          className="mt-0.5 block text-xs"
          title="文全体への指摘を見る"
          onClick={(e) => openFeedback(e, whole)}
        >
          {whole.map((r) => FEEDBACK_MARK[r.type]).join("")}
        </button>
      )}
      {m.good && <div className="mt-0.5 text-xs">👍</div>}
    </div>
  );
}

/** container の先頭から (node, offset) までの文字数 */
function offsetIn(container: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(container);
  r.setEnd(node, offset);
  return r.toString().length;
}

function AiMessage({ m }: { m: Message }) {
  const [showJa, setShowJa] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);

  const onMouseUp = () => {
    const sel = getSelection();
    const el = textRef.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !el) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    let start = offsetIn(el, range.startContainer, range.startOffset);
    let end = offsetIn(el, range.endContainer, range.endOffset);
    // 前後の空白はハイライトに含めない
    while (start < end && /\s/.test(m.text[start])) start++;
    while (end > start && /\s/.test(m.text[end - 1])) end--;
    const rect = range.getBoundingClientRect();
    sel.removeAllRanges();
    if (end > start) requestLookup(m.id, start, end, rect);
  };

  const parts = splitByRanges(m.text, m.highlights, (h, slice) => (
    <LookupMark key={h.lookupId} lookupId={h.lookupId} text={slice} />
  ));

  const tool = "px-0.5 text-[13px] opacity-55 hover:opacity-100";
  return (
    <div className={`${bubble} self-start bg-ai`}>
      <span ref={textRef} onMouseUp={onMouseUp} className="cursor-text">
        {parts}
      </span>
      <span className="ml-1.5 whitespace-nowrap">
        <button className={tool} title="もう一度聞く" onClick={() => void speak(m.text)}>
          🔊
        </button>
        {m.ja && (
          <button className={`${tool} ${showJa ? "opacity-100" : ""}`} title="日本語訳" onClick={() => setShowJa(!showJa)}>
            訳
          </button>
        )}
      </span>
      {m.ja && showJa && <div className="mt-1 text-[13px] text-muted">{m.ja}</div>}
    </div>
  );
}

function LookupMark({ lookupId, text }: { lookupId: string; text: string }) {
  const meaning = useStore((s) => s.lookups[lookupId]?.meaning);
  return (
    <mark
      data-popup-anchor
      title={meaning ?? undefined}
      onClick={(e) => {
        e.stopPropagation();
        showLookupPopup(lookupId, e.currentTarget.getBoundingClientRect());
      }}
      className={`cursor-pointer rounded-sm bg-hl px-px text-inherit ${meaning ? "" : "outline outline-dashed outline-accent"}`}
    >
      {text}
    </mark>
  );
}
