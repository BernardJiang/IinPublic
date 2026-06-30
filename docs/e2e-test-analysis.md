# E2E Test Suite Coverage Analysis

**Last updated:** 2026-06-27
**Scope:** All 113 spec files under `tests/e2e/`
**Suite command:** `npm run test:e2e:mesh` (talks-matching only) / `npm run test:all` (full suite including staged + mass)

---

## Suite Structure & Inventory

### Directories by Stage

| Directory | Specs | Active Tests | Scope |
|-----------|-------|--------------|-------|
| `stage0-bootstrap/` | 4 | ~4 | Empty DB -> TechSupport seed, single-user tab traversal, four-talk-type creation, save baseline |
| `stage1-single-user/` | 24 | ~30 | Single user, P2P infrastructure, talk CRUD, chatroom navigation, mobile viewport, Chinese UI |
| `stage2-two-user/` | 24 | ~27 | Two-user interactions, direct messaging, broadcast cancellation, blocking, reputation, P2P handshake |
| `stage3-three-user/` | 38 | ~38 | **Largest group** — multi-responder lifecycle (all talk types), intake filters, reply triage, contacts, chatbot |
| `stage4-four-user/` | 1 + zzz | ~1 | Capacity eviction at boundary |
| `stage5-multi-user/` | 4 + zzz | ~4 | 20-talk super-user broadcast, capacity regional spread, chatroom scroll UX, find-similar |
| `mass/` | 4 | ~4 | M1-M4 mass exchange stress tests (flow, survey, route, mixed) |
| `talks-matching/` | 12 | ~14 | Isolated mesh protocol tests, zero Gun writes, hub failure scenarios |

### Pipeline Design

- **Stage pipeline** (`E2E_STAGE_PIPELINE=1`): Sequential stage0 -> stage5, shared Gun DB state between stages. Save/load snapshots at each boundary via `zzz-save-stageN`.
- **Parallel shard** (`PW_WORKERS>=4`): Non-heavy specs run concurrently with per-worker Gun server isolation (ports 8080+i, webpack on 3001+i).
- **Heavy shard** (`PW_WORKERS=2`): Mass tests + talks-matching + stage4/5 run at low parallelism to avoid oversubscription.
- **Mesh-only** (`test:e2e:mesh`): Sequential runs of all `talks-matching/*.spec.ts` plus two grep-filtered variants of broadcast-announce. Cron job: nightly at 2AM PDT.

---

## Feature Categories Covered

### Talk Delivery Over Mesh (Steps 1–6, 8) — Excellent Coverage

This is by far the strongest area. The talks-matching suite isolates each step as an independent spec with three-browser setups and zero Gun writes, making these true protocol-level tests:

| Step | Spec File(s) | What It Verifies |
|------|-------------|-----------------|
| 1 | `01-mesh-ping-overlay` | Mesh ping reaches all peers, never relayed by third party |
| 1 | `02-mesh-broadcast-announce` (x2 variants) | Reply-to descriptor survives broadcast round-trip; eligible receivers get it, ineligible excluded |
| 2 | `03-mesh-response-match` | Response delivery + P2P session key establishment without server calls |
| 5 | `04-local-contacts` | Local-only talks not forwarded to server, matched peers still receive over mesh |
| 6 | `05-mailbox-offline-response` | Ciphertext envelope mailboxed while sender offline, drained on reconnect |
| 8 | `06-sender-suppression` | TalkLedger tracks outcomes, suppresses re-prompting ignored peers |
| 9 | `07-change-of-mind` | Ignore -> change to match triggers conversations; stale lower-version rejected |
| 10 | `08-retraction` | Retracted talk shows withdrawn to all; post-retraction answers blocked |
| 11 | `09-exchange-suppression` | Per-tag mutual exchange tracked; origin sender sees suppression, third party sees full talk |

Hub failure scenarios tested:

| Spec File | Failure Mode | Expected Behavior |
|-----------|------------|-------------------|
| `06-mesh-ping-with-hub-api-down` | Hub API blocked mid-session via network interception | Mesh remains reachable despite hub unreachable |
| `07-mesh-ping-after-hub-stop` | Hub process killed entirely | Overlay stays connected, pings reach peers |

### Multi-Responder Talk Lifecycle — Good Coverage (With Redundancy)

Stage3 has dedicated specs for each talk type's full lifecycle:

| Talk Type | Spec File |
|-----------|-----------|
| Survey | `00aa-talk-lifecycle-survey-multi-responder` |
| Route | `00ab-talk-lifecycle-route-multi-responder` |
| Flow | `00w-talk-lifecycle-flow-multi-responder` |
| Tag | `00z-talk-lifecycle-tag-multi-responder` |
| Intake (filtered) | `00ac-talk-lifecycle-intake-filtered-responder` |

Each walks through: create -> broadcast -> receive on N peers -> answer subset -> checkIfMatch -> conversation creation. The engine path is identical across all four, differing only in talk-type metadata and question count.

### Intake Filtering — Solid Individual Coverage

Five filter dimensions tested independently:

| Filter Dimension | Spec File |
|---------------|-----------|
| Language | `00m-language-intake-filter` |
| Distance | `00n-distance-intake-filter` |
| Content (blocked terms) | `00o-content-intake-filter` |
| Custom phrase + cutoff | `00p-custom-cutoff-intake-filter` |
| Talk type | `00t-talk-type-intake-filter` |

Combined with age-gating (`00g-age-gating`) and expiration broadcast behavior (`00q-expiration-broadcast`).

### P2P Infrastructure — Thin but Present

Six specs in stage1 verify debug endpoints expose correct fields:

| Spec | Coverage |
|------|----------|
| `00-p2p-conversation-transport` | Transport mode is "direct-p2p", HTTP signaling retired (404) |
| `00-p2p-cross-platform-protocol` | Signed platform compatibility in storage endpoint |
| `00-p2p-data-ownership` | Delete/request, migration, relay TTLs, diagnostics APIs |
| `00-p2p-local-node-supervisor` | Permissioned node access, signed pairing, identity binding |
| `00-p2p-sea-key-custody` | Browser stores encrypted key, relay exposes only public identity |
| `00-p2p-neighbor-memory` | Active neighbors cached locally, used before star fallback |

These are API-level checks (verify debug endpoints return correct structure). No spec verifies that browser code actually uses these values — acceptable hygiene tests but not UI-level verification.

### Chatrooms, Chatbot, Reputation — Well Covered

| Feature | Spec Files |
|---------|-----------|
| Hierarchy navigation | `18-travel-mode-single-room` (stage1), `00h-chatroom-hierarchy-broadcast` (stage2) |
| Regional travel across continents | Full round-trip test: Global -> NA -> USA -> CA -> SD, London -> UK -> Europe, return home |
| Peer detail views | `00e-chatroom-peer-detail` (5 sub-tests in stage2) |
| Custom/business API scripts | `17-chatroom-custom-business-api` (stage1) + `13-chatroom-scroll-and-broadcast-bar` (stage5) |
| Chatbot auto-reply | `03-chatbot-bot-badge`, `09-four-types-chatbot`, `14-exact-chatbot-memory` |
| Reputation (block count, star rating, vouch threshold) | `21a-reputation-block-count`, `21b-reputation-peer-star-rating`, `21c-reputation-vouch-threshold` |
| Blocking + unblocking | `15a-blocking-unblock-resumes-talk-delivery`, `15b-blocking-stops-delivery-and-peer-visibility` |

### Broadcast Lifecycle — Good Edge Case Coverage

| Scenario | Spec File |
|----------|-----------|
| Cancel all mid-flight | `00-broadcast-abort-clear-all` |
| Chatroom boundary matching | `00-broadcast-boundary-match` |
| Talk deletion mid-broadcast | `00-broadcast-deletion-mid-broadcast` |
| Talk expiration | `00q-expiration-broadcast` |

---

## Coverage Gaps

### High Priority

#### 1. Conversation Messages — Underrepresented

Only two specs touch DM messaging (`09-messaging` in stage2, `00j-messaging-edge-cases`):

- **Not tested:** Message ordering when both sides send concurrently
- **Not tested:** Read receipt delivery and display
- **Not tested:** Large conversation pagination/scroll performance
- **Not tested:** Message deletion or editing within an active conversation
- **Not tested:** Conversation list sorting (most recent first) under multi-partner scenario

This is the highest-risk gap since DM conversations are a primary UX surface.

#### 2. Step 7 Deletion Verification

Steps 9–11 have dedicated tests in talks-matching. Step 7 (delete `talk-delivery-routes`, server talk maps, Gun relay paths for talks) has **no smoke test** verifying that:
- Deleted endpoints return 404
- Talk delivery works entirely over mesh without falling back to any server path
- No regression in conversation creation pipeline after server routes removed

#### 3. Search/Filter UX — Untested Interactivity

Three filter/search inputs exist in the UI:
- `answers-search-input` (Me tab, searches across answer text)
- `contacts-filter-name` (Contacts tab, filters by stage name)
- `talks-filter-query` / `reply-filter-query` (Talks tab, filters by talk or responder)

None are tested as interactive elements — type -> verify filtered list. The `13-me-filters-credit` spec covers credit visibility data but does not exercise the search input.

### Medium Priority

#### 4. Long-Term Offline Recovery

Mailbox offline response (step 6) is well tested for the TTL window. Not tested:
- Talks announced during a 24-hour offline period (beyond mailbox TTL)
- Gun replication recovery after prolonged disconnection
- Browser process kill vs graceful close — `26-offline-reconnect-incoming-sync` tests reconnect, but hard crash with no cleanup is untested

#### 5. Mobile Multi-User Interaction

`25-mobile-viewport-navigation` tests tab switching on phone viewport (390x844). Not tested:
- Talk answer flow in mobile layout (answer dialog might overflow)
- Conversation messages in narrow width
- Chatroom hierarchy navigation with bottom nav visible

#### 6. Settings Change Persistence Across Reload

Profile edit tested once (`04-profile-edit-stage-name` in stage2). Not verified:
- Intake filter toggles persist after page refresh
- Language setting survives reload
- Blocking list state survives browser restart

### Low Priority

#### 7. Stage Save/Load Specs Are Scaffolding Only

`zzz-save-stageN` files (stage2, stage3, stage4) have zero test blocks — they're empty spec shells or run setup-only code. This is by design (they're pipeline checkpoints), but the filenames mislead into thinking coverage exists here.

#### 8. Stats/Analytics Aggregation

Two specs cover stats (`10-stats-four-types` in stage1, `00i-survey-analytics-dashboard` in stage3). The aggregation logic across four talk types with individual responder outcomes is complex — currently thin relative to the underlying engine complexity.

---

## Redundancy Analysis

### Talk Multi-Responder Lifecycle (Medium)

Four specs (`00aa`, `00ab`, `00w`, `00z`) walk through near-identical flows: create -> broadcast -> receive on N peers -> answer subset -> verify match creation. The engine path under test is the same in all four; only talk-type metadata differs.

**Suggestion:** Parameterize into one spec with a fixture that iterates over `{survey, route, flow, tag}`. Saves ~3-4 minutes per CI run. Note: intake-filtered variant (`00ac`) could stay separate since it tests filter logic on top of lifecycle.

### Contacts Relationship Transitions (Medium)

Three specs touch contacts from different angles with significant overlap:
- `00ae-contacts-stranger-relationship` (stage2): Stranger label -> save relationship -> sort order
- `06-contacts-tab` (stage3): List of matched users, click to see matching talks
- `14-contacts-relationship-credit` (stage3): Relationship dialog content + credit display

The "stranger -> match -> relationship" transition is asserted in both 00ae and 14. The stage pipeline makes merging technically hard (stages share DB state), but assertion overlap should be deconflicted — stage2 covers presence/sort, stage3 covers credit/relationship detail content without duplicating the stranger->contact assertion.

### Chatroom UI Regression Overlap (Low-Medium)

- `00l-chatroom-talks-ui-regressions` (stage3): 5 sub-tests covering chatroom list + talk display
- `13-chatroom-scroll-and-broadcast-bar` (stage5): scroll behavior + broadcast bar visibility

Both test chatroom scroll and broadcast bar. Could consolidate into one canonical regression spec, but stage boundary complicates merging since stage5 depends on accumulated DB state from prior stages.

### Headcount/Presence Assertions (Low)

Three specs check user counts: `01-login-single-user` (stage1), `01-login-two-users` (stage2), `02-multi-user-headcount` (stage3). These are essentially "verify N users exist" — trivial assertions that add minimal confidence beyond the stage-transition bootstrap itself. They serve as sanity checkpoints for the pipeline, which is valuable, but represent low signal-to-noise from a coverage perspective.

---

## Recommendations (Priority Order)

### Immediate

1. **Add conversation message depth tests**
   - Message ordering under concurrent send from both participants
   - Large conversation pagination (>50 messages scroll performance)
   - Conversation list sorting with multiple active partners

2. **Add search/filter interaction test**
   - Single spec exercising answers page search, contacts name filter, and talks/reply query
   - These share the same pattern: type into input, wait for re-render, verify filtered list matches expected subset

### Short-Term

3. **Add Step 7 deletion verification**
   - HTTP request to old `talk-delivery-routes` endpoints -> expect 404
   - Talk delivery works entirely over mesh after deletion
   - Regression: conversation creation pipeline still functions

4. **Deduplicate multi-responder lifecycle specs**
   - Parameterize survey/route/flow/tag into one parameterized test fixture
   - Keep intake-filtered variant separate (tests different code path)

5. **Add browser crash vs graceful close comparison**
   - Kill a Chromium process mid-conversation, verify peer sees offline state
   - Verify Gun-local IndexedDB consistency after forced terminate
   - Reconnect and verify conversation history intact

### Low Effort / Nice to Have

6. **Deconflict contacts assertions between stage2 and stage3**
   - Stage2 claims stranger->contact verification
   - Stage3 should only assert credit/relationship dialog content, not duplicate the transition flow
   - Prevents wasted runtime running the same assertion twice across two stages

7. **Add one mobile multi-user interaction test**
   - Answer dialog in phone viewport (verify modal fits without horizontal overflow)
   - Conversation messages render correctly at 390px width
