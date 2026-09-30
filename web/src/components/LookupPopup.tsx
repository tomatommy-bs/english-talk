import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hidePopup } from "../lib/session";
import { useStore } from "../lib/store";

export function LookupPopup() {
  const popup = useStore((s) => s.popup);
  const lookup = useStore((s) => (s.popup ? s.lookups[s.popup.lookupId] : undefined));
  const stopped = useStore((s) => s.stopped);
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);

  // 画面の右端からはみ出さないように寄せる
  useLayoutEffect(() => {
    if (!popup || !ref.current) return;
    const w = ref.current.offsetWidth;
    setLeft(Math.max(8, Math.min(window.innerWidth - w - 8, popup.x)));
  }, [popup, lookup?.meaning]);

  useEffect(() => {
    if (!popup) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest("mark")) hidePopup();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popup]);

  if (!popup || !lookup) return null;
  return (
    <div
      ref={ref}
      style={{ left, top: popup.y }}
      className="fixed z-10 max-w-[min(360px,calc(100vw-16px))] whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg"
    >
      <div className="mb-0.5 font-semibold">{lookup.phrase}</div>
      <div>{lookup.meaning ?? (stopped ? "停止中は調べられません" : "調べています…")}</div>
    </div>
  );
}
