@echo off
echo ========================================
echo Starting SYNAPSE Full Stack
echo ========================================
echo.

echo [1/3] Checking for running processes...
powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"
timeout /t 2 /nobreak >nul

echo [2/3] Starting Backend (port 3000)...
start "Synapse Backend" cmd /k "cd /d %~dp0backend && npm start"
timeout /t 3 /nobreak >nul

echo [3/3] Starting Frontend (port 5500)...
start "Synapse Frontend" cmd /k "cd /d %~dp0frontend && py -m http.server 5500"

echo.
echo ========================================
echo ✓ All services starting...
echo ========================================
echo.
echo Backend:  http://localhost:3000
echo Frontend: http://localhost:5500
echo.
echo Press any key to open browser...
pause >nul

start http://localhost:5500

echo.
echo To stop: Close the Backend and Frontend windows
echo.
