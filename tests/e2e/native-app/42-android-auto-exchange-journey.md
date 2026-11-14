# 42 — Automatic Talk exchange on two real phones

covers: OPEN-112, spec §6.1a

There is no Broadcast button. Two people on each other's Nearby list:

1. **J-AUTO-01** — Alice creates a Talk with Public unchecked, then switches it to Broadcast On
   from its row in the Talks tab. Bob receives it with no send step and answers it with *Auto*;
   Alice's device records the match.
2. **J-AUTO-02** — Alice answers her own new (private) Talk asking a second question; Bob
   publishes a Talk asking that question. Nobody touches an answer: Alice's chatbot answers Bob's
   Talk from her own answer, and Bob's device records the match. (Asking Alice's first question
   again would not be sent at all: what a pair already exchanged is not offered twice,
   REQ-LEDGER-16.)
3. **J-AUTO-03** — Both like the same starter tag. Each device records the tag exchanged with the
   other within a minute: a like is exchanged at once, not at the next catch-up (found on 1.0.248
   phones, where it took about three minutes).

The same journey (`tests/e2e/journeys/auto-exchange-journey.ts`) runs in browsers in
`staged/stage2-two-user/98-auto-exchange.spec.ts`. Clears both phones' app data.
