"""학급교육과정과 학급경영 기록을 한 문서로 묶는 HWPX 출력.

담임 개설과목을 하나의 축으로 하여 편성시수·연간지도계획·평가·이수와
학생 명렬·평가·출결·상담·체험학습을 함께 출력한다.
학생 사안 기록은 민감정보이므로 HWPX 기본 출력에서는 제외한다.
"""
from __future__ import annotations

import re
from datetime import date

from .db import Database
from .hwpx_builder import HwpxBuilder
from . import instruction_hours as ih
from . import reports


RECORD_FIELDS = [
    ("classVision", "학급 교육 비전"),
    ("classGoals", "학급 교육 목표"),
    ("focus", "학급 운영 중점"),
    ("studentProfile", "학생·학급 실태 및 교육적 요구"),
    ("curriculumPrinciples", "교육과정 재구성·운영 원칙"),
    ("creativeActivities", "창의적 체험활동 운영"),
    ("schoolAutonomy", "학교자율시간 운영"),
    ("crossCurricular", "범교과·안전·인성 등 연계 계획"),
    ("assessmentPolicy", "교수·학습 및 평가 운영 방침"),
    ("reflection", "학기·학년도 운영 성찰"),
    ("changes", "교육과정 변경·보완 기록"),
]
DAYS = [("mon", "월"), ("tue", "화"), ("wed", "수"), ("thu", "목"), ("fri", "금")]
STATUS_LABEL = {"done": "실시", "cancelled": "미실시", "makeup": "보강", "substitute": "대체"}
EXP_STATUS = {"requested": "신청", "approved": "승인", "denied": "불허"}


def _safe(value: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "_", str(value or "")).strip() or "학급경영록"


def _header(settings: dict) -> str:
    year = settings.get("schoolYear") or date.today().year
    school = settings.get("schoolName") or ""
    grade = settings.get("grade") or ""
    class_no = settings.get("classNo") or ""
    teacher = settings.get("teacherName") or ""
    parts = [f"{year}학년도"]
    if school: parts.append(str(school))
    if grade or class_no: parts.append(f"{grade}학년 {class_no}반")
    if teacher: parts.append(f"담임 {teacher}")
    return "  ·  ".join(parts)


def _subject_lookup(db: Database) -> dict[str, str]:
    out = {}
    for s in db.get_all("subjects"):
        name = str(s.get("name") or s.get("shortName") or "")
        for key in (s.get("subjectId"), s.get("name"), s.get("shortName")):
            if key:
                out[str(key).replace(" ", "")] = name
    return out


def _full_subject(lookup: dict[str, str], value) -> str:
    return lookup.get(str(value or "").replace(" ", ""), str(value or ""))


def _status(execution: dict, day: str, lesson: dict) -> str:
    item = (execution.get("items") or {}).get(f"{day}#{lesson.get('period')}") or {}
    saved = str(item.get("subject") or "").replace(" ", "")
    current = str(lesson.get("name") or "").replace(" ", "")
    if saved and current and saved != current:
        return ""
    return str(item.get("status") or "")


def _weekly_table(b: HwpxBuilder, snap: dict) -> None:
    weekly = snap["weekly"]
    subjects = weekly["subjects"]
    rows = [["주", "기간", *subjects, "합계"]]
    rows += [[r["label"], f"{r['start']}~{r['end']}", *r["values"], r["total"]] for r in weekly["rows"]]
    if len(rows) == 1:
        rows.append(["-", "연간시간표 없음", *([0] * len(subjects)), 0])
    fixed = 14 + 28 + 10
    each = max(8, (170 - fixed) / max(len(subjects), 1))
    widths = [14, 28] + [each] * len(subjects) + [10]
    b.table(rows, widths, header_rows=1, align=["CENTER"] * len(widths), size=6.8 if len(subjects) >= 8 else 7.8, min_height_mm=6)


def _monthly_table(b: HwpxBuilder, snap: dict) -> None:
    monthly = snap["monthly"]
    subjects = monthly["subjects"]
    rows = [["월", *subjects, "합계"]]
    rows += [[r["label"], *r["values"], r["total"]] for r in monthly["rows"]]
    if len(rows) == 1:
        rows.append(["계획 없음", *([0] * len(subjects)), 0])
    fixed = 24 + 10
    each = max(8, (170 - fixed) / max(len(subjects), 1))
    widths = [24] + [each] * len(subjects) + [10]
    b.table(rows, widths, header_rows=1, align=["CENTER"] * len(widths), size=6.8 if len(subjects) >= 8 else 7.8, min_height_mm=6)


def class_curriculum_hwpx(db: Database) -> tuple[str, bytes]:
    settings = db.get("settings", "global") or {}
    snap = ih.snapshot(db)
    lookup = _subject_lookup(db)
    rd = reports.ReportData(db)
    b = HwpxBuilder()

    # 표지
    b.title("학급경영록", size=22, after=4)
    b.para("학급교육과정 종합 운영·기록", align="CENTER", bold=True, size=13, color="#4F4654", after=5)
    b.para(_header(settings), align="CENTER", bold=True, size=11.5, color="#4F4654", after=10)
    mode = "실제 실시상태 기준" if snap["executionMode"] == "actual" else "연간시간표 날짜 기준 추정"
    b.para(f"교육과정 이수시수 산정 방식: {mode}", align="RIGHT", size=8.5, color="#666666", after=4)
    b.para(f"출력일: {date.today().isoformat()}", align="RIGHT", size=8.5, color="#666666", after=8)

    # 1. 학생 명렬표
    b.title("1. 학생 명렬표", size=15, page_break=True, after=4)
    srows = [["번호", "이름", "성별", "보호자 연락처", "비고"]]
    for s in rd.students:
        srows.append([s.get("number") or "", s.get("name") or "", s.get("gender") or "", s.get("guardianPhone") or "", s.get("note") or ""])
    if len(srows) == 1:
        srows.append(["", "등록된 학생 없음", "", "", ""])
    b.table(srows, [12, 22, 14, 35, 87], header_rows=1, align=["CENTER", "CENTER", "CENTER", "CENTER", "LEFT"], size=8.5, min_height_mm=7)

    # 2. 학급교육과정 기본 기록
    b.title("2. 학급교육과정 기본 계획", size=15, page_break=True, after=4)
    record = snap["classRecord"]
    rows = [["항목", "내용"]]
    rows += [[label, record.get(key) or "-"] for key, label in RECORD_FIELDS]
    b.table(rows, [38, 132], header_rows=1, align=["CENTER", "LEFT"], size=9, min_height_mm=9)

    # 3. 국가 기준 + 담임 개설과목 편성·계획·이수
    b.title("3. 교육과정 편성·계획·이수", size=15, page_break=True, after=4)
    b.para(f"국가 기준은 {snap['band']}학년군 2년간 시간 배당 기준입니다. iLOG에서는 별도의 '학교 과목/담임 과목'으로 나누지 않고 담임 개설과목 하나를 기준으로 편성시수·계획·이수를 연결합니다.", size=8.8, color="#555555", after=4)
    nrows = [["교과(군)", "국가 학년군 기준", "편성시수 합계", "연간 계획", "이수", "과거 미확인"]]
    for r in snap["national"]:
        nrows.append([r["group"], r["nationalBand"], r["schoolPlan"] if r["schoolPlan"] is not None else "-", r["scheduled"], r["completed"], r.get("unconfirmedPast", 0)])
    b.table(nrows, [42, 30, 28, 24, 22, 24], header_rows=1, align=["LEFT", "CENTER", "CENTER", "CENTER", "CENTER", "CENTER"], size=8.3, min_height_mm=7)

    b.para("담임 개설과목별 편성·지도·평가·이수", bold=True, size=11.5, before=6, after=3)
    prows = [["담임 개설과목", "편성시수", "연간 계획", "1학기", "2학기", "지도내용", "이수", "미확인", "평가", "수행평가"]]
    for r in snap["subjects"]:
        prows.append([r["name"], r["schoolPlan"] if r["schoolPlan"] is not None else "-", r["scheduled"], r["t1"], r["t2"], f"{r['contentLessons']}/{r['scheduled']}", r["completed"], r.get("unconfirmedPast", 0), r["evalPlans"], r["assessmentPlans"]])
    if len(prows) == 1:
        prows.append(["등록된 과목 없음", "-", 0, 0, 0, "0/0", 0, 0, 0, 0])
    b.table(prows, [24, 18, 18, 13, 13, 20, 13, 14, 13, 15], header_rows=1, align=["LEFT"]+["CENTER"]*9, size=7.5, min_height_mm=6)

    # 4~5. 주·월별 시수
    b.title("4. 주간 과목별 시수", size=15, page_break=True, after=4)
    _weekly_table(b, snap)
    b.title("5. 월간 과목별 시수", size=15, page_break=True, after=4)
    _monthly_table(b, snap)

    # 6. 주간 기초시간표
    b.title("6. 주간 기초시간표", size=15, page_break=True, after=4)
    grid = (db.get("timetable_weekly", "weekly") or {}).get("grid") or {}
    periods = int(settings.get("periodsPerDay") or 6)
    trows = [["교시"] + [label for _, label in DAYS]]
    for p in range(1, periods + 1):
        row = [f"{p}교시"]
        for key, _ in DAYS:
            cell = grid.get(f"{key}-{p}") or {}
            row.append(_full_subject(lookup, cell.get("id") or cell.get("name")))
        trows.append(row)
    b.table(trows, [22, 29.6, 29.6, 29.6, 29.6, 29.6], header_rows=1, header_cols=1, align="CENTER", size=9, min_height_mm=8)

    # 7. 담임 개설과목별 연간 지도계획
    annual = sorted(db.get_all("annual_schedule"), key=lambda x: x.get("date") or "")
    execution = snap["execution"]
    for subject in snap["subjects"]:
        short = subject["short"]
        name = subject["name"]
        rows = []
        for day in annual:
            ds = day.get("date") or ""
            for lesson in sorted(day.get("subjects") or [], key=lambda x: int(x.get("period") or 0)):
                lesson_name = str(lesson.get("name") or lesson.get("subjectShort") or lesson.get("subjectName") or "")
                if lesson_name.replace(" ", "") not in (str(short).replace(" ", ""), str(name).replace(" ", "")):
                    continue
                status = _status(execution, ds, lesson)
                if snap["executionMode"] != "actual" and ds and ds <= snap["asOf"] and not status:
                    status_text = "추정 이수"
                else:
                    status_text = STATUS_LABEL.get(status, "미확인" if ds and ds <= snap["asOf"] else "예정")
                rows.append([
                    ds, lesson.get("period") or "", lesson.get("lessonSeq") or "",
                    lesson.get("domain") or "", lesson.get("unit") or "",
                    lesson.get("standard") or "", lesson.get("objective") or "",
                    lesson.get("content") or "", status_text,
                ])
        b.title(f"7. {name} 연간 지도계획", size=14, page_break=True, after=4)
        if not rows:
            b.para("연간시간표에 배치된 차시가 없습니다.", size=10, color="#666666")
            continue
        table = [["날짜", "교시", "차시", "영역", "단원·주제", "성취기준", "학습목표", "지도내용", "실시"]] + rows
        b.table(table, [17, 8, 8, 13, 21, 28, 30, 32, 13], header_rows=1,
                align=["CENTER", "CENTER", "CENTER", "LEFT", "LEFT", "LEFT", "LEFT", "LEFT", "CENTER"],
                size=6.8, min_height_mm=5)

    # 8. 교수·학습 및 평가 계획
    b.title("8. 교수·학습 및 평가 계획", size=15, page_break=True, after=4)
    plans = sorted(db.get_all("assessment_plans"), key=lambda x: (x.get("subjectName") or "", x.get("date") or ""))
    erows = [["교과", "학기", "단원", "평가명", "시기", "영역", "방법", "성취기준", "학습목표"]]
    for p in plans:
        erows.append([p.get("subjectName") or p.get("subjectShort") or "", p.get("term") or "", p.get("unit") or "", p.get("title") or "", p.get("date") or "", p.get("domain") or "", p.get("method") or "", p.get("standard") or "", p.get("objective") or ""])
    if len(erows) == 1:
        erows.append(["", "", "", "등록된 수행평가 계획 없음", "", "", "", "", ""])
    b.table(erows, [16, 8, 20, 22, 14, 14, 16, 30, 30], header_rows=1,
            align=["CENTER", "CENTER", "LEFT", "LEFT", "CENTER", "CENTER", "CENTER", "LEFT", "LEFT"], size=7.0, min_height_mm=6)

    # 9. 학생 평가 기록: 기존 교과평가 결과를 계획별로 출력
    b.title("9. 학생 평가 기록", size=15, page_break=True, after=4)
    if not rd.eval_plans:
        b.para("등록된 학생 평가 기록이 없습니다.", size=10, color="#666666")
    for plan in rd.eval_plans:
        b.para(f"[{plan.get('subjectName') or ''}] {plan.get('title') or ''}", bold=True, size=11.5, before=5, after=2)
        b.para(f"시기 {plan.get('date') or '-'} · 영역 {plan.get('domain') or '-'} · 평가요소 {plan.get('element') or '-'} · 방법 {plan.get('method') or '-'}", size=8.3, color="#555555", after=2)
        rows = [["번호", "이름", "평가", "관찰·피드백"]]
        for s in rd.students:
            sc = rd.score_of(plan.get("planId"), s.get("studentId"))
            rows.append([s.get("number") or "", s.get("name") or "", sc.get("score") or sc.get("level") or "", sc.get("note") or sc.get("comment") or ""])
        b.table(rows, [14, 26, 20, 110], header_rows=1, align=["CENTER", "CENTER", "CENTER", "LEFT"], size=8, min_height_mm=6)

    # 10. 학생 출결 상황
    b.title("10. 학생 출결 상황", size=15, page_break=True, after=4)
    arows = [["날짜", "번호", "이름", "구분", "교시", "비고"]]
    for r in rd.attendance_details():
        arows.append([r.get("date") or "", r.get("number") or "", r.get("name") or "", r.get("status") or "", r.get("periods") or "", r.get("note") or ""])
    if len(arows) == 1:
        arows.append(["", "", "", "특이 출결 기록 없음", "", ""])
    b.table(arows, [22, 12, 22, 27, 15, 72], header_rows=1, align=["CENTER", "CENTER", "CENTER", "CENTER", "CENTER", "LEFT"], size=8, min_height_mm=6)

    # 11. 학생 상담 일지
    b.title("11. 학생 상담 일지", size=15, page_break=True, after=4)
    crows = [["날짜", "번호", "학생", "유형", "상담 내용"]]
    for r in rd.counseling:
        crows.append([r.get("date") or "", rd.student_no(r.get("studentId")), rd.student_name(r.get("studentId")), r.get("type") or "", r.get("content") or ""])
    if len(crows) == 1:
        crows.append(["", "", "", "", "등록된 상담 기록 없음"])
    b.table(crows, [22, 12, 23, 25, 88], header_rows=1, align=["CENTER", "CENTER", "CENTER", "CENTER", "LEFT"], size=8, min_height_mm=7)

    # 12. 교외체험학습 현황
    b.title("12. 교외체험학습 현황", size=15, page_break=True, after=4)
    xrows = [["번호", "학생", "기간", "유형", "목적지", "목적", "상태"]]
    for r in rd.experiential:
        sid = r.get("studentId")
        period = r.get("startDate") or ""
        if r.get("endDate") and r.get("endDate") != r.get("startDate"):
            period += f"~{r.get('endDate')}"
        xrows.append([rd.student_no(sid), rd.student_name(sid), period, r.get("type") or "", r.get("destination") or "", r.get("reason") or "", EXP_STATUS.get(r.get("status"), r.get("status") or "")])
    if len(xrows) == 1:
        xrows.append(["", "", "", "", "", "등록된 체험학습 없음", ""])
    b.table(xrows, [12, 20, 28, 24, 32, 38, 16], header_rows=1, align=["CENTER", "CENTER", "CENTER", "CENTER", "LEFT", "LEFT", "CENTER"], size=7.6, min_height_mm=7)

    b.para("※ 본 문서는 iLOG의 담임 개설과목·편성시수·연간지도계획·평가·수업 실시상태와 학급 운영 기록을 바탕으로 자동 작성되었습니다. 국가수준 기본 지도내용은 2022 개정 교육과정 내용체계를 바탕으로 한 출판사 독립형 요약·재구성 자료이므로, 최종 결재·보관 전 학교교육과정과 채택 교과서 및 해당 학년도 지침을 확인하세요.", size=8.1, color="#666666", before=6, after=0, line=130)

    school = _safe(settings.get("schoolName") or "학교")
    grade = _safe(settings.get("grade") or "")
    class_no = _safe(settings.get("classNo") or "")
    year = settings.get("schoolYear") or date.today().year
    return f"학급경영록_{year}_{school}_{grade}학년_{class_no}반.hwpx", b.to_bytes()
