#!/usr/bin/env bash
# Compatibility wrapper. The implementation is Node-based so Windows packaging
# does not depend on Bash or Python being installed.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT_DIR/scripts/stage-desktop-prod-deps.mjs"
