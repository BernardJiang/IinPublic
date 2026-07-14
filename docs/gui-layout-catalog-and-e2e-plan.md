# GUI Layout Catalog, E2E Coverage & Test Plan

Companion to `docs/gui-redesign-plan.md`. Six parts: (1) a catalog of every existing screen/layout grouped by function (with the full layout tree and navigation graph in 1B), (2) how well each is covered by the current 139-spec Playwright suite, (3) the e2e test plan the redesign must ship with, (4) the stage-based functional plan organized by user count, (5) the exhaustive per-control option matrix that pins every user-facing option to a covering spec, and (6) the platform × screen-size × cross-platform matrix.

Coverage was measured by counting `tests/e2e/**/*.spec.ts` files that reference each screen's identifying selector/testid. Counts are "how many spec files touch this surface," not assertion depth. Legend: **Strong** ≥8 · **Good** 4–7 · **Thin** 1–3 · **None** 0.

---

## Part 1 — Layout catalog (by functionality)

### A. App shell & global chrome
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| A1 | Bottom navigation bar | `.bottom-nav` / `.nav-btn` / `bottom-navigation-button-*` | Strong | 88 |
| A2 | Top header (title + status + `➕`) | `#top-header` / `#header-status` / `#create-talk-btn` | Good (via tab flows) | ~9 |
| A3 | Per-view action bar (row 2) | `.tab-action-bar` (`chatroom/contacts/talks/me/settings`) | Good | — |
| A4 | Toast notifications | `.notification`, `showNotification()` | Good | 7 |
| A5 | Location-room suggestion banner | `showLocationRoomSuggestion()` / `#location-room-suggestion` | Thin | ~1 |
| A6 | System announcement banner | `showSystemAnnouncement()` / `#system-announcement-*` | None | 0 |

### B. Chatrooms
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| B1 | Chatroom list (hierarchy tree) | `#chatroom-list` / `chatrooms-view.ts renderChatroomList` | Moderate | 4 |
| B2 | Chatroom detail (members + metadata) | `#chatroom-detail-container` / `#chatroom-members-list` / `#current-chatroom-title` | Good | 6 |
| B3 | Create custom chatroom dialog | `showCreateCustomChatroomDialog()` / `create-custom-chatroom-btn` | Thin | 2 |
| B4 | Rename custom chatroom dialog | `showRenameCustomChatroomDialog()` | Thin | ~1 |
| B5 | Broadcast action + bulk ack | `#broadcast-talk-btn` / `#broadcast-bulk-ack` | Good | ~7 |

### C. Contacts & peers
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| C1 | Contacts list (filters/sort) | `#contacts-list` / `displayContactsList` | Strong | 16 |
| C2 | Contact detail (talks with user) | `#contact-detail-container` / `#contact-talks-list` | Thin | 2 |
| C3 | Contact relationship modal | `close-contact-relationship-modal` / relationship label | Strong | 10 |
| C4 | **Peer detail overlay (one-on-one)** — the messy screen | `#peer-detail-overlay` / `peer-dm-input` / `peer-send-talks-btn` / `peer-block-user-btn` | Good | 7 |
| C5 | Send-My-Talks picker (inside peer) | `confirm-send-picker` / `send-picker` | Thin | 1 |

### D. Talks
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| D1 | Talks view (All/IN/OUT + filter bar) | `#talks-view` / `.talks-nav-btn` / talks filters | Strong | 9 |
| D2 | Creator "Replies To My Talks" triage panel | `#creator-replies-panel` / `reply-filter-*` | Good | ~4 |
| D3 | Talk editor dialog (create/edit, 4 types) | `#talk-editor-modal` / `showTalkEditorDialog` | Strong | 33 |
| D4 | Talk response dialog (answer incoming) | `#talk-response-modal` / `showTalkResponseDialog` | Strong | 8 |
| D5 | My Talks dialog | `#close-my-talks-modal` / `showMyTalksDialog` | Thin | 1 |
| D6 | Talk completion notice | `showTalkCompletion()` | Thin | ~1 |

### E. Conversations / messaging
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| E1 | Conversations list (Me tab) | `#conversations-list` / `displayConversationsList` | Good | ~5 |
| E2 | Conversation detail overlay (chat) | `#conversation-detail-overlay` / `#conversation-message-input` / `#conversation-user-name` | Strong | 10 |

### F. Me / profile
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| F1 | Me view (profile summary + reputation) | `#me-view` / `.me-talk-type-filter` | Good | 7 |
| F2 | Answer history list + search | `answers-view.ts` / `#me-answers-search` | Thin | 2 |
| F3 | Edit stage name dialog | `stage-name-input` / `save-stage-name-button` | Strong | 23 |
| F4 | Edit profile dialog (languages/profile) | `showEditProfileDialog` / `settings-profile-languages` | Good | 5 |

### G. Settings
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| G1 | Settings view (stage name, photo, languages, distance, filters) | `#settings-view` / `#settings-content` | Strong | 23 |
| G2 | Camera capture modal | `#settings-camera-capture-modal` / `settings-camera-capture` | Thin | 1 |
| G3 | Photo preview / confirm modal | `settings-photo-preview-confirm/cancel` | Thin | 1 |
| G4 | Preferences dialog | `#close-preferences-modal` / `showPreferencesDialog` | Thin | 1 |
| G5 | Intake-filter controls (language/distance/content) | `settings-filter-*` | Good (via intake specs) | ~6 |

### H. Identity & gating
| # | Layout | Key selector / builder | Coverage | Spec count |
|---|---|---|---|---|
| H1 | Age verification / gating | age-gate / `vouchAgeVerified` / `ageVerified` | Good | 3 |
| H2 | User creation (automatic, no modal) | `showUserCreationDialog()` (no UI) | n/a | — |

---

## Part 1B — Full layout tree, page count & navigation graph

This is the **target** information architecture (the redesign's intended tree), not just today's DOM. It formalizes the structure requested: 5 tabs off the main page, people and conversations shared between Chatrooms and Contacts, Talks and Me sharing the editor, and a restructured Settings where only stage name + headshot are "profile" and everything else is an itemized, individually-openable setting page.

### Tree

```
Main App  ── persistent bottom nav: 5 tabs ──────────────────────────────
│
├─ 1. CHATROOMS
│   └─ Chatroom list  (hierarchy: Global ▸ Region ▸ City; expand/collapse)
│       ├─ Create Room            (page)
│       ├─ Rename Room            (page)
│       └─ Room detail            (members + headcount + metadata)  e.g. "Global"
│           └─ (tap a member → Conversation ⟨SHARED⟩ opens DIRECTLY; back lands on User layout)
│               User layout ⟨SHARED⟩  (matched-talk thread list, email-style)
│               ├─ Conversation ⟨SHARED⟩      (default DM thread)
│               └─ Talk thread ⟨SHARED⟩ ×N    (one reply-able thread per matched talk)
│
├─ 2. CONTACTS
│   └─ Contacts list  (filter by name/relation, sort)
│       ├─ Relationship editor    (set relation / nickname)
│       └─ (tap a contact → Conversation ⟨SHARED⟩ opens DIRECTLY; back lands on User layout)
│           User layout ⟨SHARED⟩  (same screen + threads as via Chatrooms)
│
├─ 3. TALKS
│   └─ Talks list  (All / IN / OUT · sort · filter bar)
│       ├─ Creator replies triage (Replies To My Talks)
│       ├─ Talk detail / responses
│       ├─ Talk Editor ⟨SHARED⟩   (Create / Edit)          ← also from Me
│       └─ Talk Response          (answer an incoming talk)
│
├─ 4. ME
│   └─ Q&A list  (flattened answers · sort · type/state filters)
│       ├─ Q&A detail
│       └─ Talk Editor ⟨SHARED⟩   (Create / Edit a Q&A = talk) ← also from Talks
│
└─ 5. SETTINGS
    ├─ Profile  (top only)  ──────────  stage name + headshot ONLY
    │   ├─ Edit Stage Name   (page)
    │   └─ Headshot          (page)  → Camera capture · Photo preview
    ├─ Itemized settings  (each row opens its OWN page, with open/close where applicable)
    │   ├─ Profile languages
    │   ├─ Incoming language filter
    │   ├─ Distance filter (min / max)
    │   ├─ Grammar filter          (own page, explicit open/close)
    │   ├─ Dirty-word filter       (own page, explicit open/close)
    │   ├─ Sent-after / cutoff
    │   ├─ Location  (refresh / auto-assign)
    │   ├─ Travel mode
    │   ├─ Age verification
    │   └─ Feature toggles / preferences
    ├─ Credit / Reputation   (read-only submenu)
    └─ Development settings   (at end)

Auxiliary overlays (not primary tree; float over any screen):
  · Toast notifications (auto-dismiss)     · Send-My-Talks picker
  · My Talks dialog                        · Location-room suggestion banner
  · System announcement banner
```

### Page count

Counting **distinct page/layout types** (shared nodes counted once):

| Group | Pages | Count |
|---|---|---|
| Tab roots | Chatrooms list, Contacts list, Talks list, Me (Q&A) list, Settings root | 5 |
| Chatrooms | Room detail, Create Room, Rename Room | 3 |
| Contacts | Relationship editor | 1 |
| Shared people/messaging | User layout, Conversation, Talk thread (per matched talk) | 3 |
| Talks | Creator replies triage, Talk detail/responses, Talk Response | 3 |
| Shared editor | Talk Editor (Talks + Me) | 1 |
| Me | Q&A detail | 1 |
| Settings · profile | Edit Stage Name, Headshot, Camera capture, Photo preview | 4 |
| Settings · itemized | languages, incoming-language, distance, grammar, dirty-word, cutoff, location, travel, age-verify, feature toggles | 10 |
| Settings · read-only | Credit / Reputation | 1 |
| Settings · dev | Development settings | 1 |
| **Primary pages subtotal** | | **33** |
| Auxiliary overlays | notifications, send-talks picker, My Talks dialog, location-suggestion banner, system-announcement banner | 5 |
| App shell | bottom-nav frame | 1 |
| **Grand total** | | **≈ 39** |

So: **33 distinct primary pages**, plus the shell and ~5 floating overlays ≈ **39 navigable layouts**. (Instance counts are unbounded — one Room/User/Conversation/Thread/Talk page type renders per room, per user, per thread, per matched talk.)

### Navigation graph — pages travel to and from one another

The tree is a hierarchy, but several nodes are **shared destinations reachable from multiple parents**, and each stacks a back-path to wherever it was entered from:

- **Conversation-first entry (redesign §5, rule N2a).** Clicking a user from **(a) a Chatroom room's member list** or **(b) the Contacts list** opens the **default DM Conversation directly**; the User layout is pushed underneath it, so back goes Conversation → User layout → opener. The same underlying thread must resolve to the same Conversation regardless of entry point.
- **User layout ⟨SHARED⟩** is one component, identical from both entry points (redesign §5). Its body is the **matched-talk thread list** (email-style: talk title as subject, latest reply snippet, timestamp, unread badge) plus the relationship/stats header and the DM entry.
- **Talk thread ⟨SHARED⟩ ×N** — each matched talk expands from the User layout into its own reply-able Conversation page scoped to that talk; back returns to the User layout. Threads use the same Conversation component as the DM, keyed by `conversationId + talkId`. (Conversations are reached *through people*; the Me tab no longer hosts a standalone conversation list — that relocates under the user layout.)
- **Talk Editor ⟨SHARED⟩** is reachable from **Talks** (create/edit a talk) and from **Me** (create/edit a Q&A, which is a talk) — same editor, **context differs**: Talks opens it in talk-authoring context, Me opens it seeded from the answer/Q&A context.
- **Talk Response** is reached from an **incoming-talk entry point** (Talks ▸ IN, or a talk-received notification).
- **Settings itemized pages** each open from the Settings root and close back to it; **Grammar filter** and **Dirty-word filter** are their own pages with an explicit **open/close (enable/disable)** control plus their configuration, not inline toggles.

**Traversal contract (used by the e2e plan below):** every stage must visit every tree page reachable given the users present, and must exercise the shared-destination edges — click a user from *both* Chatrooms and Contacts and land directly on the same Conversation, back out to the same User layout from both, open at least one per-talk Thread from the User layout and reply in it, and open the Talk Editor from *both* Talks and Me.

---

## Part 2 — Coverage summary

**~30 distinct layouts.** By band:

- **Strong (≥8 specs):** bottom nav, talk editor, settings view, edit stage name, contacts list, relationship modal, conversation detail, talks view, talk response. → The core matching/messaging path is well protected.
- **Good (4–7):** chatroom detail, peer detail overlay, me view, edit profile, notifications, broadcast, creator-replies, conversations list, age gating.
- **Thin (1–3) — the fragile tail, usually one spec each (often the single mega-spec `stage1/00-ui-navigation-settings.spec.ts`):** create-room dialog (2), rename-room (1), contact detail (2), send-talks picker (1), My Talks dialog (1), preferences dialog (1), camera modal (1), photo-preview modal (1), answer history (2), talk completion (1), location-suggestion banner (1).
- **None (0):** system announcement banner; and — critical for this redesign — **the responsive overflow / `⋯` more-menu behavior does not exist yet, so it has zero coverage.**

**Key risks for the redesign:**
1. Many "Thin" screens lean on one spec, and several of those pile into `stage1/00-ui-navigation-settings.spec.ts`. Refactoring the shell can break that file broadly; per-screen specs would localize failures.
2. **Narrow-width overflow is brand-new behavior with no test.** This is the single biggest new-coverage gap the redesign introduces.
3. The peer↔contact "same layout" unification (redesign §5) has no test asserting the two entry points render an equivalent screen.

---

## Part 3 — E2E test plan for the redesign

Organized by redesign change (see `gui-redesign-plan.md` §1–6). **New** = spec to add; **Update** = extend/adjust an existing spec. Priority P0 (blocker) → P2 (nice-to-have). New specs follow the repo convention: a `.spec.ts` plus a plain-English companion `.md`.

### T1 — Shared AppBar component (redesign §1, §6)
- **New** `stage1/50-appbar-layout.spec.ts` (P0): the single top bar renders on every tab; exactly one bar (assert the old stacked `#top-header` + `.tab-action-bar` double-row is gone); left zone shows title at list root and a back **icon** inside a sub-view; center status text present and truncates; right zone shows action icons.
- **New** `stage1/51-appbar-actions.spec.ts` (P0): each action icon fires the same handler as before and preserves its `data-testid` (`create-custom-chatroom-btn`, `return-home-btn`, `broadcast-talk-btn`, create-talk). Back icon returns to the parent list from chatroom detail, peer detail, conversation, contact detail.

### T2 — Responsive overflow "⋯" menu (redesign §2) — *highest-value new coverage*
- **New** `stage1/52-appbar-overflow-responsive.spec.ts` (P0): drive `setViewportSize` across a width matrix (e.g. 1024 / 768 / 390 / 320). At wide width all icons are inline and no `⋯`; as width shrinks, lowest-priority icons move into the `⋯` menu (assert inline count decreases and the moved actions appear as labeled menu items); every action remains invocable from the menu and still triggers its handler. Assert priority order (create-talk stays longest, etc.).
- **Update** `stage1/25-mobile-viewport-navigation.spec.ts` + `stage1/33-mobile-chatroom-hierarchy.spec.ts` (P1): confirm chatroom actions are reachable via `⋯` at mobile width.

### T3 — Chatrooms single-bar migration (redesign §2, §3)
- **Update** `stage1/00-ui-navigation-settings.spec.ts` (P0): re-point "New Room / Return Home / Broadcast" assertions from text buttons to icon buttons (via `data-testid`, so most assertions survive).
- **Update** `stage5/13-chatroom-scroll-and-broadcast-bar.spec.ts` (P0): broadcast is now a top-bar icon; assert visibility/enablement logic (`syncStatusBroadcastButtonVisibility`) still holds.
- **New** `stage1/53-chatroom-back-icon.spec.ts` (P1): entering a room swaps the left zone to a back icon; clicking it returns to the tree; `return-home` enable/disable state is correct in both contexts.

### T4 — Notification auto-dismiss (redesign §4)
- **New** `stage1/54-notification-autodismiss.spec.ts` (P0): every toast type (info/success/warning/error **and** the "Match!" notice) disappears within its timeout without a click; match notice still carries `data-match-notification` and is still click-to-dismiss before timeout.
- **Update** `stage1/00-ui-navigation-settings.spec.ts` and `stage2/30-messaging-read-state.spec.ts` (P0): adjust any assertion that assumed the match banner persists indefinitely; badge assertions unchanged.

### T5 — Unified peer / contact detail (redesign §5)
- **New** `stage2/60-peer-contact-layout-parity.spec.ts` (P0): open the same user from (a) a chatroom member row and (b) the Contacts tab; assert both render the shared detail component with the same structural regions (header, messaging area, talk history) in the same order.
- **New** `stage2/61-peer-actions-in-appbar.spec.ts` (P0): Block User and Send-My-Talks are top-bar icons (in-bar or under `⋯`); each still works (`peer-block-user-btn`, `peer-send-talks-btn`, `confirm-send-picker` testids preserved). Block still stops delivery — cross-check with `stage2/15b-blocking-*`.
- **New** `stage2/62-peer-messaging-merged.spec.ts` (P1): the conversation list ("Open Chat") and the message composer live in one merged messaging area; opening a chat and sending a message both work from that single region (ties into the recently-fixed stale-name + new-message-toast behavior).
- **Update** `stage2/00e-chatroom-peer-detail.spec.ts` (P0): re-point selectors to the new layout.

### T6 — Regression protection for the "Thin" tail (before migrating them)
Add focused specs so shell refactors don't silently break single-spec screens:
- **New** `stage1/55-create-and-rename-room.spec.ts` (P1) — B3/B4.
- **New** `stage1/56-my-talks-dialog.spec.ts` (P1) — D5.
- **New** `stage1/57-preferences-dialog.spec.ts` (P2) — G4.
- **New** `stage1/58-answer-history.spec.ts` (P2) — F2 (beyond the current search-only spec).
- **New** `stage2/63-send-talks-picker.spec.ts` (P2) — C5.
- Camera/photo modals (G2/G3): keep in `stage2/04-profile-edit-stage-name.spec.ts`; add width check that its controls collapse gracefully (P2).

### T7 — Cross-cutting responsive sweep
- **New** `stage1/59-responsive-tab-sweep.spec.ts` (P1): extend the existing `00x-tab-sweep-smoke` idea across the width matrix — visit every tab at wide + narrow, assert no horizontal overflow/clipping and that each tab's primary action is reachable (inline or via `⋯`). Add the Chinese-locale variant to mirror `00y`/`00z` so icon+overflow works with longer localized menu labels.

### T8 — Conversation-first entry + matched-talk threads (redesign §5, rule N2a)
- **New** `stage2/68-conversation-first-entry.spec.ts` (P0): clicking a user from a room member row and from a Contacts row both land **directly on the Conversation page**; back from the Conversation lands on the User layout; back again returns to the correct opener (room detail vs. Contacts list); both entry paths resolve to the same thread.
- **New** `stage2/69-matched-talk-threads.spec.ts` (P0): after ≥2 matched talks, the User layout shows one email-style row per matched talk (title, latest-reply snippet, timestamp, unread badge); opening a row shows only that talk's history; sending a reply delivers to the peer's same thread (and only that thread); back returns to the User layout; DM messages never leak into talk threads and vice versa.
- **New** `stage3/71-thread-isolation-multi.spec.ts` (P1): with 3 users, A↔B threads are invisible to C (pair-private isolation extended to per-talk threads); unread badges count per-thread.
- **Update** `stage2/62-peer-messaging-merged.spec.ts` (P0): the merged messaging area is now the thread list + DM entry; re-point assertions.

### Execution & gates
- Path shorthand: `stageN/…` in this doc means `tests/e2e/staged/stageN-<suffix>/…` (`stage0-bootstrap`, `stage1-single-user`, `stage2-two-user`, `stage3-three-user`, `stage4-four-user`, `stage5-multi-user`).
- Run per-stage during development; full gate before merge: `npm run health` (type-check + lint + unit + integration + both builds) then the affected E2E subsets, then `npm run test:e2e:parallel` for the full suite.
- Keep every migrated control's existing `data-testid` to minimize churn; where a control moves into the `⋯` menu, the menu item must reuse the same testid.
- Priority order to land: **T1 → T2 → T4 → T5 → T8 → T3 → T6 → T7** (shared component and its brand-new overflow behavior first, then notifications, then the peer/contact unification and the conversation-first/thread model, then the tail).

### New-coverage scorecard (target)
| Redesign area | Coverage today | After plan |
|---|---|---|
| Single top bar / AppBar | none (implicit only) | T1 |
| Responsive `⋯` overflow | **none** | T2, T7 |
| Notification auto-dismiss | partial/contradictory | T4 |
| Peer↔contact layout parity | none | T5 |
| Chatroom icon actions | text-button only | T3 |
| Thin-tail dialogs | 1 spec each | T6 |
| Conversation-first entry + talk threads | **none** (new behavior) | T8 |
| Platform / cross-platform coverage | native-app only (3 specs) | Part 6 |

---

## Part 4 — Stage-based functional e2e plan (organized by number of users)

Part 3 (T1–T7) covers the *redesign mechanics*. Part 4 is the *functional* suite, organized by how many users are present. Each stage builds on the saved state of the prior one (matching the repo's `zzz-save-stageN` pattern). The rule for every stage: **use the Traversal contract from Part 1B** — visit every tree page reachable with the users present, and exercise every function that becomes possible at that user count. The redesign overlay (T1–T7, especially the narrow-viewport `⋯` overflow) is asserted on the relevant screens within each stage rather than only in isolation.

### Stage 0 — TechSupport only (0 peers): exhaustive single-user clickability + baseline

TechSupport must click through **every** reachable item and establish the empty-world baseline.

- **Identity:** boot as TechSupport; assert stage name is exactly `TechSupport`.
- **Chatrooms:** traverse the full default hierarchy **one room at a time** (Global ▸ each Region ▸ each City); expand/collapse every node; enter each room and **verify headcount** (the room(s) TechSupport occupies show 1; all others show 0); use Return Home; create a custom room, then rename it; confirm Broadcast with an empty OUT list shows the proper guard (no crash).
- **Contacts:** open Contacts → assert **zero contacts** (empty state); exercise the name/relation filters and every sort option on the empty list (no error).
- **Talks:** create **3 talks of each type** — tag, flow, survey, route (**12 total**) — using the editor's per-type structure (checkbox items / branching flow / survey questions / route DAG); confirm all appear in OUT; exercise the sort control and every filter (type, status, outcome, date range, text query).
- **Me:** open Me → assert the flattened **Q&A reflects the 12 created talks** (each talk's questions/answers appear); exercise Q&A sort + type/state filters; **create one new talk from the Me tab** (Me ▸ Talk Editor, one type) and assert it appears in **both** Me and Talks (shared-editor edge).
- **Settings — walk every page:** Profile shows stage name `TechSupport` + headshot control; open **Edit Stage Name** (open→close), **Headshot** → Camera capture + Photo preview (open→close). Then open each itemized page and back out: profile languages, incoming-language filter, distance min/max, **Grammar filter page (toggle open→close)**, **Dirty-word filter page (toggle open→close)**, cutoff/sent-after, location refresh, travel mode, age verification, feature toggles. Open **Credit/Reputation** and assert it is **read-only**. Open **Development settings**. Assert each page opens, its control responds, and back returns to the Settings root.
- **Notifications:** any toast raised during the run auto-dismisses (T4).

### Stage 1 — + Adam (1 peer): full two-party talk lifecycle, all types, varied answers

- **Onboard:** Adam boots, sets stage name + profile, lands in Global; **headcount = 2**.
- **Adam answers all of TechSupport's talks.** For each **same-type triple**, Adam gives **three different answers** (e.g. match / mismatch / ignore, or three distinct branch paths), across all four types.
- **Verify on Adam's side:** each talk's outcome is recorded (match vs mismatch/ignore); a conversation is created on match and **not** on mismatch/ignore.
- **Verify on TechSupport's side:** the Creator "Replies To My Talks" triage shows Adam's reply per talk with the correct outcome; matched talks create the conversation.
- **Messaging + shared destinations (conversation-first):** Adam clicks TechSupport **in the room** and lands **directly on the Conversation**; sends a message; TechSupport gets the new-message toast + badge **without** opening it, then opens and replies; both sides show ordered history. Adam presses back → **User layout** (thread list visible), opens a **matched-talk Thread**, replies in it, back → User layout, back → room detail. Then click TechSupport **from Contacts** (now a contact) and assert it lands on the **same Conversation/thread** (shared-edge + N2a back-chain check).

### Stage 2 — 2 real peers (Adam + Eve) [+ TechSupport]: peer↔peer core

- **Matching:** both create/broadcast talks; cross-answer; verify matches/mismatches on both sides for all types.
- **Messaging depth:** concurrent-send ordering; unread badge; read-state cursor persistence; history order after reload; offline delivery via mailbox; new-message toast when not viewing the thread.
- **Layout parity (T5):** open Eve from a **room** and from **Contacts** → identical shared User layout; Block and Send-My-Talks work from the top bar.
- **Blocking:** Adam blocks Eve → delivery stops + peer hidden; unblock resumes; blocklist persists across restart.
- **Contacts:** relationship editor (friend/relative/nickname); contact detail talk history; filter by name.
- **Reputation:** block count, peer star rating, vouch threshold; age-verify vouch flips 18+.
- **Rename propagation:** Eve renames → the new name shows in the chatroom, the User-layout header, **and** the Conversation header (the recently-fixed stale-name bug).

### Stage 3 — 3 users: multi-responder talks + network effects

- **Multi-responder lifecycles:** one creator, multiple responders per talk for tag / flow / survey / route.
- **Triage matrix:** Creator reply triage grouped by date and filtered by outcome / stage name across 3 responders.
- **Intake filters end-to-end** with a distinct third user: language, distance, content (dirty-word/grammar), custom cutoff, talk-type — each filter produces the correct include/exclude; **pair-private isolation** (A↔B messages invisible to C).
- **Network:** contacts network + relationship credit across 3 users; find-similar-people; profile privacy/visibility; chatbot auto-reply + bot badge; ignore-then-change-answer; mismatch paths.

### Stage 4 — 4 users: capacity + membership integrity

- **Capacity eviction:** the 4th user triggers the room eviction rule; verify resulting headcount and who remains.
- **Membership pruning:** stale/crash room-membership pruning with 4 members; headcount self-corrects after a peer crash/disconnect.

### Stage 5 — multi / saturation (5–20 users): scale + broadcast fan-out

- **Broadcast at scale:** super-user broadcasts to 20; every recipient receives; bulk ack; broadcast-bar behavior under scroll.
- **Spread + mass exchange:** regional capacity spread; mass exchange of each talk type (flow / survey / route) at scale; mesh-only delivery with the server down; presence at scale.

### Stage coverage matrix (function → first stage it is exercised)

| Function area | S0 | S1 | S2 | S3 | S4 | S5 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Every-page clickability sweep | ✓ | | | | | |
| Chatroom hierarchy + headcount | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/rename room | ✓ | | | | | |
| Empty contacts state | ✓ | | | | | |
| Create talks (all 4 types) | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Talk sort/filter controls | ✓ | | | | | |
| Me Q&A mirror + create from Me | ✓ | | | | | |
| Full Settings page walk | ✓ | | | | | |
| Grammar / dirty-word filter pages | ✓ | | | ✓ | | |
| Credit/Reputation read-only | ✓ | | ✓ | | | |
| Answer talks + outcomes (varied) | | ✓ | ✓ | ✓ | | |
| Creator reply triage | | ✓ | ✓ | ✓ | | |
| User layout from room + contacts | | ✓ | ✓ | | | |
| Conversation (both entry paths) | | ✓ | ✓ | | | |
| Messaging (order/unread/offline) | | ✓ | ✓ | | | |
| Blocking / unblock / persist | | | ✓ | ✓ | | |
| Reputation (rating/vouch/age) | | | ✓ | ✓ | | |
| Rename propagation everywhere | | | ✓ | | | |
| Intake filters (lang/dist/content/type) | | | | ✓ | | |
| Pair-private isolation | | | | ✓ | | |
| Multi-responder lifecycles | | | | ✓ | | |
| Capacity eviction / pruning | | | | | ✓ | ✓ |
| Broadcast fan-out at scale | | | | | | ✓ |
| Mesh-only / server-down delivery | | | | | | ✓ |
| Redesign overlay (T1–T7, `⋯` overflow) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Part 5 — Exhaustive user-option matrix (every control, every value)

Parts 3–4 say *which screens* get specs; this part pins **every user-facing control and every one of its values** to a covering spec, so "all user options are tested thoroughly" is checkable line by line. Selectors are the current ones from `src/web/ui/*`; the redesign must preserve them (Execution & gates).

### 5.0 Coverage rules (apply to every row below)

- **R1 — Enumerations:** every `<select>` option / radio value / mode button is selected at least once, with an assertion on the rendered effect (list re-orders, rows filtered, form section swaps), not just on the control's value.
- **R2 — Toggles:** every checkbox/toggle is exercised in **both** directions; where the value persists (intake filters, feature toggles, auto-mode, broadcast enable), assert persistence across reload.
- **R3 — Text/date filters:** each gets a hit case, a miss case (empty-result state renders, no error), and a clear/reset case.
- **R4 — Validation guards:** every guard is driven with invalid input and asserted to block with its message (room name < 2, stage name < 3, min > max distance, empty-OUT broadcast, editor validation errors, zero-language / zero-type fallback to defaults).
- **R5 — Narrow reachability:** each control is reachable and operable at 320px (inline, in the "Filters ▾" panel, or under `⋯` — redesign §8/T2).
- **R6 — Locale:** rows marked 🌐 run a Chinese-locale variant (mirrors `00y`/`00z`).

### 5.1 App shell & chatrooms

| Control (selector) | Values / states | Assert | Spec | Stage |
|---|---|---|---|---|
| Bottom nav ×5 (`bottom-navigation-button-*`) | each tab, incl. re-tap of active tab | tab root shown; re-tap scrolls to top; sub-view popped (rule N1) 🌐 | T1 `stage1/50` + existing `00x` sweep | 1 |
| AppBar back icon | from room detail, ⟨User⟩, ⟨Conv⟩, contact origin, Q&A detail, Settings item | pops exactly one level to opener | T1 `stage1/51` | 1–2 |
| `⋯` overflow | width matrix 320/390/768/1024 | inline count shrinks per priority (➕, 📣, 🏠, 🆕); menu items fire handlers, keep testids 🌐 | T2 `stage1/52` | 1 |
| Hierarchy node caret | expand + collapse every node | children shown/hidden; no push | **New** `stage1/60-chatroom-hierarchy-walk` | 1 |
| Room row → detail | one leaf per level + custom room | headcount correct (occupied 1 / others 0) | `stage1/60` + existing headcount specs | 1 |
| `create-custom-chatroom-btn` → dialog | type=community; type=business (headline appears, filled/empty); description empty/filled; capacity empty/1/50000; name 1 char (R4) / 80 chars; cancel; scrim | created room opened; business headline stored; guard toast on short name | T6 `stage1/55` (extend to full option grid) | 1 |
| Rename dialog (`rename-custom-room-input`) | valid rename; 1-char (R4); cancel; scrim | new name in list + detail + AppBar center | T6 `stage1/55` | 1 |
| `chatroom-delete-btn` | owner deletes | back to list; room gone | `stage1/55` | 1 |
| `return-home-btn` | disabled at home; enabled in travel; click | guard state per context; lands in home room | existing travel specs + T3 `stage1/53` | 1 |
| `broadcast-talk-btn` → preamble | empty OUT (guard, R4); non-empty: `broadcast-preamble-send` / `-cancel` / scrim | guard toast; send ⇒ `broadcast-bulk-ack`; cancel ⇒ nothing sent | `stage1/55` (guard) · `stage5/13` (send) | 1, 5 |

### 5.2 Contacts & peers

| Control (selector) | Values / states | Assert | Spec | Stage |
|---|---|---|---|---|
| `contacts-filter-name` | hit / miss / clear (R3) | rows filtered; empty state | existing `stage2/34` + **New** `stage2/64-contacts-filter-sort-options` | 2 |
| `contacts-filter-relation` | **all 7**: all, friend, relative, coworker, acquaintance, partner, custom | only matching relations listed | `stage2/64` | 2 |
| `contacts-sort-order` | **all 7**: recent, talks, matches, match-rate, weighted, name, relationship | first row changes per known fixture ordering | `stage2/64` | 2 |
| Empty-list state | every filter+sort on zero contacts | no error, empty message | Part 4 Stage 0 sweep | 1 |
| Relationship editor | each label incl. custom + custom text; `✕` / Close / scrim | label shown on row; persists after reload (R2) | existing C3 specs + `stage2/64` | 2 |
| ⟨User⟩ `peer-sort-btn` | date · outcome | history reorders | **New** `stage2/67-peer-history-controls` | 2 |
| ⟨User⟩ `peer-filter-tab` | all · sent · received | rows filtered by direction | `stage2/67` | 2 |
| `peer-auto-mode-checkbox` | on ↔ off (R2, persisted) | new talks auto-sent only when on | `stage2/67` | 2 |
| `peer-send-talks-btn` → picker | all checked (default); deselect subset; deselect all (confirm disabled); omitted reasons rendered; confirm / cancel / `✕` / scrim | only selected talks delivered; omitted never sent | T6 `stage2/63` (extend) | 2 |
| `peer-dm-input` + `peer-dm-send-btn` | send; empty input (no-op) | message in ⟨Conv⟩ both sides | existing `stage2/09` + T5 `stage2/62` | 2 |
| User click (member row / contact row) | from room; from Contacts | lands directly on ⟨Conv⟩; back → ⟨User⟩ → opener (N2a) | T8 `stage2/68` | 2 |
| Matched-talk thread rows | 0 matches (empty state); ≥2 threads; open each; unread badge | email-style row fields; per-thread history isolation | T8 `stage2/69` | 2 |
| Thread reply composer | send; empty no-op; reply visible to peer in same thread only | no DM↔thread leakage | T8 `stage2/69` · `stage3/71` | 2, 3 |
| `peer-block-user-btn` | block → confirm; unblock; persists (R2) | delivery stops; hidden; blocklist survives restart | existing `stage2/15b`, `21a` | 2 |

### 5.3 Talks list, triage, editor, response

| Control (selector) | Values / states | Assert | Spec | Stage |
|---|---|---|---|---|
| `talks-nav-all/in/out` | all 3 modes | list scope switches | existing D1 specs | 1–2 |
| `talks-out-sort-order` | **all 8**: recent, oldest, latest-reply, matches, responses, match-rate, weighted, title | order changes (semantic asserts for reply-dependent sorts at stage 2+) | **New** `stage1/64-talks-filter-sort-options` (+ stage2 semantic pass) | 1, 2 |
| `talks-filter-query` | hit / miss / clear (R3) | — | `stage1/64` | 1 |
| `talks-filter-type` | **all 5**: all, tag, flow, survey, route | only that type listed (12-talk fixture: 3 per type) | `stage1/64` | 1 |
| `talks-filter-completion` | all, unanswered, answered | needs answered data | `stage1/64` (values) · stage2 (semantics) | 1, 2 |
| `talks-filter-outcome` | all, match, mismatch | needs outcomes | stage2 pass of `64` | 2 |
| `talks-filter-date-from/-to` | in-range / out-of-range / cleared | — | `stage1/64` | 1 |
| Triage `reply-filter-outcome` | **all 5**: all, match, mismatch, ignore, auto | rows filtered | **New** `stage2/65-reply-triage-option-matrix` | 2 |
| Triage `reply-filter-relationship` | **all 8** incl. stranger, custom | — | `stage2/65` | 2 |
| Triage `reply-filter-type` | all 5 | — | `stage2/65` | 2 |
| Triage `reply-filter-language` | all + each fixture language | — | `stage2/65` | 2 |
| Triage `reply-filter-query`, `-from`, `-to` | R3 each | — | existing `stage2/35` + `stage2/65` | 2 |
| Triage `reply-sort-order` | **all 9**: recent, oldest, user, talk, relationship, matches, talk-matches, talk-replies, weighted | first-row assertion each | `stage2/65` | 2 |
| Triage `reply-group-order` | **all 5**: none, responder, talk, relationship, day | group headers correct across 3 responders | `stage2/65` (values) · **New** `stage3/70-reply-triage-grouping-multi` (semantics) | 2, 3 |
| `reply-clear-filters` + active-filter chips | set several → clear | chips render per active filter; clear resets all to defaults | `stage2/65` | 2 |
| Editor type radios | tag / flow / survey / route | form sections swap (tag-like appears for tag; route editor for route); hint text per type 🌐 | **New** `stage1/67-talk-editor-option-matrix` | 1 |
| Editor `talk-title` | empty (R4) / valid | required blocks submit | `stage1/67` | 1 |
| Editor `talk-language` | each offered language | stored on talk; respected by intake filter | `stage1/67` · stage3 intake | 1, 3 |
| Editor `tag-like-checkbox` | on ↔ off | match/ignore semantics of resulting tag | `stage1/67` + stage2 answer pass | 1, 2 |
| Editor questions | add ×N, remove, reorder branches; route `route-branch-change/-continue/-preview`; duplicate-question-on-path (R4) | validation errors + autofix banner behavior | `stage1/67` + existing D3 specs | 1 |
| Editor `talk-expires` | **all 5**: forever, 1y, 1M, 1w, 1d | stored; expired talk not delivered (server-side check at stage 2) | `stage1/67` | 1, 2 |
| Editor `talk-location-radius` | **all 4**: anywhere, 10, 100, 1000 | stored; distance filtering honors it | `stage1/67` · stage3 intake | 1, 3 |
| Editor `talk-send-to-chatroom` | on ↔ off; hidden in edit mode | off ⇒ created but not broadcast | `stage1/67` | 1 |
| Editor `talk-is-adult` 🔞 | on ↔ off | delivered only to age-verified (threshold 3 vouches) | `stage1/67` + existing H1 specs | 1, 2 |
| Editor Cancel / scrim | with dirty form | closes without creating | `stage1/67` | 1 |
| Response — tag | checked ⇒ match toast+conversation; unchecked ⇒ ignore toast, no conversation | both paths | existing talks-matching + **New** `stage2/66-talk-response-option-paths` | 2 |
| Response — flow/route | 3 distinct branch paths per talk (Part 4 Stage 1 rule); `back-question-btn` | outcome per leaf flag | `stage2/66` | 2 |
| Response — survey | full completion | stats recorded, no match | `stage2/66` + existing D4 | 2 |
| Response — review screen | pre-filled radios; change a radio; `review-edit-btn` (manual mode); confirm; superseded banner (talk updated) | no silent auto-submit; "(pre-filled)" tags | `stage2/66` + existing chatbot specs | 2, 3 |
| `close-response-btn` / scrim | mid-answer | no answer recorded | `stage2/66` | 2 |
| `survey-stats-button` → stats dialog | open/close; per-question counts | counts match responses | existing `stage2/41` | 2 |
| My Talks dialog | open, `✕`, scrim; per-talk broadcast toggle on ↔ off (R2) | disabled talk stops broadcasting | T6 `stage1/56` (extend with toggle) | 1 |

### 5.4 Me tab

| Control (selector) | Values / states | Assert | Spec | Stage |
|---|---|---|---|---|
| Type toggles `me-talk-type-filter` ×4 | each off ↔ on, and all-off | rows of that type hidden; all-off ⇒ empty state | **New** `stage1/65-me-filter-options` | 1 |
| Tag-state checkboxes ×3 | checked / unchecked / indeterminate each toggled | tag rows filtered by state | `stage1/65` | 1 |
| `me-outcome-filter` | all, match, mismatch | — | `stage1/65` (semantics at stage 2) | 1, 2 |
| `me-answer-sort` | **all 4**: answered-desc, answered-asc, chatbot-recent, chatbot-count | order changes (chatbot sorts asserted at stage 3 where bot answers exist) | `stage1/65` · stage3 | 1, 3 |
| `me-answer-filter`, `answers-search-input`, date from/to | R3 each | — | `stage1/65` + existing F2 | 1 |
| `me-clear-filters` | after setting everything | all controls back to defaults; full list | `stage1/65` | 1 |
| Q&A detail + create-from-Me | open detail; ⟨Editor⟩ seeded from Q&A; created talk appears in Me **and** Talks | shared-editor edge | Part 4 Stage 0 sweep | 1 |

### 5.5 Settings (every control)

| Control (selector) | Values / states | Assert | Spec | Stage |
|---|---|---|---|---|
| `settings-stage-name-input` | valid; < 3 chars (R4 inline error `settings-stage-name-error`); 50 chars | propagates to chatroom/⟨User⟩/⟨Conv⟩ headers (rename propagation) | existing F3/G1 (23 specs) + `stage2` rename spec | 1, 2 |
| `settings-headshot-select` | initial + each of 8 emoji | avatar updates everywhere | **New** `stage1/66-settings-option-matrix` | 1 |
| Choose Photo / Take Photo / Remove | file → preview confirm; file → preview cancel; camera capture → confirm/cancel; camera denied (R4 status); remove | avatar set/kept/cleared per path (chain rule N4) | existing G2/G3 + `stage1/66` | 1 |
| `settings-edit-profile-btn` → dialog | add/edit/remove Q&A rows; visibility select **public / contacts_only / private** per row; language checkboxes | visibility respected cross-user | existing F4 + stage3 privacy specs | 1, 3 |
| `settings-ui-language` | en ↔ zh (R2 persisted) 🌐 | full shell re-translates | existing `00y/00z` | 1 |
| `settings-profile-languages` | each language; none ⇒ falls back `['en']` (R4) | — | `stage1/66` | 1 |
| `settings-default-talk-language` | each language | editor pre-selects it | `stage1/66` | 1 |
| Incoming-language checkboxes | subset; zero ⇒ fallback `['en']` (R4); count label updates | intake include/exclude end-to-end | `stage1/66` (UI) · stage3 intake (delivery) | 1, 3 |
| `settings-credit-visible` | on ↔ off (R2) | peers see/don't see credit | `stage1/66` · stage2 visibility | 1, 2 |
| `settings-copy-talk-autosave` | on ↔ off (R2) | copy-talk flow honors it | existing `stage2/08` | 2 |
| `settings-chatbot-enabled` | on ↔ off (R2) | auto-reply + bot badge only when on | stage3 chatbot specs | 3 |
| `settings-min/max-distance` | valid pair; min > max (R4 toast + revert); empty | delivery honors bounds | `stage1/66` · stage3 intake | 1, 3 |
| `settings-home-room` | default room; custom room | return-home targets it | `stage1/66` | 1 |
| `settings-sent-after` | set / clear | older talks filtered | `stage1/66` · stage3 cutoff | 1, 3 |
| `settings-grammar-filter` | on ↔ off (own page open/close in target IA) | bad-grammar talk excluded only when on | `stage1/66` · stage3 content | 1, 3 |
| `settings-dirty-words-filter` | on ↔ off (own page open/close) | — | `stage1/66` · stage3 content | 1, 3 |
| Allowed-type checkboxes ×4 | subsets; zero ⇒ fallback all-4 (R4) | type-filtered delivery | `stage1/66` · stage3 | 1, 3 |
| `settings-custom-blocked` | comma and newline separated terms; clear | matching talks hidden; hidden-count summary updates (`settings-filtered-incoming-summary`) | `stage1/66` · stage3 | 1, 3 |
| `settings-refresh-location-btn` | click | location text updates; pending-location note when unknown | `stage1/66` | 1 |
| Storage inspector + `settings-refresh-storage-btn` | open dev page; refresh | body populates, read-only | Part 4 Stage 0 sweep | 1 |
| Age verification | vouch ×1, ×2 (still off), ×3 (flips 18+) | threshold = 3 | existing H1 | 2–3 |

### 5.6 Conversation & notifications

| Control | Values / states | Assert | Spec | Stage |
|---|---|---|---|---|
| `conversation-message-input` + Send | click send; Enter sends; Shift+Enter newline; empty no-op | ordered history both sides | existing E2 (10 specs) | 2 |
| Toasts | info / success / warning / error / Match! | auto-dismiss 3s (match 8s); match click navigates to ⟨Conv⟩; `data-match-notification` kept | T4 `stage1/54` | 1–2 |
| Location-room banner | Join / dismiss | Join pushes Room detail | existing A5 + T7 | 1 |
| System announcement | show / dismiss | renders + dismisses | **New** `stage1/68-system-announcement` (closes the only "None" gap) | 1 |

### 5.7 New specs introduced by this matrix

`stage1/60-chatroom-hierarchy-walk`, `stage1/64-talks-filter-sort-options`, `stage1/65-me-filter-options`, `stage1/66-settings-option-matrix`, `stage1/67-talk-editor-option-matrix`, `stage1/68-system-announcement`, `stage2/64-contacts-filter-sort-options`, `stage2/65-reply-triage-option-matrix`, `stage2/66-talk-response-option-paths`, `stage2/67-peer-history-controls`, `stage2/68-conversation-first-entry`, `stage2/69-matched-talk-threads`, `stage3/70-reply-triage-grouping-multi`, `stage3/71-thread-isolation-multi` — each with its companion `.md`, using the option-sweep pattern: build the fixture once per spec, then iterate the enumeration with per-value assertions (R1), ending with the clear/reset check (R3) and one 320px-width pass (R5).

---

## Part 6 — Platform × screen-size × cross-platform matrix

Parts 3–5 define **what** to test; this part defines **where**. Three added dimensions: platform, screen size, and mixed-platform topology. The user-count stages (Part 4) stay the primary axis; platform and size multiply it.

### 6.1 Platform targets

| # | Platform | Runtime | Harness | Role |
|---|---|---|---|---|
| P1 | **Website** — browser SPA | Chromium (primary), WebKit, Firefox | existing Playwright suite (`tests/e2e/staged`, `talks-matching`, …) | **Broad layer**: full functional + redesign suite runs here |
| P2 | **Webapp macOS** — Electron shell (`platforms/desktop`) with embedded node, on the Mac mini | `npm run desktop:dist` / `test:e2e:native-app` | `tests/e2e/native-app` (Electron launch, per-test `IINPUBLIC_USER_DATA_DIR`) | packaging, embedded-node startup, profile isolation + per-stage smoke |
| P3 | **Webapp Windows** — Electron (`desktop:dist:win`) | same shell, Windows CI runner | native-app config on Windows | same narrow scope as P2 |
| P4 | **Webapp Linux** — Electron | same shell, Linux CI runner | native-app config on Linux | same narrow scope as P2 |
| P5 | **iPhone** — mobile Safari (and the `platforms/ios` shell when it ships) | Playwright WebKit + iPhone device profile; real device manual pass per release | staged suite with device profile | mobile layout + touch |
| P6 | **Android** — mobile Chrome (and the `platforms/mobile` shell when it ships) | Playwright Chromium + Pixel device profile; real device manual pass per release | staged suite with device profile | mobile layout + touch |

Policy: the **full** suite (Parts 3–5, all stages) runs on P1/Chromium only. Every other platform runs the **platform smoke set**: tab sweep (`00x`), redesign overlay (T1/T2 AppBar + `⋯`), conversation-first + one thread reply (T8 core), one talk create→broadcast→answer→match round-trip, settings persistence across app restart. P2 additionally keeps its packaging/embedded-node specs.

### 6.2 Screen-size matrix

Reference device sizes (≥3 required; these 5 are the targets — the widths align with the redesign §8 breakpoints 320/390/768/1024):

| Size | Viewport | Represents | What must hold |
|---|---|---|---|
| SZ1 | **1920×1080** | desktop monitor (Mac mini / Windows / Linux) | all AppBar icons inline, no `⋯`; L/XL dialogs centered cards |
| SZ2 | **1366×768** | common laptop | same as SZ1; XL dialog still fits at 90vh |
| SZ3 | **768×1024** | tablet portrait / narrow window | L/XL dialogs clamp; filters still inline (boundary width) |
| SZ4 | **390×844** | iPhone 14 class | bottom sheets + full-screen takeovers; filters collapse to "Filters ▾"; overflow `⋯` active |
| SZ5 | **360×800** | mainstream Android | same as SZ4 with 30px less width (near the 320 floor) |

Execution: T2/T7 (overflow + responsive sweep) run at **all five** sizes on P1. Every other platform runs its smoke set at its native default (P2–P4: SZ1; P5: SZ4; P6: SZ5) plus one narrow pass (P2–P4 at SZ3 window size). The 320px floor from Part 5 R5 stays as the hard minimum asserted in option-sweep specs.

### 6.3 Cross-platform scenarios (X-specs, `tests/e2e/native-app/` + new `tests/e2e/cross-platform/`)

Mixed topologies — different platforms **online simultaneously** against the same hub, extending the existing `native-app/02-browser-and-desktop-app-presence`:

- **X1 — Website + webapp presence (P0):** one user on P1, one on P2, same room; both see headcount 2 and each other's member rows; extends `native-app/02`. |
- **X2 — Cross-platform talk lifecycle (P0):** broadcast website→webapp and webapp→website; answer on the receiving side; match; conversation-first click and DM reply cross the boundary; per-talk **thread reply round-trips** website↔webapp.
- **X3 — Same identity on two platforms (P1):** the same user's SEA keypair active on website and webapp simultaneously (key custody per `stage1/00-p2p-sea-key-custody`); messages and read-state converge on both; define+assert the intended behavior (mirror vs. reject second session — decision needed, see open questions).
- **X4 — Mobile ↔ desktop (P1):** P5/P6 device profile user matches and threads with a P2 desktop-app user; narrow-width overlay (T2) asserted live on the mobile side during the exchange.
- **X5 — Three-platform network (P1):** stage-3 functions (multi-responder talks, intake filters, pair-private thread isolation) with one user each on P1, P2, and P5/P6 profile.
- **X6 — Offline/mailbox across platforms (P2):** webapp goes offline (app quit), website user sends DM + thread reply + new talk; webapp relaunch receives all via mailbox; then the reverse direction.

Gate: X1–X2 join the merge gate alongside `npm run test:e2e:parallel`; X3–X6 run nightly on the platform runners.

### 6.4 Stage × platform coverage

| | P1 website | P2 macOS app | P3 Win app | P4 Linux app | P5 iPhone | P6 Android |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Stages 0–5 full (Parts 3–5) | ✓ | | | | | |
| Platform smoke set | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Packaging / embedded node | | ✓ | ✓ | ✓ | | |
| Screen-size sweep (5 sizes) | ✓ | SZ1+SZ3 | SZ1+SZ3 | SZ1+SZ3 | SZ4 | SZ5 |
| X-specs | X1–X6 (as the browser side) | X1–X6 | X2 nightly | X2 nightly | X4, X5 | X4, X5 |
