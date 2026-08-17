# Test: Late Joiner Receives an Already-Broadcast Tag Talk (Catch-Up)

**File:** 00af-late-joiner-tag-broadcast-catchup.spec.ts
**Features tested:** automatic per-receiver catch-up delivery for a chatroom member who joins *after* a broadcast already happened, specifically for `type: 'tag'` talks.

---

## What this test does (in plain English):

Regression test for a manually-reported bug: a tag talk already broadcast to the room did not reach a member who joined later.

1. **Setup:** Tom and Jerry join Global. Tom creates and broadcasts a tag talk ("Late Joiner Tag Catchup") to Jerry, who is already in the room.
2. **Confirm the normal case works:** poll until Jerry's incoming-talk clusters contain the tag talk title.
3. **Kate joins late:** only now does Kate bootstrap and join Global — after Tom's broadcast to Jerry already completed. Tom stays on the chatroom tab throughout, so the roster-change callback that drives automatic catch-up (`syncPeerMeshRoom` → `broadcastPendingTalksToMembers`) fires while he is actually viewing the room.
4. **Assert catch-up:** poll until Kate's incoming-talk clusters contain the tag talk title, with no manual re-broadcast action from Tom.

> **Why this matters:** two real bugs were found and fixed while chasing the manual report:
> 1. The "already sent" ledger check that gates catch-up (`isBroadcastUnsentForReceiver`, `ui-manager.ts`) compared the whole-talk identity key, but tag-talk delivery records suppression under different, per-tag identity keys (`buildTagIdentityKeys`). A tag talk always read as "unsent" for everyone, masking whether catch-up delivery itself worked.
> 2. `syncPeerMeshRoom` (`app.ts`) permanently marked a newly-arrived peer as "scheduled" — meaning "never try catch-up for them again" — whenever the broadcaster wasn't on the room's tab at the exact moment the mesh join promise resolved, even if the broadcaster came back to the room later. This is the more likely real-world cause of the reported symptom, since a manual test naturally involves navigating around before checking the outcome.

---

**Helpers used:** `clearGunForStage3Spec`, `afterSync`, `clickBroadcastUntilBulkAck`, `createTalksFromCompanyPage`, `waitForDistinctGunPeersExcludingSelf`, `buildTagTalkPayload`, `bootstrapUser`, `finalCleanupPages`, `incomingClustersIncludeTitleForUser`, `resetTalksMatchingSession`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
