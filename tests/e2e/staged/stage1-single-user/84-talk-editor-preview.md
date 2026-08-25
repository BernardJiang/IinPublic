# 84-talk-editor-preview

covers: talk editor usability follow-up — live "what the responder sees" preview

A new collapsible "👁 Preview: what the responder sees" section (`src/web/ui/talk-editor-preview.ts`)
sits above the editor's Cancel/Create buttons. It starts collapsed; opening it reads the CURRENT
in-progress form state (not the saved talk), runs it through the same `TalkAutofix.fix` the real
save path uses, and renders the current question + its answer choices as clickable buttons. The
author can click through their own structure exactly like a real responder would; the outcome
(match / filtered out / survey complete) is decided by the real `checkIfMatch` (talk-engine.ts),
not a reimplementation. Any edit elsewhere in the form (title, question text, answers, checkboxes)
re-derives the whole preview from scratch while it's open — genuinely live, not a snapshot.

Two cases:
- **Flow talk**: builds a 2-question chain ("Do you like coffee?" → "Do you like tea?"). Walks
  Yes → Yes to a match, restarts and walks Yes → No to an ignore, then edits Q1's text while the
  preview is still open and confirms the panel picks up the new wording without being reopened.
- **Route talk**: builds the same "buy stuff" shape used elsewhere in the suite (Pair-tag-free
  version — buy → sell → iphone → parallel model/condition specs) and walks all the way through
  the parallel fan-out to a match, proving the preview's route-branching logic (mirrors
  `talk-response-dialog.ts`'s own small `pendingSpecQueue` pattern, reimplemented locally since
  that one isn't exported) handles a real multi-spec structure, not just a linear chain.

Single browser, nothing saved or broadcast — the preview never touches storage or the network.
