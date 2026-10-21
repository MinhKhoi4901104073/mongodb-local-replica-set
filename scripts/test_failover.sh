#!/usr/bin/env bash
set -euo pipefail

MONGO_USER="admin"
MONGO_PASS="AdminPass123"
MONGO_DB="admin"

invoke_mongo() {
    docker exec "$1" mongosh -u "$MONGO_USER" -p "$MONGO_PASS" --authenticationDatabase "$MONGO_DB" --quiet --eval "$2" 2>&1
}

echo "[TEST] Starting MongoDB Replica Set Failover Test"

primary=""
for node in mongo1 mongo2 mongo3; do
    if [ "$(docker inspect "$node" --format "{{.State.Status}}" 2>/dev/null)" = "running" ]; then
        if invoke_mongo "$node" "db.hello().isWritablePrimary" | grep -q "true"; then
            primary="$node"
            break
        fi
    fi
done

if [ -z "$primary" ]; then
    echo "[ERROR] No active Primary found."
    exit 1
fi

echo "[INFO] Current Primary: $primary"
invoke_mongo "$primary" "db.getSiblingDB('demoDB').failover_test.insertOne({ test: 'failover', ts: new Date() });" >/dev/null

echo "[INFO] Stopping Primary ($primary)..."
start_time=$(date +%s)
docker stop "$primary" >/dev/null

query_node="mongo2"
[ "$primary" = "mongo2" ] && query_node="mongo3"

new_primary=""
for i in {1..80}; do
    sleep 0.5
    raw=$(invoke_mongo "$query_node" "JSON.stringify(rs.status().members.map(m=>({name:m.name,state:m.stateStr})))" 2>/dev/null || true)
    new_p=$(echo "$raw" | grep -o '"name":"[^"]*","state":"PRIMARY"' | cut -d'"' -f4 | cut -d':' -f1 || true)
    if [ -n "$new_p" ] && [ "$new_p" != "$primary" ]; then
        new_primary="$new_p"
        break
    fi
done

end_time=$(date +%s)
elapsed=$((end_time - start_time))

if [ -n "$new_primary" ]; then
    echo "[SUCCESS] Election completed in ~${elapsed}s. New Primary: $new_primary"
else
    echo "[ERROR] Election timed out."
    exit 1
fi

echo "[INFO] Restarting original node ($primary)..."
docker start "$primary" >/dev/null
sleep 8

rejoin_state=$(invoke_mongo "$new_primary" "rs.status().members.find(m=>m.name.startsWith('$primary')).stateStr")
echo "[INFO] Node $primary rejoined with state: $rejoin_state"
echo "[SUCCESS] Failover test completed."
