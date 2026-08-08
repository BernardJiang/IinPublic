#!/usr/bin/env bash
# Cross-platform mesh health check — run on macOS/Linux (see diagnose-local-node.ps1
# for Windows) against a running IinPublic app (desktop or dev) to answer, without
# hunting through raw logs: is this device actually talking to the shared hub?
#
# Usage: bash scripts/diagnose-local-node.sh [local-port] [hub-host:port]
#   local-port    default 8088 (desktop app default; use 8080 for `npm run dev:server`)
#   hub-host:port default 192.168.10.50:8080 — only used to check for an established
#                 TCP connection to it; adjust to your actual Mac mini's LAN IP.
set -euo pipefail

LOCAL_PORT="${1:-8088}"
HUB_HOST_PORT="${2:-192.168.10.50:8080}"
LOCAL_BASE="http://127.0.0.1:${LOCAL_PORT}"

echo "== IinPublic local-node diagnostic =="
echo "Checking ${LOCAL_BASE} ..."

if ! curl_out=$(curl -fsS --max-time 5 "${LOCAL_BASE}/api/debug/storage" 2>&1); then
  echo "❌ Local embedded node is not responding on port ${LOCAL_PORT}."
  echo "   Is the app running? Is this the right port (8088 desktop / 8080 dev:server)?"
  exit 1
fi
echo "✅ Local embedded node is up on port ${LOCAL_PORT}."

echo
echo "-- Chatroom membership (this device's own view) --"
if members=$(curl -fsS --max-time 5 "${LOCAL_BASE}/api/chatrooms/global/members" 2>&1); then
  echo "$members" | python3 -c "
import json, sys
try:
    rows = json.load(sys.stdin)
    for r in rows:
        print(f\"  - {r.get('stageName','?')} ({r.get('userId','?')})\")
    print(f'  Total: {len(rows)}')
except Exception as e:
    print('  (could not parse response)', e)
"
else
  echo "  (could not fetch — $members)"
fi

echo
echo "-- Live TCP connection to hub ${HUB_HOST_PORT} --"
HUB_HOST="${HUB_HOST_PORT%%:*}"
HUB_PORT="${HUB_HOST_PORT##*:}"
if lsof -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null | grep -q "${HUB_HOST}:${HUB_PORT}"; then
  echo "✅ An established TCP connection to ${HUB_HOST_PORT} exists somewhere on this machine."
  lsof -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null | grep "${HUB_HOST}:${HUB_PORT}" | awk '{print "  " $1, $9}'
else
  echo "❌ No established TCP connection to ${HUB_HOST_PORT} found."
  echo "   If membership above only shows yourself + TechSupport, this is almost"
  echo "   certainly why — the app isn't actually connected to the shared hub."
  echo "   Check: IINPUBLIC_HUB_GUN_URL points at the hub, IINPUBLIC_EMBEDDED_HUB_MODE=gun-peer"
  echo "   is set (explicit-http mode alone won't sync talks/mesh data), and the relay's"
  echo "   protocol (http/https) matches what you configured (no TLS_DISABLE mismatch)."
fi

echo
echo "-- Own public profile visible from the hub? --"
self_id=$(echo "$members" 2>/dev/null | python3 -c "
import json, sys
try:
    rows = json.load(sys.stdin)
    ids = [r['userId'] for r in rows if r.get('stageName') and r.get('userId') != 'iinpublic-root-techsupport']
    print(ids[0] if ids else '')
except Exception:
    print('')
" 2>/dev/null || echo "")
if [ -n "$self_id" ]; then
  if curl -fsS --max-time 5 "${LOCAL_BASE}/api/users/${self_id}?viewerId=${self_id}" >/dev/null 2>&1; then
    echo "✅ Own profile resolves locally (expected — this is always true regardless of hub state)."
  fi
  echo "   (Can't check the HUB's copy of your profile from here without hitting it directly —"
  echo "    if others can't see your name/avatar, re-save Settings → Profile to re-push it.)"
fi

echo
echo "== done =="
