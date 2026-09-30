# English Talk（PoC）

Claude Code だけを頭脳にして、ブラウザで英会話と添削を行う。
ページは WebMCP（https://webmcp.dev）でツールを公開し、Claude Code がそれを呼び続けて会話する。

```
ブラウザ（読み上げ・音声認識・画面） ⇄ webmcp ブリッジ ⇄ Claude Code（会話・添削）
```

## 使い方

1. Chrome で https://tomatommy-bs.github.io/english-talk/ を開く（音声認識は Chrome 前提）
   - 手元で配信するなら `./serve.sh` → http://localhost:5173
   - 公開ページから手元のブリッジ（localhost）への接続を Chrome が確認してきたら許可する
2. このフォルダで Claude Code を起動し、`.mcp.json` の webmcp サーバーを承認する
   ```sh
   claude
   ```
3. `/english cafe B1` のように始める。初回は Claude がトークンを出すので、ページ右下の青いボタンに貼る
4. あとは話すだけ。止めるときはページの「停止」

ページを再読み込みすると WebMCP の接続が切れるので、トークンを取り直す（Claude に「webmcp のトークンを出して」）。

## 構成

| ファイル | 役割 |
|---|---|
| `web/app.js` | 読み上げ（Kokoro / OS 音声）、音声認識（Web Speech API）、話し終わり判定、WebMCP ツール |
| `web/webmcp.js` | WebMCP ウィジェット（`@jason.today/webmcp@0.1.13` の `src/webmcp.js`） |
| `.claude/commands/english.md` | 会話と添削のルール（Claude への指示） |
| `.mcp.json` / `.claude/settings.json` | webmcp の登録と、ツール呼び出しの自動許可 |
| `logs/` | セッションごとのまとめ |

## ツール

| ツール | 内容 |
|---|---|
| `start_session({scenario, level})` | 画面の初期化 |
| `say_and_listen({reply, reply_ja, feedback, good})` | FB を表示 → reply を読み上げ（reply_ja は「訳」ボタンで表示）→ 次のイベントを待って返す |
| `listen()` | 次のイベントをさらに待つ |
| `answer_lookup({id, meaning})` | 選択された表現の意味をポップアップに表示 |
| `end_session({summary})` | まとめを表示 |

ページから返るイベント: `reply`（発言。`intent_ja` = 先に日本語で書いた言いたいこと）/ `lookup`（表現の意味を知りたい）/ `waiting` / `stopped`。

## ページの操作

- AI の発言の「訳」で日本語訳、一部を選択すると意味をポップアップ（ハイライトは残る）
- 音声は入力欄に入る。「自動送信」がオンなら話し終わりで送信。入力欄を手で触るとそのターンだけ自動送信オフ
- ✕（または Esc）で入力中の内容を消す
- 🇯🇵 で先に日本語で言いたいことを記録 → EN で英語に切り替えて話す

webmcp のブリッジはツール呼び出しを 30 秒で打ち切るため、待つツールは 25 秒で `status: "waiting"` を返し、Claude が `listen` で待ち直す。

## サードパーティ

`web/webmcp.js` は [jasonjmcghee/WebMCP](https://github.com/jasonjmcghee/WebMCP)（MIT License, © 2025 Jason McGhee）のものです。ライセンス全文は `web/webmcp.LICENSE`。
