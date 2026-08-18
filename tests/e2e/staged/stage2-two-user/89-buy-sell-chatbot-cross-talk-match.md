# Buy/sell talks match each other via chatbot cross-talk flattened matching (§KK)

Two independently-authored talks — Adam's "Buy iPhone" and Eve's "Sell iPhone" — match each
other with zero manual clicking. Neither ever answers the other's talk by hand. Each side's
chatbot resolves the incoming talk entirely from its own flattened Q&A store: Adam declared
Item/Model/Capacity while creating his own talk, Eve declared the same while creating hers, and
when each receives the other's broadcast, the chatbot looks up its own stored answers by the
normalized question chain plus tag context (`buildAnswerPreferenceLookupKey`, tag-scoped per
§KK) — not by comparing the two talk objects to each other. This is "flatten into Me tab, match
any incoming talk against it," not talk-vs-talk comparison.

**Test 1 — basic match.** Confirms the end-to-end pipeline: both broadcasts land, both chatbots
resolve, both sides end up with a conversation with the other.

**Test 2 — the actual regression case.** Adam has *two* iPhone talks with identically-worded
questions but different transaction intent: "Buy iPhone Seller" (`preferenceSet: ['sell']`,
wants exactly 16 Pro/128GB) and "Buy Buddies iPhone" (`preferenceSet: ['buy']`, wants fellow
buyers, self-answered with 16 Pro/**256GB** — deliberately the "ignore" option on Eve's talk).
Before §KK, `resolveAnswerPreferenceForTalkQuestion` tried context-free exact-chatbot-memory
first, which resolves by newest-saved-answer-that's-still-a-valid-option — with no tag dimension
in the key, it can't tell "seeking a seller" apart from "seeking a buddy" when both talks share
`selfTag: 'buy'`, so it hands back the buddy-talk's 256GB (saved second) even when resolving
Eve's incoming *sell* talk. That's a wrong answer that happens to still be *valid* (256GB is a
real option on Eve's talk, just the `isIgnore` one) — so the chatbot doesn't fail to reply, it
replies **wrong**, and Eve gets a mismatch instead of a match. This test asserts a real match
forms, not just "some conversation" — verified to fail against the pre-fix code (~1/1 run,
timeout waiting for Eve's conversation) and pass reliably against the fix.

Values were deliberately chosen so a naive "invalid nonsense answer" collision wouldn't work as
a test case: `findAutoAnswer` already has an unrelated safety net (only ever returns a stored
answer that's a valid option on the *current* question), which would have silently absorbed a
made-up value and made the test pass on both old and new code without proving anything.
