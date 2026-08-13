# Test: Talk Editor Tag-Pair Picker

covers: docs/TODO.md §BB (deferred from Phase 5, added on request)

**File:** 83-tag-pair-picker.spec.ts
**Features tested:** The tag-pair picker's live opposite-tag preview, auto-set `Talk.role` for
the 3 app-predefined deal pairs (`dealRoleForTag`), auto-generated first-question suggestion
(`questionTemplateForTag`) that never overwrites a manual edit, fallback to manual role selection
for an unrecognized tag, and full round-trip persistence (`Talk.tags`) through create + reopen.

---

## What this test does (in plain English):

1. Opens the talk editor, sets a title, selects "flow" type.
2. Types `buy` into the new tag field. The preview shows "Shown to people tagged: sell", the
   role dropdown auto-jumps to "Requesting," and — since the first question's text was still
   empty — it gets pre-filled with `Do you sell {title}?`, the "addressed to the opposite side"
   question template.
3. Manually overwrites that pre-filled question text, then changes the tag to `sell`. The
   preview/role update again (now "buy" / "Offering"), but the manually-typed question text is
   left untouched — the auto-fill only ever writes into an empty field, never clobbers a real
   edit.
4. Types an unrecognized tag — the preview falls back to "No known opposite tag yet," and
   nothing crashes or auto-sets incorrectly.
5. Sets the tag back to `buy`, fills in the (manually-overwritten) question's two answers, and
   submits. No validation error.
6. Reopens the saved talk for editing: the tag field, the role dropdown, and the opposite-tag
   preview all round-trip correctly from the persisted `Talk.tags`/`Talk.role`.

## Why this exists:

`checkIfMatch` deliberately keeps reading `Talk.role` unchanged (the original §BB design
decision: the match engine needs zero changes for tags to work). This picker is a friendlier
authoring surface on top of that unchanged engine — it doesn't replace `role`, it sets it. Only
the 3 seeded deal pairs (buy/sell, hiring/jobseeking) have a role mapping and a question
template; `male`/`female` (reserved for §DD) and any other tag fall back to manual role
selection, exactly like before this control existed. No persistence was added for user-created
tag pairs in this pass — only the 3 seeded ones are live.

## Verifications:

- ✅ No tag typed → no preview text, role stays unset.
- ✅ A known tag (`buy`) → preview names the opposite (`sell`), role auto-set to `request`,
  empty Q1 pre-filled with the generated template.
- ✅ Changing the tag again re-runs the preview/role auto-set, but a manually-edited Q1 is never
  overwritten.
- ✅ An unrecognized tag shows the "no known opposite" fallback message, no auto-set, no error.
- ✅ Talk creation with a tag set succeeds (no validation error).
- ✅ Reopening the saved talk for edit round-trips the tag, role, and preview correctly.

---

**Helpers used:** `bootstrapUser`, `waitForTabActive`, `submitTalkEditorAndWaitForOut`,
`clearGunForStage1Spec`.
