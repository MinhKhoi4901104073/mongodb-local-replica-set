$ScriptDir    = $PSScriptRoot
$ProjectDir   = Split-Path $ScriptDir -Parent
$DashboardDir = Join-Path $ProjectDir "dashboard"

try {
    $null = node -v
} catch {
    Write-Error "Node.js is required to run the dashboard. Please install from https://nodejs.org"
    exit 1
}

if (!(Test-Path (Join-Path $DashboardDir "node_modules"))) {
    Write-Host "[INFO] Installing dashboard dependencies..."
    Push-Location $DashboardDir
    npm install --silent
    Pop-Location
}

Write-Host "[INFO] Starting Dashboard server on http://localhost:3000..."
Start-Process "http://localhost:3000"

Push-Location $DashboardDir
node server.js
Pop-Location
