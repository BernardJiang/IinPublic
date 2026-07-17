# Test: UX Polish — Contacts Include Mismatched Peers, IN/OUT Split, Answers Detail

covers: SPEC-3.6, SPEC-3.4, SPEC-7.9  <!-- auto-seeded; refine by hand -->

**File:** 00f-ux-contacts-talks-answers.spec.ts
**Features tested:** Contacts tab showing mismatched peers, peer detail from both contacts and chatroom, Talks tab IN/OUT navigation, Answers tab detail display, three-browser

---

## What this test does (in plain English):

1. **Setup:** Three browsers (Tom, Jerry, Bob) launched via `launchThreeBrowsers`. Tom and Jerry join Global chatroom.

2. **Tom creates "Tom Out Talk"**, **Jerry creates "Jerry Out Talk"**. Both broadcast their respective talks.

3. **Jerry answers "Tom Out Talk" with "No thanks."** (mismatch/no match).

4. **Verification — Tom's contacts tab:** Shows Jerry as a contact (even though there was no *match* — contacts include mismatched peers). The contact item says "2 talks". Clicking Jerry shows the "Tom Out Talk" in Jerry's contact detail.

5. **Verification — Chatroom peer detail:** Tom enters the Global chatroom, clicks Jerry's name — the same peer detail overlay opens with Jerry's name (contacts and chatroom show the same detail view).

6. **Verification — Talks tab IN/OUT split:** Tom's Talks tab shows both IN and OUT tabs. "Back" shows all talks, "IN" shows only Jerry's talk (incoming), "OUT" shows only Tom's own talk (outgoing). "Back" shows both again.

7. **Verification — Jerry's Answers tab:** Shows "Tom Out Talk" with the question "Do you want to join Tom?", the selected answer "No thanks.", "1 item" count, "answered 1 time", and "Mismatch" status.

> **Why this matters:** Verifies end-to-end UX polish: contacts include mismatched peers (not just matches), IN/OUT navigation works correctly, and answers show full question + answer detail.

---

**Helpers used:** `clearGunDatabases`, `bootstrapUser`, `launchThreeBrowsers`, `shutdownThreeBrowsers`, `resetTalksMatchingSession`, `finalCleanupPages`, `openIncomingTalkModal`, `confirmBroadcastTagPreambleIfVisible`, `waitForResponseModalClosed`, `waitForTabActive`
