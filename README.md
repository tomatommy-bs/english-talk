# English Talk（PoC）

Claude Code だけを頭脳にして、ブラウザで英会話と添削を行う。
ページは WebMCP（https://webmcp.dev）でツールを公開し、Claude Code がそれを呼び続けて会話する。

```
ブラウザ（読み上げ・音声認識・画面） ⇄ webmcp ブリッジ ⇄ Claude Code（会話・添削）
```

## 使い方

1. ページを配信する
   ```sh
   ./serve.sh        # http://localhost:5173
   ```
2. Chrome で http://localhost:5173 を開く（音声認識は Chrome 前提）
3. このフォルダで Claude Code を起動し、`.mcp.json` の webmcp サーバーを承認する
   ```sh
   claude
   ```
4. `/english cafe B1` のように始める。初回は Claude がトークンを出すので、ページ右下の青いボタンに貼る
5. あとは話すだけ。止めるときはページの「停止」

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
| `say_and_listen({reply, feedback, good})` | FB を表示 → reply を読み上げ → 発言を待って書き起こしを返す |
| `listen()` | 発言をさらに待つ |
| `end_session({summary})` | まとめを表示 |

webmcp のブリッジはツール呼び出しを 30 秒で打ち切るため、待つツールは 25 秒で `status: "waiting"` を返し、Claude が `listen` で待ち直す。

## サードパーティ

`web/webmcp.js` は [jasonjmcghee/WebMCP](https://github.com/jasonjmcghee/WebMCP)（MIT License, © 2025 Jason McGhee）のものです。ライセンス全文は `web/webmcp.LICENSE`。
