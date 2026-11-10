@echo off
if exist "%~dp0WeKeepIt.exe" (
    start "" "%~dp0WeKeepIt.exe"
    exit
)
if exist "%~dp0package\WeKeepIt-v2.1.1-Portable\WeKeepIt.exe" (
    start "" "%~dp0package\WeKeepIt-v2.1.1-Portable\WeKeepIt.exe"
    exit
)
if exist "%~dp0WeKeepIt-v2.0-Portable\WeKeepIt.exe" (
    start "" "%~dp0WeKeepIt-v2.0-Portable\WeKeepIt.exe"
    exit
)
start "" "%~dp0launch-desktop.bat"
exit
