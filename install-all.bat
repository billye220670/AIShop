@echo off
title PortAI Build & Install (Electron + Android)
setlocal
cd /d "%~dp0"

echo ============================================================
echo   [1/2] Electron: build Windows installer (pack-win.ps1)
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-win.ps1"
if errorlevel 1 goto :fail

rem --- launch unpacked Electron app for dev/test ---
set "UNPACKED=release\win-unpacked\PortAI.exe"
if not exist "%UNPACKED%" (
    echo.
    echo [warn] Unpacked exe not found: %UNPACKED%
    echo        Please make sure pack-win.ps1 completed successfully.
) else (
    echo.
    echo Stopping any running PortAI instance...
    taskkill /F /IM PortAI.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo Launching PortAI from: %UNPACKED%
    start "" "%UNPACKED%"
)

echo.
echo ============================================================
echo   [2/2] Android: build APK and install (install-apk-auto.ps1)
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-apk-auto.ps1"
if errorlevel 1 goto :fail

echo.
echo =================== ALL DONE ===================
pause
exit /b 0

:fail
echo.
echo ============ FAILED - see output above ============
echo If the Android step failed: connect your phone with USB
echo debugging enabled, then re-run this script.
pause
exit /b 1
