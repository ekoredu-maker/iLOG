from pathlib import Path

from backend.curriculum import CurriculumLibrary
from backend.curriculum_batch import apply_national_batch
from tests.test_curriculum_upgrade import _db


ROOT = Path(__file__).resolve().parent.parent


def test_national_batch_applies_all_configured_subjects_in_one_pass(tmp_path):
    db = _db(tmp_path)
    try:
        # 수학은 기존 교사 입력값이 있으므로 overwrite=False에서 유지되어야 한다.
        before = db.get("annual_schedule", "2026-03-03")
        math_before = next(x for x in before["subjects"] if x["name"] == "수")
        assert math_before["content"] == "수 세기"

        lib = CurriculumLibrary(db, ROOT / "curriculum_packs")
        subjects = [
            {"name": "국어", "shortName": "국"},
            {"name": "수학", "shortName": "수"},
            {"name": "바른생활", "shortName": "바생"},
            {"name": "슬기로운생활", "shortName": "슬생"},
            {"name": "즐거운생활", "shortName": "즐생"},
        ]
        result = apply_national_batch(db, lib, 1, subjects, overwrite=False)

        assert result["matched"] == 5
        assert result["applied"] >= 4
        assert result["skipped"] >= 2  # 기존 수학/바른생활 입력값 보존
        assert result["changedDays"] >= 1

        day = db.get("annual_schedule", "2026-03-03")
        kor = next(x for x in day["subjects"] if x["name"] == "국")
        math = next(x for x in day["subjects"] if x["name"] == "수")
        wise = next(x for x in day["subjects"] if x["name"] == "슬생")
        assert kor.get("content") and kor.get("standard") and kor.get("planSource")
        assert wise.get("content") and wise.get("standard") and wise.get("planSource")
        assert math["content"] == "수 세기"

        choices = (db.get("settings", "curriculum") or {}).get("choices") or {}
        assert choices.get("국")
        assert choices.get("수")
        assert choices.get("바생")
    finally:
        db.close()


def test_desktop_runtime_has_single_instance_and_direct_file_paths():
    import main

    assert hasattr(main, "DesktopApi")
    assert hasattr(main.DesktopApi, "curriculum_apply_national_batch")
    assert hasattr(main.DesktopApi, "build_and_save_file")
    assert callable(main._acquire_single_instance)
    assert callable(main._release_single_instance)

    js = (ROOT / "web" / "curriculum_finish.js").read_text(encoding="utf-8")
    assert "curriculum_apply_national_batch" in js
    assert "build_and_save_file('class_curriculum_hwpx'" in js
    assert "HWPX 만드는 중" in js
