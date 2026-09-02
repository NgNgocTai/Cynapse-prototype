# Simple PowerShell HTTP server for testing
Write-Host "Starting HTTP server on http://localhost:5500" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop"
Write-Host ""
Write-Host "Note: Port 5500 is used because 8080 is reserved for AWX" -ForegroundColor Yellow
Write-Host ""

python -m http.server 5500
