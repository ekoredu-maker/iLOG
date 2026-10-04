"""국가수준 기본 지도계획을 한 번의 DB 읽기/쓰기로 일괄 적용한다.

기존 CurriculumLibrary.apply()는 과목마다 연간시간표 전체를 다시 읽고 날짜별로
레코드를 조회했다. 여러 과목을 한꺼번에 적용하면 같은 자료를 반복 해독/저장하게
되어 실제 학급 데이터에서 UI가 오래 멈출 수 있다.

이 모듈은 담임 개설과목 목록을 받아 연간시간표를 한 번만 읽고, 변경된 날짜를
한 번의 put_many()로 저장한다. 교사가 이미 입력한 지도내용은 overwrite=False일 때
보존한다.
"""
from __future__ import annotations

from .curriculum import PHASES, CurriculumLibrary
from .db import Database, StoreError


def _norm(value) -> str:
    return "".join(str(value or "").split()).strip()


def _expand(templates: list[dict], count: int) -> list[dict]:
    if count <= 0 or not templates:
        return []
    out: list[dict] = []
    for i in range(count):
        idx = min(len(templates) - 1, int(i * len(templates) / count))
        base = dict(templates[idx])
        phase = PHASES[i % len(PHASES)]
        topic = base.get("unit") or base.get("content") or base.get("objective") or "기본 학습"
        base["seq"] = i + 1
        base["content"] = f"{topic} - {phase}"
        out.append(base)
    return out


def apply_national_batch(
    db: Database,
    library: CurriculumLibrary,
    grade,
    subjects: list[dict] | None,
    overwrite: bool = False,
) -> dict:
    """담임 개설과목에 2022 개정 국가수준 기본안을 일괄 적용한다."""
    try:
        grade = int(grade)
    except (TypeError, ValueError) as exc:
        raise StoreError("학년 값이 올바르지 않습니다.") from exc
    if not 1 <= grade <= 6:
        raise StoreError("학년 값은 1~6이어야 합니다.")

    subject_specs = [s for s in (subjects or []) if isinstance(s, dict)]
    if not subject_specs:
        return {"matched": 0, "applied": 0, "skipped": 0, "subjects": [], "changedDays": 0}

    # 국가수준 기본안은 한 번만 구성한다.
    national: dict[str, dict] = {}
    for pack, _builtin in library.all_packs().values():
        if (
            int(pack.get("grade") or 0) == grade
            and pack.get("publisher") == "국가수준 기본안"
            and pack.get("curriculum") == "2022 개정"
        ):
            national[_norm(pack.get("subject"))] = pack

    annual = sorted(db.get_all("annual_schedule"), key=lambda d: d.get("date") or "")
    changed_dates: set[str] = set()
    total_applied = 0
    total_skipped = 0
    result_subjects: list[dict] = []

    choice_rec = db.get("settings", "curriculum") or {"id": "curriculum", "choices": {}}
    choices = choice_rec.setdefault("choices", {})

    for spec in subject_specs:
        name = str(spec.get("name") or spec.get("shortName") or "").strip()
        short = str(spec.get("shortName") or spec.get("name") or "").strip()
        if not name or not short:
            continue

        pack = national.get(_norm(name)) or national.get(_norm(short))
        if not pack:
            continue

        keys = {_norm(name), _norm(short)}
        targets: list[tuple[dict, dict]] = []
        for day in annual:
            for lesson in sorted(day.get("subjects") or [], key=lambda x: int(x.get("period") or 0)):
                lesson_name = lesson.get("name") or lesson.get("subjectShort") or lesson.get("subjectName")
                if _norm(lesson_name) in keys:
                    targets.append((day, lesson))

        lessons = pack.get("lessons") or []
        expanded = _expand(lessons, len(targets)) if pack.get("adaptive") else lessons[:len(targets)]
        applied = skipped = 0

        for (day, target), lesson in zip(targets, expanded):
            if not overwrite and (target.get("unit") or target.get("objective") or target.get("content")):
                skipped += 1
                continue
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
            if day.get("date"):
                changed_dates.add(str(day["date"]))
            applied += 1

        choices[short] = pack["packId"]
        total_applied += applied
        total_skipped += skipped
        result_subjects.append({
            "name": name,
            "shortName": short,
            "packId": pack["packId"],
            "slots": len(targets),
            "applied": applied,
            "skipped": skipped,
        })

    if changed_dates:
        db.put_many(
            "annual_schedule",
            [day for day in annual if str(day.get("date") or "") in changed_dates],
        )
    if result_subjects:
        db.put("settings", choice_rec)

    return {
        "matched": len(result_subjects),
        "applied": total_applied,
        "skipped": total_skipped,
        "subjects": result_subjects,
        "changedDays": len(changed_dates),
    }
