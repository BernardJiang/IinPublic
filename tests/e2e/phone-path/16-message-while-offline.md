# Phone path 16 — a message to a phone that is off (J-CHAT-02)
covers: SPEC-19.4

Alice is on a phone node this spec starts and stops; Bob is on phone B. They match and chat (the
shared `journeys/talk-match-chat-journey.ts`). Then Alice's app closes and her phone node stops,
Bob writes to her, and Alice's node and app start again on the same data. The message must be in
her conversation with Bob.

**Status: `test.fixme`, fails (OPEN-122, found 2026-11-27).** Bob's message is logged as delivered
into the dead link, so the offline mailbox is not used; after the restart Alice's app shows 2 of
her 6 earlier messages and her link to Bob does not reopen. Remove `.fixme` to run it.
