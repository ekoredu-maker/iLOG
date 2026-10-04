"""지도계획 라이브러리.

데이터팩 1개 = (학년, 과목, 출처/출판사, 교육과정) 1조합의 지도계획.
- 프로그램 기본 탑재: curriculum_packs/*.json + 국가수준 기본안
- 교사가 엑셀/JSON으로 가져온 팩: DB curriculum_packs

일반 팩은 차시를 1:1로 배치하고, `adaptive=True`인 국가수준 기본안은
실제 연간시간표의 해당 과목 차시 수에 맞춰 영역·주제를 자동 확장한다.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .db import Database, StoreError
from .national_curriculum import national_packs

PACK_FORMAT = "ilog-curriculum/1"
PHASES = ("개념·경험 알아보기", "탐구·연습하기", "문제 해결·표현하기", "적용·성찰하기")

HEADER_ALIASES = {
    "grade": ["학년"],
    "subject": ["과목", "교과", "과목명"],
    "publisher": ["출판사", "발행사", "교과서", "출처"],
    "semester": ["학기"],
    "seq": ["차시", "순서", "차시번호"],
    "domain": ["영역", "교육과정영역"],
    "unit": ["단원", "지도단원", "지도 단원", "단원명"],
    "objective": ["학습목표", "학습 목표", "목표"],
    "content": ["지도내용", "지도 내용", "학습주제", "지도내용(학습주제)", "내용", "활동"],
    "standard": ["성취기준", "성취 기준"],
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
    for i, lesson in enumerate(lessons):
        sem = _int(lesson.get("semester"))
        clean.append({
            "semester": sem if sem in (1, 2) else None,
            "seq": _int(lesson.get("seq"), i + 1),
            "domain": str(lesson.get("domain") or "").strip(),
            "unit": str(lesson.get("unit") or "").strip(),
            "objective": str(lesson.get("objective") or "").strip(),
            "content": str(lesson.get("content") or "").strip(),
            "standard": str(lesson.get("standard") or "").strip(),
            "page": str(lesson.get("page") or "").strip(),
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
        "adaptive": bool(pack.get("adaptive")),
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
        grade = cell(row, "grade")
        subject = str(cell(row, "subject")).strip()
        publisher = str(cell(row, "publisher")).strip()
        if not (grade and subject and publisher):
            continue
        curriculum = str(cell(row, "curriculum") or "").strip()
        key = (str(grade), subject, publisher, curriculum)
        group = groups.setdefault(key, {
            "grade": grade, "subject": subject, "publisher": publisher,
            "curriculum": curriculum, "lessons": []
        })
        for seq in _expand_seq(cell(row, "seq")):
            group["lessons"].append({
                "semester": cell(row, "semester"), "seq": seq,
                "domain": cell(row, "domain"), "unit": cell(row, "unit"),
                "objective": cell(row, "objective"), "content": cell(row, "content"),
                "standard": cell(row, "standard"), "page": cell(row, "page"),
            })
    if not groups:
        raise StoreError("가져올 차시가 없습니다. 학년·과목·출판사·차시 칸을 확인해 주세요.")
    return [validate_pack(group) for group in groups.values()]


def summarize(pack: dict, builtin: bool) -> dict:
    lessons = pack.get("lessons") or []
    return {
        "packId": pack["packId"], "grade": pack["grade"], "subject": pack["subject"],
        "publisher": pack["publisher"], "curriculum": pack.get("curriculum", ""),
        "source": pack.get("source", ""), "note": pack.get("note", ""), "builtin": builtin,
        "adaptive": bool(pack.get("adaptive")),
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
        # 저작권과 출판사에 독립적인 국가수준 기본안을 항상 먼저 제공한다.
        for pack in national_packs():
            try:
                packs.append(validate_pack(pack))
            except Exception as exc:
                print(f"[curriculum] 국가수준 기본안 건너뜀: {exc}")
        if self.builtin_dir and self.builtin_dir.is_dir():
            for file in sorted(self.builtin_dir.glob("*.json")):
                try:
                    data = json.loads(file.read_text(encoding="utf-8"))
                    items = data if isinstance(data, list) else [data]
                    packs.extend(validate_pack(pack) for pack in items)
                except Exception as exc:
                    print(f"[curriculum] {file.name} 건너뜀: {exc}")
        return packs

    def all_packs(self) -> dict[str, tuple[dict, bool]]:
        out: dict[str, tuple[dict, bool]] = {}
        for pack in self._builtin_packs():
            out[pack["packId"]] = (pack, True)
        for pack in self.db.list_user_packs():
            out[pack["packId"]] = (pack, False)  # 교사가 가져온 팩이 같은 ID면 우선
        return out

    def list(self, grade: int | None = None) -> list[dict]:
        items = [summarize(pack, builtin) for pack, builtin in self.all_packs().values()]
        if grade:
            items = [item for item in items if item["grade"] == int(grade)]
        items.sort(key=lambda item: (item["grade"], item["subject"], 0 if item.get("adaptive") else 1, item["publisher"]))
        return items

    def get(self, pack_id: str) -> dict:
        found = self.all_packs().get(pack_id)
        if not found:
            raise StoreError("지도계획 데이터를 찾을 수 없습니다.")
        return found[0]

    # ------------------------------------------------------------ 가져오기
    def import_rows(self, rows: list[list]) -> list[dict]:
        packs = packs_from_rows(rows)
        for pack in packs:
            self.db.save_user_pack(pack)
        return [summarize(pack, False) for pack in packs]

    def import_json(self, data) -> list[dict]:
        if isinstance(data, str):
            data = json.loads(data)
        items = data if isinstance(data, list) else [data]
        packs = [validate_pack(pack) for pack in items]
        for pack in packs:
            self.db.save_user_pack(pack)
        return [summarize(pack, False) for pack in packs]

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
        term1_range = (settings.get("term1Start") or "", settings.get("term1End") or "")
        term2_range = (settings.get("term2Start") or "", settings.get("term2End") or "")
        days = sorted(self.db.get_all("annual_schedule"), key=lambda day: day.get("date", ""))
        term1, term2, other = [], [], []
        for day in days:
            day_str = day.get("date", "")
            for lesson in sorted(day.get("subjects") or [], key=lambda x: x.get("period", 0)):
                if lesson.get("name") != subject_short:
                    continue
                slot = (day_str, lesson.get("period"))
                if term1_range[0] and term1_range[1] and term1_range[0] <= day_str <= term1_range[1]:
                    term1.append(slot)
                elif term2_range[0] and term2_range[1] and term2_range[0] <= day_str <= term2_range[1]:
                    term2.append(slot)
                else:
                    other.append(slot)
        return term1, term2, other

    def _adaptive_lessons(self, templates: list[dict], count: int) -> list[dict]:
        """소수의 국가수준 주제를 실제 차시 수만큼 고르게 확장한다."""
        if count <= 0 or not templates:
            return []
        out = []
        for i in range(count):
            idx = min(len(templates) - 1, int(i * len(templates) / count))
            base = dict(templates[idx])
            phase = PHASES[i % len(PHASES)]
            topic = base.get("unit") or base.get("content") or base.get("objective") or "기본 학습"
            base["seq"] = i + 1
            base["content"] = f"{topic} - {phase}"
            out.append(base)
        return out

    def _plan(self, pack: dict, subject_short: str):
        term1, term2, other = self._slots(subject_short)
        lessons = pack["lessons"]
        assignments = []  # (slot, lesson)
        summary = []

        if pack.get("adaptive"):
            slots = term1 + term2 + other
            expanded = self._adaptive_lessons(lessons, len(slots))
            assignments.extend(zip(slots, expanded))
            offset = 0
            for label, group_slots in (("1학기", term1), ("2학기", term2), ("기타", other)):
                if not group_slots:
                    continue
                n = len(group_slots)
                summary.append({"term": label, "slots": n, "lessons": n, "applied": n, "emptySlots": 0, "leftLessons": 0})
                offset += n
            return assignments, summary

        has_semester = any(lesson.get("semester") for lesson in lessons)
        if has_semester:
            lesson1 = [lesson for lesson in lessons if lesson.get("semester") in (1, None)]
            lesson2 = [lesson for lesson in lessons if lesson.get("semester") == 2]
            groups = [("1학기", term1, lesson1), ("2학기", term2, lesson2)]
        else:
            groups = [("전체", term1 + term2 + other, lessons)]
        for label, slots, group_lessons in groups:
            n = min(len(slots), len(group_lessons))
            assignments.extend(zip(slots[:n], group_lessons[:n]))
            summary.append({
                "term": label, "slots": len(slots), "lessons": len(group_lessons),
                "applied": n, "emptySlots": len(slots) - n, "leftLessons": len(group_lessons) - n
            })
        return assignments, summary

    def preview(self, pack_id: str, subject_short: str) -> dict:
        found = self.all_packs().get(pack_id)
        if not found:
            raise StoreError("지도계획 데이터를 찾을 수 없습니다.")
        pack, builtin = found
        _, summary = self._plan(pack, subject_short)
        return {"pack": summarize(pack, builtin), "subject": subject_short, "terms": summary}

    def apply(self, pack_id: str, subject_short: str, overwrite: bool = True) -> dict:
        """연간 시간표의 해당 과목 칸에 지도내용을 채운다."""
        pack = self.get(pack_id)
        assignments, summary = self._plan(pack, subject_short)
        by_date: dict[str, dict] = {}
        changed = skipped = 0
        for (day_str, period), lesson in assignments:
            day = by_date.get(day_str) or self.db.get("annual_schedule", day_str)
            if not day:
                continue
            by_date[day_str] = day
            for target in day.get("subjects") or []:
                if target.get("period") == period and target.get("name") == subject_short:
                    if not overwrite and (target.get("unit") or target.get("objective") or target.get("content")):
                        skipped += 1
                        break
                    target["domain"] = lesson.get("domain") or ""
                    target["unit"] = lesson.get("unit") or ""
                    target["objective"] = lesson.get("objective") or ""
                    target["content"] = lesson.get("content") or lesson.get("objective") or lesson.get("unit") or ""
                    target["standard"] = lesson.get("standard") or ""
                    target["page"] = lesson.get("page") or ""
                    target["lessonSeq"] = lesson.get("seq")
                    target["planSource"] = pack["packId"]
                    target.setdefault("crossTags", [])
                    target.setdefault("crossNote", "")
                    changed += 1
                    break
        if by_date:
            self.db.put_many("annual_schedule", list(by_date.values()))
        self.set_choice(subject_short, pack_id)
        return {
            "applied": changed, "skipped": skipped, "terms": summary,
            "publisher": pack["publisher"], "subject": pack["subject"],
            "adaptive": bool(pack.get("adaptive")),
        }
