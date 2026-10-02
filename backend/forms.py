"""학교 서식 - 교외체험학습(신청서·결과보고서·승인통보서), 결석신고서, 주간학습안내, 가정통지표.

서식 항목 구성은 여러 학교 홈페이지·교육청 지침에 공개된 양식을 참고해 공통 항목으로 정리했다.
각 서식은 '블록' 목록으로 한 번만 정의하고, 한글(HWPX)과 A4 인쇄용 HTML 두 가지로 그린다.
학교 고유 양식이 등록되어 있으면(form_templates) 그 파일에 값을 채워 준다.
"""
from __future__ import annotations

import html as _html
from collections import defaultdict
from datetime import date, timedelta

from . import attendance as att
from .db import Database, StoreError
from .hwpx_builder import HwpxBuilder, check, checks, fill_template
from .reports import ReportData

WEEK = ["월", "화", "수", "목", "금", "토", "일"]
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"]
EXP_TYPES = ["가족동반여행", "친인척방문", "답사·견학", "체험활동", "기타"]
ABS_KINDS = ["결석", "지각", "조퇴", "결과"]
ABS_REASONS = ["질병", "미인정", "기타", "출석인정"]
SINGLE_FORMS = {"exp_application": "교외체험학습 신청서", "exp_report": "교외체험학습 결과보고서",
                "exp_notice": "교외체험학습 승인 통보서", "absence": "결석·지각·조퇴·결과 신고서"}


# ------------------------------------------------------------------ 날짜
def kdate(d: str, weekday: bool = True) -> str:
    """'2026-04-01' → '2026. 4. 1.(수)'"""
    try:
        x = date.fromisoformat(d)
    except (TypeError, ValueError):
        return d or ""
    s = f"{x.year}. {x.month}. {x.day}."
    return s + f"({WEEK[x.weekday()]})" if weekday else s


def krange(s: str, e: str) -> str:
    if not e or e == s:
        return kdate(s)
    try:
        a, b = date.fromisoformat(s), date.fromisoformat(e)
    except ValueError:
        return f"{s} ~ {e}"
    tail = f"{b.month}. {b.day}.({WEEK[b.weekday()]})" if a.year == b.year else kdate(e)
    return f"{kdate(s)} ~ {tail}"


def today_k() -> str:
    t = date.today()
    return f"{t.year}년 {t.month}월 {t.day}일"


def add_school_days(d: str, n: int) -> str:
    x = date.fromisoformat(d)
    while n > 0:
        x += timedelta(days=1)
        if x.weekday() < 5:
            n -= 1
    return x.isoformat()


# ======================================================================
# 블록 → 한글 / HTML
# ======================================================================
class Form:
    def __init__(self, title_for_file: str, landscape: bool = False):
        self.name = title_for_file
        self.landscape = landscape
        self.blocks: list[tuple] = []

    def title(self, text, size=18):
        self.blocks.append(("title", text, size))

    def para(self, text="", **kw):
        self.blocks.append(("para", text, kw))

    def kv(self, pairs, cols=2, label_mm=28, heights=None, size=10.5):
        self.blocks.append(("kv", pairs, cols, label_mm, heights or {}, size))

    def table(self, rows, widths, **kw):
        self.blocks.append(("table", rows, widths, kw))

    def page_break(self):
        self.blocks.append(("break",))

    # -------------------------------------------------------------- 한글
    def to_hwpx(self) -> bytes:
        b = HwpxBuilder(landscape=self.landscape, margins_mm=(15, 15, 12, 12) if self.landscape else (20, 20, 15, 15))
        pending_break = False
        for blk in self.blocks:
            kind = blk[0]
            if kind == "break":
                pending_break = True
                continue
            if kind == "title":
                b.title(blk[1], size=blk[2], page_break=pending_break)
            elif kind == "para":
                kw = dict(blk[2])
                kw.pop("box", None)
                b.para(blk[1], page_break=pending_break, **kw)
            elif kind == "kv":
                if pending_break:
                    b.para("", page_break=True, size=2, after=0)
                b.kv_table(blk[1], cols=blk[2], label_mm=blk[3], heights_mm=blk[4], size=blk[5])
            elif kind == "table":
                if pending_break:
                    b.para("", page_break=True, size=2, after=0)
                kw = dict(blk[3])
                b.table(blk[1], blk[2], **kw)
            pending_break = False
        return b.to_bytes()

    # -------------------------------------------------------------- HTML
    def to_html(self) -> str:
        e = lambda s: _html.escape(str(s if s is not None else "")).replace("\n", "<br>")
        out = []
        for blk in self.blocks:
            kind = blk[0]
            if kind == "break":
                out.append('<div class="pb"></div>')
            elif kind == "title":
                out.append(f'<h1 style="font-size:{blk[2]}pt">{e(blk[1])}</h1>')
            elif kind == "para":
                kw = blk[2]
                style = f"text-align:{kw.get('align', 'LEFT').lower()};"
                if kw.get("bold"):
                    style += "font-weight:700;"
                if kw.get("size"):
                    style += f"font-size:{kw['size']}pt;"
                if kw.get("before"):
                    style += f"margin-top:{kw['before']}pt;"
                if kw.get("color"):
                    style += f"color:{kw['color']};"
                cls = ' class="box"' if kw.get("box") else ""
                out.append(f'<p{cls} style="{style}">{e(blk[1]) or "&nbsp;"}</p>')
            elif kind == "kv":
                pairs, cols, label_mm, heights, size = blk[1:]
                content = 270 if self.landscape else 170
                vw = (content - label_mm * cols) / cols
                rows_html = []
                for i in range(0, len(pairs), cols):
                    chunk = pairs[i:i + cols]
                    h = heights.get(i // cols)
                    hs = f' style="height:{h}mm;vertical-align:top"' if h else ""
                    cells = "".join(f'<th>{e(k)}</th><td{hs}>{e(v)}</td>' for k, v in chunk)
                    if len(chunk) < cols:
                        last_colspan = 1 + 2 * (cols - len(chunk))
                        k, v = chunk[-1]
                        cells = "".join(f'<th>{e(k)}</th><td{hs}>{e(v)}</td>' for k, v in chunk[:-1])
                        cells += f'<th>{e(k)}</th><td colspan="{last_colspan}"{hs}>{e(v)}</td>'
                    rows_html.append(f"<tr>{cells}</tr>")
                cg = "".join(f'<col style="width:{label_mm / content * 100:.1f}%"><col style="width:{vw / content * 100:.1f}%">' for _ in range(cols))
                out.append(f'<table class="kv" style="font-size:{size}pt"><colgroup>{cg}</colgroup>{"".join(rows_html)}</table>')
            elif kind == "table":
                rows, widths, kw = blk[1], blk[2], blk[3]
                hr, hc = kw.get("header_rows", 0), kw.get("header_cols", 0)
                merges = kw.get("merges", ())
                heights = kw.get("heights_mm") or {}
                minh = kw.get("min_height_mm")
                align = kw.get("align", "CENTER")
                ncols = max(len(r) for r in rows)
                aligns = [align] * ncols if isinstance(align, str) else list(align) + ["LEFT"] * ncols
                span, hidden = {}, set()
                for r1, c1, r2, c2 in merges:
                    span[(r1, c1)] = (r2 - r1 + 1, c2 - c1 + 1)
                    for r in range(r1, r2 + 1):
                        for c in range(c1, c2 + 1):
                            if (r, c) != (r1, c1):
                                hidden.add((r, c))
                total = sum(widths) if widths else 1
                cg = "".join(f'<col style="width:{w / total * 100:.1f}%">' for w in widths) if widths else ""
                body = []
                for r, row in enumerate(rows):
                    tds = []
                    for c in range(ncols):
                        if (r, c) in hidden:
                            continue
                        v = row[c] if c < len(row) else ""
                        rs, cs = span.get((r, c), (1, 1))
                        attrs = (f' rowspan="{rs}"' if rs > 1 else "") + (f' colspan="{cs}"' if cs > 1 else "")
                        h = heights.get(r) or minh
                        style = f"text-align:{aligns[c].lower()};" + (f"height:{h}mm;" if h else "")
                        tag = "th" if (r < hr or c < hc) else "td"
                        if tag == "th":
                            style = "text-align:center;" + (f"height:{h}mm;" if h else "")
                        tds.append(f'<{tag}{attrs} style="{style}">{e(v)}</{tag}>')
                    body.append("<tr>" + "".join(tds) + "</tr>")
                out.append(f'<table style="font-size:{kw.get("size", 10)}pt"><colgroup>{cg}</colgroup>{"".join(body)}</table>')
        orient = "landscape" if self.landscape else "portrait"
        return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>{e(self.name)}</title><style>
@page {{ size: A4 {orient}; margin: {'12mm 15mm' if self.landscape else '15mm 20mm'}; }}
body {{ font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif; color:#000; margin:0; background:#eef0f3; }}
.sheet {{ background:#fff; width:{297 if self.landscape else 210}mm; margin:12px auto; padding:{'12mm 15mm' if self.landscape else '15mm 20mm'}; box-sizing:border-box; box-shadow:0 1px 6px rgba(0,0,0,.15); }}
h1 {{ text-align:center; margin:0 0 8pt; letter-spacing:2px; }}
p {{ margin:0 0 3pt; line-height:1.5; white-space:pre-wrap; }}
p.box {{ border:1px solid #000; padding:3mm; }}
table {{ width:calc(100% - 2px); border-collapse:collapse; table-layout:fixed; margin:0 1px 4pt; }}
th, td {{ border:1px solid #000; padding:1.5mm 2mm; vertical-align:middle; word-break:keep-all; overflow-wrap:anywhere; line-height:1.45; }}
th {{ background:#E7EEF7; font-weight:700; }}
table.kv th {{ background:#fff; }}
tr {{ break-inside: avoid; }}
.pb {{ break-before: page; height:0; }}
.toolbar {{ position:sticky; top:0; background:#2c3e50; color:#fff; padding:8px 16px; display:flex; gap:10px; align-items:center; z-index:10; font-size:13px; }}
.toolbar button {{ font-size:14px; padding:6px 16px; border:0; border-radius:6px; cursor:pointer; background:#fff; color:#2c3e50; font-weight:700; }}
@media print {{ body {{ background:#fff; }} .toolbar {{ display:none; }} .sheet {{ box-shadow:none; margin:0; padding:0; width:auto; }} }}
</style></head><body><div class="toolbar"><button onclick="window.print()">인쇄 / PDF 저장</button><span>인쇄 창에서 'PDF로 저장'을 고르면 PDF 파일이 됩니다.</span></div>
<div class="sheet">{''.join(out)}</div></body></html>"""


def notice_block(f: Form, lines: list[str], size: float = 9.5):
    """안내 사항 상자(1칸 표)."""
    f.table([["\n".join(lines)]], [1], align="LEFT", size=size)


def sign_block(f: Form, rd: ReportData, who: list[str], to_principal: bool = True, date_text: str | None = None):
    f.para(date_text or "         년        월        일", align="CENTER", before=10, after=8, size=11)
    for w in who:
        f.para(f"{w}                       (서명)", align="RIGHT", size=11, after=4)
    if to_principal:
        f.para(f"{rd.settings.get('schoolName') or '○○초등학교'}장 귀하", align="LEFT", bold=True, size=13, before=10)


# ======================================================================
# 공통 자료
# ======================================================================
class FormData(ReportData):
    def __init__(self, db: Database):
        super().__init__(db)
        self.db = db

    def stu(self, sid: str) -> dict:
        s = self.student_by_id.get(sid)
        if not s:
            raise StoreError("학생을 찾을 수 없습니다.")
        return s

    def grade_class(self, s: dict) -> str:
        st = self.settings
        return f"{st.get('grade') or '  '}학년 {st.get('classNo') or '  '}반 {s.get('number', '')}번"

    def school_days_between(self, s: str, e: str) -> int:
        days = {d for d in self.school_days if s <= d <= (e or s)}
        if days:
            return len(days)
        # 연간 시간표가 없으면 평일 수에서 휴업일 제외
        n, x, end = 0, date.fromisoformat(s), date.fromisoformat(e or s)
        holidays = [ev for ev in self.events if ev.get("isHoliday")]
        while x <= end:
            ds = x.isoformat()
            if x.weekday() < 5 and not any(h.get("startDate", "") <= ds <= (h.get("endDate") or h.get("startDate", "")) for h in holidays):
                n += 1
            x += timedelta(days=1)
        return n

    def int_setting(self, key: str, default: int | None) -> int | None:
        try:
            v = int(str(self.settings.get(key) or "").strip())
            return v if v >= 0 else default
        except ValueError:
            return default


# ======================================================================
# 1. 교외체험학습
# ======================================================================
def _exp(db: Database, exp_id: str):
    fd = FormData(db)
    exp = db.get("experiential", exp_id)
    if not exp:
        raise StoreError("교외체험학습 기록을 찾을 수 없습니다.")
    s = fd.stu(exp.get("studentId"))
    days = fd.school_days_between(exp.get("startDate", ""), exp.get("endDate") or exp.get("startDate", ""))
    year = (exp.get("startDate") or "")[:4]
    used = 0
    for other in fd.experiential:
        if other.get("studentId") == s["studentId"] and other.get("expId") != exp_id and other.get("status") == "approved" \
                and (other.get("startDate") or "")[:4] == year and bool(other.get("overseas")) == bool(exp.get("overseas")):
            used += fd.school_days_between(other.get("startDate", ""), other.get("endDate") or other.get("startDate", ""))
    return fd, exp, s, days, used


def exp_fields(db: Database, exp_id: str) -> dict:
    fd, exp, s, days, used = _exp(db, exp_id)
    st = fd.settings
    allowed = fd.int_setting("expOverseasDays" if exp.get("overseas") else "expDomesticDays", None)
    report_due = add_school_days(exp.get("endDate") or exp.get("startDate"), fd.int_setting("expReportDays", 7) or 7) if exp.get("startDate") else ""
    return {
        "학교": st.get("schoolName", ""), "학교장": st.get("principalName", ""), "담임": st.get("teacherName", ""),
        "이름": s.get("name", ""), "학년": st.get("grade", ""), "반": st.get("classNo", ""), "번호": s.get("number", ""),
        "학년반번호": fd.grade_class(s), "시작일": kdate(exp.get("startDate", "")), "종료일": kdate(exp.get("endDate") or exp.get("startDate", "")),
        "기간": krange(exp.get("startDate", ""), exp.get("endDate", "")), "일수": f"{days}일",
        "학습형태": exp.get("type", ""), "국내외": "국외" if exp.get("overseas") else "국내",
        "목적지": exp.get("destination", ""), "숙박장소": exp.get("lodging", ""),
        "보호자": exp.get("guardianName", ""), "보호자관계": exp.get("guardianRelation", ""), "보호자연락처": exp.get("guardianPhone") or s.get("guardianPhone", ""),
        "인솔자": exp.get("escortName", ""), "인솔자관계": exp.get("escortRelation", ""), "인솔자연락처": exp.get("escortPhone", ""),
        "목적": exp.get("purpose") or exp.get("reason", ""), "계획": exp.get("plan", ""),
        "사용일수": f"{used}일", "허용일수": f"{allowed}일" if allowed is not None else "학교 규정",
        "잔여일수": f"{max(allowed - used - days, 0)}일" if allowed is not None else "",
        "보고서기한": kdate(report_due) if report_due else "", "작성일": today_k(),
        "승인여부": "승인" if exp.get("status") == "approved" else ("불허" if exp.get("status") == "denied" else "검토 중"),
        "불허사유": exp.get("denyReason", ""),
        "_days": days, "_used": used, "_allowed": allowed,
    }


def exp_label_map(v: dict) -> dict:
    """학교 양식의 표 제목(정확히 일치) → 값."""
    return {
        "성명": v["이름"], "학생성명": v["이름"], "학생명": v["이름"], "이름": v["이름"],
        "학년반번호": v["학년반번호"], "학년반번": v["학년반번호"], "학번": v["학년반번호"],
        "신청기간": f"{v['기간']} ({v['일수']})", "체험학습기간": f"{v['기간']} ({v['일수']})", "기간": f"{v['기간']} ({v['일수']})",
        "체험기간": f"{v['기간']} ({v['일수']})", "학습기간": f"{v['기간']} ({v['일수']})",
        "학습형태": v["학습형태"], "체험학습형태": v["학습형태"], "형태": v["학습형태"],
        "목적지": v["목적지"], "체험장소": v["목적지"], "장소": v["목적지"], "숙박장소": v["숙박장소"], "숙박": v["숙박장소"],
        "보호자": v["보호자"], "보호자명": v["보호자"], "보호자성명": v["보호자"], "보호자연락처": v["보호자연락처"],
        "인솔자": v["인솔자"], "인솔자명": v["인솔자"], "인솔자성명": v["인솔자"], "인솔자연락처": v["인솔자연락처"],
        "목적": v["목적"], "체험학습목적": v["목적"], "교외체험학습목적": v["목적"],
        "계획": v["계획"], "체험학습계획": v["계획"], "교외체험학습계획": v["계획"], "학습계획": v["계획"],
    }


def exp_application(db: Database, exp_id: str) -> Form:
    v = exp_fields(db, exp_id)
    fd, exp = FormData(db), db.get("experiential", exp_id)
    f = Form(f"교외체험학습신청서_{v['이름']}")
    f.title("학교장허가 교외체험학습 신청서")
    f.para(f"[{v['국내외']}]", align="RIGHT", size=10)
    remain = f"올해 사용 {v['사용일수']} / 허용 {v['허용일수']}" + (f" (이번 신청 후 잔여 {v['잔여일수']})" if v["잔여일수"] else "")
    f.table([
        ["학생", "성명", v["이름"], "학년·반·번호", v["학년반번호"]],
        ["신청 기간", f"{v['기간']}  [수업일 {v['일수']}]", "", "", ""],
        ["출석인정 일수", remain, "", "", ""],
        ["학습 형태", checks(EXP_TYPES, exp.get("type")), "", "", ""],
        ["목적지", v["목적지"], "", "숙박 장소", v["숙박장소"]],
        ["보호자", f"{v['보호자']}" + (f" ({v['보호자관계']})" if v["보호자관계"] else ""), "", "연락처", v["보호자연락처"]],
        ["인솔자", f"{v['인솔자']}" + (f" ({v['인솔자관계']})" if v["인솔자관계"] else ""), "", "연락처", v["인솔자연락처"]],
        ["체험학습\n목적", v["목적"], "", "", ""],
        ["체험학습\n계획", v["계획"], "", "", ""],
    ], [24, 22, 50, 26, 48], header_cols=1, align=["CENTER", "LEFT", "LEFT", "CENTER", "LEFT"], size=10.5,
        merges=[(1, 1, 1, 4), (2, 1, 2, 4), (3, 1, 3, 4), (4, 1, 4, 2), (5, 1, 5, 2), (6, 1, 6, 2), (7, 1, 7, 4), (8, 1, 8, 4)],
        heights_mm={0: 9, 1: 9, 2: 9, 3: 9, 4: 9, 5: 9, 6: 9, 7: 20, 8: 42}, bold_cells=[(0, 1), (4, 3), (5, 3), (6, 3)])
    f.para("위와 같이 학교장허가 교외체험학습을 신청합니다.", align="CENTER", before=8, size=11)
    sign_block(f, fd, ["학생", "보호자"])
    apply_days = fd.int_setting("expApplyDays", 3) or 3
    lines = ["※ 안내 사항",
             f"1. 신청서는 체험학습 시작 {apply_days}일 전까지(공휴일 제외) 담임교사에게 제출합니다.",
             "2. 신청서를 냈다고 바로 허가되는 것이 아니며, 승인 통보를 받은 뒤 실시합니다.",
             f"3. 결과보고서는 체험학습이 끝난 뒤 {fd.int_setting('expReportDays', 7) or 7}일 이내에 제출합니다. (사진·입장권 등 증빙 첨부)",
             "4. 인솔자는 보호자 또는 보호자가 위임한 성인으로, 학생 안전에 책임을 집니다.",
             "5. 5일 이상 이어지는 체험학습은 기간 중 주 1회 이상 담임교사와 통화하여 학생의 안전을 확인합니다."]
    notice_block(f, lines)
    return f


def exp_report(db: Database, exp_id: str) -> Form:
    v = exp_fields(db, exp_id)
    fd, exp = FormData(db), db.get("experiential", exp_id)
    f = Form(f"교외체험학습결과보고서_{v['이름']}")
    f.title("학교장허가 교외체험학습 결과 보고서")
    f.table([
        ["학생", "성명", v["이름"], "학년·반·번호", v["학년반번호"]],
        ["기간", f"{v['기간']}  [수업일 {v['일수']}]", "", "", ""],
        ["학습 형태", checks(EXP_TYPES, exp.get("type")), "", "", ""],
        ["장소", v["목적지"], "", "동행자", v["인솔자"] or v["보호자"]],
        ["주제", "", "", "", ""],
        ["체험한\n내용", "", "", "", ""],
        ["느낀 점\n알게 된 점", "", "", "", ""],
        ["사진·증빙\n자료", "(사진, 입장권, 영수증 등을 붙이거나 따로 첨부합니다)", "", "", ""],
    ], [24, 22, 50, 26, 48], header_cols=1, align=["CENTER", "LEFT", "LEFT", "CENTER", "LEFT"], size=10.5,
        merges=[(1, 1, 1, 4), (2, 1, 2, 4), (3, 1, 3, 2), (4, 1, 4, 4), (5, 1, 5, 4), (6, 1, 6, 4), (7, 1, 7, 4)],
        heights_mm={0: 10, 1: 10, 2: 10, 3: 10, 4: 12, 5: 80, 6: 40, 7: 35}, bold_cells=[(0, 1), (3, 3)])
    due = f" (제출 기한: {v['보고서기한']}까지)" if v["보고서기한"] else ""
    f.para(f"위와 같이 교외체험학습 결과 보고서를 제출합니다.{due}", align="CENTER", before=6, size=11)
    sign_block(f, fd, ["학생", "보호자"])
    return f


def exp_notice(db: Database, exp_id: str) -> Form:
    v = exp_fields(db, exp_id)
    fd, exp = FormData(db), db.get("experiential", exp_id)
    approved = exp.get("status") == "approved"
    denied = exp.get("status") == "denied"
    f = Form(f"교외체험학습통보서_{v['이름']}")
    f.title("학교장허가 교외체험학습 " + ("승인" if approved else ("불허" if denied else "승인·불허")) + " 통보서")
    f.table([
        ["성명", v["이름"], "학년·반·번호", v["학년반번호"]],
        ["기간", f"{v['기간']}  [수업일 {v['일수']}]", "", ""],
        ["학습 형태", v["학습형태"], "목적지", v["목적지"]],
        ["처리 결과", f"{check(approved)} 승인        {check(denied)} 불허", "", ""],
        ["불허 사유", v["불허사유"] if denied else "", "", ""],
    ], [28, 57, 28, 57], header_cols=1, align=["CENTER", "LEFT", "CENTER", "LEFT"], size=10.5,
        merges=[(1, 1, 1, 3), (3, 1, 3, 3), (4, 1, 4, 3)], heights_mm={r: 11 for r in range(4)} | {4: 18},
        bold_cells=[(0, 2), (2, 2)])
    body = ["귀 댁의 자녀가 신청한 학교장허가 교외체험학습을 위와 같이 " + ("승인합니다." if approved else ("허가하지 않습니다." if denied else "처리합니다."))]
    if not denied:
        body += [f"승인된 기간은 출석으로 인정(출석인정 결석)되며, 결과보고서는 체험학습이 끝난 뒤 {fd.int_setting('expReportDays', 7) or 7}일 이내"
                 + (f"({v['보고서기한']}까지)" if v["보고서기한"] else "") + " 담임교사에게 제출해 주시기 바랍니다.",
                 "체험학습 기간 동안 자녀의 안전에 각별히 유의해 주시기 바랍니다."]
        if (v["_days"] or 0) >= 5:
            body.append("5일 이상 이어지는 체험학습이므로 기간 중 주 1회 이상 담임교사와 통화하여 학생의 안전을 확인해 주시기 바랍니다.")
    for line in body:
        f.para(line, size=11, before=6)
    f.para(today_k(), align="CENTER", before=16, after=10, size=11)
    f.para(f"담임교사  {fd.settings.get('teacherName') or ''}", align="RIGHT", size=11)
    f.para(f"{fd.settings.get('schoolName') or '○○초등학교'}장" + (f"  {fd.settings['principalName']}" if fd.settings.get("principalName") else "")
           + "  (직인생략)", align="RIGHT", bold=True, size=12, before=6)
    f.para(f"학부모님 귀하", align="LEFT", size=11, before=12)
    return f


# ======================================================================
# 2. 결석신고서
# ======================================================================
def absence_episode(db: Database, sid: str, d: str) -> dict:
    """선택한 날짜를 포함해, 같은 종류·사유로 이어진 수업일을 하나로 묶는다."""
    fd = FormData(db)
    recs = [r for r in fd.attendance if r.get("studentId") == sid and r.get("status") != "출석"]
    by_date = defaultdict(list)
    for r in recs:
        by_date[r.get("date")].append(r)
    if d not in by_date:
        raise StoreError(f"{d}에는 결석·지각·조퇴·결과 기록이 없습니다.")

    def sig(day):
        st = att.day_status(by_date[day])
        if st["absent"]:
            return ("결석", st["absent"])
        if st["recognized"]:
            return ("결석", "출석인정")
        for k in ("지각", "조퇴", "결과"):
            if st[k]:
                return (k, st[k])
        return None

    kind = sig(d)
    days = sorted(fd.school_days) or sorted(by_date)
    if kind and kind[0] == "결석" and d in days:
        i = days.index(d)
        s = e = i
        while s > 0 and days[s - 1] in by_date and sig(days[s - 1]) == kind:
            s -= 1
        while e < len(days) - 1 and days[e + 1] in by_date and sig(days[e + 1]) == kind:
            e += 1
        span = days[s:e + 1]
    else:
        span = [d]
    periods = sorted({r.get("period") for r in by_date[d] if r.get("period") and r.get("status") == (kind[0] if kind else "")})
    notes = []
    for day in span:
        for r in by_date[day]:
            n = (r.get("note") or "").strip()
            if n and n != "이전 교시 연동" and n not in notes:
                notes.append(n)
    reason = kind[1] if kind else ""
    return {"kind": kind[0] if kind else "", "reason": "출석인정" if reason in ("인정", "출석인정") else reason,
            "start": span[0], "end": span[-1], "days": len(span), "periods": periods, "note": " / ".join(notes)}


def absence_fields(db: Database, sid: str, d: str) -> dict:
    fd = FormData(db)
    s = fd.stu(sid)
    ep = absence_episode(db, sid, d)
    when = f"{krange(ep['start'], ep['end'])}  ({ep['days']}일)" if ep["kind"] == "결석" else \
        f"{kdate(ep['start'])}  " + (f"{', '.join(map(str, ep['periods']))}교시" if ep["periods"] else "")
    return {"학교": fd.settings.get("schoolName", ""), "담임": fd.settings.get("teacherName", ""),
            "이름": s.get("name", ""), "학년": fd.settings.get("grade", ""), "반": fd.settings.get("classNo", ""), "번호": s.get("number", ""),
            "학년반번호": fd.grade_class(s), "구분": ep["kind"], "사유구분": ep["reason"], "기간": when,
            "시작일": kdate(ep["start"]), "종료일": kdate(ep["end"]), "일수": f"{ep['days']}일", "사유": ep["note"],
            "보호자연락처": s.get("guardianPhone", ""), "작성일": today_k(), "_ep": ep}


def absence_form(db: Database, sid: str, d: str) -> Form:
    v = absence_fields(db, sid, d)
    ep = v["_ep"]
    fd = FormData(db)
    parent_confirm = ep["reason"] in ("미인정", "기타")
    f = Form(f"{'학부모확인서' if parent_confirm else '결석신고서'}_{v['이름']}_{ep['start']}")
    f.title(("학부모 확인서" if parent_confirm else f"{ep['kind'] or '결석'} 신고서") + " (결석·지각·조퇴·결과)", size=17)
    docs = {"질병": ["진단서·소견서", "진료확인서·처방전", "기타 (            )"],
            "출석인정": ["관련 증빙(청첩장·부고·공문 등)", "기타 (            )"]}.get(ep["reason"], ["학부모 확인서(본 서식)"])
    f.table([
        ["학생", v["이름"], "학년·반·번호", v["학년반번호"]],
        ["구분", checks(ABS_KINDS, ep["kind"]), "", ""],
        ["사유 구분", checks(ABS_REASONS, ep["reason"]), "", ""],
        ["기간", v["기간"], "", ""],
        ["사유", v["사유"], "", ""],
        ["증빙 서류", checks(docs, docs[0] if parent_confirm else None), "", ""],
    ], [28, 57, 28, 57], header_cols=1, align=["CENTER", "LEFT", "CENTER", "LEFT"], size=10.5,
        merges=[(r, 1, r, 3) for r in range(1, 6)], heights_mm={0: 11, 1: 11, 2: 11, 3: 11, 4: 40, 5: 14},
        bold_cells=[(0, 2)])
    what = ep["kind"] or "결석"
    f.para(f"위와 같은 사유로 {what}하였기에 " + ("확인합니다." if parent_confirm else "신고서를 제출합니다."), align="CENTER", before=10, size=11)
    sign_block(f, fd, ["보호자"], date_text=None)
    f.table([["담임 확인", ""]], [30, 40], header_cols=1, heights_mm={0: 14})
    limit = fd.int_setting("absenceDays", 5) or 5
    notice_block(f, ["※ 안내 사항",
                     f"1. 결석(지각·조퇴·결과)한 날부터 {limit}일 이내에 담임교사에게 제출합니다.",
                     "2. 질병으로 인한 경우 학교 규정에 따라 진단서·소견서·진료확인서 등 증빙 서류를 함께 냅니다.",
                     "3. 경조사·법정 감염병 등 출석인정 사유는 관련 증빙을 첨부합니다.",
                     "4. 제출한 서류는 나이스 출결 처리(질병·미인정·기타·출석인정 구분)의 근거가 됩니다."])
    return f


# ======================================================================
# 3. 주간학습안내
# ======================================================================
def week_monday(d: str) -> date:
    x = date.fromisoformat(d)
    return x - timedelta(days=x.weekday())


def weekly_guide(db: Database, week_start: str) -> Form:
    fd = FormData(db)
    mon = week_monday(week_start)
    days = [mon + timedelta(days=i) for i in range(5)]
    notes = db.get("weekly_notes", mon.isoformat()) or {}
    st = fd.settings
    week_no = ""
    if st.get("term1Start"):
        try:
            week_no = f" [{(mon - week_monday(st['term1Start'])).days // 7 + 1}주]"
            if st.get("term2Start") and mon >= week_monday(st["term2Start"]):
                week_no = f" [2학기 {(mon - week_monday(st['term2Start'])).days // 7 + 1}주]"
        except ValueError:
            week_no = ""
    annual = {d["date"]: d for d in fd.annual}
    holidays = {}
    events_in_week = []
    for ev in fd.events:
        s, e = ev.get("startDate", ""), ev.get("endDate") or ev.get("startDate", "")
        for x in days:
            if s <= x.isoformat() <= e:
                if ev.get("isHoliday"):
                    holidays[x.isoformat()] = ev.get("title", "휴업일")
                elif ev.get("title") not in events_in_week:
                    events_in_week.append(f"{x.month}/{x.day}({WEEK[x.weekday()]}) {ev.get('title')}")
    periods = fd.periods
    header = ["구분"] + [f"{WEEK[x.weekday()]} ({x.month}/{x.day})" for x in days]
    morning = notes.get("morning") or {}
    prep = notes.get("prep") or {}
    rows = [header, ["아침 활동"] + [morning.get(k, "") for k in DAY_KEYS]]
    for p in range(1, periods + 1):
        row = [f"{p}교시"]
        for x, k in zip(days, DAY_KEYS):
            ds = x.isoformat()
            if ds in holidays:
                row.append(holidays[ds] if p == 1 else "")
                continue
            day = annual.get(ds)
            sub = next((s for s in (day or {}).get("subjects", []) if s.get("period") == p), None)
            if not sub and not day:
                sub = None
                cell = (fd.timetable.get(f"{k}-{p}") or {}).get("name", "")
                row.append(full_subject_name(fd, cell))
                continue
            if not sub:
                row.append("")
                continue
            content = sub.get("content") or sub.get("objective") or sub.get("unit") or ""
            row.append(full_subject_name(fd, sub.get("name")) + (f"\n{content}" if content else ""))
        rows.append(row)
    rows.append(["준비물·알림"] + [prep.get(k, "") for k in DAY_KEYS])
    merges = []
    for i, x in enumerate(days):
        if x.isoformat() in holidays:
            merges.append((2, i + 1, 1 + periods, i + 1))
    f = Form(f"주간학습안내_{mon.isoformat()}", landscape=True)
    f.title(f"주간학습안내", size=18)
    f.para(f"{krange(days[0].isoformat(), days[-1].isoformat())}{week_no}     {st.get('schoolName') or ''} {fd.class_label}"
           + (f"  담임 {st['teacherName']}" if st.get("teacherName") else ""), align="CENTER", size=11, after=6)
    f.table(rows, [18] + [50.4] * 5, header_rows=1, header_cols=1, merges=merges, align="CENTER", size=9.5,
            heights_mm={0: 8, 1: 9, 1 + periods + 1: 16}, min_height_mm=13)
    general = (notes.get("general") or "").strip()
    lines = []
    if events_in_week:
        lines.append("■ 이번 주 학교 행사: " + ", ".join(events_in_week))
    if general:
        lines.append("■ 알림: " + general)
    lines.append("※ 학교 및 학급 사정에 따라 시간표와 학습 내용이 바뀔 수 있습니다.")
    notice_block(f, lines, size=10)
    return f


def full_subject_name(fd: ReportData, short: str) -> str:
    for s in fd.subjects:
        if s.get("shortName") == short:
            return s.get("name") or short
    return short or ""


# ======================================================================
# 4. 가정통지표
# ======================================================================
def term_range(fd: ReportData, term: int) -> tuple[str, str]:
    st = fd.settings
    s, e = (st.get("term1Start"), st.get("term1End")) if int(term) == 1 else (st.get("term2Start"), st.get("term2End"))
    if not s or not e:
        raise StoreError(f"[기본설정]에서 {term}학기 기간을 먼저 저장해 주세요.")
    return s, e


def report_cards(db: Database, term: int, student_ids: list[str] | None = None, parent_reply: bool = True) -> Form:
    fd = FormData(db)
    s0, e0 = term_range(fd, term)
    counts = {c["studentId"]: c for c in fd.attendance_counts(s0, e0)}
    plans = [p for p in fd.eval_plans if s0 <= (p.get("date") or "") <= e0]
    subj_order = {s.get("name"): i for i, s in enumerate(fd.subjects)}
    plans.sort(key=lambda p: (subj_order.get(p.get("subjectName"), 99), p.get("date") or ""))
    cards = {c.get("studentId"): c for c in db.get_all("report_cards") if int(c.get("term") or 0) == int(term)}
    st = fd.settings
    year = st.get("schoolYear") or date.today().year
    students = [s for s in fd.students if not student_ids or s["studentId"] in student_ids]
    if not students:
        raise StoreError("출력할 학생이 없습니다.")
    f = Form(f"가정통지표_{year}_{term}학기")
    for i, s in enumerate(students):
        if i:
            f.page_break()
        f.title(f"{year}학년도 {term}학기 가정통지표", size=18)
        f.table([["학교", st.get("schoolName") or "", "학년·반·번호", fd.grade_class(s), "성명", s.get("name", "")]],
                [18, 42, 26, 34, 16, 34], header_cols=0, bold_cells=[(0, 0), (0, 2), (0, 4)], heights_mm={0: 10}, size=10.5)
        c = counts.get(s["studentId"], {})
        f.para("1. 출결 상황", bold=True, size=11.5, before=6, after=3)
        f.table([["수업일수", "결석", "지각", "조퇴", "결과", "출석인정"],
                 [c.get("수업일수", 0), c.get("결석", 0), c.get("지각", 0), c.get("조퇴", 0), c.get("결과", 0), c.get("출석인정", 0)]],
                [1] * 6, header_rows=1, size=10.5, heights_mm={0: 8, 1: 9})
        f.para("(단위: 일, 결석·지각·조퇴·결과는 질병·미인정·기타를 합한 일수)", size=8.5, color="#555555", after=2)
        f.para("2. 교과 학습 발달 상황", bold=True, size=11.5, before=6, after=3)
        rows = [["교과", "평가 내용", "평가 결과", "관찰 내용"]]
        merges, start, prev = [], None, None
        for p in plans:
            sc = fd.score_of(p.get("planId"), s["studentId"])
            title = p.get("title") or ""
            if p.get("element") or p.get("domain"):
                title += f" ({p.get('domain') or p.get('element')})"
            rows.append([p.get("subjectName", ""), title, sc.get("score", ""), sc.get("note", "")])
            r = len(rows) - 1
            if p.get("subjectName") != prev:
                if start is not None and r - 1 > start:
                    merges.append((start, 0, r - 1, 0))
                start, prev = r, p.get("subjectName")
        if start is not None and len(rows) - 1 > start:
            merges.append((start, 0, len(rows) - 1, 0))
        if len(rows) == 1:
            rows.append(["", "이 학기에 등록된 평가가 없습니다.", "", ""])
            merges.append((1, 1, 1, 3))
        f.table(rows, [18, 52, 18, 82], header_rows=1, merges=merges, align=["CENTER", "LEFT", "CENTER", "LEFT"], size=9.5, min_height_mm=8)
        f.para("3. 행동 특성 및 종합 의견", bold=True, size=11.5, before=6, after=3)
        f.table([[(cards.get(s["studentId"]) or {}).get("comment", "")]], [1], align="LEFT", size=10.5, heights_mm={0: 45})
        f.para(f"{today_k()}", align="RIGHT", before=6, size=10.5)
        f.para(f"{st.get('schoolName') or ''}  {fd.class_label}  담임  {st.get('teacherName') or ''}  (인)", align="RIGHT", size=10.5, before=2)
        if parent_reply:
            f.para("✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -", size=8, color="#777777", before=8, after=3)
            f.table([["가정에서\n보내는 글", ""], ["보호자 확인", f"{s.get('name', '')} 보호자                       (서명)"]],
                    [24, 146], header_cols=1, align=["CENTER", "LEFT"], heights_mm={0: 28, 1: 10}, size=10)
    return f


# ======================================================================
# 출력 진입점
# ======================================================================
def build(db: Database, kind: str, params: dict) -> Form:
    p = params or {}
    if kind == "exp_application":
        return exp_application(db, p["expId"])
    if kind == "exp_report":
        return exp_report(db, p["expId"])
    if kind == "exp_notice":
        return exp_notice(db, p["expId"])
    if kind == "absence":
        return absence_form(db, p["studentId"], p["date"])
    if kind == "weekly":
        return weekly_guide(db, p["weekStart"])
    if kind == "report_card":
        return report_cards(db, int(p.get("term") or 1), p.get("studentIds"), bool(p.get("parentReply", True)))
    raise StoreError(f"알 수 없는 서식: {kind}")


def fields_for(db: Database, kind: str, params: dict) -> tuple[dict, dict]:
    """학교 양식 채우기용 (자리표시 값, 표 제목 값)."""
    if kind in ("exp_application", "exp_report", "exp_notice"):
        v = exp_fields(db, params["expId"])
        return {k: v[k] for k in v if not k.startswith("_")}, exp_label_map(v)
    if kind == "absence":
        v = absence_fields(db, params["studentId"], params["date"])
        labels = {"성명": v["이름"], "학생성명": v["이름"], "이름": v["이름"], "학년반번호": v["학년반번호"], "학년반번": v["학년반번호"],
                  "기간": v["기간"], "결석기간": v["기간"], "일시": v["기간"], "사유": v["사유"], "결석사유": v["사유"],
                  "구분": f"{v['구분']}({v['사유구분']})", "결석구분": v["사유구분"], "보호자연락처": v["보호자연락처"]}
        return {k: v[k] for k in v if not k.startswith("_")}, labels
    raise StoreError("이 서식은 학교 양식 채우기를 지원하지 않습니다.")


def fill_school_template(db: Database, kind: str, params: dict) -> tuple[bytes, dict]:
    tpl = db.get_form_template(kind)
    if not tpl:
        raise StoreError("등록된 학교 양식이 없습니다.")
    values, labels = fields_for(db, kind, params)
    return fill_template(tpl["data"], tpl["filename"], values, labels)


PLACEHOLDER_GUIDE = {
    "exp": ["이름", "학년", "반", "번호", "학년반번호", "기간", "시작일", "종료일", "일수", "학습형태", "국내외", "목적지", "숙박장소",
            "보호자", "보호자관계", "보호자연락처", "인솔자", "인솔자관계", "인솔자연락처", "목적", "계획", "사용일수", "허용일수", "잔여일수",
            "보고서기한", "승인여부", "불허사유", "작성일", "학교", "학교장", "담임"],
    "absence": ["이름", "학년", "반", "번호", "학년반번호", "구분", "사유구분", "기간", "시작일", "종료일", "일수", "사유", "보호자연락처", "작성일", "학교", "담임"],
}
