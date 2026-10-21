param(
    [switch]$Reset
)

$ErrorActionPreference = "Continue"

$ScriptDir   = $PSScriptRoot
$ProjectDir  = Split-Path $ScriptDir -Parent
$KeyfilePath = Join-Path $ProjectDir "mongo-keyfile"
$InitScript  = Join-Path $ScriptDir  "init_replica.js"

try {
    docker info 2>&1 | Out-Null
} catch {
    Write-Host "[ERROR] Docker daemon is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

$needNewKey = $Reset -or !(Test-Path $KeyfilePath)
if (-not $needNewKey) {
    if ((Get-Item $KeyfilePath).Length -lt 50) { $needNewKey = $true }
}

if ($needNewKey) {
    Write-Host "[INFO] Generating mongo-keyfile..."
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 756
    $rng.GetBytes($bytes)
    $b64   = [Convert]::ToBase64String($bytes)
    $cleanB64 = $b64 -replace "`r|`n", ""
    [System.IO.File]::WriteAllText($KeyfilePath, $cleanB64, [System.Text.Encoding]::ASCII)
}

if ($Reset) {
    Write-Host "[INFO] Resetting existing containers and volumes..."
    Push-Location $ProjectDir
    docker compose down -v 2>&1 | Out-Null
    Pop-Location
}

Write-Host "[INFO] Starting containers via Docker Compose..."
Push-Location $ProjectDir
docker compose up -d 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "[ERROR] Failed to start containers." -ForegroundColor Red
    exit 1
}
Pop-Location

Write-Host "[INFO] Waiting for MongoDB nodes to initialize..."
foreach ($Node in @("mongo1", "mongo2", "mongo3")) {
    $ready = $false
    for ($i = 1; $i -le 30; $i++) {
        $out = (docker exec $Node mongosh --eval "db.adminCommand('ping').ok" --quiet 2>&1) -join " "
        if ($out -match "1") {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        Write-Host "[ERROR] Node $Node failed healthcheck." -ForegroundColor Red
        exit 1
    }
}

Write-Host "[INFO] Waiting for root authentication..."
$authOk = $false
for ($i = 1; $i -le 30; $i++) {
    $out = (docker exec mongo1 mongosh -u admin -p AdminPass123 --authenticationDatabase admin --quiet --eval "db.adminCommand('ping').ok" 2>&1) -join " "
    if ($out -match "1") {
        $authOk = $true
        break
    }
    Start-Sleep -Seconds 2
}

Write-Host "[INFO] Initializing Replica Set (rs0)..."
docker cp $InitScript mongo1:/tmp/init_replica.js 2>&1 | Out-Null
docker exec mongo1 mongosh -u admin -p AdminPass123 --authenticationDatabase admin /tmp/init_replica.js

Write-Host "[INFO] Locating active Primary node for seed data..."
$primaryNode = $null
for ($attempt = 1; $attempt -le 15; $attempt++) {
    foreach ($node in @("mongo1", "mongo2", "mongo3")) {
        $checkPrim = (docker exec $node mongosh -u admin -p AdminPass123 --authenticationDatabase admin --quiet --eval "db.hello().isWritablePrimary" 2>&1) -join " "
        if ($checkPrim -match "true") {
            $primaryNode = $node
            break
        }
    }
    if ($primaryNode) { break }
    Start-Sleep -Seconds 2
}

if (-not $primaryNode) { $primaryNode = "mongo1" }

$SeedScript = "var dbDemo = db.getSiblingDB('demoDB'); if (dbDemo.sinhvien.countDocuments() === 0) { dbDemo.sinhvien.insertMany([{ ten: 'Nguyen Van A', mssv: '001', khoa: 'CNTT', gpa: 8.5 }, { ten: 'Tran Thi B', mssv: '002', khoa: 'CNTT', gpa: 9.0 }, { ten: 'Le Van C', mssv: '003', khoa: 'CNTT', gpa: 7.5 }]); }"
docker exec $primaryNode mongosh -u admin -p AdminPass123 --authenticationDatabase admin --quiet --eval "$SeedScript" 2>&1 | Out-Null

Write-Host "[SUCCESS] MongoDB Replica Set rs0 is ready."
Write-Host "  mongo1: localhost:27017"
Write-Host "  mongo2: localhost:27018"
Write-Host "  mongo3: localhost:27019"
Write-Host "  Active Primary: $primaryNode"
Write-Host "  Mongo Express: http://localhost:8081"
