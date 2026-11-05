# 08-retraction — P0 step 10: Talk retraction (three browsers)

covers: SPEC-8.2  <!-- auto-seeded; refine by hand -->

## Scenario

Tom creates and broadcasts a tag talk ("Tennis?") to Jerry and Bob.

Jerry answers match (Yes). Bob answers ignore (No). Tom now has a conversation
with Jerry (matched). Bob has no conversation (ignored/no-reply).

Tom then retracts the talk (simulating a tag-uncheck or delete action).
This triggers `handleRetractTalk` which:
- Writes a deletion event in Tom's device graph (`graph.retract`).
- Puts it in Tom's graph log for everyone the Talk was sent to (Jerry, Bob).

Jerry and Bob read the deletion from Tom's log. Each:
- Keeps the deletion event in their own graph (`ix/deleted/<talkId>`, the dead inbox).
- Updates any conversation with Tom that references this talkId to `status:'withdrawn'`.
- Shows a "match gone" notice with the retractedAt timestamp.

Jerry's conversation-list item has `data-conversation-status="withdrawn"` and
`data-retracted-at` set (durable attributes, assertable by E2E without ephemeral toasts).

Tom's own conversation with Jerry also moves to `status:'withdrawn'`.

## Dead-inbox assertion

Jerry then attempts a change-of-mind answer (submits a new response for Tom's
retracted talk). The `submitTalkResponsePairDirect` path finds the
deletion in Jerry's graph (`graph.deletedAt`) and sends nothing. Tom's recorded
outcomes and conversation are unchanged after this attempt.

## Key invariants verified

1. The deletion is of one Talk by its graph id (author-scoped: Bob's identical-content
   Talk is another Talk with its own id).
2. Conversation status `'withdrawn'` on both sides (Tom and Jerry).
3. `retractedAt` ISO timestamp on the conversation record (distinct from
   step-9 `changedAt` which uses `status:'ignored'`).
4. Dead-inbox: Jerry's post-retraction answer is NOT ingested by Tom.
5. No `/api/talks/*/response` server calls (all P2P, step-7 invariant preserved).
