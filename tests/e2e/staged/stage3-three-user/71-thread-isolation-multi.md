# 71 — Thread isolation across three users

covers: SPEC-7.6, SPEC-19.4, SPEC-7.5  <!-- auto-seeded; refine by hand -->

Pair-private per-talk threads (gui-redesign-plan §5, T8) with three users sharing the
SAME matched talk id in two pairs (Tom↔Jerry and Tom↔Bob):

1. Tom's message into the Tom↔Jerry thread appears only in that pair's thread.
2. Jerry's open User layout shows a per-thread unread badge for the talk row; reading
   the thread shows the message and clears the badge (per-thread read cursor).
3. Bob's thread for the same talk (different pair) shows no badge and never contains
   the Tom↔Jerry message — isolation comes from the pair conversation, not the talk id.
