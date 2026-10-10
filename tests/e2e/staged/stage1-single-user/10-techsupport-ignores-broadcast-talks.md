# Test: TechSupport Ignores Broadcast Talks Entirely

covers: docs/TODO.md K5 invariant 1 ("TechSupport ignores all talks")

**File:** 10-techsupport-ignores-broadcast-talks.spec.ts
**Features tested:** the hard, type-agnostic exclusion of the TechSupport root from talk delivery
— `acceptsIncomingTalks()` in `src/shared/techsupport.ts`, checked at the top of
`shouldAcceptIncomingTalkAsync` before any type-specific match/ignore logic runs.

---

## What this test does (in plain English):

1. TechSupport boots in K3 mode and remains in the local Contacts-only scope.
2. Alice occupies Nearby alone. Headcount reads 1 before any Talk exists.
3. Alice creates and broadcasts a **tag** talk, then a **flow** talk, to Nearby. Broadcasting is
   done with `minGunPeers: 0` / `minSent: 0` — `clickBroadcastUntilBulkAck`'s default peer-count
   wait uses a helper that deliberately excludes `TECHSUPPORT_ROOT_USER_ID` from its receiver
   count (TechSupport is never a valid talk receiver by design), so with only TechSupport in the
   room that count can never reach the default minimum of 1.
4. **Core assertion:** neither broadcast ever appears in TechSupport's own local incoming-talk
   index. Running this test surfaced a stronger guarantee than expected: Alice's own
   `broadcastTalk()` logs "no receivers resolved (no other active members in this chatroom)" —
   TechSupport is excluded from the **sender's own receiver-resolution step**, so no offer is even
   addressed to it. `acceptsIncomingTalks()` in `shouldAcceptIncomingTalkAsync` (the originally
   documented receiver-side check) is a backstop this test doesn't get to exercise directly, since
   the sender-side exclusion means the offer never arrives in the first place.
5. Alice's Nearby headcount remains 1 and TechSupport remains Contacts-only.

> **Honest scope note:** only tag and flow are exercised, not all four talk types (survey/route
> untested here). `acceptsIncomingTalks(userId)` takes only a user id — no talk-type parameter at
> all — and is checked *before* `ingestIncomingTalkAnnouncement` does anything type-specific, so
> the two types covered already exercise every code path the invariant depends on. Full four-type
> match/ignore behavior is already covered exhaustively elsewhere (stage3 multi-responder specs);
> this test's job is only to prove TechSupport itself never reaches that logic at all.

---

**Helpers used:** `clearGunForStage1Spec`, `bootstrapUser`, `selectTalkEditorType`,
`submitTalkEditorAndWaitForOut`, `clickBroadcastUntilBulkAck`, `incomingClustersIncludeTitleForUser`,
`expectCurrentUserIsTechSupportRoot`. The TechSupport browser never joins stranger discovery.
