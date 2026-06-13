# IinPublic TODO

Last updated: 2026-06-13

This file is the short, execution-oriented plan. The detailed acceptance inventory and the
statistics / spec-gap follow-ups are consolidated into the appendices at the bottom of this file.
- Completed work: `docs/completed.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)
- Detailed acceptance inventory: see "Appendix A — Detailed backlog inventory" below.

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. Do steps 9–11 in one Opus session (shared versioning/ordering machinery). `- [ ] Test:` items belong to whichever model implemented the step.

## Open items — SHIPPING GATES & FOLLOW-UPS

All P1 (libp2p/IPFS), P2 (Find Similar), and P2.5 (sort pipeline) **completed** and moved to `docs/completed.md` (2026-06-12).

**Spec audit 2026-06-13 (find-similar vs SRS §22):** REQ-SIM-01–08 all implemented in `src/shared/find-similar.ts` (`FindSimilarIndex`, `matchScore`, delta/patch, inverted index, bounded top-K heap, `SORT_STRATEGIES`/`rankPeople`) and wired through `ui-manager.ts` `ContactsViewDeps` (3 call sites). 14 dedicated unit tests + 762 total unit/integration tests green; `tsc` + eslint clean. **One residual gap:** the `distance` sort strategy (§22.7) is a pass-through placeholder — it does not yet sort by `LocationPrivacy.blurLocation`. Tracked in T2 below.

### P0 — Test determinism & transport fallback `[Opus]` — HIGH PRIORITY

> Why Opus: the hard part is distributed/timing correctness — making delivery deterministic without papering over real races, and proving the relay/star-gun fallback actually carries messages when WebRTC fails. Design the fallback-trigger + assertion model first, then hand mechanical spec edits to Sonnet/Haiku.

**Context.** `playwright.config.ts` sets `retries: 1`, so a spec that only passes on the second run is currently green — masking nondeterminism in the mesh/WebRTC path. The `ResilientConversationTransport` fallback chain (`direct-p2p → server-relay → star-gun`, `src/web/services/resilient-conversation-transport.ts`) is wired and unit-tested (`p2p-mesh-session-fallback.test.ts`, integration `p2p-relay-only-hub.test.ts`), but **no E2E spec forces a WebRTC failure and asserts the message still arrives via relay or star-gun** — the `subscribeToMessages` fallback-timer path (`P2P_WEBRTC_CONNECT_TIMEOUT_MS`) is E2E-uncovered. Several specs lean on in-spec retry loops (e.g. find-similar's 15-attempt broadcast) instead.

- [~] **T1. Inventory retry-dependent specs.** Static source analysis DONE 2026-06-13 → `docs/testing/retry-dependence-inventory.md` (107 specs scanned; at-risk subset tabled with root cause + fix class F/G/L/V; ordered to feed T3–T5). **Correction after reading the flagged specs:** the initial "Tier A = `07`+`08` toast race" was a grep false positive (it matched their *"durable, not toast-only"* comment) — both are already durable-surface + `ensureMeshNeighbors`-gated and need no rewrite; likewise `.notification` in `00-ui-navigation-settings` is synchronous form-validation and `.notification-badge` is durable derived state. **Real risk = WebRTC/`direct-p2p` timing in messaging specs (`09-messaging`, `00j-messaging-edge-cases`, `10-message-unread-badge`, `12-two-responders-partial-match`) — these motivate T3 — plus in-spec retry loops (fix class L).** **Live `--retries=0` confirmation still pending:** the dev sandbox can't launch Playwright Chromium (missing system libs, no sudo, loader ignores `LD_LIBRARY_PATH`); run `PW_WORKERS=4 npm run test:e2e -- --retries=0` in browser-capable CI to fill the "observed" column.
- [x] **T2. Fix the distance sort strategy (spec §22.7).** DONE 2026-06-13: `rankPeople` `distance` branch now sorts by `blurredDistanceMiles` (snaps both coords to the privacy grid before Haversine — exact GPS never used); added optional `distance` to `RankedPerson` + a `filters.distanceMiles` resolver; unknown-distance candidates sort last. Unit tests: ascending-by-blurred-distance ordering + grid-snap (same-cell → 0). `find-similar.test.ts` now 16 green; `tsc`/eslint clean. **UI follow-up:** `ui-manager.ts` still needs to pass a `distanceMiles` resolver into the contacts pipeline for the `distance` option to sort live (registry entry already present).
- [~] **T3. Deterministic fallback E2E.** Routing DONE; browser spec PARKED 2026-06-13. Added a deterministic fault-injection seam `ResilientConversationTransport.setFailModesForE2e([...])` (+ `WebConversationService.setTransportFailModesForE2e`, injectable leg transports via a test-only ctor override) instead of flaking real WebRTC/STUN. **Routing fully proven** by `src/test/unit/resilient-conversation-transport-fallback.test.ts` (4 unit tests, green: direct→relay→star + onFallback reasons). E2E spec `tests/e2e/staged/stage2-two-user/00m-transport-fallback.spec.ts` is committed but marked **`test.fixme`** (skipped, does not fail the suite) pending CI iteration — it still needs (a) confirmation that server-relay actually delivers cross-browser in the standard hub (no existing spec exercises relay delivery) and (b) subscribe-side `direct→relay→star` fallback for full receiver render of the star leg. tsc/eslint clean; Playwright lists it.
  - **L-fix note (find-similar):** the attempted `connectedNeighborCount >= NUM_USERS-1` gate **failed in CI (90s timeout)** — the sparse gossip overlay never connects all 9 peers at once. **Reverted** to the original 15× delivery poll, which is legitimate cross-browser convergence handling, not retry-masking. Inventory reclassifies that loop as keep/V.
- [ ] **T4. Replace masking retries with real waits.** For each T1 spec whose root cause is timing (not a bug), swap the implicit retry for an explicit `afterSync`/`waitForTabActive`/connected-neighbor gate; once a spec is deterministic, set `test.describe.configure({ retries: 0 })` on it so regressions surface immediately.
- [ ] **T5. Lower the global retry budget.** After T1–T4, drop `playwright.config.ts` `retries` to `0` (keep `1` only on an explicit allowlist of specs with a documented external-flake reason).
- [ ] **Test/verify:** `PW_WORKERS=4 npm run test:e2e` green with `retries: 0`; the fallback spec passes in both direct and `dev:relay-only` modes; `npm run health` clean.

**Next phase:** Appendix C (P2P spec-gap audits `[Haiku]`). Appendix B (Statistics expansion) completed 2026-06-13 — see `docs/completed.md`.


## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Relay-only hub (RELAY_ONLY_HUB=1)
npm run test:e2e:parallel     # Full E2E suite in direct mode
```

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.

---

## Appendix A — Detailed backlog inventory `[Haiku]` — AUDITED (2026-06-12)

> Consolidated 2026-06-08 from `docs/TODO-backlog-inventory.md` (archived). Full acceptance closure audit completed 2026-06-12; all major items verified shipped and working correctly. See `docs/completed.md` for detailed audit findings.

**Audit summary (see completed.md for full details):**

| Area | Status | Finding |
|------|--------|---------|
| **Contacts** | ✓ VERIFIED | Stranger/undefined state on first contact; relationship labels filter/sort/save/reload work correctly (8 tests passing); profile parity complete |
| **Talks** | ✓ VERIFIED | D4 matrix complete: tag/flow/survey/route validation (1108 test lines); language edit, creator/recipient transitions, diagnostics all shipped |
| **Me Tab** | ✓ VERIFIED | Profile editing parity, preferences modes, per-answer ownership, durable reply review all working |
| **Settings** | ✓ VERIFIED | Localization/filter behavior, storage/transport diagnostics (TechSupport/room-visits/language/SEA/P2P flags) complete |
| **Conversation/Peer Detail** | ✓ VERIFIED | Transport status, privacy verification, history/search controls shipped |
| **TechSupport Root** | ✓ VERIFIED | Singleton identity, anti-impersonation, global anchor, support-channel, privacy constraints all implemented |
| **E2E Stage Pipeline** | ✓ VERIFIED | TechSupport baseline seeding, parallel isolation, single-user→Stage 0 consolidation complete |

**Deferred forward work:**
- Responder ranking enhancement (matched-talk/match-rate/relationship/recency/weighted) — covered by P2.5 sort-pipeline work; further strategy enhancements in future
- Custom chatroom detail metadata expansion (description/capacity/headline/owner/created/members/visits) — future feature gate
- Intake control richer dirty-word diagnostics and distance preamble polish — optional UX refinement
- Contextual statistics (cross-question correlation, completion rates, segment filters) — in Appendix B forward work

**Verification:** All 763 unit tests passing; type checking clean; no acceptance gaps or regressions detected.

## Appendix B — Statistics expansion backlog `[Sonnet]` — **COMPLETED 2026-06-13**

> All items shipped. See `docs/completed.md` for full details. Verification: `npx tsc --noEmit` clean; all 763 unit tests pass.

## Appendix C — Residual P2P transport & spec-gap follow-ups `[Haiku]` — AUDITED (2026-06-12)

> Consolidated 2026-06-08 from `docs/TODO-direct-p2p.md`, `docs/roadmap/spec-gap-matrix.md`, and `docs/reports/PROJECT_STATUS.md` (all archived). The direct-P2P transport stack shipped (see `docs/completed.md`); full audit completed 2026-06-12.

**Audit findings (see completed.md for details):**

- [x] Reputation/credit section visibility allowlists (FR-UM-7) — **Deferred** to next phase (requires design review).
- [x] Broader moderation UX and centralized reporting/appeal model (FR-BF / FR-SP) — **Deferred** (safety-critical, out of scope).
- [x] Production-durability review of in-memory stats indices, quota counters, rate-limit counters — **VERIFIED**: All intentionally ephemeral per spec; Gun-backed persistence deferred if requirements tighten. All 763 unit tests passing.
- [x] Statistics/visualization product polish (shipped dashboard/endpoints) — **Complete**; baseline live, forward aggregates in Appendix B.
- [x] Android: maintenance-only until web/server loop stable — **Acknowledged** (not blocking).

**Known runtime risks (verified):**
- ✓ Gun replication timing on auto-reply path: Mitigated by server POST path.
- ✓ `talkCompleted` handler fallback: Verified, preserves data safely.
