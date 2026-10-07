# 05b — Edited talk is answered fully automatically

Two users: Tom (author) and Jerry (receiver, chatbot on, default "Whenever offered" scope).

## Flow
1. Tom broadcasts Talk A: tennis? → Balboa? → Sunday?. Jerry answers all three with **Auto**.
2. Tom broadcasts Talk B: pickleball? → Balboa? → Saturday?. Balboa auto-fills; Jerry answers the
   rest with Auto — so the Saturday question has now been answered elsewhere.
3. Tom edits Talk A in place (Sunday → Saturday) and broadcasts again.
4. Jerry's device receives the revised talk as new content and its chatbot answers all three
   questions automatically — no dialog, no typing. The talk is recorded as answered with a 🤖
   badge and violet tint (Talks), and each auto-given answer carries a 🤖 mark (Me).

## Survey and Route
Same scenario with a 3-question Survey and a linear 3-question Route. After the automatic answer,
Jerry opens the 🤖 answer from Me and answers it manually — the 🤖 marker is cleared.

## Verifications
- An author's in-place edit (same talkId, new content) reaches peers who had the old version and
  is offered to their chatbot (dedupe is per content revision, not per talkId).
- A talk whose every question is already answered (Auto) is completed with no user action.
- The automatic answer leaves a clear, editable record; a manual re-answer replaces it.
