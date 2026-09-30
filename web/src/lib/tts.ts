// 読み上げ。Kokoro（ブラウザ内の音声モデル）を優先し、使えなければ OS の音声にする。

const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICE = "af_heart";

type KokoroAudio = { audio: Float32Array; sampling_rate: number };
type Kokoro = { generate(text: string, opts: { voice: string }): Promise<KokoroAudio> };

let kokoro: Kokoro | null = null;
let kokoroLoading: Promise<Kokoro | null> | null = null;
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
/** stopSpeaking のたびに進める。進んだら再生中の読み上げは続きを捨てる */
let generation = 0;

export function loadKokoro(): Promise<Kokoro | null> {
  kokoroLoading ??= (async () => {
    try {
      const { KokoroTTS } = await import(/* @vite-ignore */ KOKORO_URL);
      const webgpu = "gpu" in navigator;
      kokoro = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: webgpu ? "fp32" : "q8",
        device: webgpu ? "webgpu" : "wasm",
      });
      console.log(`[english-talk] Kokoro ready (${webgpu ? "webgpu" : "wasm"})`);
      return kokoro;
    } catch (e) {
      console.warn("[english-talk] Kokoro を読み込めなかったので OS 音声を使います", e);
      return null;
    }
  })();
  return kokoroLoading;
}

export const kokoroReady = () => kokoro !== null;

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

function playBuffer(samples: Float32Array, rate: number): Promise<void> {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  const buf = audioCtx.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  currentSource = src;
  return new Promise((resolve) => {
    src.onended = () => resolve();
    src.start();
  });
}

async function speakKokoro(model: Kokoro, text: string, gen: number): Promise<void> {
  // 1 文ずつ生成し、再生中に次の文を生成して待ち時間を縮める
  const sentences = splitSentences(text);
  let next = model.generate(sentences[0], { voice: KOKORO_VOICE });
  for (let i = 0; i < sentences.length; i++) {
    const audio = await next;
    if (gen !== generation) return;
    if (i + 1 < sentences.length) next = model.generate(sentences[i + 1], { voice: KOKORO_VOICE });
    await playBuffer(audio.audio, audio.sampling_rate);
  }
}

function pickOsVoice(): SpeechSynthesisVoice | undefined {
  const rank = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 4 : 0) +
    (/enhanced/i.test(v.name) ? 3 : 0) +
    (/google us english/i.test(v.name) ? 2 : 0) +
    (v.lang === "en-US" ? 1 : 0);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith("en"))
    .sort((a, b) => rank(b) - rank(a))[0];
}

function speakOs(text: string): Promise<void> {
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

export async function speak(text: string, engine: "kokoro" | "os"): Promise<void> {
  const gen = ++generation;
  if (engine === "kokoro") {
    const model = await loadKokoro();
    if (gen !== generation) return;
    if (model) {
      try {
        return await speakKokoro(model, text, gen);
      } catch (e) {
        console.warn("[english-talk] Kokoro 再生失敗", e);
      }
    }
  }
  return speakOs(text);
}

export function stopSpeaking(): void {
  generation++;
  speechSynthesis.cancel();
  try {
    currentSource?.stop();
  } catch {
    /* 再生していない */
  }
}
