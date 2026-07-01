# TODO — E2E Coverage Gap Tests

Source: `docs/e2e-test-analysis.md` § Coverage Gaps. Goal: a test for **every user-choosable option** currently untested.

## Execution rules (apply to every task)

1. Place spec in the **lowest stage whose user count can verify the choice** (1 user → `tests/e2e/staged/stage1-single-user/`, 2 users → `stage2-two-user/`, 3 users → `stage3-three-user/`).
2. Each spec gets a companion `.md` describing it in plain English.
3. Use existing helpers: `timing.ts` (`afterSync`/`afterAction`/`afterLoad`), `e2e-status-checks.ts`; assert via hard signals (`#status-bar-text`, local Gun IN index, `.conversation-list-item`), not toasts.
4. Run single spec: `npm run build:server && npx playwright test <spec>` (staged specs via `npm run test:e2e:staged` pipeline order).
5. **If a test exposes a real bug: fix the product code (never weaken the assertion), re-run until green.** If the feature doesn't exist at all (e.g., message editing), stop and log it under "Feature gaps found" below instead of inventing behavior.
6. Model tags minimize tokens: `[haiku]` = simple UI/persistence checks, `[sonnet]` = multi-user flows, `[opus]` = infra-heavy or complex aggregation logic.

---

## Stage 1 — single user

### Gap 3: Search/filter inputs (interactive)
- [ ] `29-me-answers-search.spec.ts` `[haiku]` — type into `answers-search-input`; verify list filters by answer text; clear → full list restored; no-match query → empty state.
- [ ] `30-talks-filter-query.spec.ts` `[haiku]` — type into `talks-filter-query`; verify talk list filters by title; partial match, case-insensitivity, clear-restores.

### Gap 6: Settings persistence across reload
- [ ] `31-intake-filters-persist.spec.ts` `[haiku]` — toggle **every** intake filter option and verify each survives page refresh: `allowedLanguages`, `minDistanceMiles`, `maxDistanceMiles`, `requireGoodGrammar`, `blockDirtyWords`, each of the 4 `allowedTalkTypes` checkboxes (flow/survey/tag/route), and a `customBlockedTerms` entry.
- [ ] `32-language-setting-persist.spec.ts` `[haiku]` — change UI/profile language through every selectable language option; reload; verify selection and translated UI persist.

### Gap 5: Mobile (single-user portion)
- [ ] `33-mobile-chatroom-hierarchy.spec.ts` `[haiku]` — 390x844 viewport; navigate chatroom hierarchy Global → Region → City with bottom nav visible; verify no overlap/clipping and nav taps work at each level.

### Gap 2: Step 7 deletion (server-side portion)
- [ ] `34-deleted-talk-routes-404.spec.ts` `[haiku]` — hit each removed `talk-delivery-routes` endpoint; assert 404; assert `/health` still OK.

---

## Stage 2 — two users (TechSupport + Adam)

### Gap 1: Conversation messages
- [ ] `29-messaging-concurrent-order.spec.ts` `[sonnet]` — both sides send messages near-simultaneously; verify both conversations converge to identical, timestamp-consistent order.
- [ ] `30-messaging-read-state.spec.ts` `[sonnet]` — send → receiver opens conversation → verify read cursor updates and unread badge clears on both reload and re-open (extends `10-message-unread-badge`).
- [ ] `31-messaging-large-history.spec.ts` `[sonnet]` — script ~100 messages; verify scroll performance, oldest/newest reachable, order stable after reload.
- [ ] `32-messaging-delete-edit.spec.ts` `[sonnet]` — exercise message deletion/editing **if the UI offers it**; if not present, record under Feature gaps and skip.

### Gap 2: Step 7 deletion (mesh path)
- [ ] `33-mesh-only-delivery-no-server.spec.ts` `[opus]` — broadcast + answer + match with server talk routes absent; verify delivery is pure mesh, conversation still created, no fallback requests (assert via network log).

### Gap 3: Search/filter inputs needing peer data
- [ ] `34-contacts-filter-name.spec.ts` `[haiku]` — with Adam as contact, type into `contacts-filter-name`; verify filter by stage name, clear-restores, no-match empty state.
- [ ] `35-reply-filter-query.spec.ts` `[haiku]` — with Adam's response present, type into `reply-filter-query`; verify replies filter by responder/talk.

### Gap 4: Long-term offline recovery
- [ ] `36-offline-beyond-mailbox-ttl.spec.ts` `[opus]` — Adam offline > mailbox TTL (clock/TTL override); talk announced during window; verify defined behavior on reconnect (delivered late or cleanly expired — assert whichever spec §6 defines; fix code if neither happens).
- [ ] `37-hard-crash-recovery.spec.ts` `[opus]` — kill Adam's browser process mid-session (no graceful close); relaunch with same storage; verify Gun replication recovers and pending incoming talks sync.

### Gap 5: Mobile multi-user
- [ ] `38-mobile-talk-answer-flow.spec.ts` `[sonnet]` — TechSupport broadcasts; Adam on 390x844 opens incoming talk, completes answer dialog for each talk type's answer control (buttons, checkboxes); verify no overflow and match completes.
- [ ] `39-mobile-conversation-messages.spec.ts` `[sonnet]` — DM exchange with one side at 390x844; verify composer, bubbles, and scroll usable at narrow width.

### Gap 6: Settings persistence needing a peer
- [ ] `40-blocklist-persist-restart.spec.ts` `[haiku]` — block Adam; full browser restart (new context, same storage); verify block list intact and delivery still suppressed.

### Gap 8: Stats aggregation
- [ ] `41-stats-aggregation-four-types.spec.ts` `[opus]` — Adam answers one talk of each type (flow/tag/survey/route) with distinct outcomes (match/ignore/neutral); verify per-type aggregation and per-responder outcomes on the stats dashboard match the engine's expected counts.

---

## Stage 3 — three users (only where two users can't verify)

- [ ] `29-conversation-list-sorting.spec.ts` `[sonnet]` — TechSupport has conversations with Adam and Eve; interleave new messages; verify conversation list re-sorts most-recent-first after each message and after reload. (Gap 1 — multi-partner sorting requires ≥3 users.)

---

## Out of scope (per analysis doc)

- Gap 7 (`zzz-save-stageN` scaffolding) — by design, no tests needed; optionally add a README note.

## Feature gaps found during execution

(Record here any option the analysis assumes exists but the code doesn't implement — e.g., message edit/delete — instead of writing speculative tests.)
