import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hidePopup } from "../lib/session";
import { useStore, type FeedbackRef } from "../lib/store";
import { FEEDBACK_MARK } from "./ChatLog";

/** 選んだ表現の意味、または自分の発言への指摘を、クリックした場所の下に出す */
export function Popup() {
  const popup = useStore((s) => s.popup);
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);

  // 画面の右端からはみ出さないように寄せる
  useLayoutEffect(() => {
    if (!popup || !ref.current) return;
    const w = ref.current.offsetWidth;
    setLeft(Math.max(8, Math.min(window.innerWidth - w - 8, popup.x)));
  });

  useEffect(() => {
    if (!popup) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest("[data-popup-anchor]")) hidePopup();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popup]);

  if (!popup) return null;
  return (
    <div
      ref={ref}
      style={{ left, top: popup.y }}
      className="fixed z-10 max-w-[min(360px,calc(100vw-16px))] whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg"
    >
      {popup.kind === "lookup" ? <LookupBody lookupId={popup.lookupId} /> : <FeedbackBody refs={popup.refs} />}
    </div>
  );
}

function LookupBody({ lookupId }: { lookupId: string }) {
  const lookup = useStore((s) => s.lookups[lookupId]);
  const stopped = useStore((s) => s.stopped);
  if (!lookup) return null;
  return (
    <>
      <div className="mb-0.5 font-semibold">{lookup.phrase}</div>
      <div>{lookup.meaning ?? (stopped ? "停止中は調べられません" : "調べています…")}</div>
    </>
  );
}

function FeedbackBody({ refs }: { refs: FeedbackRef[] }) {
  const feedback = useStore((s) => s.feedback);
  return (
    <div className="flex flex-col gap-2">
      {refs.map((r) => {
        const it = feedback.find((c) => c.id === r.cardId)?.items[r.index];
        if (!it) return null;
        return (
          <div key={`${r.cardId}-${r.index}`}>
            <span>{FEEDBACK_MARK[it.type]} </span>
            <span className="text-muted line-through">{it.original}</span>
            {" → "}
            <span className="font-semibold">{it.better}</span>
            {it.note && <div className="text-[13px] text-muted">{it.note}</div>}
          </div>
        );
      })}
    </div>
  );
}
