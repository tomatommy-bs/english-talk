import { clearInput, clearMemo, editField, sendReply, setAutoSendPref, setJaMode } from "../lib/session";
import { fieldText, useStore } from "../lib/store";

const field = "min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5";
const iconBtn = "w-[34px] shrink-0 rounded-md border border-line bg-surface py-1";

export function Composer() {
  const input = useStore((s) => fieldText(s.fields.input));
  const memo = useStore((s) => fieldText(s.fields.memo));
  const memoOpen = useStore((s) => s.memoOpen);
  const jaMode = useStore((s) => s.jaMode);
  const autoSend = useStore((s) => s.autoSend);
  const hint = useStore((s) => s.hint);

  return (
    <div className="flex flex-col gap-1.5 border-t border-line bg-surface px-4 py-2.5">
      {memoOpen && (
        <div className="flex items-center gap-1.5">
          <span className="w-[34px] shrink-0 text-center">🇯🇵</span>
          <input
            className={`${field} border-dashed`}
            placeholder="日本語で伝えたいこと（話すか入力）"
            autoComplete="off"
            autoFocus
            value={memo}
            onChange={(e) => editField("memo", e.target.value)}
          />
          <button type="button" className={iconBtn} title="日本語メモを消す" onClick={clearMemo}>
            ✕
          </button>
        </div>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          sendReply();
        }}
      >
        <button
          type="button"
          className={`${iconBtn} ${jaMode ? "border-accent bg-accent text-xs font-semibold text-white" : ""}`}
          title={jaMode ? "英語で話す" : "先に日本語で伝えたいことを記録する"}
          onClick={() => setJaMode(!jaMode)}
        >
          {jaMode ? "EN" : "🇯🇵"}
        </button>
        <input
          className={field}
          placeholder="話すとここに入ります（入力も可）"
          autoComplete="off"
          value={input}
          onChange={(e) => editField("input", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") clearInput();
          }}
        />
        <button type="button" className={iconBtn} title="入力を消す（Esc）" onClick={clearInput}>
          ✕
        </button>
        <button type="submit" className="shrink-0 rounded-md bg-accent px-3 py-1 text-white" title="送信（Enter）">
          送信
        </button>
      </form>
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted">{hint}</span>
        <label
          className="flex items-center gap-1 whitespace-nowrap"
          title="話し終わったら自動で送信。入力欄を手で触るとそのターンだけオフ"
        >
          <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSendPref(e.target.checked)} />
          自動送信
        </label>
      </div>
    </div>
  );
}
