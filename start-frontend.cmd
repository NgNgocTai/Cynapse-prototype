@echo off
echo ========================================
echo Starting Synapse Frontend
echo ========================================
echo.

cd /d "%~dp0frontend"

echo Starting frontend on http://localhost:5500
echo Press Ctrl+C to stop
echo.
echo NOTE: Port 5500 is used (8080 is for AWX)
echo.

py -m http.server 5500
