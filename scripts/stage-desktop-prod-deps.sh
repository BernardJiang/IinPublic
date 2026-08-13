#!/usr/bin/env bash
# Stage a MINIMAL, runtime-only node_modules for desktop packaging.
#
# The compiled embedded server (dist/server, grepped directly for its own
# `require(...)` calls — the ground truth of what actually ships) only ever
# loads: bonjour-service, cors, express, gun (+ its gun/sea subpath), helmet,
# socket.io, uuid.
#
# `npm ci --omit=dev` alone is NOT enough to isolate that set: several of the
# 13 packages under root package.json's "dependencies" (bad-words,
# compromise, helia, multiformats, node-geocoder, rate-limiter-flexible,
# stream-browserify) turned out to be used only by src/web (webpack already
# inlines whatever they need into the browser bundle) or not used at all —
# `--omit=dev` still installs all of them since they're nominally
# "production" deps. Worse, `helia` transitively drags in
# `@libp2p/webrtc` -> `react-native-webrtc` -> `react-native` ->
# `hermes-compiler` / `fb-dotslash`: a whole React Native toolchain with
# prebuilt third-party binaries the embedded server never touches.
#
# Bundling that (previous electron-builder config: `from: "../../node_modules",
# filter: ["**/*"]`, no pruning at all) shipped ~1.1GB / ~60k files into the
# .app — almost certainly why macOS Gatekeeper flagged it and moved it to
# Trash ("notarization indicates this code has been revoked": one of those
# unrelated bundled binaries carries a notarization ticket Apple has since
# revoked). Pruning to just `dependencies` cut that to ~340MB but the
# hermes/react-native/fb-dotslash chain was still present via helia — this
# script installs ONLY the packages actually required(), each pinned to
# the same version range declared in the root package.json, so their own
# transitive trees resolve fresh without ever pulling helia in at all.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Wrapper dir holding just enough for `npm install` to run; the actual
# bundled resource is the node_modules/ it produces inside here.
STAGE_DIR="$ROOT_DIR/platforms/desktop/.prod-deps-staging"

RUNTIME_PACKAGES=(bonjour-service cors express gun helmet socket.io uuid)

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

python3 - "$ROOT_DIR/package.json" "$STAGE_DIR/package.json" "${RUNTIME_PACKAGES[@]}" <<'PYEOF'
import json, sys
root_pkg_path, out_path, *names = sys.argv[1:]
deps = json.load(open(root_pkg_path))["dependencies"]
staged = {
    "name": "iinpublic-desktop-runtime-deps",
    "version": "0.0.0",
    "private": True,
    "dependencies": {name: deps[name] for name in names},
}
json.dump(staged, open(out_path, "w"), indent=2)
PYEOF

echo "[stage-desktop-prod-deps] npm install (runtime-only) in $STAGE_DIR"
(cd "$STAGE_DIR" && npm install --omit=dev --no-audit --no-fund --no-package-lock)

echo "[stage-desktop-prod-deps] done: $(du -sh "$STAGE_DIR/node_modules" 2>/dev/null | cut -f1) ($(find "$STAGE_DIR/node_modules" -type f 2>/dev/null | wc -l | tr -d ' ') files)"
