// English Talk — ブラウザ側は「口・耳・画面」だけを担当し、会話と添削は Claude Code が行う。
// WebMCP のブリッジはツール呼び出しを 30 秒で打ち切るので、待つツールは 25 秒で一旦返す。

const TOOL_BUDGET_MS = 25_000;
const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICE = "af_heart";

const $ = (id) => document.getElementById(id);
const ui = {
  log: $("log"), interim: $("interim"), fbList: $("fbList"), state: $("state"), mcp: $("mcp"),
  scenario: $("scenario"), ttsEngine: $("ttsEngine"), silence: $("silence"), silenceVal: $("silenceVal"),
  stopBtn: $("stopBtn"), typeForm: $("typeForm"), typeInput: $("typeInput"),
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

// ---------- 聞き取り ----------
// 認識した発話はキューに入れ、listen 系ツールが取り出す。ツールの 25 秒枠をまたいでも発話は失われない。
const utterances = [];
let waiter = null;
let stopped = false;
let micWanted = false;
let recognition = null;
let pending = { finals: [], alternatives: [], lowConfidence: [], startedAt: 0 };
let silenceTimer = null;

function deliver(item) {
  if (waiter) { const w = waiter; waiter = null; w(item); } else utterances.push(item);
}

function resetPending() {
  pending = { finals: [], alternatives: [], lowConfidence: [], startedAt: 0 };
}

function flushUtterance() {
  clearTimeout(silenceTimer);
  if (!pending.finals.length) return;
  const text = pending.finals.join(" ").replace(/\s+/g, " ").trim();
  const item = {
    status: "reply",
    text,
    alternatives: pending.alternatives.filter((a) => a && a !== text).slice(0, 3),
    low_confidence_segments: pending.lowConfidence,
    duration_ms: Date.now() - pending.startedAt,
    input: "voice",
  };
  resetPending();
  ui.interim.textContent = "…";
  addMessage("me", text);
  setState("thinking");
  micOff();
  deliver(item);
}

function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    ui.interim.textContent = "このブラウザは音声認識に対応していません（Chrome 推奨）。下の入力欄を使ってください。";
    return null;
  }
  const r = new SR();
  r.lang = "en-US";
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 3;
  r.onresult = (ev) => {
    if (!pending.startedAt) pending.startedAt = Date.now();
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      if (res.isFinal) {
        const best = res[0];
        pending.finals.push(best.transcript.trim());
        // 各区切りの第二候補を、他の区切りは第一候補のまま差し込んで「別の聞こえ方」を作る
        for (let k = 1; k < res.length; k++) {
          pending.alternatives.push([...pending.finals.slice(0, -1), res[k].transcript.trim()].join(" "));
        }
        if (best.confidence > 0 && best.confidence < 0.75) {
          pending.lowConfidence.push({ text: best.transcript.trim(), confidence: Number(best.confidence.toFixed(2)) });
        }
      } else {
        interim += res[0].transcript;
      }
    }
    ui.interim.textContent = [...pending.finals, interim].join(" ") || "…";
    clearTimeout(silenceTimer);
    // 途中結果が残っている間は話し中とみなし、確定分があって無音が続いたら話し終わり
    if (!interim && pending.finals.length) silenceTimer = setTimeout(flushUtterance, silenceMs());
    else if (interim) silenceTimer = setTimeout(() => { if (pending.finals.length) flushUtterance(); }, silenceMs() + 1500);
  };
  r.onerror = (ev) => {
    if (ev.error === "not-allowed") ui.interim.textContent = "マイクが許可されていません。下の入力欄も使えます。";
    else if (ev.error !== "no-speech" && ev.error !== "aborted") console.warn("[english-talk] recognition error", ev.error);
  };
  // Chrome は無音が続くと勝手に止まるので、聞くべき間は再開する
  r.onend = () => { if (micWanted) try { r.start(); } catch { /* 既に開始済み */ } };
  return r;
}

function micOn() {
  if (stopped) return;
  recognition ??= setupRecognition();
  micWanted = true;
  setState("listening");
  ui.interim.textContent = "…";
  if (recognition) try { recognition.start(); } catch { /* 既に開始済み */ }
}

function micOff() {
  micWanted = false;
  if (recognition) try { recognition.abort(); } catch { /* 未開始 */ }
}

function waitUtterance(deadline) {
  if (stopped) return Promise.resolve({ status: "stopped" });
  if (utterances.length) return Promise.resolve(utterances.shift());
  if (Date.now() >= deadline) return Promise.resolve({ status: "waiting", user_is_speaking: false });
  return new Promise((resolve) => {
    const ms = Math.max(0, deadline - Date.now());
    const t = setTimeout(() => {
      if (waiter === done) waiter = null;
      const speakingNow = pending.finals.length > 0 || ui.interim.textContent !== "…";
      resolve({ status: "waiting", user_is_speaking: speakingNow });
    }, ms);
    const done = (item) => { clearTimeout(t); resolve(item); };
    waiter = done;
  });
}

ui.typeForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = ui.typeInput.value.trim();
  if (!text) return;
  ui.typeInput.value = "";
  resetPending();
  clearTimeout(silenceTimer);
  addMessage("me", text);
  setState("thinking");
  micOff();
  deliver({ status: "reply", text, alternatives: [], low_confidence_segments: [], input: "typed" });
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
    deliver({ status: "stopped" });
  } else {
    utterances.length = 0;
    micOn();
  }
});

// ---------- 画面 ----------
let lastMine = null;

function addMessage(who, text) {
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  const body = document.createElement("span");
  body.textContent = text;
  el.append(body);
  if (who === "ai") {
    const b = document.createElement("button");
    b.className = "replay";
    b.title = "もう一度聞く";
    b.textContent = "🔊";
    b.addEventListener("click", () => speak(text));
    el.append(b);
  } else {
    lastMine = el;
  }
  ui.log.append(el);
  ui.log.scrollTop = ui.log.scrollHeight;
  return el;
}

const TYPE_MARK = { grammar: "❌", natural: "💬", advanced: "✨" };

function renderFeedback(items, good) {
  const target = lastMine;
  if (!target) return;
  if (ui.fbList.querySelector("p.muted")) ui.fbList.innerHTML = "";
  const card = document.createElement("div");
  card.className = "turn";
  const said = document.createElement("div");
  said.className = "said";
  said.textContent = `「${target.querySelector("span").textContent}」`;
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
    utterances.length = 0;
    ui.scenario.textContent = [scenario, level].filter(Boolean).join(" · ");
    if (ui.ttsEngine.value === "kokoro") loadKokoro();
    setState("idle");
    return text({ ok: true, tts: ui.ttsEngine.value, silence_seconds: Number(ui.silence.value) });
  },
);

mcp.registerTool(
  "say_and_listen",
  "① feedback を直前のユーザー発言への指摘として画面に出す（読み上げない）→ ② reply を画面に出して読み上げる → ③ ユーザーが話し終えるまで待ち、書き起こしを返す。" +
    "戻り値の status: reply=ユーザーの発言（text, alternatives=認識の別候補, low_confidence_segments）, " +
    "waiting=25秒以内に発言が終わらなかった（listen を呼んで待ち続ける）, stopped=ユーザーが停止した（end_session を呼ぶ）。",
  {
    type: "object",
    properties: {
      reply: { type: "string", description: "あなたの英語の発話。短く自然に" },
      feedback: FEEDBACK_SCHEMA,
      good: { type: "string", description: "よかった点があれば日本語で一言（任意）" },
    },
    required: ["reply"],
  },
  async ({ reply, feedback, good } = {}) => {
    const deadline = Date.now() + TOOL_BUDGET_MS;
    if (stopped) return text({ status: "stopped" });
    if (feedback?.length || good) renderFeedback(feedback, good);
    micOff();
    addMessage("ai", reply);
    setState("speaking");
    // 読み上げが長引いても 25 秒枠は守る。読み上げ終了後にマイクを開く
    const spoken = speak(reply).then(() => micOn());
    const result = await Promise.race([
      spoken.then(() => waitUtterance(deadline)),
      new Promise((r) => setTimeout(() => {
        // 待ち手を外しておけば、この後の発話はキューに入り、次の listen が受け取る
        waiter = null;
        r({ status: "waiting", user_is_speaking: false });
      }, Math.max(0, deadline - Date.now()))),
    ]);
    return text(result);
  },
);

mcp.registerTool(
  "listen",
  "ユーザーの次の発言を最大25秒待つ。say_and_listen や listen が status=waiting を返したときに呼ぶ。戻り値は say_and_listen と同じ。",
  { type: "object", properties: {} },
  async () => {
    if (!stopped && !micWanted && ui.state.dataset.state !== "speaking" && !utterances.length) micOn();
    return text(await waitUtterance(Date.now() + TOOL_BUDGET_MS));
  },
);

mcp.registerTool(
  "end_session",
  "セッションを終える。今日のまとめを画面に表示する。",
  {
    type: "object",
    properties: {
      summary: { type: "string", description: "日本語のまとめ（繰り返した誤り、覚えたい表現、よかった点）。改行可" },
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
