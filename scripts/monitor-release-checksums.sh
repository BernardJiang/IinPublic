#!/usr/bin/env bash
set -euo pipefail

# OPEN-30: always-on wrapper around `release:verify-checksums` for a periodic systemd timer
# (docs/IinPublic_VPS_Installation_Guide.md's "Release-checksum monitor" section installs this).
# The underlying script already has clean exit-code semantics (0 = every listed file matches,
# 1 = a mismatch/missing/unreachable file) — enough on its own for systemd to mark a run failed
# and for `journalctl -u iinpublic-checksum-monitor` to show it. This wrapper adds one more thing:
# a small on-disk status marker, so a mismatch is visible without needing journal/systemctl
# access — checked with `cat checksum-monitor-status.json` (or ask the operating session).

cd "$(dirname "$0")/.."

BASE_URL="${IINPUBLIC_CHECKSUM_MONITOR_BASE_URL:-https://www.iinpublic.com}"
STATUS_FILE="${IINPUBLIC_CHECKSUM_MONITOR_STATUS_FILE:-$(pwd)/checksum-monitor-status.json}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

set +e
OUTPUT="$(node scripts/verify-release-checksums.js --base-url "$BASE_URL" 2>&1)"
RC=$?
set -e

ESCAPED_OUTPUT="$(printf '%s' "$OUTPUT" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync(0,'utf8')))")"

if [ "$RC" -eq 0 ]; then
  printf '{"lastCheckAt":"%s","baseUrl":"%s","status":"ok"}\n' "$NOW" "$BASE_URL" > "$STATUS_FILE"
  echo "$OUTPUT"
else
  printf '{"lastCheckAt":"%s","baseUrl":"%s","status":"failed","output":%s}\n' \
    "$NOW" "$BASE_URL" "$ESCAPED_OUTPUT" > "$STATUS_FILE"
  echo "$OUTPUT" >&2
  echo "[monitor-release-checksums] FAILED — see $STATUS_FILE" >&2
fi

exit "$RC"
