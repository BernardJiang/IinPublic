# Test: Four People Nearby — Personal Lists and a Talk Ring

covers: docs/TODO.md OPEN-59 step 3; journeys J-NEARBY-01, J-NEARBY-02

**File:** 07-nearby-ring-journey.spec.ts
**Journey body:** `tests/e2e/journeys/nearby-ring-journey.ts` (shared with `native-app/30`, which
runs it on three or four real Android phones)

## What this test does (in plain English):

Adam, Eve, Bob and Alice open the app in four separate browsers at the same test location. Nearby
v3 gives each of them their own list of people near them, so the test waits until every one of
them has the other three on their own list.

Then each person writes one Talk and sends it. The Talk must arrive on the **next** person's
device (Adam → Eve → Bob → Alice → Adam), so every person proves both sending and receiving
without a 4×4 burst of traffic. The test records how long each delivery took.

The background step (J-NEARBY-03: a Talk sent while the receiver's app is in the background is
there when they come back) needs the Android shell and runs only on the real phones.
