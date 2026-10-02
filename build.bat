@echo off
REM 아이로그 iLOG - Windows 빌드 (Python 3.11~3.12 필요)
REM   결과 1: dist\iLOG.exe           (exe 1개, 들고 다니기 편함)
REM   결과 2: dist\iLOG\iLOG.exe      (폴더형, 백신 오탐이 적고 시작이 빠름 - 학교 배포 권장)
cd /d %~dp0
python -m pip install -r requirements.txt pytest pyinstaller || goto :err
python -m pytest -q || goto :err
python -m PyInstaller --noconfirm --clean iLOG.spec || goto :err
python -m PyInstaller --noconfirm --clean iLOG_folder.spec || goto :err
powershell -NoProfile -Command "Compress-Archive -Force -Path dist\iLOG\* -DestinationPath dist\iLOG_folder.zip" || goto :err
echo.
echo 완료: dist\iLOG.exe , dist\iLOG_folder.zip
goto :eof
:err
echo 빌드 실패
exit /b 1
