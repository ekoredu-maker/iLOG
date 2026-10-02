"""아이로그(iLOG) 데이터 저장소 - SQLite + 레코드 단위 암호화.

- 저장소 이름/기본키 구조는 기존 IndexedDB(v9.x)와 같다 → 화면 코드·백업 파일 호환.
- 모든 레코드 내용은 AES-256-GCM 으로 암호화해서 저장한다.
  · 데이터 키(DEK)는 무작위로 만들고, 로그인 비밀번호와 복구 코드로 각각 감싸 둔다.
  · 비밀번호를 바꿔도 데이터 전체를 다시 암호화할 필요가 없다(키만 다시 감쌈).
  · 조회용 색인(studentId, date, planId)만 평문으로 둔다(이름·내용 등은 암호문).
- 백업 파일도 같은 방식으로 암호화된다.
Copyright 2026@박주가리교감
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import uuid
from datetime import date, datetime
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SCHEMA_VERSION = 2

KEY_PATHS: dict[str, str] = {
    "settings": "id",
    "students": "studentId",
    "attendance": "attendanceId",
    "subjects": "subjectId",
    "timetable_weekly": "id",
    "tasks": "taskId",
    "counseling": "logId",
    "experiential": "expId",
    "eval_plans": "planId",
    "eval_scores": "scoreId",
    "school_events": "eventId",
    "annual_schedule": "date",
    "incidents": "incidentId",
    "custom_links": "linkId",
    "weekly_notes": "weekStart",
    "report_cards": "cardId",
}
STORE_NAMES = list(KEY_PATHS.keys())
INDEX_COLUMNS = {"studentId": "sid", "date": "dt", "planId": "pid"}
STUDENT_LINKED = ["attendance", "counseling", "eval_scores", "experiential", "incidents", "report_cards"]

DEFAULT_PASSWORD = "1234"
KDF_ITER = 200_000
BACKUP_FORMAT = "ilog-backup-enc/1"


def default_data_dir() -> Path:
    """버전과 무관하게 항상 같은 위치(업데이트해도 데이터 유지)."""
    env = os.environ.get("ILOG_DATA_DIR")
    if env:
        return Path(env)
    if os.name == "nt":
        return Path(os.environ.get("APPDATA") or str(Path.home())) / "iLOG"
    return Path.home() / ".ilog"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


class StoreError(Exception):
    pass


class LockedError(StoreError):
    def __init__(self):
        super().__init__("잠겨 있습니다. 다시 로그인해 주세요.")


class NeedPasswordError(StoreError):
    def __init__(self):
        super().__init__("이 백업 파일은 암호화되어 있습니다. 백업 당시 비밀번호(또는 복구 코드)를 입력해 주세요.")


# ------------------------------------------------------------------ 암호 도구
def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _b64d(s: str) -> bytes:
    return base64.b64decode(s)


def _kek(secret: str, salt: bytes, iterations: int = KDF_ITER) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, iterations, dklen=32)


def _wrap(secret: str, dek: bytes) -> dict:
    salt, nonce = os.urandom(16), os.urandom(12)
    blob = AESGCM(_kek(secret, salt)).encrypt(nonce, dek, b"ilog-dek")
    return {"salt": _b64e(salt), "blob": _b64e(nonce + blob)}


def _unwrap(secret: str, wrapped: dict | None, iterations: int = KDF_ITER) -> bytes | None:
    if not wrapped:
        return None
    try:
        raw = _b64d(wrapped["blob"])
        return AESGCM(_kek(secret, _b64d(wrapped["salt"]), iterations)).decrypt(raw[:12], raw[12:], b"ilog-dek")
    except (InvalidTag, KeyError, ValueError):
        return None


def normalize_recovery(code: str) -> str:
    return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


def make_recovery_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 제외
    raw = "".join(secrets.choice(alphabet) for _ in range(20))
    return "-".join(raw[i:i + 5] for i in range(0, 20, 5))


class Database:
    def __init__(self, data_dir: Path | str | None = None, filename: str = "ilog.db"):
        self.data_dir = Path(data_dir) if data_dir else default_data_dir()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / filename
        self._lock = threading.RLock()
        self._dek: bytes | None = None
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

    # ------------------------------------------------------------------ 스키마
    def _init_schema(self) -> None:
        with self._lock, self.conn:
            cols = [r[1] for r in self.conn.execute("PRAGMA table_info(records)").fetchall()]
            if cols and "sid" not in cols:  # v10 초기(평문) 형식 → 잠금 해제 시 암호화 이전
                self.conn.execute("ALTER TABLE records RENAME TO records_plain_v1")
                for f in ("studentId", "date", "planId"):
                    self.conn.execute(f"DROP INDEX IF EXISTS idx_records_{f}")
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS records ("
                " store TEXT NOT NULL, key TEXT NOT NULL, sid TEXT, dt TEXT, pid TEXT,"
                " data BLOB NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store, key))"
            )
            for col in INDEX_COLUMNS.values():
                self.conn.execute(f"CREATE INDEX IF NOT EXISTS idx_rec_{col} ON records(store, {col})")
            self.conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS curriculum_packs ("
                " pack_id TEXT PRIMARY KEY, data TEXT NOT NULL, imported_at TEXT NOT NULL)"
            )
            self.conn.execute(  # 학교 양식(빈 서식 파일) - 학생 정보가 없으므로 암호화하지 않음
                "CREATE TABLE IF NOT EXISTS form_templates ("
                " kind TEXT PRIMARY KEY, filename TEXT NOT NULL, data BLOB NOT NULL, uploaded_at TEXT NOT NULL)"
            )
            self.conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))

    def close(self) -> None:
        with self._lock:
            self._dek = None
            self.conn.close()

    def _meta_get(self, key: str):
        row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def _meta_set(self, key: str, value) -> None:
        with self.conn:
            self.conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)", (key, value))

    # ------------------------------------------------------------- 키 관리
    def _keyring(self) -> dict | None:
        raw = self._meta_get("keyring")
        return json.loads(raw) if raw else None

    def _save_keyring(self, kr: dict) -> None:
        self._meta_set("keyring", json.dumps(kr))

    def status(self) -> dict:
        with self._lock:
            kr = self._keyring()
            return {
                "locked": self._dek is None,
                "initialized": kr is not None,
                "mustChangePassword": bool(kr.get("mustChange")) if kr else True,
                "hasRecovery": bool(kr and kr.get("rc")),
            }

    @property
    def locked(self) -> bool:
        return self._dek is None

    def unlock(self, password: str) -> bool:
        password = str(password or "").strip()
        with self._lock:
            kr = self._keyring()
            if kr is None:  # 첫 실행: 초기 비밀번호로 새 키 생성
                if password != DEFAULT_PASSWORD:
                    return False
                dek = AESGCM.generate_key(bit_length=256)
                self._save_keyring({"v": 1, "iter": KDF_ITER, "pw": _wrap(password, dek), "rc": None, "mustChange": True})
            else:
                dek = _unwrap(password, kr.get("pw"), kr.get("iter", KDF_ITER))
                if dek is None:
                    return False
            self._dek = dek
            self._migrate_plain()
            return True

    def lock(self) -> None:
        with self._lock:
            self._dek = None

    def verify_password(self, password: str) -> bool:
        kr = self._keyring()
        if kr is None:
            return str(password or "").strip() == DEFAULT_PASSWORD
        return _unwrap(str(password or "").strip(), kr.get("pw"), kr.get("iter", KDF_ITER)) is not None

    def change_password(self, current: str, new: str) -> str | None:
        """비밀번호 변경. 복구 코드가 아직 없으면 새로 만들어 반환한다."""
        new = str(new or "").strip()
        if len(new) < 4:
            raise StoreError("비밀번호는 4자리 이상이어야 합니다.")
        if new == DEFAULT_PASSWORD:
            raise StoreError("초기 비밀번호(1234)는 쓸 수 없습니다.")
        with self._lock:
            self._require()
            if not self.verify_password(current):
                raise StoreError("현재 비밀번호가 일치하지 않습니다.")
            kr = self._keyring()
            kr["pw"] = _wrap(new, self._dek)
            kr["mustChange"] = False
            code = None
            if not kr.get("rc"):
                code = make_recovery_code()
                kr["rc"] = _wrap(normalize_recovery(code), self._dek)
            self._save_keyring(kr)
            return code

    def new_recovery_code(self, current: str) -> str:
        with self._lock:
            self._require()
            if not self.verify_password(current):
                raise StoreError("현재 비밀번호가 일치하지 않습니다.")
            kr = self._keyring()
            code = make_recovery_code()
            kr["rc"] = _wrap(normalize_recovery(code), self._dek)
            self._save_keyring(kr)
            return code

    def recover(self, code: str, new_password: str) -> str:
        """복구 코드로 잠금을 풀고 새 비밀번호를 정한다. 새 복구 코드를 반환."""
        new_password = str(new_password or "").strip()
        if len(new_password) < 4 or new_password == DEFAULT_PASSWORD:
            raise StoreError("새 비밀번호는 4자리 이상이며 1234가 아니어야 합니다.")
        with self._lock:
            kr = self._keyring()
            dek = _unwrap(normalize_recovery(code), (kr or {}).get("rc"), (kr or {}).get("iter", KDF_ITER))
            if dek is None:
                raise StoreError("복구 코드가 맞지 않습니다.")
            new_code = make_recovery_code()
            kr["pw"] = _wrap(new_password, dek)
            kr["rc"] = _wrap(normalize_recovery(new_code), dek)
            kr["mustChange"] = False
            self._save_keyring(kr)
            self._dek = dek
            self._migrate_plain()
            return new_code

    def _require(self) -> None:
        if self._dek is None:
            raise LockedError()

    def _enc(self, store: str, obj: dict) -> bytes:
        nonce = os.urandom(12)
        return nonce + AESGCM(self._dek).encrypt(nonce, json.dumps(obj, ensure_ascii=False).encode("utf-8"), store.encode())

    def _dec(self, store: str, blob: bytes) -> dict:
        try:
            return json.loads(AESGCM(self._dek).decrypt(blob[:12], blob[12:], store.encode()))
        except InvalidTag as e:
            raise StoreError("데이터를 해독할 수 없습니다(파일 손상 또는 다른 키).") from e

    def _migrate_plain(self) -> None:
        """예전 평문 테이블이 있으면 암호화해서 옮긴다."""
        exists = self.conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='records_plain_v1'").fetchone()
        if not exists:
            return
        rows = self.conn.execute("SELECT store, data FROM records_plain_v1").fetchall()
        by_store: dict[str, list] = {}
        for store, data in rows:
            obj = json.loads(data)
            if store == "settings" and obj.get("id") == "security":
                continue
            if store in KEY_PATHS:
                by_store.setdefault(store, []).append(obj)
        for store, objs in by_store.items():
            self.put_many(store, objs)
        with self.conn:
            self.conn.execute("DROP TABLE records_plain_v1")

    # ------------------------------------------------------------- 기본 연산
    @staticmethod
    def _check_store(store: str) -> str:
        if store not in KEY_PATHS:
            raise StoreError(f"알 수 없는 저장소: {store}")
        return KEY_PATHS[store]

    def _key_of(self, store: str, obj: dict) -> str:
        kp = self._check_store(store)
        if not isinstance(obj, dict):
            raise StoreError("저장할 데이터 형식이 올바르지 않습니다.")
        key = obj.get(kp)
        if key in (None, ""):
            raise StoreError(f"{store} 저장 실패: '{kp}' 값이 없습니다.")
        return str(key)

    def _row(self, store: str, obj: dict, now: str) -> tuple:
        def ix(f):
            v = obj.get(f)
            return None if v in (None, "") else str(v)
        return (store, self._key_of(store, obj), ix("studentId"), ix("date"), ix("planId"), self._enc(store, obj), now)

    def put(self, store: str, obj: dict) -> bool:
        self.put_many(store, [obj])
        return True

    def put_many(self, store: str, objs: list[dict]) -> int:
        self._check_store(store)
        now = datetime.now().isoformat(timespec="seconds")
        with self._lock:
            self._require()
            rows = [self._row(store, o, now) for o in objs]
            with self.conn:
                self.conn.executemany(
                    "INSERT OR REPLACE INTO records(store,key,sid,dt,pid,data,updated_at) VALUES (?,?,?,?,?,?,?)", rows
                )
        return len(rows)

    def get(self, store: str, key) -> dict | None:
        self._check_store(store)
        with self._lock:
            self._require()
            row = self.conn.execute("SELECT data FROM records WHERE store=? AND key=?", (store, str(key))).fetchone()
            return self._dec(store, row[0]) if row else None

    def get_all(self, store: str) -> list[dict]:
        self._check_store(store)
        with self._lock:
            self._require()
            rows = self.conn.execute("SELECT data FROM records WHERE store=? ORDER BY rowid", (store,)).fetchall()
            return [self._dec(store, r[0]) for r in rows]

    def query(self, store: str, field: str, value) -> list[dict]:
        self._check_store(store)
        col = INDEX_COLUMNS.get(field)
        if not col:  # 색인이 없는 필드는 해독 후 걸러낸다
            return [o for o in self.get_all(store) if o.get(field) == value]
        with self._lock:
            self._require()
            rows = self.conn.execute(
                f"SELECT data FROM records WHERE store=? AND {col}=? ORDER BY rowid", (store, None if value is None else str(value))
            ).fetchall()
            return [self._dec(store, r[0]) for r in rows]

    def delete(self, store: str, key) -> bool:
        self._check_store(store)
        with self._lock:
            self._require()
            with self.conn:
                self.conn.execute("DELETE FROM records WHERE store=? AND key=?", (store, str(key)))
        return True

    def delete_many(self, store: str, keys: list) -> int:
        self._check_store(store)
        with self._lock:
            self._require()
            with self.conn:
                self.conn.executemany("DELETE FROM records WHERE store=? AND key=?", [(store, str(k)) for k in keys])
        return len(keys)

    def delete_student_cascade(self, student_id: str) -> bool:
        with self._lock:
            self._require()
            with self.conn:
                self.conn.execute("DELETE FROM records WHERE store='students' AND key=?", (student_id,))
                for s in STUDENT_LINKED:
                    self.conn.execute("DELETE FROM records WHERE store=? AND sid=?", (s, student_id))
        return True

    def delete_eval_plan_cascade(self, plan_id: str) -> bool:
        with self._lock:
            self._require()
            with self.conn:
                self.conn.execute("DELETE FROM records WHERE store='eval_plans' AND key=?", (plan_id,))
                self.conn.execute("DELETE FROM records WHERE store='eval_scores' AND pid=?", (plan_id,))
        return True

    # ------------------------------------------------------------- 백업/복구
    def export_all(self) -> dict:
        data = {name: self.get_all(name) for name in STORE_NAMES}
        data["_meta"] = {"app": "iLOG", "format": "ilog-backup/2", "exportedAt": datetime.now().isoformat(timespec="seconds")}
        data["_curriculum_packs"] = self.list_user_packs()
        data["_form_templates"] = [{"kind": t["kind"], "filename": t["filename"], "b64": _b64e(self.get_form_template(t["kind"])["data"])}
                                   for t in self.list_form_templates()]
        return data

    def export_encrypted(self) -> bytes:
        """암호화 백업: 데이터 키로 암호화하고, 감싼 키(비밀번호/복구 코드용)를 함께 넣는다."""
        with self._lock:
            self._require()
            plain = json.dumps(self.export_all(), ensure_ascii=False).encode("utf-8")
            nonce = os.urandom(12)
            kr = self._keyring()
            env = {
                "format": BACKUP_FORMAT, "app": "iLOG", "exportedAt": datetime.now().isoformat(timespec="seconds"),
                "keyring": {"iter": kr.get("iter", KDF_ITER), "pw": kr.get("pw"), "rc": kr.get("rc")},
                "payload": _b64e(nonce + AESGCM(self._dek).encrypt(nonce, plain, b"ilog-backup")),
            }
            return json.dumps(env).encode("utf-8")

    def decode_backup(self, payload, password: str | None = None) -> dict:
        """백업 파일 내용을 평문 dict 로. 암호화 백업이면 현재 키 → 입력한 비밀번호/복구 코드 순으로 시도."""
        if isinstance(payload, (bytes, bytearray)):
            payload = payload.decode("utf-8-sig")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError as e:
                raise StoreError("백업 파일(JSON)을 읽을 수 없습니다. 파일이 손상되었거나 다른 형식입니다.") from e
        if not isinstance(payload, dict):
            raise StoreError("아이로그 백업 파일이 아닙니다.")
        if payload.get("format") != BACKUP_FORMAT:
            return payload  # 평문 백업(v9.x 등)
        raw = _b64d(payload["payload"])
        keys = []
        if self._dek:
            keys.append(self._dek)
        kr = payload.get("keyring") or {}
        if password:
            it = kr.get("iter", KDF_ITER)
            for k in (_unwrap(str(password).strip(), kr.get("pw"), it), _unwrap(normalize_recovery(password), kr.get("rc"), it)):
                if k:
                    keys.append(k)
        for k in keys:
            try:
                return json.loads(AESGCM(k).decrypt(raw[:12], raw[12:], b"ilog-backup"))
            except InvalidTag:
                continue
        if password:
            raise StoreError("비밀번호(또는 복구 코드)가 백업 파일과 맞지 않습니다.")
        raise NeedPasswordError()

    def import_all(self, payload, password: str | None = None) -> dict:
        """기존 v9.x(IndexedDB) 평문 백업과 v10 암호화 백업 모두 지원.

        백업 안의 비밀번호는 가져오지 않는다(지금 로그인한 비밀번호 유지)."""
        self._require()
        data = self.decode_backup(payload, password)
        if not any(k in data for k in STORE_NAMES):
            raise StoreError("아이로그 백업 파일이 아닙니다.")
        counts: dict[str, int] = {}
        now = datetime.now().isoformat(timespec="seconds")
        with self._lock:
            rows_by_store = {}
            for name in STORE_NAMES:
                items = data.get(name)
                if not isinstance(items, list):
                    continue
                rows = []
                for item in items:
                    if not isinstance(item, dict) or (name == "settings" and item.get("id") == "security"):
                        continue
                    try:
                        rows.append(self._row(name, item, now))
                    except StoreError:
                        continue
                rows_by_store[name] = rows
            with self.conn:
                for name, rows in rows_by_store.items():
                    self.conn.execute("DELETE FROM records WHERE store=?", (name,))
                    self.conn.executemany(
                        "INSERT OR REPLACE INTO records(store,key,sid,dt,pid,data,updated_at) VALUES (?,?,?,?,?,?,?)", rows
                    )
                    counts[name] = len(rows)
                for t in data.get("_form_templates") or []:
                    if isinstance(t, dict) and t.get("kind") and t.get("b64"):
                        self.conn.execute(
                            "INSERT OR REPLACE INTO form_templates(kind,filename,data,uploaded_at) VALUES (?,?,?,?)",
                            (t["kind"], t.get("filename") or "양식.hwpx", _b64d(t["b64"]), now),
                        )
                for pack in data.get("_curriculum_packs") or []:
                    if isinstance(pack, dict) and pack.get("packId"):
                        self.conn.execute(
                            "INSERT OR REPLACE INTO curriculum_packs(pack_id,data,imported_at) VALUES (?,?,?)",
                            (pack["packId"], json.dumps(pack, ensure_ascii=False), now),
                        )
        return counts

    def clear_all(self) -> bool:
        with self._lock:
            self._require()
            with self.conn:
                self.conn.execute("DELETE FROM records")
        return True

    # 자동 백업 ------------------------------------------------------------
    @property
    def extra_backup_dir(self) -> str | None:
        return self._meta_get("extra_backup_dir")

    def set_extra_backup_dir(self, path: str | None) -> None:
        with self._lock:
            if path:
                self._meta_set("extra_backup_dir", str(path))
            else:
                with self.conn:
                    self.conn.execute("DELETE FROM meta WHERE key='extra_backup_dir'")

    def write_backup_file(self, folder: Path | None = None, keep: int = 30) -> Path:
        folder = folder or (self.data_dir / "backups")
        data = self.export_encrypted()
        written = None
        targets = [folder]
        if self.extra_backup_dir:
            targets.append(Path(self.extra_backup_dir))
        for i, f in enumerate(targets):
            try:
                f.mkdir(parents=True, exist_ok=True)
                path = f / f"ilog_auto_{date.today().isoformat()}.json"
                path.write_bytes(data)
                for old in sorted(f.glob("ilog_auto_*.json"))[:-keep]:
                    old.unlink(missing_ok=True)
                written = written or path
            except (OSError, ValueError):
                if i == 0:
                    raise  # 기본 위치 실패는 알림, 추가 위치(USB 등) 실패는 무시
        return written

    def auto_backup_if_needed(self) -> str | None:
        """하루 한 번 자동 백업 (잠금 해제 상태이고 데이터가 있을 때만)."""
        if self.locked:
            return None
        today = date.today().isoformat()
        with self._lock:
            has_data = self.conn.execute("SELECT 1 FROM records LIMIT 1").fetchone()
            if not has_data or self._meta_get("last_auto_backup") == today:
                return None
        path = self.write_backup_file()
        self._meta_set("last_auto_backup", today)
        return str(path)

    # ------------------------------------------------------- 지도계획 데이터팩
    def save_user_pack(self, pack: dict) -> None:
        now = datetime.now().isoformat(timespec="seconds")
        with self._lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO curriculum_packs(pack_id,data,imported_at) VALUES (?,?,?)",
                (pack["packId"], json.dumps(pack, ensure_ascii=False), now),
            )

    def list_user_packs(self) -> list[dict]:
        with self._lock:
            rows = self.conn.execute("SELECT data FROM curriculum_packs ORDER BY pack_id").fetchall()
        return [json.loads(r[0]) for r in rows]

    def delete_user_pack(self, pack_id: str) -> bool:
        with self._lock, self.conn:
            self.conn.execute("DELETE FROM curriculum_packs WHERE pack_id=?", (pack_id,))
        return True

    # ------------------------------------------------------- 학교 양식 파일
    def save_form_template(self, kind: str, filename: str, data: bytes) -> None:
        with self._lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO form_templates(kind,filename,data,uploaded_at) VALUES (?,?,?,?)",
                (kind, filename, data, datetime.now().isoformat(timespec="seconds")),
            )

    def get_form_template(self, kind: str) -> dict | None:
        with self._lock:
            row = self.conn.execute("SELECT filename, data FROM form_templates WHERE kind=?", (kind,)).fetchone()
        return {"filename": row[0], "data": bytes(row[1])} if row else None

    def list_form_templates(self) -> list[dict]:
        with self._lock:
            rows = self.conn.execute("SELECT kind, filename, uploaded_at FROM form_templates ORDER BY kind").fetchall()
        return [{"kind": k, "filename": f, "uploadedAt": u} for k, f, u in rows]

    def delete_form_template(self, kind: str) -> bool:
        with self._lock, self.conn:
            self.conn.execute("DELETE FROM form_templates WHERE kind=?", (kind,))
        return True
