"""화면(JavaScript)에서 호출하는 파이썬 기능 모음.

pywebview 의 js_api 로 등록되며, 개발/테스트용 HTTP 서버(devserver.py)도
같은 객체를 사용한다. 모든 메서드는 JSON 으로 바꿀 수 있는 값만 반환한다.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import webbrowser
from datetime import date, timedelta
from pathlib import Path

from . import attendance as att
from . import forms
from . import reports
from . import assessment_reports
from . import class_book_assessment
from .hwpx_builder import inspect_template
from .curriculum import CurriculumLibrary
from .db import Database, StoreError, new_id
from .excel_io import make_template, normalize_date, read_rows_b64

APP_VERSION = "10.3.0"

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
HWPX_MIME = "application/hwp+zip"
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
KEEP_FIELDS = ("unit", "objective", "content", "crossTags", "crossNote", "lessonSeq", "planSource")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _safe_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "_", name).strip() or "파일"


def _header_index(header: list, names: list[str]) -> int:
    norm = [re.sub(r"\s+", "", str(h or "")) for h in header]
    for n in names:
        if n in norm:
            return norm.index(n)
    return -1


def _is_holiday_flag(v) -> bool:
    return str(v or "").strip().upper() in ("O", "Y", "TRUE", "1", "휴업", "○", "V")


class Api:
    def __init__(self, db: Database, builtin_packs: Path | None = None, desktop: bool = False):
        self._db = db
        self._lib = CurriculumLibrary(db, builtin_packs)
        self._desktop = desktop
        self._window = None  # main.py 에서 설정

    def _set_window(self, window):
        self._window = window

    # ------------------------------------------------------------------ 정보
    def app_info(self):
        return {"version": APP_VERSION, "dataDir": str(self._db.data_dir), "desktop": self._desktop}

    # -------------------------------------------------------------- 저장소
    def db_put(self, store, obj):
        return self._db.put(store, obj)

    def db_put_many(self, store, objs):
        return self._db.put_many(store, objs or [])

    def db_get(self, store, key):
        return self._db.get(store, key)

    def db_get_all(self, store):
        return self._db.get_all(store)

    def db_query(self, store, field, value):
        return self._db.query(store, field, value)

    def db_delete(self, store, key):
        return self._db.delete(store, key)

    def delete_student_cascade(self, sid):
        return self._db.delete_student_cascade(sid)

    def delete_eval_plan_cascade(self, pid):
        return self._db.delete_eval_plan_cascade(pid)

    def db_delete_many(self, store, keys):
        return self._db.delete_many(store, keys or [])

    def clear_all(self):
        self._db.write_backup_file()  # 실수 대비: 지우기 직전 자동 백업
        return self._db.clear_all()

    def import_backup(self, text, password=None):
        data = self._db.decode_backup(text, password)  # 먼저 해독되는지 확인(실패 시 기존 데이터 유지)
        self._db.write_backup_file()
        return self._db.import_all(data)

    def backup_settings(self):
        return {"folder": str(self._db.data_dir / "backups"), "extraFolder": self._db.extra_backup_dir}

    def choose_backup_dir(self):
        """자동 백업을 한 곳 더(USB·NAS·클라우드 폴더 등) 저장할 위치 선택."""
        if not self._window:
            raise StoreError("데스크톱 모드에서만 사용할 수 있습니다.")
        import webview  # type: ignore

        dialog = getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG
        result = self._window.create_file_dialog(dialog)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        self._db.set_extra_backup_dir(path)
        self._db.write_backup_file()
        return path

    def clear_backup_dir(self):
        self._db.set_extra_backup_dir(None)
        return True

    # ------------------------------------------------------- 로그인·비밀번호
    def status(self):
        return self._db.status()

    def unlock(self, pw):
        ok = self._db.unlock(pw)
        backup = None
        if ok:
            try:
                backup = self._db.auto_backup_if_needed()
            except Exception as e:  # 백업 실패가 로그인을 막지 않도록
                backup = f"자동 백업 실패: {e}"
        return {"ok": ok, "status": self._db.status(), "backup": backup}

    def lock(self):
        self._db.lock()
        return True

    def verify_password(self, pw):
        return self._db.verify_password(pw)

    def change_password(self, current, new):
        return {"recoveryCode": self._db.change_password(current, new)}

    def new_recovery_code(self, current):
        return {"recoveryCode": self._db.new_recovery_code(current)}

    def recover(self, code, new):
        return {"recoveryCode": self._db.recover(code, new)}

    # ---------------------------------------------------------- 체험학습 출결
    def save_experiential(self, exp):
        """체험학습 저장 후 승인 상태에 맞춰 출결(출석인정)을 자동 반영."""
        if not exp.get("expId"):
            exp["expId"] = new_id("exp")
        self._db.put("experiential", exp)
        return {"expId": exp["expId"], **att.sync_experiential(self._db, exp["expId"])}

    def delete_experiential(self, exp_id):
        self._db.delete("experiential", exp_id)
        return att.sync_experiential(self._db, exp_id)

    def _resync_all_experiential(self):
        n = 0
        for e in self._db.get_all("experiential"):
            if e.get("status") == "approved":
                att.sync_experiential(self._db, e["expId"])
                n += 1
        return n

    # ---------------------------------------------------------- 엑셀 가져오기
    def parse_excel(self, b64, filename=""):
        return read_rows_b64(b64, filename)

    def import_students(self, b64, filename=""):
        return self.import_students_rows(read_rows_b64(b64, filename), True)

    def import_students_rows(self, rows, has_header=True):
        rows = [r for r in (rows or []) if r and any(str(v).strip() for v in r)]
        if has_header:
            if not rows:
                raise StoreError("엑셀 내용이 비어 있습니다.")
            header, rows = rows[0], rows[1:]
            i_no = _header_index(header, ["번호", "No", "학번"])
            i_nm = _header_index(header, ["이름", "성명", "Name"])
            i_g = _header_index(header, ["성별", "성"])
            i_p = _header_index(header, ["전화번호", "보호자연락처", "연락처", "휴대폰"])
            i_n = _header_index(header, ["비고", "메모", "특이사항"])
            if i_no < 0 or i_nm < 0:
                raise StoreError("1행 제목에 '번호'와 '이름' 칸이 필요합니다.")
        else:
            i_no, i_nm, i_g, i_p, i_n = 0, 1, 2, 3, 4
        existing = {int(s["number"]): s for s in self._db.get_all("students") if str(s.get("number", "")).strip().lstrip("-").isdigit()}
        added = updated = skipped = 0
        out = []
        for r in rows:
            cell = lambda i: str(r[i]).strip() if 0 <= i < len(r) and r[i] is not None else ""
            try:
                no = int(float(cell(i_no)))
            except ValueError:
                skipped += 1
                continue
            name = cell(i_nm)
            if not name:
                skipped += 1
                continue
            gender = cell(i_g) or "남"
            gender = "여" if gender.startswith("여") or gender.upper() == "F" else "남"
            rec = existing.get(no)
            if rec:
                rec.update({"name": name, "gender": gender})
                if cell(i_p):
                    rec["guardianPhone"] = cell(i_p)
                if cell(i_n):
                    rec["note"] = cell(i_n)
                updated += 1
            else:
                rec = {"studentId": new_id("std"), "number": no, "name": name, "gender": gender,
                       "guardianPhone": cell(i_p), "note": cell(i_n)}
                existing[no] = rec
                added += 1
            out.append(rec)
        self._db.put_many("students", out)
        return {"added": added, "updated": updated, "skipped": skipped}

    def import_school_events(self, b64, filename=""):
        return self.import_school_events_rows(read_rows_b64(b64, filename), True)

    def import_school_events_rows(self, rows, has_header=True):
        rows = [r for r in (rows or []) if r and any(str(v).strip() for v in r)]
        if has_header:
            if not rows:
                raise StoreError("엑셀 내용이 비어 있습니다.")
            header, rows = rows[0], rows[1:]
            i_d = _header_index(header, ["날짜", "시작일", "일자", "일정일", "기간"])
            i_t = _header_index(header, ["행사명", "행사", "내용", "일정"])
            i_h = _header_index(header, ["휴업", "휴업여부", "휴업일", "휴업(O)"])
            if i_d < 0 or i_t < 0:
                raise StoreError("1행 제목을 [날짜, 행사명, 휴업] 형태로 맞춰 주세요.")
        else:
            i_d, i_t, i_h = 0, 1, 2
        have = {(e.get("startDate"), e.get("endDate"), e.get("title")) for e in self._db.get_all("school_events")}
        out, bad, dup = [], [], 0
        for r in rows:
            cell = lambda i: r[i] if 0 <= i < len(r) else ""
            raw, title = cell(i_d), str(cell(i_t) or "").strip()
            if not raw or not title:
                continue
            if isinstance(raw, str) and "~" in raw:
                a, b = raw.split("~", 1)
                s, e = normalize_date(a), normalize_date(b)
            else:
                s = e = normalize_date(raw)
            if not s:
                bad.append(str(raw))
                continue
            e = e or s
            if e < s:
                s, e = e, s
            if (s, e, title) in have:
                dup += 1
                continue
            have.add((s, e, title))
            out.append({"eventId": new_id("evt"), "startDate": s, "endDate": e, "title": title,
                        "isHoliday": _is_holiday_flag(cell(i_h))})
        self._db.put_many("school_events", out)
        return {"added": len(out), "duplicates": dup, "badDates": bad[:10]}

    def import_subject_plan(self, b64, filename, subject_short):
        rows = read_rows_b64(b64, filename)
        if len(rows) < 2:
            raise StoreError("엑셀 내용이 비어 있습니다.")
        days: dict[str, dict] = {}
        applied, missing, bad = 0, [], []
        for r in rows[1:]:
            cell = lambda i: r[i] if i < len(r) else ""
            d = normalize_date(cell(0))
            try:
                period = int(float(str(cell(1)).strip()))
            except ValueError:
                if cell(0) or cell(1):
                    bad.append(f"{cell(0)} {cell(1)}")
                continue
            if not d:
                bad.append(str(cell(0)))
                continue
            unit, objective, content = (str(cell(i) or "").strip() for i in (2, 3, 4))
            day = days.get(d) or self._db.get("annual_schedule", d)
            target = None
            if day:
                target = next((s for s in day.get("subjects") or [] if s.get("period") == period and s.get("name") == subject_short), None)
            if not target:
                missing.append(f"{d} {period}교시")
                continue
            target.update({"unit": unit, "objective": objective, "content": content or unit or objective})
            target.setdefault("crossTags", [])
            target.setdefault("crossNote", "")
            days[d] = day
            applied += 1
        self._db.put_many("annual_schedule", list(days.values()))
        return {"applied": applied, "missing": missing[:15], "missingCount": len(missing), "bad": bad[:10]}

    # --------------------------------------------------------- 연간 시간표
    def generate_annual(self, keep_content=True):
        st = self._db.get("settings", "global") or {}
        if not st.get("term1Start") or not st.get("term1End"):
            raise StoreError("[기본설정]에서 1학기 기간을 먼저 저장해 주세요.")
        grid = (self._db.get("timetable_weekly", "weekly") or {}).get("grid")
        if not grid:
            raise StoreError("[교육과정운영] 주간 기초 시간표를 먼저 저장해 주세요.")
        events = [e for e in self._db.get_all("school_events") if e.get("isHoliday")]

        def holiday(d: str) -> bool:
            return any(e.get("startDate", "") <= d <= (e.get("endDate") or e.get("startDate", "")) for e in events)

        ranges = [(st["term1Start"], st["term1End"])]
        if st.get("term2Start") and st.get("term2End"):
            ranges.append((st["term2Start"], st["term2End"]))
        put, delete_keys, holidays, kept = [], [], 0, 0
        for a, b in ranges:
            cur, end = date.fromisoformat(a), date.fromisoformat(b)
            if end < cur:
                raise StoreError(f"학기 기간이 올바르지 않습니다: {a} ~ {b}")
            while cur <= end:
                ds = cur.isoformat()
                if holiday(ds):
                    delete_keys.append(ds)
                    holidays += 1
                elif cur.weekday() < 5:
                    key = DAY_KEYS[cur.weekday()]
                    subs = []
                    for p in range(1, 9):
                        cell = grid.get(f"{key}-{p}")
                        if cell and cell.get("name"):
                            subs.append({"period": p, "name": cell["name"], "unit": "", "objective": "",
                                         "content": "", "crossTags": [], "crossNote": ""})
                    if keep_content and subs:
                        old = self._db.get("annual_schedule", ds)
                        if old:
                            for s in subs:
                                prev = next((o for o in old.get("subjects") or [] if o.get("period") == s["period"] and o.get("name") == s["name"]), None)
                                if prev:
                                    for f in KEEP_FIELDS:
                                        if f in prev:
                                            s[f] = prev[f]
                                    if prev.get("content") or prev.get("unit"):
                                        kept += 1
                    if subs:
                        put.append({"date": ds, "subjects": subs})
                    else:
                        delete_keys.append(ds)
                cur += timedelta(days=1)
        self._db.put_many("annual_schedule", put)
        self._db.delete_many("annual_schedule", delete_keys)
        self._resync_all_experiential()  # 수업일이 바뀌었을 수 있으므로 출석인정 다시 맞춤
        return {"days": len(put), "holidays": holidays, "keptContent": kept}

    # ------------------------------------------------------ 지도계획 라이브러리
    def curriculum_list(self, grade=None):
        return self._lib.list(grade)

    def curriculum_choices(self):
        return self._lib.get_choices()

    def curriculum_preview(self, pack_id, subject_short):
        return self._lib.preview(pack_id, subject_short)

    def curriculum_apply(self, pack_id, subject_short, overwrite=True):
        return self._lib.apply(pack_id, subject_short, bool(overwrite))

    def curriculum_import(self, b64, filename=""):
        if filename.lower().endswith(".json"):
            raw = base64.b64decode(b64.split(",", 1)[1] if "," in b64[:100] else b64).decode("utf-8-sig")
            return self._lib.import_json(raw)
        return self._lib.import_rows(read_rows_b64(b64, filename))

    def curriculum_delete(self, pack_id):
        return self._lib.delete(pack_id)

    # ----------------------------------------------------------- 파일 출력
    def build_file(self, kind, params=None):
        params = params or {}
        ts = reports.stamp()
        if kind == "backup":
            data = self._db.export_encrypted()
            return {"filename": f"아이로그_백업_{date.today().isoformat()}.json", "b64": _b64(data), "mime": "application/json"}
        if kind == "neis_attendance_xlsx":
            data = reports.neis_attendance_xlsx(self._db)
            return {"filename": f"출결통계_나이스기준_{ts}.xlsx", "b64": _b64(data), "mime": XLSX_MIME}
        if kind == "subject_plan_xlsx":
            data = reports.subject_plan_xlsx(self._db, params.get("subjects"))
            return {"filename": f"과목별_지도계획_{ts}.xlsx", "b64": _b64(data), "mime": XLSX_MIME}
        if kind == "class_book_xlsx":
            data = class_book_assessment.class_book_xlsx(self._db, bool(params.get("incidents")))
            return {"filename": f"학급경영록_{ts}.xlsx", "b64": _b64(data), "mime": XLSX_MIME}
        if kind == "assessment_plan_hwpx":
            name, data = assessment_reports.assessment_plan_hwpx(self._db, params["planId"])
            return {"filename": _safe_filename(name), "b64": _b64(data), "mime": HWPX_MIME}
        if kind == "assessment_plans_hwpx":
            term = params.get("term")
            term = int(term) if str(term or "") in ("1", "2") else None
            name, data = assessment_reports.assessment_plans_hwpx(self._db, term)
            return {"filename": _safe_filename(name), "b64": _b64(data), "mime": HWPX_MIME}
        if kind == "eval_xlsx":
            name, data = reports.eval_xlsx(self._db, params["planId"])
            return {"filename": _safe_filename(name), "b64": _b64(data), "mime": XLSX_MIME}
        if kind == "form_hwpx":
            fk = params.get("kind")
            report = None
            if params.get("useTemplate") and fk in forms.SINGLE_FORMS and self._db.get_form_template(fk):
                data, report = forms.fill_school_template(self._db, fk, params)
                name = f"{forms.SINGLE_FORMS[fk]}_{self._form_suffix(fk, params)}.hwpx"
            else:
                form = forms.build(self._db, fk, params)
                data, name = form.to_hwpx(), f"{form.name}.hwpx"
            return {"filename": _safe_filename(name), "b64": _b64(data), "mime": HWPX_MIME, "report": report}
        if kind.startswith("template_"):
            name, data = make_template(kind[len("template_"):])
            return {"filename": name, "b64": _b64(data), "mime": XLSX_MIME}
        raise StoreError(f"알 수 없는 출력 종류: {kind}")

    def build_html(self, kind, params=None):
        params = params or {}
        if kind == "subject_plan":
            return {"filename": "과목별_지도계획.html", "html": reports.subject_plan_html(self._db, params.get("subjects"))}
        if kind == "class_book":
            return {"filename": "학급경영록.html", "html": class_book_assessment.class_book_html(self._db, bool(params.get("incidents")))}
        if kind == "form":
            form = forms.build(self._db, params.get("kind"), params)
            return {"filename": f"{form.name}.html", "html": form.to_html()}
        if kind == "student_report":
            return {"filename": "학생_종합기록.html", "html": reports.student_report_html(self._db, params["studentId"])}
        raise StoreError(f"알 수 없는 출력 종류: {kind}")

    # ------------------------------------------------ 데스크톱 전용 (pywebview)
    def save_file(self, filename, b64, open_after=True):
        """저장 위치를 물어보고 저장한다. 취소하면 None."""
        if not self._window:
            raise StoreError("데스크톱 모드에서만 사용할 수 있습니다.")
        import webview  # type: ignore

        dialog = getattr(getattr(webview, "FileDialog", None), "SAVE", None) or webview.SAVE_DIALOG
        start = str(Path.home() / "Documents") if (Path.home() / "Documents").is_dir() else str(Path.home())
        result = self._window.create_file_dialog(dialog, directory=start, save_filename=_safe_filename(filename))
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        Path(path).write_bytes(base64.b64decode(b64))
        if open_after:
            self._open_path(path)
        return path

    def open_html(self, filename, html):
        folder = self._db.data_dir / "reports"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{Path(_safe_filename(filename)).stem}_{reports.stamp()}.html"
        path.write_text(html, encoding="utf-8")
        webbrowser.open(path.as_uri())
        return str(path)

    def open_folder(self, which="data"):
        path = self._db.data_dir / ("backups" if which == "backups" else "")
        path.mkdir(parents=True, exist_ok=True)
        self._open_path(str(path))
        return str(path)

    @staticmethod
    def _open_path(path: str):
        try:
            if os.name == "nt":
                os.startfile(path)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                os.system(f'open "{path}"')
            else:
                webbrowser.open(Path(path).as_uri())
        except Exception:
            pass

    # ------------------------------------------------------------ 학교 서식
    def _form_suffix(self, kind, params):
        try:
            if kind.startswith("exp_"):
                return (self._db.get("experiential", params["expId"]) or {}).get("studentName", "")
            if kind == "absence":
                return f"{(self._db.get('students', params['studentId']) or {}).get('name', '')}_{params.get('date', '')}"
        except Exception:
            pass
        return reports.stamp()

    def form_templates(self):
        return {"templates": self._db.list_form_templates(), "kinds": forms.SINGLE_FORMS, "guide": forms.PLACEHOLDER_GUIDE}

    def form_template_upload(self, kind, b64, filename):
        if kind not in forms.SINGLE_FORMS:
            raise StoreError("학교 양식을 등록할 수 없는 서식입니다.")
        data = base64.b64decode(b64.split(",", 1)[1] if "," in b64[:100] else b64)
        info = inspect_template(data, filename)  # 열리는지 먼저 확인
        self._db.save_form_template(kind, filename, data)
        return info

    def form_template_delete(self, kind):
        return self._db.delete_form_template(kind)

    def absence_dates(self, student_id):
        """결석·지각·조퇴·결과가 있는 날짜 목록 (신고서 작성용)."""
        by_date = {}
        for r in self._db.query("attendance", "studentId", student_id):
            if r.get("status") == "출석":
                continue
            by_date.setdefault(r.get("date"), []).append(r)
        out = []
        for d in sorted(by_date, reverse=True):
            st = att.day_status(by_date[d])
            label = ("출석인정" if st["recognized"] else f"결석({st['absent']})") if (st["absent"] or st["recognized"]) else \
                ", ".join(f"{k}({st[k]})" for k in ("지각", "조퇴", "결과") if st[k])
            out.append({"date": d, "label": label})
        return out

    def weekly_get(self, any_date):
        mon = forms.week_monday(any_date).isoformat()
        notes = self._db.get("weekly_notes", mon) or {"weekStart": mon, "morning": {}, "prep": {}, "general": ""}
        return {"weekStart": mon, "notes": notes}

    def weekly_save(self, notes):
        notes["weekStart"] = forms.week_monday(notes["weekStart"]).isoformat()
        self._db.put("weekly_notes", notes)
        return True

    def report_card_list(self, term):
        term = int(term or 1)
        rd = reports.ReportData(self._db)
        s0, e0 = forms.term_range(rd, term)
        cards = {c.get("studentId"): c for c in self._db.get_all("report_cards") if int(c.get("term") or 0) == term}
        plans = [p for p in rd.eval_plans if s0 <= (p.get("date") or "") <= e0]
        counts = {c["studentId"]: c for c in rd.attendance_counts(s0, e0)}
        out = []
        for s in rd.students:
            scored = sum(1 for p in plans if rd.score_of(p.get("planId"), s["studentId"]).get("score"))
            logs = [c for c in rd.counseling if c.get("studentId") == s["studentId"] and s0 <= (c.get("date") or "") <= e0
                    and "누가기록" in (c.get("type") or "")]
            out.append({"studentId": s["studentId"], "number": s.get("number"), "name": s.get("name"),
                        "comment": (cards.get(s["studentId"]) or {}).get("comment", ""),
                        "evals": f"{scored}/{len(plans)}", "absent": counts.get(s["studentId"], {}).get("결석", 0),
                        "notes": [f"[{c.get('date')}] {c.get('content')}" for c in logs][:20]})
        return {"term": term, "range": [s0, e0], "students": out}

    def report_card_save(self, term, items):
        term = int(term or 1)
        recs = [{"cardId": f"{term}_{i['studentId']}", "studentId": i["studentId"], "term": term, "comment": i.get("comment", "")}
                for i in items or []]
        self._db.put_many("report_cards", recs)
        return len(recs)
