# 82 — Tag graph tour

covers: OPEN-87

**File:** `tests/e2e/staged/stage3-three-user/82-tag-graph-tour.spec.ts`

The app is a GUI over a graph: places (Chatrooms), people (Contacts), Talks, and answers (Me).
A tag is the simplest Talk (one question, answered ♡ or ✕), and it touches every kind of node,
so one tag can walk every edge. The links live in `src/web/ui/graph-focus.ts`.

## Setup

Three users in one Nearby group. From the starter tags: Ann likes Coffee and Pizza; Ben likes
Pizza (the tap passes Coffee above it); Cy likes both. Ann and Cy send their tags to the other
two, and each chatbot answers from its own Like or Pass.

## The walk, from Ann's side

| Step | Edge | Check |
|------|------|-------|
| 1 | Place → person | Ben's row in Nearby opens his page |
| 2 | Person → tag → people | Ben's ♡ Pizza (marked shared) → Contacts "♡ Pizza": Ben and Cy |
| 3 | Person → Talks | Cy's 💬 → Talks narrowed to what we exchanged; Pizza shows ♡ and 👥 2, as on Me |
| 4 | Talk → answer | Pizza's ♡ on Talks → Me, just that answer |
| 5 | Answer → people / Talk | 👥 → the same two people; 💬 → the Pizza Talk |
| 6 | Person → answers | Cy's "♡ 2 in common" → Me shows Coffee and Pizza |
| 7 | Typed tag → people | Contacts 🏷️, type "coffee" → Cy only (Ben passed it) |

## From Ben's side

His ♡ Pizza shows 👥 2 and lists Ann and Cy; Coffee, which he passed, is hidden on Me.

## Not walked yet

Place ↔ Talk and place ↔ answer (where a tag was sent or answered) need the place recorded on
each exchange; a back step for every link is still to come.
