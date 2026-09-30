# English Talk（PoC）

Claude Code だけを頭脳にして、ブラウザで英会話と添削を行う。
ページは WebMCP（https://webmcp.dev）でツールを公開し、Claude Code がそれを呼び続けて会話する。

```
ブラウザ（読み上げ・音声認識・画面） ⇄ webmcp ブリッジ ⇄ Claude Code（会話・添削）
```

## 使い方

使い方は 2 通りあります。どちらも **Claude Code は手元で動かし**、ページは Chrome で開きます。違うのはページの置き場所だけです。

| | A. clone してローカルで起動 | B. GitHub Pages につなぐ |
|---|---|---|
| ページ | 手元で配信（http://localhost:5173） | https://tomatommy-bs.github.io/english-talk/ |
| 手元に必要なもの | このリポジトリ一式 | 設定ファイル 3 つだけ |
| 向いている人 | ページを改造したい | 使うだけでいい |

### 共通の前提

- [Claude Code](https://claude.com/claude-code)（サブスクで使える。API キーは不要）
- Node.js（`npx` で webmcp ブリッジを起動する）
- Chrome（音声認識に Web Speech API を使う）

### A. clone してローカルで起動

**セットアップ（初回のみ）**

```sh
git clone https://github.com/tomatommy-bs/english-talk.git
cd english-talk
```

webmcp の登録（`.mcp.json`）、`/english` コマンド、ツール呼び出しの自動許可（`.claude/settings.json`）はリポジトリに入っているので、追加の設定は要りません。
ページは Vite + React で書かれていて、初回の `./serve.sh` で依存パッケージを入れます（Node.js 20.19 以上）。

**毎回の手順**

1. ページを配信する（別ターミナルで。止めるときは Ctrl+C）
   ```sh
   ./serve.sh        # web/ で npm run dev と同じ。編集はすぐ画面に反映される
   ```
2. Chrome で http://localhost:5173 を開く
3. リポジトリのフォルダで Claude Code を起動し、会話を始める
   ```sh
   claude
   > /english cafe B1
   ```
   初回はフォルダの信頼と webmcp サーバーの承認を聞かれるので許可する。
4. Claude がトークンを出すので、ページ右下の青いボタンを押して貼り、Connect
5. ヘッダーに「WebMCP 接続中」と出たら、あとは話すだけ。やめるときはページの「停止」

### B. GitHub Pages につなぐ

ページは公開済みのものを使い、手元には Claude Code 用の設定だけを置きます。
設定はフォルダ単位なので、ほかのプロジェクトには影響しません。

**セットアップ（初回のみ）**

好きな場所に作業フォルダを作り、次の 3 ファイルを置きます。

```sh
mkdir -p ~/english-talk && cd ~/english-talk
mkdir -p .claude/commands

# 1. webmcp ブリッジを MCP サーバーとして登録
cat > .mcp.json <<'EOF'
{
  "mcpServers": {
    "webmcp": {
      "command": "npx",
      "args": ["-y", "@jason.today/webmcp@0.1.13", "--mcp"]
    }
  }
}
EOF

# 2. webmcp を有効化し、ツール呼び出しを毎回確認しないようにする
cat > .claude/settings.json <<'EOF'
{
  "enabledMcpjsonServers": ["webmcp"],
  "permissions": {
    "allow": ["mcp__webmcp"]
  }
}
EOF

# 3. /english コマンド（会話と添削のルール）
curl -fsSL -o .claude/commands/english.md \
  https://raw.githubusercontent.com/tomatommy-bs/english-talk/main/.claude/commands/english.md
```

`/english` のルールが更新されたら、3 の `curl` をもう一度実行すると最新になります。

**毎回の手順**

1. Chrome で https://tomatommy-bs.github.io/english-talk/ を開く
2. 作業フォルダで Claude Code を起動し、会話を始める
   ```sh
   cd ~/english-talk
   claude
   > /english cafe B1
   ```
   初回はフォルダの信頼と webmcp サーバーの承認を聞かれるので許可する。
3. Claude がトークンを出すので、ページ右下の青いボタンを押して貼り、Connect
4. **Chrome がローカルネットワークへのアクセス許可を求めてきたら許可する**。公開ページから手元のブリッジ（`localhost:4797`）につなぐために必要です。
   確認が出ないまま「Registering...」で止まる場合は、アドレスバー左のアイコン → サイトの設定で「ローカルネットワークへのアクセス」を許可し、もう一度 Connect を押す。
5. ヘッダーに「WebMCP 接続中」と出たら、あとは話すだけ。やめるときはページの「停止」

### 困ったとき

- **ページを再読み込みすると接続が切れる**：Claude に「webmcp のトークンを出して」と頼み、もう一度貼る
- **Claude がサーバーを探し始めた**：`/english` のルールが古い可能性がある。B なら `curl` で取り直す
- **応答が遅い**：Claude Code の `/model` で Sonnet や Haiku に切り替えると速くなる
- **会話のまとめ**：終了時に、Claude Code を起動したフォルダの `logs/<日付>.md` に追記される

## 構成

ページは `web/`（Vite + React + TypeScript + Tailwind CSS）。GitHub Pages へは Actions がビルドして公開する。

| ファイル | 役割 |
|---|---|
| `web/src/lib/tools.ts` | WebMCP で公開するツール |
| `web/src/lib/session.ts` | 会話の進行（音声入力、送信、フィードバック、意味調べ、停止） |
| `web/src/lib/events.ts` | ページ → Claude のイベントキュー（ツールの待ち時間をまたいでも失わない） |
| `web/src/lib/recognition.ts` / `tts.ts` | 音声認識（Web Speech API）/ 読み上げ（Kokoro、OS 音声） |
| `web/src/lib/store.ts` | 画面の状態（zustand） |
| `web/src/components/` | 画面（ヘッダー、会話ログ、入力欄、フィードバック、意味のポップアップ、まとめ） |
| `web/public/webmcp.js` | WebMCP ウィジェット（`@jason.today/webmcp@0.1.13` の `src/webmcp.js`） |
| `.claude/commands/english.md` | 会話と添削のルール（Claude への指示） |
| `.mcp.json` / `.claude/settings.json` | webmcp の登録と、ツール呼び出しの自動許可 |
| `logs/` | セッションごとのまとめ |

## ツール

| ツール | 内容 |
|---|---|
| `start_session({scenario, level})` | 画面の初期化 |
| `say_and_listen({reply, reply_ja, feedback, good, suggestions_ja})` | FB を表示 → reply を読み上げ（reply_ja は「訳」ボタンで表示）→ 次のイベントを待って返す。suggestions_ja は黙っていると出る返答のヒント |
| `listen()` | 次のイベントをさらに待つ |
| `answer_lookup({id, meaning})` | 選択された表現の意味をポップアップに表示 |
| `end_session({summary})` | まとめを表示 |

ページから返るイベント: `reply`（発言。`intent_ja` = 先に日本語で書いた言いたいこと）/ `lookup`（表現の意味を知りたい）/ `waiting` / `stopped`。

## ページの操作

- AI の発言の「訳」で日本語訳、一部を選択すると意味をポップアップ（ハイライトは残る）
- 音声は入力欄に入る。「自動送信」がオンなら話し終わりで送信。入力欄を手で触るとそのターンだけ自動送信オフ
- ✕（または Esc）で入力中の内容を消す
- 🇯🇵 で先に日本語で言いたいことを記録 → EN で英語に切り替えて話す
- 8 秒ほど黙っていると 💡 返答のヒント（日本語）が出る。選ぶと日本語メモに入るので、それを英語で言う

webmcp のブリッジはツール呼び出しを 30 秒で打ち切るため、待つツールは 25 秒で `status: "waiting"` を返し、Claude が `listen` で待ち直す。

## サードパーティ

`web/public/webmcp.js` は [jasonjmcghee/WebMCP](https://github.com/jasonjmcghee/WebMCP)（MIT License, © 2025 Jason McGhee）のものです。ライセンス全文は `web/public/webmcp.LICENSE`。
