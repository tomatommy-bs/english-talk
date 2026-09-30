import { create } from "zustand";

export type Phase = "idle" | "loading" | "speaking" | "listening" | "thinking" | "stopped";
export type FeedbackType = "grammar" | "natural" | "advanced";
export type FeedbackItem = { type: FeedbackType; original: string; better: string; note?: string };
/** AI の発言中でハイライトされた範囲（文字オフセット）。意味は lookups に持つ */
export type Highlight = { lookupId: string; start: number; end: number };
export type Message = {
  id: string;
  role: "ai" | "me";
  text: string;
  /** AI: 日本語訳 / 自分: 先に日本語で書いた言いたいこと */
  ja?: string;
  highlights: Highlight[];
  /** 自分の発言に付く添削の印（❌💬✨👍） */
  marks?: string;
};
export type FeedbackCard = { id: string; messageId: string; said: string; items: FeedbackItem[]; good?: string };
export type Lookup = { id: string; messageId: string; phrase: string; meaning: string | null };
export type FieldName = "input" | "memo";
export type FieldState = { committed: string; interim: string };
export type TtsEngine = "kokoro" | "os";

type State = {
  connected: boolean;
  phase: Phase;
  scenario: string;
  messages: Message[];
  feedback: FeedbackCard[];
  lookups: Record<string, Lookup>;
  popup: { lookupId: string; x: number; y: number } | null;
  fields: Record<FieldName, FieldState>;
  jaMode: boolean;
  memoOpen: boolean;
  /** ユーザーの設定 */
  autoSendPref: boolean;
  /** このターンの実際の値（入力欄を手で触ると一時的に false） */
  autoSend: boolean;
  ttsEngine: TtsEngine;
  silence: number;
  stopped: boolean;
  summary: string | null;
  hint: string;
  flashId: string | null;
  /** 返答のヒント（日本語）。しばらく黙っていると表示する */
  suggestions: string[];
  showSuggestions: boolean;
};

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 保存できなくても動く */
  }
}

const autoSendPref = loadPref("autoSend", "true") === "true";

export const useStore = create<State>(() => ({
  connected: false,
  phase: "idle",
  scenario: "",
  messages: [],
  feedback: [],
  lookups: {},
  popup: null,
  fields: { input: { committed: "", interim: "" }, memo: { committed: "", interim: "" } },
  jaMode: false,
  memoOpen: false,
  autoSendPref,
  autoSend: autoSendPref,
  ttsEngine: loadPref("ttsEngine", "kokoro") === "os" ? "os" : "kokoro",
  silence: Number(loadPref("silence", "1.8")) || 1.8,
  stopped: false,
  summary: null,
  hint: "",
  flashId: null,
  suggestions: [],
  showSuggestions: false,
}));

export const get = useStore.getState;
export const set = useStore.setState;

/** 入力欄に見えている文字列（確定分 + 認識途中） */
export function fieldText(f: FieldState): string {
  return f.interim ? `${f.committed}${f.committed ? " " : ""}${f.interim}` : f.committed;
}

export function setField(name: FieldName, patch: Partial<FieldState>): void {
  set((s) => ({ fields: { ...s.fields, [name]: { ...s.fields[name], ...patch } } }));
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}${++seq}`;
