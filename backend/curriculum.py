"""출판사별 지도계획 라이브러리.

데이터팩 1개 = (학년, 과목, 출판사, 교육과정) 1조합의 차시별 지도계획.
- 프로그램에 함께 들어있는 팩: curriculum_packs/*.json (읽기 전용)
- 교사가 엑셀로 가져온 팩: DB 의 curriculum_packs 테이블

적용(apply) 하면 연간 시간표에서 해당 과목 칸을 날짜·교시 순으로 찾아
1학기 차시는 1학기 칸에, 2학기 차시는 2학기 칸에 차례대로 채운다.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .db import Database, StoreError

PACK_FORMAT = "ilog-curriculum/1"

HEADER_ALIASES = {
    "grade": ["학년"],
    "subject": ["과목", "교과", "과목명"],
    "publisher": ["출판사", "발행사", "교과서"],
    "semester": ["학기"],
    "seq": ["차시", "순서", "차시번호"],
    "unit": ["단원", "지도단원", "지도 단원", "단원명"],
    "objective": ["학습목표", "학습 목표", "목표"],
    "content": ["지도내용", "지도 내용", "학습주제", "지도내용(학습주제)", "내용", "활동"],
    "curriculum": ["교육과정"],
    "page": ["쪽수", "교과서쪽수", "쪽"],
}


def _slug(*parts) -> str:
    s = "_".join(str(p) for p in parts if p not in (None, ""))
    return re.sub(r"[^0-9A-Za-z가-힣_]+", "", s.replace(" ", ""))


def make_pack_id(grade, subject, publisher, curriculum="") -> str:
    return "g" + _slug(grade, subject, publisher, curriculum)


def _int(v, default=None):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return default


def _expand_seq(v) -> list[int]:
    """'3' -> [3], '2~3' -> [2,3], '4-6' -> [4,5,6]."""
    if isinstance(v, (int, float)):
        return [int(v)]
    s = str(v or "").strip().replace("차시", "")
    m = re.match(r"^(\d+)\s*[~\-–]\s*(\d+)$", s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if a <= b and b - a < 20:
            return list(range(a, b + 1))
    n = _int(s)
    return [n] if n is not None else []


def validate_pack(pack: dict) -> dict:
    if not isinstance(pack, dict):
        raise StoreError("지도계획 데이터 형식이 올바르지 않습니다.")
    for f in ("grade", "subject", "publisher"):
        if pack.get(f) in (None, ""):
            raise StoreError(f"지도계획 데이터에 '{f}' 값이 없습니다.")
    lessons = pack.get("lessons")
    if not isinstance(lessons, list) or not lessons:
        raise StoreError(f"{pack.get('subject')} / {pack.get('publisher')}: 차시 내용이 없습니다.")
    grade = _int(pack["grade"])
    if grade is None or not 1 <= grade <= 6:
        raise StoreError(f"학년 값이 올바르지 않습니다: {pack['grade']}")
    clean = []
    for i, l in enumerate(lessons):
        sem = _int(l.get("semester"))
        clean.append({
            "semester": sem if sem in (1, 2) else None,
            "seq": _int(l.get("seq"), i + 1),
            "unit": str(l.get("unit") or "").strip(),
            "objective": str(l.get("objective") or "").strip(),
            "content": str(l.get("content") or "").strip(),
            "page": str(l.get("page") or "").strip(),
        })
    clean.sort(key=lambda x: (x["semester"] or 0, x["seq"]))
    curriculum = str(pack.get("curriculum") or "").strip()
    out = {
        "format": PACK_FORMAT,
        "grade": grade,
        "subject": str(pack["subject"]).strip(),
        "publisher": str(pack["publisher"]).strip(),
        "curriculum": curriculum,
        "source": str(pack.get("source") or "").strip(),
        "note": str(pack.get("note") or "").strip(),
        "lessons": clean,
    }
    out["packId"] = pack.get("packId") or make_pack_id(grade, out["subject"], out["publisher"], curriculum)
    return out


def packs_from_rows(rows: list[list]) -> list[dict]:
    """엑셀 행 목록 -> 데이터팩 목록 (한 파일에 여러 팩 가능)."""
    if not rows or len(rows) < 2:
        raise StoreError("엑셀 내용이 비어 있습니다.")
    header = [re.sub(r"\s+", "", str(h or "")) for h in rows[0]]
    idx = {}
    for key, names in HEADER_ALIASES.items():
        normalized = [re.sub(r"\s+", "", n) for n in names]
        idx[key] = next((i for i, h in enumerate(header) if h in normalized), -1)
    missing = [k for k in ("grade", "subject", "publisher", "seq") if idx[k] < 0]
    if missing:
        names = {"grade": "학년", "subject": "과목", "publisher": "출판사", "seq": "차시"}
        raise StoreError("1행 제목에 " + ", ".join(names[m] for m in missing) + " 칸이 필요합니다.")

    def cell(row, key):
        i = idx[key]
        return row[i] if 0 <= i < len(row) else ""

    groups: dict[tuple, dict] = {}
    for row in rows[1:]:
        if not row or all(v in ("", None) for v in row):
            continue
        grade, subject, publisher = cell(row, "grade"), str(cell(row, "subject")).strip(), str(cell(row, "publisher")).strip()
        if not (grade and subject and publisher):
            continue
        curriculum = str(cell(row, "curriculum") or "").strip()
        key = (str(grade), subject, publisher, curriculum)
        g = groups.setdefault(key, {"grade": grade, "subject": subject, "publisher": publisher,
                                    "curriculum": curriculum, "lessons": []})
        for seq in _expand_seq(cell(row, "seq")):
            g["lessons"].append({
                "semester": cell(row, "semester"), "seq": seq,
                "unit": cell(row, "unit"), "objective": cell(row, "objective"),
                "content": cell(row, "content"), "page": cell(row, "page"),
            })
    if not groups:
        raise StoreError("가져올 차시가 없습니다. 학년·과목·출판사·차시 칸을 확인해 주세요.")
    return [validate_pack(g) for g in groups.values()]


def summarize(pack: dict, builtin: bool) -> dict:
    lessons = pack.get("lessons") or []
    return {
        "packId": pack["packId"], "grade": pack["grade"], "subject": pack["subject"],
        "publisher": pack["publisher"], "curriculum": pack.get("curriculum", ""),
        "source": pack.get("source", ""), "note": pack.get("note", ""), "builtin": builtin,
        "lessonCount": len(lessons),
        "term1": sum(1 for l in lessons if l.get("semester") == 1),
        "term2": sum(1 for l in lessons if l.get("semester") == 2),
    }


class CurriculumLibrary:
    def __init__(self, db: Database, builtin_dir: Path | None = None):
        self.db = db
        self.builtin_dir = builtin_dir

    # ---------------------------------------------------------------- 조회
    def _builtin_packs(self) -> list[dict]:
        packs = []
        if self.builtin_dir and self.builtin_dir.is_dir():
            for f in sorted(self.builtin_dir.glob("*.json")):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    items = data if isinstance(data, list) else [data]
                    packs.extend(validate_pack(p) for p in items)
                except Exception as e:  # 잘못된 팩 하나 때문에 전체가 멈추지 않도록
                    print(f"[curriculum] {f.name} 건너뜀: {e}")
        return packs

    def all_packs(self) -> dict[str, tuple[dict, bool]]:
        out: dict[str, tuple[dict, bool]] = {}
        for p in self._builtin_packs():
            out[p["packId"]] = (p, True)
        for p in self.db.list_user_packs():
            out[p["packId"]] = (p, False)  # 교사가 가져온 팩이 같은 ID면 우선
        return out

    def list(self, grade: int | None = None) -> list[dict]:
        items = [summarize(p, b) for p, b in self.all_packs().values()]
        if grade:
            items = [i for i in items if i["grade"] == int(grade)]
        items.sort(key=lambda i: (i["grade"], i["subject"], i["publisher"]))
        return items

    def get(self, pack_id: str) -> dict:
        found = self.all_packs().get(pack_id)
        if not found:
            raise StoreError("지도계획 데이터를 찾을 수 없습니다.")
        return found[0]

    # ------------------------------------------------------------ 가져오기
    def import_rows(self, rows: list[list]) -> list[dict]:
        packs = packs_from_rows(rows)
        for p in packs:
            self.db.save_user_pack(p)
        return [summarize(p, False) for p in packs]

    def import_json(self, data) -> list[dict]:
        if isinstance(data, str):
            data = json.loads(data)
        items = data if isinstance(data, list) else [data]
        packs = [validate_pack(p) for p in items]
        for p in packs:
            self.db.save_user_pack(p)
        return [summarize(p, False) for p in packs]

    def delete(self, pack_id: str) -> bool:
        return self.db.delete_user_pack(pack_id)

    # ---------------------------------------------------- 선택 저장
    def get_choices(self) -> dict:
        rec = self.db.get("settings", "curriculum") or {}
        return rec.get("choices") or {}

    def set_choice(self, subject_short: str, pack_id: str | None) -> dict:
        rec = self.db.get("settings", "curriculum") or {"id": "curriculum", "choices": {}}
        rec.setdefault("choices", {})
        if pack_id:
            rec["choices"][subject_short] = pack_id
        else:
            rec["choices"].pop(subject_short, None)
        self.db.put("settings", rec)
        return rec["choices"]

    # ------------------------------------------------------- 배치 계산
    def _slots(self, subject_short: str):
        settings = self.db.get("settings", "global") or {}
        t1 = (settings.get("term1Start") or "", settings.get("term1End") or "")
        t2 = (settings.get("term2Start") or "", settings.get("term2End") or "")
        days = sorted(self.db.get_all("annual_schedule"), key=lambda d: d.get("date", ""))
        term1, term2, other = [], [], []
        for day in days:
            d = day.get("date", "")
            for s in sorted(day.get("subjects") or [], key=lambda x: x.get("period", 0)):
                if s.get("name") != subject_short:
                    continue
                slot = (d, s.get("period"))
                if t1[0] and t1[1] and t1[0] <= d <= t1[1]:
                    term1.append(slot)
                elif t2[0] and t2[1] and t2[0] <= d <= t2[1]:
                    term2.append(slot)
                else:
                    other.append(slot)
        return term1, term2, other

    def _plan(self, pack: dict, subject_short: str):
        term1, term2, other = self._slots(subject_short)
        lessons = pack["lessons"]
        has_sem = any(l.get("semester") for l in lessons)
        assignments = []  # (slot, lesson)
        if has_sem:
            l1 = [l for l in lessons if l.get("semester") in (1, None)]
            l2 = [l for l in lessons if l.get("semester") == 2]
            groups = [("1학기", term1, l1), ("2학기", term2, l2)]
        else:
            groups = [("전체", term1 + term2 + other, lessons)]
        summary = []
        for label, slots, ls in groups:
            n = min(len(slots), len(ls))
            assignments.extend(zip(slots[:n], ls[:n]))
            summary.append({"term": label, "slots": len(slots), "lessons": len(ls),
                            "applied": n, "emptySlots": len(slots) - n, "leftLessons": len(ls) - n})
        return assignments, summary

    def preview(self, pack_id: str, subject_short: str) -> dict:
        pack = self.get(pack_id)
        _, summary = self._plan(pack, subject_short)
        return {"pack": summarize(pack, False), "subject": subject_short, "terms": summary}

    def apply(self, pack_id: str, subject_short: str, overwrite: bool = True) -> dict:
        """연간 시간표의 해당 과목 칸에 차시 내용을 채운다.

        overwrite=False 이면 이미 내용이 입력된 칸은 건드리지 않는다
        (차시 순서는 그대로 유지되므로 해당 차시는 건너뛴다).
        """
        pack = self.get(pack_id)
        assignments, summary = self._plan(pack, subject_short)
        by_date: dict[str, dict] = {}
        changed = skipped = 0
        for (d, period), lesson in assignments:
            day = by_date.get(d) or self.db.get("annual_schedule", d)
            if not day:
                continue
            by_date[d] = day
            for s in day.get("subjects") or []:
                if s.get("period") == period and s.get("name") == subject_short:
                    if not overwrite and (s.get("unit") or s.get("objective") or s.get("content")):
                        skipped += 1
                        break
                    s["unit"] = lesson["unit"]
                    s["objective"] = lesson["objective"]
                    s["content"] = lesson["content"] or lesson["objective"] or lesson["unit"]
                    s["lessonSeq"] = lesson["seq"]
                    s["planSource"] = pack["packId"]
                    s.setdefault("crossTags", [])
                    s.setdefault("crossNote", "")
                    changed += 1
                    break
        if by_date:
            self.db.put_many("annual_schedule", list(by_date.values()))
        self.set_choice(subject_short, pack_id)
        return {"applied": changed, "skipped": skipped, "terms": summary,
                "publisher": pack["publisher"], "subject": pack["subject"]}
