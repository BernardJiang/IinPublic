# 86-builtin-quantity-match

covers: SPEC-30.2, SPEC-30.3

Typed built-in "quantity" comparison questions resolved numerically instead of by text match.
A buyer's talk (Pair-tag Q1 "buy") declares how many they want and a seller's talk (Pair-tag
Q1 "sell") declares how many they have via the editor's "Compare using: quantity" kind; both
sides enable the chatbot and broadcast.

Match case: buyer wants 2, seller has 5 (2 <= 5) — resolveBuiltInQuestion auto-resolves both
directions with zero manual clicks and each side gets a conversation with the other.

No-match case: buyer wants 10, seller has 2 — the computed incompatible result is confident
enough to auto-resolve to no-match, never reaching a human inbox; no conversation forms.
