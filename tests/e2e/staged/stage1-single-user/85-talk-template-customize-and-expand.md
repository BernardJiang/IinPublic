# 85-talk-template-customize-and-expand

covers: more talk-template use cases (`src/web/ui/talk-templates.ts`), template editability —
customizing pre-filled wording and expanding a template's DAG before saving

Follow-up to 83-talk-template-picker.spec.ts: adds 4 more everyday-errand templates to the
picker — 🏠 Roommate Search, 🔍 Lost & Found, 🐾 Pet Sitting, 📚 Study Buddy/Tutoring — alongside
the original 🤝 Buy/Sell, 🚕 Taxi, 💼 Job Seeker/Hiring, ❤️ Dating. All 8 templates are
`type: 'route'` — a real branching DAG (`contextPath`-tracked, rendered by the route editor as
nested `.route-node[data-qid]` blocks, `route-editor-controller.ts`) — and the 4 new ones reuse
the same Pair-tag-root `buildPairTagBranchRoute` generator the original 4 already use, so this
file's first test only proves each renders in the picker and pre-fills correctly (title, root's
Pair-tag word + counterpart word, the first branch question's text/first answer) — it does not
re-prove the picker mechanism or the underlying Pair-tag matching engine, both already covered by
83 and 89-buy-sell-chatbot-cross-talk-match.spec.ts.

The second test is the actual point of this file: a template is a starting point, not a locked
form. It picks the Roommate template (root → budget branch → "When do you need to move in?"
leaf, 5 questions: `q_0`..`q_4`), then:
  - edits the root's own tag word (`need a roommate` → `need a roommate near campus`) and its
    counterpart word (`have a room` → `have a furnished room near campus`) — both sides of the
    Pair tag are ordinary editable fields even though the checkbox itself is pre-checked;
  - edits the budget branch's own wording (`Under $800` → `Under $800, negotiable`);
  - edits that branch's leaf match-answer text (the move-in timing suggestion);
  - expands the talk by clicking that leaf answer's `.route-add-child-btn` — instead of an
    `#add-question-btn` + dropdown-rewire (flow's linked-list model), the route editor grows a
    brand-new question directly off the chosen answer and demotes it from a terminal match to a
    link. The template loads 5 questions, so the new node is deterministically `q_5` (with
    default answers `q_5_match`/`q_5_ignore`) — filled in as "Do you allow pets?" /
    Yes(match)/No(ignore).

Saves for real (`submitTalkEditorAndWaitForOut`) and reads the persisted talk back out of
`myTalks` (not just the live DOM) to confirm the edit and the expansion round-tripped through
`processTalkForm`'s route branch (`collectRouteEditorQuestions`) correctly: the customized
wording, the old leaf answer now carrying `nextQuestionId: 'q_5'` instead of
`isMatch`/`isTerminal`, and the new `q_5`/`q_5_match`/`q_5_ignore` with the expected match/ignore
outcome.

Single browser, single user — no cross-talk matching is exercised, only editor interaction and
the saved data shape.
