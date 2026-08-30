# Tag similarity scoring

This application-level E2E check builds Adam, Eve, Bob, and Alice with controlled tag sets and
calls the same `FindSimilarIndex` used by the app. It verifies that both binary Jaccard and cosine
similarity rank Eve above Bob above Alice, and covers identity, disjoint, empty, containment,
large-count-difference, and equal-count/different-overlap cases.

Two empty sets score `0`: without any tags there is no evidence of a user match.
