import { flashMessage } from "../lib/session";
import { useStore, type FeedbackType } from "../lib/store";
import { FEEDBACK_MARK } from "./ChatLog";

const BORDER: Record<FeedbackType, string> = {
  grammar: "border-grammar",
  natural: "border-natural",
  advanced: "border-advanced",
};

export function FeedbackPanel() {
  const feedback = useStore((s) => s.feedback);

  return (
    <aside className="overflow-y-auto border-t border-line p-4 md:border-t-0">
      <h2 className="mb-2.5 text-sm text-muted">フィードバック</h2>
      {feedback.length === 0 ? (
        <p className="text-muted">あなたの発言への指摘がここに出ます</p>
      ) : (
        <div className="flex flex-col gap-3">
          {feedback.map((card) => (
            <div
              key={card.id}
              className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-2.5"
              onClick={() => flashMessage(card.messageId)}
            >
              <div className="mb-1.5 text-[13px] text-muted">「{card.said}」</div>
              {card.items.map((it, i) => (
                <div key={i} className={`mt-1.5 border-l-[3px] py-1.5 pl-2.5 ${BORDER[it.type] ?? "border-line"}`}>
                  <span>{FEEDBACK_MARK[it.type] ?? "•"} </span>
                  <span className="text-muted line-through">{it.original}</span>
                  {" → "}
                  <span className="font-semibold">{it.better}</span>
                  {it.note && <div className="text-[13px] text-muted">{it.note}</div>}
                </div>
              ))}
              {card.good && <div className="mt-1 text-[13px] text-advanced">👍 {card.good}</div>}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
