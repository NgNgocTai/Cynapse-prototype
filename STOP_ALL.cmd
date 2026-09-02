@echo off
echo ========================================
echo Stopping SYNAPSE Services
echo ========================================
echo.

echo Killing Node.js processes (Backend)...
powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"

echo Killing Python server (Frontend - port 5500)...
powershell -Command "$p = netstat -ano | Select-String ':5500' | Select-Object -First 1; if ($p) { $pid = ($p -split '\s+')[-1]; taskkill /F /PID $pid }"

echo.
echo ========================================
echo ✓ All services stopped
echo ========================================
echo.
pause
