@echo off
setlocal

set TASK_NAME=DarkExplorer
set SCRIPT=%~dp0start.bat

:: Check for node
where node >nul 2>&1
if errorlevel 1 (
  echo [WARN] node.js not found. Install it from https://nodejs.org
)

:: Check for ffmpeg
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo [WARN] ffmpeg not found. Video thumbnails will be disabled.
  echo        Install: choco install ffmpeg  or  winget install ffmpeg
)

:: Remove existing task if present (idempotent)
schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if not errorlevel 1 (
  schtasks /delete /tn "%TASK_NAME%" /f >nul
)

:: Register task to run at user logon, hidden window
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd.exe /c \"%SCRIPT%\"" ^
  /sc onlogon ^
  /rl limited ^
  /f ^
  /it >nul

if errorlevel 1 (
  echo [ERROR] Failed to register startup task.
  exit /b 1
)

echo [OK] DarkExplorer will start automatically on logon.
echo      To start now: call "%SCRIPT%"
endlocal
