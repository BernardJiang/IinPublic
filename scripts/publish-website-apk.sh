#!/usr/bin/env bash
#
# OPEN-115: the website offers Google Play's own signed APK, so a website install and a Play
# install are the same app with the same certificate and update each other (our keystore's APK and
# Google's re-signed copy could not replace each other, and uninstalling loses the phone's identity).
#
# After `npm run release` and the .aab upload: Play Console → Test and release → App bundle
# explorer → this version → Downloads → "Signed, universal APK". Then:
#
#   npm run release:website-apk -- <universal.apk> --dry-run   # checks only, nothing leaves this Mac
#   npm run release:website-apk -- <universal.apk>             # checks, then publishes to the website
#
# Needs PLAY_APP_SIGNING_CERT_SHA256 (env or .env.local): Play Console → Test and release → App
# integrity → App signing → "App signing key certificate", SHA-256 (colons are fine).
# The version must be package.json's (the release's); override with RELEASE_VERSION.
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die()  { printf '\033[31m[website-apk] FAILED: %s\033[0m\n' "$*" >&2; exit 1; }
say()  { printf '[website-apk] %s\n' "$*"; }

APK=""
DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -*) die "unknown option: $arg" ;;
    *) APK="$arg" ;;
  esac
done
[ -n "$APK" ] || die "usage: npm run release:website-apk -- <universal.apk> [--dry-run]"
[ -f "$APK" ] || die "no such file: $APK"

VERSION="${RELEASE_VERSION:-$(node -p 'require("./package.json").version')}"
VPS_HOST="${RELEASE_VPS_HOST:-ovh}"
VPS_DIR="${RELEASE_VPS_DIR:-IinPublic}"
SITE_URL="${RELEASE_SITE_URL:-https://iinpublic.com}"
if [ -z "${PLAY_APP_SIGNING_CERT_SHA256:-}" ] && [ -f .env.local ]; then
  PLAY_APP_SIGNING_CERT_SHA256="$(sed -n 's/^PLAY_APP_SIGNING_CERT_SHA256=//p' .env.local | tail -1 | tr -d "\"' ")"
fi
WANT="$(printf '%s' "${PLAY_APP_SIGNING_CERT_SHA256:-}" | tr -d ': ' | tr 'A-F' 'a-f')"
[ "${#WANT}" = 64 ] || die "set PLAY_APP_SIGNING_CERT_SHA256 (64 hex digits; Play Console → App integrity → App signing)"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
APKSIGNER="$(ls -d "$SDK"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
AAPT="$(ls -d "$SDK"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1)"
[ -x "$APKSIGNER" ] || die "apksigner not found under $SDK/build-tools"
[ -x "$AAPT" ] || die "aapt not found under $SDK/build-tools"

# 1. Google's certificate (not ours: that would bring the install conflict back).
if ! SIG="$("$APKSIGNER" verify --print-certs "$APK" 2>&1)"; then
  # Play adds a v3.2 hybrid post-quantum (ML-DSA) signer for SDK 37+; a JDK before 24 cannot read
  # it. Then verify what every device up to Android 16 checks, and say so.
  grep -q 'ML-DSA KeyFactory not available' <<<"$SIG" || die "signature not verified: $SIG"
  SIG="$("$APKSIGNER" verify --max-sdk-version 36 --print-certs "$APK" 2>&1)" \
    || die "signature not verified (up to SDK 36): $SIG"
  say "verified up to Android 16 (SDK 36); this JDK cannot check the SDK 37+ post-quantum signer"
fi
# "Signer #1 certificate SHA-256 digest:" or "V3.0 Signer: certificate SHA-256 digest:" by
# build-tools version; every app signer must be the one certificate. Play's "Source Stamp Signer"
# is Google's install-source stamp, not an app signer.
GOT="$(grep -v 'Source Stamp' <<<"$SIG" | sed -n 's/^.*[Ss]igner.*certificate SHA-256 digest: //p' | tr -d ': ' | tr 'A-F' 'a-f' | sort -u)"
[ -n "$GOT" ] || die "no signer certificate found: $SIG"
[ "$(wc -l <<<"$GOT" | tr -d ' ')" = 1 ] || die "more than one signer certificate: $GOT"
[ "$GOT" = "$WANT" ] || die "signed by $GOT, not the Play app signing key $WANT (is this our own release APK?)"
say "signed with the Play app signing key"

# 2. The right app and version.
BADGING="$("$AAPT" dump badging "$APK")"
PKG="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$BADGING")"
APK_VER="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$BADGING")"
[ "$PKG" = "com.iinpublic.app" ] || die "package is '$PKG', expected com.iinpublic.app"
[ "$APK_VER" = "$VERSION" ] || die "versionName '$APK_VER' != $VERSION"
say "com.iinpublic.app $APK_VER"

# 3. 16 KB pages, as for the .aab (a universal APK carries every ABI).
bash scripts/check-android-16kb.sh "$APK" || die "native libraries are not 16 KB page aligned"

NAME="IinPublic-$VERSION-android.apk"
if [ "$DRY" = 1 ]; then
  say "dry run: $APK would be published as $NAME; nothing was sent"
  exit 0
fi

# 4. Publish and check the website offers it.
scp -q "$APK" "$VPS_HOST:$VPS_DIR/public/downloads/$NAME"
ssh "$VPS_HOST" "cd ~/$VPS_DIR && node -e \"require('./scripts/lib/sha256sums').generateManifestForDir('public/downloads', 'SHA256SUMS')\""
body=""
for _ in $(seq 1 15); do
  body="$(ssh "$VPS_HOST" "curl -fsS $SITE_URL/api/downloads" 2>/dev/null || true)"
  if echo "$body" | grep -q "\"android\":\"[^\"]*$VERSION[^\"]*\.apk\""; then
    say "published: $SITE_URL offers $NAME (Play-signed)"
    exit 0
  fi
  sleep 4
done
die "/api/downloads does not offer the $VERSION APK (last: ${body:-none})"
