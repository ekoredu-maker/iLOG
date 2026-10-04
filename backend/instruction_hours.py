"""교육과정 편성·지도·평가·이수 종합 집계.

국가수준 교육과정의 시간 배당 기준은 학년군(2년) 기준으로 관리하고,
학교가 정한 당해 학년 편성시수와 iLOG의 과목설정·연간지도계획·평가계획을
같은 과목 축으로 연결하여 비교한다.

핵심 원칙
- 국가 기준: 2022 개정 교육과정 초등학교 학년군별 시간 배당 기준
- 학교 편성: settings/instruction_hours_<학년도>_<학년> 에 교사가 입력
- 연간 계획: annual_schedule 전체 수업 칸 수
- 지도내용: annual_schedule 중 단원/목표/내용이 입력된 차시 수
- 평가: eval_plans / assessment_plans 를 과목별로 연결
- 현재 이수: 기준일(as_of)까지의 annual_schedule 수업 칸 수
- 학급교육과정 기록: settings/class_curriculum_<학년도>_<학년>_<반>

과목설정에 등록된 과목은 시수가 0이어도 모두 집계 대상으로 남긴다.
연간 지도계획을 수정/이동/삭제하면 같은 annual_schedule을 기준으로 집계하므로
편성·지도·주간·월간 시수가 즉시 함께 바뀐다.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from .db import Database


NATIONAL_2022 = {
    "1-2": {
        "국어": 482,
        "수학": 256,
        "바른 생활": 144,
        "슬기로운 생활": 224,
        "즐거운 생활": 400,
        "창의적 체험활동": 238,
        "총 수업시간": 1744,
    },
    "3-4": {
        "국어": 408,
        "사회/도덕": 272,
        "수학": 272,
        "과학/실과": 204,
        "체육": 204,
        "예술(음악/미술)": 272,
        "영어": 136,
        "창의적 체험활동": 204,
        "총 수업시간": 1972,
    },
    "5-6": {
        "국어": 408,
        "사회/도덕": 272,
        "수학": 272,
        "과학/실과": 340,
        "체육": 204,
        "예술(음악/미술)": 272,
        "영어": 204,
        "창의적 체험활동": 204,
        "총 수업시간": 2176,
    },
}


def _norm(v) -> str:
    return str(v or "").replace(" ", "").strip()


def _int(v, default=0) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def grade_band(grade) -> str:
    g = _int(grade)
    if g <= 2:
        return "1-2"
    if g <= 4:
        return "3-4"
    return "5-6"


def plan_key(settings: dict) -> str:
    year = _int(settings.get("schoolYear"), date.today().year)
    grade = _int(settings.get("grade"), 0)
    return f"instruction_hours_{year}_{grade}"


def class_record_key(settings: dict) -> str:
    year = _int(settings.get("schoolYear"), date.today().year)
    grade = _int(settings.get("grade"), 0)
    class_no = str(settings.get("classNo") or "0").strip() or "0"
    return f"class_curriculum_{year}_{grade}_{class_no}"


def load_plan(db: Database) -> dict:
    settings = db.get("settings", "global") or {}
    rec = db.get("settings", plan_key(settings)) or {}
    return {
        "id": plan_key(settings),
        "schoolYear": _int(settings.get("schoolYear"), date.today().year),
        "grade": _int(settings.get("grade"), 0),
        "schoolPlan": rec.get("schoolPlan") or {},
        "note": rec.get("note") or "",
    }


def load_class_record(db: Database) -> dict:
    settings = db.get("settings", "global") or {}
    key = class_record_key(settings)
    rec = db.get("settings", key) or {}
    return {
        "id": key,
        "classVision": rec.get("classVision") or "",
        "classGoals": rec.get("classGoals") or "",
        "focus": rec.get("focus") or "",
        "studentProfile": rec.get("studentProfile") or "",
        "curriculumPrinciples": rec.get("curriculumPrinciples") or "",
        "creativeActivities": rec.get("creativeActivities") or "",
        "schoolAutonomy": rec.get("schoolAutonomy") or "",
        "crossCurricular": rec.get("crossCurricular") or "",
        "assessmentPolicy": rec.get("assessmentPolicy") or "",
        "reflection": rec.get("reflection") or "",
        "changes": rec.get("changes") or "",
    }


def _term_of(settings: dict, d: str) -> int:
    if settings.get("term1Start") and settings.get("term1End") and settings["term1Start"] <= d <= settings["term1End"]:
        return 1
    if settings.get("term2Start") and settings.get("term2End") and settings["term2Start"] <= d <= settings["term2End"]:
        return 2
    return 0


def subject_group(subject_name: str, grade) -> str:
    n = _norm(subject_name)
    band = grade_band(grade)
    if n in ("창의적체험활동", "창체"):
        return "창의적 체험활동"
    if band == "1-2":
        aliases = {
            "국어": "국어", "수학": "수학",
            "바른생활": "바른 생활", "슬기로운생활": "슬기로운 생활", "즐거운생활": "즐거운 생활",
        }
        return aliases.get(n, subject_name)
    if n == "국어": return "국어"
    if n in ("사회", "도덕"): return "사회/도덕"
    if n == "수학": return "수학"
    if n in ("과학", "실과"): return "과학/실과"
    if n == "체육": return "체육"
    if n in ("음악", "미술"): return "예술(음악/미술)"
    if n == "영어": return "영어"
    return subject_name


def _configured_subjects(db: Database) -> list[dict]:
    """과목설정에 등록된 과목 전체를 반환한다.

    기존에는 연간시간표에 실제 등장하거나 편성시수가 입력된 과목만 남겨
    1학년에서 국어·수학만 보이는 문제가 발생할 수 있었다. 종합관리에서는
    과목설정 자체가 기준 목록이므로 0시간 과목도 유지한다.
    """
    out = []
    for s in db.get_all("subjects"):
        if str(s.get("name") or s.get("shortName") or "").strip():
            out.append(s)
    return out


def _subject_index(subjects: list[dict]) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for s in subjects:
        for value in (s.get("subjectId"), s.get("name"), s.get("shortName")):
            key = _norm(value)
            if key:
                idx.setdefault(key, s)
    return idx


def _resolve_subject(value, idx: dict[str, dict]) -> dict | None:
    return idx.get(_norm(value))


def _evaluation_counts(db: Database, subjects: list[dict]) -> tuple[dict, dict]:
    idx = _subject_index(subjects)
    legacy = defaultdict(int)
    performance = defaultdict(int)
    for p in db.get_all("eval_plans"):
        s = _resolve_subject(p.get("subjectId"), idx) or _resolve_subject(p.get("subjectName"), idx)
        if s:
            legacy[str(s.get("subjectId") or s.get("shortName") or s.get("name"))] += 1
    for p in db.get_all("assessment_plans"):
        s = (_resolve_subject(p.get("subjectId"), idx)
             or _resolve_subject(p.get("subjectName"), idx)
             or _resolve_subject(p.get("subjectShort"), idx))
        if s:
            performance[str(s.get("subjectId") or s.get("shortName") or s.get("name"))] += 1
    return legacy, performance


def subject_rows(db: Database, as_of: str | None = None) -> list[dict]:
    settings = db.get("settings", "global") or {}
    plan = load_plan(db)
    school_plan = plan["schoolPlan"]
    as_of = as_of or date.today().isoformat()
    subjects = _configured_subjects(db)
    idx = _subject_index(subjects)
    counts = defaultdict(lambda: {
        "t1": 0, "t2": 0, "other": 0, "scheduled": 0, "completed": 0,
        "contentLessons": 0,
    })

    for day in db.get_all("annual_schedule"):
        d = str(day.get("date") or "")
        term = _term_of(settings, d)
        for lesson in day.get("subjects") or []:
            s = (_resolve_subject(lesson.get("subjectId"), idx)
                 or _resolve_subject(lesson.get("name"), idx)
                 or _resolve_subject(lesson.get("subjectName"), idx)
                 or _resolve_subject(lesson.get("subjectShort"), idx))
            if not s:
                continue
            skey = str(s.get("subjectId") or s.get("shortName") or s.get("name"))
            c = counts[skey]
            c["scheduled"] += 1
            if d and d <= as_of:
                c["completed"] += 1
            if term == 1: c["t1"] += 1
            elif term == 2: c["t2"] += 1
            else: c["other"] += 1
            if any(str(lesson.get(k) or "").strip() for k in ("unit", "objective", "content", "standard")):
                c["contentLessons"] += 1

    eval_counts, assessment_counts = _evaluation_counts(db, subjects)
    rows = []
    for s in subjects:
        name = str(s.get("name") or "")
        short = str(s.get("shortName") or name)
        skey = str(s.get("subjectId") or short or name)
        c = counts[skey]
        school = school_plan.get(name, school_plan.get(short, ""))
        school_i = _int(school, 0) if str(school).strip() != "" else None
        diff = (c["scheduled"] - school_i) if school_i is not None else None
        coverage = round((c["contentLessons"] / c["scheduled"] * 100), 1) if c["scheduled"] else 0
        rows.append({
            "subjectId": s.get("subjectId"),
            "name": name, "short": short,
            "schoolPlan": school_i,
            "t1": c["t1"], "t2": c["t2"], "other": c["other"],
            "scheduled": c["scheduled"], "completed": c["completed"],
            "remaining": max(c["scheduled"] - c["completed"], 0),
            "diff": diff,
            "contentLessons": c["contentLessons"],
            "contentCoverage": coverage,
            "evalPlans": eval_counts.get(skey, 0),
            "assessmentPlans": assessment_counts.get(skey, 0),
            "group": subject_group(name, settings.get("grade")),
        })
    return rows


def national_rows(db: Database, as_of: str | None = None) -> list[dict]:
    settings = db.get("settings", "global") or {}
    band = grade_band(settings.get("grade"))
    ref = NATIONAL_2022[band]
    subject = subject_rows(db, as_of)
    sums = defaultdict(lambda: {"schoolPlan": 0, "scheduled": 0, "completed": 0})
    has_plan = defaultdict(bool)
    for r in subject:
        g = r["group"]
        if r["schoolPlan"] is not None:
            sums[g]["schoolPlan"] += r["schoolPlan"]
            has_plan[g] = True
        sums[g]["scheduled"] += r["scheduled"]
        sums[g]["completed"] += r["completed"]
    rows = []
    for group, national in ref.items():
        if group == "총 수업시간":
            continue
        rows.append({
            "group": group,
            "nationalBand": national,
            "schoolPlan": sums[group]["schoolPlan"] if has_plan[group] else None,
            "scheduled": sums[group]["scheduled"],
            "completed": sums[group]["completed"],
        })
    rows.append({
        "group": "합계",
        "nationalBand": ref["총 수업시간"],
        "schoolPlan": sum(r["schoolPlan"] or 0 for r in subject) if any(r["schoolPlan"] is not None for r in subject) else None,
        "scheduled": sum(r["scheduled"] for r in subject),
        "completed": sum(r["completed"] for r in subject),
    })
    return rows


def _period_rows(db: Database, mode: str) -> dict:
    """주/월별 과목 시수. 과목설정 전체를 열로 유지한다."""
    subjects_cfg = _configured_subjects(db)
    idx = _subject_index(subjects_cfg)
    subjects = [
        (str(s.get("subjectId") or s.get("shortName") or s.get("name") or ""),
         str(s.get("name") or s.get("shortName") or ""))
        for s in subjects_cfg
    ]
    data = defaultdict(lambda: defaultdict(int))
    date_meta = {}
    for day in db.get_all("annual_schedule"):
        ds = str(day.get("date") or "")
        if not ds:
            continue
        try:
            d = date.fromisoformat(ds)
        except ValueError:
            continue
        if mode == "month":
            key = f"{d.year:04d}-{d.month:02d}"
            label = f"{d.year}년 {d.month}월"
            date_meta[key] = {"label": label, "start": f"{d.year:04d}-{d.month:02d}-01", "end": ""}
        else:
            monday = d - timedelta(days=d.weekday())
            friday = monday + timedelta(days=4)
            iso = d.isocalendar()
            key = f"{iso.year:04d}-W{iso.week:02d}"
            date_meta[key] = {"label": f"{iso.week}주", "start": monday.isoformat(), "end": friday.isoformat()}
        for lesson in day.get("subjects") or []:
            s = (_resolve_subject(lesson.get("subjectId"), idx)
                 or _resolve_subject(lesson.get("name"), idx)
                 or _resolve_subject(lesson.get("subjectName"), idx)
                 or _resolve_subject(lesson.get("subjectShort"), idx))
            if not s:
                continue
            skey = str(s.get("subjectId") or s.get("shortName") or s.get("name") or "")
            data[key][skey] += 1
    rows = []
    for key in sorted(data):
        vals = [data[key].get(skey, 0) for skey, _ in subjects]
        rows.append({"key": key, **date_meta[key], "values": vals, "total": sum(vals)})
    return {"subjects": [name for _, name in subjects], "keys": [skey for skey, _ in subjects], "rows": rows}


def weekly_rows(db: Database) -> dict:
    return _period_rows(db, "week")


def monthly_rows(db: Database) -> dict:
    return _period_rows(db, "month")


def snapshot(db: Database, as_of: str | None = None) -> dict:
    settings = db.get("settings", "global") or {}
    return {
        "schoolYear": _int(settings.get("schoolYear"), date.today().year),
        "grade": _int(settings.get("grade"), 0),
        "band": grade_band(settings.get("grade")),
        "asOf": as_of or date.today().isoformat(),
        "plan": load_plan(db),
        "classRecord": load_class_record(db),
        "national": national_rows(db, as_of),
        "subjects": subject_rows(db, as_of),
        "weekly": weekly_rows(db),
        "monthly": monthly_rows(db),
    }
