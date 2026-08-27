# 83-talk-template-picker

covers: talk editor usability follow-up, §DD (Dating template's `ageRange` built-in + adult lock),
progressive disclosure (per-question advanced fields collapsed by default), route editor's
`ageRange` built-in support (new — the route editor didn't have this kind before)

Before this, "+ Create Talk" always opened a completely blank editor, with no way to start from
a working example. "+ Create Talk" itself is unchanged (still opens the blank editor directly —
roughly 60 other e2e specs click `#create-talk-btn` expecting exactly that, so intercepting it
was rejected as too large a blast radius). Instead, a new "🎨 Start from a template" button at
the top of the blank editor (shown only for a genuinely fresh create) opens a picker now listing 8
built-in templates plus ✏️ Start from scratch: 🤝 Buy/Sell, 🚕 Taxi Ride, 💼 Job Seeker/Hiring,
❤️ Dating (this spec), and 🏠 Roommate Search, 🔍 Lost & Found, 🐾 Pet Sitting, 📚 Study
Buddy/Tutoring (85-talk-template-customize-and-expand.spec.ts). Picking a
template opens the same editor, pre-filled and fully editable (not locked to the template) —
since a template is just a plain prefill object with no `id`, saving it creates a new talk,
exactly like starting from scratch and typing everything by hand would.

All 8 templates are `type: 'route'` — a genuine branching DAG (`contextPath`-tracked,
`src/shared/talk-engine.ts`), not the simpler linear `flow` shape this picker originally shipped
with. The route editor renders each question as an indented `.route-node[data-qid]` with its own
`.route-question-text[data-qid]` input and `.route-answer[data-qid][data-aid]` rows
(`route-editor-controller.ts`) — a different DOM shape than the flat
`.question-item[data-question-index]` list flow/tag/survey use.

Single browser, single user. Also asserts progressive disclosure: a brand-new blank question's
"Advanced options" `<details>` (answer-selection-mode, Simple/Pair tag, "Compare using") starts
collapsed, while a template's already-set fields (Dating's Pair tag + `ageRange`) start expanded
so the value is never hidden behind an extra click.

For each of the 4 templates, opens the picker, picks it, and asserts the editor's root/first
branch fields (and Pair-tag checkbox) are pre-filled with the expected wording, then cancels and
reopens the picker for the next one. Buy/Sell gets extra assertions proving its "sell" answer
fans out (parallel, not chained) across every item for sale — each item its own Simple tag
(self-match) whose one answer itself fans out into independent Model/Condition/Price-range specs
— the genuinely branching part a linear `flow` talk couldn't express, and also proves a Simple
tag's one frozen answer no longer renders a redundant duplicate text field next to its fan-out
controls (`route-editor-controller.ts`). Dating gets extra assertions: its "Something serious" branch's own
`ageRange` node has the new built-in kind selected with its 3 fields populated (age/min/max) —
this required adding `ageRange` support to the route editor itself
(`route-editor-controller.ts`'s `.route-builtin-kind` select previously only offered
quantity/priceRange/timeFrame/location) — and `#talk-is-adult` is pre-checked AND disabled — the
UI half of the dating-category adult-content lock (the authoritative half is
`TalkAutofix.fix`'s force-on-save rule, `talk-engine.ts`, which can't be bypassed by editing the
DOM; the UI half, `syncAdultLockFromBuiltInKinds`, was also extended to scan the route editor's
own built-in-kind selects, not just the flow editor's). Finishes by confirming "Start from
scratch" still opens a genuinely blank, unlocked editor — the picker doesn't change existing
behavior for that path.

Does not exercise the actual matching mechanism for any template — Buy/Sell, Taxi, and Job Seeker
all reuse the Pair-tag + chatbot cross-talk mechanism already proven end-to-end elsewhere
(`89-buy-sell-chatbot-cross-talk-match.spec.ts`, the taxi spec); only Dating's new `ageRange`
comparator gets a dedicated 2-browser match spec, `94-dating-agerange-match.spec.ts`.
