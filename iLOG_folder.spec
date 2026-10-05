# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 폴더형 빌드.
# 단일 exe보다 백신 오탐 가능성을 낮추기 위해:
# - UPX 사용 안 함
# - Python 바이트코드를 하나의 PYZ로 강하게 묶지 않고(noarchive=True)
# - 실행 파일에는 바이너리를 합치지 않고 폴더에 분리
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

a = Analysis(
    ['main.py'],
    pathex=[],
    datas=[('web', 'web'), ('curriculum_packs', 'curriculum_packs'), ('THIRD_PARTY_LICENSES.md', '.')] + collect_data_files('hwpx'),
    hiddenimports=['webview.platforms.edgechromium', 'webview.platforms.winforms', 'clr', 'cryptography.hazmat.primitives.ciphers.aead'] + collect_submodules('hwpx'),
    excludes=['tkinter', 'matplotlib', 'numpy', 'pandas', 'PIL'],
    noarchive=True,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='iLOG',
    console=False,
    icon='icon.ico',
    upx=False,
    version='version_info.txt',
)
coll = COLLECT(exe, a.binaries, a.datas, name='iLOG', upx=False)
