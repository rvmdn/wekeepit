@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

for /f "tokens=1-3 delims=/ " %%a in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd'"') do set TODAY=%%a

if exist "D:\" (
  set BACKUP_ROOT=D:\WeKeepIt-Backups
) else (
  set BACKUP_ROOT=%~dp0backups
)

set TARGET_DIR=%BACKUP_ROOT%\%TODAY%
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [Backup] Menyalin data WeKeepIt ke %TARGET_DIR% ...

for %%F in (wekeepit-data.json wekeepit-data.json.bak users.json users.json.bak metadata-schema.json wekeepit-index.db) do (
  if exist "%~dp0%%F" copy /Y "%~dp0%%F" "%TARGET_DIR%\" >nul
)

if exist "%~dp0my-boards" (
  robocopy "%~dp0my-boards" "%TARGET_DIR%\my-boards" /E /NFL /NDL /NJH /NJS /NC /NS >nul
)

if exist "D:\WeKeepIt-Vault" (
  robocopy "D:\WeKeepIt-Vault" "%TARGET_DIR%\WeKeepIt-Vault" /E /NFL /NDL /NJH /NJS /NC /NS >nul
)

:: Hapus backup yang lebih lama dari 14 hari agar disk tidak penuh
powershell -NoProfile -Command "Get-ChildItem -Path '%BACKUP_ROOT%' -Directory | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue"

echo [Backup] Selesai: %TARGET_DIR%
endlocal
