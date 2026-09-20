#!/usr/bin/env bash
set -euo pipefail

# Opt-in real host sleep. `pmset relative wake` is a one-shot, non-cancellable
# wake event measured from entry into sleep, so a lost test process cannot leave
# a repeating power schedule behind.

WAKE_AFTER_SECONDS="${MACOS_E2E_WAKE_AFTER_SECONDS:-30}"
MINIMUM_SLEEP_SECONDS="${MACOS_E2E_MINIMUM_SLEEP_SECONDS:-10}"

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
# If a power assertion prevented sleep, give the request time to take effect and
# then fail rather than claiming a display blink was a host sleep cycle.
sleep 2
finished_at="$(date +%s)"
elapsed=$(( finished_at - started_at ))
if (( elapsed < MINIMUM_SLEEP_SECONDS )); then
  echo "Host did not remain asleep long enough (elapsed=${elapsed}s)." >&2
  /usr/bin/pmset -g assertions >&2 || true
  exit 1
fi
printf 'SLEEP_WAKE_OK elapsed=%ss\n' "$elapsed"
