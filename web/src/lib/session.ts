// 会話の進行（React に依存しない）。MCP ツールと画面の両方から呼ばれる。

import { deliver, type PageEvent } from "./events";
import { Recognizer, type FinalResult } from "./recognition";
import {
  fieldText,
  get,
  newId,
  savePref,
  set,
  setField,
  type FeedbackItem,
  type FeedbackRef,
  type FeedbackSpan,
  type FieldName,
  type Phase,
} from "./store";
import { loadKokoro, speak as ttsSpeak, stopSpeaking } from "./tts";

// ---------- 状態表示 ----------

export function setPhase(phase: Phase): void {
  set({ phase });
}

// ---------- 読み上げ ----------

export function preloadVoice(): void {
  if (get().ttsEngine !== "kokoro") return;
  const prev = get().phase;
  setPhase("loading");
  void loadKokoro().then((model) => {
    if (!model) set({ ttsEngine: "os" });
    if (get().phase === "loading") setPhase(prev === "loading" ? "idle" : prev);
  });
}

export function speak(text: string): Promise<void> {
  return ttsSpeak(text, get().ttsEngine);
}

// ---------- 音声入力（入力欄を埋めるだけ。送信は自動送信か手動） ----------

type VoiceMeta = {
  used: boolean;
  edited: boolean;
  alternatives: string[];
  lowConfidence: { text: string; confidence: number }[];
};
const freshVoice = (): VoiceMeta => ({ used: false, edited: false, alternatives: [], lowConfidence: [] });
let voice = freshVoice();
let silenceTimer: ReturnType<typeof setTimeout> | undefined;

const activeField = (): FieldName => (get().jaMode ? "memo" : "input");

function onRecognized(finals: FinalResult[], interim: string): void {
  const name = activeField();
  let committed = get().fields[name].committed;
  for (const f of finals) {
    const before = committed;
    committed = `${before}${before ? " " : ""}${f.text}`;
    if (name === "input") {
      voice.used = true;
      // 各区切りの第二候補を、他の区切りは第一候補のまま差し込んで「別の聞こえ方」を作る
      for (const alt of f.alternatives) voice.alternatives.push(`${before}${before ? " " : ""}${alt}`);
      if (f.confidence > 0 && f.confidence < 0.75) {
        voice.lowConfidence.push({ text: f.text, confidence: Number(f.confidence.toFixed(2)) });
      }
    }
  }
  setField(name, { committed, interim });
  clearTimeout(silenceTimer);
  armIdleTimer();
  // 認識途中の文字が残っている間は話し中とみなし、確定分があって無音が続いたら話し終わり
  const s = get();
  if (!s.jaMode && s.autoSend && s.fields.input.committed) {
    silenceTimer = setTimeout(sendReply, s.silence * 1000 + (interim ? 1500 : 0));
  }
}

const recognizer = new Recognizer({
  onResult: onRecognized,
  onError: (message) => set({ hint: message }),
});

// ---------- 返答のヒント（しばらく黙っていたら出す） ----------

const IDLE_BEFORE_SUGGEST_MS = 8000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function inputIsEmpty(): boolean {
  const f = get().fields;
  return !fieldText(f.input).trim() && !fieldText(f.memo).trim();
}

/** 入力が何もないまま一定時間たったらヒントを出す。何か入力があるたびに数え直す */
function armIdleTimer(): void {
  clearTimeout(idleTimer);
  if (get().showSuggestions || !get().suggestions.length) return;
  idleTimer = setTimeout(() => {
    const s = get();
    if (s.phase === "listening" && !s.stopped && inputIsEmpty()) set({ showSuggestions: true });
    else armIdleTimer();
  }, IDLE_BEFORE_SUGGEST_MS);
}

export function setSuggestions(suggestions: string[] = []): void {
  clearTimeout(idleTimer);
  set({ suggestions, showSuggestions: false });
}

/** ヒントを選んだら、日本語メモ（言いたいこと）に入れる。あとは英語で話すだけ */
export function pickSuggestion(text: string): void {
  clearTimeout(idleTimer);
  if (get().jaMode) setJaMode(false);
  setField("memo", { committed: text, interim: "" });
  set({ memoOpen: true, showSuggestions: false, hint: "英語で言ってみましょう" });
}

export function micOn(): void {
  if (get().stopped) return;
  if (!recognizer.available) set({ hint: "このブラウザは音声認識に対応していません（Chrome 推奨）。入力欄を使ってください。" });
  recognizer.lang = get().jaMode ? "ja-JP" : "en-US";
  recognizer.start();
  setPhase("listening");
  armIdleTimer();
}

export function micOff(): void {
  clearTimeout(silenceTimer);
  clearTimeout(idleTimer);
  recognizer.stop();
}

export const micListening = () => recognizer.listening;

/** ユーザーが入力欄を手で編集した */
export function editField(name: FieldName, value: string): void {
  setField(name, { committed: value, interim: "" });
  armIdleTimer();
  if (name === "input") {
    if (voice.used) voice.edited = true;
    clearTimeout(silenceTimer);
    set({ autoSend: false }); // 割り込み: このターンだけ自動送信をオフ
  }
}

export function setAutoSendPref(on: boolean): void {
  savePref("autoSend", String(on));
  set({ autoSendPref: on, autoSend: on });
}

export function clearInput(): void {
  setField("input", { committed: "", interim: "" });
  voice = freshVoice();
  clearTimeout(silenceTimer);
  recognizer.restart();
}

export function clearMemo(): void {
  setField("memo", { committed: "", interim: "" });
  if (!get().jaMode) set({ memoOpen: false });
  recognizer.restart();
}

export function setJaMode(on: boolean): void {
  clearTimeout(silenceTimer);
  set({
    jaMode: on,
    memoOpen: on || get().memoOpen,
    hint: on ? "日本語で伝えたいことを話してください。終わったら EN で英語へ" : "",
  });
  recognizer.lang = on ? "ja-JP" : "en-US";
  recognizer.restart();
}

export function sendReply(): void {
  clearTimeout(silenceTimer);
  if (get().jaMode) setJaMode(false);
  const s = get();
  const text = fieldText(s.fields.input).trim();
  if (!text) return;
  const intent = fieldText(s.fields.memo).trim();
  const event: PageEvent = {
    status: "reply",
    text,
    input: !voice.used ? "typed" : voice.edited ? "voice_edited" : "voice",
  };
  if (voice.used && !voice.edited) {
    event.alternatives = voice.alternatives.filter((a) => a && a !== text).slice(0, 3);
    event.low_confidence_segments = voice.lowConfidence;
  }
  if (intent) event.intent_ja = intent;
  addMessage("me", text, intent || undefined);
  voice = freshVoice();
  set({
    fields: { input: { committed: "", interim: "" }, memo: { committed: "", interim: "" } },
    memoOpen: false,
    autoSend: s.autoSendPref,
    showSuggestions: false,
    hint: "",
  });
  micOff();
  setPhase("thinking");
  deliver(event);
}

// ---------- 停止 ----------

export function stoppedEvent(): PageEvent {
  const lookups = Object.values(get().lookups)
    .filter((l) => l.meaning && !l.translate)
    .map((l) => ({ phrase: l.phrase, meaning: l.meaning }));
  return { status: "stopped", lookups };
}

export function waitingEvent(): PageEvent {
  const f = get().fields;
  return { status: "waiting", user_is_speaking: !!fieldText(f.input).trim() || !!fieldText(f.memo).trim() };
}

export function toggleStop(): void {
  const stopped = !get().stopped;
  set({ stopped });
  if (stopped) {
    micOff();
    stopSpeaking();
    setPhase("stopped");
    deliver(stoppedEvent());
  } else {
    micOn();
  }
}

// ---------- 会話ログ ----------

let lastMineId: string | null = null;

export function addMessage(role: "ai" | "me", text: string, ja?: string): string {
  const id = newId("m");
  set((s) => ({ messages: [...s.messages, { id, role, text, ja, highlights: [] }] }));
  if (role === "me") lastMineId = id;
  return id;
}

/** 指摘された部分（original）を発言の中から探す。見つからなければ null */
function locate(text: string, original: string): [number, number] | null {
  const needle = original.trim().replace(/[.!?。、,]+$/, "");
  if (!needle) return null;
  const start = text.toLowerCase().indexOf(needle.toLowerCase());
  return start < 0 ? null : [start, start + needle.length];
}

export function addFeedback(items: FeedbackItem[] = [], good?: string): void {
  const messageId = lastMineId;
  const msg = get().messages.find((m) => m.id === messageId);
  if (!messageId || !msg) return;
  const cardId = newId("f");
  const spans: FeedbackSpan[] = [];
  const whole: FeedbackRef[] = [];
  const bodyLength = msg.text.replace(/[\s.!?]+$/, "").length;
  items.forEach((it, index) => {
    const ref: FeedbackRef = { cardId, index, type: it.type };
    const at = locate(msg.text, it.original);
    // 見つからない・ほぼ全文・ほかの指摘と重なる → 文全体への指摘として扱う
    const overlaps = at && spans.some((sp) => at[0] < sp.end && sp.start < at[1]);
    if (!at || at[1] - at[0] >= bodyLength * 0.9 || overlaps) whole.push(ref);
    else spans.push({ ...ref, start: at[0], end: at[1] });
  });
  spans.sort((a, b) => a.start - b.start);
  set((s) => ({
    feedback: [{ id: cardId, messageId, said: msg.text, items, good }, ...s.feedback],
    messages: s.messages.map((m) =>
      m.id === messageId ? { ...m, fbSpans: spans, fbWhole: whole, good: items.length === 0 && !!good } : m,
    ),
  }));
}

export function flashMessage(id: string): void {
  set({ flashId: id });
  setTimeout(() => {
    if (get().flashId === id) set({ flashId: null });
  }, 1200);
}

// ---------- 選択した表現の意味（ハイライトは残す） ----------

export function requestLookup(messageId: string, start: number, end: number, rect: DOMRect): void {
  const msg = get().messages.find((m) => m.id === messageId);
  if (!msg) return;
  const phrase = msg.text.slice(start, end).trim();
  if (!phrase || phrase.length > 120) return;
  if (msg.highlights.some((h) => start < h.end && h.start < end)) return; // 既存のハイライトと重なる選択は無視
  const id = newId("l");
  set((s) => ({
    lookups: { ...s.lookups, [id]: { id, messageId, phrase, meaning: null } },
    messages: s.messages.map((m) =>
      m.id === messageId
        ? { ...m, highlights: [...m.highlights, { lookupId: id, start, end }].sort((a, b) => a.start - b.start) }
        : m,
    ),
  }));
  showLookupPopup(id, rect);
  if (!get().stopped) deliver({ status: "lookup", id, phrase, sentence: msg.text });
}

/** 日本語訳が付いていない発言の訳を Claude に頼む（意味調べと同じ仕組みで、文全体を渡す） */
export function requestTranslation(messageId: string): void {
  const msg = get().messages.find((m) => m.id === messageId);
  if (!msg || msg.ja || msg.jaPending || get().stopped) return;
  const id = newId("t");
  set((s) => ({
    lookups: { ...s.lookups, [id]: { id, messageId, phrase: msg.text, meaning: null, translate: true } },
    messages: s.messages.map((m) => (m.id === messageId ? { ...m, jaPending: true } : m)),
  }));
  deliver({ status: "lookup", id, phrase: msg.text, sentence: msg.text, translate: true });
}

export function answerLookup(id: string, meaning: string): boolean {
  const l = get().lookups[id];
  if (!l) return false;
  set((s) => ({
    lookups: { ...s.lookups, [id]: { ...l, meaning } },
    messages: l.translate
      ? s.messages.map((m) => (m.id === l.messageId ? { ...m, ja: meaning, jaPending: false } : m))
      : s.messages,
  }));
  return true;
}

export function showLookupPopup(lookupId: string, rect: DOMRect): void {
  set({ popup: { kind: "lookup", lookupId, x: rect.left, y: rect.bottom + 6 } });
}

export function showFeedbackPopup(refs: FeedbackRef[], rect: DOMRect): void {
  set({ popup: { kind: "feedback", refs, x: rect.left, y: rect.bottom + 6 } });
}

export function hidePopup(): void {
  if (get().popup) set({ popup: null });
}

// ---------- 設定 ----------

export function setTtsEngine(engine: "kokoro" | "os"): void {
  savePref("ttsEngine", engine);
  set({ ttsEngine: engine });
  preloadVoice();
}

export function setSilence(seconds: number): void {
  savePref("silence", String(seconds));
  set({ silence: seconds });
}
