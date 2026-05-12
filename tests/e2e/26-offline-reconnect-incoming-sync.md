# Test: Offline Reconnect Incoming Sync

**File:** `26-offline-reconnect-incoming-sync.spec.ts`

**Features tested:** Browser offline/online transition, incoming-talk recovery, post-reconnect Talks refresh

## What this test does

1. Tom and Jerry join the app.
2. Jerry's browser context goes offline.
3. Tom broadcasts a talk while Jerry is disconnected.
4. Jerry comes back online.
5. The server incoming-talk API and Jerry's Talks UI both show the talk after reconnect.
