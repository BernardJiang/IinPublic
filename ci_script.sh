#!/usr/bin/env bash
set -euo pipefail

LOG=.ci-test.log
PW_WORKERS=4 npm run test:e2e >"$LOG" 2>&1 || true

codex exec --oss "
Read $LOG.
1. Identify the first real failing test or compiler error.
2. Ignore cascading failures.
3. Summarize the root cause in 5 bullets max.
4. Propose the smallest safe fix.
5. Suggest one regression test.
"