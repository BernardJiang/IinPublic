# Phone path 14 — automatic Talk exchange across two phones
covers: OPEN-112, SPEC-3.7

Alice is on phone A and Bob on phone B, on each other's Nearby list. The body is
`tests/e2e/journeys/auto-exchange-journey.ts`, shared with `staged/stage2-two-user/98` (browsers)
and `native-app/42` (real phones).

1. **J-AUTO-01:** Alice switches a private Talk to Broadcast On from its Talks row. Bob gets it with
   no send step and answers it with *Auto*, so his chatbot learns the answer.
2. **J-AUTO-02:** Alice answers her own Talk asking a second question; Bob publishes a Talk asking
   it. Nobody touches an answer: Alice's chatbot answers and Bob's device records the match.
3. **J-AUTO-03:** both like the same starter tag; it is exchanged within seconds.

Added 2026-11-26 (OPEN-121): the newest product path had no check on the phone route.
