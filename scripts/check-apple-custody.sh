#!/usr/bin/env bash
# OPEN-26: compile AppleCustodyBridge.swift for iOS, then drive its real message handler through the
# macOS login Keychain (describe/read/write/overwrite/remove and the refusals). The harness removes
# the item it writes. Needs Xcode (license accepted).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$ROOT/platforms/ios/IinPublic/AppleCustodyBridge.swift"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
xcrun -sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios15.0-simulator "$BRIDGE"
echo "[apple-custody] iOS type-check OK"
cp "$ROOT/platforms/ios/tests/AppleCustodyBridgeHarness.swift" "$OUT/main.swift"  # top-level code needs main.swift
xcrun swiftc -o "$OUT/custody-test" "$BRIDGE" "$OUT/main.swift"
"$OUT/custody-test"
