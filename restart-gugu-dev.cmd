@echo off
setlocal

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REPO%\desktop\scripts\restart-tauri-dev.ps1" -RepoRoot "%REPO%"

endlocal
