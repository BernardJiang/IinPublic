# 81-answers-list-progressive-render

covers: SPEC-5.1, SPEC-13.7

Me tab Answers list progressive render: with more entries than the first-chunk size (25), the
first chunk is visible immediately and the remainder fills in shortly after, without dropping or
duplicating any row even under several rapid successive re-renders fired back-to-back in one JS
tick. Counts are read in-page at the moment the deferred remainders land. A remainder row past
the first chunk shows its answer directly and is fully interactive via the delegated click
handler on the stable container — clicking routes to the creator-replies panel on the Talks tab.
