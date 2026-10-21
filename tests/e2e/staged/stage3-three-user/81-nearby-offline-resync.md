# Test: Three People Nearby — Concurrent Talks, One Offline, Catch-up on Return

covers: docs/TODO.md OPEN-59 step 3; journeys J-NEARBY-04, J-NEARBY-05

**File:** 81-nearby-offline-resync.spec.ts
**Journey body:** `tests/e2e/journeys/nearby-ring-journey.ts` (shared with `native-app/13`, which
runs it on three real Android phones and turns one phone's Wi-Fi off)

## What this test does (in plain English):

Adam, Eve and Bob open the app in three browsers at the same place and wait until each has the
other two on their own Nearby list.

All three write and send a Talk at the same moment. Each of them must receive the other two
Talks.

Then Bob goes offline. Only after that does Adam write a new Talk and send it to Bob. While Bob is
away, Adam and Eve keep going: each answers the other's Talk and they match.

Bob comes back online. The Talk Adam sent while he was away must show up in Bob's own incoming
Talks, and Bob answers it from there.

A browser's offline switch cuts its HTTP and hub traffic but may leave an open WebRTC channel up,
so in browsers the Talk might arrive before Bob is back. The strict proof that it arrived only
after his return is the phone run, where the phone's Wi-Fi is really off.
