@echo off
cd /d "%~dp0"
echo Killing PravahaX Server...
taskkill /F /IM node.exe 2>nul
if %errorlevel%==0 (
    echo Server stopped.
) else (
    echo No server running.
)
pause
