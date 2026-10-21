#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
KEYFILE="$PROJECT_DIR/mongo-keyfile"
INIT_JS="$SCRIPT_DIR/init_replica.js"
RESET=${1:-""}

command -v docker &>/dev/null || { echo "[ERROR] Docker not found"; exit 1; }
docker info &>/dev/null || { echo "[ERROR] Docker daemon is not running"; exit 1; }

if [[ "$RESET" == "--reset" ]] || [[ ! -f "$KEYFILE" ]] || [[ $(wc -c < "$KEYFILE") -lt 50 ]]; then
    echo "[INFO] Generating mongo-keyfile..."
    openssl rand -base64 756 | tr -d '\n\r' > "$KEYFILE"
    chmod 400 "$KEYFILE"
fi

if [[ "$RESET" == "--reset" ]]; then
    echo "[INFO] Cleaning existing containers and volumes..."
    (cd "$PROJECT_DIR" && docker compose down -v 2>/dev/null || true)
fi

echo "[INFO] Starting containers..."
(cd "$PROJECT_DIR" && docker compose up -d)

echo "[INFO] Waiting for nodes..."
for node in mongo1 mongo2 mongo3; do
    ready=false
    for i in {1..30}; do
        if docker exec "$node" mongosh --eval "db.adminCommand('ping').ok" --quiet 2>&1 | grep -q "^1"; then
            ready=true
            break
        fi
        sleep 2
    done
    if [ "$ready" = false ]; then
        echo "[ERROR] Node $node failed to start"; exit 1
    fi
done

echo "[INFO] Waiting for mongo1 root authentication..."
for i in {1..30}; do
    if docker exec mongo1 mongosh -u admin -p AdminPass123 --authenticationDatabase admin --quiet --eval "db.adminCommand('ping').ok" 2>&1 | grep -q "^1"; then
        break
    fi
    sleep 2
done

echo "[INFO] Initializing Replica Set..."
docker cp "$INIT_JS" mongo1:/tmp/init_replica.js
docker exec mongo1 mongosh -u admin -p AdminPass123 --authenticationDatabase admin /tmp/init_replica.js

echo "[SUCCESS] MongoDB Replica Set rs0 is ready."
