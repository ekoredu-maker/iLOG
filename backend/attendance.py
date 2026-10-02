"""출결 - 나이스(NEIS) 기준 집계와 교외체험학습 출석인정 연동.

기록(교시 단위): status ∈ 출석/결석/지각/조퇴/결과, reason ∈ 질병/미인정/기타/인정
하루 단위 판정(나이스 방식):
  · 결석(인정 아님)이 있으면 그날은 '결석(사유)' 하루 — 지각·조퇴·결과는 세지 않음
  · 결석이 모두 '인정'이면 '출석인정' 하루 (출석으로 셈)
  · 그 외에는 지각/조퇴/결과를 각각 하루 1회씩 센다
예전(v9) 기록처럼 사유가 없으면 '미분류'로 세어 교사가 고칠 수 있게 표시한다.
"""
from __future__ import annotations

from collections import defaultdict

STATUSES = ["결석", "지각", "조퇴", "결과"]
REASONS = ["질병", "미인정", "기타"]
RECOGNIZED = "인정"
UNCLASSIFIED = "미분류"


def reason_of(rec: dict) -> str:
    r = (rec.get("reason") or "").strip()
    if r in REASONS or r == RECOGNIZED:
        return r
    return UNCLASSIFIED


def day_status(recs: list[dict]) -> dict:
    """하루치 기록 → {'absent': 사유|None, 'recognized': bool, '지각': 사유, '조퇴': 사유, '결과': 사유}"""
    out = {"absent": None, "recognized": False, "지각": None, "조퇴": None, "결과": None}
    absents = [r for r in recs if r.get("status") == "결석"]
    if absents:
        real = [r for r in absents if reason_of(r) != RECOGNIZED]
        if real:
            out["absent"] = reason_of(real[0])
            return out
        out["recognized"] = True
        return out
    for st in ("지각", "조퇴", "결과"):
        hit = [r for r in recs if r.get("status") == st]
        if hit:
            out[st] = reason_of(hit[0])
    return out


def empty_counts() -> dict:
    c = {f"{s}_{r}": 0 for s in STATUSES for r in REASONS + [UNCLASSIFIED]}
    c.update({"출석인정": 0, "수업일수": 0, "출석일수": 0, "미분류": 0})
    return c


def student_counts(records: list[dict], school_days: set[str], start: str = "", end: str = "") -> dict:
    by_date = defaultdict(list)
    for r in records:
        d = r.get("date") or ""
        if (start and d < start) or (end and d > end):
            continue
        by_date[d].append(r)
    c = empty_counts()
    days_in_range = {d for d in school_days if (not start or d >= start) and (not end or d <= end)}
    c["수업일수"] = len(days_in_range)
    absent_days = 0
    for d, recs in by_date.items():
        st = day_status(recs)
        if st["absent"]:
            c[f"결석_{st['absent']}"] += 1
            absent_days += 1
        elif st["recognized"]:
            c["출석인정"] += 1
        else:
            for s in ("지각", "조퇴", "결과"):
                if st[s]:
                    c[f"{s}_{st[s]}"] += 1
    c["출석일수"] = max(c["수업일수"] - absent_days, 0)
    c["미분류"] = sum(c[f"{s}_{UNCLASSIFIED}"] for s in STATUSES)
    return c


def totals(c: dict) -> dict:
    """결석/지각/조퇴/결과 합계 (미분류 포함)."""
    return {s: sum(c[f"{s}_{r}"] for r in REASONS + [UNCLASSIFIED]) for s in STATUSES}


def sync_experiential(db, exp_id: str) -> dict:
    """교외체험학습이 '승인'이면 기간 중 수업일의 모든 교시를 결석(인정)으로 기록한다.

    승인 취소·기간 변경·삭제 시에는 이전에 자동으로 넣은 기록을 지우고 다시 맞춘다."""
    old = [a["attendanceId"] for a in db.get_all("attendance") if a.get("source") == exp_id]
    if old:
        db.delete_many("attendance", old)
    exp = db.get("experiential", exp_id)
    if not exp or exp.get("status") != "approved" or not exp.get("startDate"):
        return {"days": 0, "removed": len(old)}
    s, e = exp["startDate"], exp.get("endDate") or exp["startDate"]
    sid = exp.get("studentId")
    recs, days = [], 0
    for day in db.get_all("annual_schedule"):
        d = day.get("date", "")
        if not (s <= d <= e):
            continue
        periods = sorted({x.get("period") for x in day.get("subjects") or [] if x.get("period")})
        if not periods:
            continue
        days += 1
        for p in periods:
            recs.append({"attendanceId": f"{d}_{p}_{sid}", "date": d, "period": p, "studentId": sid,
                         "status": "결석", "reason": RECOGNIZED, "note": f"교외체험학습({exp.get('type') or ''})",
                         "source": exp_id})
    if recs:
        db.put_many("attendance", recs)
    return {"days": days, "removed": len(old)}
