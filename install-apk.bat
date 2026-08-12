@echo off
title PortAI APK Tool
rem ============================================
rem  PortAI APK one-click build & install
rem  Interactive menu is inside install-apk.ps1
rem ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-apk.ps1"
echo.
pause
