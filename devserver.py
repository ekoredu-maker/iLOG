"""개발·테스트용 서버: 같은 화면을 일반 브라우저에서 띄운다.

    python devserver.py  →  http://127.0.0.1:8765
화면은 window.pywebview 가 없으면 /api/<메서드> 로 같은 기능을 호출한다.
(파일 저장은 브라우저 다운로드로 대신한다)
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.api import Api
from backend.db import Database

BASE = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    api: Api = None  # type: ignore

    def log_message(self, fmt, *args):
        if os.environ.get("ILOG_DEV_VERBOSE"):
            super().log_message(fmt, *args)

    def do_GET(self):
        """개발/E2E 브라우저에도 데스크톱과 같은 테마·대시보드 레이어를 적용한다."""
        if self.path in ("/", "/index.html"):
            try:
                html = (BASE / "web" / "index.html").read_text(encoding="utf-8")
                theme = '<link rel="stylesheet" href="theme.css" id="ilog-modern-theme">'
                dash_css = '<link rel="stylesheet" href="dashboard_warm.css" id="ilog-warm-dashboard-style">'
                dash_js = '<script src="dashboard_warm.js" id="ilog-warm-dashboard-script" defer></script>'
                if theme not in html or dash_css not in html or dash_js not in html:
                    inject = f"    {theme}\n    {dash_css}\n    {dash_js}\n"
                    html = html.replace("</head>", inject + "</head>", 1)
                data = html.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            except Exception:
                traceback.print_exc()
        super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/"):
            self.send_error(404)
            return
        name = self.path[len("/api/"):]
        length = int(self.headers.get("Content-Length") or 0)
        try:
            args = json.loads(self.rfile.read(length) or b"[]")
            fn = getattr(self.api, name, None)
            if name.startswith("_") or not callable(fn):
                raise AttributeError(f"없는 기능: {name}")
            body, code = json.dumps({"ok": fn(*args)}, ensure_ascii=False), 200
        except Exception as e:  # 화면에 오류 메시지 전달
            traceback.print_exc()
            body, code = json.dumps({"error": str(e)}, ensure_ascii=False), 400
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run(port: int = 8765, data_dir: str | None = None):
    db = Database(data_dir)
    Handler.api = Api(db, BASE / "curriculum_packs", desktop=False)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(BASE / "web")))
    print(f"아이로그 개발 서버: http://127.0.0.1:{port}  (데이터: {db.path})")
    httpd.serve_forever()


if __name__ == "__main__":
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 8765, sys.argv[2] if len(sys.argv) > 2 else None)
