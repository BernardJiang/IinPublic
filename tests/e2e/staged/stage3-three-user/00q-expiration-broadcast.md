# Test: Talk Expiration Broadcast Behavior

covers: SPEC-3.6, SPEC-3.4, SPEC-8.2  <!-- auto-seeded; refine by hand -->

**File:** 00q-expiration-broadcast.spec.ts  
**Features tested:** Time-to-live (TTL) on talk broadcasts — a flow talk with 1-day expiration is delivered while active, then the same TTL setting causes zero delivery after the clock advances past expiry. Verifies broadcast UI rejects expired talks with "You have no talks to broadcast" notification.

---

## What this test does (in plain English):

Two users (Tom sends, Jerry receives) in Global chatroom. Tom creates two flow talks with 1-day expiry via `#talk-expires` dropdown set to "1d". The first is fresh → delivered successfully. For the second, Tom's browser clock is artificially advanced by 48 hours (2 days) → the talk shows as "Expired" in Tom's own OUT list and broadcast silently drops it with zero delivery to Jerry.

1. **Setup:** Both users bootstrapped in Global chatroom.
2. **Active talk delivered:** Tom creates "Expiration Active Delivery" with `expires: 1d`, broadcasts → status bar shows "Expires in", Jerry receives via server-side cluster confirmation.
3. **Expired talk blocked:** Tom's `Date.now()` is monkey-patched forward 48 hours → same title pattern but now past TTL. Tom's talks list shows "Expired" badge. Clicking broadcast button yields notification: "You have no talks to broadcast". Jerry confirmed never received the expired talk via `receiverHasIncomingTitle` returning false.

> **Why this matters:** Talk expiration is a time-sensitive feature that auto-discards stale broadcasts. The test proves both sides of the boundary — fresh TTL delivers, expired TTL blocks. Monkey-patching `Date.now()` avoids actually waiting 48 hours while still exercising the real expiry path. The broadcast UI behavior (notification, not silent drop) ensures users understand why nothing happened.

---

**Helpers used:** `maybeClearGunDatabases`, `afterSync`, `clickBroadcastUntilBulkAck`, `gunBaseURL`, `bootstrapUser`, `finalCleanupPages`, `resetTalksMatchingSession`, `waitForIncomingTalkClusterOnServer`, `waitForTabActive`, `incomingClustersIncludeTitleForUser`, `launchThreeBrowsers`, `shutdownThreeBrowsers`
