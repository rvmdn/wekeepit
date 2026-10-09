@echo off
title WeKeepIt Desktop Launcher
cd /d "%~dp0"

echo [WeKeepIt] Memeriksa server latar belakang...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:4321/api/ping' -TimeoutSec 1 -UseBasicParsing; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 (
    echo [WeKeepIt] Server sudah berjalan. Membuka jendela aplikasi...
    goto OpenApp
)

echo [WeKeepIt] Menjalankan server lokal ringan...
start /b "" node server.js

:WaitForServer
timeout /t 1 /nobreak >nul
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:4321/api/ping' -TimeoutSec 1 -UseBasicParsing; exit 0 } catch { exit 1 }"
if %errorlevel% neq 0 goto WaitForServer

:OpenApp
echo [WeKeepIt] Membuka jendela desktop board...
start "" msedge.exe --app=http://localhost:4321 --window-size=1200,820
if %errorlevel% neq 0 (
    start "" chrome.exe --app=http://localhost:4321 --window-size=1200,820
)
if %errorlevel% neq 0 (
    start http://localhost:4321
)

exit
