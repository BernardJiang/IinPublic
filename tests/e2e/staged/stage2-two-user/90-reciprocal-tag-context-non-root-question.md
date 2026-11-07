# 90-reciprocal-tag-context-non-root-question

covers: SPEC-30.2

Verifies the per-question reciprocalTagContext checkbox: an ordinary first question in a
2-question flow talk (exactly one non-ignore answer) declares the buy/sell-style context for
every question after it, replacing the removed root-level selfTag/preferenceSet fields.

Adam authors Q1 "buy" (reciprocal, accepting "sell") chaining to Q2 "Is it an iPhone?" (Yes
matches); Eve authors the mirror with Q1 "sell" accepting "buy" and byte-identical Q2 text.
Both enable the chatbot and broadcast. The matching engine finds the reciprocal tag ancestor
and auto-resolves across the two differently-worded roots with zero manual clicking — both
sides end up with a conversation with the other.
