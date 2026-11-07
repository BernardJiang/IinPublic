# 81-graph-traversal-no-dead-end

covers: SPEC-26.2, SPEC-13.7

Verifies the full navigation graph traversal — Chatroom → Person → Talk → Me-tab Q&A — has no
dead end, walking all three hops in one continuous session after a real match. Hop 1: clicking
Tom's member row in the chatroom roster opens his person page (peer-detail overlay). Hop 2:
clicking the exchanged talk's history row on that person page opens the conversation scoped to
that talk (thread-scope chip carries the talk id). Hop 3: reopening the (now-answered) talk and
clicking "View in My Answers" lands on the Me tab with the answer row highlighted — proving the
whole graph connects rather than re-testing any single edge in isolation.
