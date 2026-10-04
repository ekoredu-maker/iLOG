import base64
import io

from hwpx.document import HwpxDocument

from backend.api import Api
from backend.curriculum import CurriculumLibrary
from backend.db import Database
from backend import instruction_hours as ih
from backend import curriculum_report


def _db(tmp_path):
    db = Database(tmp_path)
    assert db.unlock("1234")
    settings = {
        "id": "global", "schoolYear": 2026, "schoolName": "테스트초등학교",
        "grade": 1, "classNo": 1, "teacherName": "가상담임",
        "term1Start": "2026-03-03", "term1End": "2026-07-20",
        "term2Start": "2026-08-24", "term2End": "2027-01-08",
        "periodsPerDay": 5,
    }
    db.put("settings", settings)
    subjects = [
        {"subjectId": "kor", "name": "국어", "shortName": "국", "hours": 7},
        {"subjectId": "math", "name": "수학", "shortName": "수", "hours": 4},
        {"subjectId": "bar", "name": "바른 생활", "shortName": "바생", "hours": 2},
        {"subjectId": "wise", "name": "슬기로운 생활", "shortName": "슬생", "hours": 3},
        {"subjectId": "joy", "name": "즐거운 생활", "shortName": "즐생", "hours": 4},
    ]
    db.put_many("subjects", subjects)
    db.put("settings", {
        "id": ih.plan_key(settings), "schoolYear": 2026, "grade": 1,
        "schoolPlan": {"국어": 210, "수학": 120, "바른 생활": 60, "슬기로운 생활": 90, "즐거운 생활": 120},
    })
    db.put("settings", {
        "id": ih.class_record_key(settings),
        "classVision": "함께 배우고 성장하는 학급",
        "classGoals": "스스로 배우고 서로 존중한다.",
    })
    db.put("timetable_weekly", {"id": "weekly", "grid": {
        "mon-1": {"id": "kor", "name": "국"},
        "mon-2": {"id": "math", "name": "수"},
        "mon-3": {"id": "bar", "name": "바생"},
        "mon-4": {"id": "wise", "name": "슬생"},
        "mon-5": {"id": "joy", "name": "즐생"},
    }})
    db.put_many("annual_schedule", [
        {"date": "2026-03-03", "subjects": [
            {"period": 1, "name": "국", "unit": "", "objective": "", "content": ""},
            {"period": 2, "name": "수", "unit": "수 세기", "objective": "수를 센다", "content": "수 세기"},
            {"period": 3, "name": "바생", "unit": "학교생활", "objective": "약속을 지킨다", "content": "학교 약속"},
            {"period": 4, "name": "슬생", "unit": "", "objective": "", "content": ""},
        ]},
        {"date": "2026-03-04", "subjects": [
            {"period": 1, "name": "국", "unit": "", "objective": "", "content": ""},
            {"period": 2, "name": "국", "unit": "", "objective": "", "content": ""},
        ]},
        # 즐거운 생활은 과목설정에는 있으나 연간시간표에 아직 배치하지 않은 상태를 검증한다.
    ])
    return db


def test_first_grade_all_configured_subjects_are_kept(tmp_path):
    db = _db(tmp_path)
    try:
        snap = ih.snapshot(db, "2026-10-04")
        rows = {r["name"]: r for r in snap["subjects"]}
        assert set(rows) == {"국어", "수학", "바른 생활", "슬기로운 생활", "즐거운 생활"}
        assert rows["즐거운 생활"]["scheduled"] == 0
        assert rows["즐거운 생활"]["schoolPlan"] == 120
        assert rows["국어"]["scheduled"] == 3
        assert rows["국어"]["completed"] == 3  # 기본은 이전 버전 호환: 날짜 기준 추정
    finally:
        db.close()


def test_actual_execution_separates_done_cancelled_makeup_and_unconfirmed(tmp_path):
    db = _db(tmp_path)
    try:
        settings = db.get("settings", "global")
        db.put("settings", {
            "id": ih.execution_key(settings), "mode": "actual",
            "items": {
                "2026-03-03#1": {"status": "done", "subject": "국"},
                "2026-03-03#2": {"status": "cancelled", "subject": "수"},
                "2026-03-03#3": {"status": "makeup", "subject": "바생"},
                # 3/3 4교시 슬생, 3/4 국어 2차시는 의도적으로 미확인
            },
        })
        snap = ih.snapshot(db, "2026-10-04")
        assert snap["executionMode"] == "actual"
        rows = {r["name"]: r for r in snap["subjects"]}
        assert rows["국어"]["completed"] == 1
        assert rows["국어"]["unconfirmedPast"] == 2
        assert rows["수학"]["completed"] == 0
        assert rows["수학"]["cancelled"] == 1
        assert rows["바른 생활"]["completed"] == 1
        assert rows["슬기로운 생활"]["unconfirmedPast"] == 1
    finally:
        db.close()


def test_grade1_national_packs_exist_and_adapt_to_annual_slots(tmp_path):
    db = _db(tmp_path)
    try:
        lib = CurriculumLibrary(db)
        items = lib.list(1)
        national = {i["subject"]: i for i in items if i["publisher"] == "국가수준 기본안"}
        assert set(national) >= {"국어", "수학", "바른 생활", "슬기로운 생활", "즐거운 생활"}
        assert all(national[name]["adaptive"] for name in national)

        pack = national["국어"]
        preview = lib.preview(pack["packId"], "국")
        assert sum(t["applied"] for t in preview["terms"]) == 3
        result = lib.apply(pack["packId"], "국", overwrite=True)
        assert result["applied"] == 3
        assert result["adaptive"] is True

        lessons = []
        for day in db.get_all("annual_schedule"):
            lessons.extend([x for x in day.get("subjects") or [] if x.get("name") == "국"])
        assert len(lessons) == 3
        assert all(x.get("unit") and x.get("objective") and x.get("content") for x in lessons)
        assert all("2022 개정 교육과정" in x.get("standard", "") for x in lessons)
        assert all(x.get("planSource") == pack["packId"] for x in lessons)
    finally:
        db.close()


def test_class_curriculum_hwpx_and_api_output(tmp_path):
    db = _db(tmp_path)
    try:
        name, raw = curriculum_report.class_curriculum_hwpx(db)
        assert name.endswith(".hwpx")
        assert len(raw) > 1000
        doc = HwpxDocument.open(io.BytesIO(raw))
        text = doc.text.plain()
        assert "학급교육과정" in text
        assert "함께 배우고 성장하는 학급" in text
        assert "바른 생활" in text
        assert "즐거운 생활" in text

        api = Api(db)
        assert api.app_info()["version"] == "10.4.0"
        out = api.build_file("class_curriculum_hwpx", {})
        decoded = base64.b64decode(out["b64"])
        assert out["filename"].endswith(".hwpx")
        assert len(decoded) > 1000
        HwpxDocument.open(io.BytesIO(decoded))
    finally:
        db.close()
