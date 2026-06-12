#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVER_PORT="${L3_SERVER_PORT:-8080}"
WEB_PORT="${L3_WEB_PORT:-3001}"

cleanup() {
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true P2P_NODE_ENABLED=1 P2P_RATE_LIMIT_MAX_EVENTS=5000 PORT="$SERVER_PORT" \
  node dist/server/server/index.js >/tmp/iinpublic-l3-hub-stop-server.log 2>&1 &
SERVER_PID=$!

CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false DISABLE_HMR=true P2P_NODE_ENABLED=1 PORT="$WEB_PORT" \
  npm run dev:web:e2e -- --port "$WEB_PORT" >/tmp/iinpublic-l3-hub-stop-web.log 2>&1 &
WEB_PID=$!

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${SERVER_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

E2E_REUSE_SERVERS=1 \
E2E_GUN_MEMORY_ONLY=1 \
DISABLE_HMR=true \
E2E_P2P_NODE_ENABLED=1 \
PW_WORKERS=1 \
playwright test tests/e2e/talks-matching/07-mesh-ping-after-hub-stop.spec.ts
