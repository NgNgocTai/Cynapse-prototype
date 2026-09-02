#!/usr/bin/env pwsh

# Synapse Start All Services
# Starts backend and frontend in separate PowerShell windows

Write-Host "🚀 Starting Synapse Services..." -ForegroundColor Cyan
Write-Host ""

# Check if backend dependencies installed
if (-not (Test-Path "backend\node_modules")) {
    Write-Host "📦 Installing backend dependencies..." -ForegroundColor Yellow
    Set-Location backend
    npm install
    Set-Location ..
}

# Check if .env exists
if (-not (Test-Path "backend\.env")) {
    Write-Host "⚠️  .env file not found!" -ForegroundColor Red
    Write-Host "   Please run: cd backend && cp .env.example .env" -ForegroundColor Yellow
    Write-Host "   Then edit .env with your AWX token and URL" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Verify setup first
Write-Host "🔍 Verifying setup..." -ForegroundColor Cyan
Set-Location backend
$verifyResult = npm run verify 2>&1
Set-Location ..

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Setup verification failed!" -ForegroundColor Red
    Write-Host "   Please fix the issues above before starting" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "✅ Setup verified!" -ForegroundColor Green
Write-Host ""

# Start backend in new window
Write-Host "🟢 Starting backend (http://localhost:3000)..." -ForegroundColor Green
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$PWD\backend'; npm start"

# Wait a bit for backend to start
Start-Sleep -Seconds 2

# Start frontend in new window
Write-Host "🌐 Starting frontend (http://localhost:5500)..." -ForegroundColor Green
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$PWD\frontend'; python -m http.server 5500"

# Wait a bit
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "✅ Services started!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 AWX:      http://localhost:8080 (kubectl port-forward)" -ForegroundColor Cyan
Write-Host "📍 Backend:  http://localhost:3000" -ForegroundColor Cyan
Write-Host "📍 Frontend: http://localhost:5500" -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐 Open your browser: http://localhost:5500" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  Make sure AWX port-forward is running in another terminal:" -ForegroundColor Yellow
Write-Host "   kubectl --context=awx-lab -n awx port-forward svc/awx-demo-service 8080:80" -ForegroundColor Gray
Write-Host ""
Write-Host "To stop: Close the PowerShell windows or press Ctrl+C in each" -ForegroundColor Gray
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""
