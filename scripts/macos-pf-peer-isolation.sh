#!/usr/bin/env bash
set -euo pipefail

# Hold a narrowly scoped macOS PF rule until stdin closes or receives one line.
# One browser peer uses 127.0.0.2 while ordinary local peers continue through
# 127.0.0.1. The stock macOS pf.conf already declares the com.apple/* anchor;
# this script never replaces or flushes the main ruleset.

TARGET_IP="${1:-}"
TARGET_PORT="${2:-}"
ANCHOR='com.apple/iinpublic_e2e'
PF_TOKEN=''

if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'macOS PF isolation requires Darwin' >&2
  exit 77
fi
if [[ ! "$TARGET_IP" =~ ^127\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Refusing non-loopback target: $TARGET_IP" >&2
  exit 64
fi
if [[ ! "$TARGET_PORT" =~ ^[0-9]+$ ]] || (( TARGET_PORT < 1 || TARGET_PORT > 65535 )); then
  echo "Invalid target port: $TARGET_PORT" >&2
  exit 64
fi
if ! sudo -n /sbin/pfctl -s info >/dev/null 2>&1; then
  echo 'Non-interactive sudo permission for /sbin/pfctl is required; no rules were changed.' >&2
  exit 77
fi

cleanup() {
  sudo -n /sbin/pfctl -a "$ANCHOR" -F rules >/dev/null 2>&1 || true
  if [[ -n "$PF_TOKEN" ]]; then
    sudo -n /sbin/pfctl -X "$PF_TOKEN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM HUP

enable_output="$(sudo -n /sbin/pfctl -E 2>&1)"
PF_TOKEN="$(printf '%s\n' "$enable_output" | sed -nE 's/.*Token[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' | tail -1)"
if [[ -z "$PF_TOKEN" ]]; then
  echo "PF enabled without a releasable reference token: $enable_output" >&2
  exit 1
fi

printf 'block drop quick on lo0 inet proto tcp from any to %s port %s\n' "$TARGET_IP" "$TARGET_PORT" \
  | sudo -n /sbin/pfctl -a "$ANCHOR" -f -
# Existing WebSocket state would otherwise bypass the new rule.
sudo -n /sbin/pfctl -k 0.0.0.0/0 -k "$TARGET_IP" >/dev/null

printf 'READY target=%s:%s\n' "$TARGET_IP" "$TARGET_PORT"
IFS= read -r _ || true
