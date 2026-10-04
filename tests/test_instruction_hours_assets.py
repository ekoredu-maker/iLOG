from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_instruction_hours_assets_exist_and_are_served():
    js = (ROOT / "web" / "instruction_hours.js").read_text(encoding="utf-8")
    css = (ROOT / "web" / "instruction_hours.css").read_text(encoding="utf-8")
    cm_js = (ROOT / "web" / "curriculum_management.js").read_text(encoding="utf-8")
    cm_css = (ROOT / "web" / "curriculum_management.css").read_text(encoding="utf-8")
    polish = (ROOT / "web" / "curriculum_polish.js").read_text(encoding="utf-8")
    finish = (ROOT / "web" / "curriculum_finish.js").read_text(encoding="utf-8")
    server = (ROOT / "devserver.py").read_text(encoding="utf-8")

    assert "교육과정 편성·계획·이수 시수" in js
    assert "instruction_hours_" in js
    assert "#annual-stats" in css
    assert "학급교육과정 종합관리" in cm_js
    assert "과목설정의 <b>모든 과목</b>" in cm_js
    assert "실제 이수 관리 시작" in cm_js
    assert "학급교육과정 HWPX" in cm_js
    assert "curriculum-management-panel" in cm_css

    # 교육과정 화면 마감 보완: 과목 순서, 연간 주차, 단일 과목 명칭, 시간표 표현 통일
    assert "subject_order_" in polish
    assert "위로 이동" in polish and "아래로 이동" in polish
    assert "담임 개설과목" in polish
    assert "제${weekNo}주" in polish
    assert "ilog-subject-chip" in polish
    assert "setCell = function" in polish

    # 국가수준 기본안은 화면에서 직접 확인·일괄 적용할 수 있고, 경영록 HWPX 버튼도 제공한다.
    assert "국가수준·교과서 지도계획 기본자료" in finish
    assert "국가수준 기본안 전체 적용" in finish
    assert "국가수준 기본안" in finish
    assert "class-book-hwpx-btn" in finish
    assert "class_curriculum_hwpx" in finish

    assert "instruction_hours.css" in server
    assert "instruction_hours.js" in server
    assert "curriculum_management.css" in server
    assert "curriculum_management.js" in server
    assert "curriculum_polish.js" in server
    assert "curriculum_finish.js" in server
