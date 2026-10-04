"""학급교육과정 종합 HWPX 출력.

학급교육과정 기록, 편성·계획·이수 시수, 기초시간표, 교과별 연간 지도계획,
평가계획을 하나의 문서로 묶는다. 학생 개인정보·평가결과는 포함하지 않는다.
"""
from __future__ import annotations

import re
from datetime import date

from .db import Database
from .hwpx_builder import HwpxBuilder
from . import instruction_hours as ih


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


def _safe(value: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "_", str(value or "")).strip() or "학급교육과정"


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


def class_curriculum_hwpx(db: Database) -> tuple[str, bytes]:
    settings = db.get("settings", "global") or {}
    snap = ih.snapshot(db)
    lookup = _subject_lookup(db)
    b = HwpxBuilder()

    b.title("학급교육과정", size=22, after=5)
    b.para(_header(settings), align="CENTER", bold=True, size=11.5, color="#4F4654", after=10)
    mode = "실제 실시상태 기준" if snap["executionMode"] == "actual" else "연간시간표 날짜 기준 추정"
    b.para(f"교육과정 이수시수 산정 방식: {mode}", align="RIGHT", size=8.5, color="#666666", after=8)

    # 1. 학급교육과정 기본 기록
    b.para("1. 학급교육과정 기본 계획", bold=True, size=14, after=4)
    record = snap["classRecord"]
    rows = [["항목", "내용"]]
    rows += [[label, record.get(key) or "-"] for key, label in RECORD_FIELDS]
    b.table(rows, [38, 132], header_rows=1, align=["CENTER", "LEFT"], size=9, min_height_mm=9)

    # 2. 교육과정 편성·계획·이수
    b.title("2. 교육과정 편성·계획·이수", size=15, page_break=True, after=4)
    b.para(f"국가 기준은 {snap['band']}학년군 2년간 시간 배당 기준이며, 학교 편성은 당해 학년 학교교육과정 입력값입니다.", size=8.8, color="#555555", after=4)
    nrows = [["교과(군)", "국가 학년군 기준", "학교 편성합", "연간 계획", "이수", "과거 미확인"]]
    for r in snap["national"]:
        nrows.append([r["group"], r["nationalBand"], r["schoolPlan"] if r["schoolPlan"] is not None else "-", r["scheduled"], r["completed"], r.get("unconfirmedPast", 0)])
    b.table(nrows, [42, 30, 28, 24, 22, 24], header_rows=1, align=["LEFT", "CENTER", "CENTER", "CENTER", "CENTER", "CENTER"], size=8.5, min_height_mm=7)

    b.para("당해 학년 과목별 편성·운영", bold=True, size=11.5, before=6, after=3)
    srows = [["과목", "학교 편성", "연간 계획", "1학기", "2학기", "지도내용", "이수", "미확인", "평가", "수행평가"]]
    for r in snap["subjects"]:
        srows.append([r["name"], r["schoolPlan"] if r["schoolPlan"] is not None else "-", r["scheduled"], r["t1"], r["t2"], f"{r['contentLessons']}/{r['scheduled']}", r["completed"], r.get("unconfirmedPast", 0), r["evalPlans"], r["assessmentPlans"]])
    b.table(srows, [24, 18, 18, 13, 13, 20, 13, 14, 13, 15], header_rows=1, align=["LEFT"]+["CENTER"]*9, size=7.7, min_height_mm=6)

    # 3. 주간 기초시간표
    b.title("3. 주간 기초시간표", size=15, page_break=True, after=4)
    grid = (db.get("timetable_weekly", "weekly") or {}).get("grid") or {}
    periods = int(settings.get("periodsPerDay") or 6)
    trows = [["교시"] + [label for _, label in DAYS]]
    for p in range(1, periods + 1):
        row = [f"{p}교시"]
        for key, _ in DAYS:
            cell = grid.get(f"{key}-{p}") or {}
            row.append(_full_subject(lookup, cell.get("name")))
        trows.append(row)
    b.table(trows, [22, 29.6, 29.6, 29.6, 29.6, 29.6], header_rows=1, header_cols=1, align="CENTER", size=9, min_height_mm=8)

    # 4. 교과별 연간 지도계획
    annual = sorted(db.get_all("annual_schedule"), key=lambda x: x.get("date") or "")
    execution = snap["execution"]
    for subject in snap["subjects"]:
        short = subject["short"]
        name = subject["name"]
        rows = []
        for day in annual:
            ds = day.get("date") or ""
            for lesson in sorted(day.get("subjects") or [], key=lambda x: int(x.get("period") or 0)):
                if str(lesson.get("name") or "") not in (short, name):
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
        b.title(f"4. {name} 연간 지도계획", size=14, page_break=True, after=4)
        if not rows:
            b.para("연간시간표에 배치된 차시가 없습니다.", size=10, color="#666666")
            continue
        table = [["날짜", "교시", "차시", "영역", "단원·주제", "성취기준", "학습목표", "지도내용", "실시"]] + rows
        # A4 본문 폭 170mm 안에서 고정하여 한글에서 열었을 때 표가 잘리지 않게 한다.
        b.table(table, [17, 8, 8, 13, 21, 28, 30, 32, 13], header_rows=1,
                align=["CENTER", "CENTER", "CENTER", "LEFT", "LEFT", "LEFT", "LEFT", "LEFT", "CENTER"],
                size=6.9, min_height_mm=5)

    # 5. 수행평가·교과평가 계획
    b.title("5. 교수·학습 및 평가 계획", size=15, page_break=True, after=4)
    plans = sorted(db.get_all("assessment_plans"), key=lambda x: (x.get("subjectName") or "", x.get("date") or ""))
    erows = [["교과", "학기", "단원", "평가명", "시기", "영역", "방법", "성취기준", "학습목표"]]
    for p in plans:
        erows.append([p.get("subjectName") or p.get("subjectShort") or "", p.get("term") or "", p.get("unit") or "", p.get("title") or "", p.get("date") or "", p.get("domain") or "", p.get("method") or "", p.get("standard") or "", p.get("objective") or ""])
    if len(erows) == 1:
        erows.append(["", "", "", "등록된 수행평가 계획 없음", "", "", "", "", ""])
    b.table(erows, [16, 8, 20, 22, 14, 14, 16, 30, 30], header_rows=1,
            align=["CENTER", "CENTER", "LEFT", "LEFT", "CENTER", "CENTER", "CENTER", "LEFT", "LEFT"], size=7.1, min_height_mm=6)

    b.para("※ 본 문서는 iLOG에 저장된 학교 편성시수·연간지도계획·평가계획·수업 실시상태를 바탕으로 자동 작성되었습니다. 최종 결재·보관 전 학교교육과정 및 해당 학년도 지침과 대조하세요.", size=8.2, color="#666666", before=6, after=0, line=130)

    school = _safe(settings.get("schoolName") or "학교")
    grade = _safe(settings.get("grade") or "")
    class_no = _safe(settings.get("classNo") or "")
    year = settings.get("schoolYear") or date.today().year
    return f"학급교육과정_{year}_{school}_{grade}학년_{class_no}반.hwpx", b.to_bytes()
