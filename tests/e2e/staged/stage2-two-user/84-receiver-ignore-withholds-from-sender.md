# 84-receiver-ignore-withholds-from-sender

covers: SPEC-3.4, SPEC-3.9

Verifies the dedicated receiver-only "Ignore" action (distinct from any answer the talk's
author provided) ends the response immediately and withholds it from the sender entirely, for
both a single-question flow talk and a multi-question survey.

Part 1 (flow): Tom clicks the dedicated Ignore on the only question; the talk appears only in
his own Ignored filter view, and sender Alice receives nothing — no exchange record at all,
held for several seconds to rule out a slow mesh delivery.

Part 2 (survey): dedicated Ignore on the first of three questions ends the response at once
(does not advance to Q2). Tom's Ignored entry holds exactly one sentinel answer, and Alice
again receives nothing. Contrast with 83, where an author-provided ignore-flagged answer
advances normally.
