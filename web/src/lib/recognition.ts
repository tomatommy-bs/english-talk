// 音声認識（Chrome の Web Speech API）の薄いラッパー。
// Chrome は無音が続くと勝手に止まるので、聞くべき間は自動で再開する。

export type FinalResult = { text: string; alternatives: string[]; confidence: number };

type Handlers = {
  /** 新しく確定した区切りと、現在の認識途中の文字列 */
  onResult(finals: FinalResult[], interim: string): void;
  onError(message: string): void;
};

type SRAlternative = { transcript: string; confidence: number };
type SRResult = { isFinal: boolean; length: number; [i: number]: SRAlternative };
type SREvent = { resultIndex: number; results: { length: number; [i: number]: SRResult } };
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SREvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};

export class Recognizer {
  private sr: SR | null;
  private wanted = false;
  lang = "en-US";

  constructor(private handlers: Handlers) {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    this.sr = Ctor ? new Ctor() : null;
    if (!this.sr) return;
    const sr = this.sr;
    sr.continuous = true;
    sr.interimResults = true;
    sr.maxAlternatives = 3;
    sr.onresult = (ev) => {
      const finals: FinalResult[] = [];
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (!res.isFinal) {
          interim += res[0].transcript;
          continue;
        }
        const alternatives: string[] = [];
        for (let k = 1; k < res.length; k++) alternatives.push(res[k].transcript.trim());
        finals.push({ text: res[0].transcript.trim(), alternatives, confidence: res[0].confidence });
      }
      this.handlers.onResult(finals, interim.trim());
    };
    sr.onerror = (ev) => {
      if (ev.error === "not-allowed") this.handlers.onError("マイクが許可されていません。入力欄も使えます。");
      else if (ev.error !== "no-speech" && ev.error !== "aborted") console.warn("[english-talk] recognition error", ev.error);
    };
    sr.onend = () => {
      if (!this.wanted) return;
      sr.lang = this.lang;
      try {
        sr.start();
      } catch {
        /* 既に開始済み */
      }
    };
  }

  get available(): boolean {
    return this.sr !== null;
  }

  get listening(): boolean {
    return this.wanted;
  }

  start(): void {
    this.wanted = true;
    if (!this.sr) return;
    this.sr.lang = this.lang;
    try {
      this.sr.start();
    } catch {
      /* 既に開始済み */
    }
  }

  stop(): void {
    this.wanted = false;
    try {
      this.sr?.abort();
    } catch {
      /* 未開始 */
    }
  }

  /** 認識途中の音声を捨てて聞き直す（言語の切り替えにも使う） */
  restart(): void {
    if (!this.wanted) return;
    try {
      this.sr?.abort();
    } catch {
      /* 未開始 */
    }
  }
}
