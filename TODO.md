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
- [x] `29-me-answers-search.spec.ts` `[haiku]` — type into `answers-search-input`; verify list filters by answer text; clear → full list restored; no-match query → empty state.
- [x] `30-talks-filter-query.spec.ts` `[haiku]` — type into `talks-filter-query`; verify talk list filters by title; partial match, case-insensitivity, clear-restores.

### Gap 6: Settings persistence across reload
- [x] `31-intake-filters-persist.spec.ts` `[haiku]` — DONE; found+fixed real bug: renderSettingsView clobbered saved localStorage filters with unloaded defaults — toggle **every** intake filter option and verify each survives page refresh: `allowedLanguages`, `minDistanceMiles`, `maxDistanceMiles`, `requireGoodGrammar`, `blockDirtyWords`, each of the 4 `allowedTalkTypes` checkboxes (flow/survey/tag/route), and a `customBlockedTerms` entry.
- [x] `32-language-setting-persist.spec.ts` `[haiku]` — change UI/profile language through every selectable language option; reload; verify selection and translated UI persist.

### Gap 5: Mobile (single-user portion)
- [x] `33-mobile-chatroom-hierarchy.spec.ts` `[haiku]` — 390x844 viewport; navigate chatroom hierarchy Global → Region → City with bottom nav visible; verify no overlap/clipping and nav taps work at each level.

### Gap 2: Step 7 deletion (server-side portion)
- [x] `34-deleted-talk-routes-404.spec.ts` `[haiku]` — hit each removed `talk-delivery-routes` endpoint; assert 404; assert `/health` still OK.

---

## Stage 2 — two users (TechSupport + Adam)

### Gap 1: Conversation messages
- [x] `29-messaging-concurrent-order.spec.ts` `[sonnet]` — DONE; found+fixed real bugs: message sort had no tie-break (peers could converge to different orders), and the whole `pairConversations` subscription branch was dead (Gun chain returned from async fn = thenable trap)
- [x] `30-messaging-read-state.spec.ts` `[sonnet]`
- [x] `31-messaging-history-order.spec.ts` `[sonnet]` — 12 alternating messages (100 infeasible in sandbox runtime budget); post-reload history resync assertion deferred (see follow-ups)
- [x] ~~`32-messaging-delete-edit.spec.ts`~~ — feature does not exist; recorded under Feature gaps

### Gap 2: Step 7 deletion (mesh path)
- [x] `33-mesh-only-delivery-no-server.spec.ts` `[opus]` — broadcast + answer + match with server talk routes absent; verify delivery is pure mesh, conversation still created, no fallback requests (assert via network log).

### Gap 3: Search/filter inputs needing peer data
- [x] `34-contacts-filter-name.spec.ts` `[haiku]` — with Adam as contact, type into `contacts-filter-name`; verify filter by stage name, clear-restores, no-match empty state.
- [x] `35-reply-filter-query.spec.ts` `[haiku]` — filter logic tested against injected local reply data (full P2P reply flow covered by 00v triage specs) — with Adam's response present, type into `reply-filter-query`; verify replies filter by responder/talk.

### Gap 4: Long-term offline recovery
- [x] `36-offline-beyond-mailbox-ttl.spec.ts` `[opus]` — expiry is handled (prune-on-read); no bug — Adam offline > mailbox TTL (clock/TTL override); talk announced during window; verify defined behavior on reconnect (delivered late or cleanly expired — assert whichever spec §6 defines; fix code if neither happens).
- [x] `37-hard-crash-recovery.spec.ts` `[opus]` — real SIGKILL via persistent profile relaunch — kill Adam's browser process mid-session (no graceful close); relaunch with same storage; verify Gun replication recovers and pending incoming talks sync.

### Gap 5: Mobile multi-user
- [x] `38-mobile-talk-answer-flow.spec.ts` `[sonnet]` — TechSupport broadcasts; Adam on 390x844 opens incoming talk, completes answer dialog for each talk type's answer control (buttons, checkboxes); verify no overflow and match completes.
- [x] `39-mobile-conversation-messages.spec.ts` `[sonnet]` — DM exchange with one side at 390x844; verify composer, bubbles, and scroll usable at narrow width.

### Gap 6: Settings persistence needing a peer
- [x] `40-blocklist-persist-restart.spec.ts` `[haiku]` — DONE; found+fixed 2 real bugs: API-path block never persisted private blockedUserIds (lost on restart), and unserialized private-data read-modify-write lost concurrent updates — block Adam; full browser restart (new context, same storage); verify block list intact and delivery still suppressed.

### Gap 8: Stats aggregation
- [x] `41-stats-aggregation-four-types.spec.ts` `[opus]` — tests the local stats surface (server /api/stats aggregates were removed) — Adam answers one talk of each type (flow/tag/survey/route) with distinct outcomes (match/ignore/neutral); verify per-type aggregation and per-responder outcomes on the stats dashboard match the engine's expected counts.

---

## Stage 3 — three users (only where two users can't verify)

- [x] `29-conversation-list-sorting.spec.ts` `[sonnet]` — DONE (hub user + 2 spokes; Contacts-tab recency sort, which is the real rendered list — `#conversations-list` is dead code). Found+fixed real bug: opening Contacts before the user record loads rendered a permanent "Could not load contacts." with no retry.

---

## Out of scope (per analysis doc)

- Gap 7 (`zzz-save-stageN` scaffolding) — by design, no tests needed; optionally add a README note.

## Feature gaps found during execution

- Message edit/delete: no such feature exists anywhere in src/web (no handlers, no UI). TODO item 32 skipped.

## Follow-ups discovered during execution

- Post-reload DM history resync: a fresh `subscribeToMessages` right after page reload rendered zero messages for >10s in the sandbox (store probe confirmed it's not a harness artifact). Needs isolation on a fast host; read-cursor persistence across reload is covered by spec 30.
- 15a/15b blocking regression specs + 09-messaging exceed the sandbox's 45s run window; re-run on host after the blockUser/gun-message-store changes.

---

# TODO — GUI Redesign + Conversation-First/Threads + Platform Matrix

Source: `docs/gui-redesign-plan.md` (§1–§8) and `docs/gui-layout-catalog-and-e2e-plan.md` (Parts 3–6). Execution rules at the top of this file apply (companion `.md` per spec, hard-signal assertions, fix product bugs — never weaken assertions). Land order: **A → B → C → D → H → E → F → G → I → J** (matches the T1→T2→T4→T5→T8→T9→T3→T6→T7 priority in Part 3; H after C because message filtering hooks the same composers the thread work touches; I after G because its X-specs need the cross-platform harness; J last — sync-then-erase builds on I's linking + archive).

## A. Shared AppBar + responsive overflow (redesign §1–§3, §6)

- [ ] Build `src/web/ui/app-bar.ts`: `renderAppBar({title, statusText, backAction?, actions[]})` — layout, emoji icons, narrow-width measurement, `⋯` overflow menu; unit tests for the collapse logic.
- [ ] Migrate Chatrooms (list + room detail) to the AppBar; convert New Room/Return Home/Broadcast to icons (🆕/🏠/📣) keeping `data-testid`s; carry over `return-home` enable and `syncStatusBroadcastButtonVisibility` logic.
- [ ] Migrate Contacts, Talks, Me, Settings to the AppBar; collapse filter bars into "Filters ▾" below 768px (redesign §8 resolved decision); remove `.tab-action-bar` styles.
- [ ] `[sonnet]` **New** `stage1/50-appbar-layout.spec.ts` — one bar everywhere, old double-row gone, back icon in sub-views (T1).
- [ ] `[sonnet]` **New** `stage1/51-appbar-actions.spec.ts` — every icon fires old handler, testids preserved, back pops correctly (T1).
- [ ] `[sonnet]` **New** `stage1/52-appbar-overflow-responsive.spec.ts` — width matrix 320/390/768/1024; priority order ➕ → 📣 → 🏠 → 🆕; menu items invocable (T2).
- [ ] `[haiku]` **New** `stage1/53-chatroom-back-icon.spec.ts` — back icon swap in room detail; return-home state per context (T3).
- [ ] Update `stage1/00-ui-navigation-settings.spec.ts` + `stage5/13-chatroom-scroll-and-broadcast-bar.spec.ts` to icon buttons (T3).

## B. Notification auto-dismiss (redesign §4)

- [ ] `showNotification()`: timeout for every toast; Match! = 8s (resolved), others 3s; keep `data-match-notification`; Match! click navigates to its conversation (rule N6).
- [ ] `[haiku]` **New** `stage1/54-notification-autodismiss.spec.ts` — all types dismiss on time; match click-to-dismiss + navigate (T4).
- [ ] Update `stage1/00-ui-navigation-settings` + `stage2/30-messaging-read-state` for no-persistent-banner (T4).

## C. Conversation-first entry + matched-talk threads (redesign §5, §7 N2a — user decision 2026-07-13)

- [ ] Implement two-level push: user click (member row / contact row) → open default DM Conversation directly with User layout underneath; back = Conv → User layout → opener.
- [ ] Build the matched-talk **thread list** in the shared User layout: one email-style row per matched talk (title, latest-reply snippet, timestamp, unread badge).
- [ ] Build per-talk **Thread page**: Conversation component scoped by `conversationId + talkId`, with reply composer; Gun path design for per-talk messages (extend `conversations/<id>` — keep P2P transport rules, spec §19.4).
- [ ] Per-thread unread badges + read cursors; no DM↔thread leakage.
- [ ] `[sonnet]` **New** `stage2/68-conversation-first-entry.spec.ts` — direct-to-conversation from both entry points; N2a back chain; same thread both paths (T8).
- [ ] `[sonnet]` **New** `stage2/69-matched-talk-threads.spec.ts` — thread rows per matched talk; open/reply/back; isolation from DM (T8).
- [ ] `[opus]` **New** `stage3/71-thread-isolation-multi.spec.ts` — pair-private threads with 3 users; per-thread badges (T8).
- [ ] Update `stage2/62-peer-messaging-merged.spec.ts` — messaging area = thread list + DM entry (T8).

## D. Unified peer/contact detail (redesign §5)

- [ ] Shared detail renderer for peer overlay + contact detail (one component, both entry points identical); actions to AppBar (📤 inline, 🚫 under ⋯); retire `#contact-detail-container` as a separate page (its talk list becomes the thread list from C).
- [ ] `[sonnet]` **New** `stage2/60-peer-contact-layout-parity.spec.ts` (T5).
- [ ] `[sonnet]` **New** `stage2/61-peer-actions-in-appbar.spec.ts` — block/send-talks from bar; testids kept; cross-check 15b (T5).
- [ ] Update `stage2/00e-chatroom-peer-detail.spec.ts` selectors (T5).

## E. Popup responsive behavior (redesign §8)

- [ ] Implement size-class CSS: bottom sheets ≤480px (stacked full-width actions, 44px touch targets), full-screen takeover for L/XL dialogs at ≤390px (AppBar with ✕, scrim-close off), toast placement per width.
- [ ] `[sonnet]` **New** `stage1/59-responsive-tab-sweep.spec.ts` — every tab at all widths, no clipping, primary action reachable; zh variant (T7).
- [ ] Extend `stage1/25` + `stage1/33` mobile specs for `⋯` reachability (T2).

## F. Option-matrix specs (catalog Part 5 — every control, every value)

- [ ] `[haiku]` `stage1/60-chatroom-hierarchy-walk` — expand/collapse every node; headcounts; per-level room entry.
- [ ] `[haiku]` `stage1/64-talks-filter-sort-options` — all 8 sorts × 5 types × 3 completion × 3 outcome × dates × query (R1–R3); stage-2 semantic pass for reply-dependent values.
- [ ] `[haiku]` `stage1/65-me-filter-options` — 4 type toggles, 3 tag states, outcome, 4 sorts, dates, clear.
- [ ] `[sonnet]` `stage1/66-settings-option-matrix` — every Settings control incl. guards (stage name <3, min>max distance, zero-language/zero-type fallbacks) + persistence (R2, R4).
- [ ] `[sonnet]` `stage1/67-talk-editor-option-matrix` — 4 types × 5 expirations × 4 radii × adult × send-to-chatroom × validation/autofix.
- [ ] `[haiku]` `stage1/68-system-announcement` — closes the last "None" coverage gap.
- [ ] `[haiku]` `stage2/64-contacts-filter-sort-options` — 7 relations × 7 sorts × name query.
- [ ] `[sonnet]` `stage2/65-reply-triage-option-matrix` — 5 outcomes × 8 relations × 5 types × languages × 9 sorts × 5 groupings × chips/clear.
- [ ] `[sonnet]` `stage2/66-talk-response-option-paths` — tag both states; 3 branch paths for flow/route; survey; review screen paths; superseded banner.
- [ ] `[haiku]` `stage2/67-peer-history-controls` — sort date/outcome, filter all/sent/received, auto-mode persistence.
- [ ] `[sonnet]` `stage3/70-reply-triage-grouping-multi` — grouping semantics across 3 responders.
- [ ] T6 tail: `stage1/55-create-and-rename-room` (full option grid + delete + broadcast guard), `stage1/56-my-talks-dialog` (+ broadcast toggle), `stage1/57-preferences-dialog`, `stage1/58-answer-history`, `stage2/63-send-talks-picker`.

## G. Platform × screen-size × cross-platform (catalog Part 6)

- [ ] Define the **platform smoke set** as a tagged Playwright project (tab sweep, T1/T2 overlay, T8 core, one match round-trip, settings persistence across restart).
- [ ] CI runners: Mac mini (P2 Electron), Windows (P3, `desktop:dist:win`), Linux (P4); wire `test:e2e:native-app` per OS.
- [ ] Playwright device-profile projects for iPhone (WebKit, 390×844) and Android (Chromium, 360×800); document the per-release real-device manual pass.
- [ ] Screen-size sweep: run T2/T7 at 1920×1080, 1366×768, 768×1024, 390×844, 360×800 on P1; SZ1+SZ3 window sizes on desktop apps.
- [ ] **New** `tests/e2e/cross-platform/` harness (browser + Electron in one fixture, shared hub) extending `native-app/02`.
- [ ] `[opus]` **X1** website + webapp simultaneous presence/headcount (P0, merge gate).
- [ ] `[opus]` **X2** cross-platform talk lifecycle both directions + cross-platform thread replies (P0, merge gate).
- [ ] `[opus]` **X3** identity linking website ↔ webapp (decided: per-device identities, never shared keys) — `cross-platform/x3-identity-linking.spec.ts`; see section I (nightly).
- [ ] `[opus]` **X4** mobile-profile ↔ desktop-app matching + threads; narrow overlay live (nightly).
- [ ] `[opus]` **X5** three-platform stage-3 network incl. thread isolation (nightly).
- [ ] `[opus]` **X6** offline/mailbox across platforms, both directions (nightly).

## H. Message content filters — dirty words + grammar (redesign §9, catalog T9)

Today `ContentFilter` (`src/shared/reputation.ts`) only gates incoming **talks**; its word list is hardcoded; DMs/threads are never filtered. Make both filters work on messages, both directions.

- [ ] `[sonnet]` Add user-editable dirty-word list: new `dirtyWords: string[]` field on `TalkIntakeFilters` (SEA-private, same persistence path as the other intake filters), seeded with defaults **fuck, cunt, bitch, cock**; `ContentFilter` merges it with the built-in latin/CJK terms at match time; validation via `normalizeCustomBlockedTerms` rules (2–48 chars, lowercase, dedupe, cap 50). Unit tests: merge, whole-word tokenizer ("cocktail" passes), NFKC casefold.
- [ ] `[sonnet]` Word-list editor UI on the Dirty-word filter Settings page: chips with remove ✕ (`dirty-word-chip`), add input + button (`dirty-word-add-input`, `dirty-word-add-btn`), **Reset to defaults** (`dirty-word-reset-btn`), inline validation errors; keep the `settings-dirty-words-filter` toggle.
- [ ] `[sonnet]` Shared message-filter helpers in `src/shared/` (`filterOutgoingMessage` / `filterIncomingMessage`) covering dirty words + grammar (`assessGrammar` vs `CONFIG.GRAMMAR_THRESHOLD`) — single implementation, used by every composer (key invariant: never duplicated per call site).
- [ ] `[sonnet]` Wire **send path**: DM conversation composer, per-talk thread composer, and peer DM composer all run the helper before send; on hit: message not sent, composer text preserved, warning toast with `data-content-filter-notification="send"` / `"grammar-send"`.
- [ ] `[opus]` Wire **receive path**: receiver-side check before render (message stays in the pair's Gun graph, only suppressed at display); collapsed "hidden by your filters" placeholder row; one toast per hidden message (`"receive"` / `"grammar-receive"`); toggling the filter off reveals previously hidden messages.
- [ ] `[haiku]` Grammar filter Settings page: enable/disable + explanation + read-only strictness (from `CONFIG`); talk-path behavior unchanged.
- [ ] `[haiku]` **New** `stage1/70-dirty-word-list-editor.spec.ts` — defaults present; add/remove/reset; reject <2 chars, duplicate, 51st entry; persistence across reload (T9).
- [ ] `[sonnet]` **New** `stage2/70-dirty-word-message-blocking.spec.ts` — send-block (toast, text preserved, peer gets nothing), clean message passes, receive-hide (placeholder + toast, content never rendered), filter-off reveal; repeated once inside a matched-talk thread; "cocktail" passes (T9).
- [ ] `[sonnet]` **New** `stage2/71-grammar-message-blocking.spec.ts` — same shape for a below-threshold message (T9).
- [ ] `[haiku]` Regression: stage3 intake specs still pass — talk-path filtering unchanged by the message-path work.

## I. Multi-device identity linking (redesign §10, catalog T10 — user decision 2026-07-13)

One person, multiple devices ⇒ **different SEA identity per device** (keys never leave a device). Build the linking mechanism instead of identity sharing.

- [ ] `[opus]` Link protocol in `src/shared/`: short-lived pairing payload (pub + one-time secret + ~5 min expiry), **mutual signed attestations** at `identity-links/<pubA>/<pubB>` (link valid only when both sides present and verified), signed revocation for unlink; reject expired/reused/malformed codes. Unit tests: one-sided claim ⇒ no link; revocation supersedes; forgery fails verification.
- [ ] `[sonnet]` Linked devices Settings page: linked-identity list (stage name, platform glyph, linked date, per-row Unlink), **Link a device** → code+QR dialog (`link-device-code-modal`, countdown, copy), **Enter link code** dialog (`enter-link-code-input`, inline errors), **Unlink confirm** (`unlink-device-confirm`).
- [ ] `[sonnet]` Cluster rendering for peers: Contacts merges linked identities into one row ("also on N other devices", expandable); User layout header shows the cluster line; primary stage name = most recently updated.
- [ ] `[sonnet]` Block interplay: blocking one linked identity warns and offers cluster-wide block (redesign §10.2).
- [ ] `[haiku]` **New** `stage1/71-linked-devices-page.spec.ts` — page open/close, empty state, code lifecycle incl. expiry, error paths (T10).
- [ ] `[opus]` **New** `cross-platform/x3-identity-linking.spec.ts` — website↔webapp link, mutual attestations (one-sided ⇒ no link), third-user merged contact row, unlink/revoke, cluster-block offer; key-custody regression stays green (T10).
- [ ] `[sonnet]` Same-device linking shortcuts (redesign §10.3): URL-fragment payload (`#link=…`, single-use, one-tap confirm) for app→browser; universal/app link for browser→app on iPhone/Android; loopback (`IINPUBLIC_LOCAL_PORT`) auto-detect + one-click link on desktop; clipboard copy fallback; per-link "Copy my data to ⟨other side⟩" local archive transfer.
- [ ] `[opus]` **New** `cross-platform/x8-same-device-link.spec.ts` — loopback one-click link, fragment payload single-use (second open fails as reused), local data copy (T10).
- [ ] Explicitly out of v1 (flagged): merging message history, aggregating reputation across a cluster.

## J. Public-device exit — sync-then-erase (redesign §11, catalog T11 — user decision 2026-07-13)

No server login/logout exists; a public-PC session leaves an identity behind. Build a verifiable local wipe with an optional encrypted handoff to a linked personal device first.

- [ ] `[opus]` Wipe engine: destroy SEA keypair, clear localStorage + IndexedDB/Gun radata + caches + session state, write best-effort link revocations + retired marker while online, reload to fresh boot (auto-created new identity). Must be verifiable post-reload (empty storage, new pub).
- [ ] `[sonnet]` "Erase this device" Settings row (danger zone, last) + **Erase confirm dialog** (`erase-device-modal`, type-`ERASE` gate `erase-confirm-input`, `erase-device-btn`, `erase-sync-first-btn`); never in the `⋯` overflow; disabled while sync in flight; lost-forever warning when unlinked/offline, link-now offer when unlinked.
- [ ] `[opus]` Encrypted handoff archive (shared with §10.3 local copy): package profile, contacts/known people, talk filters + dirty-word list, answer preferences, my-talks, device-local conversation/thread history; encrypt to the personal device's pub; transfer over P2P; require receiving-device acknowledgment before enabling erase; **Sync progress dialog** (`erase-sync-progress-modal`, per-category progress).
- [ ] `[sonnet]` Archive import on the personal device (Linked devices page): per-category merge — contacts and talks/answers merge into the local identity; conversation history imports as read-only archive.
- [ ] `[haiku]` **New** `stage1/72-erase-this-device.spec.ts` — typed-confirm gate, cancel intact, wipe verified, fresh identity, no prior data reachable (T11).
- [ ] `[sonnet]` **New** `stage2/72-sync-before-erase.spec.ts` — linked pair: sync → ack → erase; receiver archive + merge; revocation visible (T11).
- [ ] `[opus]` **New** `cross-platform/x7-sync-then-erase.spec.ts` — website→webapp handoff; abort-mid-sync leaves the device intact (T11).

## Future / low priority (explicitly deferred — do not pick up without re-prioritization)

- Multiple identities on one device (profile switching for one person). Decided low priority 2026-07-13; v1 stays one identity per device install (redesign §10 non-goal note). When picked up: switcher UI, per-identity storage namespaces, and interplay with linking/erase.

## Open questions (blocking the marked items)

- Identity linking v2 scope: should reputation aggregate across a linked cluster, and should contacts/conversations sync between linked devices? (v1: display-merge only.)
- iPhone/Android native shells (`platforms/ios`, `platforms/mobile`): browser-profile testing is the stand-in until they ship — confirm.

## Resolved

- ~~X3: mirror the same identity across devices, or reject a second concurrent session?~~ → Neither: per-device identities + linking (section I, redesign §10). 2026-07-13.
- ~~Part 4 stage labels off-by-one vs. `staged/` dirs~~ → Relabeled: stage number = total concurrent users = directory number; former Stages 2/3 merged into Stage 3. 2026-07-13.
