@echo off
rem Starts TF2 Workbench in dev mode (compiles on the first run, then reloads as the code changes).
rem Close the app window to quit; this console closes with it. Ctrl+C here stops it too.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install || goto :fail
)
call npm run tauri dev
if errorlevel 1 goto :fail
exit /b 0
:fail
echo.
echo Something went wrong, see the messages above.
pause
exit /b 1
