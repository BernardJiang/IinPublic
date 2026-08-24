# 93-route-parallel-spec-fanout-buy-sell

covers: `Answer.nextQuestionIds`/`parallelMatchThreshold` (types.ts), `evaluateRouteFanOutMatch`
(talk-engine.ts), Pair-tag (`reciprocalTagContext`) + Simple-tag (`tagKind: 'simple'`) route
questions together in one talk.

A real "buy stuff" talk authored by hand through the Talk Editor's route (DAG) tree: root
question "buy" is a Pair tag (accepts "sell"), chaining into "iPhone" — a Simple tag
(self-match) item question — whose one real answer fans out into TWO parallel spec questions,
"Model" (must be "16pro") and "Condition" (must be "used"). The fan-out's match threshold is
left blank, meaning both specs are required (the editor's own "blank = all" default).

Earlier route specs cover a Pair-tag/Simple-tag question in isolation (90) and a shared root
branching into per-item questions (92), but not a Simple-tag item question that itself
parallel-fans into 2+ independently-answered specs requiring all of them. Alice builds the talk,
verifies the Pair-tag/Simple-tag checkboxes and both parallel leaves survive a save/reopen round
trip, then Bob — a real second browser — walks every branch (buy → sell → iPhone → model →
condition) as a human responder to a real match.
