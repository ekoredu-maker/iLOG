import base64
import json
import sqlite3

import pytest

from backend.api import Api
from backend.db import Database, LockedError, NeedPasswordError, StoreError


def make(tmp_path, name="a"):
    return Api(Database(tmp_path / name))


def test_first_run_requires_default_then_change(tmp_path):
    api = make(tmp_path)
    assert api.status()["initialized"] is False
    assert api.unlock("0000")["ok"] is False
    r = api.unlock("1234")
    assert r["ok"] and r["status"]["mustChangePassword"]
    with pytest.raises(StoreError):
        api.change_password("1234", "1234")
    code = api.change_password("1234", "school#7")["recoveryCode"]
    assert code and len(code.replace("-", "")) == 20
    assert api.status()["mustChangePassword"] is False
    assert api.change_password("school#7", "next-pw")["recoveryCode"] is None  # 이미 있으면 새로 안 만듦


def test_locked_blocks_everything(tmp_path):
    api = make(tmp_path)
    with pytest.raises(LockedError):
        api.db_get_all("students")
    api.unlock("1234")
    api.db_put("students", {"studentId": "s", "number": 1, "name": "가"})
    api.lock()
    with pytest.raises(LockedError):
        api.db_get("students", "s")


def test_data_file_is_encrypted(tmp_path):
    api = make(tmp_path)
    api.unlock("1234")
    api.change_password("1234", "pw-5678")
    api.db_put("students", {"studentId": "s", "number": 1, "name": "비밀이름홍길동", "guardianPhone": "010-9999-8888"})
    api.db_put("incidents", {"incidentId": "i", "studentId": "s", "date": "2026-03-02", "content": "민감한사안내용"})
    api._db.conn.execute("PRAGMA wal_checkpoint(FULL)")
    raw = (tmp_path / "a" / "ilog.db").read_bytes()
    for secret in ("비밀이름홍길동", "010-9999-8888", "민감한사안내용"):
        assert secret.encode() not in raw
    # 다른 비밀번호로는 열 수 없음, 맞는 비밀번호로는 열림
    api._db.close()
    db2 = Database(tmp_path / "a")
    assert not db2.unlock("1234") and not db2.unlock("wrong")
    assert db2.unlock("pw-5678")
    assert db2.get("students", "s")["name"] == "비밀이름홍길동"


def test_recovery_code_resets_password_and_keeps_data(tmp_path):
    api = make(tmp_path)
    api.unlock("1234")
    code = api.change_password("1234", "forgotten")["recoveryCode"]
    api.db_put("students", {"studentId": "s", "number": 1, "name": "가"})
    api.lock()
    with pytest.raises(StoreError):
        api.recover("AAAAA-BBBBB-CCCCC-DDDDD", "newpass")
    new_code = api.recover(code.lower().replace("-", " "), "newpass")["recoveryCode"]
    assert new_code != code
    assert api.db_get("students", "s")["name"] == "가"
    api.lock()
    assert api.unlock("newpass")["ok"] and not api.verify_password("forgotten")
    with pytest.raises(StoreError):  # 예전 복구 코드는 더 이상 안 됨
        api.recover(code, "another")


def test_password_change_does_not_reencrypt_or_lose(tmp_path):
    api = make(tmp_path)
    api.unlock("1234")
    api.change_password("1234", "first")
    api.db_put_many("attendance", [{"attendanceId": f"x{i}", "date": "2026-03-02", "studentId": "s", "status": "출석"} for i in range(50)])
    api.change_password("first", "second")
    assert len(api.db_query("attendance", "studentId", "s")) == 50
    assert len(api.db_query("attendance", "status", "출석")) == 50  # 색인 없는 필드도 조회 가능


def test_encrypted_backup_restores_on_other_pc_with_password(tmp_path):
    a = make(tmp_path, "pc1")
    a.unlock("1234")
    code = a.change_password("1234", "pc1-pass")["recoveryCode"]
    a.db_put("students", {"studentId": "s", "number": 1, "name": "옮길학생"})
    backup = base64.b64decode(a.build_file("backup")["b64"]).decode()
    assert "옮길학생" not in backup

    b = make(tmp_path, "pc2")
    b.unlock("1234")
    b.change_password("1234", "pc2-pass")
    with pytest.raises(NeedPasswordError):
        b.import_backup(backup)
    with pytest.raises(StoreError, match="맞지 않습니다"):
        b.import_backup(backup, "wrong")
    assert b.db_get_all("students") == []  # 실패해도 기존 데이터 유지
    b.import_backup(backup, "pc1-pass")
    assert b.db_get("students", "s")["name"] == "옮길학생"
    assert b.verify_password("pc2-pass")  # 비밀번호는 지금 PC 것 유지

    c = make(tmp_path, "pc3")
    c.unlock("1234")
    c.import_backup(backup, code)  # 복구 코드로도 가능
    assert c.db_get("students", "s")


def test_migrates_plaintext_v10_beta_db(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    con = sqlite3.connect(folder / "ilog.db")
    con.execute("CREATE TABLE records (store TEXT, key TEXT, data TEXT, updated_at TEXT, PRIMARY KEY(store,key))")
    con.execute("INSERT INTO records VALUES ('students','s1',?, 'x')", (json.dumps({"studentId": "s1", "number": 3, "name": "이전학생"}),))
    con.execute("INSERT INTO records VALUES ('settings','security',?, 'x')", (json.dumps({"id": "security", "hash": "h", "salt": "00"}),))
    con.commit()
    con.close()
    db = Database(folder)
    assert db.unlock("1234")
    assert db.get("students", "s1")["name"] == "이전학생"
    assert db.get("settings", "security") is None
    assert not db.conn.execute("SELECT 1 FROM sqlite_master WHERE name='records_plain_v1'").fetchone()


def test_auto_backup_only_after_unlock_and_extra_folder(tmp_path):
    api = make(tmp_path)
    assert api._db.auto_backup_if_needed() is None  # 잠금 상태
    api.unlock("1234")
    api.db_put("students", {"studentId": "s", "number": 1, "name": "가"})
    extra = tmp_path / "usb"
    api._db.set_extra_backup_dir(str(extra))
    api._db.write_backup_file()
    assert list(extra.glob("ilog_auto_*.json"))
    api._db.set_extra_backup_dir(str(tmp_path / "nope" / "\0bad"))  # 잘못된 추가 위치는 무시
    api._db.write_backup_file()
