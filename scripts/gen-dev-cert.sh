#!/usr/bin/env bash
#
# gen-dev-cert.sh — generate a self-signed TLS cert for LAN HTTPS development.
#
# Auto-detects this machine's LAN IP + hostname and bakes them into the cert's
# Subject Alternative Names (SAN) so browsers on other devices (phones, other
# PCs) can reach the dev servers over https://<lan-ip>:3001 / :8080 and get a
# valid secure context (required by Gun.js SEA / WebCrypto).
#
# Output:  certs/dev-key.pem  +  certs/dev-cert.pem
#
# Re-run this whenever the Mac's LAN IP changes (e.g. new network / DHCP lease).
#
# Usage:
#   ./scripts/gen-dev-cert.sh              # auto-detect LAN IP
#   LAN_IP=192.168.1.42 ./scripts/gen-dev-cert.sh   # force a specific IP
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/certs"
KEY_OUT="$CERT_DIR/dev-key.pem"
CERT_OUT="$CERT_DIR/dev-cert.pem"
DAYS=825

mkdir -p "$CERT_DIR"

# --- Detect LAN IP -----------------------------------------------------------
detect_lan_ip() {
  if [ -n "${LAN_IP:-}" ]; then echo "$LAN_IP"; return; fi
  # macOS: try the active Wi-Fi / Ethernet interfaces in order.
  if command -v ipconfig >/dev/null 2>&1; then
    for ifc in en0 en1 en2; do
      ip="$(ipconfig getifaddr "$ifc" 2>/dev/null || true)"
      [ -n "$ip" ] && { echo "$ip"; return; }
    done
  fi
  # Fallback: route-based detection (macOS + Linux).
  if command -v route >/dev/null 2>&1; then
    dev="$(route get default 2>/dev/null | awk '/interface:/{print $2}')"
    [ -n "$dev" ] && ipconfig getifaddr "$dev" 2>/dev/null && return
  fi
  # Linux fallback.
  if command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [ -n "$ip" ] && { echo "$ip"; return; }
  fi
  echo ""
}

LAN_IP_DETECTED="$(detect_lan_ip)"
if [ -z "$LAN_IP_DETECTED" ]; then
  echo "ERROR: could not detect a LAN IP. Re-run with LAN_IP=<your.ip> ./scripts/gen-dev-cert.sh" >&2
  exit 1
fi

# --- Detect hostname(s) ------------------------------------------------------
HOST_LOCAL=""
if command -v scutil >/dev/null 2>&1; then
  name="$(scutil --get LocalHostName 2>/dev/null || true)"
  [ -n "$name" ] && HOST_LOCAL="${name}.local"
fi
[ -z "$HOST_LOCAL" ] && HOST_LOCAL="$(hostname 2>/dev/null || echo localhost)"

echo "LAN IP:    $LAN_IP_DETECTED"
echo "Hostname:  $HOST_LOCAL"
echo "Output:    $CERT_OUT"

# --- Build an OpenSSL config with SAN ----------------------------------------
# Written as a temp config for portability across OpenSSL and macOS LibreSSL
# (LibreSSL lacks the -addext flag).
TMP_CNF="$(mktemp)"
trap 'rm -f "$TMP_CNF"' EXIT

cat > "$TMP_CNF" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_ext
prompt = no

[dn]
CN = IinPublic Dev ($LAN_IP_DETECTED)

[v3_ext]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = $HOST_LOCAL
IP.1 = 127.0.0.1
IP.2 = $LAN_IP_DETECTED
EOF

# --- Generate key + self-signed cert -----------------------------------------
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$KEY_OUT" \
  -out "$CERT_OUT" \
  -days "$DAYS" \
  -config "$TMP_CNF"

chmod 600 "$KEY_OUT"

echo
echo "✅ Cert generated (valid $DAYS days)."
echo "   Restart the dev servers (npm run dev) — they auto-detect certs/dev-*.pem."
echo "   From another device, first visit https://$LAN_IP_DETECTED:8080 and https://$LAN_IP_DETECTED:3001"
echo "   once and accept the self-signed warning for BOTH ports."
