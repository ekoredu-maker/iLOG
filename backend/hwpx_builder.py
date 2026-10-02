"""한글(HWPX) 문서 만들기·채우기 도구 (python-hwpx 기반, Apache-2.0).

- HwpxBuilder: 표준 서식을 새로 만든다 (A4, 제목, 표, 서명란, 쪽 나눔).
- fill_template: 학교에서 쓰는 .hwpx/.hwp 양식에
    ① {{이름}} 같은 자리표시를 바꾸고
    ② '성명' 같은 제목 칸 오른쪽의 '빈 칸'을 채운다 (제목이 정확히 같을 때만, 인쇄된 글자는 덮어쓰지 않음).
"""
from __future__ import annotations

import io
import re
import warnings
from typing import Iterable, Sequence

from hwpx.document import HwpxDocument

warnings.filterwarnings("ignore", category=DeprecationWarning, module=r"hwpx.*")

MM = 283.465  # HWP 단위(1/7200 inch) per mm
A4_CONTENT_MM = 170  # 210 - 좌우 여백 20mm


def check(on: bool) -> str:
    return "☑" if on else "☐"


def checks(options: Sequence[str], selected: str | Iterable[str] | None) -> str:
    sel = {selected} if isinstance(selected, str) else set(selected or [])
    return "  ".join(f"{check(o in sel)} {o}" for o in options)


class HwpxBuilder:
    def __init__(self, margins_mm: tuple[float, float, float, float] = (20, 20, 15, 15), landscape: bool = False):
        self.doc = HwpxDocument.new()
        l, r, t, b = margins_mm
        self.doc.page.setup(paper_size="A4", orientation="landscape" if landscape else "portrait",
                            margins_mm={"left": l, "right": r, "top": t, "bottom": b})
        self.content_mm = (297 if landscape else 210) - l - r
        self._runs: dict[tuple, str] = {}
        self._borders: dict[tuple, str] = {}
        self._first = True

    # ------------------------------------------------------------ 스타일
    def run_style(self, bold: bool = False, size: float | None = None, color: str | None = None) -> str:
        key = (bold, size, color)
        if key not in self._runs:
            self._runs[key] = self.doc.styles.ensure_run(bold=bold or None, size=size, color=color, font="맑은 고딕")
        return self._runs[key]

    def border(self, fill: str | None = None, width: str = "0.12 mm") -> str:
        key = (fill, width)
        if key not in self._borders:
            self._borders[key] = self.doc.styles.ensure_border_fill(border_color="#000000", border_width=width, fill_color=fill)
        return self._borders[key]

    def _first_para_fix(self):
        """새 문서의 빈 첫 문단을 지워 위쪽 여백이 생기지 않게 한다."""
        if self._first:
            self._first = False
            paras = self.doc.paragraphs
            if paras and not (paras[0].text or "").strip():
                self._remove_first = paras[0]

    # ------------------------------------------------------------ 문단
    def para(self, text: str = "", *, align: str = "LEFT", bold: bool = False, size: float | None = 10.5,
             color: str | None = None, before: float = 0, after: float = 2, page_break: bool = False, line: int = 150):
        self._first_para_fix()
        p = self.doc.add_paragraph(text, char_pr_id_ref=self.run_style(bold, size, color))
        self.doc.styles.apply_paragraph_format(paragraphs=[p], alignment=align, spacing_before_pt=before,
                                               spacing_after_pt=after, line_spacing_percent=line,
                                               page_break_before=page_break or None)
        return p

    def title(self, text: str, size: float = 18, page_break: bool = False, after: float = 8):
        return self.para(text, align="CENTER", bold=True, size=size, after=after, page_break=page_break)

    # ------------------------------------------------------------ 표
    def table(self, rows: list[list[str]], widths_mm: Sequence[float] | None = None, *,
              header_rows: int = 0, header_cols: int = 0, merges: Sequence[tuple[int, int, int, int]] = (),
              align: Sequence[str] | str = "CENTER", size: float = 10, min_height_mm: float | None = None,
              heights_mm: dict[int, float] | None = None, shade: str = "#E7EEF7", bold_cells: Iterable[tuple[int, int]] = ()):
        self._first_para_fix()
        nrows, ncols = len(rows), max(len(r) for r in rows)
        width = int(self.content_mm * MM)
        t = self.doc.add_table(nrows, ncols, width=width, border_fill_id_ref=self.border())
        if widths_mm:
            t.set_column_widths(list(widths_mm))
        normal = self.run_style(False, size)
        bold_id = self.run_style(True, size)
        bold_set = set(bold_cells)
        merged_hidden: set[tuple[int, int]] = set()
        for r1, c1, r2, c2 in merges:
            for r in range(r1, r2 + 1):
                for c in range(c1, c2 + 1):
                    if (r, c) != (r1, c1):
                        merged_hidden.add((r, c))
        aligns = [align] * ncols if isinstance(align, str) else list(align) + ["LEFT"] * (ncols - len(align))
        for r, row in enumerate(rows):
            for c in range(ncols):
                if (r, c) in merged_hidden:
                    continue
                text = str(row[c]) if c < len(row) and row[c] is not None else ""
                t.set_cell_text(r, c, text, split_paragraphs="\n" in text)
                is_head = r < header_rows or c < header_cols
                cell = t.cell(r, c)
                for p in cell.paragraphs:
                    p.char_pr_id_ref = bold_id if (is_head or (r, c) in bold_set) else normal
                    for run in p.runs:
                        run.char_pr_id_ref = p.char_pr_id_ref
                self.doc.styles.apply_paragraph_format(
                    paragraphs=list(cell.paragraphs), alignment="CENTER" if is_head else aligns[c], line_spacing_percent=140)
                if is_head:
                    t.set_cell_shading(r, c, shade)
                cell.set_margins(left=400, right=400, top=200, bottom=200)
                h = (heights_mm or {}).get(r) or min_height_mm
                if h:
                    cell.set_size(height=int(h * MM))
        for r1, c1, r2, c2 in merges:
            t.merge_cells(r1, c1, r2, c2)
        return t

    def kv_table(self, pairs: list[tuple[str, str]], cols: int = 2, label_mm: float = 28, size: float = 10.5,
                 heights_mm: dict[int, float] | None = None):
        """'제목 | 값' 짝을 한 줄에 cols 쌍씩 배치한 표."""
        rows, merges = [], []
        for i in range(0, len(pairs), cols):
            chunk = pairs[i:i + cols]
            row = []
            for k, v in chunk:
                row += [k, v]
            if len(chunk) < cols:  # 마지막 줄 값 칸을 끝까지 합침
                row += [""] * (2 * (cols - len(chunk)))
                merges.append((len(rows), 2 * len(chunk) - 1, len(rows), 2 * cols - 1))
            rows.append(row)
        value_mm = (self.content_mm - label_mm * cols) / cols
        widths = [label_mm, value_mm] * cols
        return self.table(rows, widths, header_cols=0, merges=merges, align=["CENTER", "LEFT"] * cols, size=size,
                          heights_mm=heights_mm, bold_cells=[(r, c) for r in range(len(rows)) for c in range(0, 2 * cols, 2)],
                          shade="#FFFFFF")

    def label_cells(self, t, cells: Iterable[tuple[int, int]], shade: str = "#E7EEF7"):
        for r, c in cells:
            t.set_cell_shading(r, c, shade)

    def to_bytes(self) -> bytes:
        rm = getattr(self, "_remove_first", None)
        if rm is not None:
            try:
                rm.remove()
            except Exception:
                pass
            self._remove_first = None
        report = self.doc.validate()
        if getattr(report, "issues", None):
            raise ValueError(f"한글 문서 검증 실패: {report.issues[:3]}")
        return self.doc.to_bytes()


# ======================================================================
# 학교 양식 채우기
# ======================================================================
_NORM = re.compile(r"[\s:：()（）\[\]·.,/※*]+")


def _norm(s: str) -> str:
    return _NORM.sub("", s or "")


def open_template(data: bytes, filename: str = "") -> HwpxDocument:
    name = filename.lower()
    if not (name.endswith(".hwpx") or name.endswith(".hwp")):
        raise ValueError("한글 파일(.hwp 또는 .hwpx)만 등록할 수 있습니다.")
    try:
        return HwpxDocument.open(io.BytesIO(data))
    except Exception as e:
        raise ValueError(f"한글 파일을 열 수 없습니다: {e}. 한글에서 '다른 이름으로 저장 → HWPX'로 저장한 뒤 다시 등록해 보세요.") from e


def inspect_template(data: bytes, filename: str = "") -> dict:
    """양식 안의 자리표시({{...}})와 표 제목 칸 목록."""
    doc = open_template(data, filename)
    text = doc.text.plain()
    placeholders = sorted(set(re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", text)))
    labels = []
    for t in doc.tables.all:
        for pos in t.iter_grid():
            if pos.is_anchor:
                s = (pos.cell.text or "").strip()
                if s and len(s) <= 20:
                    labels.append(s)
    return {"placeholders": placeholders, "labels": labels[:200], "tables": len(doc.tables.all)}


def fill_template(data: bytes, filename: str, values: dict[str, str], label_map: dict[str, str] | None = None) -> tuple[bytes, dict]:
    """values: 자리표시 이름 → 값,  label_map: 표 제목(정확히 일치) → 값.

    반환: (hwpx 바이트, {"placeholders": [...], "labels": [...], "missing": [...]})"""
    doc = open_template(data, filename)
    done_ph, done_lb = [], []
    for key, val in values.items():
        for pat in (f"{{{{{key}}}}}", f"{{{{ {key} }}}}"):
            n = doc.text.replace(pat, str(val), everywhere=True)
            if n:
                done_ph.append(key)
    if label_map:
        wanted = {_norm(k): (k, v) for k, v in label_map.items() if v not in (None, "")}
        used: set[str] = set()
        for t in doc.tables.all:
            grid = {(p.row, p.column): p for p in t.iter_grid()}
            for (r, c), pos in grid.items():
                if not pos.is_anchor:
                    continue
                key = _norm(pos.cell.text or "")
                if key not in wanted or key in used:
                    continue
                target = grid.get((r, c + max(pos.col_span, 1)))
                if not target or not target.is_anchor or (target.cell.text or "").strip():
                    continue  # 오른쪽 칸이 없거나 이미 글자가 있으면 건드리지 않음
                label, val = wanted[key]
                t.set_cell_text(target.row, target.column, str(val), split_paragraphs="\n" in str(val))
                used.add(key)
                done_lb.append(label)
    remaining = re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", doc.text.plain())
    out = doc.to_bytes()
    return out, {"placeholders": sorted(set(done_ph)), "labels": done_lb, "unfilledPlaceholders": sorted(set(remaining))}
