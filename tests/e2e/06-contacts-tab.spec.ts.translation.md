# Test: Contacts Tab — Users With Matches Listed, Click to See Matching Talks

**File:** 06-contacts-tab.spec.ts  
**Features tested:** Contacts list, matching talk history, peer-to-peer contact visibility, multi-browser (Tom/Jerry/Bob), talk-matching cross-verification

---

## What this test does (in plain English):

1. **Setup:** Three browsers launched — Tom, Jerry, and Bob. All three join the "Global" chatroom.

2. **Tom creates two talks** via the company page demo:
   - **"Tennis"** talk: "Want a tennis partner?" with answers "Yes, lets play." (match) and "No thanks." (ignore)
   - **"Coffee"** talk: "Want to grab coffee?" with answers "Yes, coffee sounds good." (match) and "Not now." (ignore)

3. **Tom broadcasts both talks.** The broadcasts reach Jerry and Bob.

4. **Jerry answers both talks on Tom's behalf:**
   - Tennis: "Yes, lets play." → MATCH
   - Coffee: "Not now." → MISMATCH
   Jerry's status bar shows 1 match.

5. **Bob answers both talks on Tom's behalf:**
   - Coffee: "Yes, coffee sounds good." → MATCH
   - Tennis: "No thanks." → MISMATCH
   Bob's status bar shows 1 match.

6. **Peer history is verified via API polling:** The `/api/users/{uid}/peers/{peerId}/talk-history` endpoint is polled to confirm Tom-Jerry share the Tennis match and Tom-Bob share the Coffee match.

7. **Verification — Tom sees 2 matches** in status bar, then navigates to Contacts tab:
   - Contacts list shows 2 contacts: Jerry and Bob
   - Clicking Jerry → shows only the Tennis matching talk
   - Clicking Bob → shows only the Coffee matching talk

8. **Verification — Jerry's Contacts tab** shows only Tom (with Tennis match).

9. **Verification — Bob's Contacts tab** shows only Tom (with Coffee match).

> **Why this matters:** Verifies that the contacts tab correctly lists only users with at least one matching talk, and clicking a contact reveals only the talks that matched between those two users.

---

**Helpers used:** `clearGunDatabases`, `injectIdbClear`, `ensureWindowFitsViewport`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `attachE2eBrowserTabLabel`, `createTalksFromCompanyPage`, `completeTalkInAppByAnswerIds`, `waitForStatusBarMatchCountAtLeast`
