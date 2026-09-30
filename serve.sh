#!/bin/sh
# ページを http://localhost:5173 で配信する（マイクは localhost なら使える）
cd "$(dirname "$0")/web" && exec python3 -m http.server 5173 --bind 127.0.0.1
