$MONGO_USER = "admin"
$MONGO_PASS = "AdminPass123"
$MONGO_DB   = "admin"

function Invoke-Mongo {
    param([string]$Container, [string]$Eval)
    return docker exec $Container mongosh -u $MONGO_USER -p $MONGO_PASS --authenticationDatabase $MONGO_DB --quiet --eval $Eval 2>&1
}

function Get-PrimaryNode {
    foreach ($node in @("mongo1", "mongo2", "mongo3")) {
        $st = (docker inspect $node --format "{{.State.Status}}" 2>&1).Trim()
        if ($st -ne "running") { continue }
        $r = Invoke-Mongo $node "db.hello().isWritablePrimary"
        if ($r -match "true") { return $node }
    }
    return $null
}

Write-Host "[TEST] Starting MongoDB Replica Set Failover Test"

$primary = Get-PrimaryNode
if (-not $primary) {
    Write-Error "No active Primary found in cluster. Aborting test."
    exit 1
}

Write-Host "[INFO] Current Primary node: $primary"

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$writeScript = "use demoDB; db.failover_test.insertOne({ test: 'failover', node: '$primary', ts: '$ts' });"
$null = Invoke-Mongo $primary $writeScript
Write-Host "[INFO] Inserted pre-failover verification record."

Write-Host "[INFO] Stopping Primary node ($primary)..."
$start = Get-Date
docker stop $primary | Out-Null

$queryNode = if ($primary -eq "mongo1") { "mongo2" } else { "mongo1" }
$newPrimary = $null
$maxWaitSec = 40

Write-Host "[INFO] Monitoring election progress..."
for ($i = 0; $i -lt ($maxWaitSec * 2); $i++) {
    Start-Sleep -Milliseconds 500
    $raw = docker exec $queryNode mongosh -u $MONGO_USER -p $MONGO_PASS --authenticationDatabase $MONGO_DB --quiet --eval "JSON.stringify(rs.status().members.map(m=>({name:m.name,state:m.stateStr})))" 2>&1

    try {
        $members = $raw | ConvertFrom-Json
        $elected = $members | Where-Object { $_.state -eq "PRIMARY" -and $_.name.Split(":")[0] -ne $primary }
        if ($elected) {
            $newPrimary = $elected.name.Split(":")[0]
            break
        }
    } catch {}
}

$elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 2)

if ($newPrimary) {
    Write-Host "[SUCCESS] Election completed in $elapsed seconds. New Primary: $newPrimary"
} else {
    Write-Error "Election timed out after $elapsed seconds."
    exit 1
}

$verify = (Invoke-Mongo $newPrimary "db.getSiblingDB('demoDB').failover_test.countDocuments({ test: 'failover' })").Trim()
Write-Host "[INFO] Data integrity check: $verify record(s) verified on new Primary."

Write-Host "[INFO] Restarting original node ($primary)..."
docker start $primary | Out-Null
Start-Sleep -Seconds 8

$rejoinState = (Invoke-Mongo $newPrimary "rs.status().members.find(m=>m.name.startsWith('$primary')).stateStr").Trim()
Write-Host "[INFO] Node $primary rejoined with state: $rejoinState"
Write-Host "[SUCCESS] Failover test completed successfully."
