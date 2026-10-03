import io

from hwpx.document import HwpxDocument

from backend import assessment_reports
from backend.db import Database


def _db(tmp_path):
    db = Database(tmp_path)
    assert db.unlock("1234")
    db.put("settings", {"id": "global", "schoolYear": "2026", "schoolName": "테스트초", "grade": "5", "classNo": "1", "teacherName": "홍길동"})
    db.put("assessment_plans", {
        "planId": "disc1", "subjectName": "과학", "subjectShort": "과", "term": 1,
        "unit": "3. 날씨와 우리 생활", "date": "2026-06-08", "title": "날씨 자료 분석 수행평가",
        "domain": "과정·기능", "method": "실험·실습", "standard": "[6과06-01] 날씨 자료를 해석한다.",
        "objective": "날씨 자료를 분석하여 생활과의 관계를 설명할 수 있다.",
    })
    db.put("assessment_tasks", {
        "taskId": "dt1", "planId": "disc1", "title": "날씨 자료 분석하기",
        "description": "날씨 자료를 분석하고 결과를 근거로 설명한다.", "evidence": "활동지와 관찰 기록",
    })
    db.put_many("assessment_rubrics", [
        {"rubricId": "dr1", "planId": "disc1", "level": "잘함", "descriptor": "근거를 들어 정확히 설명함", "order": 1},
        {"rubricId": "dr2", "planId": "disc1", "level": "보통", "descriptor": "주요 내용을 설명함", "order": 2},
        {"rubricId": "dr3", "planId": "disc1", "level": "노력요함", "descriptor": "안내를 받아 설명함", "order": 3},
    ])
    return db


def test_bundle_starts_with_disclosure_summary(tmp_path):
    db = _db(tmp_path)
    try:
        name, raw = assessment_reports.assessment_plans_hwpx(db, 1)
        assert name == "교과별_평가계획_1학기.hwpx"
        doc = HwpxDocument.open(io.BytesIO(raw))
        text = doc.text.plain()
        assert "교과별 평가계획" in text
        assert "정보공시 제출용 정리본" in text
        assert "학생 개인별 평가결과는 포함하지 않고" in text
        assert "날씨 자료 분석 수행평가" in text
        assert "근거를 들어 정확히 설명함" in text
    finally:
        db.close()


def test_disclosure_ui_has_completeness_check():
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    js = (root / "web" / "assessment_export.js").read_text(encoding="utf-8")
    css = (root / "web" / "assessment_export.css").read_text(encoding="utf-8")
    assert "assess-disclosure-check" in js
    assert "평가기준 3단계" in js
    assert "정보공시 평가계획 점검" in js
    assert ".ilog-disclosure-summary" in css
