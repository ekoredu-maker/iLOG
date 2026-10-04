"""아이로그(iLOG) v10 - 데스크톱 실행 파일 진입점.

화면: 로컬 HTTP 서버가 web/ 화면을 제공하고 pywebview 또는 기본 브라우저가 표시
데이터: %APPDATA%\iLOG\ilog.db (SQLite) / 자동 백업: %APPDATA%\iLOG\backups
Copyright 2026@박주가리교감
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
import traceback
import webbrowser
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

from backend.api import APP_VERSION, Api
from backend.curriculum_batch import apply_national_batch
from backend.db import Database
from devserver import Handler


SELFTEST = os.environ.get("ILOG_SELFTEST")
_UI_FAILURE: Exception | None = None
_SINGLE_INSTANCE_HANDLE = None


def resource_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def _write_startup_log(db: Database, message: str) -> None:
    try:
        log_dir = db.data_dir / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / "startup.log").open("a", encoding="utf-8") as f:
            f.write(message.rstrip() + "\n")
    except Exception:
        pass


def _write_runtime_log(data_dir: Path, title: str, exc: Exception) -> None:
    try:
        log_dir = data_dir / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / "runtime.log").open("a", encoding="utf-8") as f:
            f.write(f"\n=== {title} ===\n")
            f.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
    except Exception:
        pass


def _acquire_single_instance() -> bool:
    """Windows 배포본이 같은 DB를 두 프로세스에서 동시에 열지 않도록 막는다."""
    global _SINGLE_INSTANCE_HANDLE
    if sys.platform != "win32" or SELFTEST:
        return True
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, "Local\\iLOG_Desktop_SingleInstance_v10")
        if not handle:
            return True
        if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            kernel32.CloseHandle(handle)
            ctypes.windll.user32.MessageBoxW(
                None,
                "iLOG가 이미 실행 중입니다.\n\n"
                "기존 iLOG 창을 먼저 확인해 주세요. 프로그램이 멈춘 경우에는 작업 관리자에서 "
                "iLOG.exe를 종료한 뒤 다시 실행하세요.",
                "아이로그 iLOG",
                0x40,
            )
            return False
        _SINGLE_INSTANCE_HANDLE = handle
        return True
    except Exception:
        # 뮤텍스 생성 실패가 프로그램 실행 자체를 막지는 않게 한다.
        return True


def _release_single_instance() -> None:
    global _SINGLE_INSTANCE_HANDLE
    if sys.platform == "win32" and _SINGLE_INSTANCE_HANDLE:
        try:
            import ctypes
            ctypes.windll.kernel32.CloseHandle(_SINGLE_INSTANCE_HANDLE)
        except Exception:
            pass
        _SINGLE_INSTANCE_HANDLE = None


class DesktopApi(Api):
    """데스크톱에서 큰 파일/대량 데이터를 JS 왕복 없이 처리하는 빠른 경로."""

    def curriculum_apply_national_batch(self, grade, subjects, overwrite=False):
        try:
            return apply_national_batch(self._db, self._lib, grade, subjects, bool(overwrite))
        except Exception as e:
            _write_runtime_log(self._db.data_dir, "national curriculum batch", e)
            raise

    def build_and_save_file(self, kind, params=None):
        """파일을 Python 안에서 생성→저장한다. 큰 HWPX의 base64 JS 왕복을 피한다."""
        try:
            built = self.build_file(kind, params or {})
            return self.save_file(built["filename"], built["b64"], True)
        except Exception as e:
            _write_runtime_log(self._db.data_dir, f"build and save: {kind}", e)
            raise


def _start_ui_server(base: Path):
    """최신 UI 확장 레이어를 매 요청마다 포함해 제공하는 로컬 서버를 시작한다.

    복구/초기화 후 location.reload()가 일어나도 devserver.Handler가 같은 최신 UI를
    다시 주입하므로 Python 쪽 loaded 이벤트에 의존하지 않는다.
    """
    Handler.api = None  # 내장 창에서는 pywebview JS API가 준비될 때까지 HTTP API를 쓰지 않는다.
    httpd = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(Handler, directory=str(base / "web")),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    port = int(httpd.server_address[1])
    return httpd, f"http://127.0.0.1:{port}/"


def _run_browser_mode(db: Database, base: Path, url: str, cause: Exception) -> None:
    """내장 화면이 실패하거나 흰 화면으로 판정되면 기본 브라우저로 전환한다."""
    Handler.api = Api(db, base / "curriculum_packs", desktop=False)
    _write_startup_log(
        db,
        "\n=== embedded UI failed; browser mode started ===\n"
        + "".join(traceback.format_exception(type(cause), cause, cause.__traceback__)),
    )

    opened = webbrowser.open(url, new=1, autoraise=True)
    if not opened:
        raise RuntimeError("기본 웹 브라우저를 열 수 없습니다.")

    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            None,
            "내장 창 대신 브라우저 호환 모드로 iLOG를 실행했습니다.\n\n"
            "브라우저에서 iLOG를 사용하세요. 이 안내창은 사용 중에는 닫지 말고, "
            "iLOG 사용을 마친 뒤 [확인]을 눌러 종료하세요.\n\n"
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


def _check_normal_ui(window) -> None:
    """엔진이 예외 없이 흰 창만 띄우는 경우까지 감지한다."""
    global _UI_FAILURE
    try:
        loaded = window.events.loaded.wait(20)
        if not loaded:
            raise RuntimeError("화면 문서 로드가 20초 안에 완료되지 않았습니다.")

        probe = (
            "JSON.stringify({"
            "body: !!document.body,"
            "login: !!document.getElementById('login-overlay'),"
            "bridge: typeof Bridge !== 'undefined',"
            "bootstrap: typeof bootstrap !== 'undefined',"
            "upgradedUi: !!document.getElementById('ilog-assessment-studio-script')"
            "})"
        )
        last = None
        for _ in range(80):
            try:
                raw = window.evaluate_js(probe)
                if raw:
                    page = json.loads(raw) if isinstance(raw, str) else raw
                    last = page
                    if (
                        page.get("body")
                        and page.get("login")
                        and page.get("bridge")
                        and page.get("bootstrap")
                        and page.get("upgradedUi")
                    ):
                        return
            except Exception as e:
                last = repr(e)
            threading.Event().wait(0.1)
        raise RuntimeError(f"내장 화면이 정상 UI를 만들지 못했습니다: {last}")
    except Exception as e:
        _UI_FAILURE = e
        try:
            window.destroy()
        except Exception:
            pass


def main() -> None:
    if not _acquire_single_instance():
        return

    import webview  # type: ignore

    global _UI_FAILURE
    _UI_FAILURE = None
    base = resource_dir()
    db = None
    httpd = None

    try:
        try:
            db = Database()
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower():
                _fatal(
                    "iLOG 데이터베이스가 다른 실행 중인 iLOG에 의해 사용 중입니다.\n\n"
                    "기존 iLOG 창을 종료한 뒤 다시 실행해 주세요. 창이 보이지 않으면 작업 관리자에서 "
                    "iLOG.exe를 모두 종료한 뒤 다시 실행하세요."
                )
                return
            raise

        httpd, url = _start_ui_server(base)
        api = DesktopApi(db, base / "curriculum_packs", desktop=True)
        window = webview.create_window(
            f"아이로그 iLOG v{APP_VERSION}",
            url,
            js_api=api,
            width=1440,
            height=900,
            min_size=(1024, 680),
            confirm_close=False,
        )
        api._set_window(window)

        try:
            # 특정 렌더러를 강제하지 않는다. pywebview가 PC에서 가능한 엔진을 선택하고,
            # 최신 JS를 지원하지 못하거나 흰 화면이면 아래 정상 UI 점검에서 브라우저로 전환한다.
            opts = dict(
                private_mode=False,
                storage_path=str(db.data_dir / "webview-stable-v1"),
                func=_startup,
                args=(window,),
            )
            webview.start(**opts)
            if _UI_FAILURE and not SELFTEST:
                _run_browser_mode(db, base, url, _UI_FAILURE)
        except Exception as e:
            if SELFTEST:
                _fatal(str(e))
            else:
                try:
                    _run_browser_mode(db, base, url, e)
                except Exception as fallback_error:
                    _fatal(
                        "iLOG 화면을 시작할 수 없습니다.\n\n"
                        f"내장 화면 오류: {e}\n"
                        f"브라우저 모드 오류: {fallback_error}\n\n"
                        f"진단 로그: {db.data_dir / 'logs' / 'startup.log'}"
                    )
    finally:
        if httpd is not None:
            try:
                httpd.shutdown()
                httpd.server_close()
            except Exception:
                pass
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
        _release_single_instance()


def _startup(window) -> None:
    if SELFTEST:
        _selftest(window)
    else:
        _check_normal_ui(window)


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
            "statusFn: !!(window.pywebview && window.pywebview.api && typeof window.pywebview.api.status === 'function'),"
            "upgradedUi: !!document.getElementById('ilog-assessment-studio-script')"
            "})"
        )
        for _ in range(60):
            try:
                raw = window.evaluate_js(probe_js)
                if raw:
                    page = json.loads(raw) if isinstance(raw, str) else raw
                    result["page"] = page
                    if (
                        page.get("bootstrap")
                        and page.get("calendar")
                        and page.get("bridge")
                        and page.get("desktop")
                        and page.get("statusFn")
                        and page.get("upgradedUi")
                    ):
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
            and page.get("upgradedUi")
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
