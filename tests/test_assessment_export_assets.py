from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_assessment_export_assets_are_wired():
    js = (ROOT / "web" / "assessment_export.js").read_text(encoding="utf-8")
    css = (ROOT / "web" / "assessment_export.css").read_text(encoding="utf-8")
    main = (ROOT / "main.py").read_text(encoding="utf-8")
    dev = (ROOT / "devserver.py").read_text(encoding="utf-8")

    assert "assessment_plan_hwpx" in js
    assert "assessment_plans_hwpx" in js
    assert "class_book_xlsx" in js
    assert "assessment_export.css" in main and "assessment_export.js" in main
    assert "assessment_export.css" in dev and "assessment_export.js" in dev
    assert ".ilog-assessment-export-bar" in css
