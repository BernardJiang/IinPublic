#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVER_PORT="${RELAY_RESTART_SERVER_PORT:-8080}"
WEB_PORT="${RELAY_RESTART_WEB_PORT:-3001}"
SUPERVISOR_PID=""
WEB_PID=""

cleanup() {
  if [[ -n "$SUPERVISOR_PID" ]]; then
    children="$(pgrep -P "$SUPERVISOR_PID" 2>/dev/null || true)"
    [[ -n "$children" ]] && kill $children >/dev/null 2>&1 || true
    kill "$SUPERVISOR_PID" >/dev/null 2>&1 || true
  fi
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

(
  restarts=0
  while [[ "$restarts" -le 1 ]]; do
    CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true P2P_RATE_LIMIT_MAX_EVENTS=5000 PORT="$SERVER_PORT" \
      node dist/server/server/index.js >>/tmp/iinpublic-relay-restart-server.log 2>&1 || exit $?
    restarts=$((restarts + 1))
    [[ "$restarts" -le 1 ]] && sleep 1
  done
) &
SUPERVISOR_PID=$!

CHATROOM_MAX_CAPACITY=50 CHATROOM_ENABLE_FIFO=false DISABLE_HMR=true PORT="$WEB_PORT" \
  npm run dev:web:e2e -- --port "$WEB_PORT" >/tmp/iinpublic-relay-restart-web.log 2>&1 &
WEB_PID=$!

for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${SERVER_PORT}/health" >/dev/null 2>&1 && break
  sleep 0.25
done
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1 && break
  sleep 0.25
done

E2E_REUSE_SERVERS=1 E2E_GUN_MEMORY_ONLY=1 DISABLE_HMR=true PW_WORKERS=1 \
  playwright test tests/e2e/talks-matching/08-relay-restart.spec.ts --project=chromium
