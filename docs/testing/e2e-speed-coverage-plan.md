# E2E Suite Plan: Speed Re-organization, Coverage Audit, New Tests

**Source data:** merged Playwright report (`playwright-report/index.html`, speedboard), run of 2026-07-16.
**Snapshot:** 190 tests (188 passed, 2 skipped) across 151 spec files, 11 merged phase invocations. Sum of per-test durations **77.1 min**; merged wall clock **~21.2 min**.

Duration profile:

| Bucket | Tests | Total time |
|---|---:|---:|
| <10s | 58 | 6.4 min |
| 10–30s | 80 | 26.2 min |
| 30–60s | 40 | 26.0 min |
| 60–120s | 10 | 13.7 min |
| >120s | 2 | 4.8 min |

By directory: stage2 27.9 min (58 tests), stage3 23.4 min (40), stage1 10.0 min (67), mass 4.9 min (3), stage5 4.4 min (4), talks-matching 3.4 min (13).

---

## Part 1 — Re-organize for speed

### 1.1 Where the time actually goes

Three distinct costs, in descending order of leverage:

1. **Fixed per-file boot.** Every spec file pays `clearGunDatabases()` + `browser.newContext()` + `gotoWebApp()` + `afterSync()` ≈ **5–7s** before its first assertion. 60 of 151 files finish in under 20s total, and ~45 of those contain a single test — meaning roughly **40–50% of a small file's runtime is setup/teardown**, not testing.
2. **Fixed sleeps.** 822 call sites use `afterSync`/`afterLoad`/`waitForTimeout`/`delay`. `run-test-all.sh` itself measured the suite as **~83% idle**. Some tests wait real wall-clock time by design (e.g. `54-notification-autodismiss` sleeps 4s + polls 8s to watch a toast expire).
3. **Two monster files serialize a worker.** `stage2/66-talk-response-option-paths` (165s) and `stage3/15-three-user-talk-matrix` (122s) each occupy one worker for 2–3 min; with `fullyParallel: false` a file is the scheduling unit, so they set the tail of their shard.

### 1.2 Merge small same-fixture files (biggest win)

Rule: merge only files that (a) total <20s, (b) live in the same stage, (c) use the **identical fixture** (same clear + boot pattern), (d) don't mutate state a sibling reads. Merged files get one `beforeAll` boot + a cheap per-test soft reset (navigate home, dismiss dialogs) instead of a full re-boot; keep the full `clearGun` only in `beforeAll`/`afterAll`. Keep each merged file under ~60s so it doesn't become a new tail.

Concrete merge groups (est. savings = (N−1) × ~6s boot each):

| New file | Absorbs | Saves |
|---|---|---:|
| `stage1/00-p2p-infrastructure.spec.ts` | 6 × `00-p2p-*` (each 6.9s, 1 test) | ~35s |
| `stage1/me-tab-dialogs.spec.ts` | 29-me-answers-search, 56-my-talks-dialog, 57-preferences-dialog, 58-answer-history, 65-me-filter-options | ~25s |
| `stage1/talks-tab-controls.spec.ts` | 05-talks-edit, 30-talks-filter-query, 64-talks-filter-sort-options, 67-talk-editor-option-matrix, 34-deleted-talk-routes-404 | ~25s |
| `stage1/chatroom-navigation.spec.ts` | 27-location-auto-assignment, 53-chatroom-back-icon, 55-create-and-rename-room, 60-chatroom-hierarchy-walk | ~20s |
| `stage1/persistence-settings.spec.ts` | 31-intake-filters-persist, 32-language-setting-persist, 66-settings-option-matrix, 68-system-announcement | ~20s |
| `stage1/mobile-viewport.spec.ts` | 25-mobile-viewport-navigation, 33-mobile-chatroom-hierarchy | ~7s |
| `stage2/messaging-semantics.spec.ts` | 29-concurrent-order, 30-read-state, 31-history-order (all two-user messaging on same pair) | ~15s |
| `stage2/contacts-and-filters.spec.ts` | 34-contacts-filter-name, 35-reply-filter-query, 63-send-talks-picker | ~15s |
| `talks-matching/suppression.spec.ts` | 06-sender-suppression, 09-exchange-suppression, 07-change-of-mind, 08-retraction (same mesh pair fixture) | ~20s |

Estimated total: **3–4 min of serial test time removed**, and ~25 fewer server clear/boot cycles per run (which also reduces the Gun-sync flake surface the README documents).

Counter-pressure to respect: the repo deliberately split heavy suites into one-test files so long flows parallelize, and README states "one test per file for easier debugging." So: **merge only trivially-bootable UI/matrix specs; never merge multi-browser or >20s specs.** Keep file count ≥ ~3× worker count per shard so workers never starve (stage1 would drop from 49 → ~30 files, still ample for 8 workers).

### 1.3 The two monsters: hoist, don't split (REVISED after implementation)

On inspection both are **single dense tests**, not matrices: 66's 165s is dominated by a 90s talk-delivery wait budget, and 15's 122s is an intentional 3-user × 36-talk exchange whose final assertions need the full exchange. Splitting would duplicate their expensive setup, not save wall time. Implemented instead: renamed `stage2/66-talk-response-option-paths` → `stage2/00-talk-response-option-paths` and `stage3/15-three-user-talk-matrix` → `stage3/00-three-user-talk-matrix` so lexicographic scheduling starts them first and they never set the shard tail (the config's documented `00-` convention). `package.json` `test:e2e:three-user-talk-matrix` updated.

Also candidates if they set a shard tail after the merges: `21c-reputation-vouch-threshold` (85s), `04-profile-edit-stage-name` (71s — worth profiling why a profile edit needs 71s at all).

### 1.4 Scheduling and parallelism

- **Slowest-first ordering.** Playwright schedules files lexicographically; the config already exploits this with `00-` prefixes. After the merge/split pass, re-check the speedboard and prefix the new top-10 slowest files so no worker picks up a 100s file last. (Cheap alternative: keep a generated `slow-first` list in a fixture-level `test.info` annotation and re-sort names once per quarter.)
- **Worker counts.** Light shard is capped at 8 for flake reasons; don't raise it. Instead, re-classify: several `HEAVY_SPEC_PATTERNS` entries are single-browser-pair specs quarantined for historical timing races (`01-login-two-users-headcount`, `02-multi-user-headcount`). After the wait-poll conversion (1.5), retry them in the light shard — every spec moved out of the PW_HEAVY_WORKERS=1 shard is nearly pure wall-clock savings.
- **Waves.** `CONCURRENT_WAVES=1` already overlaps phases on disjoint port bands. Verify on the current machine (report shows 11 sequential-ish invocations); if the box sustains it, mass (4.9 min) + talks-matching (3.4 min) + stage5 (4.4 min) overlap instead of summing.

### 1.5 Convert fixed sleeps to polls (long-term, biggest ceiling)

822 fixed-wait sites at ~83% idle is the structural limit. Don't do a big-bang rewrite; apply the existing durable-assertion pattern (`expect(...).toPass()` / locator auto-wait against `#status-bar-text`, `.conversation-list-item`) opportunistically:

- Every file touched by the merge/split pass gets its `afterSync()`/`wait()` calls replaced with condition polls at the same time.
- Add a lint rule (or grep in `npm run health`) flagging **new** `waitForTimeout`/raw `wait()` in specs, so the count only goes down.
- Special case: toast-expiry tests (`54-notification-autodismiss`) — expose a test hook to shrink toast TTLs (e.g. `?e2eToastTtl=500`) instead of sleeping 12s of real time.

### 1.6 Expected outcome

| Step | Wall-clock effect |
|---|---|
| Merges (1.2) | −2 to −3 min serial, fewer flaky boots |
| Splits (1.3) | −1.5 to −2 min off shard tails |
| Re-classify quarantined specs (1.4) | −1 to −2 min off heavy shard |
| Poll conversion, first 20 files (1.5) | −2 to −4 min |

Target: **~21 min → ~12–14 min** full run without raising worker counts; re-measure on the speedboard after each step, one step per PR.

---

## Part 2 — Coverage audit against the design spec

### 2.1 Problem

The spec is `docs/specs/iinpublic-technical-specifications.md` (4,124 lines, numbered §1–§7+ with Part I requirements and Part II design). Current traceability is weak: only 5 `FR-*` IDs exist in the spec, zero companion `.md` narratives reference FR IDs, and `docs/testing/testplan.md` still says "70 tests / 54 files" (actual: 190/151) — it has drifted two generations behind. `docs/e2e-test-analysis.md` (2026-06-27, "113 files") is also stale.

### 2.2 Method: generated traceability matrix (IMPLEMENTED — see `scripts/coverage-matrix.mjs`)

> Status: implemented 2026-07-16. `npm run coverage:matrix` regenerates
> `docs/testing/coverage-matrix.md`; `npm run coverage:check` is the ratchet
> (fails on lost anchor coverage or new untagged specs, baseline in
> `coverage-baseline.json`). Anchor IDs are derived from the spec's numbered
> headings (no spec edits needed). All 166 companions carry auto-seeded
> `covers:` tags marked for hand refinement.

1. **Canonical requirement anchors.** Treat every `###`-level section of the spec as an auditable unit (§3.1 User Management … §3.13 Challenge Plugins, §5.1–5.6 NFRs, §6.x, §7.1–7.8). ~45 anchors. Optionally assign stable IDs (`SPEC-3.4`, `SPEC-7.6`) in the spec headings themselves.
2. **Tag tests at the source.** Each spec file already has a companion `.md` narrative (the convention exists — 53+ files). Add one front-matter line to each companion: `covers: SPEC-3.4, SPEC-3.6`. New specs must include it (enforced by the script below).
3. **Generator script** (`scripts/coverage-matrix.mjs`, run in `npm run health`):
   - Parse spec headings → anchor list.
   - Parse all companion `.md` `covers:` lines + spec file names.
   - Cross-reference with the latest merged report (`report.json` inside `playwright-report/index.html`) so the matrix shows *passing* coverage, not just declared coverage — a `covers:` claim on a skipped/excluded test counts as **uncovered**.
   - Emit `docs/testing/coverage-matrix.md`: one row per anchor → covering tests, count, last-run status; plus two exception lists: **anchors with zero tests** and **tests claiming no anchor**.
4. **Ratchet.** Check in the current zero-coverage list as a baseline file; the script fails `npm run health` only when a new anchor regresses to zero or a new spec ships without `covers:`. This makes the audit self-maintaining instead of another stale document.
5. **Known-excluded ledger.** The Playwright config permanently `testIgnore`s several specs (stats dashboards, reply-triage matrices — awaiting the ledger/IPFS stats replacement) and `cross-platform/x4–x8` are `test.skip`. The matrix must surface these as "excluded, reason, return condition" rows, not silently count them.
6. **Retire the stale prose.** Replace testplan.md §1–2 counts and e2e-test-analysis.md inventory tables with a pointer to the generated matrix; keep those docs for strategy prose only.

Effort: ~1 day for the script + heading IDs, ~1–2 days to tag 151 companions (mechanical; batchable).

### 2.3 Initial gap scan (spot-checked today)

Keyword scan of spec sections vs. `tests/e2e/**/*.spec.ts`:

| Spec area | E2E coverage today |
|---|---|
| §3.4/3.6 talks, matching, filters, §3.3 chatrooms, §3.5 tags, blocking, reputation | Strong (the bulk of stage1–3) |
| §3.11 Interaction Ledger | Partial (17 files mention ledger paths) |
| §3.8 Spam prevention & moderation | Thin — 1 file; no rate-limit E2E (0 hits) |
| §3.13 Challenge Plugin Framework | **None** |
| §7.3 Privacy-sensitive question handling | **None** |
| §7.4 Credit-card/financial data filter | Weak (4 incidental mentions) |
| §7.6 Conversation modes (auto/manual) | **None named** |
| §7.7 Answer mutability & immutable history | **None named** (04-ignore-then-change-answer covers a slice) |
| §5.1 Performance NFRs | None (mass tests are stress, not budget assertions) |
| Cross-platform x4–x8 | Written but `test.skip` |

---

## Part 3 — Proposed new tests

Ordered by risk × current-gap. Each should land with a companion `.md` carrying `covers:` tags.

**P0 — spec'd behavior with zero automation**

1. **Answer immutability (§7.7):** answer, match, change answer → prior answer preserved in history, peer sees revision marker, match state recomputed. Extends `04-ignore-then-change-answer` to assert the *history*, not just the outcome.
2. **Conversation auto/manual modes (§7.6):** auto-mode replies from cached template vs. manual-mode requiring user action; mode toggle mid-conversation.
3. **Privacy-sensitive question handling (§7.3) + financial filter (§7.4):** talk containing card-number-like / sensitive strings → blocked or masked at compose and at delivery. Complements the existing dirty-word specs (70/71) which prove the blocking pipeline works.
4. **Rate limiting (§3.8):** burst POSTs past `P2P_RATE_LIMIT_MAX_EVENTS` → 429s, client back-off, mesh recovers. E2E currently *raises* the limit to avoid it — nothing proves the limiter itself.

**P1 — hardening around known-fragile mechanics**

5. **Block-then-match race:** block a peer while their answer is in flight → no conversation created, no notification leak. (Blocking specs 15a/15b cover steady-state only.)
6. **Duplicate-talk identity (content-hash dedup, `talk-content-id.ts`):** re-broadcast identical talk → single IN row; edit one char → new identity. Unit-tested, never E2E'd through the UI.
7. **WebRTC drop mid-conversation:** kill the DataChannel after match → message written to local Gun, resyncs on reconnect (Gun-is-source-of-truth invariant, spec §19.4). `37-hard-crash-recovery` covers page death, not transport death.
8. **Un-skip cross-platform x4–x8** (mailbox drain both directions, three-platform thread isolation, sync-then-erase abort) — highest-value skipped tests in the tree.
9. **Capacity FIFO at production defaults:** E2E runs force `CHATROOM_MAX_CAPACITY=50, FIFO=false`; production defaults (capacity 3, FIFO on) are effectively untested. One isolated-shard spec with prod env values.

**P2 — quality gates that are cheap once infrastructure exists**

10. **Performance budget assertions (§5.1):** in the existing mass specs, assert p95 broadcast→IN-row latency < spec budget; fail on regression rather than only on timeout.
11. **XSS/injection sweep:** talk title/question/answer containing `<script>`, markdown, RTL overrides → rendered inert in every surface (IN row, modal, conversation, contacts).
12. **`@smoke` device-profile promotion:** `E2E_DEVICE_PROFILES=1` (iPhone WebKit / Android Chromium) is defined but opt-in; run it in the nightly cron beside `test:e2e:mesh`.
13. **Challenge plugin framework (§3.13):** once feature is live, lifecycle E2E — until then, tracked as "excluded, feature pending" in the matrix rather than silently absent.

---

## Part 4 — Idle-time reduction, round 2 (from the 2026-07-16 `test:all` run, 19m58s)

### 4.1 Why round 1 saved little wall time

The merges worked as designed — the five merged files now cost seconds instead of minutes
(p2p 6 tests: 0.8s total vs ~41s; me-dialogs 1.2s vs ~21s; option-matrices 16.9s vs ~50s;
chatroom-nav 7.8s vs ~34s; total test-time 77.1 → 74.3 min) — but the light shard's wall
time is `sum ÷ workers`, so ~3 min of test-time saved ≈ 20s of wall at 8 workers. The run's
structure is the real cost:

| Segment | Wall | Test-time inside | Nature |
|---|---:|---:|---|
| wave 1: light (8w) ∥ stage5 | 478s | 57.7 min light | scheduling efficiency already ~90% (ideal 7.2 min vs actual 8.0) |
| wave 2: mesh ∥ find-similar | 76s | ~4 min | fine |
| mass (solo, 1w) | 296s | 4.9 min | documented hardware ceiling — solo by measurement |
| isolated (solo, 1w) | 104s | 1.7 min | quarantined "nothing else on machine" |
| heavy-staged (solo, 1w) | 239s | ~2.2 min | 09-four-types-chatbot flakes under contention |

The sequential tail (296+104+239 = **639s**) plus light's 478s IS the critical path. Every
tail phase is deliberately serialized because its specs are latency-fragile — so the path to
overlap runs **through de-flaking, not through flipping `CONCURRENT_WAVES`**.

### 4.2 Ordered plan

**Step 0 (DONE, probe-verified): de-flake the failure class.** `openIncomingTalkModal`
clicked a row that Gun sync re-renders continuously; under load the Playwright click burned
its whole actionTimeout in "element not stable / detached" retries (the 00l failure). Root
cause found on the second pass: the talks-list delegation listens on **mousedown** (by
design — "run before any re-render can replace the DOM"), so a synthetic `button.click()`
is a no-op; only real input events worked. Both incoming-modal helpers now dispatch a
`MouseEvent('mousedown')` at the current DOM button and then wait the full modal budget
(the dialog open fetches the talk from the server — re-triggering on a short poll restarts
that load, which is what broke the 2026-07-16 evening run). Verified end-to-end with a
live probe: mousedown → handler fires ("Could not open talk." on an invalid id); plain
`.click()` → nothing.

**Step 1 (DEFERRED until one clean `test:all` run): convert fixed sleeps in the SHARED helpers to condition polls.** Don't chase 822
call sites; the leverage is in ~6 helper functions the slow specs all pass through:
`bootstrapUser`, `waitForIncomingTalkCluster` (tab-flip loop with 3×`afterSync` per flip),
`clickBroadcastUntilBulkAck`, `fast-dm-setup`, `openIncomingTalkModal*`. The 40–70s light
specs (04-profile-edit 71s, 08-super-user-copy 68s, 00p-custom-cutoff 61s, 15a/15b ~48s)
are these helpers' waits stacked 2–3 browsers deep. Expected: light sum 57.7 → ~45 min,
and — more important — specs stop being latency-fragile, enabling Steps 2–4.
Add the lint guard: no new raw `wait()`/`waitForTimeout` in specs.

**Step 2 (DONE): light default raised 8 → 10 workers** (14-core machine). Light wall:
57.7/8 → 7.2 min ideal; at 10 ≈ 5.8 ideal (~6.4 actual). The historical 8-worker ceiling
was set by exactly the flake class fixed in Step 0. Roll back per-run with `PW_WORKERS=8`.
Bump to 12 only after two clean runs at 10.

**Step 3 (DONE): tail folded into wave 2.** isolated (1w, offset 100) and heavy-staged
(1w, offset 400) now run concurrently with the mesh wave; mesh finishes in ~60–80s, after
which the two tail phases have the machine essentially to themselves — approximating their
old solo condition. Wave 2 becomes max(76, 104, 239) ≈ 239s instead of 76+104+239 = 419s
→ **−3 min**. mass stays solo (its requirement is measured, not assumed). Opt out with
`TEST_ALL_SEQUENTIAL_TAIL=1` if this machine flakes under the overlap.

**Step 4 (optional experiment): `MASS_WORKERS=2`.** 296s → ~180s if the machine holds 22
concurrent browsers post-deflake. Historically failed; retry only after Steps 1–3, keep it
env-gated, abandon on first latency-class failure.

### 4.3 Projected wall time

| After | Wall |
|---|---|
| before Part 4 | ~20 min |
| Steps 0+2+3 (2026-07-16) | **15.5 min measured** (three clean-ish runs; three distinct test bugs root-caused and fixed along the way) |
| light 10→12w + heavy 1→2w (2026-07-17) | **~13–13.5 min expected**: light ~5.5 + wave2 ~max(isolated 106s, heavy ~110s) + mass ~5 + overhead. Rollback: `PW_WORKERS=10` / `PW_HEAVY_WORKERS=1` |
| Step 4 (mass @2w, opt-in experiment) | ~11.5–12 min — try `MASS_WORKERS=2 npm run test:all` once the 12w/heavy-2w config has a clean run |

### 4.4 Next investigation: the constant 165s spec

`stage2/00-talk-response-option-paths` has taken 164.9–165.2s in EVERY run regardless of
machine load — before and after the WebRTC fix. That constancy across variable conditions
points to stacked FIXED budgets, not real sync latency: the broadcast path
(`clickBroadcastUntilBulkAck` → `waitForGunApiReady` / `waitForChatroomMemberCountViaApi` /
`waitForBroadcastableTalkIds`) runs several sequential `E2E_ASSERT_TIMEOUT_MS` (20s) waits,
some with swallowed `.catch(() => {})` timeouts, before the 90s cluster budget. Instrument
one run (timestamps around each wait) to find which budgets are being exhausted silently;
fixing the underlying signal could cut 60–90s from this spec and likely trim every
broadcast-path spec.

## Suggested sequencing

1. Week 1: Part 1 items 1.2 + 1.3 (merge/split) with poll conversion (1.5) applied to touched files; re-measure speedboard.
2. Week 2: coverage-matrix script + spec heading IDs (2.2); tag companions in batches.
3. Week 3+: P0 tests from Part 3, one per PR, each landing with its `covers:` tags; re-classify quarantined specs (1.4) once poll conversion has soaked.
