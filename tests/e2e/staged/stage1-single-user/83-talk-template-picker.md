# 83-talk-template-picker

covers: talk editor usability follow-up, §DD (Dating template's `ageRange` built-in + adult lock),
progressive disclosure (per-question advanced fields collapsed by default)

Before this, "+ Create Talk" always opened a completely blank editor, with no way to start from
a working example. "+ Create Talk" itself is unchanged (still opens the blank editor directly —
roughly 60 other e2e specs click `#create-talk-btn` expecting exactly that, so intercepting it
was rejected as too large a blast radius). Instead, a new "🎨 Start from a template" button at
the top of the blank editor (shown only for a genuinely fresh create) opens a picker listing
🤝 Buy/Sell, 🚕 Taxi Ride, 💼 Job Seeker/Hiring, ❤️ Dating, and ✏️ Start from scratch. Picking a
template opens the same editor, pre-filled and fully editable (not locked to the template) —
since a template is just a plain prefill object with no `id`, saving it creates a new talk,
exactly like starting from scratch and typing everything by hand would.

Single browser, single user. Also asserts progressive disclosure: a brand-new blank question's
"Advanced options" `<details>` (answer-selection-mode, Simple/Pair tag, "Compare using") starts
collapsed, while a template's already-set fields (Dating's Pair tag + `ageRange`) start expanded
so the value is never hidden behind an extra click.

For each of the 4 templates, opens the picker, picks it, and asserts the editor's Q1/Q2 fields
(and Pair-tag checkbox) are pre-filled with the expected wording, then cancels and reopens the
picker for the next one. Dating gets extra assertions: the new `ageRange` built-in kind is
selected with its 3 fields populated (age/min/max), and `#talk-is-adult` is pre-checked AND
disabled — the UI half of the dating-category adult-content lock (the authoritative half is
`TalkAutofix.fix`'s force-on-save rule, `talk-engine.ts`, which can't be bypassed by editing the
DOM). Finishes by confirming "Start from scratch" still opens a genuinely blank, unlocked editor
— the picker doesn't change existing behavior for that path.

Does not exercise the actual matching mechanism for any template — Buy/Sell, Taxi, and Job Seeker
all reuse the Pair-tag + chatbot cross-talk mechanism already proven end-to-end elsewhere
(`89-buy-sell-chatbot-cross-talk-match.spec.ts`, the taxi spec); only Dating's new `ageRange`
comparator gets a dedicated 2-browser match spec, `94-dating-agerange-match.spec.ts`.
