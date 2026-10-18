# 38 — Two real phones: mismatch, block and leave

The journey bodies from `tests/e2e/journeys/mismatch-block-leave-journey.ts`, which phone-path/04
also runs with host phone nodes:

- **J-TALK-04:** a non-matching answer gives neither person a match or a conversation.
- **J-TALK-05:** Talks reach Bob before he blocks Alice and not after; both phones' nodes record
  the block, and Alice sees Bob's profile as unavailable.
- **J-ROOM-03:** Alice moves into a Place and back, then her app is killed; Bob's member list, his
  headcount and the hub all drop her (membership TTL, about four minutes).

Opt-in (`E2E_REAL_ANDROID_JOURNEYS=1`); clears both phones' app data before each test.
