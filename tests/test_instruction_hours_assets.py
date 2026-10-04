from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_instruction_hours_assets_exist_and_are_served():
    js = (ROOT / "web" / "instruction_hours.js").read_text(encoding="utf-8")
    css = (ROOT / "web" / "instruction_hours.css").read_text(encoding="utf-8")
    cm_js = (ROOT / "web" / "curriculum_management.js").read_text(encoding="utf-8")
    cm_css = (ROOT / "web" / "curriculum_management.css").read_text(encoding="utf-8")
    server = (ROOT / "devserver.py").read_text(encoding="utf-8")

    assert "교육과정 편성·계획·이수 시수" in js
    assert "instruction_hours_" in js
    assert "#annual-stats" in css
    assert "학급교육과정 종합관리" in cm_js
    assert "과목설정의 <b>모든 과목</b>" in cm_js
    assert "실제 이수 관리 시작" in cm_js
    assert "학급교육과정 HWPX" in cm_js
    assert "curriculum-management-panel" in cm_css
    assert "instruction_hours.css" in server
    assert "instruction_hours.js" in server
    assert "curriculum_management.css" in server
    assert "curriculum_management.js" in server
