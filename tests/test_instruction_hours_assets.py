from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_instruction_hours_assets_exist_and_are_served():
    js = (ROOT / "web" / "instruction_hours.js").read_text(encoding="utf-8")
    css = (ROOT / "web" / "instruction_hours.css").read_text(encoding="utf-8")
    server = (ROOT / "devserver.py").read_text(encoding="utf-8")

    assert "교육과정 편성·계획·이수 시수" in js
    assert "instruction_hours_" in js
    assert "#annual-stats" in css
    assert "instruction_hours.css" in server
    assert "instruction_hours.js" in server
