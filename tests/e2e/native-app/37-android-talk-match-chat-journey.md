# 37 — Two real phones: talk → answer → match → P2P chat
covers: SPEC-3.4, SPEC-19.4

The two-person core loop, written once in `tests/e2e/journeys/talk-match-chat-journey.ts` and run
here on two real phones (phone-path/02 runs the same body with host phone nodes).

1. Both phones are in the same Nearby room and list each other.
2. Phone A writes and broadcasts a talk.
3. Phone B receives it and gives the matching answer.
4. Both get the conversation and the direct P2P channel connects.
5. Both reopen the conversation from Contacts (name tap to DM, no direct overlay shortcut).
6. A message sent from the real conversation composer on phone A appears on phone B's screen.
7. Sending never makes anyone wait (`tests/e2e/journeys/dm-speed-journey.ts`, J-CHAT-04): in both
   directions the composer clears and Send stays free at once, the sender sees the message within
   500 ms and the receiver within 2 s. That also holds while the sender's local save is held back
   4 s, as on a slow phone. Two quick messages arrive in order, and every message shows exactly
   once.

Opt-in (`E2E_REAL_ANDROID_JOURNEYS=1`); clears both phones' app data. Step timings are attached.
