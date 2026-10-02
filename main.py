"""아이로그(iLOG) v10 - 데스크톱 실행 파일 진입점.

화면: web/ (HTML/JS, pywebview 로 표시 - Windows 에서는 Edge WebView2 사용)
데이터: %APPDATA%\\iLOG\\ilog.db (SQLite) / 자동 백업: %APPDATA%\\iLOG\\backups
Copyright 2026@박주가리교감
"""
from __future__ import annotations

import json
import os
import sys
import threading
import traceback
from pathlib import Path

from backend.api import APP_VERSION, Api
from backend.db import Database


def resource_dir() -> Path:
    # PyInstaller 로 묶였을 때는 임시 폴더(_MEIPASS)에 자원이 풀린다
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def main() -> None:
    import webview  # type: ignore

    base = resource_dir()
    db = Database()  # 자동 백업은 로그인(잠금 해제) 후에 실행됨
    api = Api(db, base / "curriculum_packs", desktop=True)
    window = webview.create_window(
        f"아이로그 iLOG v{APP_VERSION}",
        str(base / "web" / "index.html"),
        js_api=api,
        width=1440,
        height=900,
        min_size=(1024, 680),
        confirm_close=False,
    )
    api._set_window(window)
    try:
        opts = dict(http_server=True, private_mode=False, storage_path=str(db.data_dir / "webview"))
        if sys.platform == "win32":
            opts["gui"] = "edgechromium"  # 옛 IE 엔진으로 떨어지지 않도록 Edge WebView2 를 강제
        if SELFTEST:
            opts["func"] = _selftest
            opts["args"] = (window,)
        webview.start(**opts)
    except Exception as e:
        _fatal(
            "화면 엔진(Microsoft Edge WebView2)을 시작할 수 없습니다.\n\n"
            "아래 주소에서 'Evergreen 부트스트래퍼'를 설치한 뒤 다시 실행해 주세요.\n"
            "https://developer.microsoft.com/microsoft-edge/webview2/\n\n"
            f"(자세한 내용: {e})"
        )
    finally:
        db.close()


# ---------------------------------------------------------------- 자가 점검
# ILOG_SELFTEST=결과파일경로 로 실행하면 창을 띄워 화면·파이썬 연결을 확인하고 결과를 쓴 뒤 종료한다.
SELFTEST = os.environ.get("ILOG_SELFTEST")


def _write_selftest(result: dict) -> None:
    Path(SELFTEST).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


def _selftest(window) -> None:
    result = {"ok": False}
    try:
        loaded = window.events.loaded.wait(60)
        result["loaded"] = bool(loaded)
        js = ("(async () => { await Bridge.ready(); const st = await api.status(); "
              "return JSON.stringify({bootstrap: typeof bootstrap !== 'undefined', calendar: typeof FullCalendar !== 'undefined', "
              "desktop: Bridge.isDesktop(), status: st}); })()")
        for _ in range(60):
            try:
                raw = window.evaluate_js(js)
                if raw:
                    result["page"] = json.loads(raw) if isinstance(raw, str) else raw
                    break
            except Exception as e:  # 아직 준비 중
                result["lastError"] = str(e)
            threading.Event().wait(1)
        page = result.get("page") or {}
        try:  # 한글 서식 엔진(묶음 데이터 파일 포함) 동작 확인
            from backend.hwpx_builder import HwpxBuilder
            b = HwpxBuilder()
            b.title("자가 점검")
            b.table([["성명", "홍길동"]], [30, 140])
            result["hwpx"] = len(b.to_bytes()) > 1000
        except Exception as e:
            result["hwpx"] = False
            result["hwpxError"] = repr(e)
        result["ok"] = bool(loaded and page.get("bootstrap") and page.get("calendar") and page.get("desktop") and result.get("hwpx"))
    except Exception as e:
        result["error"] = repr(e)
    finally:
        _write_selftest(result)
        window.destroy()


def _fatal(message: str) -> None:
    traceback.print_exc()
    if SELFTEST:
        _write_selftest({"ok": False, "error": message})
        return
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "아이로그 실행 오류", 0x10)
    else:
        print(message, file=sys.stderr)


if __name__ == "__main__":
    main()
