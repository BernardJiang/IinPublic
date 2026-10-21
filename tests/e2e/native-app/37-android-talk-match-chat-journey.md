# 37 — Two real phones: talk → answer → match → P2P chat

The two-person core loop, written once in `tests/e2e/journeys/talk-match-chat-journey.ts` and run
here on two real phones (phone-path/02 runs the same body with host phone nodes).

1. Both phones are in the same Nearby room and list each other.
2. Phone A writes and broadcasts a talk.
3. Phone B receives it and gives the matching answer.
4. Both get the conversation and the direct P2P channel connects.
5. A message sent on phone A appears on phone B's screen.

Opt-in (`E2E_REAL_ANDROID_JOURNEYS=1`); clears both phones' app data. Step timings are attached.
