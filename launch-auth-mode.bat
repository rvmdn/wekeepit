@echo off
title WeKeepIt - Mode Server dengan Autentikasi
cd /d "%~dp0"
echo =========================================================
echo  WeKeepIt - Mode Server dengan Autentikasi (AUTH_ENABLED)
echo =========================================================
echo.
set AUTH_ENABLED=true
start "" msedge.exe --app=http://127.0.0.1:4321 --window-size=1366,768
node server.js
