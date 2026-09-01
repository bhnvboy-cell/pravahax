@echo off
cd /d "%~dp0"
echo Starting PravahaX Server...
start "" /B node server.js
timeout /t 3 >nul
echo.
echo Server running at:
echo   Local:   http://localhost:3000
echo   Network: http://10.46.144.221:3000
echo.
pause
