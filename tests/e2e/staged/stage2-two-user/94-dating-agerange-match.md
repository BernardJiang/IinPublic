# 94-dating-agerange-match

covers: §DD (`ageRangeMutuallyAcceptable`, `built-in-comparisons.ts`; `ageRange` as a real
`BuiltInQuestionKind`, wired into `resolveBuiltInQuestion`/`typed-preference-store.ts`/the talk
editor's builtIn fields)

The Dating template introduces a genuinely new comparator — `ageRange` — distinct from the
already-proven `priceRange`/`timeFrame` interval-overlap: each side declares a single fact (their
own age) plus a range (their acceptable partner-age range), and a match requires each side's age
to fall within the OTHER side's acceptable range, checked mutually. This is the one template
mechanism not already covered by prior Pair-tag + chatbot cross-talk specs, so unlike Buy/Sell,
Taxi, and Job Seeker (whose templates only get a prefill-correctness check,
`83-talk-template-picker.spec.ts`) it gets a full two-browser match proof.

Adam and Eve each independently author a "Dating Match" talk (Pair-tag Q1 declaring their own
"seeking women"/"seeking men" side, Q2 the new `ageRange` built-in) with mutually-acceptable but
non-identical ages (30/25-35 and 28/26-40) — real point-in-mutual-range math, not string
equality. They also each author a differently-titled "Dating Mismatch" talk where one side's age
falls outside the other's acceptable range. Only Adam broadcasts; matching happens entirely via
the chatbot's exact-question-text auto-reply resolving each side's own typed preference (same
mechanism `87-price-overlap-buy-sell-match.spec.ts` proves for `priceRange`) — zero manual
clicking. Verifies the match pair produces exactly one conversation, and the mismatch pair does
not add a second one.

Also asserts the UI half of the dating-category adult-content lock while building each talk:
selecting the `ageRange` built-in kind force-checks and disables `#talk-is-adult` live
(`syncAdultLockFromBuiltInKinds`, talk-editor-form-helpers.ts) — the authoritative half is
`TalkAutofix.fix`'s force-on-save rule (talk-engine.ts), covered separately by unit tests.
