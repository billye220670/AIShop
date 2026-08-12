@echo off
title PortAI APK Auto Install
rem ============================================
rem  PortAI APK auto build & install (no prompt)
rem  Logic is inside install-apk-auto.ps1
rem ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-apk-auto.ps1"
echo.
pause
