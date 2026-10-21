#!/usr/bin/env bash
set -euo pipefail

# OPEN-32 root-cause watcher: a DURABLE replacement for the bare SSH shell loop that silently
# died on 2026-09-25. Run by a systemd timer (docs/IinPublic_VPS_Installation_Guide.md, "Delegate
# roster watcher"). Each run appends one JSON line to the log: the delegate-grant and FAQ counts
# the live relay serves, whether the roster came from a fresh read or the OPEN-32 cache fallback
# (`X-IinPublic-Roster-Source`), and the relay process's RSS and uptime — so the next time the
# store reads back empty we can correlate it with uptime/memory instead of guessing.

cd "$(dirname "$0")/.."

BASE_URL="${IINPUBLIC_ROSTER_MONITOR_BASE_URL:-http://127.0.0.1:8080}"
LOG_FILE="${IINPUBLIC_ROSTER_MONITOR_LOG:-$(pwd)/delegate-roster-monitor.jsonl}"
SERVICE="${IINPUBLIC_ROSTER_MONITOR_SERVICE:-iinpublic}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

HEADERS="$(mktemp)"
trap 'rm -f "$HEADERS"' EXIT
set +e
GRANTS_BODY="$(curl -fsS --max-time 20 -D "$HEADERS" "$BASE_URL/api/support/delegate-grants")"
GRANTS_RC=$?
FAQ_BODY="$(curl -fsS --max-time 20 "$BASE_URL/api/support/faq-entries")"
FAQ_RC=$?
set -e
SOURCE="$(grep -i '^x-iinpublic-roster-source:' "$HEADERS" | tr -d '\r' | awk '{print $2}' || true)"

PID="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)"
RSS_KB=0
UPTIME_S=0
if [ -n "$PID" ] && [ "$PID" != "0" ] && [ -r "/proc/$PID/status" ]; then
  RSS_KB="$(awk '/^VmRSS:/ {print $2}' "/proc/$PID/status")"
  UPTIME_S="$(ps -o etimes= -p "$PID" | tr -d ' ')"
fi

GRANTS_BODY="$GRANTS_BODY" FAQ_BODY="$FAQ_BODY" node -e '
const parse = (text) => { try { return JSON.parse(text || "null"); } catch { return null; } };
const grants = parse(process.env.GRANTS_BODY);
const faq = parse(process.env.FAQ_BODY);
const faqCount = Array.isArray(faq) ? faq.length : Array.isArray(faq?.entries) ? faq.entries.length : null;
process.stdout.write(JSON.stringify({
  at: process.argv[1],
  grants: Array.isArray(grants?.grants) ? grants.grants.length : null,
  revocations: Array.isArray(grants?.revocations) ? grants.revocations.length : null,
  rosterSource: process.argv[2] || null,
  faqEntries: faqCount,
  grantsHttpOk: process.argv[3] === "0",
  faqHttpOk: process.argv[4] === "0",
  rssKb: Number(process.argv[5]) || 0,
  uptimeSeconds: Number(process.argv[6]) || 0,
}) + "\n");
' "$NOW" "$SOURCE" "$GRANTS_RC" "$FAQ_RC" "$RSS_KB" "$UPTIME_S" >> "$LOG_FILE"

# Bound the log (~30 days at one line every 2 minutes).
if [ "$(wc -l < "$LOG_FILE")" -gt 22000 ]; then
  tail -n 21600 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

tail -n 1 "$LOG_FILE"
if [ "$SOURCE" = "cache" ]; then
  echo "[monitor-delegate-roster] OPEN-32 empty read observed (served from cache)" >&2
fi
