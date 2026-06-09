@echo off
setlocal EnableDelayedExpansion

set TASK_NAME=DarkExplorer
set REPO_DIR=%~dp0..
set START_SCRIPT=%~dp0start.bat
pushd "%REPO_DIR%"

echo.
echo === DarkExplorer Setup (Windows) ===
echo.

:: ---- Step 1: Node.js ----
where node >nul 2>&1
if errorlevel 1 (
  echo [INFO] Node.js not found. Attempting install via winget...
  winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [ERROR] winget install failed. Install Node.js manually from https://nodejs.org
    popd & exit /b 1
  )
  echo [OK] Node.js installed. You may need to open a new terminal for PATH to update.
) else (
  for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v
)

:: ---- Step 2: ffmpeg ----
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo [INFO] ffmpeg not found. Attempting install via winget...
  winget install --id Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [WARN] ffmpeg install failed. Video thumbnails will be disabled.
    echo        Install manually: https://ffmpeg.org/download.html
  ) else (
    echo [OK] ffmpeg installed.
  )
) else (
  echo [OK] ffmpeg present.
)

:: ---- Step 3: npm install ----
echo.
echo [INFO] Installing npm dependencies (this may take a minute)...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  popd & exit /b 1
)
echo [OK] Dependencies installed.

:: ---- Step 4: Generate first OTP ----
echo.
echo [INFO] Generating enrollment OTP...
for /f "tokens=3" %%c in ('node server\index.js --gen-otp 2^>nul ^| findstr /B "DarkExplorer"') do set OTP=%%c
if defined OTP (
  echo [OK] First-device enrollment OTP: !OTP!
  echo      Browse to http://localhost:3322 and enter this code to enroll.
) else (
  echo [INFO] Generate an OTP later with:  node server\index.js --gen-otp
)

:: ---- Step 5: Register autostart task ----
schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if not errorlevel 1 schtasks /delete /tn "%TASK_NAME%" /f >nul

schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd.exe /c \"%START_SCRIPT%\"" ^
  /sc onlogon ^
  /rl limited ^
  /f ^
  /it >nul

if errorlevel 1 (
  echo [WARN] Failed to register autostart task. You can still run start.bat manually.
) else (
  echo [OK] DarkExplorer will start automatically on logon.
)

:: ---- Step 6: Start now ----
echo.
echo Starting DarkExplorer at http://localhost:3322 ...
start "" /B cmd /c "%START_SCRIPT%"

echo.
echo === Setup complete ===
popd
endlocal
