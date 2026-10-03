import base64
from pathlib import Path

from backend.api import Api
from backend.db import Database, SCHEMA_VERSION

ROOT = Path(__file__).resolve().parent.parent


def make_api(tmp_path):
    db = Database(tmp_path)
    assert db.unlock("1234")
    return db, Api(db, ROOT / "curriculum_packs")


def test_assessment_stores_crud_and_query(tmp_path):
    db, api = make_api(tmp_path)
    try:
        assert SCHEMA_VERSION >= 3
        plan = {
            "planId": "assess_1",
            "subjectName": "과학",
            "unit": "3. 날씨와 우리 생활",
            "date": "2026-06-08",
            "title": "날씨 자료 분석 수행평가",
        }
        task = {
            "taskId": "astask_1",
            "planId": "assess_1",
            "title": "날씨 자료 분석하기",
            "description": "날씨 자료를 분석하고 생활과의 관계를 설명한다.",
        }
        rubrics = [
            {"rubricId": "rubric_1", "planId": "assess_1", "level": "잘함", "descriptor": "근거를 들어 정확히 설명함", "order": 1},
            {"rubricId": "rubric_2", "planId": "assess_1", "level": "보통", "descriptor": "주요 내용을 설명함", "order": 2},
            {"rubricId": "rubric_3", "planId": "assess_1", "level": "노력요함", "descriptor": "안내를 받아 설명함", "order": 3},
        ]
        api.db_put("assessment_plans", plan)
        api.db_put("assessment_tasks", task)
        api.db_put_many("assessment_rubrics", rubrics)

        assert api.db_get("assessment_plans", "assess_1")["unit"] == "3. 날씨와 우리 생활"
        assert api.db_query("assessment_tasks", "planId", "assess_1")[0]["title"] == "날씨 자료 분석하기"
        assert len(api.db_query("assessment_rubrics", "planId", "assess_1")) == 3
    finally:
        db.close()


def test_assessment_stores_survive_encrypted_backup(tmp_path):
    db, api = make_api(tmp_path)
    try:
        api.db_put("assessment_plans", {
            "planId": "assess_backup",
            "subjectName": "사회",
            "unit": "우리 지역의 모습",
            "title": "지역 조사 프로젝트",
            "date": "2026-05-20",
        })
        api.db_put("assessment_tasks", {
            "taskId": "task_backup", "planId": "assess_backup",
            "title": "우리 지역 조사", "description": "지역 자료를 조사한다."
        })
        raw = base64.b64decode(api.build_file("backup")["b64"]).decode("utf-8")
        assert "지역 조사 프로젝트" not in raw

        api.clear_all()
        assert api.db_get_all("assessment_plans") == []
        counts = api.import_backup(raw)
        assert counts["assessment_plans"] == 1
        assert counts["assessment_tasks"] == 1
        assert api.db_get("assessment_plans", "assess_backup")["subjectName"] == "사회"
    finally:
        db.close()
