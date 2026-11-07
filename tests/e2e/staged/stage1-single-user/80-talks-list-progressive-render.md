# 80-talks-list-progressive-render

covers: SPEC-5.1, SPEC-26.2

Talks tab progressive render for long lists: with more talks than the first-chunk size (25), the
first chunk is visible immediately and the remainder fills in shortly after, without dropping or
duplicating any row even under several rapid successive re-renders fired synchronously in one JS
tick — the scenario that exposes a staleness/duplication race in the deferred remainder. Row
counts are read in-page right as the remainders fire. A deferred-remainder row (past the first
chunk) opens the talk editor on click, proving the single delegated click handler covers it.
