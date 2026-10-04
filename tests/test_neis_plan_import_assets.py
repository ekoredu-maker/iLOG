from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_neis_plan_import_assets_are_wired():
    js = (ROOT / "web" / "neis_plan_import.js").read_text(encoding="utf-8")
    css = (ROOT / "web" / "neis_plan_import.css").read_text(encoding="utf-8")
    main = (ROOT / "main.py").read_text(encoding="utf-8")
    dev = (ROOT / "devserver.py").read_text(encoding="utf-8")

    assert "api.parse_excel" in js
    assert "DBManager.putMany('annual_schedule'" in js
    assert "neisPlanImportModal" in js
    # 데스크톱은 main.py가 devserver.Handler를 통해 같은 최신 UI를 제공한다.
    assert "from devserver import Handler" in main
    assert "neis_plan_import.css" in dev and "neis_plan_import.js" in dev
    assert ".ilog-neis-import-card" in css
