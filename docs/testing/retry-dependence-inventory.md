# T1 — Retry-dependent E2E spec inventory

> Backlog: `docs/TODO.md` → "P0 — Test determinism & transport fallback" (T1).
> Status: **static source analysis (2026-06-13), revised after reading the flagged specs.** A live
> `retries: 0` run to confirm the pass→fail set was attempted in the dev sandbox but blocked — the
> environment cannot launch Playwright's Chromium (missing system libs, no sudo, loader ignores
> `LD_LIBRARY_PATH`). Re-run `PW_WORKERS=4 npm run test:e2e -- --retries=0` in browser-capable CI
> to confirm the "observed" column; the root-cause/fix-class columns below stand on their own.

## Methodology correction (read this first)

The first pass flagged `07-change-of-mind` and `08-retraction` as "WebRTC + ephemeral-toast" (Tier A).
**That was a false positive** — the grep matched their own comment line *"Assertions (durable, not
toast-only)"*. On inspection both specs are already durable-surface-based (`expect.poll` on
`myConversations` / `talkLedger` status fields) and already gate the mesh via `ensureMeshNeighbors`
(which polls `connectedNeighborCount`). **They need no rewrite.** Two further corrections from reading
the code:

- `.notification` in `00-ui-navigation-settings` is **synchronous form-validation** feedback that the
  test clicks immediately — deterministic, not a delivery-race toast.
- `.notification-badge` in `10-message-unread-badge` and `12-two-responders-partial-match` is the
  **durable derived unread count**, pre-gated with `expectConversationUnread` /
  `waitForDirectP2PChannel`. Not a toast.

**Net:** there is no genuine ephemeral-toast tier. The real retry-masking risk is (1) WebRTC/
`direct-p2p` connection timing in the messaging specs (→ motivates **T3**, the relay/star-gun fallback
proof) and (2) in-spec retry loops that paper over delivery races (→ **L**).

## Why specs can pass only on retry

`playwright.config.ts` sets `retries: 1`. A spec that fails its first attempt and passes the
second is reported green, so any of these nondeterminism sources is currently invisible:

1. **WebRTC/mesh connection timing** — a DataChannel that isn't up when the assertion fires.
   The codebase already has the right antidote in places: gate on
   `connectedNeighborCount === neighbors.size` before acting (8 talks-matching specs do this).
2. **Ephemeral toast assertions** — `CLAUDE.md` explicitly says to prefer durable surfaces
   (`#status-bar-text`, `.conversation-list-item`, `waitForTabActive`) over toast/notification
   elements that disappear on a timer. Toast asserts race the render.
3. **In-spec retry loops** — a spec wraps an action in `for (let attempt …) { try … catch
   waitForTimeout }`. This *is* self-healing but hides the underlying delivery race and is slow.
4. **Missing transport fallback** — when WebRTC never connects, there is no E2E that proves the
   `ResilientConversationTransport` actually falls back to server-relay / star-gun, so messaging
   specs depend on the happy WebRTC path completing in time (this is the T3 gap).

## Inventory (107 specs total; the at-risk subset below)

Fix classes: **D** = swap ephemeral assert for a durable surface; **G** = add a
`connectedNeighborCount` (or `waitForTabActive`) gate before the assertion; **L** = replace an
in-spec retry loop with a deterministic gate; **F** = relies on transport fallback that has no
E2E proof (depends on T3); **V** = likely already deterministic, verify and pin `retries: 0`.

| Spec | Risk signals | Likely root cause | Fix class |
|---|---|---|---|
| `staged/stage2-two-user/09-messaging.spec.ts` | WebRTC connect; conversation transport; asserts `direct-p2p` | message asserted before DataChannel up; no relay-fallback proof | **F + G** |
| `staged/stage2-two-user/00j-messaging-edge-cases.spec.ts` | WebRTC connect; many `.catch` idioms | edge-case messaging races the transport | **F + G** |
| `staged/stage2-two-user/10-message-unread-badge.spec.ts` | `direct-p2p` DataChannel; badge derived from it | badge is durable, but its value depends on the WebRTC message arriving in time | **F** |
| `staged/stage3-three-user/12-two-responders-partial-match.spec.ts` | asserts `direct-p2p` mode + badge `'1'` (5s timeout) | hard dependency on WebRTC connecting fast; no fallback path | **F + G** |
| `staged/stage2-two-user/00k-p2p-handshake.spec.ts` | handshake/WebRTC timing | handshake diagnostics asserted before completion | **G** |
| `staged/stage1-single-user/00-p2p-neighbor-memory.spec.ts` | mesh neighbor memory | neighbor set asserted before overlay forms | **G + V** |
| `staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts` | WebRTC/protocol | protocol exchange timing | **G + V** |
| `staged/stage5-multi-user/find-similar-people.spec.ts` | 15-attempt broadcast loop; `retries: 0` already set; 10 browsers | ~~loop masks a race~~ → **reclassified: legitimate cross-browser mesh convergence, not masking** (see changelog) | **keep loop (V)** |
| `staged/stage3-three-user/14-exact-chatbot-memory.spec.ts` | in-spec attempt loop; Gun replication of answer template | auto-reply path needs the template replicated before the talk arrives | **L + G** |
| `staged/stage2-two-user/00h-chatroom-hierarchy-broadcast.spec.ts` | 12 `.catch` retry idioms | broadcast fanout/Gun timing | **L** |
| `staged/stage1-single-user/00z-chinese-edge-notifications.spec.ts` | 11 `.catch`; localized render | localized notification render race | **L** |
| `staged/stage3-three-user/00g-age-gating.spec.ts` | 9 `.catch`; age-verify threshold | age-verify state propagation timing | **L + V** |
| `staged/stage2-two-user/00-broadcast-abort-clear-all.spec.ts` | 9 `.catch`; broadcast | abort/clear timing | **L** |
| `staged/stage5-multi-user/00d-super-user-20-broadcast.spec.ts` | 8 `.catch`; 20-tag fanout | high-fanout broadcast timing | **L + G** |
| `staged/stage3-three-user/24-profile-privacy-visibility.spec.ts` | 8 `.catch` | profile visibility propagation | **L** |
| `staged/stage2-two-user/08-super-user-copy-talk.spec.ts` | 8 `.catch` | copy-talk delivery timing | **L** |

**Verified already-deterministic (no work — do NOT rewrite):** `talks-matching/07-change-of-mind`,
`talks-matching/08-retraction` (durable `expect.poll` + `ensureMeshNeighbors` gate);
`00-ui-navigation-settings`, `00k-techsupport-contact-mute`, `00i-survey-analytics-dashboard`,
`00q-expiration-broadcast` (`.notification` here is synchronous form-validation, asserted then
clicked). Candidates to **pin `retries: 0`** (T4) once one green CI run confirms.

**Already-deterministic model to copy (gate on `connectedNeighborCount`, fix class V):**
`talks-matching/01-mesh-ping-overlay`, `02-mesh-broadcast-announce`, `04-local-contacts`,
`05-mailbox-offline-response`, `06-mesh-ping-with-hub-api-down`, `06-sender-suppression`,
`07-mesh-ping-after-hub-stop`, `09-exchange-suppression`. These pre-gate mesh delivery and are
the template for fixing the **G** specs above.

## Recommended order (feeds T3/T4/T5)

1. **Messaging/fallback specs first** (`09-messaging`, `00j-messaging-edge-cases`,
   `10-message-unread-badge`, `12-two-responders-partial-match`) — these hard-assert `direct-p2p`
   and are the genuine WebRTC-timing risk. They motivate **T3**: add a spec that forces WebRTC to
   fail and proves `ResilientConversationTransport` delivers via server-relay then star-gun. Then
   relax the specs that *require* `direct-p2p` to accept a fallback mode, or gate on connection
   state before asserting.
2. **Retry-loop specs** (`find-similar-people`, `14-exact-chatbot-memory`, the `.catch`-heavy
   broadcast specs) — replace the loops with deterministic gates (**L**); the loop is the tell that
   a delivery race is being masked.
3. **Verify-only mesh specs** (`00-p2p-neighbor-memory`, `00-p2p-cross-platform-protocol`) — confirm
   they gate on `connectedNeighborCount` like the talks-matching template; add the gate if missing.
4. After a spec is confirmed deterministic in CI, set `test.describe.configure({ retries: 0 })` on it
   (**T4**) — start with the already-deterministic set (`07`, `08`, the form-validation specs) — then
   drop the global budget to `0` with a documented allowlist (**T5**).

## Changelog

- **2026-06-13 (Phase 1 regression — FIXED; + 1 flake):**
  - `00-ui-navigation-settings.spec.ts:240` was a **real Phase 1 regression** (not a flake — an earlier
    guess that mis-diagnosed it as one was reverted). The storage inspector asserted the conversation
    transport fallback contained `'server-relay'`, but Phase 1 set `fallback: null` (direct-p2p only), so
    the inspector correctly renders 无 (none). Updated the assertion to `'无'` and removed the now-unused
    `P2P_DIRECT_ENABLED` const. Lesson: when a spec touches transport diagnostics, grep ALL specs for
    `server-relay`/`fallback`/`availableModes`, not just the unit/integration tests. (The other UI
    `star-gun` hits — TechSupport conversations, stage2 snapshots — are legitimate per spec §19.7.)
  - `07-mesh-ping-after-hub-stop.spec.ts:227` ("Jerry: did not receive mesh-ping after hub stop") is a
    **contention flake**, not a regression: it stops the hub *process* and checks mesh reachability,
    runs with `retries: 0`, and passed in prior runs. No code in the P2P-messaging phases touches the
    mesh-ping / WebRTC-session path. Likely needs lower concurrency or a retry budget at `PW_WORKERS=20`.

- **2026-06-13 (L — REVERTED after CI run):** the attempted find-similar gate
  (`expect.poll` until `connectedNeighborCount >= NUM_USERS-1`) **timed out at 90s in CI** — the
  sparse gossip overlay (capped by `maxNeighbors`) never connects all 9 peers at once, so a full-mesh
  gate is unreachable. **Reverted to the original 15× delivery poll**, which is genuine
  eventual-consistency handling across 10 independent browsers, not retry-masking. Lesson recorded
  in the table: this loop is **keep (V)**, not an L-fix candidate. The real masking signal is a loop
  that retries a *local* assertion; a loop that retries *cross-browser delivery convergence* is
  correct.

- **2026-06-13 (T3 — routing landed, E2E parked):** added
  `ResilientConversationTransport.setFailModesForE2e` fault-injection seam + injectable leg
  transports. **Routing fully proven** by `resilient-conversation-transport-fallback.test.ts`
  (4 unit tests, green: direct→relay→star, onFallback reasons). The browser spec
  `00m-transport-fallback.spec.ts` is committed but marked **`test.fixme`** pending CI iteration —
  it additionally needs (a) confirmation that server-relay delivers cross-browser in the standard
  hub (no existing spec exercises relay delivery) and (b) subscribe-side star fallback for full
  receiver render of the star leg. tsc/eslint clean; Playwright lists it (skipped).

## Confirmation command (CI)

```bash
# Baseline (current masking) then strict:
PW_WORKERS=4 npm run test:e2e                 # retries: 1 (config default)
PW_WORKERS=4 npm run test:e2e -- --retries=0  # strict — specs in the table should surface here
```
Diff the two JSON reporters; any spec green in the first and red in the second is retry-masked
and belongs in the "observed" set.
