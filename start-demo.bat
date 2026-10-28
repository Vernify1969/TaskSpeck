@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and then double-click this file again.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo Installing TaskSpeck. This can take a minute the first time.
  call npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)
echo Starting the TaskSpeck demo.
echo A browser window opens at http://127.0.0.1:5173/
echo Leave the "TaskSpeck demo server" window open while you try the app.
echo On a phone on the same Wi-Fi, use the network address printed in that window.
start "TaskSpeck demo server" cmd /c "npm run demo"
ping -n 6 127.0.0.1 >nul
start "" "http://127.0.0.1:5173/"
echo.
echo The demo is starting. You can close this window. Keep the server window open.
pause
