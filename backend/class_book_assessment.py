"""학급경영록 출력에 수행평가 계획을 자동 포함한다.

기존 reports.py의 안정된 출력 코드는 그대로 두고, 생성된 결과에
'수행평가계획' 영역만 추가하는 얇은 확장 계층이다.
"""
from __future__ import annotations

import io

from openpyxl import load_workbook

from . import reports
from .db import Database
from .excel_io import setup_print, workbook_bytes


def _assessment_rows(db: Database) -> list[list]:
    plans = sorted(db.get_all("assessment_plans"), key=lambda p: (p.get("date") or "9999-99-99", p.get("subjectName") or ""))
    rows = []
    for p in plans:
        tasks = db.query("assessment_tasks", "planId", p.get("planId"))
        rubrics = sorted(db.query("assessment_rubrics", "planId", p.get("planId")), key=lambda r: int(r.get("order") or 0))
        task = tasks[0] if tasks else {}
        rubric_text = "\n".join(f"{r.get('level') or ''}: {r.get('descriptor') or ''}" for r in rubrics if r.get("level") or r.get("descriptor"))
        term = p.get("term")
        rows.append([
            p.get("subjectName") or p.get("subjectShort") or "",
            f"{term}학기" if str(term) in ("1", "2") else "",
            p.get("unit") or "",
            p.get("title") or "",
            p.get("date") or "",
            p.get("domain") or "",
            p.get("method") or "",
            p.get("standard") or "",
            p.get("objective") or "",
            task.get("title") or "",
            task.get("description") or "",
            rubric_text,
        ])
    return rows


def class_book_xlsx(db: Database, include_incidents: bool = False) -> bytes:
    base = reports.class_book_xlsx(db, include_incidents)
    wb = load_workbook(io.BytesIO(base))
    rd = reports.ReportData(db)
    rows = _assessment_rows(db)

    # 지도계획 바로 뒤에 수행평가 계획을 배치한다.
    idx = 0
    for i, ws0 in enumerate(wb.worksheets):
        if ws0.title == "지도계획":
            idx = i + 1
            break
    ws = wb.create_sheet("수행평가계획", idx)
    headers = ["과목", "학기", "단원", "평가명", "시기", "영역", "방법", "성취기준", "학습목표", "수행과제명", "수행과제", "평가기준"]
    reports._title(ws, "수행평가 계획", rd.header_line, len(headers))
    if not rows:
        rows = [["", "", "", "등록된 수행평가 계획 없음", "", "", "", "", "", "", "", ""]]
    reports._table(ws, 4, headers, rows,
                   [10, 7, 20, 24, 12, 10, 11, 34, 34, 22, 45, 48],
                   center_cols=(1, 2, 5, 6, 7))
    ws.freeze_panes = "A5"
    ws.auto_filter.ref = f"A4:L{4 + max(len(rows), 1)}"
    setup_print(ws, landscape=True, title_rows="4:4", header_text="수행평가 계획")
    return workbook_bytes(wb)


def _assessment_html(db: Database) -> str:
    rows = _assessment_rows(db)
    if not rows:
        return '<h2 class="page-break">5. 수행평가 계획</h2><p class="empty">등록된 수행평가 계획이 없습니다.</p>'
    out = ['<h2 class="page-break">5. 수행평가 계획</h2>']
    for r in rows:
        out.append(f"<h3>[{reports.esc(r[0])}] {reports.esc(r[3])}</h3>")
        out.append(
            '<div class="infobox">'
            f'학기: {reports.esc(r[1] or "-")} · 단원: {reports.esc(r[2] or "-")} · 시기: {reports.esc(r[4] or "-")}<br>'
            f'영역: {reports.esc(r[5] or "-")} · 방법: {reports.esc(r[6] or "-")}<br>'
            f'성취기준: {reports.esc(r[7] or "-")}<br>학습목표: {reports.esc(r[8] or "-")}'
            '</div>'
        )
        out.append(reports._html_table(
            ["수행과제명", "수행과제", "평가기준"], [[r[9], r[10], r[11]]],
            ["20%", "42%", "38%"], empty="계획 없음"))
    return "".join(out)


def class_book_html(db: Database, include_incidents: bool = False) -> str:
    html = reports.class_book_html(db, include_incidents)
    marker = '<h2 class="page-break">5. 학생 평가 기록</h2>'
    if marker not in html:
        return html
    html = html.replace(marker, _assessment_html(db) + '<h2 class="page-break">6. 학생 평가 기록</h2>', 1)
    html = html.replace('<h2 class="page-break">6. 학생 출결 상황</h2>', '<h2 class="page-break">7. 학생 출결 상황</h2>', 1)
    html = html.replace('<h2 class="page-break">7. 학생 상담 일지</h2>', '<h2 class="page-break">8. 학생 상담 일지</h2>', 1)
    html = html.replace('<h2>8. 교외체험학습 현황</h2>', '<h2>9. 교외체험학습 현황</h2>', 1)
    html = html.replace('<h2 class="page-break">9. 학생 사안 기록 (대외비)</h2>', '<h2 class="page-break">10. 학생 사안 기록 (대외비)</h2>', 1)
    return html
