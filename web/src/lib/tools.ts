// WebMCP で Claude Code に公開するツール。
// WebMCP のブリッジはツール呼び出しを 30 秒で打ち切るので、待つツールは 25 秒で一旦返す。

import { clearEvents, detachWaiter, waitEvent, type PageEvent } from "./events";
import {
  addFeedback,
  addMessage,
  answerLookup,
  micListening,
  micOff,
  micOn,
  preloadVoice,
  setPhase,
  speak,
  stoppedEvent,
  waitingEvent,
} from "./session";
import { get, set, type FeedbackItem } from "./store";

const TOOL_BUDGET_MS = 25_000;

const result = (obj: unknown) => ({
  content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }],
});

const whenStopped = () => (get().stopped ? stoppedEvent() : null);

const EVENT_DOC =
  "戻り値の status: reply=ユーザーの発言（text。input=voice/voice_edited/typed。voice のときは alternatives=認識の別候補, low_confidence_segments。" +
  "intent_ja があれば、ユーザーが先に日本語で書いた「言いたかったこと」）, " +
  "lookup=ユーザーがあなたの発言の一部を選んで意味を知りたがっている（id, phrase, sentence。answer_lookup で答えてから listen）, " +
  "waiting=25秒以内に何も起きなかった（listen を呼んで待ち続ける）, stopped=ユーザーが停止した（lookups=調べた表現。end_session を呼ぶ）。";

const FEEDBACK_SCHEMA = {
  type: "array",
  description: "直前のユーザー発言への指摘（最大3件、重要な順）。指摘がなければ空配列",
  items: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["grammar", "natural", "advanced"],
        description: "grammar=文法の誤り, natural=より自然な表現, advanced=上級の言い回し",
      },
      original: { type: "string", description: "ユーザーが言った該当部分" },
      better: { type: "string", description: "直した言い方" },
      note: { type: "string", description: "日本語で一言の理由" },
    },
    required: ["type", "original", "better"],
  },
};

export function registerTools(): WebMCP {
  const mcp = new WebMCP({ inactivityTimeout: 12 * 60 * 60 * 1000 });

  mcp.registerTool(
    "start_session",
    "英会話セッションを始める。画面にシナリオを表示し、マイクと音声の準備をする。最初に一度だけ呼ぶ。",
    {
      type: "object",
      properties: {
        scenario: { type: "string", description: "会話の場面（例: cafe, job interview, small talk）" },
        level: { type: "string", description: "CEFR レベル（A1〜C2）" },
      },
    },
    async ({ scenario, level }: { scenario?: string; level?: string } = {}) => {
      clearEvents();
      set({ stopped: false, scenario: [scenario, level].filter(Boolean).join(" · ") });
      setPhase("idle");
      preloadVoice();
      const s = get();
      return result({ ok: true, tts: s.ttsEngine, silence_seconds: s.silence, auto_send: s.autoSendPref });
    },
  );

  mcp.registerTool(
    "say_and_listen",
    "① feedback を直前のユーザー発言への指摘として画面に出す（読み上げない）→ ② reply を画面に出して読み上げる（reply_ja は「訳」ボタンで出る日本語訳）→ ③ ユーザーの次のイベントを待って返す。" +
      EVENT_DOC,
    {
      type: "object",
      properties: {
        reply: { type: "string", description: "あなたの英語の発話。短く自然に" },
        reply_ja: { type: "string", description: "reply の自然な日本語訳" },
        feedback: FEEDBACK_SCHEMA,
        good: { type: "string", description: "よかった点があれば日本語で一言（任意）" },
      },
      required: ["reply", "reply_ja"],
    },
    async ({ reply, reply_ja, feedback, good }: { reply: string; reply_ja?: string; feedback?: FeedbackItem[]; good?: string }) => {
      const deadline = Date.now() + TOOL_BUDGET_MS;
      if (get().stopped) return result(stoppedEvent());
      if (feedback?.length || good) addFeedback(feedback, good);
      micOff();
      addMessage("ai", reply, reply_ja);
      setPhase("speaking");
      // 読み上げが長引いても 25 秒枠は守る。読み上げ終了後にマイクを開く
      const spoken = speak(reply).then(() => micOn());
      const event = await Promise.race<PageEvent>([
        spoken.then(() => waitEvent(deadline, waitingEvent, whenStopped)),
        new Promise((resolve) =>
          setTimeout(() => {
            detachWaiter();
            resolve(waitingEvent());
          }, deadline - Date.now()),
        ),
      ]);
      return result(event);
    },
  );

  mcp.registerTool(
    "listen",
    "ユーザーの次のイベントを最大25秒待つ。status=waiting のあとや、answer_lookup のあとに呼ぶ。" + EVENT_DOC,
    { type: "object", properties: {} },
    async () => {
      const s = get();
      if (!s.stopped && !micListening() && s.phase !== "speaking" && s.phase !== "thinking") micOn();
      return result(await waitEvent(Date.now() + TOOL_BUDGET_MS, waitingEvent, whenStopped));
    },
  );

  mcp.registerTool(
    "answer_lookup",
    "status=lookup への答え。選ばれた表現の、その文脈での意味を日本語で表示する。答えたら listen で待ちに戻る。",
    {
      type: "object",
      properties: {
        id: { type: "string", description: "lookup イベントの id" },
        meaning: { type: "string", description: "日本語の意味（その文脈で）。必要なら短い使い方や言い換えも。2〜3 行まで" },
      },
      required: ["id", "meaning"],
    },
    async ({ id, meaning }: { id: string; meaning: string }) =>
      result(answerLookup(id, meaning) ? { ok: true } : { ok: false, error: `unknown id: ${id}` }),
  );

  mcp.registerTool(
    "end_session",
    "セッションを終える。今日のまとめを画面に表示する。",
    {
      type: "object",
      properties: {
        summary: { type: "string", description: "日本語のまとめ（繰り返した誤り、覚えたい表現、調べた表現、よかった点）。改行可" },
      },
      required: ["summary"],
    },
    async ({ summary }: { summary: string }) => {
      micOff();
      setPhase("stopped");
      set({ summary });
      return result({ ok: true });
    },
  );

  return mcp;
}
