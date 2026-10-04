from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_desktop_uses_reload_safe_local_server():
    src = (ROOT / "main.py").read_text(encoding="utf-8")
    assert "_start_ui_server" in src
    assert "from devserver import Handler" in src
    assert "webview-stable-v1" in src
    assert "_check_normal_ui" in src
    assert 'opts["gui"] = "edgechromium"' not in src
    assert "_install_reload_hook" not in src


def test_ui_server_injects_latest_extension_assets_on_every_index_request():
    src = (ROOT / "devserver.py").read_text(encoding="utf-8")
    for asset in (
        "theme.css",
        "dashboard_warm.js",
        "classroom_warm.js",
        "academic_warm.js",
        "workdesk_warm.js",
        "assessment_studio.js",
        "neis_plan_import.js",
        "assessment_export.js",
    ):
        assert asset in src
    assert 'if self.path in ("/", "/index.html")' in src
