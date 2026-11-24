@echo off
setlocal
cd /d "%~dp0"
set "previewNode="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined previewNode set "previewNode=%%N"
if not defined previewNode if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "previewNode=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined previewNode (
    echo Node.js was not found. Install Node.js, then run this file again.
    pause
    exit /b 1
)
echo.
echo Open http://127.0.0.1:8080/ in your browser.
echo Keep this window open while previewing the site.
echo Press Ctrl+C or close this window to stop the preview.
echo.
"%previewNode%" tools\preview.mjs
echo.
echo The preview server has stopped.
pause
