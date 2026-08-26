# 85-talk-template-customize-and-expand

covers: more talk-template use cases (`src/web/ui/talk-templates.ts`), template editability —
customizing pre-filled wording and expanding a template's question flow before saving

Follow-up to 83-talk-template-picker.spec.ts: adds 4 more everyday-errand templates to the
picker — 🏠 Roommate Search, 🔍 Lost & Found, 🐾 Pet Sitting, 📚 Study Buddy/Tutoring — alongside
the original 🤝 Buy/Sell, 🚕 Taxi, 💼 Job Seeker/Hiring, ❤️ Dating. All 4 new ones reuse the same
two-sided Pair-tag `buildTwoSidedOfferTemplate` generator the original 4 already use, so this
file's first test only proves each renders in the picker and pre-fills correctly (title, Q1's
Pair-tag word + counterpart word, Q2's text/answer) — it does not re-prove the picker mechanism
or the underlying Pair-tag matching engine, both already covered by 83 and
89-buy-sell-chatbot-cross-talk-match.spec.ts.

The second test is the actual point of this file: a template is a starting point, not a locked
form. It picks the Roommate template, then:
  - edits Q1's own tag word (`need a roommate` → `need a roommate near campus`) and its
    counterpart word (`have a room` → `have a furnished room near campus`) — both sides of the
    Pair tag are ordinary editable fields even though the checkbox itself is pre-checked;
  - edits Q2's match-answer text (the suggested budget);
  - expands the talk with `#add-question-btn`, adding a genuinely new 3rd question ("Do you
    allow pets?") with its own Yes(match)/No(ignore) answers;
  - rewires Q2's match answer's `.answer-next` from "Noticed (match)" to the new question
    (`q_2`) — the realistic case where a template gets an author 90% of the way there but they
    need one more question before the talk should actually terminate.

Saves for real (`#talk-editor-form button[type="submit"]`) and reads the persisted talk back out
of `myTalks` (not just the live DOM) to confirm the edit and the expansion round-tripped through
`processTalkForm` correctly: the customized wording, `a_1_0` now carrying `nextQuestionId: 'q_1'`
→ `'q_2'` instead of `isMatch`/`isTerminal`, and the new `q_2`/`a_2_0`/`a_2_1` with deterministic
positional ids and the expected match/ignore outcome.

Single browser, single user — no cross-talk matching is exercised, only editor interaction and
the saved data shape.
