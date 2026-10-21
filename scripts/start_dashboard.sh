#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$PROJECT_DIR/dashboard"

command -v node >/dev/null 2>&1 || { echo "[ERROR] Node.js is not installed"; exit 1; }

if [ ! -d "$DASHBOARD_DIR/node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    (cd "$DASHBOARD_DIR" && npm install --silent)
fi

echo "[INFO] Starting Dashboard server on http://localhost:3000..."
cd "$DASHBOARD_DIR"
node server.js
