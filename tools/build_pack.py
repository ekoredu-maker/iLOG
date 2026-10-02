"""엑셀 지도계획 -> 기본 탑재용 JSON 데이터팩 변환.

    python tools/build_pack.py 입력.xlsx curriculum_packs/
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.curriculum import packs_from_rows  # noqa: E402
from backend.excel_io import read_rows  # noqa: E402


def main(src: str, out_dir: str) -> None:
    rows = read_rows(Path(src).read_bytes(), src)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for p in packs_from_rows(rows):
        f = out / f"{p['packId']}.json"
        f.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{f.name}: {p['grade']}학년 {p['subject']} / {p['publisher']} - {len(p['lessons'])}차시")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
