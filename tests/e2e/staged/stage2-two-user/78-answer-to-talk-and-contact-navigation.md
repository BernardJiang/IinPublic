# 78-answer-to-talk-and-contact-navigation

Extends the Contacts/Talks cross-navigation pattern to the Me tab's Answers list.

docs/TODO.md §LL.2 follow-up: the Me tab dropped its expand-in-place detail popup entirely —
rows lead through the graph (owner design 2026-10-25). Tapping a row opens Contacts narrowed to
the people who exchanged that question with me, the most recent first (`contacts-focus.ts`); a
row nobody exchanged stays alone. Rows carry no buttons: a long-press selects a row, and the
AppBar's 💬 Talk opens its Talk.

💬 Talk forks: for an answer with a sender (this spec's case), it's
unchanged — opens the single-talk response view. For a self-authored answer (no sender),
it instead opens that talk's Talks-tab responses list (`showCreatorRepliesForTalk`),
mirroring the ⟨User⟩ layout's peer-history-item title-link behavior from
`09-contacts-talks-cross-navigation.spec.ts`. That self-authored branch isn't covered here
— it needs a self-authored-and-self-answered talk, an unusual flow to construct in e2e —
but it's a simple boolean gate already exercised via the same `showCreatorRepliesForTalk`
call the Talks-tab spec covers directly.

Setup: Tom creates "Trivia Night" and broadcasts it; Jerry answers as a match. Jerry's
Answers-tab entry for it shows 👥 1; tapping it lists Tom, whose row opens his person page.
