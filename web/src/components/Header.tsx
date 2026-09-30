import { setSilence, setTtsEngine, toggleStop } from "../lib/session";
import { useStore, type Phase } from "../lib/store";

const PHASE: Record<Phase, { label: string; tone: string }> = {
  idle: { label: "待機中", tone: "text-muted border-line" },
  loading: { label: "音声モデル読み込み中", tone: "text-muted border-line" },
  speaking: { label: "話しています", tone: "text-accent border-accent" },
  listening: { label: "聞いています", tone: "text-advanced border-advanced" },
  thinking: { label: "考え中…", tone: "text-natural border-natural" },
  stopped: { label: "停止中", tone: "text-danger border-danger" },
};

const pill = "rounded-full border px-2.5 py-0.5 text-xs";

export function Header() {
  const phase = useStore((s) => s.phase);
  const connected = useStore((s) => s.connected);
  const scenario = useStore((s) => s.scenario);
  const ttsEngine = useStore((s) => s.ttsEngine);
  const silence = useStore((s) => s.silence);
  const stopped = useStore((s) => s.stopped);

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
      <div className="flex items-baseline gap-2.5">
        <strong>English Talk</strong>
        <span className="text-muted">{scenario}</span>
      </div>
      <div className="flex gap-2">
        <span className={`${pill} ${PHASE[phase].tone}`}>{PHASE[phase].label}</span>
        <span className={`${pill} ${connected ? "border-advanced text-advanced" : "border-line text-muted"}`}>
          {connected ? "WebMCP 接続中" : "WebMCP 未接続"}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-3.5 text-[13px]">
        <label className="flex items-center gap-1.5" title="読み上げエンジン">
          🔊
          <select
            className="rounded-md border border-line bg-bg px-2 py-1"
            value={ttsEngine}
            onChange={(e) => setTtsEngine(e.target.value as "kokoro" | "os")}
          >
            <option value="kokoro">Kokoro（自然）</option>
            <option value="os">OS 音声</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5" title="話し終わりとみなす無音の秒数">
          ⏱
          <input
            type="range"
            min={0.8}
            max={4}
            step={0.2}
            value={silence}
            onChange={(e) => setSilence(Number(e.target.value))}
          />
          <span className="w-8 tabular-nums">{silence.toFixed(1)}s</span>
        </label>
        <button
          className={`rounded-md border border-danger px-3 py-1 ${stopped ? "bg-danger text-white" : "text-danger"}`}
          onClick={toggleStop}
        >
          {stopped ? "再開" : "停止"}
        </button>
      </div>
    </header>
  );
}
