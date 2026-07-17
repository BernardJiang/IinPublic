# Test: Chatroom Peer Detail — Stranger Status, Overlay, Talk History, Send My Talks (Auto + Manual)

covers: SPEC-3.3, SPEC-7.9  <!-- auto-seeded; refine by hand -->

**File:** 00e-chatroom-peer-detail.spec.ts
**Features tested:** Chatroom member list, Stranger status, peer detail overlay, talk history with sort/filter, Send My Talks auto mode, Send My Talks manual mode picker, multi-browser

This spec contains **5 sub-tests**, each with fresh database setup (`beforeEach` clears DB).

---

## Sub-test 1: Member list shows "Stranger" status for unknown user

1. **Setup:** Tom (TomS) and Jerry (JerryS) both log in and enter the Global chatroom.

2. **Tom waits for Jerry to appear** in the member list.

3. **Verification:** Jerry's status shows "Stranger" — meaning they haven't had any talk history yet.

> **Why this matters:** Confirms that new users in the same chatroom are correctly labeled as "Stranger" before any interactions.

---

## Sub-test 2: Clicking a chatroom member opens the peer detail overlay

1. **Setup:** Tom (TomOv) and Jerry (JerryOv) both enter Global chatroom.

2. **Tom waits for Jerry to appear** in the member list, then clicks on Jerry's name.

3. **Verification — Peer detail overlay opens:** Shows Jerry's name, a stats section, and a "Send My Talks" button. Jerry's name is non-empty.

4. **Back button closes it.** The overlay is no longer visible.

> **Why this matters:** Verifies the peer detail overlay opens/closes correctly with the expected UI elements present.

---

## Sub-test 3: Peer detail shows talk history after a talk exchange

1. **Setup:** Tom (TomTH) and Jerry (JerryTH) both enter Global chatroom.

2. **Tom creates and broadcasts a talk** titled "Tennis Peer Test" with the question "Peer detail test: want to play tennis?" (match: "Yes, lets play.", ignore: "No thanks.").

3. **Jerry opens the incoming talk and matches** by selecting "Yes, lets play."

4. **Tom enters the chatroom, clicks Jerry** to open peer detail.

5. **Verification — Talk history appears:** History controls are visible. At least one peer-history-item is shown. Sort by "outcome" works (button has active class). Filter to "sent" only works (at least 1 sent item counted).

> **Why this matters:** Confirms that after a successful talk exchange, the peer detail view shows talk history with sort and filter functionality.

---

## Sub-test 4: Send My Talks — auto mode sends unsent talks to peer

1. **Setup:** Tom (TomSend) and Jerry (JerrySend) both enter Global chatroom.

2. **Tom creates a talk** titled "Send Test Talk" (not yet sent to Jerry — no broadcast).

3. **Tom opens Jerry's peer detail.** Auto mode checkbox is checked by default.

4. **Tom clicks "Send My Talks"** — the talk is delivered to Jerry. Button text changes from "📤 Send My Talks".

5. **Verification — Jerry sees the talk:** Jerry navigates to Talks tab, server confirms "Send Test Talk" is in Jerry's incoming talks, and the talks list shows it.

> **Why this matters:** Verifies that "Send My Talks" in auto mode delivers unsent talks directly to a specific peer without requiring a full broadcast.

---

## Sub-test 5: Send My Talks — manual mode shows picker modal

1. **Setup:** Tom (TomMan) and Jerry (JerryMan) both enter Global chatroom.

2. **Tom creates a talk** titled "Manual Mode Talk".

3. **Tom opens Jerry's peer detail**, unchecks the auto mode checkbox (switching to manual mode).

4. **Tom clicks "Send My Talks"** — a picker modal opens (#peer-send-picker-modal) instead of auto-sending.

5. **Tom clicks cancel** — the picker modal closes.

> **Why this matters:** Verifies that switching from auto to manual mode changes the "Send My Talks" behavior to show a talk selection picker modal.

---

**Helpers used (shared across sub-tests):** `clearGunDatabases`, `injectIdbClear`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `openIncomingTalkModal`, `confirmBroadcastTagPreambleIfVisible`, `syncIncomingFromServer`, `waitForIncomingTalkClusterOnServer`, `waitForResponseModalClosed`, `waitForTabActive`, `resetTalksMatchingSession`
