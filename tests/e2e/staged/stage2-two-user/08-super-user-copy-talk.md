# Test: Answer First, Recover, Retain in My Talks, Broadcast, Delete

covers: SPEC-3.6, SPEC-3.4, SPEC-3.1  <!-- auto-seeded; refine by hand -->

**File:** 08-super-user-copy-talk.spec.ts  
**Features tested:** Answer-first read history, swipe-down retain, broadcast toggle/filtering, deletion, multi-browser

---

## What this test does (in plain English):

1. **Setup:** Two browsers — TechSupport and Tom — both log in via `bootstrapSuperUser` and join "Global" chatroom.

2. **TechSupport creates a flow-type talk** titled "CopyTestTalk" with the question "Want to connect for CopyTestTalk?" and two answers (match/ignore). Submits and broadcasts it.

3. **Tom receives and answers the talk:** Tom opens the incoming talk, selects the matching answer ("Yes, lets play."), and the modal closes.

4. **Tom answers without copying first:** the talk disappears from the default Unanswered inbox like a read email, but remains available under **Filters → Answered**.
5. **Tom retains it afterward:** from that Answered row, Tom swipes down. The talk then appears as a "copied" role item.

6. **Tom disables broadcast for the copied talk:** Clicks the "Disable Broadcast" checkbox on the copied talk. Clicks Broadcast button — no talks are broadcast (the talk editor modal opens instead, which is cancelled).

7. **Tom re-enables broadcast:** Unclicks the disable checkbox. Clicks Broadcast — this time the talk IS broadcast (confirms the toggle works correctly).

8. **Tom deletes the copied talk:** Opens "Me" → "View My Talks", clicks delete on "CopyTestTalk". Verifies via polling that the talk is gone from the history (count = 0). Re-opens the my-talks modal to double-check.

> **Why this matters:** Verifies the copy-talk lifecycle: received talks can be copied, the broadcast toggle correctly includes/excludes copied talks from broadcast, and deletion removes them from the user's talk history.

---

**Helpers used:** `clearGunDatabases`, `bootstrapSuperUser`, `confirmBroadcastTagPreambleIfVisible`, `waitForTabActive`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`
