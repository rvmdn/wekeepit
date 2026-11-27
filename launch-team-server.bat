@echo off
title WeKeepIt - Team Server Mode (Multi-User + LAN Access)
cd /d "%~dp0"

echo =========================================================
echo  WeKeepIt - Team Server Mode (Multi-User + LAN Access)
echo =========================================================
echo.

set HOST=0.0.0.0
set ALLOW_REMOTE_HOST=true
set AUTH_ENABLED=true

if exist "%~dp0wekeepit.pfx" goto use_pfx
if exist "%~dp0wekeepit.key" (
  if exist "%~dp0wekeepit.crt" goto use_pem
)

echo [INFO] Menjalankan dalam mode HTTP. Taruh wekeepit.pfx untuk mengaktifkan HTTPS.
goto start_server

:use_pfx
echo [TLS] Sertifikat wekeepit.pfx ditemukan - mengaktifkan HTTPS...
set SSL_PFX_PATH=%~dp0wekeepit.pfx
if "%SSL_PASSPHRASE%"=="" set SSL_PASSPHRASE=wekeepit123
goto start_server

:use_pem
echo [TLS] Sertifikat wekeepit.key + wekeepit.crt ditemukan - mengaktifkan HTTPS...
set SSL_KEY_PATH=%~dp0wekeepit.key
set SSL_CERT_PATH=%~dp0wekeepit.crt
goto start_server

:start_server
echo.
node server.js
if "%WEKEEPIT_NO_PAUSE%"=="1" goto :eof
pause
