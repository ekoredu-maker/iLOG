import base64
import io

import pytest
from hwpx.document import HwpxDocument

from backend.api import Api
from backend.db import Database, StoreError
from backend.hwpx_builder import HwpxBuilder
from tests.test_backend import setup_class


@pytest.fixture
def api(tmp_path):
    db = Database(tmp_path)
    db.unlock("1234")
    a = Api(db)
    setup_class(a, term1=("2026-03-02", "2026-07-17"), term2=("2026-08-17", "2027-01-08"))
    a.db_put("settings", {**a.db_get("settings", "global"), "principalName": "홍교장", "expDomesticDays": "7"})
    a.generate_annual()
    a.db_put_many("students", [{"studentId": "A", "number": 1, "name": "김<하늘>", "guardianPhone": "010-1111-2222"},
                               {"studentId": "B", "number": 2, "name": "이바다"}])
    return a


def text_of(f):
    return HwpxDocument.open(io.BytesIO(base64.b64decode(f["b64"]))).text.plain()


def make_exp(api, **kw):
    exp = {"studentId": "A", "studentName": "김<하늘>", "type": "가족동반여행", "startDate": "2026-04-01", "endDate": "2026-04-03",
           "status": "approved", "destination": "제주도", "guardianName": "김엄마", "guardianRelation": "모",
           "purpose": "자연 체험", "plan": "1일차 성산일출봉\n2일차 만장굴"}
    exp.update(kw)
    return api.save_experiential(exp)["expId"]


def test_experiential_forms(api):
    eid = make_exp(api)
    make_exp(api, startDate="2026-05-11", endDate="2026-05-12")  # 같은 해 다른 승인 2일
    t = text_of(api.build_file("form_hwpx", {"kind": "exp_application", "expId": eid}))
    assert "김<하늘>" in t and "제주도" in t and "김엄마 (모)" in t and "010-1111-2222" in t
    assert "[수업일 3일]" in t and "올해 사용 2일 / 허용 7일 (이번 신청 후 잔여 2일)" in t
    assert "☑ 가족동반여행" in t and "☐ 친인척방문" in t
    n = text_of(api.build_file("form_hwpx", {"kind": "exp_notice", "expId": eid}))
    assert "☑ 승인" in n and "☐ 불허" in n and "2026. 4. 14.(화)까지" in n
    r = text_of(api.build_file("form_hwpx", {"kind": "exp_report", "expId": eid}))
    assert "결과 보고서" in r and "느낀 점" in r


def test_denied_notice_and_long_trip_notice(api):
    eid = make_exp(api, status="denied", denyReason="허용 일수 초과")
    n = text_of(api.build_file("form_hwpx", {"kind": "exp_notice", "expId": eid}))
    assert "불허 통보서" in n and "☑ 불허" in n and "허용 일수 초과" in n
    eid2 = make_exp(api, startDate="2026-06-01", endDate="2026-06-08")
    n2 = text_of(api.build_file("form_hwpx", {"kind": "exp_notice", "expId": eid2}))
    assert "주 1회 이상" in n2


def test_absence_episode_grouping(api):
    recs = []
    for d in ("2026-03-10", "2026-03-11"):
        recs += [{"attendanceId": f"{d}_{p}_B", "date": d, "period": p, "studentId": "B", "status": "결석", "reason": "질병", "note": "독감"} for p in (1, 2)]
    recs.append({"attendanceId": "2026-03-13_2_B", "date": "2026-03-13", "period": 2, "studentId": "B", "status": "조퇴", "reason": "기타", "note": "가정 사정"})
    api.db_put_many("attendance", recs)
    dates = api.absence_dates("B")
    assert [d["date"] for d in dates] == ["2026-03-13", "2026-03-11", "2026-03-10"]
    t = text_of(api.build_file("form_hwpx", {"kind": "absence", "studentId": "B", "date": "2026-03-10"}))
    assert "결석 신고서" in t and "2026. 3. 10.(화) ~ 3. 11.(수)  (2일)" in t and "☑ 질병" in t and "독감" in t
    t2 = text_of(api.build_file("form_hwpx", {"kind": "absence", "studentId": "B", "date": "2026-03-13"}))
    assert "학부모 확인서" in t2 and "☑ 조퇴" in t2 and "2교시" in t2 and "☑ 기타" in t2
    with pytest.raises(StoreError):
        api.build_file("form_hwpx", {"kind": "absence", "studentId": "B", "date": "2026-03-02"})


def test_weekly_guide(api):
    api.weekly_save({"weekStart": "2026-03-11", "morning": {"mon": "아침 독서"}, "prep": {"wed": "리코더"}, "general": "목요일 학부모 공개수업"})
    got = api.weekly_get("2026-03-12")
    assert got["weekStart"] == "2026-03-09" and got["notes"]["prep"]["wed"] == "리코더"
    d = api.db_get("annual_schedule", "2026-03-10")
    d["subjects"][1]["content"] = "세 자리 수의 덧셈"
    api.db_put("annual_schedule", d)
    api.db_put("school_events", {"eventId": "h", "startDate": "2026-03-13", "endDate": "2026-03-13", "title": "개교기념일", "isHoliday": True})
    api.generate_annual()
    t = text_of(api.build_file("form_hwpx", {"kind": "weekly", "weekStart": "2026-03-09"}))
    assert "[2주]" in t and "아침 독서" in t and "리코더" in t and "목요일 학부모 공개수업" in t
    assert "수학\n세 자리 수의 덧셈" in t and "개교기념일" in t


def test_report_cards(api):
    api.db_put("eval_plans", {"planId": "p1", "subjectName": "수학", "title": "덧셈", "date": "2026-03-20", "domain": "수와 연산"})
    api.db_put("eval_plans", {"planId": "p2", "subjectName": "수학", "title": "2학기 평가", "date": "2026-09-20"})
    api.db_put("eval_scores", {"scoreId": "p1_A", "planId": "p1", "studentId": "A", "score": "잘함", "note": "정확함"})
    api.db_put("counseling", {"logId": "c1", "studentId": "A", "date": "2026-03-05", "type": "누가기록(행동특성)", "content": "친구를 도움"})
    lst = api.report_card_list(1)
    a = next(x for x in lst["students"] if x["studentId"] == "A")
    assert a["evals"] == "1/1" and a["notes"] == ["[2026-03-05] 친구를 도움"]
    api.report_card_save(1, [{"studentId": "A", "comment": "배려심이 깊음."}, {"studentId": "B", "comment": "성실함."}])
    t = text_of(api.build_file("form_hwpx", {"kind": "report_card", "term": 1}))
    assert t.count("2026학년도 1학기 가정통지표") == 2
    assert "덧셈 (수와 연산)" in t and "잘함" in t and "2학기 평가" not in t and "배려심이 깊음." in t and "가정에서" in t
    t1 = text_of(api.build_file("form_hwpx", {"kind": "report_card", "term": 1, "studentIds": ["B"], "parentReply": False}))
    assert t1.count("가정통지표") == 1 and "가정에서" not in t1
    api.delete_student_cascade("A")
    assert all(c["studentId"] != "A" for c in api.db_get_all("report_cards"))


def test_html_versions_escape(api):
    eid = make_exp(api)
    h = api.build_html("form", {"kind": "exp_application", "expId": eid})["html"]
    assert "김&lt;하늘&gt;" in h and "<하늘>" not in h and "@page" in h


def school_template(with_placeholders=True):
    b = HwpxBuilder()
    if with_placeholders:
        b.para("{{이름}} 학생 ({{학년반번호}}) 체험학습 기간: {{기간}} / 목적지: {{목적지}} / 없는값: {{없는항목}}")
    b.table([["성명", "", "반", "3"], ["체험학습 기간", "", "보호자 성명", ""], ["반드시 지켜 주세요", "", "목적", "이미 인쇄됨"]], [30, 55, 30, 55])
    return b.to_bytes()


def test_school_template_fill(api):
    eid = make_exp(api)
    with pytest.raises(Exception):
        api.form_template_upload("exp_application", base64.b64encode(b"not a doc").decode(), "x.pdf")
    info = api.form_template_upload("exp_application", base64.b64encode(school_template()).decode(), "우리학교_신청서.hwpx")
    assert "이름" in info["placeholders"] and "성명" in info["labels"]
    assert api.form_templates()["templates"][0]["filename"] == "우리학교_신청서.hwpx"
    f = api.build_file("form_hwpx", {"kind": "exp_application", "expId": eid, "useTemplate": True})
    t = text_of(f)
    assert "김<하늘> 학생 (3학년 2반 1번)" in t and "목적지: 제주도" in t
    assert "성명\t김<하늘>" in t and "보호자 성명\t김엄마" in t and "체험학습 기간\t2026. 4. 1.(수) ~ 4. 3.(금) (3일)" in t
    assert "반\t3" in t  # 이미 인쇄된 값은 덮어쓰지 않음
    assert "이미 인쇄됨" in t and "반드시 지켜 주세요\t\t" in t  # 비슷한 제목('반')은 건드리지 않음
    rep = f["report"]
    assert "목적지" in rep["placeholders"] and rep["unfilledPlaceholders"] == ["없는항목"]
    assert set(rep["labels"]) >= {"성명", "보호자성명", "체험학습기간"}
    # 백업에 양식이 함께 들어가고 복구됨
    backup = base64.b64decode(api.build_file("backup")["b64"]).decode()
    api.form_template_delete("exp_application")
    assert api.form_templates()["templates"] == []
    api.import_backup(backup)
    assert api.form_templates()["templates"][0]["kind"] == "exp_application"


def test_fill_without_template_falls_back_to_builtin(api):
    eid = make_exp(api)
    t = text_of(api.build_file("form_hwpx", {"kind": "exp_application", "expId": eid, "useTemplate": True}))
    assert "학교장허가 교외체험학습 신청서" in t
