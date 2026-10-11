@echo off
rem Builds the web version of the app (the viewer without the item compiler, running in a browser) into the "dist-web" folder.
rem
rem The game's files are NOT in the repository: this script extracts the ones the site reads out of your own Team Fortress 2 install
rem (the tool "webbake" asks the app's backend for every model, material, animation, particle effect and sky the viewer can show, and
rem copies what that needed) into "web-assets", then builds the page around them. The first run takes a while (tens of minutes and
rem several gigabytes); web-assets is kept, so build-webapp.bat skipbake rebuilds only the page.
rem
rem   build-webapp.bat              extract the game's files, build the backend and the page
rem   build-webapp.bat skipbake     keep web-assets as it is (the page and the backend only)
rem   build-webapp.bat quick        a small extraction (a few cosmetics), for trying the build
rem
rem   set ASSETS_URL=https://bucket.example.com/   (before running) the game's files are NOT copied into dist-web: upload
rem                                 web-assets\assets to that address (its "assets" folder at the root of the URL) and the page reads them from there.
rem                                 The bucket needs CORS (Access-Control-Allow-Origin for the site). Without it, dist-web holds everything (~5 GB).
rem
rem Needs Team Fortress 2 installed (found through Steam), Rust (rustup) and Node. Upload the contents of dist-web to any static host.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install || goto :fail
)
echo Making sure the WebAssembly target is there...
rustup target add wasm32-unknown-unknown || goto :fail
echo Building the backend as WebAssembly...
cargo build -p workbench-wasm --target wasm32-unknown-unknown --release || goto :fail

if /i "%1"=="skipbake" goto :page
if not exist web-assets mkdir web-assets
if /i "%1"=="quick" (
  echo Extracting a small set of the game's files...
  cargo run --release -p webbake -- --quick --out web-assets || goto :fail
) else (
  echo Extracting the game's files ^(slow: everything the viewer can show^)...
  cargo run --release -p webbake -- --out web-assets || goto :fail
)
:page
if not exist web-assets\index.txt (
  echo web-assets has not been made yet: run build-webapp.bat without skipbake.
  goto :fail
)
copy /y target\wasm32-unknown-unknown\release\workbench_wasm.wasm web-assets\workbench.wasm >nul || goto :fail
if defined ASSETS_URL set VITE_ASSETS_URL=%ASSETS_URL%
echo Building the page...
call npx tsc --noEmit || goto :fail
call npx vite build --mode web || goto :fail
echo.
echo Done: dist-web is the site. To try it here:  npx vite preview --mode web --outDir dist-web
exit /b 0
:fail
echo.
echo The web build failed.
exit /b 1
