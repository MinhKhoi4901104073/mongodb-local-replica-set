function Get-ContainerState([string]$Name) {
    return (docker inspect $Name --format "{{.State.Status}}" 2>&1).Trim()
}

$nodes = @("mongo1", "mongo2", "mongo3")
$ports = @{ "mongo1" = 27017; "mongo2" = 27018; "mongo3" = 27019 }

Write-Host "Container Status:"
foreach ($node in $nodes) {
    $st = Get-ContainerState $node
    Write-Host ("  {0,-8} port:{1}  status:{2}" -f $node, $ports[$node], $st)
}

Write-Host ""
Write-Host "Replica Set Status:"
$fetched = $false

foreach ($node in $nodes) {
    if ((Get-ContainerState $node) -ne "running") { continue }

    $evalCmd = "rs.status().members.forEach(m => print(m.name + '|' + m.stateStr + '|' + m.health))"
    $raw = docker exec $node mongosh -u admin -p AdminPass123 --authenticationDatabase admin --quiet --eval $evalCmd 2>&1

    if ($raw -and ($raw -notmatch "Error|MongoServerError|ECONNREFUSED")) {
        foreach ($line in ($raw -split "`r?`n")) {
            $line = $line.Trim()
            if (-not $line -or $line -notmatch '\|') { continue }
            $parts = $line -split '\|'
            if ($parts.Count -ge 3) {
                $mHealth = if ($parts[2] -eq "1") { "HEALTHY" } else { "UNHEALTHY" }
                Write-Host ("  {0,-20} {1,-12} {2}" -f $parts[0], $parts[1], $mHealth)
            }
        }
        $fetched = $true
        break
    }
}

if (-not $fetched) {
    Write-Host "  Unable to connect to active cluster nodes."
}
