@echo off
rem Builds a compact portable TF2 Workbench: viewer + native particle helper, no installer or dev server needed.
rem The result is in the "share" folder (viewer exe, native helper, poses folder and a short readme);
rem it is also zipped as share\TF2Workbench.zip. Send that zip around: unpack it anywhere and run the exe.
rem Needs Team Fortress 2 installed on the machine that runs it (the game files are read from there) and the Edge WebView2 runtime
rem (part of Windows 10/11).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install || goto :fail
)
rem Use a separate output name so building does not replace the helper running in the development client.
echo Building native particle support...
powershell -NoProfile -ExecutionPolicy Bypass -File "native\particle-probe\build.ps1" -ExecutableName particle-probe-package
if errorlevel 1 goto :fail
if not exist "target\particle-probe\particle-probe-package.exe" goto :fail
rem --no-bundle: portable files instead of msi / setup installers.
call npm run tauri build -- --no-bundle
if errorlevel 1 goto :fail
if not exist "target\release\tf2-workbench.exe" goto :fail

rem Release lookup expects the helper beside the viewer under native, including when run from target\release.
if not exist "target\release\native" mkdir "target\release\native"
copy /y "target\particle-probe\particle-probe-package.exe" "target\release\native\particle-probe.exe" >nul
if errorlevel 1 goto :fail
rem Preserve existing poses when rebuilding the portable folder.
if not exist "share\TF2Workbench\poses" mkdir "share\TF2Workbench\poses"
if not exist "share\TF2Workbench\native" mkdir "share\TF2Workbench\native"
copy /y "target\release\tf2-workbench.exe" "share\TF2Workbench\TF2Workbench.exe" >nul
if errorlevel 1 goto :fail
copy /y "target\particle-probe\particle-probe-package.exe" "share\TF2Workbench\native\particle-probe.exe" >nul
if errorlevel 1 goto :fail
rem The helper links Valve's SDK libraries: the license, the third-party notices and our own license and notice go with every copy.
copy /y "LICENSE" "share\TF2Workbench\LICENSE" >nul
if errorlevel 1 goto :fail
copy /y "NOTICE.md" "share\TF2Workbench\NOTICE.md" >nul
if errorlevel 1 goto :fail
if not exist "share\TF2Workbench\licenses" mkdir "share\TF2Workbench\licenses"
copy /y "licenses\*" "share\TF2Workbench\licenses\" >nul
if errorlevel 1 goto :fail
(
  echo TF2 Workbench - a faster way to look at TF2 models, cosmetics and weapons.
  echo.
  echo Run TF2Workbench.exe. It needs Team Fortress 2 installed ^(it reads the models from the game^) and opens its own folder picker
  echo if it cannot find the game. Nothing from the game is copied or stored.
  echo.
  echo Keep the native folder beside TF2Workbench.exe. Its particle helper is required for most unusual effects.
  echo The helper uses the runtime DLLs from your installed 64-bit TF2; no game DLLs or assets are included here.
  echo.
  echo The "poses" folder holds saved poses. Copy .json files in or out of it to share poses.
  echo.
  echo Free of charge. LICENSE, NOTICE.md and the licenses folder ^(Valve's Source 1 SDK license and notices^) must stay with every copy.
) > share\TF2Workbench\README.txt
rem The zip is made from a copy with an empty poses folder, so the poses saved on this machine never end up in it.
if exist "share\zip-staging" rmdir /s /q "share\zip-staging"
robocopy "share\TF2Workbench" "share\zip-staging\TF2Workbench" /E /XD poses /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail
mkdir "share\zip-staging\TF2Workbench\poses"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'share\zip-staging\TF2Workbench' -DestinationPath 'share\TF2Workbench.zip' -Force -ErrorAction Stop"
if errorlevel 1 goto :fail
rmdir /s /q "share\zip-staging"

echo.
for %%F in ("share\TF2Workbench\TF2Workbench.exe") do echo Done: %%~fF  (%%~zF bytes)
for %%F in ("share\TF2Workbench.zip") do echo Zip for sharing: %%~fF  (%%~zF bytes)
if /i "%~1"=="--no-pause" exit /b 0
start "" explorer "%~dp0share"
pause
exit /b 0
:fail
echo.
echo The build failed, see the messages above.
if /i "%~1"=="--no-pause" exit /b 1
pause
exit /b 1
