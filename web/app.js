// English Talk — ブラウザ側は「口・耳・画面」だけを担当し、会話と添削は Claude Code が行う。
// WebMCP のブリッジはツール呼び出しを 30 秒で打ち切るので、待つツールは 25 秒で一旦返す。

const TOOL_BUDGET_MS = 25_000;
const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICE = "af_heart";

const $ = (id) => document.getElementById(id);
const ui = {
  log: $("log"), fbList: $("fbList"), state: $("state"), mcp: $("mcp"), hint: $("hint"),
  scenario: $("scenario"), ttsEngine: $("ttsEngine"), silence: $("silence"), silenceVal: $("silenceVal"),
  stopBtn: $("stopBtn"), typeForm: $("typeForm"), typeInput: $("typeInput"), clearBtn: $("clearBtn"),
  autoSend: $("autoSend"), jaBtn: $("jaBtn"), memo: $("memo"), memoInput: $("memoInput"), memoClear: $("memoClear"),
  popup: $("popup"), popupPhrase: $("popupPhrase"), popupBody: $("popupBody"),
  summary: $("summary"), summaryText: $("summaryText"), summaryClose: $("summaryClose"),
};

// ---------- 状態表示 ----------
const STATE_LABEL = {
  idle: "待機中", speaking: "話しています", listening: "聞いています",
  thinking: "考え中…", stopped: "停止中", loading: "音声モデル読み込み中",
};
function setState(s) {
  ui.state.dataset.state = s;
  ui.state.textContent = STATE_LABEL[s] ?? s;
}

// ---------- 設定（ブラウザごとの好み） ----------
function loadPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても動く */ }
}
ui.ttsEngine.value = loadPref("ttsEngine", "kokoro");
ui.silence.value = loadPref("silence", "1.8");
ui.silenceVal.textContent = `${ui.silence.value}s`;
ui.ttsEngine.addEventListener("change", () => {
  savePref("ttsEngine", ui.ttsEngine.value);
  if (ui.ttsEngine.value === "kokoro") loadKokoro();
});
ui.silence.addEventListener("input", () => {
  ui.silenceVal.textContent = `${ui.silence.value}s`;
  savePref("silence", ui.silence.value);
});
const silenceMs = () => Number(ui.silence.value) * 1000;

// ---------- 読み上げ ----------
let kokoro = null;
let kokoroLoading = null;
let audioCtx = null;
let currentSource = null;

function loadKokoro() {
  if (kokoro || kokoroLoading) return kokoroLoading;
  const prev = ui.state.dataset.state;
  setState("loading");
  kokoroLoading = (async () => {
    try {
      const { KokoroTTS } = await import(KOKORO_URL);
      const webgpu = !!navigator.gpu;
      kokoro = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: webgpu ? "fp32" : "q8",
        device: webgpu ? "webgpu" : "wasm",
      });
      console.log(`[english-talk] Kokoro ready (${webgpu ? "webgpu" : "wasm"})`);
    } catch (e) {
      console.warn("[english-talk] Kokoro を読み込めなかったので OS 音声を使います", e);
      ui.ttsEngine.value = "os";
    } finally {
      if (ui.state.dataset.state === "loading") setState(prev === "loading" ? "idle" : prev);
    }
  })();
  return kokoroLoading;
}

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

function playBuffer(samples, rate) {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  const buf = audioCtx.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  currentSource = src;
  return new Promise((resolve) => { src.onended = resolve; src.start(); });
}

async function speakKokoro(text) {
  // 1 文ずつ生成し、再生中に次の文を生成して待ち時間を縮める
  const sentences = splitSentences(text);
  let next = kokoro.generate(sentences[0], { voice: KOKORO_VOICE });
  for (let i = 0; i < sentences.length; i++) {
    const audio = await next;
    if (stopped) return;
    if (i + 1 < sentences.length) next = kokoro.generate(sentences[i + 1], { voice: KOKORO_VOICE });
    await playBuffer(audio.audio, audio.sampling_rate);
  }
}

function pickOsVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const rank = (v) =>
    (/premium/i.test(v.name) ? 4 : 0) + (/enhanced/i.test(v.name) ? 3 : 0) +
    (/google us english/i.test(v.name) ? 2 : 0) + (v.lang === "en-US" ? 1 : 0);
  return voices.sort((a, b) => rank(b) - rank(a))[0];
}

function speakOs(text) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickOsVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    u.onend = u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

async function speak(text) {
  if (ui.ttsEngine.value === "kokoro") {
    await loadKokoro();
    if (kokoro) {
      try { return await speakKokoro(text); } catch (e) { console.warn("[english-talk] Kokoro 再生失敗", e); }
    }
  }
  return speakOs(text);
}


// ---------- ページ → Claude のイベント ----------
// 発言や「意味を調べて」はキューに入れ、listen 系ツールが取り出す。ツールの 25 秒枠をまたいでも失われない。
const events = [];
let waiter = null;
let stopped = false;

function deliver(item) {
  if (waiter) { const w = waiter; waiter = null; w(item); } else events.push(item);
}

function waitEvent(deadline) {
  if (stopped) return Promise.resolve(stoppedEvent());
  if (events.length) return Promise.resolve(events.shift());
  if (Date.now() >= deadline) return Promise.resolve(waitingEvent());
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (waiter === done) waiter = null;
      resolve(waitingEvent());
    }, Math.max(0, deadline - Date.now()));
    const done = (item) => { clearTimeout(t); resolve(item); };
    waiter = done;
  });
}

const waitingEvent = () => ({ status: "waiting", user_is_speaking: !!ui.typeInput.value.trim() || !!ui.memoInput.value.trim() });
const stoppedEvent = () => ({ status: "stopped", lookups: lookupList() });

// ---------- 入力欄（音声は入力欄を埋めるだけ。送信は自動送信か手動） ----------
let micWanted = false;
let recognition = null;
let jaMode = false;
let silenceTimer = null;
// 音声で確定した文字列（入力欄ごと）。ユーザーが手で直したら、その時点の中身を確定分とみなす
const committed = new Map([[ui.typeInput, ""], [ui.memoInput, ""]]);
let voice = freshVoice();

function freshVoice() {
  return { used: false, edited: false, alternatives: [], lowConfidence: [], startedAt: 0 };
}

const targetField = () => (jaMode ? ui.memoInput : ui.typeInput);

function showInField(field, interim) {
  const base = committed.get(field);
  field.value = interim ? `${base}${base ? " " : ""}${interim}` : base;
}

// 自動送信: チェックボックスはユーザーの設定。手で入力欄を触ったターンだけ一時的にオフにする
let autoSendPref = loadPref("autoSend", "true") === "true";
ui.autoSend.checked = autoSendPref;
ui.autoSend.addEventListener("change", () => {
  autoSendPref = ui.autoSend.checked;
  savePref("autoSend", String(autoSendPref));
});

function interruptAutoSend() {
  clearTimeout(silenceTimer);
  ui.autoSend.checked = false;
}

for (const field of [ui.typeInput, ui.memoInput]) {
  field.addEventListener("input", () => {
    committed.set(field, field.value);
    if (field === ui.typeInput) {
      if (voice.used) voice.edited = true;
      interruptAutoSend();
    }
  });
}

function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setHint("このブラウザは音声認識に対応していません（Chrome 推奨）。入力欄を使ってください。");
    return null;
  }
  const r = new SR();
  r.lang = "en-US";
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 3;
  r.onresult = (ev) => {
    const field = targetField();
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      if (!res.isFinal) { interim += res[0].transcript; continue; }
      const best = res[0].transcript.trim();
      const before = committed.get(field);
      committed.set(field, `${before}${before ? " " : ""}${best}`);
      if (field === ui.typeInput) {
        voice.used = true;
        if (!voice.startedAt) voice.startedAt = Date.now();
        // 各区切りの第二候補を、他の区切りは第一候補のまま差し込んで「別の聞こえ方」を作る
        for (let k = 1; k < res.length; k++) {
          voice.alternatives.push(`${before}${before ? " " : ""}${res[k].transcript.trim()}`);
        }
        const c = res[0].confidence;
        if (c > 0 && c < 0.75) voice.lowConfidence.push({ text: best, confidence: Number(c.toFixed(2)) });
      }
    }
    showInField(field, interim.trim());
    clearTimeout(silenceTimer);
    // 途中結果が残っている間は話し中とみなし、確定分があって無音が続いたら話し終わり
    if (!jaMode && ui.autoSend.checked && committed.get(ui.typeInput)) {
      silenceTimer = setTimeout(() => sendReply(), silenceMs() + (interim ? 1500 : 0));
    }
  };
  r.onerror = (ev) => {
    if (ev.error === "not-allowed") setHint("マイクが許可されていません。入力欄も使えます。");
    else if (ev.error !== "no-speech" && ev.error !== "aborted") console.warn("[english-talk] recognition error", ev.error);
  };
  // Chrome は無音が続くと勝手に止まるので、聞くべき間は再開する。言語を切り替えたときもここで開き直す
  r.onend = () => {
    if (!micWanted) return;
    r.lang = jaMode ? "ja-JP" : "en-US";
    try { r.start(); } catch { /* 既に開始済み */ }
  };
  return r;
}

function micOn() {
  if (stopped) return;
  recognition ??= setupRecognition();
  micWanted = true;
  setState("listening");
  if (recognition) {
    recognition.lang = jaMode ? "ja-JP" : "en-US";
    try { recognition.start(); } catch { /* 既に開始済み */ }
  }
}

function micOff() {
  micWanted = false;
  clearTimeout(silenceTimer);
  if (recognition) try { recognition.abort(); } catch { /* 未開始 */ }
}

// 認識途中の音声を捨てて聞き直す（abort すると onend で再開する）
function restartMic() {
  if (micWanted && recognition) try { recognition.abort(); } catch { /* 未開始 */ }
}

function setHint(text) { ui.hint.textContent = text; }

function clearInput() {
  committed.set(ui.typeInput, "");
  ui.typeInput.value = "";
  voice = freshVoice();
  clearTimeout(silenceTimer);
  restartMic();
}

function setJaMode(on) {
  jaMode = on;
  clearTimeout(silenceTimer);
  ui.jaBtn.dataset.on = String(on);
  ui.jaBtn.textContent = on ? "EN" : "🇯🇵";
  ui.jaBtn.title = on ? "英語で話す" : "先に日本語で伝えたいことを記録する";
  if (on) ui.memo.hidden = false;
  setHint(on ? "日本語で伝えたいことを話してください。終わったら EN で英語へ" : "");
  restartMic();
  (on ? ui.memoInput : ui.typeInput).focus({ preventScroll: true });
}

function sendReply() {
  clearTimeout(silenceTimer);
  if (jaMode) setJaMode(false);
  const text = ui.typeInput.value.trim();
  if (!text) return;
  const intent = ui.memoInput.value.trim();
  const item = {
    status: "reply",
    text,
    input: !voice.used ? "typed" : voice.edited ? "voice_edited" : "voice",
  };
  if (voice.used && !voice.edited) {
    item.alternatives = voice.alternatives.filter((a) => a && a !== text).slice(0, 3);
    item.low_confidence_segments = voice.lowConfidence;
  }
  if (intent) item.intent_ja = intent;
  addMessage("me", text, intent);
  committed.set(ui.typeInput, "");
  committed.set(ui.memoInput, "");
  ui.typeInput.value = "";
  ui.memoInput.value = "";
  ui.memo.hidden = true;
  voice = freshVoice();
  ui.autoSend.checked = autoSendPref;
  setState("thinking");
  micOff();
  deliver(item);
}

ui.typeForm.addEventListener("submit", (ev) => { ev.preventDefault(); sendReply(); });
ui.clearBtn.addEventListener("click", clearInput);
ui.typeInput.addEventListener("keydown", (ev) => { if (ev.key === "Escape") clearInput(); });
ui.jaBtn.addEventListener("click", () => setJaMode(!jaMode));
ui.memoClear.addEventListener("click", () => {
  committed.set(ui.memoInput, "");
  ui.memoInput.value = "";
  if (!jaMode) ui.memo.hidden = true;
  restartMic();
});

ui.stopBtn.addEventListener("click", () => {
  stopped = !stopped;
  ui.stopBtn.dataset.stopped = String(stopped);
  ui.stopBtn.textContent = stopped ? "再開" : "停止";
  if (stopped) {
    micOff();
    speechSynthesis.cancel();
    try { currentSource?.stop(); } catch { /* 再生していない */ }
    setState("stopped");
    deliver(stoppedEvent());
  } else {
    events.length = 0;
    micOn();
  }
});

// ---------- 会話ログ ----------
let lastMine = null;

function addMessage(who, text, sub) {
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  const body = document.createElement("span");
  body.className = "text";
  body.textContent = text;
  el.append(body);
  if (who === "ai") {
    const tools = document.createElement("span");
    tools.className = "tools";
    const replay = document.createElement("button");
    replay.title = "もう一度聞く";
    replay.textContent = "🔊";
    replay.addEventListener("click", () => speak(text));
    tools.append(replay);
    if (sub) {
      const ja = document.createElement("div");
      ja.className = "ja";
      ja.textContent = sub;
      ja.hidden = true;
      const tr = document.createElement("button");
      tr.title = "日本語訳";
      tr.textContent = "訳";
      tr.addEventListener("click", () => {
        ja.hidden = !ja.hidden;
        tr.dataset.on = String(!ja.hidden);
      });
      tools.append(tr);
      el.append(tools, ja);
    } else {
      el.append(tools);
    }
  } else {
    if (sub) {
      const intent = document.createElement("div");
      intent.className = "intent";
      intent.textContent = `🇯🇵 ${sub}`;
      el.append(intent);
    }
    lastMine = el;
  }
  ui.log.append(el);
  ui.log.scrollTop = ui.log.scrollHeight;
  return el;
}

// ---------- 選択した表現の意味（ハイライトは残す） ----------
const lookups = new Map(); // id → { mark, phrase, meaning }
let lookupSeq = 0;
let popupFor = null;

function lookupList() {
  return [...lookups.values()].filter((l) => l.meaning).map((l) => ({ phrase: l.phrase, meaning: l.meaning }));
}

function showPopup(id) {
  const l = lookups.get(id);
  if (!l) return;
  popupFor = id;
  ui.popupPhrase.textContent = l.phrase;
  ui.popupBody.textContent = l.meaning ?? (stopped ? "停止中は調べられません" : "調べています…");
  ui.popup.hidden = false;
  const r = l.mark.getBoundingClientRect();
  const w = ui.popup.offsetWidth;
  ui.popup.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  ui.popup.style.top = `${r.bottom + 6}px`;
}

function hidePopup() {
  ui.popup.hidden = true;
  popupFor = null;
}

ui.log.addEventListener("mouseup", () => {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const host = range.commonAncestorContainer.parentElement?.closest(".msg.ai .text");
  const phrase = sel.toString().trim();
  if (!host || !phrase || phrase.length > 120) return;
  const mark = document.createElement("mark");
  try {
    range.surroundContents(mark); // 既存のハイライトをまたぐ選択は包めないので無視する
  } catch {
    return;
  }
  sel.removeAllRanges();
  const id = `l${++lookupSeq}`;
  mark.dataset.id = id;
  mark.className = "hl pending";
  lookups.set(id, { mark, phrase, meaning: null });
  showPopup(id);
  if (!stopped) deliver({ status: "lookup", id, phrase, sentence: host.textContent });
});

ui.log.addEventListener("click", (ev) => {
  const mark = ev.target.closest("mark.hl");
  if (mark) { ev.stopPropagation(); showPopup(mark.dataset.id); }
});
document.addEventListener("mousedown", (ev) => {
  if (!ui.popup.hidden && !ui.popup.contains(ev.target) && !ev.target.closest("mark.hl")) hidePopup();
});
ui.log.addEventListener("scroll", hidePopup);

// ---------- フィードバック ----------
const TYPE_MARK = { grammar: "❌", natural: "💬", advanced: "✨" };

function renderFeedback(items, good) {
  const target = lastMine;
  if (!target) return;
  if (ui.fbList.querySelector("p.muted")) ui.fbList.innerHTML = "";
  const card = document.createElement("div");
  card.className = "turn";
  const said = document.createElement("div");
  said.className = "said";
  said.textContent = `「${target.querySelector(".text").textContent}」`;
  card.append(said);
  for (const it of items ?? []) {
    const row = document.createElement("div");
    row.className = "item";
    row.dataset.type = it.type;
    const mark = document.createElement("span");
    mark.textContent = `${TYPE_MARK[it.type] ?? "•"} `;
    const from = document.createElement("span");
    from.className = "from";
    from.textContent = it.original;
    const to = document.createElement("span");
    to.className = "to";
    to.textContent = it.better;
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = it.note ?? "";
    row.append(mark, from, document.createTextNode(" → "), to, note);
    card.append(row);
  }
  if (good) {
    const g = document.createElement("div");
    g.className = "good";
    g.textContent = `👍 ${good}`;
    card.append(g);
  }
  card.addEventListener("click", () => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("flash");
    setTimeout(() => target.classList.remove("flash"), 1200);
  });
  ui.fbList.prepend(card);
  const marks = document.createElement("div");
  marks.className = "marks";
  marks.textContent = (items ?? []).map((it) => TYPE_MARK[it.type] ?? "•").join("") || "👍";
  target.append(marks);
}

ui.summaryClose.addEventListener("click", () => { ui.summary.hidden = true; });

// ---------- WebMCP ツール ----------
const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] });

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
      type: { type: "string", enum: ["grammar", "natural", "advanced"], description: "grammar=文法の誤り, natural=より自然な表現, advanced=上級の言い回し" },
      original: { type: "string", description: "ユーザーが言った該当部分" },
      better: { type: "string", description: "直した言い方" },
      note: { type: "string", description: "日本語で一言の理由" },
    },
    required: ["type", "original", "better"],
  },
};

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
  async ({ scenario, level } = {}) => {
    stopped = false;
    ui.stopBtn.dataset.stopped = "false";
    ui.stopBtn.textContent = "停止";
    events.length = 0;
    ui.scenario.textContent = [scenario, level].filter(Boolean).join(" · ");
    if (ui.ttsEngine.value === "kokoro") loadKokoro();
    setState("idle");
    return text({ ok: true, tts: ui.ttsEngine.value, silence_seconds: Number(ui.silence.value), auto_send: autoSendPref });
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
  async ({ reply, reply_ja, feedback, good } = {}) => {
    const deadline = Date.now() + TOOL_BUDGET_MS;
    if (stopped) return text(stoppedEvent());
    if (feedback?.length || good) renderFeedback(feedback, good);
    micOff();
    addMessage("ai", reply, reply_ja);
    setState("speaking");
    // 読み上げが長引いても 25 秒枠は守る。読み上げ終了後にマイクを開く
    const spoken = speak(reply).then(() => micOn());
    const result = await Promise.race([
      spoken.then(() => waitEvent(deadline)),
      new Promise((r) => setTimeout(() => {
        // 待ち手を外しておけば、この後のイベントはキューに入り、次の listen が受け取る
        waiter = null;
        r(waitingEvent());
      }, Math.max(0, deadline - Date.now()))),
    ]);
    return text(result);
  },
);

mcp.registerTool(
  "listen",
  "ユーザーの次のイベントを最大25秒待つ。status=waiting のあとや、answer_lookup のあとに呼ぶ。" + EVENT_DOC,
  { type: "object", properties: {} },
  async () => {
    if (!stopped && !micWanted && ui.state.dataset.state !== "speaking" && !events.length) micOn();
    return text(await waitEvent(Date.now() + TOOL_BUDGET_MS));
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
  async ({ id, meaning } = {}) => {
    const l = lookups.get(id);
    if (!l) return text({ ok: false, error: `unknown id: ${id}` });
    l.meaning = meaning;
    l.mark.classList.remove("pending");
    l.mark.title = meaning;
    if (popupFor === id) showPopup(id);
    return text({ ok: true });
  },
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
  async ({ summary } = {}) => {
    micOff();
    setState("stopped");
    ui.summaryText.textContent = summary;
    ui.summary.hidden = false;
    return text({ ok: true });
  },
);

// 接続状態の表示（ウィジェットの内部状態を見る）
setInterval(() => {
  ui.mcp.dataset.ok = String(!!mcp.isConnected);
  ui.mcp.textContent = mcp.isConnected ? "WebMCP 接続中" : "WebMCP 未接続";
}, 1000);

if (ui.ttsEngine.value === "kokoro") loadKokoro();
