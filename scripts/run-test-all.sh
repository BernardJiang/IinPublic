#!/usr/bin/env bash
#
# Unified `test:all` runner — single merged Playwright report, minimal overhead. Phases run
# SEQUENTIALLY by default (correctness first); set CONCURRENT_WAVES=1 on a machine you've
# verified can sustain it to let independent phases share the wall clock instead.
#
# Background (measured on one box): the suite is ~83% idle — it waits on Gun sync and
# timeouts, it does not compute — so running phases concurrently on disjoint port bands
# (E2E_PORT_OFFSET) can in principle approach the machine's real limit instead of running
# light=454s and mass=338s back to back. But "in principle" turned out to be machine-specific:
# on a real 14-core Mac mini, full concurrency caused flaky failures (Gun sync timeouts in
# mass/stage5, a single-page settings-render assertion in light, even the unrelated phase-0
# jest run) that all disappeared the moment waves ran sequentially. Detected core count alone
# doesn't predict whether a given machine can sustain this many concurrent Chromium + Node +
# WebRTC processes — so this defaults to sequential and treats concurrency as an explicit,
# per-machine opt-in (see CONCURRENT_WAVES below) rather than a default to guess at.
#
# What it does:
#   - PARALLEL PREFIX : type-check, lint, jest and both builds run at once.
#   - BUILD ONCE      : server (tsc) + web (webpack dev mode) built one time up front.
#   - STATIC WEB      : each phase serves prebuilt dist/web (E2E_STATIC_WEB=1), no webpack reboot.
#   - WAVES           : phases in a wave run on offsets 0/100/200/300 (own port band, own fresh
#                       Playwright-managed servers) — together if CONCURRENT_WAVES=1, one at a
#                       time otherwise. Waves are sequenced so the timing-sensitive heavy-staged
#                       shard (it holds a 30s-budget chatbot spec) always runs alone.
#
# Tunables (env): PW_WORKERS(light,8) MASS_WORKERS(4) STAGE5_WORKERS(3) PW_MESH_WORKERS(4)
#                 PW_HEAVY_WORKERS(1) — auto-scaled to the detected core count when unset
#                 (they only ever scale down, never above their tuned baseline — see
#                 scale_down_only() below). CONCURRENT_WAVES(1/0, default 1) forces whether
#                 phases within wave 1 / wave 2 run together or one-at-a-time. If you hit
#                 memory pressure or flakiness with CONCURRENT_WAVES=1, drop back to 0 before
#                 lowering worker counts. Per-phase wall times are printed at the end.
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a; [ -f .env.local ] && . ./.env.local; set +a

# Defaults below (6/4/3/4/2) were tuned for correctness on the current staged E2E suite.
# The broad "light" shard contains many stateful staged specs and is not safe at HIGH worker
# counts: at 8+ workers it can fail on shared-room headcounts, contact replication, and
# timing-sensitive direct-P2P waits even when the same specs pass in isolation. It runs at 6
# workers by default (the same tuned default as test:e2e:parallel); explicit env vars
# (PW_WORKERS, MASS_WORKERS, etc.) always win.
detect_cores() {
  if command -v sysctl >/dev/null 2>&1 && sysctl -n hw.ncpu >/dev/null 2>&1; then
    sysctl -n hw.ncpu
  elif command -v nproc >/dev/null 2>&1; then
    nproc
  else
    echo 8
  fi
}
CORES="$(detect_cores)"
# scale <value-tuned-for-10-cores> -> ceil(value * CORES / 10), floor 1. Identity at 10 cores.
scale() {
  local v=$(( ($1 * CORES + 9) / 10 ))
  [ "$v" -lt 1 ] && v=1
  echo "$v"
}
# scale_down_only: like scale(), but never exceeds the tuned baseline. Use for phases whose
# per-worker cost is already heavy and roughly fixed (mass/stage5 each launch up to ~12 of
# their own Chromium processes inside ONE worker's test) — more cores let the *machine* do
# more, but they don't make any single one of those heavy tests cheaper, and running MORE of
# them concurrently just stacks additional simultaneous WebRTC/mesh-formation load instead of
# adding real throughput. So these phases only ever scale down (weaker box) never up.
scale_down_only() {
  local scaled; scaled="$(scale "$1")"
  if [ "$scaled" -lt "$1" ]; then echo "$scaled"; else echo "$1"; fi
}

# Light shard default: 10 workers (speed plan Part 4 step 2). Each worker gets fully
# isolated servers on its own port pair, so parallelism is safe. The historical 8-worker
# ceiling was set by an unstable-click flake class in the incoming-talk helpers (clicks
# lost to Gun-sync re-renders) that is fixed as of 2026-07-16 — the helpers now trigger
# the delegated mousedown handler directly. If light starts flaking on shared-room
# headcounts or contact replication, drop back with PW_WORKERS=8 (light sum is ~58 min
# of test-time; wall ≈ sum/workers, so 10 workers ≈ 6.4 min vs 8 workers ≈ 8 min).
LIGHT_WORKERS="${PW_WORKERS:-$(scale_down_only 10)}"
# mass at 1 worker: each mass spec spawns 8-12 Chromium profiles INSIDE one worker's test —
# even 2 workers means 22 simultaneous browsers (M2's 12 beside M1's 10), and with polls
# capped at 60s (policy: no timeout over one minute, no retries) M2 measured 10/11 exchanges
# at 2 workers vs deterministic passes when the phase truly has the machine alone. One spec
# at a time caps the peak at 12 browsers on this hardware; the phase wall-clock barely moves
# because the two long specs dominate either way (~9min both configurations).
MASS_WORKERS="${MASS_WORKERS:-1}"
STAGE5_WORKERS="${STAGE5_WORKERS:-$(scale_down_only 3)}"
# mesh-batch: back to its tuned baseline of 4 workers. Measured evidence from two full runs
# at 1 worker: the phase took ~13 min instead of ~3 and failed the SAME specs it fails at 4
# workers (04-local-contacts, 09-ipfs-auto-share are real bugs, not parallelism flakes) —
# single-worker bought no reliability, only wall-clock. heavy-staged stays single-worker:
# it holds the timing-budgeted chatbot spec and the stage4 ghost-membership headcounts that
# demonstrably do flake under any concurrency.
MESH_WORKERS="${PW_MESH_WORKERS:-$(scale_down_only 4)}"
HEAVY_WORKERS="${PW_HEAVY_WORKERS:-1}"

# Waves run their phases CONCURRENTLY by default (each phase on its own port band with its
# own servers): sequential phases measured 36+ minutes wall clock on a 14-core machine while
# CPU sat under 10% — the suite is dominated by sync-waits, not compute. The earlier
# sequential-only default came from a flaky full-concurrency experiment, but that experiment
# ran with much higher per-phase worker counts (light=20, mesh=6, heavy=3) AND phase-0
# jest/builds in parallel with e2e; today's tuned counts (light≤8 + mass 4 + stage5 3 in
# wave 1; mesh 4 + two single-worker phases in wave 2; heavy alone in wave 3) are a far
# lighter simultaneous load. If Gun-sync flakes reappear on a weaker machine, set
# CONCURRENT_WAVES=0 to restore strictly sequential phases before touching worker counts.
if [ -z "${CONCURRENT_WAVES:-}" ]; then
  CONCURRENT_WAVES=1
fi

export E2E_BLOB=1
export E2E_STATIC_WEB=1
export E2E_GUN_MEMORY_ONLY=1
export DISABLE_HMR=true
export PLAYWRIGHT_HTML_OPEN=never

# ─────────────────────────────────────────────────────────────────────────────
# Run identity. Every playwright invocation this script spawns writes its blob under
# blob-report/$E2E_RUN_ID/ (see playwright.config.ts), and ONLY that directory is merged at
# the end. A hung playwright process from a previous run writes its blob when it finally
# exits — outside this run's namespace, so it can never contaminate this run's merge.
# ─────────────────────────────────────────────────────────────────────────────
E2E_RUN_ID="run-$(date +%Y%m%d-%H%M%S)-$$"
export E2E_RUN_ID
RUN_BLOB_DIR="blob-report/$E2E_RUN_ID"

# ─────────────────────────────────────────────────────────────────────────────
# Concurrency guard. Two test:all invocations running at once clobber each other's
# blob-report/, blob-merged/ and playwright-report/ (each starts with rm -rf) and fight for
# the same ports — observed to produce phases that fail with "port already used", a merged
# report built from another run's stale blobs, and a deleted playwright-report/ at the end.
# ─────────────────────────────────────────────────────────────────────────────
LOCK_DIR="$ROOT/.test-all.lock"
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" >"$LOCK_DIR/pid"
    return 0
  fi
  local other; other="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo '')"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
    echo "[test:all] ABORT: another test:all is already running (pid $other)."
    echo "[test:all]   Concurrent invocations destroy each other's reports and servers."
    echo "[test:all]   Wait for it to finish, or stop it with: kill $other"
    exit 1
  fi
  echo "[test:all] removing stale lock ($LOCK_DIR, pid ${other:-?} no longer running)"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null && echo "$$" >"$LOCK_DIR/pid"
}
acquire_lock
release_lock() { rm -rf "$LOCK_DIR"; }
trap 'release_lock' EXIT

# ─────────────────────────────────────────────────────────────────────────────
# Port preflight. Playwright refuses to start a webServer whose port is taken
# (reuseExistingServer=false, deliberately — a reused dev server has the wrong env vars).
# A leftover dev server (npm run dev / dev:multi) or a previous run's stray servers make
# entire phases fail with 0 tests. Fail fast here, naming the offenders, instead of letting
# 7 phases each discover it the slow way.
# ─────────────────────────────────────────────────────────────────────────────
preflight_ports() {
  command -v lsof >/dev/null 2>&1 || return 0
  local band0=$LIGHT_WORKERS
  [ "$MESH_WORKERS"  -gt "$band0" ] && band0=$MESH_WORKERS
  [ "$HEAVY_WORKERS" -gt "$band0" ] && band0=$HEAVY_WORKERS
  local ports=() spec off n i
  for spec in "0:$band0" "100:$MASS_WORKERS" "200:$STAGE5_WORKERS" "300:1"; do
    off="${spec%%:*}"; n="${spec##*:}"
    for (( i=0; i<n; i++ )); do ports+=( $((8080+off+i)) $((3001+off+i)) ); done
  done
  local listeners busy=""
  listeners="$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || true)"
  local p
  for p in "${ports[@]}"; do
    if printf '%s\n' "$listeners" | grep -q ":$p (LISTEN)"; then busy="$busy $p"; fi
  done
  [ -z "$busy" ] && return 0
  echo "[test:all] ABORT: E2E ports already in use:$busy"
  printf '%s\n' "$listeners" | while IFS= read -r line; do
    for p in $busy; do
      case "$line" in *":$p (LISTEN)"*) echo "  $line";; esac
    done
  done | sort -u
  echo "[test:all]   Likely a running dev server (npm run dev / dev:multi) or leftovers from a"
  echo "[test:all]   previous/hung test run. Stop them and re-run, e.g.:"
  echo "[test:all]     kill \$(lsof -tnP -iTCP:8080 -sTCP:LISTEN)"
  exit 1
}
preflight_ports

LOG_DIR="$(mktemp -d)"
echo "[test:all] run id: $E2E_RUN_ID"
echo "[test:all] phase logs: $LOG_DIR"
echo "[test:all] detected cores: $CORES (defaults scale from a 10-core tuning baseline; concurrent waves=$CONCURRENT_WAVES)"
echo "[test:all] workers: light=$LIGHT_WORKERS mass=$MASS_WORKERS stage5=$STAGE5_WORKERS mesh=$MESH_WORKERS heavy=$HEAVY_WORKERS"
# Old completed runs' blobs are dead weight; this run reads only $RUN_BLOB_DIR.
rm -rf blob-report blob-merged playwright-report
mkdir -p blob-merged "$RUN_BLOB_DIR"
start=$(date +%s)

WAVE_PIDS=()
PHASE_ORDER=()
cleanup() {
  [ -n "${HB_PID:-}" ] && kill "$HB_PID" 2>/dev/null
  for pid in "${WAVE_PIDS[@]:-}"; do kill "$pid" 2>/dev/null; done
  wait 2>/dev/null
}
on_interrupt() {
  cleanup
  local zips; zips=$(ls "$RUN_BLOB_DIR"/*/*.zip 2>/dev/null | wc -l | tr -d ' ')
  if [ "${zips:-0}" -gt 0 ]; then
    echo "[test:all] interrupted — $zips completed-phase blob(s) kept at $RUN_BLOB_DIR"
    echo "[test:all]   merge them manually with:"
    echo "[test:all]   cp $RUN_BLOB_DIR/*/*.zip blob-merged/ && node_modules/.bin/playwright merge-reports --reporter html blob-merged"
  fi
  exit 130
}
trap 'on_interrupt' INT TERM

# Launch one phase in the background on its own port band. Records time + rc to $LOG_DIR.
#   start_phase <name> <port_offset> <env-and-command...>
start_phase() {
  local name="$1" offset="$2"; shift 2
  PHASE_ORDER+=("$name")
  echo "[test:all]   ▶ $name (offset $offset)"
  (
    local s; s=$(date +%s)
    echo "$s" >"$LOG_DIR/$name.start"
    E2E_PORT_OFFSET="$offset" "$@" >"$LOG_DIR/$name.log" 2>&1
    local rc=$?
    echo "$rc" >"$LOG_DIR/$name.rc"
    echo "$(( $(date +%s) - s ))" >"$LOG_DIR/$name.time"
  ) &
  WAVE_PIDS+=($!)
}

HB_PID=""
wait_wave() {
  local label="$1"
  echo "[test:all] wave '$label' running (${#WAVE_PIDS[@]} phases)…"
  # Heartbeat: phases write only to their log files, so without this the terminal is silent
  # for many minutes and a long serial phase looks hung. Every 60s print, per still-running
  # phase, its elapsed time and the most recent log line (the config adds a 'list' reporter
  # next to the blob reporter under E2E_BLOB so logs carry per-test progress lines).
  (
    while sleep 60; do
      for name in "${PHASE_ORDER[@]}"; do
        [ -f "$LOG_DIR/$name.rc" ] && continue
        ps=$(cat "$LOG_DIR/$name.start" 2>/dev/null || echo 0)
        last="$(tail -c 4000 "$LOG_DIR/$name.log" 2>/dev/null | grep -E '\S' | tail -1 | tr -d '\r' | cut -c1-110)"
        echo "[test:all]     … $name ($(( $(date +%s) - ps ))s): ${last:-starting servers}"
      done
    done
  ) &
  HB_PID=$!
  for pid in "${WAVE_PIDS[@]}"; do wait "$pid"; done
  kill "$HB_PID" 2>/dev/null; wait "$HB_PID" 2>/dev/null; HB_PID=""
  for name in "${PHASE_ORDER[@]}"; do
    local d rc b
    d=$(cat "$LOG_DIR/$name.time" 2>/dev/null || echo '?')
    rc=$(cat "$LOG_DIR/$name.rc" 2>/dev/null || echo '?')
    printf '[test:all]   ◀ %-20s %4ss  rc=%s\n' "$name" "$d" "$rc"
  done
  WAVE_PIDS=(); PHASE_ORDER=()
}

# Call between start_phase invocations within a wave: waits for the just-started phase
# immediately when CONCURRENT_WAVES=0 (so phases in that wave run one at a time instead of
# together), otherwise a no-op (phase stays queued for the wave's normal concurrent wait_wave).
maybe_wait() {
  [ "$CONCURRENT_WAVES" = "1" ] || wait_wave "$1"
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
maybe_wait 1
start_phase stage5 200 \
  env E2E_SKIP_FIND_SIMILAR=1 E2E_SKIP_ALL_MESH=1 PW_WORKERS="$STAGE5_WORKERS" \
    npx playwright test tests/e2e/staged/stage5-multi-user
wait_wave 1
RC_LIGHT=$(cat "$LOG_DIR/light.rc"); RC_S5=$(cat "$LOG_DIR/stage5.rc")

# ─────────────────────────────────────────────────────────────────────────────
# Wave 2: mesh phases + find-similar (lighter, multi-browser), PLUS the two
# single-worker tail phases (isolated, heavy-staged) folded in on their own port
# bands (speed plan Part 4 step 3). Rationale: the mesh phases finish in ~60-80s,
# after which isolated/heavy-staged have the machine essentially to themselves for
# their remaining runtime — approximating their old solo condition while removing
# ~340s of serial tail. heavy-staged runs its specs at 1 worker in file order, so
# its contention-sensitive chatbot spec lands well after the mesh phases are done.
# Set TEST_ALL_SEQUENTIAL_TAIL=1 to restore the old strictly-serial tail if this
# machine flakes under the overlap.
# ─────────────────────────────────────────────────────────────────────────────
SEQUENTIAL_TAIL="${TEST_ALL_SEQUENTIAL_TAIL:-0}"
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
maybe_wait 2
start_phase mesh-isolated 200 \
  bash -c '
    set -e
    base="tests/e2e/talks-matching"
    PW_WORKERS=1 npx playwright test "$base/06-mesh-ping-with-hub-api-down.spec.ts"
    PW_WORKERS=1 npx playwright test "$base/07-mesh-ping-after-hub-stop.spec.ts"
    PW_WORKERS=1 npx playwright test "$base/02-mesh-broadcast-announce.spec.ts" --grep "find-similar broadcast"
    PW_WORKERS=1 npx playwright test "$base/02-mesh-broadcast-announce.spec.ts" --grep "ipfs attachment"
  '
maybe_wait 2
start_phase find-similar 300 \
  env PW_WORKERS=1 npx playwright test tests/e2e/staged/stage5-multi-user/find-similar-people.spec.ts
if [ "$SEQUENTIAL_TAIL" != "1" ]; then
  maybe_wait 2
  start_phase isolated 100 \
    env E2E_RUN_ISOLATED=1 E2E_SKIP_ALL_MESH=1 PW_WORKERS=1 npx playwright test tests/e2e/isolated
  maybe_wait 2
  start_phase heavy-staged 400 \
    env E2E_SKIP_FIND_SIMILAR=1 E2E_SKIP_ALL_MESH=1 PW_WORKERS="$HEAVY_WORKERS" npx playwright test \
      tests/e2e/staged/stage4-four-user \
      tests/e2e/staged/stage2-two-user/01-login-two-users-headcount.spec.ts \
      tests/e2e/staged/stage3-three-user/02-multi-user-headcount.spec.ts \
      tests/e2e/staged/stage3-three-user/09-four-types-chatbot.spec.ts
fi
wait_wave 2
RC_MESH=$(cat "$LOG_DIR/mesh-batch.rc"); RC_MESHISO=$(cat "$LOG_DIR/mesh-isolated.rc"); RC_FS=$(cat "$LOG_DIR/find-similar.rc")
if [ "$SEQUENTIAL_TAIL" != "1" ]; then
  RC_ISO=$(cat "$LOG_DIR/isolated.rc"); RC_HA=$(cat "$LOG_DIR/heavy-staged.rc")
fi

# ─────────────────────────────────────────────────────────────────────────────
# Wave 3: mass ALONE. Its specs each launch 8-12 Chromium profiles; every failure mode
# observed across ten full runs (lost exchanges, mesh signaling 400 loops, key-publication
# lag) was latency-class and vanished whenever the phase had the machine to itself —
# measured twice passing solo at the exact same settings that failed in shared waves. This
# is a hardware ceiling, not a code path: fit the workload to the machine.
# ─────────────────────────────────────────────────────────────────────────────
start_phase mass 100 \
  env E2E_SKIP_ALL_MESH=1 PW_WORKERS="$MASS_WORKERS" npx playwright test tests/e2e/mass
wait_wave 3
RC_MASS=$(cat "$LOG_DIR/mass.rc")

# ─────────────────────────────────────────────────────────────────────────────
# Sequential tail (TEST_ALL_SEQUENTIAL_TAIL=1 only): the pre-Part-4 behavior — the
# two machine-sensitive isolated specs, then heavy-staged, each with the machine to
# itself. Default runs fold both into wave 2 above.
# ─────────────────────────────────────────────────────────────────────────────
if [ "$SEQUENTIAL_TAIL" = "1" ]; then
  start_phase isolated 100 \
    env E2E_RUN_ISOLATED=1 E2E_SKIP_ALL_MESH=1 PW_WORKERS=1 npx playwright test tests/e2e/isolated
  wait_wave 3
  RC_ISO=$(cat "$LOG_DIR/isolated.rc")

  start_phase heavy-staged 0 \
    env E2E_SKIP_FIND_SIMILAR=1 E2E_SKIP_ALL_MESH=1 PW_WORKERS="$HEAVY_WORKERS" npx playwright test \
      tests/e2e/staged/stage4-four-user \
      tests/e2e/staged/stage2-two-user/01-login-two-users-headcount.spec.ts \
      tests/e2e/staged/stage3-three-user/02-multi-user-headcount.spec.ts \
      tests/e2e/staged/stage3-three-user/09-four-types-chatbot.spec.ts
  wait_wave 3
  RC_HA=$(cat "$LOG_DIR/heavy-staged.rc")
fi

# ─────────────────────────────────────────────────────────────────────────────
# Merge every phase's blob report into one combined HTML report.
# ─────────────────────────────────────────────────────────────────────────────
# Merge ONLY this run's blobs ($RUN_BLOB_DIR) — never whatever else may have accumulated in
# blob-report/ (stale runs, late-writing hung processes). cp errors are deliberately visible.
blob_count=$(ls "$RUN_BLOB_DIR"/*/*.zip 2>/dev/null | wc -l | tr -d ' ')
cp "$RUN_BLOB_DIR"/*/*.zip blob-merged/
merged_zip_count=$(ls blob-merged/*.zip 2>/dev/null | wc -l | tr -d ' ')
if [ "$merged_zip_count" != "$blob_count" ]; then
  echo "[test:all] WARNING: $blob_count blob(s) produced but $merged_zip_count copied to blob-merged/ — report may be incomplete."
fi
# Compute the real wall-clock total now (before merging) so it's available to patch into the
# report below — see the merge-reports "Total time" note there for why that's needed.
end=$(date +%s); dur=$((end - start))
# Call the local binary directly rather than `npx playwright` — npx adds a package-resolution
# step on every invocation (registry/version lookup) that plain node_modules/.bin does not,
# and running this right after an 11+ minute run with many just-exited Chromium processes is
# exactly the kind of moment where that extra step is most likely to misbehave.
PLAYWRIGHT_BIN="$ROOT/node_modules/.bin/playwright"
[ -x "$PLAYWRIGHT_BIN" ] || PLAYWRIGHT_BIN="npx playwright"

# merge-reports silently dies under Node majors newer than Playwright's support matrix
# (observed on Node 26.4 with Playwright 1.57: prints one "extracting:" line, exits without
# writing playwright-report/, sometimes with rc=0). Tests themselves run fine — only the
# merge is affected. Resolution order when the default node is too new: a supported major
# (18–24) from Homebrew/nvm, else a portable Node 22 downloaded ONCE into .cache/node-merge/
# and reused for every future merge — so the combined report works with zero manual setup.
NODE_COMPAT_VERSION="v22.22.3"
ensure_compat_node() {
  local m c
  for m in 24 22 20 18; do
    for c in "/opt/homebrew/opt/node@$m/bin/node" "/usr/local/opt/node@$m/bin/node"; do
      [ -x "$c" ] && { echo "$c"; return 0; }
    done
    c="$(ls -d "$HOME/.nvm/versions/node/v$m."*/bin/node 2>/dev/null | tail -1)"
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done
  local cache="$ROOT/.cache/node-merge/$NODE_COMPAT_VERSION"
  local bin="$cache/bin/node"
  if [ ! -x "$bin" ]; then
    local os arch
    case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) return 1 ;; esac
    case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64) arch=x64 ;; *) return 1 ;; esac
    echo "[test:all] downloading portable Node $NODE_COMPAT_VERSION ($os-$arch) for merge-reports (one-time, ~50MB)…" >&2
    mkdir -p "$cache"
    if ! curl -fsSL "https://nodejs.org/dist/$NODE_COMPAT_VERSION/node-$NODE_COMPAT_VERSION-$os-$arch.tar.gz" \
      | tar -xz -C "$cache" --strip-components=1; then
      rm -rf "$cache"
      return 1
    fi
  fi
  [ -x "$bin" ] && "$bin" --version >/dev/null 2>&1 && echo "$bin"
}
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -gt 24 ] 2>/dev/null; then
  COMPAT_NODE="$(ensure_compat_node || true)"
  if [ -n "${COMPAT_NODE:-}" ]; then
    echo "[test:all] node $NODE_MAJOR breaks 'playwright merge-reports' (supported: 18-24) — merging with $COMPAT_NODE"
    PLAYWRIGHT_BIN="$COMPAT_NODE $ROOT/node_modules/playwright/cli.js"
  else
    echo "[test:all] WARNING: node $NODE_MAJOR may silently break 'playwright merge-reports' (supported: 18-24)"
    echo "[test:all]   and no compatible node could be found or downloaded. If the merge fails below,"
    echo "[test:all]   install one (e.g. 'brew install node@22') and re-run:"
    echo "[test:all]   /opt/homebrew/opt/node@22/bin/node $ROOT/node_modules/playwright/cli.js merge-reports --reporter html blob-merged"
  fi
fi
echo "[test:all] merging $merged_zip_count blob(s) with: $PLAYWRIGHT_BIN ($($PLAYWRIGHT_BIN --version 2>/dev/null))"
# Success requires BOTH a zero exit code AND an actual index.html on disk — merge-reports has
# been observed to exit 0 without producing a report (e.g. when fed a stale/foreign blob),
# which previously made this script print a success message for a report that didn't exist.
if [ "$merged_zip_count" -gt 0 ] \
  && $PLAYWRIGHT_BIN merge-reports --reporter html blob-merged \
  && [ -s "$ROOT/playwright-report/index.html" ]; then
  MERGE_RC=0
  echo "[test:all] HTML report: $ROOT/playwright-report/index.html (open with: npx playwright show-report)"
  # `merge-reports` computes "Total time" as max(per-phase duration) — correct for true
  # parallel shards, meaningless for test:all's sequential heterogeneous phases (it just shows
  # the single longest phase). No CLI/config override exists for this (hardcoded in
  # node_modules/playwright/lib/reporters/merge.js, mergeEndEvents). Patch the report's
  # embedded stats with the real total this script already knows authoritatively; failure here
  # is cosmetic-only and must never fail the run.
  node "$ROOT/scripts/patch-report-total-time.js" "$ROOT/playwright-report/index.html" "${start}000" "$((dur * 1000))" \
    || echo "[test:all]   (cosmetic: could not patch the report's Total time field — pass/fail counts are unaffected)"
else
  MERGE_RC=1
  if [ "$merged_zip_count" -eq 0 ]; then
    echo "[test:all] ERROR: no blob reports were produced by any phase — nothing to merge."
    echo "[test:all]   Check the per-phase logs in $LOG_DIR (phases that can't bind their ports"
    echo "[test:all]   or crash before running tests write no blob)."
  elif [ ! -s "$ROOT/playwright-report/index.html" ]; then
    echo "[test:all] ERROR: merge-reports did not produce $ROOT/playwright-report/index.html."
    echo "[test:all]   The raw per-phase blobs are still at $ROOT/blob-merged/*.zip — retry manually with:"
    echo "[test:all]   $ROOT/node_modules/.bin/playwright merge-reports --reporter html blob-merged"
  else
    echo "[test:all] ERROR: merge-reports failed — no usable playwright-report/ was generated."
    echo "[test:all]   Retry manually with:"
    echo "[test:all]   $ROOT/node_modules/.bin/playwright merge-reports --reporter html blob-merged"
  fi
fi

# Preserve failing phases' logs inside the repo (the mktemp dir is easy to lose and gets
# cleaned by the OS): test-logs/<phase>.log survives for post-mortem, including the full
# browser console when E2E_VERBOSE_CONSOLE=1 is exported for the run.
mkdir -p "$ROOT/test-logs"
for name in light mass isolated stage5 mesh-batch mesh-isolated find-similar heavy-staged; do
  rc="$(cat "$LOG_DIR/$name.rc" 2>/dev/null || echo '')"
  if [ -n "$rc" ] && [ "$rc" != "0" ] && [ -f "$LOG_DIR/$name.log" ]; then
    cp "$LOG_DIR/$name.log" "$ROOT/test-logs/$name.log"
    echo "[test:all] preserved failing phase log: test-logs/$name.log"
  fi
done

E2E_RC=$(( RC_LIGHT || RC_MASS || RC_ISO || RC_S5 || RC_MESH || RC_MESHISO || RC_FS || RC_HA ))
PREFIX_RC=$(( RC_TYPE || RC_LINT || RC_JEST ))

phase_time() { cat "$LOG_DIR/$1.time" 2>/dev/null || echo '?'; }
wave_label() { [ "$CONCURRENT_WAVES" = "1" ] && echo "concurrent" || echo "sequential"; }
echo ""
echo "[test:all] ───────────── per-phase wall time ─────────────"
printf '  %-26s %5ss  %s\n' "phase0 (build/lint/jest)" "$p0_dur" "type=$RC_TYPE lint=$RC_LINT jest=$RC_JEST"
printf '  %-26s %5ss  rc=%s   ┐ wave 1 (%s)\n' "light"  "$(phase_time light)"  "$RC_LIGHT" "$(wave_label)"
printf '  %-26s %5ss  rc=%s   ┘\n'                      "stage5" "$(phase_time stage5)" "$RC_S5"
if [ "$SEQUENTIAL_TAIL" != "1" ]; then
  printf '  %-26s %5ss  rc=%s   ┐ wave 2 (%s, tail folded)\n' "mesh-batch" "$(phase_time mesh-batch)" "$RC_MESH" "$(wave_label)"
  printf '  %-26s %5ss  rc=%s   │\n'                      "mesh-isolated" "$(phase_time mesh-isolated)" "$RC_MESHISO"
  printf '  %-26s %5ss  rc=%s   │\n'                      "find-similar"  "$(phase_time find-similar)"  "$RC_FS"
  printf '  %-26s %5ss  rc=%s   │\n'                      "isolated"      "$(phase_time isolated)"      "$RC_ISO"
  printf '  %-26s %5ss  rc=%s   ┘\n'                      "heavy-staged"  "$(phase_time heavy-staged)"  "$RC_HA"
  printf '  %-26s %5ss  rc=%s   ─ wave 3 (mass solo)\n'   "mass"          "$(phase_time mass)"          "$RC_MASS"
else
  printf '  %-26s %5ss  rc=%s   ┐ wave 2 (%s)\n' "mesh-batch"    "$(phase_time mesh-batch)"    "$RC_MESH" "$(wave_label)"
  printf '  %-26s %5ss  rc=%s   │\n'                      "mesh-isolated" "$(phase_time mesh-isolated)" "$RC_MESHISO"
  printf '  %-26s %5ss  rc=%s   ┘\n'                      "find-similar"  "$(phase_time find-similar)"  "$RC_FS"
  printf '  %-26s %5ss  rc=%s   ─ wave 3 (mass solo)\n'   "mass"          "$(phase_time mass)"          "$RC_MASS"
  printf '  %-26s %5ss  rc=%s   ─ isolated (serial, 1 worker)\n' "isolated"  "$(phase_time isolated)"      "$RC_ISO"
  printf '  %-26s %5ss  rc=%s   ─ wave 4 (solo)\n'        "heavy-staged"  "$(phase_time heavy-staged)"  "$RC_HA"
fi
echo "[test:all] ───────────────────────────────────────────────"
printf "  blobs: %s  |  TOTAL %dm%ds  |  report: npx playwright show-report\n" \
  "$blob_count" $((dur / 60)) $((dur % 60))
[ "$PREFIX_RC" -ne 0 ] && echo "  (lint/type/jest failed — see $LOG_DIR/*.log)"
[ "$E2E_RC" -ne 0 ] && echo "  (an e2e phase failed — see $LOG_DIR/<phase>.log and the report)"
[ "$MERGE_RC" -ne 0 ] && echo "  (REPORT MERGE FAILED — npx playwright show-report will not work; see errors above)"

exit $(( PREFIX_RC || E2E_RC || MERGE_RC ))
