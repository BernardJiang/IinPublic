# Test: Chatroom UX — Member List Scroll and Unified Broadcast Bar

covers: SPEC-3.3, SPEC-3.6, SPEC-3.4  <!-- auto-seeded; refine by hand -->

**File:** 13-chatroom-scroll-and-broadcast-bar.spec.ts
**Features tested:** Chatroom member list scrolling, unified broadcast button, status bar broadcast text, viewport overflow

---

## What this test does (in plain English):

1. **Setup:** Single browser. An "Owner" user and 7 "Peer" users all log in with a compact viewport (640x540) and enter the Global chatroom.

2. **Verification — 7 member items** appear in the chatroom member list.

3. **Verification — Only 1 broadcast button** exists (not duplicated).

4. **Verification — Status bar** says "Broadcast to everyone in this room". The old text "Broadcast talk to everyone here" does NOT appear (zero count).

5. **Verification — Member list is scrollable:** The `scrollHeight` is greater than `clientHeight`, and scrolling to the bottom actually changes `scrollTop`.

> **Why this matters:** Verifies that chatroom detail UI has a single unified broadcast action, no duplicate buttons, and the member list scrolls when it overflows (important for UX on small viewports).

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `afterLoad`, `afterNav`, `afterAction`, `afterSync`, `attachE2eBrowserTabLabel`