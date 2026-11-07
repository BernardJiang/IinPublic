# 76-compact-answer-rows

covers: SPEC-13.7, SPEC-26.2

Me-tab answer entries render as one line — question → answer, with the context label shown
inline when the question has a context path — with no dedicated actions row and no
expand-in-place popup; talk metadata (date/outcome/senders/language) isn't shown on this page at
all. Uses a self-answered route talk so the flattened history renders one row per question with
rich nested context, asserts the single-line layout and the absence of the details popup and the
copy-talk action, and confirms the created talk still appears on the Talks tab.
