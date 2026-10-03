"""아이로그(iLOG) v10 - 데스크톱 실행 파일 진입점.

화면: web/ (HTML/JS, pywebview 로 표시 - Windows 에서는 Edge WebView2 사용)
데이터: %APPDATA%\iLOG\ilog.db (SQLite) / 자동 백업: %APPDATA%\iLOG\backups
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
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def main() -> None:
    import webview  # type: ignore

    base = resource_dir()
    db = Database()
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
            opts["gui"] = "edgechromium"
        opts["func"] = _startup
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


SELFTEST = os.environ.get("ILOG_SELFTEST")


def _apply_theme(window) -> None:
    """기존 HTML/JS를 건드리지 않고 UI 확장 레이어를 덧씌운다."""
    try:
        window.events.loaded.wait(60)
        window.evaluate_js(
            "(function(){"
            " function css(id,href){ if(document.getElementById(id)) return; const l=document.createElement('link'); l.id=id; l.rel='stylesheet'; l.href=href; document.head.appendChild(l); }"
            " function js(id,src){ if(document.getElementById(id)) return; const s=document.createElement('script'); s.id=id; s.src=src; s.defer=true; document.body.appendChild(s); }"
            " css('ilog-modern-theme','theme.css');"
            " css('ilog-warm-dashboard-style','dashboard_warm.css');"
            " css('ilog-classroom-warm-style','classroom_warm.css');"
            " css('ilog-academic-warm-style','academic_warm.css');"
            " css('ilog-workdesk-warm-style','workdesk_warm.css');"
            " css('ilog-assessment-studio-style','assessment_studio.css');"
            " js('ilog-warm-dashboard-script','dashboard_warm.js');"
            " js('ilog-classroom-warm-script','classroom_warm.js');"
            " js('ilog-academic-warm-script','academic_warm.js');"
            " js('ilog-workdesk-warm-script','workdesk_warm.js');"
            " js('ilog-assessment-studio-script','assessment_studio.js');"
            " return true;"
            "})()"
        )
    except Exception:
        pass


def _startup(window) -> None:
    _apply_theme(window)
    if SELFTEST:
        _selftest(window)


def _write_selftest(result: dict) -> None:
    Path(SELFTEST).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


def _selftest(window) -> None:
    result = {"ok": False}
    try:
        loaded = window.events.loaded.wait(60)
        result["loaded"] = bool(loaded)

        probe_js = (
            "JSON.stringify({"
            "bootstrap: typeof bootstrap !== 'undefined',"
            "calendar: typeof FullCalendar !== 'undefined',"
            "bridge: typeof Bridge !== 'undefined',"
            "desktop: !!(window.pywebview && window.pywebview.api),"
            "statusFn: !!(window.pywebview && window.pywebview.api && typeof window.pywebview.api.status === 'function')"
            "})"
        )
        for _ in range(60):
            try:
                raw = window.evaluate_js(probe_js)
                if raw:
                    page = json.loads(raw) if isinstance(raw, str) else raw
                    result["page"] = page
                    if page.get("bootstrap") and page.get("calendar") and page.get("bridge") and page.get("desktop") and page.get("statusFn"):
                        break
            except Exception as e:
                result["lastError"] = str(e)
            threading.Event().wait(1)

        page = result.get("page") or {}
        if page.get("statusFn"):
            start_api_js = (
                "window.__ilogSelftestStatus = null;"
                "window.__ilogSelftestError = null;"
                "window.pywebview.api.status()"
                ".then(r => { window.__ilogSelftestStatus = JSON.stringify(r); })"
                ".catch(e => { window.__ilogSelftestError = String(e); });"
                "true"
            )
            window.evaluate_js(start_api_js)
            poll_api_js = "JSON.stringify({status: window.__ilogSelftestStatus, error: window.__ilogSelftestError})"
            for _ in range(60):
                try:
                    raw = window.evaluate_js(poll_api_js)
                    if raw:
                        api_state = json.loads(raw) if isinstance(raw, str) else raw
                        if api_state.get("error"):
                            result["apiError"] = api_state["error"]
                            break
                        if api_state.get("status"):
                            result["api"] = json.loads(api_state["status"])
                            break
                except Exception as e:
                    result["apiLastError"] = str(e)
                threading.Event().wait(1)

        try:
            from backend.hwpx_builder import HwpxBuilder
            b = HwpxBuilder()
            b.title("자가 점검")
            b.table([["성명", "홍길동"]], [30, 140])
            result["hwpx"] = len(b.to_bytes()) > 1000
        except Exception as e:
            result["hwpx"] = False
            result["hwpxError"] = repr(e)

        page = result.get("page") or {}
        api_ok = isinstance(result.get("api"), dict)
        result["ok"] = bool(
            loaded
            and page.get("bootstrap")
            and page.get("calendar")
            and page.get("bridge")
            and page.get("desktop")
            and page.get("statusFn")
            and api_ok
            and result.get("hwpx")
        )
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
