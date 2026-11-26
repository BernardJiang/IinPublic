#!/usr/bin/env bash
set -euo pipefail

# Opt-in real host sleep. `pmset relative wake` is a one-shot, non-cancellable
# wake event measured from entry into sleep, so a lost test process cannot leave
# a repeating power schedule behind.

WAKE_AFTER_SECONDS="${MACOS_E2E_WAKE_AFTER_SECONDS:-30}"

if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'macOS sleep/wake requires Darwin' >&2
  exit 77
fi
if [[ ! "$WAKE_AFTER_SECONDS" =~ ^[0-9]+$ ]] || (( WAKE_AFTER_SECONDS < 20 || WAKE_AFTER_SECONDS > 180 )); then
  echo 'MACOS_E2E_WAKE_AFTER_SECONDS must be between 20 and 180' >&2
  exit 64
fi
if ! sudo -n /usr/bin/pmset -g >/dev/null 2>&1; then
  echo 'Non-interactive sudo permission for /usr/bin/pmset is required; sleep was not requested.' >&2
  exit 77
fi

started_at="$(date +%s)"
sudo -n /usr/bin/pmset relative wake "$WAKE_AFTER_SECONDS"
sudo -n /usr/bin/pmset sleepnow
# `sleepnow` returns before the host sleeps (about 3-5 s later). The power log is the proof: a
# "Sleep" entry and a later "Wake" entry, both at or after the request. (USB devices can wake the
# host early, so the sleep's length is reported, not required.)
since() {  # epoch seconds of the newest pmset log line of this kind at/after started_at, or empty
  /usr/bin/pmset -g log | awk -v kind="$1" '$4 == kind { print $1 " " $2 " " $3 }' | while read -r stamp; do
    t="$(date -j -f '%Y-%m-%d %H:%M:%S %z' "$stamp" +%s 2>/dev/null || true)"
    if [[ -n "$t" ]] && (( t >= started_at )); then echo "$t"; fi
  done | tail -1
}
slept_at=''; woke_at=''
for _ in $(seq 1 $(( WAKE_AFTER_SECONDS + 60 ))); do
  sleep 1
  slept_at="$(since Sleep)"
  [[ -n "$slept_at" ]] && woke_at="$(since Wake)"
  if [[ -n "$slept_at" && -n "$woke_at" ]] && (( woke_at >= slept_at )); then break; fi
  woke_at=''
done
elapsed=$(( $(date +%s) - started_at ))
if [[ -z "$woke_at" ]]; then
  echo "Host did not complete a sleep/wake cycle within ${elapsed}s (sleep=${slept_at:-none})." >&2
  /usr/bin/pmset -g assertions >&2 || true
  exit 1
fi
printf 'SLEEP_WAKE_OK slept=%ss elapsed=%ss\n' "$(( woke_at - slept_at ))" "$elapsed"
