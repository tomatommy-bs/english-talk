import { set, useStore } from "../lib/store";

export function SummaryModal() {
  const summary = useStore((s) => s.summary);
  if (summary === null) return null;
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/45 p-4">
      <div className="max-h-[85vh] w-full max-w-[640px] overflow-y-auto rounded-xl bg-surface px-6 py-5">
        <h2 className="mb-3 text-lg font-semibold">今日のまとめ</h2>
        <div className="whitespace-pre-wrap">{summary}</div>
        <button className="mt-4 rounded-md border border-line px-3 py-1" onClick={() => set({ summary: null })}>
          閉じる
        </button>
      </div>
    </div>
  );
}
