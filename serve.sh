#!/bin/sh
# ページを http://localhost:5173 で配信する（Vite の開発サーバー。編集はすぐ反映される）
cd "$(dirname "$0")/web" || exit 1
[ -d node_modules ] || npm install
exec npm run dev
