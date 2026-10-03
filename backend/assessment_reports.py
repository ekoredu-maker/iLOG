"""수행평가 계획 HWPX 출력.

assessment_plans / assessment_tasks / assessment_rubrics 에 저장된 자료를
학교 제출·보관에 적합한 A4 한글(HWPX) 문서로 만든다.
묶음 출력은 첫 장에 정보공시 제출용 교과별 평가계획 요약표를 붙인다.
"""
from __future__ import annotations

import re
from datetime import date

from .db import Database
from .hwpx_builder import HwpxBuilder


def _safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "_", str(name or "")).strip() or "수행평가"


def _class_header(settings: dict) -> str:
    year = settings.get("schoolYear") or date.today().year
    school = settings.get("schoolName") or ""
    grade = settings.get("grade") or ""
    class_no = settings.get("classNo") or ""
    teacher = settings.get("teacherName") or ""
    parts = [f"{year}학년도"]
    if school:
        parts.append(str(school))
    if grade or class_no:
        parts.append(f"{grade}학년 {class_no}반")
    if teacher:
        parts.append(f"담임 {teacher}")
    return "  ·  ".join(parts)


def _public_header(settings: dict, term: int | None = None) -> str:
    year = settings.get("schoolYear") or date.today().year
    school = settings.get("schoolName") or ""
    grade = settings.get("grade") or ""
    bits = [f"{year}학년도"]
    if school:
        bits.append(str(school))
    if grade:
        bits.append(f"{grade}학년")
    if term in (1, 2):
        bits.append(f"{term}학기")
    return "  ·  ".join(bits)


def _bundle(db: Database, plan_id: str) -> tuple[dict, list[dict], list[dict], dict]:
    plan = db.get("assessment_plans", plan_id)
    if not plan:
        raise ValueError("수행평가 계획을 찾을 수 없습니다.")
    tasks = db.query("assessment_tasks", "planId", plan_id)
    rubrics = sorted(db.query("assessment_rubrics", "planId", plan_id), key=lambda r: int(r.get("order") or 0))
    settings = db.get("settings", "global") or {}
    return plan, tasks, rubrics, settings


def _summary_row(db: Database, plan: dict) -> list[str]:
    tasks = db.query("assessment_tasks", "planId", plan.get("planId"))
    rubrics = sorted(db.query("assessment_rubrics", "planId", plan.get("planId")), key=lambda r: int(r.get("order") or 0))
    task = tasks[0] if tasks else {}
    rubric = "\n".join(
        f"{r.get('level') or ''}: {r.get('descriptor') or ''}".strip(": ")
        for r in rubrics if r.get("level") or r.get("descriptor")
    )
    term = plan.get("term")
    subject = plan.get("subjectName") or plan.get("subjectShort") or ""
    first = f"{subject}\n{term}학기" if str(term) in ("1", "2") else subject
    second = "\n".join(x for x in [plan.get("unit") or "", plan.get("title") or "", plan.get("date") or ""] if x)
    third = "\n".join(x for x in [plan.get("standard") or "", plan.get("objective") or ""] if x)
    method = " / ".join(x for x in [plan.get("domain") or "", plan.get("method") or ""] if x)
    fourth = "\n".join(x for x in [method, task.get("description") or "", rubric] if x)
    return [first, second, third, fourth]


def _append_disclosure_summary(b: HwpxBuilder, db: Database, plans: list[dict], settings: dict, term: int | None = None) -> None:
    b.title("교과별 평가계획", size=19, after=4)
    b.para("정보공시 제출용 정리본", align="CENTER", bold=True, size=11, color="#5F4E67", after=4)
    b.para(_public_header(settings, term), align="RIGHT", size=9.5, color="#555555", after=6)
    b.para(
        "학생 개인별 평가결과는 포함하지 않고, 저장된 수행평가 계획의 교과·단원·성취기준·평가방법·평가기준만 정리합니다.",
        size=8.8, color="#555555", after=4, line=135,
    )
    rows = [["교과·학기", "단원·평가명·시기", "성취기준·학습목표", "평가방법·수행과제·평가기준"]]
    rows += [_summary_row(db, p) for p in plans]
    b.table(rows, [27, 39, 48, 56], header_rows=1,
            align=["CENTER", "LEFT", "LEFT", "LEFT"], size=8.3, min_height_mm=9)
    b.para(
        "※ 공시 항목과 제출 형식은 해당 학년도 학교·교육청의 정보공시 안내를 최종 확인한 뒤 사용하세요.",
        size=8.3, color="#666666", before=4, after=0, line=130,
    )


def _append_plan(b: HwpxBuilder, plan: dict, tasks: list[dict], rubrics: list[dict], settings: dict, *, page_break: bool = False) -> None:
    b.title("수행평가 계획", size=18, page_break=page_break, after=4)
    b.para(_class_header(settings), align="RIGHT", size=9.5, color="#555555", after=6)

    term = plan.get("term")
    term_label = f"{term}학기" if term in (1, 2, "1", "2") else ""
    b.table([
        ["교과", plan.get("subjectName") or plan.get("subjectShort") or "", "학기", term_label],
        ["단원", plan.get("unit") or "", "평가 시기", plan.get("date") or ""],
        ["평가명", plan.get("title") or "", "평가 영역", plan.get("domain") or ""],
        ["평가 방법", plan.get("method") or "", "작성 상태", "학생평가 연결" if plan.get("legacyEvalPlanId") else "계획"],
    ], [24, 61, 24, 61], header_cols=0, align=["CENTER", "LEFT", "CENTER", "LEFT"], size=9.5,
       bold_cells=[(r, c) for r in range(4) for c in (0, 2)])
    b.para("", size=2, after=1)
    b.table([
        ["성취기준", plan.get("standard") or ""],
        ["학습목표", plan.get("objective") or ""],
    ], [30, 140], header_cols=1, align=["CENTER", "LEFT"], size=9.5, min_height_mm=12)

    task = tasks[0] if tasks else {}
    b.para("1. 수행과제", bold=True, size=12, before=6, after=3)
    b.table([
        ["과제명", task.get("title") or ""],
        ["수행과제", task.get("description") or ""],
        ["평가 증거·유의점", task.get("evidence") or ""],
    ], [30, 140], header_cols=1, align=["CENTER", "LEFT"], size=9.5, min_height_mm=11)

    b.para("2. 평가기준", bold=True, size=12, before=6, after=3)
    rubric_rows = [["수준", "평가 기준"]]
    if rubrics:
        rubric_rows += [[r.get("level") or "", r.get("descriptor") or ""] for r in rubrics]
    else:
        rubric_rows += [["", "평가기준 미입력"]]
    b.table(rubric_rows, [32, 138], header_rows=1, align=["CENTER", "LEFT"], size=9.5, min_height_mm=10)

    refs = plan.get("lessonRefs") or []
    if refs:
        b.para("3. 지도계획 연계 근거", bold=True, size=12, before=6, after=3)
        rows = [["날짜", "교시", "차시", "주요 학습내용"]]
        for r in refs[:30]:
            rows.append([r.get("date") or "", r.get("period") or "", r.get("lessonSeq") or "", r.get("content") or ""])
        b.table(rows, [30, 18, 18, 104], header_rows=1, align=["CENTER", "CENTER", "CENTER", "LEFT"], size=8.5, min_height_mm=7)
        if len(refs) > 30:
            b.para(f"※ 연결 차시가 많아 앞 30개만 표시했습니다. 전체 연결 차시: {len(refs)}개", size=8.5, color="#666666")

    b.para("※ 본 계획은 iLOG의 연간 지도계획 및 교사 입력 자료를 바탕으로 작성되었습니다. 최종 제출 전 학교의 해당 학년도 평가계획 지침을 확인하세요.",
           size=8.5, color="#666666", before=5, after=0, line=135)


def assessment_plan_hwpx(db: Database, plan_id: str) -> tuple[str, bytes]:
    plan, tasks, rubrics, settings = _bundle(db, plan_id)
    b = HwpxBuilder()
    _append_plan(b, plan, tasks, rubrics, settings)
    subject = _safe(plan.get("subjectName") or plan.get("subjectShort") or "교과")
    title = _safe(plan.get("title") or "수행평가")
    return f"수행평가계획_{subject}_{title}.hwpx", b.to_bytes()


def assessment_plans_hwpx(db: Database, term: int | None = None) -> tuple[str, bytes]:
    plans = db.get_all("assessment_plans")
    if term in (1, 2):
        plans = [p for p in plans if int(p.get("term") or 0) == term]
    plans.sort(key=lambda p: (p.get("date") or "9999-99-99", p.get("subjectName") or "", p.get("title") or ""))
    if not plans:
        raise ValueError("출력할 수행평가 계획이 없습니다.")
    settings = db.get("settings", "global") or {}
    b = HwpxBuilder()
    _append_disclosure_summary(b, db, plans, settings, term)
    for plan in plans:
        tasks = db.query("assessment_tasks", "planId", plan["planId"])
        rubrics = sorted(db.query("assessment_rubrics", "planId", plan["planId"]), key=lambda r: int(r.get("order") or 0))
        _append_plan(b, plan, tasks, rubrics, settings, page_break=True)
    suffix = f"_{term}학기" if term in (1, 2) else "_전체"
    return f"교과별_평가계획{suffix}.hwpx", b.to_bytes()
