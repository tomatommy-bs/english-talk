#!/bin/sh
# ページを http://localhost:5173 で配信する（マイクは localhost なら使える）
# 編集がすぐ反映されるよう、キャッシュさせない
cd "$(dirname "$0")/web" && exec python3 -c '
import http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
http.server.ThreadingHTTPServer(("127.0.0.1", 5173), H).serve_forever()
'
