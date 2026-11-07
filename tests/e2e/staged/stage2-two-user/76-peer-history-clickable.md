# 76-peer-history-clickable

covers: SPEC-26.1, SPEC-13.3

Verifies every exchanged-talk row in the peer-detail history list is clickable, not only talks
that already have a conversation under their talkId. Clicking a mismatch talk with no prior
messages creates the pair's conversation on demand, scoped to that talk (thread-scope chip shows
the talk title and `data-talk-id`). For a pair with an existing conversation, clicking the
matched talk's row opens the same thread it always did, and clicking a second exchanged talk
re-scopes the SAME conversation (one conversation per pair) to the new talk's thread context
without collapsing it.
