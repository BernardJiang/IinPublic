#!/bin/sh
set -e

echo "[xcframework] copying NodeMobile.xcframework..."
SRC="../../third_party/nodejs-mobile-v18.20.4/NodeMobile.xcframework"
DST="../Frameworks"

# The script runs from platforms/ios/scripts.
cd "$(dirname "$0")"

mkdir -p "$DST"
if [ ! -d "$SRC" ]; then
  echo "[xcframework] ERROR: $SRC not found!" >&2
  exit 1
fi

# Use rsync to avoid re-copying identical binary blobs
rsync -a --quiet "$SRC/" "$DST/NodeMobile.xcframework/"
echo "[xcframework] done"
