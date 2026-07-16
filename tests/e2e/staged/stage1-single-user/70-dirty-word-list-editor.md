# stage1/70 — Dirty-word filter list editor

Covers TODO item **H** (redesign §9.1, catalog T9): the user-editable dirty-word
list on the Settings content-filters page.

## What it verifies

1. **Defaults present.** On first load the four seeded words — `fuck`, `cunt`,
   `bitch`, `cock` — render as removable chips (`dirty-word-chip`).
2. **Add.** Typing a word into `dirty-word-add-input` and clicking
   `dirty-word-add-btn` appends a new chip.
3. **Remove.** Clicking a chip's `dirty-word-chip-remove` ✕ drops that word.
4. **Reset.** `dirty-word-reset-btn` restores exactly the four defaults.
5. **Validation.** A <2-char entry, and a duplicate, are both rejected with an
   inline message in `dirty-word-error` and no chip added. A 51st entry is
   rejected (cap 50).
6. **Persistence.** After removing one word and adding another, `page.reload()`
   preserves the edited list (stored in the SEA-private `TalkIntakeFilters`
   `dirtyWords` field via localStorage).

## Notes

The list is separate from the `blockDirtyWords` enable toggle
(`settings-dirty-words-filter`) and from `customBlockedTerms` (the talk-phrase
blocker). An empty list with the filter enabled still applies the built-in
moderation terms.
