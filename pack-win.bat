@echo off
title PortAI Electron Pack (Windows Installer)
rem =====================================================
rem  One-click build of the Electron Windows installer.
rem  All logic lives in pack-win.ps1
rem  Usage:  double-click to run, or call with -SkipBuild
rem =====================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-win.ps1" %*
echo.
pause
