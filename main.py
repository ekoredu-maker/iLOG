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
import webbrowser
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

from backend.api import APP_VERSION, Api
from backend.db import Database


def resource_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def _write_startup_log(db: Database, message: str) -> None:
    """사용자 PC의 화면 엔진 문제를 나중에 확인할 수 있도록 시작 로그를 남긴다."""
    try:
        log_dir = db.data_dir / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / "startup.log").open("a", encoding="utf-8") as f:
            f.write(message.rstrip() + "\n")
    except Exception:
        pass


def _browser_fallback(db: Database, base: Path, cause: Exception) -> None:
    """내장 WebView가 실패하면 로컬 서버 + 기본 브라우저로 같은 iLOG를 실행한다.

    브라우저 모드는 web/db.js의 /api 브리지를 사용하므로 학생자료/평가/백업 등
    핵심 기능은 동일한 Python/SQLite 엔진을 사용한다. 파일 저장만 브라우저 다운로드
    방식으로 동작한다.
    """
    from devserver import Handler

    _write_startup_log(
        db,
        "\n=== embedded webview failed; starting browser fallback ===\n"
        + "".join(traceback.format_exception(type(cause), cause, cause.__traceback__)),
    )

    Handler.api = Api(db, base / "curriculum_packs", desktop=False)
    httpd = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(Handler, directory=str(base / "web")),
    )
    port = int(httpd.server_address[1])
    url = f"http://127.0.0.1:{port}/"
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    try:
        opened = webbrowser.open(url, new=1, autoraise=True)
        if not opened:
            raise RuntimeError("기본 웹 브라우저를 열 수 없습니다.")

        if sys.platform == "win32":
            import ctypes

            ctypes.windll.user32.MessageBoxW(
                None,
                "이 PC에서는 내장 화면 엔진 대신 브라우저 호환 모드로 iLOG를 실행했습니다.\n\n"
                "브라우저에서 iLOG를 사용하세요. 사용을 마치면 이 창의 [확인]을 눌러 종료하면 됩니다.\n\n"
                "학생자료와 백업은 기존 위치를 그대로 사용합니다.",
                "iLOG 브라우저 호환 모드",
                0x40,
            )
        else:
            print(f"iLOG browser mode: {url}")
            try:
                input("종료하려면 Enter를 누르세요... ")
            except EOFError:
                pass
    finally:
        httpd.shutdown()
        httpd.server_close()


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
        # 중요: pywebview 시작 예외가 반드시 "WebView2 미설치"를 뜻하는 것은 아니다.
        # 런타임이 설치되어 있어도 정책/권한/.NET/사용자 프로필 등 환경 차이로
        # 내장 창 생성이 실패할 수 있으므로 자동으로 브라우저 모드로 전환한다.
        try:
            _browser_fallback(db, base, e)
        except Exception as fallback_error:
            _fatal(
                "iLOG 화면을 시작할 수 없습니다.\n\n"
                "내장 화면 엔진과 브라우저 호환 모드가 모두 실패했습니다.\n"
                f"내장 화면 오류: {e}\n"
                f"브라우저 모드 오류: {fallback_error}\n\n"
                f"진단 로그: {db.data_dir / 'logs' / 'startup.log'}"
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
            " css('ilog-neis-plan-import-style','neis_plan_import.css');"
            " css('ilog-assessment-export-style','assessment_export.css');"
            " js('ilog-warm-dashboard-script','dashboard_warm.js');"
            " js('ilog-classroom-warm-script','classroom_warm.js');"
            " js('ilog-academic-warm-script','academic_warm.js');"
            " js('ilog-workdesk-warm-script','workdesk_warm.js');"
            " js('ilog-assessment-studio-script','assessment_studio.js');"
            " js('ilog-neis-plan-import-script','neis_plan_import.js');"
            " js('ilog-assessment-export-script','assessment_export.js');"
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
