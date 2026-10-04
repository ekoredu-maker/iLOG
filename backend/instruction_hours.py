"""교육과정 편성·지도·평가·이수 종합 집계.

국가 학년군 기준 → 학교 당해학년 편성 → 연간 계획 → 지도내용 → 평가 → 실제 이수를
같은 과목 축으로 연결한다.

실제 이수는 settings/lesson_execution_<학년도>_<학년>_<반> 에 저장한다.
- mode='estimated': 기존 데이터 호환. 기준일까지 배치된 차시를 일정상 이수 추정으로 계산
- mode='actual': 실시/done, 보강/makeup, 대체/substitute만 실제 이수로 계산
  미확인 과거 차시는 unconfirmedPast 로 별도 집계한다.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from .db import Database


NATIONAL_2022 = {
    "1-2": {"국어": 482, "수학": 256, "바른 생활": 144, "슬기로운 생활": 224, "즐거운 생활": 400, "창의적 체험활동": 238, "총 수업시간": 1744},
    "3-4": {"국어": 408, "사회/도덕": 272, "수학": 272, "과학/실과": 204, "체육": 204, "예술(음악/미술)": 272, "영어": 136, "창의적 체험활동": 204, "총 수업시간": 1972},
    "5-6": {"국어": 408, "사회/도덕": 272, "수학": 272, "과학/실과": 340, "체육": 204, "예술(음악/미술)": 272, "영어": 204, "창의적 체험활동": 204, "총 수업시간": 2176},
}
DONE_STATUSES = {"done", "makeup", "substitute"}


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
    return f"instruction_hours_{_int(settings.get('schoolYear'), date.today().year)}_{_int(settings.get('grade'), 0)}"


def class_record_key(settings: dict) -> str:
    year = _int(settings.get("schoolYear"), date.today().year)
    grade = _int(settings.get("grade"), 0)
    class_no = str(settings.get("classNo") or "0").strip() or "0"
    return f"class_curriculum_{year}_{grade}_{class_no}"


def execution_key(settings: dict) -> str:
    year = _int(settings.get("schoolYear"), date.today().year)
    grade = _int(settings.get("grade"), 0)
    class_no = str(settings.get("classNo") or "0").strip() or "0"
    return f"lesson_execution_{year}_{grade}_{class_no}"


def subject_order_key(settings: dict) -> str:
    """화면에서 정한 담임 개설과목 순서를 출력·집계에서도 그대로 사용한다."""
    year = _int(settings.get("schoolYear"), date.today().year)
    grade = _int(settings.get("grade"), 0)
    class_no = str(settings.get("classNo") or "0").strip() or "0"
    return f"subject_order_{year}_{grade}_{class_no}"


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


def load_execution(db: Database) -> dict:
    settings = db.get("settings", "global") or {}
    key = execution_key(settings)
    rec = db.get("settings", key) or {}
    return {
        "id": key,
        "mode": "actual" if rec.get("mode") == "actual" else "estimated",
        "items": rec.get("items") or {},
        "updatedAt": rec.get("updatedAt") or "",
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
        return {"국어": "국어", "수학": "수학", "바른생활": "바른 생활", "슬기로운생활": "슬기로운 생활", "즐거운생활": "즐거운 생활"}.get(n, subject_name)
    if n == "국어": return "국어"
    if n in ("사회", "도덕"): return "사회/도덕"
    if n == "수학": return "수학"
    if n in ("과학", "실과"): return "과학/실과"
    if n == "체육": return "체육"
    if n in ("음악", "미술"): return "예술(음악/미술)"
    if n == "영어": return "영어"
    return subject_name


def _configured_subjects(db: Database) -> list[dict]:
    subjects = [s for s in db.get_all("subjects") if str(s.get("name") or s.get("shortName") or "").strip()]
    settings = db.get("settings", "global") or {}
    order_rec = db.get("settings", subject_order_key(settings)) or {}
    order = [str(v) for v in (order_rec.get("order") or [])]
    if not order:
        return subjects
    rank = {sid: i for i, sid in enumerate(order)}
    raw_rank = {str(s.get("subjectId") or ""): i for i, s in enumerate(subjects)}
    subjects.sort(key=lambda s: rank.get(
        str(s.get("subjectId") or ""),
        len(order) + raw_rank.get(str(s.get("subjectId") or ""), 0),
    ))
    return subjects


def _subject_index(subjects: list[dict]) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for subject in subjects:
        for value in (subject.get("subjectId"), subject.get("name"), subject.get("shortName")):
            key = _norm(value)
            if key:
                idx.setdefault(key, subject)
    return idx


def _resolve_subject(value, idx: dict[str, dict]) -> dict | None:
    return idx.get(_norm(value))


def _resolve_lesson_subject(lesson: dict, idx: dict[str, dict]) -> dict | None:
    return (_resolve_subject(lesson.get("subjectId"), idx)
            or _resolve_subject(lesson.get("name"), idx)
            or _resolve_subject(lesson.get("subjectName"), idx)
            or _resolve_subject(lesson.get("subjectShort"), idx))


def _evaluation_counts(db: Database, subjects: list[dict]) -> tuple[dict, dict]:
    idx = _subject_index(subjects)
    legacy = defaultdict(int)
    performance = defaultdict(int)
    for plan in db.get_all("eval_plans"):
        subject = _resolve_subject(plan.get("subjectId"), idx) or _resolve_subject(plan.get("subjectName"), idx)
        if subject:
            key = str(subject.get("subjectId") or subject.get("shortName") or subject.get("name"))
            legacy[key] += 1
    for plan in db.get_all("assessment_plans"):
        subject = (_resolve_subject(plan.get("subjectId"), idx)
                   or _resolve_subject(plan.get("subjectName"), idx)
                   or _resolve_subject(plan.get("subjectShort"), idx))
        if subject:
            key = str(subject.get("subjectId") or subject.get("shortName") or subject.get("name"))
            performance[key] += 1
    return legacy, performance


def _execution_status(execution: dict, day: str, period, lesson: dict) -> str:
    item = (execution.get("items") or {}).get(f"{day}#{period}") or {}
    # 시간표가 바뀌었는데 과거 상태가 같은 날짜·교시에 남아 있는 경우 잘못 세지 않는다.
    saved_subject = _norm(item.get("subject"))
    current_subject = _norm(lesson.get("name") or lesson.get("subjectShort") or lesson.get("subjectName"))
    if saved_subject and current_subject and saved_subject != current_subject:
        return ""
    status = str(item.get("status") or "").strip().lower()
    return status if status in DONE_STATUSES | {"cancelled"} else ""


def subject_rows(db: Database, as_of: str | None = None) -> list[dict]:
    settings = db.get("settings", "global") or {}
    school_plan = load_plan(db)["schoolPlan"]
    execution = load_execution(db)
    mode = execution["mode"]
    as_of = as_of or date.today().isoformat()
    subjects = _configured_subjects(db)
    idx = _subject_index(subjects)
    counts = defaultdict(lambda: {
        "t1": 0, "t2": 0, "other": 0, "scheduled": 0,
        "expected": 0, "completed": 0, "unconfirmedPast": 0, "cancelled": 0,
        "contentLessons": 0,
    })

    for day in db.get_all("annual_schedule"):
        day_str = str(day.get("date") or "")
        term = _term_of(settings, day_str)
        for lesson in day.get("subjects") or []:
            subject = _resolve_lesson_subject(lesson, idx)
            if not subject:
                continue
            key = str(subject.get("subjectId") or subject.get("shortName") or subject.get("name"))
            c = counts[key]
            c["scheduled"] += 1
            if term == 1: c["t1"] += 1
            elif term == 2: c["t2"] += 1
            else: c["other"] += 1
            if any(str(lesson.get(field) or "").strip() for field in ("unit", "objective", "content", "standard")):
                c["contentLessons"] += 1

            past = bool(day_str and day_str <= as_of)
            status = _execution_status(execution, day_str, lesson.get("period"), lesson)
            if past and status != "cancelled":
                c["expected"] += 1
            if status == "cancelled":
                c["cancelled"] += 1
            if mode == "actual":
                if status in DONE_STATUSES:
                    c["completed"] += 1
                elif past and not status:
                    c["unconfirmedPast"] += 1
            elif past and status != "cancelled":
                # 이전 버전 데이터는 실제 실시 상태가 없으므로 일정상 이수 추정으로 호환한다.
                c["completed"] += 1

    eval_counts, assessment_counts = _evaluation_counts(db, subjects)
    rows = []
    for subject in subjects:
        name = str(subject.get("name") or "")
        short = str(subject.get("shortName") or name)
        key = str(subject.get("subjectId") or short or name)
        c = counts[key]
        raw = school_plan.get(name, school_plan.get(short, ""))
        school = _int(raw, 0) if str(raw).strip() != "" else None
        diff = c["scheduled"] - school if school is not None else None
        coverage = round(c["contentLessons"] / c["scheduled"] * 100, 1) if c["scheduled"] else 0
        rows.append({
            "subjectId": subject.get("subjectId"), "name": name, "short": short,
            "schoolPlan": school, "t1": c["t1"], "t2": c["t2"], "other": c["other"],
            "scheduled": c["scheduled"], "expected": c["expected"], "completed": c["completed"],
            "unconfirmedPast": c["unconfirmedPast"], "cancelled": c["cancelled"],
            "remaining": max(c["scheduled"] - c["completed"] - c["cancelled"], 0),
            "diff": diff, "contentLessons": c["contentLessons"], "contentCoverage": coverage,
            "evalPlans": eval_counts.get(key, 0), "assessmentPlans": assessment_counts.get(key, 0),
            "group": subject_group(name, settings.get("grade")),
        })
    return rows


def national_rows(db: Database, as_of: str | None = None) -> list[dict]:
    settings = db.get("settings", "global") or {}
    ref = NATIONAL_2022[grade_band(settings.get("grade"))]
    subjects = subject_rows(db, as_of)
    sums = defaultdict(lambda: {"schoolPlan": 0, "scheduled": 0, "completed": 0, "unconfirmedPast": 0})
    has_plan = defaultdict(bool)
    for row in subjects:
        group = row["group"]
        if row["schoolPlan"] is not None:
            sums[group]["schoolPlan"] += row["schoolPlan"]
            has_plan[group] = True
        sums[group]["scheduled"] += row["scheduled"]
        sums[group]["completed"] += row["completed"]
        sums[group]["unconfirmedPast"] += row["unconfirmedPast"]
    rows = []
    for group, national in ref.items():
        if group == "총 수업시간":
            continue
        rows.append({
            "group": group, "nationalBand": national,
            "schoolPlan": sums[group]["schoolPlan"] if has_plan[group] else None,
            "scheduled": sums[group]["scheduled"], "completed": sums[group]["completed"],
            "unconfirmedPast": sums[group]["unconfirmedPast"],
        })
    rows.append({
        "group": "합계", "nationalBand": ref["총 수업시간"],
        "schoolPlan": sum(row["schoolPlan"] or 0 for row in subjects) if any(row["schoolPlan"] is not None for row in subjects) else None,
        "scheduled": sum(row["scheduled"] for row in subjects),
        "completed": sum(row["completed"] for row in subjects),
        "unconfirmedPast": sum(row["unconfirmedPast"] for row in subjects),
    })
    return rows


def _period_rows(db: Database, mode: str) -> dict:
    """주/월별 계획 시수. 과목설정 전체를 열로 유지한다."""
    configured = _configured_subjects(db)
    idx = _subject_index(configured)
    subjects = [(str(s.get("subjectId") or s.get("shortName") or s.get("name") or ""), str(s.get("name") or s.get("shortName") or "")) for s in configured]
    data = defaultdict(lambda: defaultdict(int))
    date_meta = {}
    for day in db.get_all("annual_schedule"):
        day_str = str(day.get("date") or "")
        if not day_str:
            continue
        try:
            parsed = date.fromisoformat(day_str)
        except ValueError:
            continue
        if mode == "month":
            key = f"{parsed.year:04d}-{parsed.month:02d}"
            date_meta[key] = {"label": f"{parsed.year}년 {parsed.month}월", "start": f"{parsed.year:04d}-{parsed.month:02d}-01", "end": ""}
        else:
            monday = parsed - timedelta(days=parsed.weekday())
            friday = monday + timedelta(days=4)
            iso = parsed.isocalendar()
            key = f"{iso.year:04d}-W{iso.week:02d}"
            date_meta[key] = {"label": "", "start": monday.isoformat(), "end": friday.isoformat()}
        for lesson in day.get("subjects") or []:
            subject = _resolve_lesson_subject(lesson, idx)
            if not subject:
                continue
            skey = str(subject.get("subjectId") or subject.get("shortName") or subject.get("name") or "")
            data[key][skey] += 1
    rows = []
    for key in sorted(data):
        values = [data[key].get(skey, 0) for skey, _ in subjects]
        rows.append({"key": key, **date_meta[key], "values": values, "total": sum(values)})
    if mode == "week":
        for i, row in enumerate(rows, 1):
            row["label"] = f"제{i}주"
    return {"subjects": [name for _, name in subjects], "keys": [skey for skey, _ in subjects], "rows": rows}


def weekly_rows(db: Database) -> dict:
    return _period_rows(db, "week")


def monthly_rows(db: Database) -> dict:
    return _period_rows(db, "month")


def snapshot(db: Database, as_of: str | None = None) -> dict:
    settings = db.get("settings", "global") or {}
    execution = load_execution(db)
    return {
        "schoolYear": _int(settings.get("schoolYear"), date.today().year),
        "grade": _int(settings.get("grade"), 0),
        "band": grade_band(settings.get("grade")),
        "asOf": as_of or date.today().isoformat(),
        "plan": load_plan(db),
        "classRecord": load_class_record(db),
        "execution": execution,
        "executionMode": execution["mode"],
        "national": national_rows(db, as_of),
        "subjects": subject_rows(db, as_of),
        "weekly": weekly_rows(db),
        "monthly": monthly_rows(db),
    }
