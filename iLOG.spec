# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 빌드 설정 (exe 1개 형태):  python -m PyInstaller --noconfirm --clean iLOG.spec
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

a = Analysis(
    ['main.py'],
    pathex=[],
    datas=[('web', 'web'), ('curriculum_packs', 'curriculum_packs'), ('THIRD_PARTY_LICENSES.md', '.')] + collect_data_files('hwpx'),
    hiddenimports=['webview.platforms.edgechromium', 'webview.platforms.winforms', 'clr', 'cryptography.hazmat.primitives.ciphers.aead'] + collect_submodules('hwpx'),
    excludes=['tkinter', 'matplotlib', 'numpy', 'pandas', 'PIL'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='iLOG',
    console=False,
    icon='icon.ico',
    upx=False,                # UPX 압축은 백신 오탐을 늘리므로 사용하지 않음
    version='version_info.txt',
)
