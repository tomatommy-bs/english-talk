import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { hidePopup, requestLookup, showPopup, speak } from "../lib/session";
import { useStore, type Message } from "../lib/store";

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

function useFlash(id: string) {
  const flash = useStore((s) => s.flashId === id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [flash]);
  return { ref, flash };
}

function MyMessage({ m }: { m: Message }) {
  const { ref, flash } = useFlash(m.id);
  return (
    <div ref={ref} className={`${bubble} self-end bg-me ${flash ? "outline-2 outline-accent" : ""}`}>
      <span>{m.text}</span>
      {m.ja && <div className="mt-1 text-[13px] text-muted">🇯🇵 {m.ja}</div>}
      {m.marks && <div className="mt-0.5 text-xs">{m.marks}</div>}
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

  const onMarkClick = (e: MouseEvent<HTMLElement>, lookupId: string) => {
    e.stopPropagation();
    showPopup(lookupId, e.currentTarget.getBoundingClientRect());
  };

  // ハイライトの範囲で本文を区切って描く
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const h of m.highlights) {
    if (h.start > pos) parts.push(m.text.slice(pos, h.start));
    parts.push(<Mark key={h.lookupId} lookupId={h.lookupId} text={m.text.slice(h.start, h.end)} onClick={onMarkClick} />);
    pos = h.end;
  }
  if (pos < m.text.length) parts.push(m.text.slice(pos));

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

function Mark({
  lookupId,
  text,
  onClick,
}: {
  lookupId: string;
  text: string;
  onClick: (e: MouseEvent<HTMLElement>, id: string) => void;
}) {
  const meaning = useStore((s) => s.lookups[lookupId]?.meaning);
  return (
    <mark
      title={meaning ?? undefined}
      onClick={(e) => onClick(e, lookupId)}
      className={`cursor-pointer rounded-sm bg-hl px-px text-inherit ${meaning ? "" : "outline outline-dashed outline-accent"}`}
    >
      {text}
    </mark>
  );
}
