# Phone path 16 — a message to a phone that is off (J-CHAT-02)
covers: SPEC-19.4

Alice is on a phone node this spec starts and stops; Bob is on phone B. They match and chat (the
shared `journeys/talk-match-chat-journey.ts`). Then Alice's app closes and her phone node stops,
Bob writes to her, and Alice's node and app start again on the same data. The message must be in
her conversation with Bob.

**Found failing 2026-11-27 (OPEN-122), fixed the same day:** Bob's message was counted as delivered
into the link whose far end had just closed, so the offline mailbox was not used; and the sender's
own burst of messages took ~9 s to store. Now the receiver acknowledges each DM on arrival
(`dm-ack`), a DM without an ack in 5 s also goes to the mailbox, and queued saves go together.
Alice gets the message after her restart.
