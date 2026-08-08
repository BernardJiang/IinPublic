# 78-answer-to-talk-and-contact-navigation

Extends the Contacts/Talks cross-navigation pattern to the Me tab's Answers list.

Each answer's detail popup (opened by tapping the row) already had a "View talk" button;
added "View contact" alongside it, only rendered when the answer has a sender (i.e. it's a
talk someone else sent me, not one I authored myself) — jumps to that sender's Contacts
detail via the same `navigateToGraphNode` dispatcher other cross-navigation uses.

"View talk" itself now forks: for an answer with a sender (this spec's case), it's
unchanged — opens the single-talk response view. For a self-authored answer (no sender),
it instead opens that talk's Talks-tab responses list (`showCreatorRepliesForTalk`),
mirroring the ⟨User⟩ layout's peer-history-item title-link behavior from
`09-contacts-talks-cross-navigation.spec.ts`. That self-authored branch isn't covered here
— it needs a self-authored-and-self-answered talk, an unusual flow to construct in e2e —
but it's a simple boolean gate already exercised via the same `showCreatorRepliesForTalk`
call the Talks-tab spec covers directly.

Setup: Tom creates "Trivia Night" and broadcasts it; Jerry answers as a match. Jerry's
Answers-tab entry for it has one sender (Tom), so "View contact" is offered.
