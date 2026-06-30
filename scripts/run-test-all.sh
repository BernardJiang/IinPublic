#!/usr/bin/env bash
#
# Unified `test:all` runner — single merged Playwright report, minimal overhead, and
# CONCURRENT phases so the wall clock approaches the (mostly idle) machine's real limit.
#
# Background (measured): the suite is ~83% idle (≈168% CPU on 10 cores) — it waits on Gun
# sync and timeouts, it does not compute. Run sequentially, the two big phases dominated:
# light=454s and mass=338s, back to back. The fix is to run independent phases AT THE SAME
# TIME on disjoint port bands (E2E_PORT_OFFSET) and to raise worker counts on the wait-bound
# phases. The fragile multi-browser specs are kept in their own low-contention wave.
#
# What it does:
#   - PARALLEL PREFIX : type-check, lint, jest and both builds run at once.
#   - BUILD ONCE      : server (tsc) + web (webpack dev mode) built one time up front.
#   - STATIC WEB      : each phase serves prebuilt dist/web (E2E_STATIC_WEB=1), no webpack reboot.
#   - CONCURRENT WAVES: phases in a wave run together on offsets 0/100/200/300 (own port band,
#                       own fresh Playwright-managed servers). Waves are sequenced so the
#                       timing-sensitive heavy-staged shard (it holds a 30s-budget chatbot
#                       spec) runs alone.
#
# Tunables (env): PW_WORKERS(light,14) MASS_WORKERS(4) STAGE5_WORKERS(3) PW_MESH_WORKERS(4)
#                 PW_HEAVY_WORKERS(2). If you hit memory pressure or flakiness, lower light
#                 and mass first. Per-phase wall times are printed at the end.
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; [ -f .env.local ] && . ./.env.local; set +a

LIGHT_WORKERS="${PW_WORKERS:-14}"
MASS_WORKERS="${MASS_WORKERS:-4}"
STAGE5_WORKERS="${STAGE5_WORKERS:-3}"
MESH_WORKERS="${PW_MESH_WORKERS:-4}"
HEAVY_WORKERS="${PW_HEAVY_WORKERS:-2}"

export E2E_BLOB=1
export E2E_STATIC_WEB=1
export E2E_GUN_MEMORY_ONLY=1
export DISABLE_HMR=true
export PLAYWRIGHT_HTML_OPEN=never

LOG_DIR="$(mktemp -d)"
echo "[test:all] phase logs: $LOG_DIR"
echo "[test:all] workers: light=$LIGHT_WORKERS mass=$MASS_WORKERS stage5=$STAGE5_WORKERS mesh=$MESH_WORKERS heavy=$HEAVY_WORKERS"
rm -rf blob-report blob-merged playwright-report
mkdir -p blob-merged
start=$(date +%s)

WAVE_PIDS=()
PHASE_ORDER=()
cleanup() {
  for pid in "${WAVE_PIDS[@]:-}"; do kill "$pid" 2>/dev/null; done
  wait 2>/dev/null
}
trap cleanup INT TERM

# Launch one phase in the background on its own port band. Records time + rc to $LOG_DIR.
#   start_phase <name> <port_offset> <env-and-command...>
start_phase() {
  local name="$1" offset="$2"; shift 2
  PHASE_ORDER+=("$name")
  echo "[test:all]   ▶ $name (offset $offset)"
  (
    local s; s=$(date +%s)
    E2E_PORT_OFFSET="$offset" "$@" >"$LOG_DIR/$name.log" 2>&1
    local rc=$?
    echo "$rc" >"$LOG_DIR/$name.rc"
    echo "$(( $(date +%s) - s ))" >"$LOG_DIR/$name.time"
  ) &
  WAVE_PIDS+=($!)
}

wait_wave() {
  local label="$1"
  echo "[test:all] wave '$label' running (${#WAVE_PIDS[@]} phases)…"
  for pid in "${WAVE_PIDS[@]}"; do wait "$pid"; done
  for name in "${PHASE_ORDER[@]}"; do
    local d rc b
    d=$(cat "$LOG_DIR/$name.time" 2>/dev/null || echo '?')
    rc=$(cat "$LOG_DIR/$name.rc" 2>/dev/null || echo '?')
    printf '[test:all]   ◀ %-20s %4ss  rc=%s\n' "$name" "$d" "$rc"
  done
  WAVE_PIDS=(); PHASE_ORDER=()
}

# ─────────────────────────────────────────────────────────────────────────────
# Phase 0: static checks + builds, in parallel.
# ─────────────────────────────────────────────────────────────────────────────
echo "[test:all] phase 0: type-check + lint + jest + builds (parallel)"
p0_start=$(date +%s)
npm run test:type    >"$LOG_DIR/type.log" 2>&1 & P_TYPE=$!
npm run lint         >"$LOG_DIR/lint.log" 2>&1 & P_LINT=$!
npx jest --forceExit >"$LOG_DIR/jest.log" 2>&1 & P_JEST=$!
npm run build:server >"$LOG_DIR/build-server.log" 2>&1 & P_BSRV=$!
DISABLE_HMR=true npx webpack --mode development --config webpack.config.js \
                     >"$LOG_DIR/build-web.log" 2>&1 & P_BWEB=$!
wait "$P_BSRV"; RC_BSRV=$?
wait "$P_BWEB"; RC_BWEB=$?
if [ "$RC_BSRV" -ne 0 ] || [ "$RC_BWEB" -ne 0 ]; then
  echo "[test:all] BUILD FAILED — cannot run E2E"
  echo "--- build-server.log ---"; cat "$LOG_DIR/build-server.log"
  echo "--- build-web.log ---";    cat "$LOG_DIR/build-web.log"; exit 1
fi
wait "$P_TYPE"; RC_TYPE=$?
wait "$P_LINT"; RC_LINT=$?
wait "$P_JEST"; RC_JEST=$?
p0_dur=$(( $(date +%s) - p0_start ))
echo "[test:all] phase 0 done in ${p0_dur}s (type=$RC_TYPE lint=$RC_LINT jest=$RC_JEST)"

# ─────────────────────────────────────────────────────────────────────────────
# Wave 1: the two heavyweights (light + mass) run together, plus stage5.
# Offsets keep them on separate port bands; each gets its own fresh servers.
# ─────────────────────────────────────────────────────────────────────────────
start_phase light 0 \
  env E2E_SKIP_HEAVY=1 PW_WORKERS="$LIGHT_WORKERS" npx playwright test
start_phase mass 100 \
  env E2E_SKIP_ALL_MESH=1 PW_WORKERS="$MASS_WORKERS" npx playwright test tests/e2e/mass
start_phase stage5 200 \
  env E2E_SKIP_FIND_SIMILAR=1 E2E_SKIP_ALL_MESH=1 PW_WORKERS="$STAGE5_WORKERS" \
    npx playwright test tests/e2e/staged/stage5-multi-user
wait_wave 1
RC_LIGHT=$(cat "$LOG_DIR/light.rc"); RC_MASS=$(cat "$LOG_DIR/mass.rc"); RC_S5=$(cat "$LOG_DIR/stage5.rc")

# ─────────────────────────────────────────────────────────────────────────────
# Wave 2: mesh phases + find-similar (lighter, multi-browser). Mesh-isolated specs
# manipulate the hub and must stay serial among themselves → one subshell at 1 worker.
# ─────────────────────────────────────────────────────────────────────────────
start_phase mesh-batch 0 \
  env PW_WORKERS="$MESH_WORKERS" npx playwright test \
    tests/e2e/talks-matching/01-mesh-ping-overlay.spec.ts \
    tests/e2e/talks-matching/03-mesh-response-match.spec.ts \
    tests/e2e/talks-matching/04-local-contacts.spec.ts \
    tests/e2e/talks-matching/05-mailbox-offline-response.spec.ts \
    tests/e2e/talks-matching/06-sender-suppression.spec.ts \
    tests/e2e/talks-matching/07-change-of-mind.spec.ts \
    tests/e2e/talks-matching/08-retraction.spec.ts \
    tests/e2e/talks-matching/09-exchange-suppression.spec.ts \
    tests/e2e/talks-matching/09-ipfs-auto-share.spec.ts
start_phase mesh-isolated 200 \
  bash -c '
    set -e
    base="tests/e2e/talks-matching"
    PW_WORKERS=1 npx playwright test "$base/06-mesh-ping-with-hub-api-down.spec.ts"
    PW_WORKERS=1 npx playwright test "$base/07-mesh-ping-after-hub-stop.spec.ts"
    PW_WORKERS=1 npx playwright test "$base/02-mesh-broadcast-announce.spec.ts" --grep "find-similar broadcast"
    PW_WORKERS=1 npx playwright test "$base/02-mesh-broadcast-announce.spec.ts" --grep "ipfs attachment"
  '
start_phase find-similar 300 \
  env PW_WORKERS=1 npx playwright test tests/e2e/staged/stage5-multi-user/find-similar-people.spec.ts
wait_wave 2
RC_MESH=$(cat "$LOG_DIR/mesh-batch.rc"); RC_MESHISO=$(cat "$LOG_DIR/mesh-isolated.rc"); RC_FS=$(cat "$LOG_DIR/find-similar.rc")

# ─────────────────────────────────────────────────────────────────────────────
# Wave 3: heavy-staged ALONE. It contains 09-four-types-chatbot (test.setTimeout(30_000)),
# a 3-browser flow that flakes under contention — give it the machine to itself.
# ─────────────────────────────────────────────────────────────────────────────
start_phase heavy-staged 0 \
  env E2E_SKIP_FIND_SIMILAR=1 E2E_SKIP_ALL_MESH=1 PW_WORKERS="$HEAVY_WORKERS" npx playwright test \
    tests/e2e/staged/stage4-four-user \
    tests/e2e/talks-matching \
    tests/e2e/staged/stage2-two-user/01-login-two-users-headcount.spec.ts \
    tests/e2e/staged/stage3-three-user/02-multi-user-headcount.spec.ts \
    tests/e2e/staged/stage3-three-user/09-four-types-chatbot.spec.ts
wait_wave 3
RC_HA=$(cat "$LOG_DIR/heavy-staged.rc")

# ─────────────────────────────────────────────────────────────────────────────
# Merge every phase's blob report into one combined HTML report.
# ─────────────────────────────────────────────────────────────────────────────
blob_count=$(ls blob-report/*/*.zip 2>/dev/null | wc -l | tr -d ' ')
cp blob-report/*/*.zip blob-merged/ 2>/dev/null
npx playwright merge-reports --reporter html blob-merged

end=$(date +%s); dur=$((end - start))
E2E_RC=$(( RC_LIGHT || RC_MASS || RC_S5 || RC_MESH || RC_MESHISO || RC_FS || RC_HA ))
PREFIX_RC=$(( RC_TYPE || RC_LINT || RC_JEST ))

phase_time() { cat "$LOG_DIR/$1.time" 2>/dev/null || echo '?'; }
echo ""
echo "[test:all] ───────────── per-phase wall time ─────────────"
printf '  %-26s %5ss  %s\n' "phase0 (build/lint/jest)" "$p0_dur" "type=$RC_TYPE lint=$RC_LINT jest=$RC_JEST"
printf '  %-26s %5ss  rc=%s   ┐ wave 1 (concurrent)\n' "light"  "$(phase_time light)"  "$RC_LIGHT"
printf '  %-26s %5ss  rc=%s   │\n'                      "mass"   "$(phase_time mass)"   "$RC_MASS"
printf '  %-26s %5ss  rc=%s   ┘\n'                      "stage5" "$(phase_time stage5)" "$RC_S5"
printf '  %-26s %5ss  rc=%s   ┐ wave 2 (concurrent)\n' "mesh-batch"    "$(phase_time mesh-batch)"    "$RC_MESH"
printf '  %-26s %5ss  rc=%s   │\n'                      "mesh-isolated" "$(phase_time mesh-isolated)" "$RC_MESHISO"
printf '  %-26s %5ss  rc=%s   ┘\n'                      "find-similar"  "$(phase_time find-similar)"  "$RC_FS"
printf '  %-26s %5ss  rc=%s   ─ wave 3 (solo)\n'        "heavy-staged"  "$(phase_time heavy-staged)"  "$RC_HA"
echo "[test:all] ───────────────────────────────────────────────"
printf "  blobs: %s  |  TOTAL %dm%ds  |  report: npx playwright show-report\n" \
  "$blob_count" $((dur / 60)) $((dur % 60))
[ "$PREFIX_RC" -ne 0 ] && echo "  (lint/type/jest failed — see $LOG_DIR/*.log)"
[ "$E2E_RC" -ne 0 ] && echo "  (an e2e phase failed — see $LOG_DIR/<phase>.log and the report)"

exit $(( PREFIX_RC || E2E_RC ))
