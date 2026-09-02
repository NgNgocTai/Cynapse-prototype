@echo off
echo ========================================
echo Starting Synapse Backend
echo ========================================
echo.

cd /d "%~dp0backend"

echo Checking node_modules...
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
)

echo.
echo Starting backend on http://localhost:3000
echo Press Ctrl+C to stop
echo.

call npm start
