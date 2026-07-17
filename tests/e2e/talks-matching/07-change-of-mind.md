# 07 — Change-of-mind (step 9)

covers: SPEC-8.2  <!-- auto-seeded; refine by hand -->

Tom AND Bob each broadcast a tag talk with the same tennis question (identical content
= same identityKey, different talkIds and authorIds).

Jerry ignores both.

Jerry changes to match — since both talks share the same identityKey, the responder-side
exchanged section lists Tom AND Bob as senders. submitTalkResponsePairDirect fans out the
version-2 response to both.

Both Tom and Bob receive the update: handleMeshTalkResponse sees version 2 > prior 1,
outcome flips ignore→match, creates conversation, records changeOfMindAt.

Jerry reverts to ignore for Tom — version 3 response sent only to Tom (it was the direct
author in this call). Tom's conversation is marked status:'ignored' with changedAt set.
Bob's conversation remains active.

A stale version-1 inject is tried directly on Tom — applyEvent rejects it (version ≤
existing), no state change occurs.

Durable assertions:
- myConversations[*].changeOfMindAt present after ignore→match
- myConversations[*].status = 'ignored' after match→ignore revert
- myConversations[*].changedAt present after revert
- talkLedger.outcomes[*].version >= 2 after change
- Bob conversation not ended after Jerry reverted only Tom
- Zero POST to /api/talks/*/response
